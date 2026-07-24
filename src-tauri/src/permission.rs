//! Permission scope_key rules (§17.3) + session allow cache.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionPolicy {
    /// Grok Build `default` — ask every tool that needs approval (unless session cache hits).
    Ask,
    AllowOnce,
    AllowForSession,
    /// Grok Build `dontAsk` — deny anything not pre-approved (no interactive prompt).
    DontAsk,
    /// Grok Build `acceptEdits` — auto-approve file edit tools inside project.
    AcceptEdits,
    Deny,
    /// Grok Build `bypassPermissions` / YOLO — settings only, never default chip.
    AlwaysApprove,
}

impl Default for PermissionPolicy {
    fn default() -> Self {
        Self::Ask
    }
}

impl PermissionPolicy {
    pub fn parse(s: &str) -> Self {
        match s {
            "allow_for_session" | "allow_session" => Self::AllowForSession,
            "allow_once" => Self::AllowOnce,
            "deny" => Self::Deny,
            "dont_ask" | "dontask" => Self::DontAsk,
            "accept_edits" | "acceptedits" => Self::AcceptEdits,
            "always_approve" | "always" | "bypass_permissions" | "bypasspermissions" | "yolo" => {
                Self::AlwaysApprove
            }
            _ => Self::Ask,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ask => "ask",
            Self::AllowOnce => "allow_once",
            Self::AllowForSession => "allow_for_session",
            Self::DontAsk => "dont_ask",
            Self::AcceptEdits => "accept_edits",
            Self::Deny => "deny",
            Self::AlwaysApprove => "always_approve",
        }
    }
}

/// Tools treated as file edits for `acceptEdits` mode (aligned with Grok Build docs).
pub fn is_edit_tool(tool_name: &str) -> bool {
    let t = tool_name.to_lowercase();
    matches!(
        t.as_str(),
        "search_replace"
            | "write"
            | "edit"
            | "apply_patch"
            | "str_replace"
            | "strreplace"
            | "create_file"
            | "delete_file"
            | "notebook_edit"
            | "editnotebook"
    ) || t.contains("edit")
        || t.contains("write")
        || t.contains("replace")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub request_id: u64,
    pub session_id: String,
    pub tool_call_id: String,
    pub tool_name: String,
    pub title: String,
    pub preview: String,
    pub scope_key: String,
    pub outside_project: bool,
}

/// Build scope_key = tool_name + ":" + normalize(path_or_command_prefix).
pub fn scope_key(tool_name: &str, path_or_command: &str) -> String {
    let norm = normalize_scope_target(path_or_command);
    format!("{tool_name}:{norm}")
}

pub fn normalize_scope_target(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
        return "*".into();
    }
    // shell: executable basename only (strict-ish)
    if !t.contains('/') && !t.contains('\\') {
        return t.split_whitespace().next().unwrap_or(t).to_string();
    }
    let s = t.replace('\\', "/");
    // collapse //
    let mut out = String::new();
    let mut prev_slash = false;
    for ch in s.chars() {
        if ch == '/' {
            if !prev_slash {
                out.push(ch);
            }
            prev_slash = true;
        } else {
            prev_slash = false;
            out.push(ch);
        }
    }
    out
}

/// Lexically resolve `.` / `..` without requiring the path to exist on disk.
/// Prevents `proj/../../.ssh/id_rsa` from looking "under" proj via naive starts_with.
pub fn lexical_normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::Prefix(p) => out.push(p.as_os_str()),
            Component::RootDir => out.push(comp.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    // Escape above root of relative path — keep a marker so starts_with fails.
                    out.push("..");
                }
            }
            Component::Normal(c) => out.push(c),
        }
    }
    out
}

/// Project-outside paths must never be covered by session allow (§17.3).
pub fn is_outside_project(project_root: &Path, target: &str) -> bool {
    let t = target.trim();
    if t.is_empty() || t == "*" {
        return false;
    }
    // Bare commands (shell) — path policy N/A; not treated as outside.
    if !t.contains('/') && !t.contains('\\') {
        return false;
    }

    let Ok(proj) = project_root.canonicalize() else {
        return true; // fail closed
    };
    let proj = lexical_normalize(&proj);

    let target_path = PathBuf::from(t);
    let joined = if target_path.is_absolute() {
        target_path
    } else {
        proj.join(&target_path)
    };

    // Prefer real canonicalize when path exists; always also lexical-clean.
    let target_norm = if joined.exists() {
        lexical_normalize(&joined.canonicalize().unwrap_or_else(|_| joined.clone()))
    } else {
        lexical_normalize(&joined)
    };

    // If after cleaning we still have `..` as a component, we escaped the root.
    if target_norm
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return true;
    }

    !target_norm.starts_with(&proj)
}

