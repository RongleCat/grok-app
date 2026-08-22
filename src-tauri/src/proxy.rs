//! Outbound proxy resolution (NEW-02).
//!
//! Single source of truth for how the app and every child process reach the
//! network. Three modes (Settings → `proxy_mode`):
//!
//! - `system` (default): honor the OS proxy. On Windows the system proxy lives
//!   in the WinINET registry and is **not** exported as env vars, so GUI-spawned
//!   children (grok CLI, login, updaters) would silently bypass it — we read the
//!   registry and inject `HTTP_PROXY`/`HTTPS_PROXY` ourselves. On macOS we ask
//!   `scutil --proxy`. Plain env vars win when already present.
//!
//!   Also handles **PAC-only** setups (Clash / Surge "enhanced mode" often sets
//!   `ProxyAutoConfigEnable` without HTTPEnable). We fetch loopback PAC URLs and
//!   extract the first `PROXY` / `SOCKS5` endpoint so children get real env vars
//!   without requiring TUN mode.
//! - `manual`: use `proxy_url` from Settings verbatim.
//! - `none`: force direct — children get proxy env vars stripped.
//!
//! Never log credentials: URLs are redacted to `scheme://host:port` via
//! [`redact_proxy_url`] before any tracing output.

use std::process::Command as StdCommand;

use tokio::process::Command as TokioCommand;

/// Resolved proxy decision for the current settings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProxyDecision {
    /// Inherit whatever the process env already has (no injection).
    Inherit,
    /// Force-direct: strip proxy env vars from children, disable in reqwest.
    Direct,
    /// Use this proxy URL (inject into children, configure reqwest).
    Use {
        url: String,
        no_proxy: Option<String>,
    },
}

/// Where the effective proxy URL came from (for probe honesty / diagnostics).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProxySource {
    /// Settings `none`.
    Direct,
    /// Settings `manual` with a valid URL.
    Manual,
    /// Process already has HTTP(S)_PROXY / ALL_PROXY.
    Env,
    /// OS static HTTP/HTTPS proxy.
    SystemHttp,
    /// OS static SOCKS proxy (no HTTP).
    /// Linux resolves neither static system proxies nor PAC; the variants stay
    /// for the Windows/macOS resolvers and their unit tests.
    #[cfg_attr(target_os = "linux", allow(dead_code))]
    SystemSocks,
    /// PAC file resolved to a concrete endpoint.
    #[cfg_attr(target_os = "linux", allow(dead_code))]
    SystemPac,
    /// No proxy configured / unresolvable — inherit OS defaults.
    None,
}

/// Full resolution: decision + provenance (never includes credentials in logs).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProxyResolution {
    pub decision: ProxyDecision,
    pub source: ProxySource,
}

/// Env var names children understand (both cases for maximum tool coverage).
const PROXY_ENV_KEYS: &[&str] = &[
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
];

const NO_PROXY_ENV_KEYS: &[&str] = &["NO_PROXY", "no_proxy"];

/// Redact userinfo from a proxy URL for logs: `http://u:p@h:1` → `http://h:1`.
pub fn redact_proxy_url(url: &str) -> String {
    match url::Url::parse(url) {
        Ok(u) => {
            let host = u.host_str().unwrap_or("?");
            match u.port() {
                Some(p) => format!("{}://{}:{}", u.scheme(), host, p),
                None => format!("{}://{}", u.scheme(), host),
            }
        }
        Err(_) => "<unparseable-proxy-url>".into(),
    }
}

/// Basic sanity check for a user-entered proxy URL.
pub fn is_valid_proxy_url(url: &str) -> bool {
    match url::Url::parse(url.trim()) {
        Ok(u) => {
            matches!(u.scheme(), "http" | "https" | "socks5" | "socks5h") && u.host_str().is_some()
        }
        Err(_) => false,
    }
}

