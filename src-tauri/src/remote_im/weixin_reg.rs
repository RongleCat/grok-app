//! Weixin personal (ilink) QR login — mirrors cc-connect weixin setup.

use super::{ScanBeginDto, ScanPollDto};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const DEFAULT_BASE: &str = "https://ilinkai.weixin.qq.com";
const DEFAULT_BOT_TYPE: &str = "3";
/// Proactive refresh before ~120s QR expiry.
const PROACTIVE_REFRESH: Duration = Duration::from_secs(90);

#[derive(Default)]
struct QrState {
    qr_key: String,
    base_url: String,
    route_tag: String,
    bot_type: String,
    fetched_at: Option<Instant>,
    refresh_count: u32,
}

static QR_STATE: Mutex<Option<QrState>> = Mutex::new(None);

#[derive(Debug, Deserialize)]
pub(crate) struct BotQrResponse {
    #[serde(default, rename = "qrcode")]
    qrcode: String,
    #[serde(default, rename = "qrcode_img_content")]
    qrcode_img_content: String,
}

#[derive(Debug, Deserialize)]
pub struct QrStatusResponse {
    #[serde(default)]
    pub status: String,
    #[serde(default, rename = "bot_token")]
    pub bot_token: String,
    #[serde(default, rename = "ilink_bot_id")]
    pub ilink_bot_id: String,
    #[serde(default, rename = "ilink_user_id")]
    pub ilink_user_id: String,
    #[serde(default, rename = "base_url")]
    #[allow(dead_code)]
    pub base_url: String,
}

fn http() -> Result<reqwest::Client, String> {
    crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .timeout(Duration::from_secs(35))
        .user_agent("GrokApp-RemoteIM/1.0")
        .build()
        .map_err(|e| e.to_string())
}

async fn get_json(url: &str, route_tag: &str) -> Result<Value, String> {
    let client = http()?;
    let mut req = client.get(url).header("iLink-App-ClientVersion", "1");
    if !route_tag.is_empty() {
        req = req.header("SKRouteTag", route_tag);
    }
    let res = req.send().await.map_err(|e| format!("weixin http: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "weixin HTTP {status}: {}",
            text.chars().take(200).collect::<String>()
        ));
    }
    serde_json::from_str(&text).map_err(|e| format!("weixin json: {e}"))
}

