//! Speech-to-text for Composer dictation (xAI STT).
//!
//! Official REST contract (docs.x.ai speech-to-text): multipart `POST
//! https://api.x.ai/v1/stt` with Bearer token, `file` field last, optional
//! `language` / `format` / `keyterm` fields before it. Relay-only installs
//! report `not_available`. Custom OpenAI-compatible endpoints are routed to
//! `{base}/audio/transcriptions` instead.

use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::account;
use crate::providers::{self, ActiveRoute};
use crate::secrets;
use crate::voice_auth;

const STT_URL: &str = "https://api.x.ai/v1/stt";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatusDto {
    pub available: bool,
    /// Stable class when unavailable: `not_available`, …
    pub reason: Option<String>,
    pub auth_source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceTranscribeResult {
    pub ok: bool,
    pub text: Option<String>,
    pub error: Option<String>,
    pub error_class: Option<String>,
}

/// Resolve Bearer token for xAI STT (official only — not relay).
pub fn speech_auth_token() -> Option<(String, &'static str)> {
    if let Some(t) = account::speech_access_token() {
        return Some((t, "oauth"));
    }
    let secrets = secrets::load_secrets();
    if let Some(k) = secrets
        .official_api_key
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        return Some((k.clone(), "api_key"));
    }
    None
}

pub fn voice_status() -> VoiceStatusDto {
    let settings = crate::store::load_settings();
    // Custom STT engine: any OpenAI-compatible endpoint (key optional for local
    // servers). Overrides the official-only gate below.
    if settings.stt_engine.trim() == "custom" {
        let base = settings.stt_custom_base_url.as_deref().unwrap_or("").trim();
        if !base.is_empty() {
            return VoiceStatusDto {
                available: true,
                reason: None,
                auth_source: Some("custom".into()),
            };
        }
        return VoiceStatusDto {
            available: false,
            reason: Some("not_available".into()),
            auth_source: None,
        };
    }
    // Official xAI STT: custom / third-party providers cannot use xAI speech
    // endpoints (relay keys are not enough).
    if matches!(providers::active_route(), ActiveRoute::Custom { .. }) {
        return VoiceStatusDto {
            available: false,
            reason: Some("not_available".into()),
            auth_source: None,
        };
    }
    match speech_auth_token() {
        Some((_, src)) => VoiceStatusDto {
            available: true,
            reason: None,
            auth_source: Some(src.into()),
        },
        None => VoiceStatusDto {
            available: false,
            reason: Some("not_available".into()),
            auth_source: None,
        },
    }
}

/// Transcribe base64 audio via xAI STT or a custom OpenAI-compatible endpoint.
/// `filename` should include extension (e.g. audio.webm).
pub async fn voice_transcribe(
    audio_base64: String,
    filename: Option<String>,
    mime: Option<String>,
    // Resolved UI locale (en / zh / zh-TW) from the webview — the raw
    // settings preference may be `system`, which cannot steer the Chinese
    // language hint. Falls back to the stored settings locale when absent
    // (e.g. mirror clients that do not send it).
    locale: Option<String>,
) -> VoiceTranscribeResult {
    let settings = crate::store::load_settings();
    if settings.stt_engine.trim() == "custom" {
        return custom_transcribe(&settings, audio_base64, filename, mime, locale).await;
    }
    official_transcribe(audio_base64, filename, mime).await
}

/// Join a custom base URL with the OpenAI-compatible transcriptions path.
/// Pure helper so tests can drive URL construction.
pub fn custom_stt_url(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return String::new();
    }
    format!("{base}/audio/transcriptions")
}

/// Chinese output script for dictation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZhScript {
    Simplified,
    Traditional,
}

