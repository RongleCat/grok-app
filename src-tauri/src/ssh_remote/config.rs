#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshHostDto {
    pub alias: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshListResult {
    pub hosts: Vec<SshHostDto>,
    pub config_path: String,
    pub config_exists: bool,
    pub ssh_found: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshProbeResult {
    pub alias: String,
    /// True only when SSH connected **and** the probe marker came back.
    pub ok: bool,
    pub ssh_ok: bool,
    /// `ok` | `missing` | `unknown`
    pub cli: String,
    /// `ok` | `missing` | `unknown`
    pub auth: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    pub install_cmd: String,
    pub login_cmd: String,
    pub install_remote_cmd: String,
    pub login_remote_cmd: String,
}

/// Concrete Host alias: no glob, no leading hyphen.
pub fn is_safe_ssh_alias(alias: &str) -> bool {
    let b = alias.as_bytes();
    if b.is_empty() || b.len() > 255 {
        return false;
    }
    if matches!(b[0], b'-' | b'.') {
        return false;
    }
    b.iter()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
}

/// True when this project lives on an OpenSSH host. Do not treat its path as
/// local `std::fs`. Wave 3 spawns `grok agent stdio` through `ssh`, never as a
/// local child with the remote path as cwd.
pub fn should_skip_local_acp_spawn(ssh_alias: Option<&str>) -> bool {
    ssh_alias
        .map(str::trim)
        .is_some_and(|s| !s.is_empty() && is_safe_ssh_alias(s))
}

/// First safe alias wins: explicit connect arg, bound project, path match.
pub fn pick_ssh_alias(
    explicit: Option<&str>,
    bound_project_alias: Option<&str>,
    path_project_alias: Option<&str>,
) -> Option<String> {
    for raw in [explicit, bound_project_alias, path_project_alias] {
        if let Some(a) = raw.map(str::trim).filter(|s| is_safe_ssh_alias(s)) {
            return Some(a.to_string());
        }
    }
    None
}

/// Local `grok agent stdio` needs a real directory on this machine.
/// SSH aliases and missing paths must not go through local spawn (ENOENT
/// used to be mislabeled `CLI_NOT_FOUND`).
pub fn local_acp_cwd_ok(ssh_alias: Option<&str>, cwd: &str) -> bool {
    if should_skip_local_acp_spawn(ssh_alias) {
        return false;
    }
    let t = cwd.trim();
    !t.is_empty() && std::path::Path::new(t).is_dir()
}

/// Whether ACP `session/new` may use this cwd.
///
/// SSH: grok checks the path on the host. A local `is_dir` miss used to abort
/// connect with `AGENT_CRASHED` after a successful remote handshake.
/// Local: must be a directory on this machine.
pub fn acp_session_cwd_ok(ssh_alias: Option<&str>, cwd: &str) -> bool {
    let t = cwd.trim();
    if t.is_empty() || t.contains('\0') {
        return false;
    }
    if should_skip_local_acp_spawn(ssh_alias) {
        return true;
    }
    std::path::Path::new(t).is_dir()
}

/// Same gate as `grok sessions list` / TUI `/resume` for a cwd.
///
/// Disk under `~/.grok/sessions` also stores subagent children and empty
/// shells that only have `chat_history.jsonl`. Those are not resumable
/// parent chats. Grok's list uses `summary.json` `session_kind` plus the
/// `updates.jsonl` restore log — not every directory. Runtime filter lives
/// in `remote_sess_script`; this is the host-side spec for tests.
#[cfg_attr(not(test), allow(dead_code))]
pub fn remote_session_is_listable(
    session_kind: Option<&str>,
    title: &str,
    has_updates: bool,
) -> bool {
    let kind = session_kind.unwrap_or("").trim().to_ascii_lowercase();
    if kind.starts_with("subagent") {
        return false;
    }
    has_updates || !title.trim().is_empty()
}

pub fn is_pattern_token(tok: &str) -> bool {
    tok.contains('*') || tok.contains('?') || tok.contains('!')
}

fn default_ssh_config_path() -> PathBuf {
    process_util::user_home().join(".ssh").join("config")
}

fn find_ssh_binary() -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) {
        &["ssh.exe", "ssh"]
    } else {
        &["ssh"]
    };
    for name in names {
        if let Ok(p) = which::which(name) {
            if p.is_file() {
                return Some(p);
            }
        }
    }
    if let Some(enriched) = process_util::enriched_path_env() {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        for name in names {
            if let Ok(p) = which::which_in(name, Some(&enriched), &cwd) {
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }
    #[cfg(windows)]
    {
        let mut candidates = vec![
            PathBuf::from(r"C:\Windows\System32\OpenSSH\ssh.exe"),
            PathBuf::from(r"C:\Program Files\Git\usr\bin\ssh.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Git\usr\bin\ssh.exe"),
        ];
        if let Ok(pf) = std::env::var("ProgramFiles") {
            candidates.push(PathBuf::from(pf).join(r"Git\usr\bin\ssh.exe"));
        }
        if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
            candidates.push(PathBuf::from(pf86).join(r"Git\usr\bin\ssh.exe"));
        }
        if let Ok(sysroot) = std::env::var("SystemRoot") {
            candidates.push(PathBuf::from(sysroot).join(r"System32\OpenSSH\ssh.exe"));
        }
        for p in candidates {
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

fn truncate_err(s: &str) -> String {
    let t = s.trim();
    if t.chars().count() <= ERROR_CHARS {
        t.to_string()
    } else {
        format!("{}…", t.chars().take(ERROR_CHARS).collect::<String>())
    }
}

fn classify_ssh_stderr(stderr: &str) -> (&'static str, String) {
    let l = stderr.to_ascii_lowercase();
    if l.contains("host key") || l.contains("known_hosts") || l.contains("authenticity of host") {
        (
            "host_key",
            truncate_err(stderr)
                .if_empty("Host key not in known_hosts. Run ssh <alias> once in a terminal."),
        )
    } else if l.contains("permission denied") {
        ("auth", truncate_err(stderr).if_empty("Permission denied"))
    } else if l.contains("timed out") || l.contains("timeout") || l.contains("connection timed out")
    {
        (
            "timeout",
            truncate_err(stderr).if_empty("Connection timed out"),
        )
    } else if l.contains("could not resolve")
        || l.contains("name or service not known")
        || l.contains("nodename nor servname")
    {
        (
            "connect",
            truncate_err(stderr).if_empty("Could not resolve host"),
        )
    } else if l.contains("connection refused") {
        (
            "connect",
            truncate_err(stderr).if_empty("Connection refused"),
        )
    } else if l.contains("connection reset") {
        ("connect", truncate_err(stderr).if_empty("Connection reset"))
    } else if stderr.trim().is_empty() {
        ("other", "SSH failed with no stderr".into())
    } else {
        ("other", truncate_err(stderr))
    }
}

trait IfEmpty {
    fn if_empty(self, fallback: &str) -> String;
}

impl IfEmpty for String {
    fn if_empty(self, fallback: &str) -> String {
        if self.trim().is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}

pub fn commands_for_alias(alias: &str) -> (String, String, String, String) {
    let install = format!("ssh {alias} '{INSTALL_REMOTE}'");
    let login = format!("ssh -t {alias} '{LOGIN_REMOTE}'");
    (
        install,
        login,
        INSTALL_REMOTE.to_string(),
        LOGIN_REMOTE.to_string(),
    )
}

fn empty_probe(alias: &str, code: &str, err: impl Into<String>) -> SshProbeResult {
    let (install_cmd, login_cmd, install_remote_cmd, login_remote_cmd) = commands_for_alias(alias);
    SshProbeResult {
        alias: alias.to_string(),
        ok: false,
        ssh_ok: false,
        cli: "unknown".into(),
        auth: "unknown".into(),
        cli_path: None,
        cli_version: None,
        error: Some(err.into()),
        error_code: Some(code.into()),
        latency_ms: None,
        install_cmd,
        login_cmd,
        install_remote_cmd,
        login_remote_cmd,
    }
}

/// Parse OpenSSH config text. `Include` is resolved via `read_file`.
pub fn parse_ssh_config(
    text: &str,
    base_dir: &Path,
    read_file: &dyn Fn(&Path) -> Option<String>,
) -> Vec<SshHostDto> {
    let mut visited = HashSet::new();
    let mut out = Vec::new();
    parse_ssh_config_inner(text, base_dir, read_file, 0, &mut visited, &mut out);
    out
}

fn parse_ssh_config_inner(
    text: &str,
    base_dir: &Path,
    read_file: &dyn Fn(&Path) -> Option<String>,
    depth: u32,
    visited: &mut HashSet<String>,
    out: &mut Vec<SshHostDto>,
) {
    let mut current_aliases: Vec<String> = Vec::new();
    let mut hostname: Option<String> = None;
    let mut user: Option<String> = None;
    let mut port: Option<u16> = None;
    let mut identity: Option<String> = None;
    let mut in_host = false;

    let flush = |aliases: &mut Vec<String>,
                 hostname: &mut Option<String>,
                 user: &mut Option<String>,
                 port: &mut Option<u16>,
                 identity: &mut Option<String>,
                 in_host: &mut bool,
                 out: &mut Vec<SshHostDto>| {
        if *in_host {
            for alias in aliases.drain(..) {
                if !is_safe_ssh_alias(&alias) {
                    continue;
                }
                if out.iter().any(|h| h.alias == alias) {
                    continue;
                }
                out.push(SshHostDto {
                    alias: alias.clone(),
                    hostname: hostname.clone(),
                    user: user.clone(),
                    port: *port,
                    identity_file: identity.clone(),
                });
            }
        } else {
            aliases.clear();
        }
        *hostname = None;
        *user = None;
        *port = None;
        *identity = None;
        *in_host = false;
    };

    for raw in text.lines() {
        let line = strip_ssh_comment(raw).trim().to_string();
        if line.is_empty() {
            continue;
        }
        let (kw, rest) = split_keyword(&line);
        let kw_l = kw.to_ascii_lowercase();
        if kw_l == "host" {
            flush(
                &mut current_aliases,
                &mut hostname,
                &mut user,
                &mut port,
                &mut identity,
                &mut in_host,
                out,
            );
            let tokens = split_ws(&rest);
            let concrete: Vec<String> = tokens
                .into_iter()
                .filter(|t| !is_pattern_token(t))
                .collect();
            if concrete.is_empty() {
                in_host = false;
                current_aliases.clear();
            } else {
                in_host = true;
                current_aliases = concrete;
            }
            continue;
        }
        if kw_l == "match" {
            flush(
                &mut current_aliases,
                &mut hostname,
                &mut user,
                &mut port,
                &mut identity,
                &mut in_host,
                out,
            );
            continue;
        }
        if kw_l == "include" && depth < INCLUDE_DEPTH_MAX {
            for spec in split_ws(&rest) {
                include_spec(&spec, base_dir, read_file, depth, visited, out);
            }
            continue;
        }
        if !in_host {
            continue;
        }
        match kw_l.as_str() {
            "hostname" if hostname.is_none() => hostname = unquote(&rest),
            "user" if user.is_none() => user = unquote(&rest),
            "port" if port.is_none() => {
                if let Some(v) = unquote(&rest).and_then(|s| s.parse::<u16>().ok()) {
                    if v > 0 {
                        port = Some(v);
                    }
                }
            }
            "identityfile" if identity.is_none() => identity = unquote(&rest),
            _ => {}
        }
    }
    flush(
        &mut current_aliases,
        &mut hostname,
        &mut user,
        &mut port,
        &mut identity,
        &mut in_host,
        out,
    );
}

fn include_spec(
    spec: &str,
    base_dir: &Path,
    read_file: &dyn Fn(&Path) -> Option<String>,
    depth: u32,
    visited: &mut HashSet<String>,
    out: &mut Vec<SshHostDto>,
) {
    for path in expand_include_paths(spec, base_dir) {
        let key = path.to_string_lossy().to_string();
        if !visited.insert(key) {
            continue;
        }
        let Some(text) = read_file(&path) else {
            continue;
        };
        let next_base = path.parent().unwrap_or(base_dir);
        parse_ssh_config_inner(&text, next_base, read_file, depth + 1, visited, out);
    }
}

fn expand_include_paths(spec: &str, base_dir: &Path) -> Vec<PathBuf> {
    let expanded = expand_tilde(spec);
    let path = if Path::new(&expanded).is_absolute() {
        PathBuf::from(&expanded)
    } else {
        base_dir.join(&expanded)
    };
    let os = path.to_string_lossy();
    if let Some(star) = os.find('*') {
        if os[star + 1..].contains('*') || os[star + 1..].contains('/') {
            return Vec::new();
        }
        let parent = Path::new(&os[..star]).to_path_buf();
        let prefix = Path::new(&os[..star])
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let suffix = os[star + 1..].to_string();
        let dir = if os[..star].ends_with('/') {
            parent
        } else {
            parent.parent().unwrap_or(base_dir).to_path_buf()
        };
        let Ok(rd) = std::fs::read_dir(&dir) else {
            return Vec::new();
        };
        let mut files: Vec<PathBuf> = rd
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_file())
            .filter(|p| {
                let name = p.file_name().map(|s| s.to_string_lossy().to_string());
                let Some(name) = name else {
                    return false;
                };
                name.starts_with(&prefix) && name.ends_with(&suffix)
            })
            .collect();
        files.sort();
        files
    } else {
        vec![path]
    }
}

fn expand_tilde(s: &str) -> String {
    if let Some(rest) = s.strip_prefix("~/") {
        process_util::user_home()
            .join(rest)
            .to_string_lossy()
            .into_owned()
    } else if s == "~" {
        process_util::user_home().to_string_lossy().into_owned()
    } else {
        s.to_string()
    }
}

fn strip_ssh_comment(line: &str) -> String {
    let mut out = String::new();
    let mut chars = line.chars().peekable();
    let mut quote: Option<char> = None;
    while let Some(c) = chars.next() {
        if quote.is_none() && c == '#' {
            break;
        }
        if c == '\\' {
            if let Some(n) = chars.next() {
                out.push(c);
                out.push(n);
            }
            continue;
        }
        if c == '"' || c == '\'' {
            if quote == Some(c) {
                quote = None;
            } else if quote.is_none() {
                quote = Some(c);
            }
        }
        out.push(c);
    }
    out
}

fn split_keyword(line: &str) -> (String, String) {
    let line = line.trim();
    if let Some(eq) = line.find('=') {
        let (a, b) = line.split_at(eq);
        if !a.trim().contains(char::is_whitespace) {
            return (a.trim().to_string(), b[1..].trim().to_string());
        }
    }
    match line.split_once(char::is_whitespace) {
        Some((k, rest)) => (k.to_string(), rest.trim().to_string()),
        None => (line.to_string(), String::new()),
    }
}

fn split_ws(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for c in s.chars() {
        if quote.is_none() && c.is_whitespace() {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            continue;
        }
        if c == '"' || c == '\'' {
            if quote == Some(c) {
                quote = None;
            } else if quote.is_none() {
                quote = Some(c);
            } else {
                cur.push(c);
            }
            continue;
        }
        cur.push(c);
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn unquote(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    let t = if (t.starts_with('"') && t.ends_with('"') && t.len() >= 2)
        || (t.starts_with('\'') && t.ends_with('\'') && t.len() >= 2)
    {
        &t[1..t.len() - 1]
    } else {
        t
    };
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

pub fn parse_probe_stdout(stdout: &str) -> Option<ParsedProbe> {
    let mut lines = stdout.lines().map(|l| l.trim_end_matches('\r'));
    while let Some(line) = lines.next() {
        if line.trim() == "GROK_APP_PROBE" {
            let cli = lines.next().unwrap_or("").trim();
            let auth = lines.next().unwrap_or("").trim();
            let path = lines.next().unwrap_or("").trim();
            let version = lines.next().unwrap_or("").trim();
            let cli = match cli {
                "CLI_OK" => "ok",
                "CLI_MISSING" => "missing",
                _ => return None,
            };
            let auth = match auth {
                "AUTH_OK" => "ok",
                "AUTH_MISSING" => "missing",
                _ => return None,
            };
            return Some(ParsedProbe {
                cli: cli.into(),
                auth: auth.into(),
                path: if path.is_empty() {
                    None
                } else {
                    Some(path.to_string())
                },
                version: if version.is_empty() {
                    None
                } else {
                    Some(version.to_string())
                },
            });
        }
    }
    None
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedProbe {
    pub cli: String,
    pub auth: String,
    pub path: Option<String>,
    pub version: Option<String>,
}

fn fs_read(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

#[tauri::command]
pub async fn ssh_list_hosts() -> Result<SshListResult, String> {
    let config_path = default_ssh_config_path();
    let config_exists = config_path.is_file();
    let ssh_found = find_ssh_binary().is_some();
    let text = if config_exists {
        std::fs::read_to_string(&config_path).unwrap_or_default()
    } else {
        String::new()
    };
    let base = config_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(process_util::user_home);
    let hosts = if config_exists {
        parse_ssh_config(&text, &base, &fs_read)
    } else {
        Vec::new()
    };
    Ok(SshListResult {
        hosts,
        config_path: config_path.to_string_lossy().into_owned(),
        config_exists,
        ssh_found,
        error: None,
    })
}

#[tauri::command]
pub async fn ssh_test_host(alias: String) -> Result<SshProbeResult, String> {
    let alias = alias.trim().to_string();
    if !is_safe_ssh_alias(&alias) {
        return Ok(empty_probe(
            &alias,
            "invalid_alias",
            "Host alias is not a concrete OpenSSH Host name",
        ));
    }
    let Some(ssh) = find_ssh_binary() else {
        return Ok(empty_probe(
            &alias,
            "ssh_missing",
            "OpenSSH client (ssh) was not found on this machine",
        ));
    };

    let (install_cmd, login_cmd, install_remote_cmd, login_remote_cmd) = commands_for_alias(&alias);

    let mut cmd = Command::new(&ssh);
    process_util::apply_cli_env_tokio(&mut cmd);
    cmd.arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg(format!("ConnectTimeout={SSH_CONNECT_TIMEOUT_SECS}"))
        .arg("-o")
        .arg("PasswordAuthentication=no")
        .arg("-o")
        .arg("KbdInteractiveAuthentication=no")
        .arg("-o")
        .arg("StrictHostKeyChecking=yes")
        .arg(&alias)
        .arg(wrap_remote_posix(REMOTE_PROBE))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let started = Instant::now();
    let joined = timeout(Duration::from_secs(SSH_OVERALL_TIMEOUT_SECS), cmd.output()).await;
    let latency_ms = started.elapsed().as_millis() as u64;

    let output = match joined {
        Err(_) => {
            return Ok(SshProbeResult {
                alias,
                ok: false,
                ssh_ok: false,
                cli: "unknown".into(),
                auth: "unknown".into(),
                cli_path: None,
                cli_version: None,
                error: Some("Connection timed out".into()),
                error_code: Some("timeout".into()),
                latency_ms: Some(latency_ms),
                install_cmd,
                login_cmd,
                install_remote_cmd,
                login_remote_cmd,
            });
        }
        Ok(Err(e)) => {
            return Ok(SshProbeResult {
                alias,
                ok: false,
                ssh_ok: false,
                cli: "unknown".into(),
                auth: "unknown".into(),
                cli_path: None,
                cli_version: None,
                error: Some(truncate_err(&e.to_string())),
                error_code: Some("other".into()),
                latency_ms: Some(latency_ms),
                install_cmd,
                login_cmd,
                install_remote_cmd,
                login_remote_cmd,
            });
        }
        Ok(Ok(o)) => o,
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        let (code, msg) = classify_ssh_stderr(&stderr);
        return Ok(SshProbeResult {
            alias,
            ok: false,
            ssh_ok: false,
            cli: "unknown".into(),
            auth: "unknown".into(),
            cli_path: None,
            cli_version: None,
            error: Some(msg),
            error_code: Some(code.into()),
            latency_ms: Some(latency_ms),
            install_cmd,
            login_cmd,
            install_remote_cmd,
            login_remote_cmd,
        });
    }

    match parse_probe_stdout(&stdout) {
        Some(p) => Ok(SshProbeResult {
            alias,
            ok: true,
            ssh_ok: true,
            cli: p.cli,
            auth: p.auth,
            cli_path: p.path,
            cli_version: p.version,
            error: None,
            error_code: None,
            latency_ms: Some(latency_ms),
            install_cmd,
            login_cmd,
            install_remote_cmd,
            login_remote_cmd,
        }),
        None => Ok(SshProbeResult {
            alias,
            ok: false,
            ssh_ok: true,
            cli: "unknown".into(),
            auth: "unknown".into(),
            cli_path: None,
            cli_version: None,
            error: Some(
                "SSH connected but the remote probe did not return GROK_APP_PROBE (need a POSIX login shell)"
                    .into(),
            ),
            error_code: Some("probe_parse".into()),
            latency_ms: Some(latency_ms),
            install_cmd,
            login_cmd,
            install_remote_cmd,
            login_remote_cmd,
        }),
    }
}

