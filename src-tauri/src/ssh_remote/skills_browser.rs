// ── Remote skills (`grok inspect --json` + project `.grok/skills`) ─────────

#[derive(Debug, Clone)]
pub struct SshSkillRow {
    pub name: String,
    pub description: String,
    pub source: String,
    pub path: Option<String>,
    pub user_invocable: bool,
}

#[derive(Debug, Clone)]
pub struct SshSkillsFetch {
    pub inspect: Option<serde_json::Value>,
    pub error: Option<String>,
    pub project_skills: Vec<SshSkillRow>,
}

fn remote_inspect_script(project_path: Option<&str>) -> String {
    let dir = project_path
        .map(str::trim)
        .filter(|s| !s.is_empty() && !s.contains('\0'))
        .unwrap_or("");
    let q = posix_single_quote(dir);
    format!(
        r#"export PATH="$HOME/.grok/bin:$PATH"
DIR={q}
if [ -n "$DIR" ]; then
  case "$DIR" in
    ~*) DIR="$HOME${{DIR#~}}" ;;
  esac
  if [ -d "$DIR" ]; then
    cd "$DIR" || true
  fi
fi
BIN=""
if command -v grok >/dev/null 2>&1; then
  BIN=$(command -v grok)
elif [ -x "$HOME/.grok/bin/grok" ]; then
  BIN="$HOME/.grok/bin/grok"
fi
echo GROK_APP_INSPECT
if [ -z "$BIN" ]; then
  echo MISSING
  exit 0
fi
echo OK
"$BIN" inspect --json
exit 0
"#
    )
}

const REMOTE_SKILLS_PY: &str = r##"python3 -c '
import json, os, sys
root = os.environ.get("GROK_APP_SKILLS_ROOT", "")
out = []
def meta(text):
    name = None
    desc = ""
    inv = True
    t = text.lstrip("\ufeff")
    if not t.startswith("---"):
        return name, desc, inv
    rest = t[3:]
    if rest.startswith("\n"):
        rest = rest[1:]
    end = rest.find("\n---")
    block = rest if end < 0 else rest[:end]
    q = chr(39)
    for line in block.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or ":" not in s:
            continue
        k, v = s.split(":", 1)
        k = k.strip().lower()
        v = v.strip()
        if len(v) >= 2 and ((v[0] == chr(34) and v[-1] == chr(34)) or (v[0] == q and v[-1] == q)):
            v = v[1:-1]
        if k == "name" and v.strip():
            name = v.strip()
        elif k == "description":
            desc = v
        elif k in ("user-invocable", "user_invocable", "userinvocable"):
            inv = v.strip().lower() not in ("false", "no", "0", "off")
    return name, desc, inv
if root and os.path.isdir(root):
    names = sorted(os.listdir(root))[:500]
    for name in names:
        if not name or name.startswith("."):
            continue
        d = os.path.join(root, name)
        if not os.path.isdir(d):
            continue
        md = os.path.join(d, "SKILL.md")
        if not os.path.isfile(md):
            md = os.path.join(d, "skill.md")
        if not os.path.isfile(md):
            continue
        try:
            raw = open(md, "rb").read(65536)
        except Exception:
            raw = b""
        text = raw.decode("utf-8", "replace")
        n, desc, inv = meta(text)
        if not n:
            n = name
        out.append({"name": n, "description": desc, "source": "project", "path": md, "userInvocable": inv})
sys.stdout.write("GROK_APP_SKILLS\n")
sys.stdout.write(json.dumps(out, ensure_ascii=False))
sys.stdout.write("\n")
sys.stdout.flush()
'
"##;

fn remote_project_skills_script(project_path: &str) -> String {
    let root = format!("{}/.grok/skills", project_path.trim().trim_end_matches('/'));
    format!(
        "export GROK_APP_SKILLS_ROOT={}\n{REMOTE_SKILLS_PY}",
        posix_single_quote(&root),
    )
}

fn parse_first_json_value(s: &str) -> Option<serde_json::Value> {
    let start = s.find('{')?;
    let slice = &s[start..];
    let mut de = serde_json::Deserializer::from_str(slice);
    serde::Deserialize::deserialize(&mut de).ok()
}