/// Resolve the `stt_zh_script` setting to a concrete script.
/// `auto` follows the app UI locale: zh-TW (or any hant locale) → Traditional,
/// anything else → Simplified. `simplified` / `traditional` are explicit.
pub fn resolve_zh_script(pref: &str, locale: &str) -> ZhScript {
    match pref.trim().to_ascii_lowercase().as_str() {
        "simplified" => ZhScript::Simplified,
        "traditional" => ZhScript::Traditional,
        _ => {
            let loc = locale.to_ascii_lowercase();
            if loc.contains("tw") || loc.contains("hant") || loc.contains("_tw") {
                ZhScript::Traditional
            } else {
                ZhScript::Simplified
            }
        }
    }
}

/// Script-biasing `prompt` for Chinese dictation on Whisper-family endpoints
/// (OpenAI-compatible `prompt` field). Whisper maps all Chinese to one `zh`
/// token and can emit either script; a prompt written in the target script
/// steers the output (verified against Groq's whisper-large-v3).
///
/// Applied when the language hint is Chinese, or when the user explicitly
/// chose a script (`simplified` / `traditional`) — explicit choice implies
/// Chinese dictation even without a language hint.
pub fn stt_script_prompt(language: &str, pref: &str, locale: &str) -> Option<String> {
    let lang = language.trim().to_ascii_lowercase();
    let chinese_hint = lang.starts_with("zh") || lang == "chinese" || lang == "cmn";
    let p = pref.trim().to_ascii_lowercase();
    let explicit = p == "simplified" || p == "traditional";
    if !chinese_hint && !explicit {
        return None;
    }
    let traditional = match resolve_zh_script(pref, locale) {
        ZhScript::Traditional => true,
        ZhScript::Simplified => false,
    };
    Some(
        if traditional {
            "以下是繁體中文的聽寫文本，請用繁體中文輸出。"
        } else {
            "以下是简体中文的听写文本，请用简体中文输出。"
        }
        .to_string(),
    )
}