async fn fetch_qr(base: &str, bot_type: &str, route_tag: &str) -> Result<BotQrResponse, String> {
    let url = format!(
        "{}/ilink/bot/get_bot_qrcode?bot_type={}",
        base.trim_end_matches('/'),
        urlencoding_bot_type(bot_type)
    );
    let v = get_json(&url, route_tag).await?;
    Ok(BotQrResponse {
        qrcode: v
            .get("qrcode")
            .or_else(|| v.get("qrCode"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        qrcode_img_content: v
            .get("qrcode_img_content")
            .or_else(|| v.get("qrcodeImgContent"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

fn urlencoding_bot_type(s: &str) -> String {
    s.to_string()
}

async fn poll_status(
    base: &str,
    qr_key: &str,
    route_tag: &str,
) -> Result<QrStatusResponse, String> {
    let url = format!(
        "{}/ilink/bot/get_qrcode_status?qrcode={}",
        base.trim_end_matches('/'),
        qr_key
    );
    let v = get_json(&url, route_tag).await?;
    Ok(QrStatusResponse {
        status: v
            .get("status")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        bot_token: v
            .get("bot_token")
            .or_else(|| v.get("botToken"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        ilink_bot_id: v
            .get("ilink_bot_id")
            .or_else(|| v.get("ilinkBotId"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        ilink_user_id: v
            .get("ilink_user_id")
            .or_else(|| v.get("ilinkUserId"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        base_url: v
            .get("base_url")
            .or_else(|| v.get("baseUrl"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

/// Channels that have a real Host scan implementation.
#[allow(dead_code)]
pub fn scan_supported_channels() -> &'static [&'static str] {
    &["feishu", "lark", "weixin"]
}

#[allow(dead_code)]
pub fn channel_supports_scan(channel: &str) -> bool {
    scan_supported_channels().contains(&channel)
}

/// Options from frontend: base_url, route_tag, bot_type.
pub async fn scan_begin(options: Option<&HashMap<String, String>>) -> Result<ScanBeginDto, String> {
    let base = options
        .and_then(|o| o.get("base_url"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_BASE.into());
    let route_tag = options
        .and_then(|o| o.get("route_tag"))
        .cloned()
        .unwrap_or_default();
    let bot_type = options
        .and_then(|o| o.get("bot_type"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_BOT_TYPE.into());

    let qr = fetch_qr(&base, &bot_type, &route_tag).await?;
    if qr.qrcode.is_empty() {
        return Err("weixin: empty qrcode from get_bot_qrcode".into());
    }
    if qr.qrcode_img_content.is_empty() {
        return Err("weixin: empty qrcode_img_content".into());
    }

    {
        let mut g = QR_STATE.lock().map_err(|e| e.to_string())?;
        *g = Some(QrState {
            qr_key: qr.qrcode.clone(),
            base_url: base.clone(),
            route_tag: route_tag.clone(),
            bot_type: bot_type.clone(),
            fetched_at: Some(Instant::now()),
            refresh_count: 0,
        });
    }

    Ok(ScanBeginDto {
        device_code: qr.qrcode,
        verification_uri: qr.qrcode_img_content,
        interval_sec: 2,
        expire_in_sec: 480,
        platform: "weixin".into(),
    })
}

pub async fn scan_poll(_device_code: &str) -> Result<ScanPollDto, String> {
    let (qr_key, base, route_tag, bot_type, fetched_at, mut refresh_count) = {
        let g = QR_STATE.lock().map_err(|e| e.to_string())?;
        let st = g
            .as_ref()
            .ok_or_else(|| "weixin: no active QR session".to_string())?;
        (
            st.qr_key.clone(),
            st.base_url.clone(),
            st.route_tag.clone(),
            st.bot_type.clone(),
            st.fetched_at,
            st.refresh_count,
        )
    };

    // Proactive refresh
    if let Some(at) = fetched_at {
        if at.elapsed() > PROACTIVE_REFRESH && refresh_count < 5 {
            match fetch_qr(&base, &bot_type, &route_tag).await {
                Ok(new_qr) if !new_qr.qrcode.is_empty() => {
                    refresh_count += 1;
                    let new_key = new_qr.qrcode.clone();
                    let new_uri = new_qr.qrcode_img_content.clone();
                    let mut g = QR_STATE.lock().map_err(|e| e.to_string())?;
                    if let Some(st) = g.as_mut() {
                        st.qr_key = new_key.clone();
                        st.fetched_at = Some(Instant::now());
                        st.refresh_count = refresh_count;
                    }
                    return Ok(ScanPollDto {
                        status: "wait".into(),
                        app_id: None,
                        app_secret: None,
                        owner_open_id: None,
                        platform: Some("weixin".into()),
                        error: Some("qr_refreshed".into()),
                        verification_uri: Some(new_uri),
                        device_code: Some(new_key),
                    });
                }
                _ => {}
            }
        }
    }

    let status = poll_status(&base, &qr_key, &route_tag).await?;
    match status.status.as_str() {
        "wait" | "" => Ok(ScanPollDto {
            status: "wait".into(),
            app_id: None,
            app_secret: None,
            owner_open_id: None,
            platform: Some("weixin".into()),
            error: None,
            ..Default::default()
        }),
        "scaned" | "scanned" => Ok(ScanPollDto {
            status: "scanned".into(),
            app_id: None,
            app_secret: None,
            owner_open_id: None,
            platform: Some("weixin".into()),
            error: None,
            ..Default::default()
        }),
        "expired" => {
            // Auto refresh — status wait + new URI so GUI does not abort (AC3).
            let new_qr = fetch_qr(&base, &bot_type, &route_tag).await?;
            let new_key = new_qr.qrcode.clone();
            let new_uri = new_qr.qrcode_img_content.clone();
            {
                let mut g = QR_STATE.lock().map_err(|e| e.to_string())?;
                if let Some(st) = g.as_mut() {
                    st.qr_key = new_key.clone();
                    st.fetched_at = Some(Instant::now());
                    st.refresh_count += 1;
                }
            }
            Ok(ScanPollDto {
                status: "wait".into(),
                app_id: None,
                app_secret: None,
                owner_open_id: None,
                platform: Some("weixin".into()),
                error: Some("qr_refreshed".into()),
                verification_uri: Some(new_uri),
                device_code: Some(new_key),
            })
        }
        "confirmed" => {
            if status.bot_token.is_empty() {
                return Err("weixin: confirmed but empty bot_token".into());
            }
            let _ = QR_STATE.lock().map(|mut g| *g = None);
            Ok(ScanPollDto {
                status: "completed".into(),
                app_id: Some(if status.ilink_bot_id.is_empty() {
                    "default".into()
                } else {
                    status.ilink_bot_id
                }),
                app_secret: Some(status.bot_token),
                owner_open_id: if status.ilink_user_id.is_empty() {
                    None
                } else {
                    Some(status.ilink_user_id)
                },
                platform: Some("weixin".into()),
                error: None,
                ..Default::default()
            })
        }
        other => Ok(ScanPollDto {
            status: other.into(),
            app_id: None,
            app_secret: None,
            owner_open_id: None,
            platform: Some("weixin".into()),
            error: None,
            ..Default::default()
        }),
    }
}

/// Verify token with a short getUpdates call.
#[allow(dead_code)]
pub async fn verify_token(base_url: &str, token: &str, route_tag: &str) -> Result<(), String> {
    let client = http()?;
    let url = format!("{}/ilink/bot/getupdates", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "get_updates_buf": "",
        "base_info": { "channel_version": "grok-app-weixin/1.0" }
    });
    let mut req = client
        .post(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("AuthorizationType", "ilink_bot_token")
        .header("Content-Type", "application/json");
    if !route_tag.is_empty() {
        req = req.header("SKRouteTag", route_tag);
    }
    let res = req
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("verify: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("verify HTTP {}", res.status()));
    }
    Ok(())
}

/// Pure helpers for unit tests (no network).
#[cfg(test)]
pub mod test_parse {
    use super::*;

    pub fn parse_status_json(raw: &str) -> Result<QrStatusResponse, String> {
        serde_json::from_str(raw).map_err(|e| e.to_string())
    }

    pub fn parse_qr_json(raw: &str) -> Result<BotQrResponse, String> {
        let v: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
        Ok(BotQrResponse {
            qrcode: v
                .get("qrcode")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .into(),
            qrcode_img_content: v
                .get("qrcode_img_content")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .into(),
        })
    }

    #[test]
    fn parses_confirmed_payload() {
        let s = parse_status_json(
            r#"{"status":"confirmed","bot_token":"tok123","ilink_bot_id":"bot1","ilink_user_id":"u@im.wechat"}"#,
        )
        .unwrap();
        assert_eq!(s.status, "confirmed");
        assert_eq!(s.bot_token, "tok123");
        assert_eq!(s.ilink_user_id, "u@im.wechat");
    }

    #[test]
    fn parses_qr_payload() {
        let q = parse_qr_json(r#"{"qrcode":"key1","qrcode_img_content":"https://example.com/qr"}"#)
            .unwrap();
        assert_eq!(q.qrcode, "key1");
        assert!(q.qrcode_img_content.starts_with("https://"));
    }

    #[test]
    fn weixin_scan_is_supported_not_rejected_at_router() {
        assert!(super::channel_supports_scan("weixin"));
        assert!(super::channel_supports_scan("feishu"));
        assert!(!super::channel_supports_scan("telegram"));
    }
}