fn parse_inspect_stdout(stdout: &str) -> (Option<serde_json::Value>, Option<String>) {
    let Some(idx) = stdout.find("GROK_APP_INSPECT") else {
        return (None, Some("remote inspect failed".into()));
    };
    let rest = stdout[idx + "GROK_APP_INSPECT".len()..].trim_start();
    let status = rest.lines().next().unwrap_or("").trim();
    if status.eq_ignore_ascii_case("MISSING") {
        return (
            None,
            Some("Grok Build CLI not found on the remote host".into()),
        );
    }
    let after = rest.get(status.len()..).unwrap_or("").trim_start();
    match parse_first_json_value(after) {
        Some(v) => (Some(v), None),
        None => (None, Some("Failed to parse grok inspect JSON".into())),
    }
}

fn parse_remote_skills_stdout(stdout: &str) -> Vec<SshSkillRow> {
    let Some(v) = parse_marked_json(stdout, "GROK_APP_SKILLS") else {
        return Vec::new();
    };
    let Some(arr) = v.as_array() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for item in arr {
        let name = item
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let description = item
            .get("description")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let source = item
            .get("source")
            .and_then(|x| x.as_str())
            .unwrap_or("project")
            .to_string();
        let path = item
            .get("path")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        let user_invocable = item
            .get("userInvocable")
            .or_else(|| item.get("user_invocable"))
            .and_then(|x| x.as_bool())
            .unwrap_or(true);
        out.push(SshSkillRow {
            name,
            description,
            source,
            path,
            user_invocable,
        });
    }
    out
}

/// Remote `grok inspect --json` plus `{project}/.grok/skills` scan.
pub async fn ssh_fetch_skills(alias: &str, project_path: Option<&str>) -> SshSkillsFetch {
    if !is_safe_ssh_alias(alias) {
        return SshSkillsFetch {
            inspect: None,
            error: Some("invalid alias".into()),
            project_skills: Vec::new(),
        };
    }
    let inspect_script = remote_inspect_script(project_path);
    let scan_script = project_path
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.starts_with('/') && !s.contains('\0'))
        .map(remote_project_skills_script);

    let inspect_fut = run_ssh(alias, &inspect_script, true, SSH_INSPECT_TIMEOUT_SECS);
    let scan_fut = async {
        match scan_script.as_deref() {
            Some(s) => run_ssh(alias, s, true, SSH_OVERALL_TIMEOUT_SECS).await,
            None => Ok(SshRun {
                success: true,
                stdout: String::new(),
                stderr: String::new(),
            }),
        }
    };
    let (inspect_run, scan_run) = tokio::join!(inspect_fut, scan_fut);

    let (inspect, error) = match inspect_run {
        Err(e) => (None, Some(ssh_io_err(e))),
        Ok(run) if !run.success => {
            let (_c, msg) = classify_ssh_stderr(&run.stderr);
            (None, Some(msg))
        }
        Ok(run) => parse_inspect_stdout(&run.stdout),
    };

    let project_skills = match scan_run {
        Ok(run) => parse_remote_skills_stdout(&run.stdout),
        Err(_) => Vec::new(),
    };

    SshSkillsFetch {
        inspect,
        error,
        project_skills,
    }
}

// ── Embedded browser: loopback URLs via SSH -L ─────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshLoopbackTarget {
    pub scheme: String,
    pub host: String,
    pub port: u16,
    pub rest: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshBrowserPrepareResult {
    pub ok: bool,
    pub alias: String,
    pub url: String,
    pub display_url: String,
    pub tunneled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn is_loopback_http_host(host: &str) -> bool {
    let h = host
        .trim()
        .trim_matches(|c| c == '[' || c == ']')
        .to_ascii_lowercase();
    h == "localhost"
        || h == "127.0.0.1"
        || h == "::1"
        || h == "0.0.0.0"
        || h.ends_with(".localhost")
}

pub fn parse_loopback_http_url(raw: &str) -> Option<SshLoopbackTarget> {
    let u = url::Url::parse(raw.trim()).ok()?;
    if u.scheme() != "http" && u.scheme() != "https" {
        return None;
    }
    let host = u.host_str()?.to_ascii_lowercase();
    if !is_loopback_http_host(&host) {
        return None;
    }
    let port = u.port_or_known_default()?;
    let mut rest = String::new();
    rest.push_str(u.path());
    if let Some(q) = u.query() {
        rest.push('?');
        rest.push_str(q);
    }
    if let Some(f) = u.fragment() {
        rest.push('#');
        rest.push_str(f);
    }
    Some(SshLoopbackTarget {
        scheme: u.scheme().to_string(),
        host,
        port,
        rest,
    })
}

pub fn rewrite_loopback_url(target: &SshLoopbackTarget, local_port: u16) -> String {
    let rest = if target.rest.is_empty() {
        "/"
    } else {
        target.rest.as_str()
    };
    format!("{}://127.0.0.1:{local_port}{rest}", target.scheme)
}

fn forward_remote_host(host: &str) -> &'static str {
    let h = host
        .trim()
        .trim_matches(|c| c == '[' || c == ']')
        .to_ascii_lowercase();
    if h == "::1" {
        "::1"
    } else {
        "127.0.0.1"
    }
}