/// Transcribe via a user-configured OpenAI-compatible `/audio/transcriptions`
/// endpoint. API key is optional (local servers may not need one).
async fn custom_transcribe(
    settings: &crate::store::AppSettings,
    audio_base64: String,
    filename: Option<String>,
    mime: Option<String>,
    locale_override: Option<String>,
) -> VoiceTranscribeResult {
    let url = custom_stt_url(settings.stt_custom_base_url.as_deref().unwrap_or(""));
    if url.is_empty() {
        return VoiceTranscribeResult {
            ok: false,
            text: None,
            error: Some(
                "custom STT base URL is empty — configure it under Settings → Voice".into(),
            ),
            error_class: Some("not_available".into()),
        };
    }

    let key = {
        let s = crate::secrets::load_secrets();
        crate::secrets::stt_custom_key_for(
            &s,
            stt_provider_for_base_url(settings.stt_custom_base_url.as_deref().unwrap_or("")),
        )
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
    };
    let local = is_local_stt_url(&url);

    let bytes = match base64::engine::general_purpose::STANDARD.decode(audio_base64.trim()) {
        Ok(b) => b,
        Err(e) => {
            return VoiceTranscribeResult {
                ok: false,
                text: None,
                error: Some(format!("invalid audio encoding: {e}")),
                error_class: Some("unknown".into()),
            };
        }
    };
    if bytes.is_empty() {
        return VoiceTranscribeResult {
            ok: false,
            text: None,
            error: Some("empty audio".into()),
            error_class: Some("no_speech".into()),
        };
    }

    let fname = filename
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "audio.webm".into());
    let mime = mime
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| guess_mime(&fname).into());

    let client = match crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .user_agent(format!(
            "GrokApp/{} (desktop; voice-stt-custom)",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return VoiceTranscribeResult {
                ok: false,
                text: None,
                error: Some(format!("http client: {e}")),
                error_class: Some("network".into()),
            };
        }
    };

    let model = settings
        .stt_custom_model
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    // Effective UI locale: the webview resolves `system` before calling us;
    // a raw `system` preference (e.g. mirror clients) cannot steer Chinese.
    let effective_locale = locale_override
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| settings.locale.clone());
    // Language hint. Explicit `stt_custom_language` wins; `auto` (empty)
    // follows the app UI locale for the input language — a Chinese UI sends
    // `zh` so Whisper does not misdetect Mandarin as English.
    let lang = settings
        .stt_custom_language
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            let loc = effective_locale.to_ascii_lowercase();
            if loc != "system"
                && (loc.contains("zh") || loc.contains("hant") || loc.contains("cmn"))
            {
                Some("zh")
            } else {
                None
            }
        });
    // Chinese script steering (简体/繁體) via Whisper's `prompt` field. This is
    // OpenAI-standard but not every compatible gateway accepts it, so it is
    // dropped and retried when a strict server rejects it (see below).
    let prompt = stt_script_prompt(
        lang.unwrap_or(""),
        &settings.stt_zh_script,
        &effective_locale,
    );

    let build_form = |with_prompt: bool, with_lang: bool| {
        let part = match reqwest::multipart::Part::bytes(bytes.clone())
            .file_name(fname.clone())
            .mime_str(&mime)
        {
            Ok(p) => p,
            Err(e) => return Err(format!("multipart: {e}")),
        };
        let mut form = reqwest::multipart::Form::new().part("file", part);
        if let Some(m) = model {
            form = form.text("model", m.to_string());
        }
        if with_lang {
            if let Some(l) = lang {
                // OpenAI-compatible endpoints reject unknown params — do not
                // send the xAI-only `format` field here (that belongs to the
                // official path).
                form = form.text("language", l.to_string());
            }
        }
        if with_prompt {
            if let Some(p) = &prompt {
                form = form.text("prompt", p.clone());
            }
        }
        Ok(form)
    };

    let send = |with_prompt: bool, with_lang: bool| -> Result<reqwest::RequestBuilder, String> {
        let form = build_form(with_prompt, with_lang)?;
        let mut req = client.post(&url).multipart(form);
        if let Some(k) = &key {
            req = req.header("Authorization", format!("Bearer {k}"));
        }
        Ok(req)
    };

    let first_req = match send(true, true) {
        Ok(req) => req,
        Err(e) => {
            return VoiceTranscribeResult {
                ok: false,
                text: None,
                error: Some(e),
                error_class: Some("unknown".into()),
            };
        }
    };
    let first_res = match first_req.send().await {
        Ok(r) => r,
        Err(e) => {
            let (class, error) = if local {
                (
                    "local_offline",
                    "本地听写服务未运行或不可达，请先启动服务（见设置 → Voice 的本地指引）"
                        .to_string(),
                )
            } else if e.is_timeout() {
                ("timeout", format!("stt request: {e}"))
            } else {
                ("network", format!("stt request: {e}"))
            };
            return VoiceTranscribeResult {
                ok: false,
                text: None,
                error: Some(error),
                error_class: Some(class.into()),
            };
        }
    };

    let status = first_res.status();
    let body = first_res.text().await.unwrap_or_default();
    let ctx = SttErrorCtx::Custom { local };
    // Strict servers (e.g. sherpa-onnx, some gateways) reject optional params
    // they do not implement with HTTP 400 naming the field. Retry once without
    // the offending param instead of failing the whole dictation. Never retry
    // on other statuses or unknown fields.
    if status.as_u16() == 400 && !body.is_empty() {
        let drop_prompt = prompt.is_some() && mentions_param(&body, "prompt");
        let drop_lang = lang.is_some() && mentions_param(&body, "language");
        if drop_prompt || drop_lang {
            if let Ok(req) = send(!drop_prompt, !drop_lang) {
                if let Ok(r2) = req.send().await {
                    let s2 = r2.status();
                    let b2 = r2.text().await.unwrap_or_default();
                    return if s2.is_success() {
                        finish_http_response(&b2)
                    } else {
                        finish_http_error(s2, &b2, ctx)
                    };
                }
            }
        }
    }

    if !status.is_success() {
        return finish_http_error(status, &body, ctx);
    }

    let text = extract_transcript(&body);
    if text.trim().is_empty() {
        return VoiceTranscribeResult {
            ok: false,
            text: None,
            error: Some("empty transcript".into()),
            error_class: Some("no_speech".into()),
        };
    }

    VoiceTranscribeResult {
        ok: true,
        text: Some(text.trim().to_string()),
        error: None,
        error_class: None,
    }
}

