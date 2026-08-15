//! Shared `safe_https_get` for catalog, pack download, and `url=` imports.
//!
//! Do not reuse the wallpaper media downloader (different host allowlist).

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::time::Duration;

use reqwest::redirect::Policy;
use url::Url;

pub const MAX_REDIRECTS: usize = 3;
pub const REQUEST_TIMEOUT_SECS: u64 = 60;

pub const OFFICIAL_SKIN_CATALOG_ID: &str = "official";
pub const OFFICIAL_SKIN_CATALOG_URL: &str = "";
pub const OFFICIAL_SKIN_DOWNLOAD_ORIGINS: &[&str] = &[
    "github.com",
    "github.io",
    "githubusercontent.com",
    "release-assets.githubusercontent.com",
    "objects.githubusercontent.com",
    "x.ai",
];

#[derive(Debug, Clone)]
pub enum OriginPolicy {
    /// `url=` deeplink: https + no userinfo + non-private IP only.
    AnyHttps,
    /// Official catalog / pack / preview: host must be on the compile-time allowlist.
    Official,
    /// User source: hop must stay same origin as the catalog URL.
    UserSameOrigin { catalog: Url },
}

pub type ResolveFn = fn(&str) -> Result<Vec<IpAddr>, String>;

pub fn default_resolve(host: &str) -> Result<Vec<IpAddr>, String> {
    (host, 443u16)
        .to_socket_addrs()
        .map(|it| it.map(|s| s.ip()).collect())
        .map_err(|e| format!("url_blocked: dns {e}"))
}

pub fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_blocked_v4(v4),
        IpAddr::V6(v6) => is_blocked_v6(v6),
    }
}

fn is_blocked_v4(v4: Ipv4Addr) -> bool {
    v4.is_loopback()
        || v4.is_private()
        || v4.is_link_local()
        || v4.is_unspecified()
        || v4.is_broadcast()
        || v4.is_documentation()
        || v4.octets()[0] == 169 && v4.octets()[1] == 254
}

fn is_blocked_v6(v6: Ipv6Addr) -> bool {
    if let Some(v4) = v6.to_ipv4_mapped() {
        return is_blocked_v4(v4);
    }
    v6.is_loopback()
        || v6.is_unspecified()
        || is_ula(v6)
        || is_link_local_v6(v6)
}

fn is_ula(v6: Ipv6Addr) -> bool {
    // fc00::/7
    (v6.octets()[0] & 0xfe) == 0xfc
}

fn is_link_local_v6(v6: Ipv6Addr) -> bool {
    // fe80::/10
    v6.segments()[0] & 0xffc0 == 0xfe80
}

pub fn host_matches_official(host: &str) -> bool {
    let h = host.trim().to_ascii_lowercase();
    if h.is_empty() {
        return false;
    }
    for e in OFFICIAL_SKIN_DOWNLOAD_ORIGINS {
        if h == *e || h.ends_with(&format!(".{e}")) {
            return true;
        }
    }
    if !OFFICIAL_SKIN_CATALOG_URL.is_empty() {
        if let Ok(u) = Url::parse(OFFICIAL_SKIN_CATALOG_URL) {
            if let Some(oh) = u.host_str() {
                let oh = oh.to_ascii_lowercase();
                if h == oh || h.ends_with(&format!(".{oh}")) {
                    return true;
                }
            }
        }
    }
    false
}

pub fn official_configured() -> bool {
    !OFFICIAL_SKIN_CATALOG_URL.trim().is_empty()
}