fn local_forward_spec(local_port: u16, remote_host: &str, remote_port: u16) -> String {
    if remote_host.contains(':') {
        format!("127.0.0.1:{local_port}:[{remote_host}]:{remote_port}")
    } else {
        format!("127.0.0.1:{local_port}:{remote_host}:{remote_port}")
    }
}

type SshTunnelKey = (String, String, u16);

fn tunnel_ports() -> &'static Mutex<HashMap<SshTunnelKey, u16>> {
    static M: OnceLock<Mutex<HashMap<SshTunnelKey, u16>>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(HashMap::new()))
}

fn pick_free_local_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("bind local port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("local addr: {e}"))?
        .port();
    drop(listener);
    if port == 0 {
        return Err("could not allocate a local port".into());
    }
    Ok(port)
}

async fn mux_ctl(alias: &str, op: &str, extra: &[String]) -> Result<SshRun, SshRunErr> {
    if !ssh_control_master_enabled() {
        return Err(SshRunErr::Spawn("SSH multiplex is not available".into()));
    }
    let ssh = find_ssh_binary().ok_or(SshRunErr::Missing)?;
    let mut cmd = Command::new(&ssh);
    process_util::apply_cli_env_tokio(&mut cmd);
    apply_base_ssh_opts(&mut cmd);
    push_ssh_opt(
        &mut cmd,
        "ControlPath",
        control_path(alias).to_string_lossy().as_ref(),
    );
    cmd.arg("-O").arg(op);
    for e in extra {
        cmd.arg(e);
    }
    cmd.arg(alias)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    match timeout(Duration::from_secs(SSH_CONNECT_TIMEOUT_SECS), cmd.output()).await {
        Err(_) => Err(SshRunErr::Timeout),
        Ok(Err(e)) => Err(SshRunErr::Spawn(e.to_string())),
        Ok(Ok(o)) => Ok(SshRun {
            success: o.status.success(),
            stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
        }),
    }
}

async fn mux_running(alias: &str) -> bool {
    matches!(mux_ctl(alias, "check", &[]).await, Ok(run) if run.success)
}

async fn ensure_mux(alias: &str) -> Result<(), String> {
    if !ssh_control_master_enabled() {
        return Ok(());
    }
    let _ = ensure_control_dir();
    if mux_running(alias).await {
        return Ok(());
    }
    let ssh = find_ssh_binary()
        .ok_or_else(|| "OpenSSH client (ssh) was not found on this machine".to_string())?;
    let mut cmd = Command::new(&ssh);
    process_util::apply_cli_env_tokio(&mut cmd);
    apply_base_ssh_opts(&mut cmd);
    apply_control_opts(&mut cmd, alias, "yes");
    cmd.arg("-fN")
        .arg(alias)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let out = timeout(Duration::from_secs(SSH_OVERALL_TIMEOUT_SECS), cmd.output()).await;
    match out {
        Err(_) => return Err("Connection timed out".into()),
        Ok(Err(e)) => return Err(e.to_string()),
        Ok(Ok(o)) => {
            if !o.status.success() && !mux_running(alias).await {
                let stderr = String::from_utf8_lossy(&o.stderr);
                let (_c, msg) = classify_ssh_stderr(&stderr);
                return Err(msg);
            }
        }
    }
    if mux_running(alias).await {
        Ok(())
    } else {
        Err("SSH multiplex master did not start".into())
    }
}

