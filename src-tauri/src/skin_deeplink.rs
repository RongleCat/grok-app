//! `grok://` / `grok-app://` parse + last-write-wins pending import slot.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

pub const SKIN_IMPORT_EVENT: &str = "skin://import-pending";
pub const SKIN_IMPORT_URI_MAX: usize = 2048;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PendingSkinImport {
    Url { href: String },
    File { path: String },
    Official { id: String },
}

pub struct PendingSlot(pub Mutex<Option<PendingSkinImport>>);

impl Default for PendingSlot {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArgvIngest {
    FireDue,
    Pending,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseResult {
    Url(String),
    Official(String),
    Err(&'static str),
}

fn percent_decode_once(raw: &str) -> Option<String> {
    let mut out = String::new();
    let b = raw.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            if i + 2 >= b.len() {
                return None;
            }
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).ok()?;
            let n = u8::from_str_radix(hex, 16).ok()?;
            out.push(n as char);
            i += 3;
        } else {
            out.push(b[i] as char);
            i += 1;
        }
    }
    Some(out)
}

fn has_c0(s: &str) -> bool {
    s.chars().any(|c| (c as u32) < 0x20 || c == '\u{7f}')
}

fn parse_query(qs: &str) -> Result<Vec<(String, String)>, &'static str> {
    let mut out = Vec::new();
    if qs.is_empty() {
        return Ok(out);
    }
    for part in qs.split('&') {
        if part.is_empty() {
            continue;
        }
        let (k, v) = match part.split_once('=') {
            Some((k, v)) => (k, v),
            None => (part, ""),
        };
        let k = percent_decode_once(k).ok_or("bad_percent")?;
        let v = percent_decode_once(v).ok_or("bad_percent")?;
        if has_c0(&k) || has_c0(&v) {
            return Err("control");
        }
        if out.iter().any(|(ek, _)| ek == &k) {
            return Err("duplicate");
        }
        out.push((k, v));
    }
    Ok(out)
}

fn blocked_host(host: &str) -> bool {
    let h = host.trim().trim_matches(|c| c == '[' || c == ']').to_ascii_lowercase();
    if h.is_empty() || h == "localhost" || h.ends_with(".localhost") {
        return true;
    }
    if let Ok(ip) = h.parse::<std::net::IpAddr>() {
        return crate::skin_net::is_blocked_ip(ip);
    }
    false
}

pub fn validate_https_pack_url(href: &str) -> ParseResult {
    let Ok(u) = url::Url::parse(href) else {
        return ParseResult::Err("not_url");
    };
    if u.scheme() != "https" {
        return ParseResult::Err("not_https");
    }
    if !u.username().is_empty() || u.password().is_some() {
        return ParseResult::Err("userinfo");
    }
    if u.path().is_empty() || u.path() == "/" {
        return ParseResult::Err("empty_path");
    }
    if u.host_str().is_some_and(blocked_host) {
        return ParseResult::Err("blocked_host");
    }
    ParseResult::Url(u.to_string())
}

/// Shared with TS fixtures (`src/lib/skinImportUrl.fixtures.json`).
pub fn parse_skin_import_uri(raw: &str) -> ParseResult {
    if raw.len() > SKIN_IMPORT_URI_MAX {
        return ParseResult::Err("too_long");
    }
    let no_frag = raw.split('#').next().unwrap_or(raw);
    let Some((scheme, rest0)) = no_frag.split_once(':') else {
        return ParseResult::Err("no_scheme");
    };
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "grok" && scheme != "grok-app" {
        return ParseResult::Err("scheme");
    }
    let mut rest = rest0;
    if rest.starts_with("//") {
        let auth_end = rest[2..].find('/').map(|i| i + 2).unwrap_or(rest.len());
        let authority = &rest[2..auth_end];
        if authority.contains('@') {
            return ParseResult::Err("userinfo");
        }
        rest = &rest[2..];
    }
    let (path_part, query) = match rest.split_once('?') {
        Some((p, q)) => (p, q),
        None => (rest, ""),
    };
    let path_norm = path_part.trim_end_matches('/');
    if !path_norm.eq_ignore_ascii_case("skin/import") {
        return ParseResult::Err("path");
    }
    let q = match parse_query(query) {
        Ok(q) => q,
        Err(e) => return ParseResult::Err(e),
    };
    for (k, _) in &q {
        if k != "url" && k != "repo" && k != "id" {
            return ParseResult::Err("unknown_query");
        }
    }
    let url = q.iter().find(|(k, _)| k == "url").map(|(_, v)| v.as_str());
    let repo = q.iter().find(|(k, _)| k == "repo").map(|(_, v)| v.as_str());
    let id = q.iter().find(|(k, _)| k == "id").map(|(_, v)| v.as_str());
    if url.is_some() && repo.is_some() {
        return ParseResult::Err("url_and_repo");
    }
    if let Some(href) = url {
        return validate_https_pack_url(href);
    }
    if let Some(repo) = repo {
        if repo != "official" {
            return ParseResult::Err("repo");
        }
        let Some(id) = id else {
            return ParseResult::Err("id");
        };
        if id.len() > 64
            || id.is_empty()
            || !id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
        {
            return ParseResult::Err("id");
        }
        return ParseResult::Official(id.to_string());
    }
    ParseResult::Err("missing_query")
}

