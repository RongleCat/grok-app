//! Check for newer App releases on GitHub (L08 first slice).
//!
//! Does **not** auto-install: unsigned community builds and missing
//! `TAURI_SIGNING_*` secrets make silent Tauri updater unreliable. Users get a
//! clear "newer version / open release page" path from Settings → About.

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

const DEFAULT_RELEASES_URL: &str =
    "https://api.github.com/repos/RongleCat/grok-app/releases/latest";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(12);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCheck {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_name: Option<String>,
    pub html_url: String,
    pub published_at: Option<String>,
    pub body: Option<String>,
    /// Download asset names on the release (for UI hints; not auto-fetched).
    pub asset_names: Vec<String>,
}

/// Strip optional `v` / `V` prefix and parse `major.minor.patch` (extra suffix ignored).
pub fn parse_semver(raw: &str) -> Option<(u64, u64, u64)> {
    let s = raw.trim().trim_start_matches(['v', 'V']);
    if s.is_empty() {
        return None;
    }
    // Drop pre-release / build metadata: 1.2.3-beta.1+meta → 1.2.3
    let core = s
        .split(['-', '+'])
        .next()
        .unwrap_or(s);
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

/// True when `remote` is a higher semver than `current`.
pub fn is_remote_newer(current: &str, remote: &str) -> bool {
    match (parse_semver(current), parse_semver(remote)) {
        (Some(a), Some(b)) => b > a,
        _ => false,
    }
}

/// Map GitHub `/releases/latest` JSON into [`AppUpdateCheck`].
pub fn parse_github_release(current_version: &str, v: &Value) -> Result<AppUpdateCheck, String> {
    let tag = v
        .get("tag_name")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "release missing tag_name".to_string())?
        .trim();
    if tag.is_empty() {
        return Err("empty tag_name".into());
    }
    let html_url = v
        .get("html_url")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("https://github.com/RongleCat/grok-app/releases")
        .to_string();
    let release_name = v
        .get("name")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let published_at = v
        .get("published_at")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let body = v
        .get("body")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let asset_names = v
        .get("assets")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| a.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let latest_version = tag.trim_start_matches(['v', 'V']).to_string();
    let update_available = is_remote_newer(current_version, tag);

    Ok(AppUpdateCheck {
        current_version: current_version.to_string(),
        latest_version,
        update_available,
        release_name,
        html_url,
        published_at,
        body,
        asset_names,
    })
}

/// Query GitHub for the latest release and compare to this build.
pub async fn check_app_update() -> Result<AppUpdateCheck, String> {
    let current = env!("CARGO_PKG_VERSION");
    let url = std::env::var("GROK_APP_RELEASES_URL").unwrap_or_else(|_| DEFAULT_RELEASES_URL.into());
    if !(url.starts_with("https://") || url.starts_with("http://127.0.0.1") || url.starts_with("http://localhost")) {
        return Err("update check URL must be https (or localhost for tests)".into());
    }

    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .user_agent(format!(
            "GrokApp/{} (desktop; check-update; +https://github.com/RongleCat/grok-app)",
            current
        ))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("update check network: {e}"))?;

    if !res.status().is_success() {
        return Err(format!(
            "GitHub releases returned HTTP {}",
            res.status().as_u16()
        ));
    }

    let v: Value = res
        .json()
        .await
        .map_err(|e| format!("update check parse: {e}"))?;
    parse_github_release(current, &v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_semver_strips_v_and_prerelease() {
        assert_eq!(parse_semver("v0.1.5"), Some((0, 1, 5)));
        assert_eq!(parse_semver("0.1.5"), Some((0, 1, 5)));
        assert_eq!(parse_semver("1.2.3-beta.1"), Some((1, 2, 3)));
        assert_eq!(parse_semver("2.0"), Some((2, 0, 0)));
        assert!(parse_semver("").is_none());
        assert!(parse_semver("nope").is_none());
    }

    #[test]
    fn is_remote_newer_orders() {
        assert!(!is_remote_newer("0.1.5", "v0.1.5"));
        assert!(!is_remote_newer("0.1.5", "0.1.4"));
        assert!(is_remote_newer("0.1.5", "v0.1.6"));
        assert!(is_remote_newer("0.1.5", "0.2.0"));
        assert!(is_remote_newer("0.9.9", "1.0.0"));
        assert!(!is_remote_newer("bad", "0.1.0"));
    }

    #[test]
    fn parse_github_release_update_and_same() {
        let sample = json!({
            "tag_name": "v0.2.0",
            "name": "Grok App v0.2.0",
            "html_url": "https://github.com/RongleCat/grok-app/releases/tag/v0.2.0",
            "published_at": "2026-07-24T00:00:00Z",
            "body": "### Added\n- hello",
            "assets": [
                {"name": "Grok_0.2.0_aarch64.dmg"},
                {"name": "Grok_0.2.0_x64-setup.exe"}
            ]
        });
        let up = parse_github_release("0.1.5", &sample).unwrap();
        assert!(up.update_available);
        assert_eq!(up.latest_version, "0.2.0");
        assert_eq!(up.current_version, "0.1.5");
        assert_eq!(up.asset_names.len(), 2);
        assert!(up.body.as_deref().unwrap().contains("hello"));

        let same = parse_github_release("0.2.0", &sample).unwrap();
        assert!(!same.update_available);
    }
}