/// True when any proxy env var is already set on this process.
fn env_proxy_present() -> bool {
    PROXY_ENV_KEYS.iter().any(|k| {
        std::env::var(k)
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false)
    })
}

/// True when a host is loopback (safe to fetch PAC without going through a proxy).
#[cfg_attr(target_os = "linux", allow(dead_code))] // PAC fetch is Windows/macOS only
fn is_loopback_host(host: &str) -> bool {
    let h = host.trim().trim_matches(['[', ']']).to_ascii_lowercase();
    h == "localhost" || h == "127.0.0.1" || h == "::1" || h == "0.0.0.0"
}

/// Extract the first usable proxy endpoint from a PAC script body.
///
/// Clash / Surge enhanced-mode PAC typically returns strings like:
/// `PROXY 127.0.0.1:7890; SOCKS5 127.0.0.1:7890; DIRECT`
/// Prefer HTTP `PROXY` over SOCKS (broader child-tool support).
#[cfg_attr(target_os = "linux", allow(dead_code))] // PAC parse is Windows/macOS only
pub fn first_proxy_from_pac(pac_body: &str) -> Option<String> {
    // Scan tokens case-insensitively; PAC is small.
    let upper = pac_body.to_ascii_uppercase();
    let prefer = ["PROXY ", "SOCKS5 ", "SOCKS "];
    let mut best: Option<(usize, String)> = None;
    for (rank, prefix) in prefer.iter().enumerate() {
        let mut search_from = 0;
        while let Some(rel) = upper[search_from..].find(prefix) {
            let abs = search_from + rel + prefix.len();
            let rest = pac_body.get(abs..).unwrap_or("");
            let end = rest
                .find([';', '"', '\'', '\n', '\r'])
                .unwrap_or(rest.len());
            let addr = rest[..end].trim();
            if addr.is_empty() || addr.eq_ignore_ascii_case("DIRECT") {
                search_from = abs;
                continue;
            }
            // Strip optional scheme if PAC already includes it.
            let url = if addr.contains("://") {
                addr.to_string()
            } else if *prefix == "PROXY " {
                format!("http://{addr}")
            } else {
                // socks5h: resolve DNS via the proxy (needed when only TUN
                // previously "fixed" DNS for blocked domains).
                format!("socks5h://{addr}")
            };
            if is_valid_proxy_url(&url) {
                let candidate = (rank, url);
                if best.as_ref().map(|(r, _)| *r).unwrap_or(usize::MAX) > rank {
                    best = Some(candidate);
                }
                // First match at this rank is enough; keep scanning only if
                // we still need a better (lower) rank — break early for PROXY.
                if rank == 0 {
                    return best.map(|(_, u)| u);
                }
            }
            search_from = abs;
        }
    }
    best.map(|(_, u)| u)
}

/// Fetch a PAC document when the URL points at loopback (or is a local file).
/// Non-loopback PAC is intentionally ignored — evaluating remote PAC without a
/// working network is chicken-and-egg, and we refuse to open arbitrary hosts.
#[cfg_attr(target_os = "linux", allow(dead_code))] // PAC fetch is Windows/macOS only
fn fetch_pac_body(pac_url: &str) -> Option<String> {
    let pac_url = pac_url.trim();
    if pac_url.is_empty() {
        return None;
    }
    if let Some(path) = pac_url.strip_prefix("file://") {
        // file:///Users/... or file://localhost/Users/...
        let path = path.trim_start_matches("localhost");
        return std::fs::read_to_string(path).ok();
    }
    let parsed = url::Url::parse(pac_url).ok()?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return None;
    }
    let host = parsed.host_str()?;
    if !is_loopback_host(host) {
        tracing::debug!(
            "proxy: PAC URL host is not loopback ({}); skip auto-resolve",
            host
        );
        return None;
    }
    // Blocking fetch — only called from system_proxy resolution on spawn/probe
    // paths that already tolerate short sync work. No proxy for loopback PAC.
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .no_proxy()
        .build()
        .ok()?;
    let resp = client.get(pac_url).send().ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.text().ok()
}

