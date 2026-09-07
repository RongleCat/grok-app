//! Shared `safe_https_get` for catalog, pack download, and `url=` imports.
//!
//! Do not reuse the wallpaper media downloader (different host allowlist).

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::time::Duration;

use hyper::header::{HeaderMap, HeaderValue, USER_AGENT};
use url::Url;

use crate::safe_https_client::{self, SafeHttpsError, SafeHttpsErrorKind};

pub const MAX_REDIRECTS: usize = 3;
pub const REQUEST_TIMEOUT_SECS: u64 = 60;
const DNS_RESOLVE_TIMEOUT: Duration = Duration::from_secs(10);

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

fn validate_hop_url(raw: &str, policy: &OriginPolicy) -> Result<Url, String> {
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

fn validate_resolved_ips(ips: Vec<IpAddr>) -> Result<(), String> {
    if ips.is_empty() {
        return Err("url_blocked: dns empty".into());
    }
    for ip in ips {
        if is_blocked_ip(ip) {
            return Err(format!("url_blocked: private or metadata ip {ip}"));
        }
    }
    Ok(())
}

async fn check_hop_async_with<R, Fut>(
    raw: &str,
    policy: &OriginPolicy,
    timeout: Duration,
    resolve: R,
) -> Result<Url, String>
where
    R: FnOnce(String, u16) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<IpAddr>, String>>,
{
    let url = validate_hop_url(raw, policy)?;
    let host = url
        .host_str()
        .ok_or_else(|| "url_blocked: missing host".to_string())?
        .to_string();
    let port = url.port_or_known_default().unwrap_or(443);
    let ips = tokio::time::timeout(timeout, resolve(host, port))
        .await
        .map_err(|_| "url_blocked: dns timeout".to_string())??;
    validate_resolved_ips(ips)?;
    Ok(url)
}

/// Validate one production fetch hop without blocking a Tokio worker on the
/// operating system resolver. This is a safety preflight, not the transport
/// resolution: the connector resolves and pins locally for direct, CONNECT,
/// and socks5 routes, while an allowlisted socks5h route sends the original
/// hostname to the proxy and cannot claim to observe the proxy's DNS answer.
pub async fn check_hop_async(raw: &str, policy: &OriginPolicy) -> Result<Url, String> {
    let url = validate_hop_url(raw, policy)?;
    if safe_https_client::remote_dns_preflight_allowed(&url) {
        return Ok(url);
    }
    check_hop_async_with(raw, policy, DNS_RESOLVE_TIMEOUT, |host, port| async move {
        tokio::net::lookup_host((host.as_str(), port))
            .await
            .map(|addresses| addresses.map(|address| address.ip()).collect())
            .map_err(|error| format!("url_blocked: dns {error}"))
    })
    .await
}

pub fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_blocked_v4(v4),
        IpAddr::V6(v6) => is_blocked_v6(v6),
    }
}

fn is_blocked_v4(v4: Ipv4Addr) -> bool {
    let [first, second, third, fourth] = v4.octets();
    first == 0
        || v4.is_loopback()
        || v4.is_private()
        || v4.is_link_local()
        || v4.is_unspecified()
        || v4.is_broadcast()
        || v4.is_documentation()
        || v4.is_multicast()
        || (first == 100 && (64..=127).contains(&second))
        || (first == 192 && second == 0 && third == 0 && !matches!(fourth, 9 | 10))
        || (first == 192 && second == 88 && third == 99)
        || (first == 198 && (second == 18 || second == 19))
        || first >= 240
}

fn is_blocked_v6(v6: Ipv6Addr) -> bool {
    if let Some(v4) = v6.to_ipv4_mapped() {
        return is_blocked_v4(v4);
    }
    let segments = v6.segments();
    let is_global_unicast = segments[0] & 0xe000 == 0x2000;
    let ietf_special = is_non_global_ietf_protocol_assignment(v6);
    let documentation = segments[0] == 0x2001 && segments[1] == 0x0db8;
    let six_to_four = segments[0] == 0x2002;
    let documentation_v2 = segments[0] == 0x3fff;

    v6.is_loopback()
        || v6.is_unspecified()
        || v6.is_multicast()
        || is_ula(v6)
        || is_link_local_v6(v6)
        || !is_global_unicast
        || ietf_special
        || documentation
        || six_to_four
        || documentation_v2
}