/// Check one hop (first or redirect). Does not perform the HTTP request.
pub fn check_hop(raw: &str, policy: &OriginPolicy, resolve: ResolveFn) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "url_blocked: invalid url".to_string())?;
    if url.scheme() != "https" {
        return Err("url_blocked: https required".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("url_blocked: userinfo not allowed".into());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "url_blocked: missing host".to_string())?;
    let host_l = host.to_ascii_lowercase();
    if host_l == "localhost" || host_l.ends_with(".localhost") {
        return Err("url_blocked: localhost".into());
    }
    let ips = resolve(host)?;
    if ips.is_empty() {
        return Err("url_blocked: dns empty".into());
    }
    for ip in &ips {
        if is_blocked_ip(*ip) {
            return Err(format!("url_blocked: private or metadata ip {ip}"));
        }
    }
    match policy {
        OriginPolicy::AnyHttps => {}
        OriginPolicy::Official => {
            if !host_matches_official(host) {
                return Err("url_blocked: host not on official allowlist".into());
            }
        }
        OriginPolicy::UserSameOrigin { catalog } => {
            if url.origin() != catalog.origin() {
                return Err("url_blocked: user source must stay same origin".into());
            }
        }
    }
    Ok(url)
}

fn client_no_redirect() -> Result<reqwest::Client, String> {
    let builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .redirect(Policy::none())
        .user_agent("Grok App");
    crate::proxy::apply_to_reqwest(builder)
        .build()
        .map_err(|e| format!("network: {e}"))
}

/// Fetch bytes with hop-rechecked redirects. Writes optional dest path as a stream.
pub async fn safe_https_get(
    start: &str,
    policy: OriginPolicy,
    max_bytes: u64,
    dest: Option<&std::path::Path>,
) -> Result<Vec<u8>, String> {
    safe_https_get_resolved(start, policy, max_bytes, dest, default_resolve).await
}