/// Extract a path-like target from ACP permission / tool_call payload.
pub fn extract_path_target(raw: &serde_json::Value) -> String {
    let candidates = [
        raw.pointer("/toolCall/locations/0/path"),
        raw.pointer("/toolCall/rawInput/path"),
        raw.pointer("/toolCall/rawInput/file_path"),
        raw.pointer("/toolCall/path"),
        raw.pointer("/locations/0/path"),
        raw.pointer("/rawInput/path"),
        raw.pointer("/rawInput/file_path"),
        raw.pointer("/path"),
        raw.pointer("/file_path"),
    ];
    for c in candidates {
        if let Some(s) = c.and_then(|v| v.as_str()) {
            if !s.is_empty() {
                return s.to_string();
            }
        }
    }
    if let Some(title) = raw
        .pointer("/toolCall/title")
        .or_else(|| raw.get("title"))
        .and_then(|v| v.as_str())
    {
        if title.contains('/') || title.contains('\\') {
            return title.to_string();
        }
    }
    String::new()
}

/// Extract shell command text from ACP permission / tool_call payload.
pub fn extract_shell_command(raw: &serde_json::Value) -> String {
    let candidates = [
        raw.pointer("/toolCall/rawInput/command"),
        raw.pointer("/rawInput/command"),
        raw.pointer("/toolCall/command"),
        raw.pointer("/command"),
    ];
    for c in candidates {
        if let Some(s) = c.and_then(|v| v.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    String::new()
}

fn shell_has_token(cmd_lower: &str, token: &str) -> bool {
    // Word-ish match so `curl` does not hit `curly`.
    for part in cmd_lower.split(|c: char| {
        c.is_whitespace() || c == '|' || c == '&' || c == ';' || c == '(' || c == ')'
    }) {
        let p = part.trim_start_matches(['\\', '/', '.']);
        let base = p.rsplit('/').next().unwrap_or(p);
        if base == token {
            return true;
        }
    }
    false
}

/// True when a curl short-option cluster writes a file (`-o`, `-O`, or combined e.g. `-sLo`).
fn curl_has_output_flag(cmd_lower: &str) -> bool {
    if cmd_lower.contains("--output") || cmd_lower.contains("--remote-name") {
        return true;
    }
    let bytes = cmd_lower.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'-' && i + 1 < bytes.len() && bytes[i + 1] != b'-' {
            // short cluster: -sLo / -o / -O / -OJ
            i += 1;
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
                i += 1;
            }
            let cluster = &cmd_lower[start..i];
            if cluster.contains('o') || cluster.contains('O') {
                return true;
            }
            continue;
        }
        i += 1;
    }
    false
}

/// True when the shell command is primarily downloading remote content to a local file
/// (curl -o/-O, wget, aria2c, …). Used to default-allow asset downloads into the project.
pub fn is_download_command(cmd: &str) -> bool {
    let lower = cmd.to_lowercase();
    if lower.trim().is_empty() {
        return false;
    }
    if shell_has_token(&lower, "curl") && curl_has_output_flag(&lower) {
        return true;
    }
    if shell_has_token(&lower, "wget")
        || shell_has_token(&lower, "aria2c")
        || shell_has_token(&lower, "aria2")
    {
        return true;
    }
    false
}

fn read_shell_arg(cmd: &str, bytes: &[u8], i: &mut usize) -> Option<String> {
    while *i < bytes.len() && bytes[*i].is_ascii_whitespace() {
        *i += 1;
    }
    if *i >= bytes.len() {
        return None;
    }
    let dest = if bytes[*i] == b'"' || bytes[*i] == b'\'' {
        let q = bytes[*i];
        *i += 1;
        let start = *i;
        while *i < bytes.len() && bytes[*i] != q {
            *i += 1;
        }
        let s = cmd[start..*i].to_string();
        if *i < bytes.len() {
            *i += 1;
        }
        s
    } else {
        let start = *i;
        while *i < bytes.len() && !bytes[*i].is_ascii_whitespace() {
            *i += 1;
        }
        cmd[start..*i].to_string()
    };
    let dest = dest.trim().to_string();
    if dest.is_empty() || dest == "-" {
        None
    } else {
        Some(dest)
    }
}