/// Result of reading the OS proxy configuration.
#[derive(Debug, Clone, Default)]
struct SystemProxyInfo {
    /// Concrete proxy URL if resolvable.
    url: Option<String>,
    source: Option<ProxySource>,
    /// OS bypass list (comma-separated hosts / patterns).
    exceptions: Option<String>,
    /// PAC was enabled but could not be resolved to a static URL.
    pac_unresolved: bool,
}

/// Windows: read the WinINET proxy (`HKCU\...\Internet Settings`).
#[cfg(windows)]
fn read_system_proxy() -> SystemProxyInfo {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let mut info = SystemProxyInfo::default();
    let key = match RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
    {
        Ok(k) => k,
        Err(_) => return info,
    };

    // ProxyOverride → NO_PROXY style list (semicolons → commas).
    if let Ok(override_list) = key.get_value::<String, _>("ProxyOverride") {
        let cleaned = override_list
            .split(';')
            .map(str::trim)
            .filter(|s| !s.is_empty() && *s != "<local>")
            .collect::<Vec<_>>()
            .join(",");
        if !cleaned.is_empty() {
            info.exceptions = Some(cleaned);
        }
    }

    let enabled: u32 = key.get_value("ProxyEnable").unwrap_or(0);
    if enabled != 0 {
        if let Ok(server) = key.get_value::<String, _>("ProxyServer") {
            let server = server.trim();
            if !server.is_empty() {
                // Formats: "host:port" or "http=host:port;https=host:port;…"
                // or "socks=host:port".
                if server.contains('=') {
                    let mut http_entry = None;
                    let mut socks_entry = None;
                    for part in server.split(';') {
                        let mut kv = part.splitn(2, '=');
                        let scheme = kv.next().unwrap_or("").trim().to_ascii_lowercase();
                        let addr = kv.next().unwrap_or("").trim();
                        if addr.is_empty() {
                            continue;
                        }
                        if scheme == "https" {
                            info.url = Some(format!("http://{addr}"));
                            info.source = Some(ProxySource::SystemHttp);
                            return info;
                        }
                        if scheme == "http" {
                            http_entry = Some(format!("http://{addr}"));
                        }
                        if scheme == "socks" || scheme == "socks5" {
                            socks_entry = Some(format!("socks5h://{addr}"));
                        }
                    }
                    if let Some(u) = http_entry {
                        info.url = Some(u);
                        info.source = Some(ProxySource::SystemHttp);
                        return info;
                    }
                    if let Some(u) = socks_entry {
                        info.url = Some(u);
                        info.source = Some(ProxySource::SystemSocks);
                        return info;
                    }
                } else {
                    info.url = Some(format!("http://{server}"));
                    info.source = Some(ProxySource::SystemHttp);
                    return info;
                }
            }
        }
    }

    // PAC / AutoConfigURL (often set when ProxyEnable=0, e.g. Clash enhanced).
    if let Ok(pac_url) = key.get_value::<String, _>("AutoConfigURL") {
        let pac_url = pac_url.trim();
        if !pac_url.is_empty() {
            if let Some(body) = fetch_pac_body(pac_url) {
                if let Some(url) = first_proxy_from_pac(&body) {
                    info.url = Some(url);
                    info.source = Some(ProxySource::SystemPac);
                    return info;
                }
            }
            info.pac_unresolved = true;
            tracing::warn!(
                "proxy: Windows AutoConfigURL set but PAC could not be resolved to a static proxy (TUN or Manual URL may be required)"
            );
        }
    }

    info
}