/// True when a server error body names `param` as the offending field
/// (OpenAI-compatible gateways say e.g. `unknown param \`prompt\``).
fn mentions_param(body: &str, param: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    if lower.contains(&format!("`{param}`")) {
        // Backtick-quoted (or plain-whitespace) field references are the
        // standard OpenAI-compatible wording; the verb around it varies
        // (unknown / unexpected / invalid / not allowed …).
        return true;
    }
    lower.contains(&format!("unknown param {param}"))
        || lower.contains(&format!("unknown parameter {param}"))
        || lower.contains(&format!("unexpected field {param}"))
        || lower.contains(&format!("unexpected parameter {param}"))
        || lower.contains(&format!("invalid param {param}"))
        || lower.contains(&format!("invalid parameter {param}"))
        || lower.contains(&format!("field {param} is not allowed"))
}

/// Error-classification context: official xAI endpoint vs custom endpoint
/// (which may be a local service). Keeps 401/403 and connectivity failures in
/// the right buckets so the UI can show accurate copy.
///
/// Prod currently transcribes only through custom-compatible endpoints; the
/// `Official` variant and `local` flag stay for the classification unit tests.
#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
enum SttErrorCtx {
    Official,
    Custom { local: bool },
}

/// True when a Base URL points at a loopback host (local dictation service).
fn is_local_stt_url(base_url: &str) -> bool {
    let u = base_url.to_ascii_lowercase();
    u.contains("127.0.0.1") || u.contains("localhost") || u.contains("::1")
}

/// Provider preset id for a stored Base URL — mirrors `sttPresets.ts`
/// (`matchSttPreset`) so per-provider keys (ADR-0001) resolve consistently on
/// both sides without a stored settings field that could drift from the URL.
pub fn stt_provider_for_base_url(base_url: &str) -> &'static str {
    let b = base_url.trim().trim_end_matches('/');
    match b {
        "http://127.0.0.1:8000/v1" => "local",
        "https://api.groq.com/openai/v1" => "groq",
        "https://api.openai.com/v1" => "openai",
        "https://api.mistral.ai/v1" => "mistral",
        _ => "custom",
    }
}

/// Convert a non-2xx STT response into a structured result (short body only —
/// never echo full bodies that may contain secrets).
fn finish_http_error(
    status: reqwest::StatusCode,
    body: &str,
    ctx: SttErrorCtx,
) -> VoiceTranscribeResult {
    let code = status.as_u16();
    let class = match ctx {
        SttErrorCtx::Custom { .. } if code == 401 || code == 403 => "stt_key",
        SttErrorCtx::Official if code == 401 || code == 403 => "auth",
        _ if code == 408 || code == 504 => "timeout",
        _ if status.is_server_error() => "network",
        _ => "unknown",
    };
    let snippet: String = body.chars().take(160).collect();
    let error = match ctx {
        SttErrorCtx::Custom { .. } if code == 401 || code == 403 => {
            format!("自定义听写 API Key 无效或未填写，请到设置 → Voice 检查（HTTP {code}）")
        }
        SttErrorCtx::Official if code == 401 || code == 403 => {
            format!("stt HTTP {code}: {snippet}")
        }
        _ => format!("stt HTTP {code}: {snippet}"),
    };
    VoiceTranscribeResult {
        ok: false,
        text: None,
        error: Some(error),
        error_class: Some(class.into()),
    }
}

/// Convert a 2xx STT response into a structured result (transcript parsing).
fn finish_http_response(body: &str) -> VoiceTranscribeResult {
    let text = extract_transcript(body);
    if text.trim().is_empty() {
        return VoiceTranscribeResult {
            ok: false,
            text: None,
            error: Some("empty transcript".into()),
            error_class: Some("no_speech".into()),
        };
    }
    VoiceTranscribeResult {
        ok: true,
        text: Some(text.trim().to_string()),
        error: None,
        error_class: None,
    }
}