/// Best-effort local destinations from `curl -o` / `wget -O` / `aria2c -o` style flags.
pub fn extract_download_destinations(cmd: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = cmd.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        let rest = &cmd[i..];
        if rest.starts_with("--output=") {
            i += 9;
            if let Some(d) = read_shell_arg(cmd, bytes, &mut i) {
                out.push(d);
            }
            continue;
        }
        if rest.starts_with("--output")
            && rest
                .chars()
                .nth(8)
                .map(|c| c.is_whitespace() || c == '=')
                .unwrap_or(false)
        {
            i += 8;
            if i < bytes.len() && bytes[i] == b'=' {
                i += 1;
            }
            if let Some(d) = read_shell_arg(cmd, bytes, &mut i) {
                out.push(d);
            }
            continue;
        }
        // Short clusters: -o FILE, -sLo FILE, -O (remote name → no path)
        if bytes[i] == b'-' && i + 1 < bytes.len() && bytes[i + 1] != b'-' {
            i += 1;
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
                i += 1;
            }
            let cluster = &cmd[start..i];
            // Prefer lowercase `o` (output file). Capital `O` is remote-name (no path).
            if let Some(pos) = cluster.rfind('o') {
                if pos + 1 < cluster.len() {
                    // Glued: -ofile.png
                    let glued = cluster[pos + 1..].to_string();
                    if !glued.is_empty() {
                        out.push(glued);
                    }
                } else if let Some(d) = read_shell_arg(cmd, bytes, &mut i) {
                    out.push(d);
                }
            }
            continue;
        }
        i += 1;
    }
    out
}

/// Whether `dest` is under `project_root` for download auto-allow.
/// Uses strict `is_outside_project` first; falls back to lexical prefix so that
/// non-existent paths still match when macOS `/var` vs `/private/var` canonicalize differs.
fn download_dest_in_project(project_root: &Path, dest: &str) -> bool {
    if !is_outside_project(project_root, dest) {
        return true;
    }
    let dest_n = lexical_normalize(Path::new(dest));
    let root_n = lexical_normalize(project_root);
    if dest_n.starts_with(&root_n) {
        return true;
    }
    // Compare against canonical project if available (dest may already be canonical).
    if let Ok(root_c) = project_root.canonicalize() {
        let root_c = lexical_normalize(&root_c);
        if dest_n.starts_with(&root_c) {
            return true;
        }
    }
    false
}

/// Default-allow download shell when destinations stay inside the project (or cwd download with a project).
pub fn may_auto_allow_download(
    policy: PermissionPolicy,
    project_root: Option<&Path>,
    command: &str,
) -> bool {
    if matches!(
        policy,
        PermissionPolicy::Deny | PermissionPolicy::DontAsk
    ) {
        return false;
    }
    if !is_download_command(command) {
        return false;
    }
    let Some(root) = project_root else {
        // No project bound — only YOLO downloads freely.
        return matches!(policy, PermissionPolicy::AlwaysApprove);
    };
    let dests = extract_download_destinations(command);
    if dests.is_empty() {
        // wget without -O writes into cwd (project root when agent cwd = project).
        return true;
    }
    dests.iter().all(|d| download_dest_in_project(root, d))
}