fn is_non_global_ietf_protocol_assignment(v6: Ipv6Addr) -> bool {
    let segments = v6.segments();
    if segments[0] != 0x2001 || segments[1] > 0x01ff {
        return false;
    }

    let is_port_control = segments[1] == 0x0001
        && segments[2..7].iter().all(|segment| *segment == 0)
        && matches!(segments[7], 1 | 2);
    let is_amt = segments[1] == 0x0003;
    let is_as112 = segments[1] == 0x0004 && segments[2] == 0x0112;
    let is_orchid_v2 = (0x0020..=0x002f).contains(&segments[1]);
    let is_drone_remote_id = (0x0030..=0x003f).contains(&segments[1]);

    !(is_port_control || is_amt || is_as112 || is_orchid_v2 || is_drone_remote_id)
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
    let url = validate_hop_url(raw, policy)?;
    let host = url
        .host_str()
        .ok_or_else(|| "url_blocked: missing host".to_string())?;
    let ips = resolve(host)?;
    validate_resolved_ips(ips)?;
    Ok(url)
}

fn transport_error(error: SafeHttpsError) -> String {
    match error.kind() {
        SafeHttpsErrorKind::Blocked => "url_blocked: destination rejected".into(),
        SafeHttpsErrorKind::Timeout => "network: timeout".into(),
        SafeHttpsErrorKind::Network => "network: request failed".into(),
    }
}