pub fn resolve_official(id: &str) -> Result<PendingSkinImport, String> {
    if !crate::skin_net::official_configured() {
        return Err("official_unconfigured: official catalog URL is empty".into());
    }
    Ok(PendingSkinImport::Official { id: id.to_string() })
}

pub fn set_pending(slot: &PendingSlot, next: PendingSkinImport) {
    if let Ok(mut g) = slot.0.lock() {
        *g = Some(next);
    }
}

pub fn take_pending(slot: &PendingSlot) -> Option<PendingSkinImport> {
    slot.0.lock().ok().and_then(|mut g| g.take())
}

pub fn emit_pending(app: &AppHandle) {
    let _ = app.emit(SKIN_IMPORT_EVENT, ());
}

/// Last-write-wins write + emit. Fire-due oneshot must not touch the slot.
pub fn record_pending(
    fire_due: bool,
    slot: &PendingSlot,
    next: PendingSkinImport,
    emit: impl FnOnce(),
) -> bool {
    if fire_due {
        return false;
    }
    set_pending(slot, next);
    emit();
    true
}

pub fn set_pending_and_emit(app: &AppHandle, next: PendingSkinImport) {
    if crate::automation_runner::wants_fire_due_schedules() {
        return;
    }
    if let Some(slot) = app.try_state::<std::sync::Arc<PendingSlot>>() {
        record_pending(false, &slot, next, || emit_pending(app));
    }
}

pub fn is_grokskin_path(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("grokskin"))
        .unwrap_or(false)
}

pub fn ingest_opened_url(app: &AppHandle, url: &url::Url) {
    match url.scheme() {
        "file" => {
            let path = url
                .to_file_path()
                .ok()
                .or_else(|| url.to_string().strip_prefix("file://").map(PathBuf::from));
            if let Some(path) = path {
                if is_grokskin_path(&path) {
                    set_pending_and_emit(
                        app,
                        PendingSkinImport::File {
                            path: path.display().to_string(),
                        },
                    );
                }
            }
        }
        "grok" | "grok-app" => {
            ingest_uri_string(app, url.as_str());
        }
        _ => {}
    }
}

pub fn ingest_uri_string(app: &AppHandle, raw: &str) {
    match parse_skin_import_uri(raw) {
        ParseResult::Url(href) => {
            set_pending_and_emit(app, PendingSkinImport::Url { href });
        }
        ParseResult::Official(id) => {
            if crate::skin_net::official_configured() {
                set_pending_and_emit(app, PendingSkinImport::Official { id });
            }
            // empty official URL: do not invent pending; FE maps via take + official_unconfigured
            else {
                set_pending_and_emit(app, PendingSkinImport::Official { id });
            }
        }
        ParseResult::Err(_) => {}
    }
}

/// Scan argv. Fire-due wins: no pending, no emit.
pub fn ingest_argv(args: &[String]) -> (ArgvIngest, Option<PendingSkinImport>) {
    if args.iter().any(|a| a == crate::automation_runner::FIRE_DUE_FLAG) {
        return (ArgvIngest::FireDue, None);
    }
    let mut last = None;
    for a in args {
        if a.starts_with("grok:") || a.starts_with("GROK:") || a.to_ascii_lowercase().starts_with("grok-app:")
        {
            match parse_skin_import_uri(a) {
                ParseResult::Url(href) => last = Some(PendingSkinImport::Url { href }),
                ParseResult::Official(id) => last = Some(PendingSkinImport::Official { id }),
                ParseResult::Err(_) => {}
            }
            continue;
        }
        let p = PathBuf::from(a);
        if is_grokskin_path(&p) {
            last = Some(PendingSkinImport::File {
                path: p.display().to_string(),
            });
        }
    }
    if last.is_some() {
        (ArgvIngest::Pending, last)
    } else {
        (ArgvIngest::None, None)
    }
}

