// from PR #79

fn setup_preview_from_body(body: &str) -> serde_json::Value {
    match serde_json::from_str::<serde_json::Value>(body) {
        Ok(mut value) => {
            redact_setup_json_value(&mut value);
            serde_json::json!({
                "ok": true,
                "payload": value,
                "message": null,
                "error": null,
                "errorKind": null,
            })
        }
        Err(_) => {
            // Not JSON — return scrubbed plain text as message only.
            let message = store::redact_text(body)
                .trim()
                .chars()
                .take(4000)
                .collect::<String>();
            serde_json::json!({
                "ok": true,
                "payload": null,
                "message": message,
                "error": null,
                "errorKind": null,
            })
        }
    }
}

// from PR #77

fn sort_agent_defs(mut agents: Vec<AgentDefDto>) -> Vec<AgentDefDto> {
    agents.sort_by(|a, b| {
        scope_rank(&a.scope)
            .cmp(&scope_rank(&b.scope))
            .then_with(|| {
                a.name
                    .to_ascii_lowercase()
                    .cmp(&b.name.to_ascii_lowercase())
            })
    });
    agents
}

// from PR #77

fn sort_persona_defs(mut personas: Vec<PersonaDefDto>) -> Vec<PersonaDefDto> {
    personas.sort_by(|a, b| {
        scope_rank(&a.scope)
            .cmp(&scope_rank(&b.scope))
            .then_with(|| {
                a.name
                    .to_ascii_lowercase()
                    .cmp(&b.name.to_ascii_lowercase())
            })
    });
    personas
}

// from PR #77

fn stem_name(file_name: &str) -> String {
    let path = std::path::Path::new(file_name);
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(file_name)
        .to_string()
}

// from PR #89

/// Whether official speech (STT) auth is available for Composer dictation.
#[tauri::command]
pub async fn voice_status() -> Result<crate::voice_stt::VoiceStatusDto, String> {
    Ok(crate::voice_stt::voice_status())
}

// from PR #89

/// Transcribe base64 audio via xAI STT (official token / API key only).
#[tauri::command]
pub async fn voice_transcribe(
    audio_base64: String,
    filename: Option<String>,
    mime: Option<String>,
    locale: Option<String>,
) -> Result<crate::voice_stt::VoiceTranscribeResult, String> {
    Ok(crate::voice_stt::voice_transcribe(audio_base64, filename, mime, locale).await)
}
// from PR #74

/// Case-insensitive path equality after normalization (pure; unit-tested).
pub fn worktree_paths_equal(a: &str, b: &str) -> bool {
    let na = normalize_worktree_path_key(a);
    let nb = normalize_worktree_path_key(b);
    !na.is_empty() && na == nb
}