/// Official xAI STT (previous behavior).
async fn official_transcribe(
    audio_base64: String,
    filename: Option<String>,
    mime: Option<String>,
) -> VoiceTranscribeResult {
    let Some((token, _)) = speech_auth_token() else {
        return VoiceTranscribeResult {
            ok: false,
            text: None,
            error: Some("no speech auth (official login or API key required)".into()),
            error_class: Some("not_available".into()),
        };
    };

    let bytes = match base64::engine::general_purpose::STANDARD.decode(audio_base64.trim()) {
        Ok(b) => b,
        Err(e) => {
            return VoiceTranscribeResult {
                ok: false,
                text: None,
                error: Some(format!("invalid audio encoding: {e}")),
                error_class: Some("unknown".into()),
            };
        }
    };
    if bytes.is_empty() {
        return VoiceTranscribeResult {
            ok: false,
            text: None,
            error: Some("empty audio".into()),
            error_class: Some("no_speech".into()),
        };
    }

    let fname = filename
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "audio.webm".into());
    let mime = mime
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| guess_mime(&fname).into());

    let client = match crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .user_agent(format!(
            "GrokApp/{} (desktop; voice-stt)",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return VoiceTranscribeResult {
                ok: false,
                text: None,
                error: Some(format!("http client: {e}")),
                error_class: Some("network".into()),
            };
        }
    };

    let part = match reqwest::multipart::Part::bytes(bytes)
        .file_name(fname.clone())
        .mime_str(&mime)
    {
        Ok(p) => p,
        Err(e) => {
            return VoiceTranscribeResult {
                ok: false,
                text: None,
                error: Some(format!("multipart: {e}")),
                error_class: Some("unknown".into()),
            };
        }
    };
    let form = reqwest::multipart::Form::new().part("file", part);

    let res = match client
        .post(STT_URL)
        .header("Authorization", format!("Bearer {token}"))
        .multipart(form)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let class = if e.is_timeout() { "timeout" } else { "network" };
            return VoiceTranscribeResult {
                ok: false,
                text: None,
                error: Some(format!("stt request: {e}")),
                error_class: Some(class.into()),
            };
        }
    };

    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        let class = if status.as_u16() == 401 || status.as_u16() == 403 {
            "auth"
        } else if status.as_u16() == 408 || status.as_u16() == 504 {
            "timeout"
        } else if status.is_server_error() {
            "network"
        } else {
            "unknown"
        };
        // Never echo full body if it might contain secrets; keep short.
        let snippet: String = body.chars().take(180).collect();
        return VoiceTranscribeResult {
            ok: false,
            text: None,
            error: Some(format!("stt HTTP {}: {snippet}", status.as_u16())),
            error_class: Some(class.into()),
        };
    }

    let text = extract_transcript(&body);
    if text.trim().is_empty() {
        return VoiceTranscribeResult {
            ok: false,
            text: None,
            error: Some("empty transcript".into()),
            error_class: Some("no_speech".into()),
        };
    }

    VoiceTranscribeResult {
        ok: true,
        text: Some(text.trim().to_string()),
        error: None,
        error_class: None,
    }
}

fn guess_mime(filename: &str) -> &'static str {
    let lower = filename.to_ascii_lowercase();
    if lower.ends_with(".mp3") {
        "audio/mpeg"
    } else if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".mp4") || lower.ends_with(".m4a") {
        "audio/mp4"
    } else if lower.ends_with(".ogg") {
        "audio/ogg"
    } else {
        "audio/webm"
    }
}