/// macOS: `scutil --proxy` (GUI apps see no proxy env vars; the system proxy
/// lives in SystemConfiguration). Supports static HTTP/HTTPS/SOCKS and PAC.
#[cfg(target_os = "macos")]
fn read_system_proxy() -> SystemProxyInfo {
    let mut info = SystemProxyInfo::default();
    let out = match StdCommand::new("scutil").arg("--proxy").output() {
        Ok(o) if o.status.success() => o,
        _ => return info,
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut map = std::collections::HashMap::new();
    let mut exceptions: Vec<String> = Vec::new();
    let mut in_exceptions = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with("ExceptionsList") {
            in_exceptions = true;
            continue;
        }
        if in_exceptions {
            // Entries look like: `0 : localhost` or closing `}`
            if line.starts_with('}') {
                in_exceptions = false;
                continue;
            }
            if let Some((_, v)) = line.split_once(" : ") {
                let v = v.trim();
                if !v.is_empty() {
                    // scutil may list comma-joined patterns in one entry.
                    for part in v.split(',') {
                        let p = part.trim();
                        if !p.is_empty() {
                            exceptions.push(p.to_string());
                        }
                    }
                }
            }
            continue;
        }
        if let Some((k, v)) = line.split_once(" : ") {
            map.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    if !exceptions.is_empty() {
        info.exceptions = Some(exceptions.join(","));
    }

    let pick_http = |enable_key: &str, host_key: &str, port_key: &str| -> Option<String> {
        if map.get(enable_key).map(String::as_str) != Some("1") {
            return None;
        }
        let host = map.get(host_key)?;
        let port = map.get(port_key)?;
        Some(format!("http://{host}:{port}"))
    };
    if let Some(url) = pick_http("HTTPSEnable", "HTTPSProxy", "HTTPSPort")
        .or_else(|| pick_http("HTTPEnable", "HTTPProxy", "HTTPPort"))
    {
        info.url = Some(url);
        info.source = Some(ProxySource::SystemHttp);
        return info;
    }
    if map.get("SOCKSEnable").map(String::as_str) == Some("1") {
        if let (Some(host), Some(port)) = (map.get("SOCKSProxy"), map.get("SOCKSPort")) {
            // socks5h: DNS through proxy so blocked domains resolve.
            info.url = Some(format!("socks5h://{host}:{port}"));
            info.source = Some(ProxySource::SystemSocks);
            return info;
        }
    }

    // PAC-only (ClashX / Surge enhanced mode).
    if map.get("ProxyAutoConfigEnable").map(String::as_str) == Some("1") {
        if let Some(pac_url) = map.get("ProxyAutoConfigURLString") {
            if let Some(body) = fetch_pac_body(pac_url) {
                if let Some(url) = first_proxy_from_pac(&body) {
                    info.url = Some(url);
                    info.source = Some(ProxySource::SystemPac);
                    return info;
                }
            }
            info.pac_unresolved = true;
            tracing::warn!(
                "proxy: macOS PAC enabled ({}) but could not resolve a static proxy — set Manual URL or enable HTTP system proxy; TUN is a last resort",
                pac_url
            );
        }
    }

    info
}

/// Linux and others: env vars are the convention; nothing extra to read.
#[cfg(not(any(windows, target_os = "macos")))]
fn read_system_proxy() -> SystemProxyInfo {
    SystemProxyInfo::default()
}

/// Full resolution with provenance (for probes and diagnostics).
pub fn resolve() -> ProxyResolution {
    let settings = crate::store::load_settings();
    resolve_from(
        &settings.proxy_mode,
        settings.proxy_url.as_deref(),
        settings.proxy_no_proxy.as_deref(),
    )
}

/// Resolve the proxy decision from persisted settings.
#[inline]
pub fn decision() -> ProxyDecision {
    resolve().decision
}

/// Pure resolution used by tests and callers that only need [`ProxyDecision`]
/// (system OS reads are live when mode is `system`).
#[inline]
#[cfg_attr(not(test), allow(dead_code))]
pub fn decision_from(
    mode: &str,
    manual_url: Option<&str>,
    no_proxy: Option<&str>,
) -> ProxyDecision {
    resolve_from(mode, manual_url, no_proxy).decision
}

/// Resolve decision + source. System mode may read OS proxy / PAC.
pub fn resolve_from(
    mode: &str,
    manual_url: Option<&str>,
    no_proxy: Option<&str>,
) -> ProxyResolution {
    let user_no_proxy = no_proxy
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    match mode.trim().to_ascii_lowercase().as_str() {
        "none" => ProxyResolution {
            decision: ProxyDecision::Direct,
            source: ProxySource::Direct,
        },
        "manual" => {
            let url = manual_url.map(str::trim).unwrap_or("");
            if is_valid_proxy_url(url) {
                ProxyResolution {
                    decision: ProxyDecision::Use {
                        url: url.to_string(),
                        no_proxy: user_no_proxy,
                    },
                    source: ProxySource::Manual,
                }
            } else {
                // Misconfigured manual proxy: fall back to inherit rather than
                // silently going direct — env vars may still be correct.
                tracing::warn!("proxy: manual mode with invalid url; inheriting env");
                ProxyResolution {
                    decision: ProxyDecision::Inherit,
                    source: ProxySource::None,
                }
            }
        }
        // "system" and anything unknown.
        _ => {
            if env_proxy_present() {
                // Env already routes traffic (bat-file style launches keep working).
                return ProxyResolution {
                    decision: ProxyDecision::Inherit,
                    source: ProxySource::Env,
                };
            }
            let sys = read_system_proxy();
            match sys.url {
                Some(url) => {
                    let merged_np =
                        merge_optional_lists(user_no_proxy.as_deref(), sys.exceptions.as_deref());
                    ProxyResolution {
                        decision: ProxyDecision::Use {
                            url,
                            no_proxy: merged_np,
                        },
                        source: sys.source.unwrap_or(ProxySource::SystemHttp),
                    }
                }
                None => {
                    if sys.pac_unresolved {
                        tracing::warn!(
                            "proxy: system mode has PAC but no resolvable endpoint; traffic may go direct unless TUN is on"
                        );
                    }
                    ProxyResolution {
                        decision: ProxyDecision::Inherit,
                        source: ProxySource::None,
                    }
                }
            }
        }
    }
}

fn merge_optional_lists(a: Option<&str>, b: Option<&str>) -> Option<String> {
    match (a, b) {
        (None, None) => None,
        (Some(x), None) | (None, Some(x)) => {
            let t = x.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        (Some(x), Some(y)) => {
            let mut parts: Vec<&str> = Vec::new();
            for s in x.split(',').chain(y.split(',')) {
                let t = s.trim();
                if !t.is_empty() && !parts.iter().any(|p| p.eq_ignore_ascii_case(t)) {
                    parts.push(t);
                }
            }
            if parts.is_empty() {
                None
            } else {
                Some(parts.join(","))
            }
        }
    }
}

/// Loopback names that must never route through a proxy (mirror, local RPC).
const LOCAL_BYPASS: &str = "localhost,127.0.0.1,::1";

/// User no-proxy list merged with the always-on loopback bypass.
fn merged_no_proxy(no_proxy: Option<&str>) -> String {
    match no_proxy {
        Some(np) if !np.trim().is_empty() => format!("{LOCAL_BYPASS},{}", np.trim()),
        _ => LOCAL_BYPASS.to_string(),
    }
}

/// Env pairs to inject into a child process for the given decision.
/// `Direct` yields empty values (explicit unset happens in the apply fns).
pub fn child_env_pairs(dec: &ProxyDecision) -> Vec<(String, String)> {
    match dec {
        ProxyDecision::Inherit => Vec::new(),
        ProxyDecision::Direct => Vec::new(),
        ProxyDecision::Use { url, no_proxy } => {
            let mut pairs: Vec<(String, String)> = PROXY_ENV_KEYS
                .iter()
                .map(|k| (k.to_string(), url.clone()))
                .collect();
            let np = merged_no_proxy(no_proxy.as_deref());
            pairs.push(("NO_PROXY".into(), np.clone()));
            pairs.push(("no_proxy".into(), np));
            pairs
        }
    }
}

fn strip_proxy_env_tokio(cmd: &mut TokioCommand) {
    for k in PROXY_ENV_KEYS.iter().chain(NO_PROXY_ENV_KEYS.iter()) {
        cmd.env_remove(k);
    }
}

fn strip_proxy_env_std(cmd: &mut StdCommand) {
    for k in PROXY_ENV_KEYS.iter().chain(NO_PROXY_ENV_KEYS.iter()) {
        cmd.env_remove(k);
    }
}

/// Apply the current proxy decision to a tokio child command (agent spawn, login).
pub fn apply_to_tokio_command(cmd: &mut TokioCommand) {
    let res = resolve();
    match &res.decision {
        ProxyDecision::Inherit => {}
        ProxyDecision::Direct => {
            strip_proxy_env_tokio(cmd);
        }
        ProxyDecision::Use { url, .. } => {
            tracing::info!(
                "proxy: child uses {} (source={:?})",
                redact_proxy_url(url),
                res.source
            );
            for (k, v) in child_env_pairs(&res.decision) {
                cmd.env(k, v);
            }
        }
    }
}

/// Apply the current proxy decision to a std child command (probes, updaters).
pub fn apply_to_std_command(cmd: &mut StdCommand) {
    let res = resolve();
    match &res.decision {
        ProxyDecision::Inherit => {}
        ProxyDecision::Direct => {
            strip_proxy_env_std(cmd);
        }
        ProxyDecision::Use { url, .. } => {
            tracing::info!(
                "proxy: child uses {} (source={:?})",
                redact_proxy_url(url),
                res.source
            );
            for (k, v) in child_env_pairs(&res.decision) {
                cmd.env(k, v);
            }
        }
    }
}

fn configure_proxy_on_builder<B>(
    builder: B,
    set_no_proxy: impl FnOnce(B) -> B,
    set_proxy: impl FnOnce(B, reqwest::Proxy) -> B,
) -> B {
    match resolve().decision {
        ProxyDecision::Inherit => builder,
        ProxyDecision::Direct => set_no_proxy(builder),
        ProxyDecision::Use { url, no_proxy } => match reqwest::Proxy::all(&url) {
            Ok(mut p) => {
                p = p.no_proxy(reqwest::NoProxy::from_string(&merged_no_proxy(
                    no_proxy.as_deref(),
                )));
                set_proxy(builder, p)
            }
            Err(e) => {
                tracing::warn!(
                    "proxy: invalid proxy {} ({e}); using default routing",
                    redact_proxy_url(&url)
                );
                builder
            }
        },
    }
}

/// Configure a reqwest (async) builder for the current proxy decision.
/// With the `system-proxy` feature reqwest already honors OS proxies in
/// `Inherit` mode; `Direct` disables proxying; `Use` pins the explicit URL.
pub fn apply_to_reqwest(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    configure_proxy_on_builder(builder, |b| b.no_proxy(), |b, p| b.proxy(p))
}

/// Same as [`apply_to_reqwest`] for `reqwest::blocking::ClientBuilder`.
pub fn apply_to_reqwest_blocking(
    builder: reqwest::blocking::ClientBuilder,
) -> reqwest::blocking::ClientBuilder {
    configure_proxy_on_builder(builder, |b| b.no_proxy(), |b, p| b.proxy(p))
}

/// JSON-friendly snapshot of the effective proxy (credentials redacted).
/// Used by `network_probe` so Settings can show what path is actually active.
pub fn effective_snapshot() -> serde_json::Value {
    let res = resolve();
    // Keep `decision()` reachable for API symmetry / external call sites.
    debug_assert_eq!(decision(), res.decision);
    let (decision_label, url) = match &res.decision {
        ProxyDecision::Inherit => ("inherit", None),
        ProxyDecision::Direct => ("direct", None),
        ProxyDecision::Use { url, .. } => ("use", Some(redact_proxy_url(url))),
    };
    let source = match res.source {
        ProxySource::Direct => "direct",
        ProxySource::Manual => "manual",
        ProxySource::Env => "env",
        ProxySource::SystemHttp => "system_http",
        ProxySource::SystemSocks => "system_socks",
        ProxySource::SystemPac => "system_pac",
        ProxySource::None => "none",
    };
    serde_json::json!({
        "decision": decision_label,
        "source": source,
        "url": url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manual_mode_uses_valid_url() {
        let d = decision_from("manual", Some("http://127.0.0.1:7890"), None);
        assert_eq!(
            d,
            ProxyDecision::Use {
                url: "http://127.0.0.1:7890".into(),
                no_proxy: None
            }
        );
    }

    #[test]
    fn manual_mode_with_bad_url_inherits() {
        assert_eq!(
            decision_from("manual", Some("not a url"), None),
            ProxyDecision::Inherit
        );
        assert_eq!(decision_from("manual", None, None), ProxyDecision::Inherit);
        // ftp / file schemes are rejected.
        assert_eq!(
            decision_from("manual", Some("file:///etc/passwd"), None),
            ProxyDecision::Inherit
        );
    }

    #[test]
    fn none_mode_forces_direct() {
        assert_eq!(
            decision_from("none", Some("http://127.0.0.1:1"), None),
            ProxyDecision::Direct
        );
    }

    #[test]
    fn no_proxy_list_is_propagated() {
        let d = decision_from(
            "manual",
            Some("http://127.0.0.1:7890"),
            Some("localhost,127.0.0.1"),
        );
        let pairs = child_env_pairs(&d);
        assert!(pairs
            .iter()
            .any(|(k, v)| k == "HTTPS_PROXY" && v == "http://127.0.0.1:7890"));
        assert!(pairs
            .iter()
            .any(|(k, v)| k == "NO_PROXY" && v == "localhost,127.0.0.1,::1,localhost,127.0.0.1"));
    }

    #[test]
    fn redacts_credentials_from_logs() {
        assert_eq!(
            redact_proxy_url("http://user:secret@127.0.0.1:7890"),
            "http://127.0.0.1:7890"
        );
        assert_eq!(redact_proxy_url("socks5://host"), "socks5://host");
        assert_eq!(redact_proxy_url("::::"), "<unparseable-proxy-url>");
    }

    #[test]
    fn validates_proxy_urls() {
        assert!(is_valid_proxy_url("http://127.0.0.1:7890"));
        assert!(is_valid_proxy_url("socks5://127.0.0.1:1080"));
        assert!(is_valid_proxy_url("socks5h://127.0.0.1:1080"));
        assert!(!is_valid_proxy_url("127.0.0.1:7890")); // scheme required
        assert!(!is_valid_proxy_url("ftp://x"));
        assert!(!is_valid_proxy_url(""));
    }

    #[test]
    fn pac_prefers_http_proxy_over_socks() {
        let pac = r#"
            function FindProxyForURL(url, host) {
                return "PROXY 127.0.0.1:7890; SOCKS5 127.0.0.1:7891; DIRECT";
            }
        "#;
        assert_eq!(
            first_proxy_from_pac(pac).as_deref(),
            Some("http://127.0.0.1:7890")
        );
    }

    #[test]
    fn pac_socks_only_uses_socks5h() {
        let pac = r#"return "SOCKS5 127.0.0.1:1080; DIRECT";"#;
        assert_eq!(
            first_proxy_from_pac(pac).as_deref(),
            Some("socks5h://127.0.0.1:1080")
        );
    }

    #[test]
    fn pac_ignores_direct_only() {
        assert_eq!(first_proxy_from_pac(r#"return "DIRECT";"#), None);
    }

    #[test]
    fn merge_optional_lists_dedupes() {
        assert_eq!(
            merge_optional_lists(Some("a,b"), Some("b,c")).as_deref(),
            Some("a,b,c")
        );
    }
}