pub async fn safe_https_get_resolved(
    start: &str,
    policy: OriginPolicy,
    max_bytes: u64,
    dest: Option<&std::path::Path>,
    resolve: ResolveFn,
) -> Result<Vec<u8>, String> {
    let client = client_no_redirect()?;
    let mut current = check_hop(start, &policy, resolve)?;
    for hop in 0..=MAX_REDIRECTS {
        let resp = client
            .get(current.as_str())
            .send()
            .await
            .map_err(|e| format!("network: {e}"))?;
        let status = resp.status();
        if status.is_redirection() {
            if hop == MAX_REDIRECTS {
                return Err("url_blocked: too many redirects".into());
            }
            let loc = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "url_blocked: redirect without location".to_string())?;
            let next = current
                .join(loc)
                .map_err(|_| "url_blocked: bad redirect".to_string())?;
            current = check_hop(next.as_str(), &policy, resolve)?;
            continue;
        }
        if !status.is_success() {
            return Err(format!("network: http {status}"));
        }
        let mut bytes = Vec::new();
        let mut stream = resp;
        let mut writer = if let Some(p) = dest {
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("disk_budget: {e}"))?;
            }
            Some(
                std::fs::File::create(p).map_err(|e| format!("invalid_pack: write dest: {e}"))?,
            )
        } else {
            None
        };
        use futures_util::StreamExt;
        let mut body = stream.bytes_stream();
        while let Some(chunk) = body.next().await {
            let chunk = chunk.map_err(|e| format!("network: {e}"))?;
            if bytes.len() as u64 + chunk.len() as u64 > max_bytes {
                return Err("too_large: download exceeds limit".into());
            }
            if let Some(w) = writer.as_mut() {
                use std::io::Write;
                w.write_all(&chunk)
                    .map_err(|e| format!("invalid_pack: write: {e}"))?;
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok(bytes);
    }
    Err("url_blocked: too many redirects".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_dns(_: &str) -> Result<Vec<IpAddr>, String> {
        Ok(vec![IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))])
    }

    fn loopback_dns(_: &str) -> Result<Vec<IpAddr>, String> {
        Ok(vec![IpAddr::V4(Ipv4Addr::LOCALHOST)])
    }

    #[test]
    fn reject_http() {
        let e = check_hop("http://skins.example/p.grokskin", &OriginPolicy::AnyHttps, no_dns)
            .unwrap_err();
        assert!(e.contains("https"), "{e}");
    }

    #[test]
    fn reject_userinfo() {
        let e = check_hop(
            "https://user:pass@skins.example/p.grokskin",
            &OriginPolicy::AnyHttps,
            no_dns,
        )
        .unwrap_err();
        assert!(e.contains("userinfo"), "{e}");
    }

    #[test]
    fn reject_loopback_literal() {
        let e = check_hop(
            "https://127.0.0.1/p.grokskin",
            &OriginPolicy::AnyHttps,
            |h| {
                assert_eq!(h, "127.0.0.1");
                Ok(vec![IpAddr::V4(Ipv4Addr::LOCALHOST)])
            },
        )
        .unwrap_err();
        assert!(e.contains("private") || e.contains("url_blocked"), "{e}");
    }

    #[test]
    fn reject_localhost() {
        let e = check_hop("https://localhost/p.grokskin", &OriginPolicy::AnyHttps, no_dns)
            .unwrap_err();
        assert!(e.contains("localhost"), "{e}");
    }

    #[test]
    fn reject_v6_loopback() {
        let e = check_hop(
            "https://[::1]/p.grokskin",
            &OriginPolicy::AnyHttps,
            |_| Ok(vec![IpAddr::V6(Ipv6Addr::LOCALHOST)]),
        )
        .unwrap_err();
        assert!(e.contains("private") || e.contains("url_blocked"), "{e}");
    }

    #[test]
    fn reject_metadata_ip() {
        let e = check_hop(
            "https://169.254.169.254/latest/meta-data",
            &OriginPolicy::AnyHttps,
            |_| Ok(vec![IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254))]),
        )
        .unwrap_err();
        assert!(e.contains("private") || e.contains("url_blocked"), "{e}");
    }

    #[test]
    fn reject_nip_io_when_resolves_loopback() {
        let e = check_hop(
            "https://127.0.0.1.nip.io/p.grokskin",
            &OriginPolicy::AnyHttps,
            loopback_dns,
        )
        .unwrap_err();
        assert!(e.contains("private") || e.contains("url_blocked"), "{e}");
    }

    #[test]
    fn reject_redirect_to_http() {
        let next = check_hop("http://skins.example/x", &OriginPolicy::AnyHttps, no_dns);
        assert!(next.unwrap_err().contains("https"));
    }

    #[test]
    fn reject_redirect_to_private() {
        let e = check_hop(
            "https://10.0.0.5/x",
            &OriginPolicy::AnyHttps,
            |_| Ok(vec![IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5))]),
        )
        .unwrap_err();
        assert!(e.contains("private") || e.contains("url_blocked"), "{e}");
    }

    #[test]
    fn user_source_same_origin() {
        let catalog = Url::parse("https://pages.example/catalog.json").unwrap();
        let policy = OriginPolicy::UserSameOrigin { catalog };
        check_hop(
            "https://pages.example/packs/a.grokskin",
            &policy,
            no_dns,
        )
        .unwrap();
        let e = check_hop(
            "https://cdn.other/a.grokskin",
            &policy,
            no_dns,
        )
        .unwrap_err();
        assert!(e.contains("same origin"), "{e}");
    }

    #[test]
    fn official_off_allowlist() {
        let e = check_hop(
            "https://evil.example/a.grokskin",
            &OriginPolicy::Official,
            no_dns,
        )
        .unwrap_err();
        assert!(e.contains("allowlist"), "{e}");
        check_hop(
            "https://github.com/org/repo/releases/download/x/a.grokskin",
            &OriginPolicy::Official,
            no_dns,
        )
        .unwrap();
    }

    #[test]
    fn official_url_empty() {
        assert_eq!(OFFICIAL_SKIN_CATALOG_URL, "");
        assert!(!official_configured());
    }

    #[test]
    fn source_does_not_name_fetch_media() {
        let src = include_str!("skin_net.rs");
        let prod = src.split("#[cfg(test)]").next().unwrap();
        assert!(!prod.contains("use crate::wallpaper_source"));
        assert!(!prod.contains("wallpaper_source::"));
    }
}
