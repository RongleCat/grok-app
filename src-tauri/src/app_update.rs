//! Check for newer App releases on GitHub (L08 first slice).
//!
//! Does **not** auto-install: unsigned community builds and missing
//! `TAURI_SIGNING_*` secrets make silent Tauri updater unreliable. Users get a
//! clear "newer version / open release page" path from Settings → About.
//!
//! Strategy:
//! 1. GitHub REST `GET /repos/.../releases/latest` (rich payload: body, assets).
//! 2. On API failure (rate limit 403/429, network, etc.) fall back to following
//!    `https://github.com/.../releases/latest` redirect and parsing the tag
//!    from the final URL — no API quota, works on shared IPs.

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

const DEFAULT_RELEASES_API_URL: &str =
    "https://api.github.com/repos/RongleCat/grok-app/releases/latest";
const DEFAULT_RELEASES_HTML_URL: &str =
    "https://github.com/RongleCat/grok-app/releases/latest";
const DEFAULT_RELEASES_PAGE: &str = "https://github.com/RongleCat/grok-app/releases";

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
    /// Best-effort direct installer URL for this platform (if assets list one).
    pub download_url: Option<String>,
    pub download_name: Option<String>,
}

/// Strip optional `v` / `V` prefix and parse `major.minor.patch` (extra suffix ignored).
pub fn parse_semver(raw: &str) -> Option<(u64, u64, u64)> {
    let s = raw.trim().trim_start_matches(['v', 'V']);
    if s.is_empty() {
        return None;
    }
    // Drop pre-release / build metadata: 1.2.3-beta.1+meta → 1.2.3
    let core = s.split(['-', '+']).next().unwrap_or(s);
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


fn pick_platform_asset(assets: Option<&Vec<Value>>) -> (Option<String>, Option<String>) {
    let Some(arr) = assets else {
        return (None, None);
    };
    let prefer: &[&str] = if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            &["aarch64", "arm64", "apple-silicon", "macos", "dmg"]
        } else {
            &["x64", "x86_64", "macos", "dmg"]
        }
    } else if cfg!(target_os = "windows") {
        &["windows", "x64", "msi", "nsis", "exe"]
    } else {
        &["linux", "appimage", "deb"]
    };
    let mut best: Option<(usize, String, String)> = None; // score, name, url
    for a in arr {
        let name = match a.get("name").and_then(|n| n.as_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let url = match a.get("browser_download_url").and_then(|u| u.as_str()) {
            Some(u) if u.starts_with("https://") => u.to_string(),
            _ => continue,
        };
        let lower = name.to_ascii_lowercase();
        let mut score = 0usize;
        for (i, token) in prefer.iter().enumerate() {
            if lower.contains(token) {
                score += 100 - i;
            }
        }
        if score == 0 {
            continue;
        }
        match &best {
            None => best = Some((score, name, url)),
            Some((s, _, _)) if score > *s => best = Some((score, name, url)),
            _ => {}
        }
    }
    match best {
        Some((_, n, u)) => (Some(u), Some(n)),
        None => (None, None),
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
        .unwrap_or(DEFAULT_RELEASES_PAGE)
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
    let assets = v.get("assets").and_then(|a| a.as_array());
    let asset_names = assets
        .map(|arr| {
            arr.iter()
                .filter_map(|a| a.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let (download_url, download_name) = pick_platform_asset(assets);

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
        download_url,
        download_name,
    })
}

/// Extract `v0.1.7` / `0.1.7` from a releases tag URL or path.
///
/// Accepts:
/// - `https://github.com/RongleCat/grok-app/releases/tag/v0.1.7`
/// - `.../releases/tag/v0.1.7?foo=1`
/// - `/RongleCat/grok-app/releases/tag/0.1.7`
pub fn extract_tag_from_release_url(url: &str) -> Option<String> {
    let base = url.split(['?', '#']).next().unwrap_or(url);
    // Find `/releases/tag/<tag>`
    let marker = "/releases/tag/";
    let idx = base.find(marker)?;
    let after = &base[idx + marker.len()..];
    let tag = after
        .split('/')
        .next()
        .unwrap_or(after)
        .trim()
        .trim_end_matches('/');
    if tag.is_empty() {
        return None;
    }
    // Basic sanity: must look like a version tag
    if parse_semver(tag).is_none() {
        return None;
    }
    Some(tag.to_string())
}

fn build_check_from_tag(current_version: &str, tag: &str, html_url: &str) -> AppUpdateCheck {
    let latest_version = tag.trim_start_matches(['v', 'V']).to_string();
    let update_available = is_remote_newer(current_version, tag);
    let release_name = format!("v{latest_version}");
    AppUpdateCheck {
        current_version: current_version.to_string(),
        latest_version,
        update_available,
        release_name: Some(release_name),
        html_url: html_url.to_string(),
        published_at: None,
        body: None,
        asset_names: vec![],
        download_url: None,
        download_name: None,
    }
}

fn is_allowed_update_url(url: &str) -> bool {
    url.starts_with("https://")
        || url.starts_with("http://127.0.0.1")
        || url.starts_with("http://localhost")
}

fn format_http_error(status: u16, body: &str) -> String {
    let lower = body.to_ascii_lowercase();
    if status == 403 || status == 429 {
        if lower.contains("rate limit") {
            return format!(
                "GitHub API rate limit (HTTP {status}). Unauthenticated limit is 60/hour per IP — try again later, or open the release page."
            );
        }
        if !body.trim().is_empty() {
            // Prefer short message field when JSON
            if let Ok(v) = serde_json::from_str::<Value>(body) {
                if let Some(msg) = v.get("message").and_then(|m| m.as_str()) {
                    return format!("GitHub releases returned HTTP {status}: {msg}");
                }
            }
            let snippet: String = body.chars().take(160).collect();
            return format!("GitHub releases returned HTTP {status}: {snippet}");
        }
    }
    format!("GitHub releases returned HTTP {status}")
}

fn http_client(user_agent: &str) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .user_agent(user_agent)
        .build()
        .map_err(|e| e.to_string())
}

/// Primary path: GitHub REST releases/latest.
async fn fetch_via_api(
    client: &reqwest::Client,
    url: &str,
) -> Result<Value, String> {
    let mut req = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");

    // Optional auth raises rate limit (5000/h). Never required for public repos.
    if let Ok(token) = std::env::var("GITHUB_TOKEN").or_else(|_| std::env::var("GH_TOKEN")) {
        let token = token.trim();
        if !token.is_empty() {
            req = req.header("Authorization", format!("Bearer {token}"));
        }
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("update check network: {e}"))?;

    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format_http_error(status.as_u16(), &body));
    }

    res.json()
        .await
        .map_err(|e| format!("update check parse: {e}"))
}