/// Decide whether Host may auto-approve without UI.
///
/// Rules (H05 + §17.3 + Grok Build permission modes):
/// - Outside project → never auto (even with session cache; AlwaysApprove is the only global YOLO)
/// - Deny / DontAsk policy → never auto-allow
/// - Session cache hit + in-project → auto (even when chip policy is Ask — "Allow for session")
/// - AcceptEdits → auto for edit tools in-project
/// - Download shell (curl -o / wget / …) into project → auto (default-allow asset download)
/// - AlwaysApprove → auto (settings YOLO / bypassPermissions)
/// - else → false (must prompt)
pub fn may_auto_allow(
    policy: PermissionPolicy,
    cache: &SessionAllowCache,
    scope: &str,
    project_root: Option<&Path>,
    path_target: &str,
    tool_name: &str,
    command: &str,
) -> bool {
    let outside = if path_target.is_empty() {
        false
    } else {
        project_root
            .map(|p| is_outside_project(p, path_target))
            .unwrap_or(true) // no project → fail closed for path-bearing tools
    };

    // §17.3: 项目外路径永不被 session allow 覆盖
    if outside {
        return matches!(policy, PermissionPolicy::AlwaysApprove);
    }

    if matches!(
        policy,
        PermissionPolicy::Deny | PermissionPolicy::DontAsk
    ) {
        return false;
    }

    // H05: once user chose "Allow for session", cache hits auto-allow under Ask chip too.
    if cache.is_allowed(scope) {
        return true;
    }

    if matches!(policy, PermissionPolicy::AcceptEdits) && is_edit_tool(tool_name) {
        return true;
    }

    // Default-allow in-project downloads (image/asset fetch) so long turns don't stall on perm.
    if may_auto_allow_download(policy, project_root, command) {
        return true;
    }

    matches!(policy, PermissionPolicy::AlwaysApprove)
}

/// `dontAsk`: deny without interactive prompt when not auto-allowed.
pub fn may_auto_deny(policy: PermissionPolicy) -> bool {
    matches!(policy, PermissionPolicy::DontAsk | PermissionPolicy::Deny)
}

/// Resolve effective permission tier for a project/session context (L10).
///
/// Cascade (most specific wins): session override → project tier → global default.
/// Untrusted projects always force **Ask** so a stored relaxed tier cannot apply
/// before the user trusts the folder.
pub fn effective_permission_policy(
    global: &str,
    project_trusted: Option<bool>,
    project_policy: Option<&str>,
    session_policy: Option<&str>,
) -> PermissionPolicy {
    if project_trusted == Some(false) {
        return PermissionPolicy::Ask;
    }
    if let Some(s) = session_policy.map(str::trim).filter(|s| !s.is_empty()) {
        return PermissionPolicy::parse(s);
    }
    if let Some(p) = project_policy.map(str::trim).filter(|s| !s.is_empty()) {
        return PermissionPolicy::parse(p);
    }
    let g = global.trim();
    if g.is_empty() {
        PermissionPolicy::Ask
    } else {
        PermissionPolicy::parse(g)
    }
}