/// Fetch bytes with hop-rechecked redirects. Writes optional dest path as a stream.
pub async fn safe_https_get(
    start: &str,
    policy: OriginPolicy,
    max_bytes: u64,
    dest: Option<&std::path::Path>,
) -> Result<Vec<u8>, String> {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("Grok App"));
    let client = safe_https_client::shared();
    let mut current = check_hop_async(start, &policy).await?;
    for hop in 0..=MAX_REDIRECTS {
        let mut resp = client
            .get(
                &current,
                headers.clone(),
                Duration::from_secs(REQUEST_TIMEOUT_SECS),
            )
            .await
            .map_err(transport_error)?;
        let status = resp.status();
        if status.is_redirection() {
            if hop == MAX_REDIRECTS {
                return Err("url_blocked: too many redirects".into());
            }
            let loc = resp
                .headers()
                .get(hyper::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "url_blocked: redirect without location".to_string())?;
            let next = current
                .join(loc)
                .map_err(|_| "url_blocked: bad redirect".to_string())?;
            current = check_hop_async(next.as_str(), &policy).await?;
            continue;
        }
        if !status.is_success() {
            return Err(format!("network: http {status}"));
        }
        let content_length = resp.content_length();
        if content_length.is_some_and(|length| length > max_bytes) {
            return Err("too_large: download exceeds limit".into());
        }
        let mut bytes = Vec::new();
        let mut writer = if let Some(p) = dest {
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("disk_budget: {e}"))?;
            }
            Some(std::fs::File::create(p).map_err(|e| format!("invalid_pack: write dest: {e}"))?)
        } else {
            None
        };
        while let Some(chunk) = resp.chunk().await.map_err(transport_error)? {
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
        let e = check_hop(
            "http://skins.example/p.grokskin",
            &OriginPolicy::AnyHttps,
            no_dns,
        )
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
        let e = check_hop(
            "https://localhost/p.grokskin",
            &OriginPolicy::AnyHttps,
            no_dns,
        )
        .unwrap_err();
        assert!(e.contains("localhost"), "{e}");
    }

    #[test]
    fn reject_v6_loopback() {
        let e = check_hop("https://[::1]/p.grokskin", &OriginPolicy::AnyHttps, |_| {
            Ok(vec![IpAddr::V6(Ipv6Addr::LOCALHOST)])
        })
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
        let e = check_hop("https://10.0.0.5/x", &OriginPolicy::AnyHttps, |_| {
            Ok(vec![IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5))])
        })
        .unwrap_err();
        assert!(e.contains("private") || e.contains("url_blocked"), "{e}");
    }

    #[test]
    fn user_source_same_origin() {
        let catalog = Url::parse("https://pages.example/catalog.json").unwrap();
        let policy = OriginPolicy::UserSameOrigin { catalog };
        check_hop("https://pages.example/packs/a.grokskin", &policy, no_dns).unwrap();
        let e = check_hop("https://cdn.other/a.grokskin", &policy, no_dns).unwrap_err();
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

    #[tokio::test]
    async fn async_hop_resolution_times_out() {
        let error = check_hop_async_with(
            "https://skins.example/p.grokskin",
            &OriginPolicy::AnyHttps,
            Duration::from_millis(10),
            |_, _| async { std::future::pending::<Result<Vec<IpAddr>, String>>().await },
        )
        .await
        .unwrap_err();

        assert_eq!(error, "url_blocked: dns timeout");
    }

    #[tokio::test]
    async fn async_hop_rejects_any_non_global_resolved_address() {
        let error = check_hop_async_with(
            "https://skins.example/p.grokskin",
            &OriginPolicy::AnyHttps,
            Duration::from_secs(1),
            |_, _| async {
                Ok(vec![
                    IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)),
                    IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1)),
                ])
            },
        )
        .await
        .unwrap_err();

        assert!(error.contains("private or metadata ip"), "{error}");
    }

    #[test]
    fn blocks_non_global_ipv4_ranges() {
        for raw in [
            "0.1.2.3",
            "100.64.0.1",
            "100.127.255.254",
            "192.0.0.8",
            "192.88.99.1",
            "198.18.0.1",
            "198.19.255.254",
            "224.0.0.1",
            "239.255.255.250",
            "240.0.0.1",
        ] {
            assert!(is_blocked_ip(raw.parse().unwrap()), "{raw}");
        }
        assert!(!is_blocked_ip("1.1.1.1".parse().unwrap()));
        assert!(!is_blocked_ip("8.8.8.8".parse().unwrap()));
        assert!(!is_blocked_ip("192.0.0.9".parse().unwrap()));
        assert!(!is_blocked_ip("192.0.0.10".parse().unwrap()));
    }

    #[test]
    fn blocks_non_global_ipv6_ranges() {
        for raw in [
            "::2",
            "64:ff9b::1",
            "100::1",
            "2001::1",
            "2001:2::1",
            "2001:db8::1",
            "2002::1",
            "3fff::1",
            "fc00::1",
            "fe80::1",
            "ff02::1",
        ] {
            assert!(is_blocked_ip(raw.parse().unwrap()), "{raw}");
        }
        assert!(!is_blocked_ip("2001:4860:4860::8888".parse().unwrap()));
        assert!(!is_blocked_ip("2606:4700:4700::1111".parse().unwrap()));
    }

    #[test]
    fn allows_global_exceptions_inside_ietf_protocol_assignments() {
        for raw in [
            "2001:1::1",
            "2001:1::2",
            "2001:3::1",
            "2001:4:112::1",
            "2001:20::1",
            "2001:2f::1",
            "2001:30::1",
            "2001:3f::1",
            "2001:200::1",
        ] {
            assert!(!is_blocked_ip(raw.parse().unwrap()), "{raw}");
        }
    }

    #[test]
    fn blocks_non_global_neighbors_of_ietf_exceptions() {
        for raw in [
            "2001:1::",
            "2001:1::3",
            "2001:2::1",
            "2001:4:111::1",
            "2001:4:113::1",
            "2001:1f::1",
            "2001:40::1",
            "2001:1ff::1",
        ] {
            assert!(is_blocked_ip(raw.parse().unwrap()), "{raw}");
        }
    }

    #[test]
    fn mapped_ipv6_uses_ipv4_classification() {
        assert!(is_blocked_ip("::ffff:100.64.0.1".parse().unwrap()));
        assert!(!is_blocked_ip("::ffff:1.1.1.1".parse().unwrap()));
    }
}