fn resolve_location(base_host_hint: &str, loc: &str) -> String {
    if loc.starts_with("http://") || loc.starts_with("https://") {
        loc.to_string()
    } else if loc.starts_with('/') {
        // Relative Location on github.com
        if base_host_hint.starts_with("https://") || base_host_hint.starts_with("http://") {
            // Prefer scheme+host from the request URL when available.
            if let Ok(u) = url::Url::parse(base_host_hint) {
                if let Some(host) = u.host_str() {
                    return format!("{}://{}{}", u.scheme(), host, loc);
                }
            }
        }
        format!("https://github.com{loc}")
    } else {
        loc.to_string()
    }
}

/// Fallback: follow HTML `/releases/latest` → `/releases/tag/vX.Y.Z` (no API quota).
async fn fetch_via_html_redirect(
    client: &reqwest::Client,
    latest_url: &str,
    current_version: &str,
) -> Result<AppUpdateCheck, String> {
    let ua = format!(
        "GrokApp/{current_version} (desktop; check-update; +https://github.com/RongleCat/grok-app)"
    );

    // 1) Prefer Location header without downloading the HTML body.
    let client_nr = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(&ua)
        .build()
        .map_err(|e| e.to_string())?;

    let res = client_nr
        .get(latest_url)
        .header("Accept", "text/html")
        .send()
        .await
        .map_err(|e| format!("update fallback network: {e}"))?;

    let status = res.status().as_u16();
    if let Some(loc) = res.headers().get(reqwest::header::LOCATION) {
        if let Ok(loc_s) = loc.to_str() {
            let absolute = resolve_location(latest_url, loc_s);
            if let Some(tag) = extract_tag_from_release_url(&absolute) {
                return Ok(build_check_from_tag(current_version, &tag, &absolute));
            }
        }
    }

    // 2) 200 body scan (proxies that rewrite redirects).
    if status == 200 {
        let body = res.text().await.unwrap_or_default();
        if let Some(idx) = body.find("/releases/tag/") {
            let slice: String = body[idx..].chars().take(80).collect();
            if let Some(tag) = extract_tag_from_release_url(&format!("https://github.com{slice}")) {
                let tag_path = if tag.starts_with('v') || tag.starts_with('V') {
                    tag.clone()
                } else {
                    format!("v{tag}")
                };
                let html = format!("https://github.com/RongleCat/grok-app/releases/tag/{tag_path}");
                return Ok(build_check_from_tag(current_version, &tag, &html));
            }
        }
    }

    // 3) Follow redirects; parse final URL.
    let res2 = client
        .get(latest_url)
        .header("Accept", "text/html")
        .send()
        .await
        .map_err(|e| format!("update fallback follow: {e}"))?;
    let final_url = res2.url().as_str().to_string();
    if let Some(tag) = extract_tag_from_release_url(&final_url) {
        return Ok(build_check_from_tag(current_version, &tag, &final_url));
    }

    Err(format!(
        "update fallback: could not parse latest tag (HTTP {status}, url={final_url})"
    ))
}