async fn spawn_dedicated_forward(alias: &str, spec: &str) -> Result<(), String> {
    let ssh = find_ssh_binary()
        .ok_or_else(|| "OpenSSH client (ssh) was not found on this machine".to_string())?;
    let mut cmd = Command::new(&ssh);
    process_util::apply_cli_env_tokio(&mut cmd);
    apply_common_ssh_opts(&mut cmd, alias, ssh_control_master_enabled());
    push_ssh_opt(&mut cmd, "ExitOnForwardFailure", "yes");
    cmd.arg("-N")
        .arg("-L")
        .arg(spec)
        .arg(alias)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(false);
    let mut child = cmd.spawn().map_err(|e| format!("ssh -L spawn: {e}"))?;
    tokio::time::sleep(Duration::from_millis(200)).await;
    match child.try_wait() {
        Ok(Some(st)) => {
            return Err(format!("SSH local forward exited ({st})"));
        }
        Ok(None) => {}
        Err(e) => return Err(format!("ssh -L wait: {e}")),
    }
    tauri::async_runtime::spawn(async move {
        let _ = child.wait().await;
    });
    Ok(())
}

async fn ensure_local_forward(
    alias: &str,
    remote_host: &str,
    remote_port: u16,
) -> Result<u16, String> {
    let key = (alias.to_string(), remote_host.to_string(), remote_port);
    if let Ok(g) = tunnel_ports().lock() {
        if let Some(port) = g.get(&key).copied() {
            return Ok(port);
        }
    }
    if ssh_control_master_enabled() {
        ensure_mux(alias).await?;
    }
    let local_port = pick_free_local_port()?;
    let spec = local_forward_spec(local_port, remote_host, remote_port);
    let extra = vec!["-L".to_string(), spec.clone()];
    let forwarded = ssh_control_master_enabled()
        && matches!(
            mux_ctl(alias, "forward", &extra).await,
            Ok(run) if run.success
        );
    if !forwarded {
        spawn_dedicated_forward(alias, &spec).await?;
    }
    if let Ok(mut g) = tunnel_ports().lock() {
        g.insert(key, local_port);
    }
    Ok(local_port)
}

fn browser_prepare_fail(
    alias: String,
    display_url: String,
    error: String,
) -> SshBrowserPrepareResult {
    SshBrowserPrepareResult {
        ok: false,
        alias,
        url: display_url.clone(),
        display_url,
        tunneled: false,
        local_port: None,
        remote_host: None,
        remote_port: None,
        error: Some(error),
    }
}

/// Rewrite loopback URLs through SSH -L so the embedded webview hits the remote host.
#[tauri::command]
pub async fn ssh_browser_prepare(
    alias: String,
    url: String,
) -> Result<SshBrowserPrepareResult, String> {
    let alias = alias.trim().to_string();
    let display_url = url.trim().to_string();
    if !is_safe_ssh_alias(&alias) {
        return Ok(browser_prepare_fail(
            alias,
            display_url,
            "invalid alias".into(),
        ));
    }
    let Some(target) = parse_loopback_http_url(&display_url) else {
        return Ok(SshBrowserPrepareResult {
            ok: true,
            alias,
            url: display_url.clone(),
            display_url,
            tunneled: false,
            local_port: None,
            remote_host: None,
            remote_port: None,
            error: None,
        });
    };
    let remote_host = forward_remote_host(&target.host);
    match ensure_local_forward(&alias, remote_host, target.port).await {
        Ok(local_port) => Ok(SshBrowserPrepareResult {
            ok: true,
            alias,
            url: rewrite_loopback_url(&target, local_port),
            display_url,
            tunneled: true,
            local_port: Some(local_port),
            remote_host: Some(remote_host.to_string()),
            remote_port: Some(target.port),
            error: None,
        }),
        Err(e) => Ok(browser_prepare_fail(alias, display_url, e)),
    }
}

fn unix_mtime_to_rfc3339(mtime: &str) -> Option<String> {
    let n: i64 = mtime.parse().ok()?;
    if n <= 0 {
        return None;
    }
    let secs = if n > 1_000_000_000_000 { n / 1000 } else { n };
    chrono::DateTime::from_timestamp(secs, 0).map(|d| d.to_rfc3339())
}

fn looks_like_agent_uuid(s: &str) -> bool {
    let s = s.trim();
    let b = s.as_bytes();
    b.len() == 36
        && b[8] == b'-'
        && b[13] == b'-'
        && b[18] == b'-'
        && b[23] == b'-'
        && s.bytes().all(|c| c == b'-' || c.is_ascii_hexdigit())
}