pub fn ingest_argv_into(app: &AppHandle, args: &[String]) -> ArgvIngest {
    let (kind, pending) = ingest_argv(args);
    if kind == ArgvIngest::Pending {
        if let Some(p) = pending {
            set_pending_and_emit(app, p);
        }
    }
    kind
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::fs;

    fn fixtures() -> Value {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../src/lib/skinImportUrl.fixtures.json");
        let raw = fs::read_to_string(p).expect("fixtures");
        serde_json::from_str(&raw).expect("json")
    }

    fn materialize(input: &str, pad_to: Option<usize>) -> String {
        let Some(n) = pad_to else {
            return input.to_string();
        };
        if input.len() >= n {
            return input.chars().take(n).collect();
        }
        let extra = n - input.len();
        format!("{input}#{}", "x".repeat(extra.saturating_sub(1)))
    }

    #[test]
    fn shared_fixtures() {
        let v = fixtures();
        for c in v["cases"].as_array().unwrap() {
            let name = c["name"].as_str().unwrap();
            let input = materialize(
                c["input"].as_str().unwrap(),
                c.get("padTo").and_then(|x| x.as_u64()).map(|n| n as usize),
            );
            let r = parse_skin_import_uri(&input);
            let ok = c["ok"].as_bool().unwrap();
            if ok {
                match r {
                    ParseResult::Url(href) => {
                        assert_eq!(c["kind"].as_str(), Some("url"), "{name}");
                        if let Some(exp) = c.get("href").and_then(|x| x.as_str()) {
                            assert_eq!(href, exp, "{name}");
                        }
                        if let Some(part) = c.get("hrefContains").and_then(|x| x.as_str()) {
                            assert!(href.contains(part), "{name}: {href}");
                        }
                    }
                    ParseResult::Official(id) => {
                        assert_eq!(c["kind"].as_str(), Some("official"), "{name}");
                        if let Some(exp) = c.get("id").and_then(|x| x.as_str()) {
                            assert_eq!(id, exp, "{name}");
                        }
                    }
                    ParseResult::Err(e) => panic!("{name}: expected ok, got {e}"),
                }
            } else {
                match r {
                    ParseResult::Err(e) => {
                        if let Some(reason) = c.get("reason").and_then(|x| x.as_str()) {
                            assert_eq!(e, reason, "{name}");
                        }
                    }
                    other => panic!("{name}: expected err, got {other:?}"),
                }
            }
        }
    }

    #[test]
    fn last_write_wins() {
        let slot = PendingSlot::default();
        set_pending(
            &slot,
            PendingSkinImport::Url {
                href: "https://a.example/a.grokskin".into(),
            },
        );
        set_pending(
            &slot,
            PendingSkinImport::File {
                path: "/tmp/b.grokskin".into(),
            },
        );
        let got = take_pending(&slot).unwrap();
        match got {
            PendingSkinImport::File { path } => assert!(path.ends_with("b.grokskin")),
            _ => panic!("expected file"),
        }
        assert!(take_pending(&slot).is_none());
    }

    #[test]
    fn grokskin_accepted_zip_rejected() {
        assert!(is_grokskin_path(Path::new("/tmp/a.grokskin")));
        assert!(is_grokskin_path(Path::new("/tmp/A.GROKSKIN")));
        assert!(!is_grokskin_path(Path::new("/tmp/a.zip")));
        assert!(!is_grokskin_path(Path::new("/tmp/no-suffix")));
        let args = vec!["app".into(), "/tmp/foo.zip".into()];
        let (k, p) = ingest_argv(&args);
        assert_eq!(k, ArgvIngest::None);
        assert!(p.is_none());
    }

    #[test]
    fn fire_due_wins_over_grok() {
        let args = vec![
            "app".into(),
            crate::automation_runner::FIRE_DUE_FLAG.to_string(),
            "grok://skin/import?url=https%3A%2F%2Fskins.example%2Fp.grokskin".into(),
        ];
        let (k, p) = ingest_argv(&args);
        assert_eq!(k, ArgvIngest::FireDue);
        assert!(p.is_none());
    }

    #[test]
    fn fire_due_record_pending_writes_nothing_and_does_not_emit() {
        let slot = PendingSlot::default();
        let mut emitted = 0u32;
        let wrote = record_pending(
            true,
            &slot,
            PendingSkinImport::Url {
                href: "https://skins.example/p.grokskin".into(),
            },
            || emitted += 1,
        );
        assert!(!wrote);
        assert_eq!(emitted, 0);
        assert!(take_pending(&slot).is_none());
    }

    #[test]
    fn record_pending_without_fire_due_is_last_write_wins_and_emits() {
        let slot = PendingSlot::default();
        let mut emitted = 0u32;
        assert!(record_pending(
            false,
            &slot,
            PendingSkinImport::Url {
                href: "https://skins.example/a.grokskin".into(),
            },
            || emitted += 1,
        ));
        assert!(record_pending(
            false,
            &slot,
            PendingSkinImport::File {
                path: "/tmp/b.grokskin".into(),
            },
            || emitted += 1,
        ));
        assert_eq!(emitted, 2);
        match take_pending(&slot).unwrap() {
            PendingSkinImport::File { path } => assert!(path.ends_with("b.grokskin")),
            other => panic!("expected file, got {other:?}"),
        }
    }
}