/// Query GitHub for the latest release and compare to this build.
pub async fn check_app_update() -> Result<AppUpdateCheck, String> {
    let current = env!("CARGO_PKG_VERSION");
    let api_url =
        std::env::var("GROK_APP_RELEASES_URL").unwrap_or_else(|_| DEFAULT_RELEASES_API_URL.into());
    let html_url = std::env::var("GROK_APP_RELEASES_HTML_URL")
        .unwrap_or_else(|_| DEFAULT_RELEASES_HTML_URL.into());

    if !is_allowed_update_url(&api_url) {
        return Err("update check URL must be https (or localhost for tests)".into());
    }
    if !is_allowed_update_url(&html_url) {
        return Err("update fallback URL must be https (or localhost for tests)".into());
    }

    let ua = format!(
        "GrokApp/{current} (desktop; check-update; +https://github.com/RongleCat/grok-app)"
    );
    let client = http_client(&ua)?;

    match fetch_via_api(&client, &api_url).await {
        Ok(v) => parse_github_release(current, &v),
        Err(api_err) => {
            tracing::warn!(error = %api_err, "app update API failed; trying HTML redirect fallback");
            match fetch_via_html_redirect(&client, &html_url, current).await {
                Ok(check) => Ok(check),
                Err(fallback_err) => Err(format!("{api_err} | {fallback_err}")),
            }
        }
    }
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

    #[test]
    fn extract_tag_from_release_url_ok() {
        assert_eq!(
            extract_tag_from_release_url(
                "https://github.com/RongleCat/grok-app/releases/tag/v0.1.7"
            )
            .as_deref(),
            Some("v0.1.7")
        );
        assert_eq!(
            extract_tag_from_release_url(
                "https://github.com/RongleCat/grok-app/releases/tag/0.2.0?foo=1#sec"
            )
            .as_deref(),
            Some("0.2.0")
        );
        assert_eq!(
            extract_tag_from_release_url("/RongleCat/grok-app/releases/tag/v1.0.0").as_deref(),
            Some("v1.0.0")
        );
        assert!(extract_tag_from_release_url("https://github.com/RongleCat/grok-app/releases").is_none());
        assert!(extract_tag_from_release_url("https://example.com/nope").is_none());
    }

    #[test]
    fn format_http_error_rate_limit() {
        let msg = format_http_error(
            403,
            r#"{"message":"API rate limit exceeded for 1.2.3.4.","documentation_url":"https://docs.github.com"}"#,
        );
        assert!(msg.contains("rate limit"), "{msg}");
        assert!(msg.contains("403"), "{msg}");
    }

    #[test]
    fn build_check_from_tag_compares() {
        let c = build_check_from_tag(
            "0.1.5",
            "v0.1.7",
            "https://github.com/RongleCat/grok-app/releases/tag/v0.1.7",
        );
        assert!(c.update_available);
        assert_eq!(c.latest_version, "0.1.7");
        assert!(c.asset_names.is_empty());
    }
}