/// Parse STT JSON body for transcript text (several plausible shapes).
pub fn extract_transcript(body: &str) -> String {
    let Ok(v) = serde_json::from_str::<Value>(body) else {
        // Plain text response
        return body.trim().to_string();
    };
    if let Some(t) = v.get("text").and_then(|x| x.as_str()) {
        return t.to_string();
    }
    if let Some(t) = v.get("transcript").and_then(|x| x.as_str()) {
        return t.to_string();
    }
    if let Some(t) = v
        .pointer("/results/0/alternatives/0/transcript")
        .and_then(|x| x.as_str())
    {
        return t.to_string();
    }
    if let Some(arr) = v.get("segments").and_then(|x| x.as_array()) {
        let mut parts = Vec::new();
        for seg in arr {
            if let Some(t) = seg.get("text").and_then(|x| x.as_str()) {
                parts.push(t.trim());
            }
        }
        if !parts.is_empty() {
            return parts.join(" ");
        }
    }
    String::new()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SttResult {
    pub text: String,
    pub duration: Option<f64>,
    pub language: Option<String>,
}

/// Transcribe a base64-encoded audio blob (wav/webm/mp3). Used by live voice / host.
pub async fn transcribe_base64(
    audio_b64: &str,
    mime: Option<&str>,
    language: Option<&str>,
) -> Result<SttResult, String> {
    if std::env::var("GROK_APP_VOICE")
        .map(|v| v == "mock")
        .unwrap_or(false)
    {
        return Ok(SttResult {
            text: "mock transcript from voice dictation".into(),
            duration: Some(1.0),
            language: Some("en".into()),
        });
    }

    let token = voice_auth::resolve_bearer_token()?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_b64.trim())
        .map_err(|e| format!("invalid audio base64: {e}"))?;
    if bytes.is_empty() {
        return Err("empty audio".into());
    }

    let (filename, content_type) = match mime.unwrap_or("") {
        m if m.contains("webm") => ("audio.webm", "audio/webm"),
        m if m.contains("ogg") => ("audio.ogg", "audio/ogg"),
        m if m.contains("mpeg") || m.contains("mp3") => ("audio.mp3", "audio/mpeg"),
        m if m.contains("mp4") || m.contains("m4a") => ("audio.m4a", "audio/mp4"),
        _ => ("audio.wav", "audio/wav"),
    };

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(filename.to_string())
        .mime_str(content_type)
        .map_err(|e| format!("multipart: {e}"))?;

    // xAI requires option fields to precede `file` in the multipart body —
    // fields sent after `file` may be ignored for streamable uploads (see
    // docs.x.ai speech-to-text "Request Body"). Put language/format first.
    let mut form = reqwest::multipart::Form::new();
    if let Some(lang) = language.filter(|s| !s.is_empty()) {
        form = form
            .text("language", lang.to_string())
            .text("format", "true");
    }
    form = form.part("file", part);

    let client = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let resp = client
        .post(STT_URL)
        .header("Authorization", format!("Bearer {token}"))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("STT request failed: {e}"))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("STT read body: {e}"))?;
    if !status.is_success() {
        let snippet: String = body.chars().take(240).collect();
        return Err(format!("STT HTTP {status}: {snippet}"));
    }

    let v: Value =
        serde_json::from_str(&body).map_err(|e| format!("STT JSON: {e}; body={body}"))?;
    let text = v
        .get("text")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    Ok(SttResult {
        text,
        duration: v.get("duration").and_then(|x| x.as_f64()),
        language: v
            .get("language")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_transcript_text_field() {
        assert_eq!(
            extract_transcript(r#"{"text":"hello world"}"#),
            "hello world"
        );
    }

    #[test]
    fn extract_transcript_segments() {
        let body = r#"{"segments":[{"text":"foo"},{"text":"bar"}]}"#;
        assert_eq!(extract_transcript(body), "foo bar");
    }

    #[test]
    fn extract_empty_object() {
        assert!(extract_transcript("{}").is_empty());
    }

    #[test]
    fn guess_mime_webm() {
        assert_eq!(guess_mime("a.webm"), "audio/webm");
        assert_eq!(guess_mime("a.mp3"), "audio/mpeg");
    }

    #[tokio::test]
    async fn transcribe_without_auth_is_not_available() {
        // When this machine has no official speech token, STT must fail closed.
        // If a token is present we only assert the call returns a structured result.
        let r = voice_transcribe("AAAA".into(), Some("t.webm".into()), None, None).await;
        if speech_auth_token().is_none() {
            assert!(!r.ok);
            assert_eq!(r.error_class.as_deref(), Some("not_available"));
        } else {
            // Invalid tiny base64 audio should not panic; either no_speech or decode/network.
            assert!(r.error_class.is_some() || r.ok);
        }
    }

    #[tokio::test]
    async fn mock_stt() {
        std::env::set_var("GROK_APP_VOICE", "mock");
        let r = transcribe_base64("AAAA", Some("audio/wav"), Some("en"))
            .await
            .unwrap();
        assert!(r.text.contains("mock"));
        std::env::remove_var("GROK_APP_VOICE");
    }

    #[test]
    fn mentions_param_recognizes_common_gateway_wording() {
        assert!(mentions_param(
            r#"{"error":{"message":"unknown param `prompt`","type":"invalid_request_error"}}"#,
            "prompt"
        ));
        assert!(mentions_param(
            "unexpected field `language` is not supported",
            "language"
        ));
        assert!(mentions_param("invalid parameter `model`", "model"));
        assert!(!mentions_param(
            r#"{"error":{"message":"model too slow"}}"#,
            "prompt"
        ));
        assert!(!mentions_param("file too large", "language"));
    }

    #[test]
    fn stt_provider_for_base_url_matches_presets() {
        assert_eq!(
            stt_provider_for_base_url("http://127.0.0.1:8000/v1"),
            "local"
        );
        assert_eq!(
            stt_provider_for_base_url("https://api.groq.com/openai/v1"),
            "groq"
        );
        assert_eq!(
            stt_provider_for_base_url("https://api.openai.com/v1/"),
            "openai"
        );
        assert_eq!(
            stt_provider_for_base_url("https://api.mistral.ai/v1"),
            "mistral"
        );
        assert_eq!(stt_provider_for_base_url(""), "custom");
        assert_eq!(
            stt_provider_for_base_url("https://api.example.com/v1"),
            "custom"
        );
    }

    #[test]
    fn is_local_stt_url_detects_loopback() {
        assert!(is_local_stt_url("http://127.0.0.1:8000/v1"));
        assert!(is_local_stt_url("http://localhost:8000/v1"));
        assert!(is_local_stt_url("http://[::1]:8000/v1"));
        assert!(!is_local_stt_url("https://api.groq.com/openai/v1"));
        assert!(!is_local_stt_url(""));
    }

    #[test]
    fn custom_401_classifies_as_stt_key_not_auth() {
        let r = finish_http_error(
            reqwest::StatusCode::UNAUTHORIZED,
            r#"{"error":{"message":"invalid api key"}}"#,
            SttErrorCtx::Custom { local: false },
        );
        assert_eq!(r.error_class.as_deref(), Some("stt_key"));
        assert!(r.error.unwrap_or_default().contains("API Key"));
    }

    #[test]
    fn official_401_classifies_as_auth() {
        let r = finish_http_error(
            reqwest::StatusCode::UNAUTHORIZED,
            "{}",
            SttErrorCtx::Official,
        );
        assert_eq!(r.error_class.as_deref(), Some("auth"));
    }

    #[test]
    fn custom_stt_url_joins_base() {
        assert_eq!(
            custom_stt_url("https://api.groq.com/openai/v1"),
            "https://api.groq.com/openai/v1/audio/transcriptions"
        );
    }

    #[test]
    fn custom_stt_url_trims_trailing_slash() {
        assert_eq!(
            custom_stt_url("https://api.example.com/v1/"),
            "https://api.example.com/v1/audio/transcriptions"
        );
    }

    #[test]
    fn custom_stt_url_empty_base_is_empty() {
        assert_eq!(custom_stt_url(""), "");
        assert_eq!(custom_stt_url("   "), "");
    }

    #[test]
    fn resolve_zh_script_explicit_prefs_win() {
        assert_eq!(
            resolve_zh_script("simplified", "zh-TW"),
            ZhScript::Simplified
        );
        assert_eq!(
            resolve_zh_script("traditional", "en"),
            ZhScript::Traditional
        );
        assert_eq!(
            resolve_zh_script("Simplified", "zh-TW"),
            ZhScript::Simplified
        );
    }

    #[test]
    fn resolve_zh_script_auto_follows_locale() {
        assert_eq!(resolve_zh_script("auto", "zh-TW"), ZhScript::Traditional);
        assert_eq!(resolve_zh_script("auto", "zh_Hant"), ZhScript::Traditional);
        assert_eq!(resolve_zh_script("auto", "zh"), ZhScript::Simplified);
        assert_eq!(resolve_zh_script("auto", "en"), ZhScript::Simplified);
        assert_eq!(resolve_zh_script("", "en"), ZhScript::Simplified);
    }

    #[test]
    fn stt_script_prompt_zh_language_uses_locale_script() {
        let p = stt_script_prompt("zh", "auto", "zh-TW").unwrap();
        assert!(p.contains("繁體中文"));
        let p = stt_script_prompt("zh", "auto", "en").unwrap();
        assert!(p.contains("简体中文"));
    }

    #[test]
    fn stt_script_prompt_explicit_pref_without_language_hint() {
        let p = stt_script_prompt("", "traditional", "en").unwrap();
        assert!(p.contains("繁體中文"));
        let p = stt_script_prompt("en", "simplified", "zh-TW").unwrap();
        assert!(p.contains("简体中文"));
    }

    #[test]
    fn stt_script_prompt_non_zh_auto_is_none() {
        assert!(stt_script_prompt("en", "auto", "en").is_none());
        assert!(stt_script_prompt("", "auto", "zh").is_none());
        assert!(stt_script_prompt("ja", "auto", "zh-TW").is_none());
    }

    /// Local end-to-end check against a real OpenAI-compatible endpoint.
    /// Skipped unless `GROK_APP_E2E_STT=1`. The port defaults to 8799 (the
    /// fake strict server) but can point at any local server:
    /// `GROK_APP_E2E_STT_PORT=8000`. When `GROK_APP_E2E_STT_AUDIO` is a file
    /// path, that audio is transcribed and only `ok` is asserted (real
    /// transcripts are content-dependent); otherwise the fake server's canned
    /// text is asserted. Never runs in CI.
    #[tokio::test]
    async fn custom_transcribe_e2e_against_local_server() {
        if std::env::var("GROK_APP_E2E_STT")
            .map(|v| v != "1")
            .unwrap_or(true)
        {
            return;
        }
        let port = std::env::var("GROK_APP_E2E_STT_PORT").unwrap_or_else(|_| "8799".into());
        let audio_path = std::env::var("GROK_APP_E2E_STT_AUDIO").ok();
        let settings = crate::store::AppSettings {
            stt_engine: "custom".into(),
            stt_custom_base_url: Some(format!("http://127.0.0.1:{port}/v1")),
            stt_custom_model: Some("whisper-test".into()),
            stt_custom_language: Some("zh".into()),
            ..Default::default()
        };
        let audio = match &audio_path {
            Some(p) => {
                let bytes =
                    std::fs::read(p).expect("GROK_APP_E2E_STT_AUDIO must be a readable file");
                base64::engine::general_purpose::STANDARD.encode(bytes)
            }
            None => base64::engine::general_purpose::STANDARD.encode(vec![7u8; 2048]),
        };
        let r = custom_transcribe(
            &settings,
            audio,
            Some("audio.webm".into()),
            None,
            Some("zh-TW".into()),
        )
        .await;
        assert!(r.ok, "expected ok, got error={:?}", r.error);
        assert_eq!(r.error_class, None);
        if audio_path.is_none() {
            assert!(r.text.unwrap_or_default().contains("本地模拟"));
        }
    }
}