/// Pick optionId from ACP permission options by preferred kind.
pub fn pick_option_id(options: &serde_json::Value, prefer: &str) -> Option<String> {
    let arr = options.as_array()?;
    let prefer = prefer.to_lowercase();
    for o in arr {
        let kind = o
            .get("kind")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        if kind == prefer {
            return o
                .get("optionId")
                .or_else(|| o.get("id"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
    }
    for o in arr {
        let name = o
            .get("name")
            .or_else(|| o.get("label"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        if name.contains(&prefer) || name.contains(&prefer.replace('_', " ")) {
            return o
                .get("optionId")
                .or_else(|| o.get("id"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
    }
    None
}

#[derive(Debug, Default)]
pub struct SessionAllowCache {
    keys: HashSet<String>,
}

impl SessionAllowCache {
    pub fn allow(&mut self, key: String) {
        self.keys.insert(key);
    }

    pub fn is_allowed(&self, key: &str) -> bool {
        self.keys.contains(key)
    }

    pub fn clear(&mut self) {
        self.keys.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_key_shell_uses_executable_name() {
        assert_eq!(scope_key("shell", "npm install foo"), "shell:npm");
        assert_eq!(scope_key("shell", "cargo test"), "shell:cargo");
    }

    #[test]
    fn scope_key_fs_write_normalizes_path() {
        let k = scope_key("fs.write", "/Users/me/proj//src/a.rs");
        assert_eq!(k, "fs.write:/Users/me/proj/src/a.rs");
    }

    #[test]
    fn default_policy_is_ask_not_always() {
        assert_eq!(PermissionPolicy::default(), PermissionPolicy::Ask);
    }

    #[test]
    fn effective_permission_defaults_to_ask() {
        assert_eq!(
            effective_permission_policy("", None, None, None),
            PermissionPolicy::Ask
        );
        assert_eq!(
            effective_permission_policy("always_approve", None, None, None),
            PermissionPolicy::AlwaysApprove
        );
    }

    #[test]
    fn effective_permission_cascades_session_over_project_over_global() {
        assert_eq!(
            effective_permission_policy(
                "ask",
                Some(true),
                Some("accept_edits"),
                Some("always_approve"),
            ),
            PermissionPolicy::AlwaysApprove
        );
        assert_eq!(
            effective_permission_policy("ask", Some(true), Some("accept_edits"), None),
            PermissionPolicy::AcceptEdits
        );
        assert_eq!(
            effective_permission_policy("dont_ask", Some(true), None, None),
            PermissionPolicy::DontAsk
        );
    }

    #[test]
    fn untrusted_project_forces_ask_despite_relaxed_tiers() {
        assert_eq!(
            effective_permission_policy(
                "always_approve",
                Some(false),
                Some("always_approve"),
                Some("always_approve"),
            ),
            PermissionPolicy::Ask
        );
        assert_eq!(
            effective_permission_policy("accept_edits", Some(false), Some("accept_edits"), None),
            PermissionPolicy::Ask
        );
    }

    #[test]
    fn empty_session_or_project_tier_falls_through() {
        assert_eq!(
            effective_permission_policy("ask", Some(true), Some(""), Some("  ")),
            PermissionPolicy::Ask
        );
        assert_eq!(
            effective_permission_policy("accept_edits", Some(true), Some(""), None),
            PermissionPolicy::AcceptEdits
        );
    }

    #[test]
    fn session_cache_roundtrip() {
        let mut c = SessionAllowCache::default();
        c.allow("shell:npm".into());
        assert!(c.is_allowed("shell:npm"));
        assert!(!c.is_allowed("shell:rm"));
    }

    #[test]
    fn ask_with_session_cache_auto_allows_in_project() {
        // H05: Allow for session under default Ask chip
        let mut c = SessionAllowCache::default();
        let root = std::env::temp_dir().join("grok-app-perm-ask-cache");
        let _ = std::fs::create_dir_all(root.join("src"));
        let inside = root.join("src/a.rs");
        let _ = std::fs::write(&inside, "x");
        let sk = scope_key("fs.write", &inside.to_string_lossy());
        c.allow(sk.clone());

        assert!(
            may_auto_allow(
                PermissionPolicy::Ask,
                &c,
                &sk,
                Some(&root),
                &inside.to_string_lossy(),
                "write",
                "",
            ),
            "Ask + session cache hit + in-project must auto-allow (H05)"
        );
    }

    #[test]
    fn ask_with_session_cache_never_outside() {
        let mut c = SessionAllowCache::default();
        let root = std::env::temp_dir().join("grok-app-perm-ask-out");
        let _ = std::fs::create_dir_all(&root);
        let outside = "/etc/passwd";
        let sk_out = scope_key("fs.write", outside);
        c.allow(sk_out.clone());
        assert!(!may_auto_allow(
            PermissionPolicy::Ask,
            &c,
            &sk_out,
            Some(&root),
            outside,
            "write",
            "",
        ));
    }

    #[test]
    fn ask_without_cache_does_not_auto() {
        let c = SessionAllowCache::default();
        let root = std::env::temp_dir().join("grok-app-perm-ask-empty");
        let _ = std::fs::create_dir_all(&root);
        let inside = root.join("f.txt");
        assert!(!may_auto_allow(
            PermissionPolicy::Ask,
            &c,
            "fs.write:/x",
            Some(&root),
            &inside.to_string_lossy(),
            "write",
            "",
        ));
    }

    #[test]
    fn accept_edits_auto_allows_edit_tools() {
        let c = SessionAllowCache::default();
        let root = std::env::temp_dir().join("grok-app-perm-accept");
        let _ = std::fs::create_dir_all(&root);
        let inside = root.join("f.txt");
        let _ = std::fs::write(&inside, "x");
        assert!(may_auto_allow(
            PermissionPolicy::AcceptEdits,
            &c,
            "write:x",
            Some(&root),
            &inside.to_string_lossy(),
            "search_replace",
            "",
        ));
        assert!(!may_auto_allow(
            PermissionPolicy::AcceptEdits,
            &c,
            "bash:x",
            Some(&root),
            "ls",
            "run_terminal_command",
            "ls -la",
        ));
    }

    #[test]
    fn download_into_project_is_auto_allowed() {
        let c = SessionAllowCache::default();
        let root = std::env::temp_dir().join("grok-app-perm-dl");
        let _ = std::fs::create_dir_all(root.join("outputs"));
        let dest = root.join("outputs/kitten.png");
        let cmd = format!(
            "mkdir -p {}/outputs && curl -sL -o {} \"https://example.com/a.png\"",
            root.display(),
            dest.display()
        );
        assert!(is_download_command(&cmd));
        assert!(may_auto_allow(
            PermissionPolicy::AllowForSession,
            &c,
            "execute:run_terminal_command",
            Some(&root),
            "",
            "run_terminal_command",
            &cmd,
        ));
        assert!(may_auto_allow(
            PermissionPolicy::Ask,
            &c,
            "execute:run_terminal_command",
            Some(&root),
            "",
            "run_terminal_command",
            &cmd,
        ));
    }

    #[test]
    fn download_outside_project_not_auto_allowed() {
        let c = SessionAllowCache::default();
        let root = std::env::temp_dir().join("grok-app-perm-dl-out");
        let _ = std::fs::create_dir_all(&root);
        let cmd = "curl -sL -o /etc/passwd https://example.com/x";
        assert!(is_download_command(cmd));
        assert!(!may_auto_allow(
            PermissionPolicy::AllowForSession,
            &c,
            "execute:run_terminal_command",
            Some(&root),
            "",
            "run_terminal_command",
            cmd,
        ));
    }

    #[test]
    fn extract_shell_command_from_raw() {
        let raw = serde_json::json!({
            "toolCall": {
                "rawInput": { "command": "curl -o out.png https://x" }
            }
        });
        assert_eq!(extract_shell_command(&raw), "curl -o out.png https://x");
    }

    #[test]
    fn relative_traversal_is_outside_project() {
        let root = std::env::temp_dir().join("grok-app-perm-trav");
        let _ = std::fs::create_dir_all(&root);
        // Non-existent relative escape
        assert!(
            is_outside_project(&root, "../../.ssh/id_rsa"),
            "relative .. escape must be outside"
        );
        assert!(is_outside_project(
            &root,
            &format!("{}/../../.ssh/id_rsa", root.display())
        ));
        // Inside relative
        let _ = std::fs::create_dir_all(root.join("src"));
        assert!(!is_outside_project(&root, "src/a.rs"));
    }

    #[test]
    fn lexical_normalize_pops_parent() {
        let p = PathBuf::from("/Users/me/proj/src/../../.ssh/id_rsa");
        let n = lexical_normalize(&p);
        assert_eq!(n, PathBuf::from("/Users/me/.ssh/id_rsa"));
    }

    #[test]
    fn outside_project_never_auto_via_session_cache() {
        let mut c = SessionAllowCache::default();
        let root = std::env::temp_dir().join("grok-app-perm-proj");
        let _ = std::fs::create_dir_all(&root);
        let inside = root.join("src/a.rs");
        let _ = std::fs::create_dir_all(inside.parent().unwrap());
        let _ = std::fs::write(&inside, "x");
        let sk = scope_key("fs.write", &inside.to_string_lossy());
        c.allow(sk.clone());
        assert!(may_auto_allow(
            PermissionPolicy::AllowForSession,
            &c,
            &sk,
            Some(&root),
            &inside.to_string_lossy(),
            "write",
            "",
        ));
        let outside = "/etc/passwd";
        let sk_out = scope_key("fs.write", outside);
        c.allow(sk_out.clone());
        assert!(!may_auto_allow(
            PermissionPolicy::AllowForSession,
            &c,
            &sk_out,
            Some(&root),
            outside,
            "write",
            "",
        ));
    }

    #[test]
    fn pick_option_id_prefers_kind() {
        let opts = serde_json::json!([
            {"optionId": "allow-once", "name": "Allow once", "kind": "allow_once"},
            {"optionId": "allow-always", "name": "Allow always", "kind": "allow_always"},
            {"optionId": "reject-once", "name": "Reject", "kind": "reject_once"}
        ]);
        assert_eq!(
            pick_option_id(&opts, "allow_once").as_deref(),
            Some("allow-once")
        );
        assert_eq!(
            pick_option_id(&opts, "reject_once").as_deref(),
            Some("reject-once")
        );
    }

    #[test]
    fn extract_path_from_tool_call_payload() {
        let raw = serde_json::json!({
            "toolCall": {
                "toolCallId": "c1",
                "title": "Write file",
                "locations": [{"path": "/Users/me/proj/a.txt"}]
            }
        });
        assert_eq!(extract_path_target(&raw), "/Users/me/proj/a.txt");
    }
}
