pub fn posix_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Join a remote POSIX project root with a relative path. Rejects `..`.
pub fn join_remote_rel(root: &str, relative: &str) -> Result<String, String> {
    let root = root.trim().trim_end_matches('/');
    if root.is_empty() || !root.starts_with('/') || root.contains('\0') {
        return Err("invalid remote project root".into());
    }
    if relative.contains('\0') {
        return Err("invalid path".into());
    }
    let rel = relative
        .trim()
        .trim_start_matches("./")
        .trim_start_matches('/');
    let mut parts: Vec<&str> = root.split('/').filter(|s| !s.is_empty()).collect();
    if !rel.is_empty() && rel != "." {
        for c in rel.split('/') {
            if c.is_empty() || c == "." {
                continue;
            }
            if c == ".." {
                return Err("path escapes project root".into());
            }
            parts.push(c);
        }
    }
    Ok(format!("/{}", parts.join("/")))
}

fn remote_file_kind(name: &str) -> &'static str {
    let ext = std::path::Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "md" | "mdx" | "markdown" => "markdown",
        "json" | "jsonc" => "json",
        "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "java" | "toml" | "yml" | "yaml"
        | "css" | "html" | "sh" => "code",
        _ => "text",
    }
}

fn remote_file_mime(kind: &str) -> &'static str {
    match kind {
        "markdown" => "text/markdown",
        "json" => "application/json",
        "code" => "text/plain",
        _ => "text/plain",
    }
}

pub fn percent_decode_path(enc: &str) -> String {
    let bytes = enc.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) =
                u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16)
            {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn ensure_control_dir() -> Result<PathBuf, String> {
    let dir = control_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create SSH control dir: {e}"))?;
    Ok(dir)
}

fn control_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("GROK_APP_SSH_CM") {
        return PathBuf::from(custom);
    }
    // macOS data_dir is `Library/Application Support/...` (spaces). OpenSSH
    // parses `-o` as a config line, so an unquoted ControlPath there becomes
    // `keyword controlpath extra arguments at end of line`. cache_dir is
    // `Library/Caches/...` and shorter for AF_UNIX sun_path.
    directories::ProjectDirs::from("com", "grokapp", "grok-app")
        .map(|p| p.cache_dir().join("ssh-cm"))
        .unwrap_or_else(|| std::env::temp_dir().join("grok-app-ssh-cm"))
}

fn control_socket_name(alias: &str) -> String {
    // AF_UNIX sun_path is ~104–108 bytes. Windows AppData prefixes eat most of
    // that, and aliases may be up to 255 chars. Keep the filename short.
    const MAX: usize = 32;
    let compact = alias.len() <= MAX
        && alias
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'));
    if compact {
        return format!("{alias}.sock");
    }
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    alias.hash(&mut h);
    format!("{:016x}.sock", h.finish())
}

fn control_path(alias: &str) -> PathBuf {
    control_dir().join(control_socket_name(alias))
}

/// Native Windows OpenSSH has no reliable ControlMaster / `ssh -f`.
/// macOS and Linux keep mux. Tests lock the split.
pub fn ssh_control_master_enabled() -> bool {
    !cfg!(windows)
}

/// Run the POSIX snippet via `/bin/sh -c` so fish/zsh login shells on Linux
/// do not parse `[` / `export`. One ssh remote argv — never extra words after
/// `bash -lc` (OpenSSH joins those into the same `-c` string).
fn wrap_remote_posix(script: &str) -> String {
    format!("exec /bin/sh -c {}", posix_single_quote(script))
}

/// `-o KEY=VALUE` is a ssh_config line. Quote values that contain spaces.
fn ssh_config_assignment(key: &str, value: &str) -> String {
    if ssh_config_value_needs_quotes(value) {
        format!("{key}=\"{}\"", escape_ssh_config_value(value))
    } else {
        format!("{key}={value}")
    }
}

fn ssh_config_value_needs_quotes(value: &str) -> bool {
    value.is_empty()
        || value.bytes().any(|b| {
            matches!(
                b,
                b' ' | b'\t' | b'"' | b'\'' | b'#' | b'\\' | b'=' | b'\n' | b'\r'
            )
        })
}

fn escape_ssh_config_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn push_ssh_opt(cmd: &mut Command, key: &str, value: impl AsRef<str>) {
    cmd.arg("-o")
        .arg(ssh_config_assignment(key, value.as_ref()));
}

fn apply_base_ssh_opts(cmd: &mut Command) {
    push_ssh_opt(cmd, "BatchMode", "yes");
    push_ssh_opt(cmd, "ConnectTimeout", SSH_CONNECT_TIMEOUT_SECS.to_string());
    push_ssh_opt(cmd, "PasswordAuthentication", "no");
    push_ssh_opt(cmd, "KbdInteractiveAuthentication", "no");
    push_ssh_opt(cmd, "StrictHostKeyChecking", "yes");
}

fn apply_control_opts(cmd: &mut Command, alias: &str, master: &str) {
    if !ssh_control_master_enabled() {
        return;
    }
    push_ssh_opt(cmd, "ControlMaster", master);
    push_ssh_opt(
        cmd,
        "ControlPath",
        control_path(alias).to_string_lossy().as_ref(),
    );
    push_ssh_opt(cmd, "ControlPersist", "yes");
}

fn push_control_opts_argv(args: &mut Vec<String>, alias: &str, master: &str) {
    if !ssh_control_master_enabled() {
        return;
    }
    push_ssh_opt_argv(args, "ControlMaster", master);
    push_ssh_opt_argv(
        args,
        "ControlPath",
        control_path(alias).to_string_lossy().as_ref(),
    );
    push_ssh_opt_argv(args, "ControlPersist", "yes");
}

fn apply_common_ssh_opts(cmd: &mut Command, alias: &str, mux: bool) {
    apply_base_ssh_opts(cmd);
    if mux {
        apply_control_opts(cmd, alias, "auto");
    }
}

fn push_ssh_opt_argv(args: &mut Vec<String>, key: &str, value: &str) {
    args.push("-o".into());
    args.push(ssh_config_assignment(key, value));
}

/// `ssh -tt` argv: ControlMaster + remote login shell in the project cwd.
/// Alias is its own argv word. Remote cwd is POSIX-quoted inside the remote snippet.
pub fn ssh_pty_argv(alias: &str, remote_cwd: Option<&str>) -> Result<Vec<String>, String> {
    if !is_safe_ssh_alias(alias) {
        return Err("invalid SSH host alias".into());
    }
    let ssh = find_ssh_binary()
        .ok_or_else(|| "OpenSSH client (ssh) was not found on this machine".to_string())?;
    let _ = ensure_control_dir();
    let mut args = vec![ssh.to_string_lossy().into_owned(), "-tt".to_string()];
    push_ssh_opt_argv(&mut args, "BatchMode", "yes");
    push_ssh_opt_argv(
        &mut args,
        "ConnectTimeout",
        &SSH_CONNECT_TIMEOUT_SECS.to_string(),
    );
    push_ssh_opt_argv(&mut args, "PasswordAuthentication", "no");
    push_ssh_opt_argv(&mut args, "KbdInteractiveAuthentication", "no");
    push_ssh_opt_argv(&mut args, "StrictHostKeyChecking", "yes");
    push_ssh_opt_argv(&mut args, "RequestTTY", "yes");
    push_control_opts_argv(&mut args, alias, "auto");
    args.push(alias.to_string());
    args.push(wrap_remote_posix(&ssh_pty_remote_cmd(remote_cwd)));
    Ok(args)
}

/// Remote launch header for ACP stdio. Cwd and grok flags are appended as
/// POSIX-quoted words. OpenSSH joins the remote command into one `-c` string,
/// so extra argv after `bash -lc` is not a real argv array.
const REMOTE_ACP_HEADER: &str = r#"export PATH="$HOME/.grok/bin:$PATH"
BIN=$(command -v grok 2>/dev/null || true)
if [ -z "$BIN" ] && [ -x "$HOME/.grok/bin/grok" ]; then BIN="$HOME/.grok/bin/grok"; fi
if [ -z "$BIN" ]; then echo GROK_APP_CLI_MISSING >&2; exit 127; fi
"#;

/// Start (or reuse) `grok agent leader --no-exit-on-disconnect` on the host
/// so a dropped SSH stdio client can reconnect. Fail open to `--no-leader`
/// when the socket never appears (old CLI / start failed).
const REMOTE_ACP_LEADER: &str = r#"SOCK="${GROK_LEADER_SOCKET:-$HOME/.grok/leader.sock}"
if [ ! -S "$SOCK" ]; then
  mkdir -p "$(dirname "$SOCK")" 2>/dev/null || true
  nohup "$BIN" agent leader --no-exit-on-disconnect --no-auto-update --leader-socket "$SOCK" </dev/null >/dev/null 2>&1 &
  n=0
  while [ "$n" -lt 3 ] && [ ! -S "$SOCK" ]; do
    sleep 1
    n=$((n+1))
  done
fi
if [ -S "$SOCK" ]; then
  LEADER_FLAG=--leader
else
  LEADER_FLAG=--no-leader
fi
"#;

/// One remote `-c` script: cd + `exec grok <quoted flags>`. Never interpolates the alias.
pub fn ssh_acp_remote_command(remote_cwd: &str, grok_args: &[String]) -> Result<String, String> {
    if remote_cwd.contains('\0') || grok_args.iter().any(|a| a.contains('\0')) {
        return Err("invalid remote ACP command".into());
    }
    let mut script = REMOTE_ACP_HEADER.to_string();
    script.push_str(REMOTE_ACP_LEADER);
    let dir = remote_cwd.trim();
    if !dir.is_empty() {
        let q = posix_single_quote(dir);
        script.push_str(&format!(
            "DIR={q}\ncase \"$DIR\" in ~*) DIR=\"$HOME${{DIR#~}}\" ;; esac\nif [ -d \"$DIR\" ]; then cd \"$DIR\" || exit 1; fi\n"
        ));
    }
    script.push_str("exec \"$BIN\"");
    for a in grok_args {
        if a == "--leader" || a == "--no-leader" {
            continue;
        }
        script.push(' ');
        script.push_str(&posix_single_quote(a));
        if a == "agent" {
            script.push_str(" \"$LEADER_FLAG\"");
        }
    }
    script.push('\n');
    Ok(script)
}

/// `ssh -T` argv: ControlMaster + a single remote script (cwd and grok flags inside).
pub fn ssh_acp_argv(
    alias: &str,
    remote_cwd: &str,
    grok_args: &[String],
) -> Result<Vec<String>, String> {
    if !is_safe_ssh_alias(alias) {
        return Err("invalid SSH host alias".into());
    }
    let ssh = find_ssh_binary()
        .ok_or_else(|| "OpenSSH client (ssh) was not found on this machine".to_string())?;
    let _ = ensure_control_dir();
    let mut args = vec![ssh.to_string_lossy().into_owned(), "-T".to_string()];
    push_ssh_opt_argv(&mut args, "BatchMode", "yes");
    push_ssh_opt_argv(
        &mut args,
        "ConnectTimeout",
        &SSH_CONNECT_TIMEOUT_SECS.to_string(),
    );
    push_ssh_opt_argv(&mut args, "PasswordAuthentication", "no");
    push_ssh_opt_argv(&mut args, "KbdInteractiveAuthentication", "no");
    push_ssh_opt_argv(&mut args, "StrictHostKeyChecking", "yes");
    push_ssh_opt_argv(&mut args, "RequestTTY", "no");
    push_control_opts_argv(&mut args, alias, "auto");
    args.push(alias.to_string());
    args.push(wrap_remote_posix(&ssh_acp_remote_command(
        remote_cwd, grok_args,
    )?));
    Ok(args)
}

/// Local `ssh` process whose remote side execs `grok agent stdio` in `remote_cwd`.
pub fn start_ssh_acp_command(
    alias: &str,
    remote_cwd: &str,
    grok_args: &[String],
) -> Result<tokio::process::Command, String> {
    let argv = ssh_acp_argv(alias, remote_cwd, grok_args)?;
    let mut cmd = tokio::process::Command::new(&argv[0]);
    crate::process_util::apply_cli_env_tokio(&mut cmd);
    for a in argv.iter().skip(1) {
        cmd.arg(a);
    }
    Ok(cmd)
}

/// Remote snippet for an interactive PTY. Never interpolates the alias.
pub fn ssh_pty_remote_cmd(remote_cwd: Option<&str>) -> String {
    let dir = remote_cwd
        .map(str::trim)
        .filter(|s| !s.is_empty() && !s.contains('\0'))
        .unwrap_or("");
    if dir.is_empty() {
        return "exec ${SHELL:-bash} -l".to_string();
    }
    let q = posix_single_quote(dir);
    format!(
        "DIR={q}; case \"$DIR\" in ~*) DIR=\"$HOME${{DIR#~}}\" ;; esac; if [ -d \"$DIR\" ]; then cd \"$DIR\" || true; fi; exec ${{SHELL:-bash}} -l"
    )
}

struct SshRun {
    success: bool,
    stdout: String,
    stderr: String,
}

enum SshRunErr {
    Missing,
    Timeout,
    Spawn(String),
}

async fn run_ssh(alias: &str, remote: &str, mux: bool, secs: u64) -> Result<SshRun, SshRunErr> {
    run_ssh_io(alias, remote, mux, secs, None).await
}

async fn run_ssh_io(
    alias: &str,
    remote: &str,
    mux: bool,
    secs: u64,
    stdin: Option<&[u8]>,
) -> Result<SshRun, SshRunErr> {
    let ssh = find_ssh_binary().ok_or(SshRunErr::Missing)?;
    let mut cmd = Command::new(&ssh);
    process_util::apply_cli_env_tokio(&mut cmd);
    apply_common_ssh_opts(&mut cmd, alias, mux);
    cmd.arg(alias).arg(wrap_remote_posix(remote));
    if stdin.is_some() {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }
    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let fut = async {
        if let Some(bytes) = stdin {
            let mut child = cmd.spawn().map_err(|e| e.to_string())?;
            if let Some(mut sin) = child.stdin.take() {
                use tokio::io::AsyncWriteExt;
                sin.write_all(bytes).await.map_err(|e| e.to_string())?;
                drop(sin);
            }
            child.wait_with_output().await.map_err(|e| e.to_string())
        } else {
            cmd.output().await.map_err(|e| e.to_string())
        }
    };
    match timeout(Duration::from_secs(secs), fut).await {
        Err(_) => Err(SshRunErr::Timeout),
        Ok(Err(e)) => Err(SshRunErr::Spawn(e)),
        Ok(Ok(o)) => Ok(SshRun {
            success: o.status.success(),
            stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
        }),
    }
}

fn remote_ls_script(dir: &str) -> String {
    let q = posix_single_quote(dir);
    format!(
        r#"DIR={q}
if [ -z "$DIR" ]; then DIR="$HOME"; fi
case "$DIR" in
  ~*) DIR="$HOME${{DIR#~}}" ;;
esac
if [ ! -d "$DIR" ]; then
  echo GROK_APP_LS_ERR
  echo not_a_dir
  exit 0
fi
cd "$DIR" || {{ echo GROK_APP_LS_ERR; echo cd_fail; exit 0; }}
echo GROK_APP_LS
pwd
ls -1p 2>/dev/null | head -n 400
exit 0
"#
    )
}

fn remote_sess_script(offset: u32, limit: u32) -> String {
    let offset = offset.min(50_000);
    let limit = limit.clamp(1, 50);
    format!(
        r#"OFFSET={offset} LIMIT={limit}
SESS="$HOME/.grok/sessions"
if command -v python3 >/dev/null 2>&1; then
  OFFSET="$OFFSET" LIMIT="$LIMIT" python3 -c '
import json, os
root = os.path.expanduser("~/.grok/sessions")
off = int(os.environ.get("OFFSET", "0"))
lim = int(os.environ.get("LIMIT", "20"))
rows = []
if os.path.isdir(root):
    for enc in os.listdir(root):
        base = os.path.join(root, enc)
        if not os.path.isdir(base):
            continue
        for sid in os.listdir(base):
            d = os.path.join(base, sid)
            if not os.path.isdir(d) or sid.startswith("."):
                continue
            sp = os.path.join(d, "summary.json")
            kind = ""
            title = ""
            if os.path.isfile(sp):
                try:
                    s = json.load(open(sp))
                    kind = str(s.get("session_kind") or "").strip().lower()
                    title = (s.get("generated_title") or s.get("session_summary") or s.get("title") or "").strip()
                except Exception:
                    pass
            if kind.startswith("subagent"):
                continue
            up = os.path.join(d, "updates.jsonl")
            has_up = os.path.isfile(up) and os.path.getsize(up) > 0
            if not has_up and not title:
                continue
            try:
                mt = os.path.getmtime(d)
            except OSError:
                continue
            rows.append((mt, sid, enc, d, title))
rows.sort(reverse=True)
print("GROK_APP_SESS")
print("TOTAL\t%d" % len(rows))
for mt, sid, enc, d, title in rows[off:off+lim]:
    if not title:
        hp = os.path.join(d, "chat_history.jsonl")
        if os.path.isfile(hp):
            try:
                f = open(hp)
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        o = json.loads(line)
                    except Exception:
                        continue
                    role = o.get("type") or o.get("role") or ""
                    if role != "user":
                        continue
                    c = o.get("content")
                    text = ""
                    if isinstance(c, str):
                        text = c
                    elif isinstance(c, list):
                        bits = []
                        for p in c:
                            if isinstance(p, str):
                                bits.append(p)
                            elif isinstance(p, dict):
                                bits.append(str(p.get("text") or ""))
                        text = " ".join(bits)
                    text = text.strip()
                    if not text:
                        continue
                    if "<user_query>" in text:
                        a = text.find("<user_query>") + 12
                        b = text.find("</user_query>", a)
                        chunk = text[a:b] if b > a else text[a:]
                        title = chunk.strip().splitlines()[0].strip() if chunk.strip() else ""
                        if title:
                            break
                        continue
                    if "<system-reminder>" in text or "<user_info>" in text:
                        continue
                    title = text.splitlines()[0].strip()
                    if title:
                        break
                f.close()
            except Exception:
                pass
    title = title.replace("\t", " ").replace("\n", " ").replace("\r", " ")[:160]
    print("%s\t%s\t%d\t%s" % (sid, enc, int(mt), title))
' && exit 0
fi
echo GROK_APP_SESS
if [ ! -d "$SESS" ]; then
  echo "TOTAL	0"
  exit 0
fi
tmp=$(mktemp 2>/dev/null || echo /tmp/grok-app-sess.$$)
find "$SESS" -mindepth 2 -maxdepth 2 -type d 2>/dev/null | while IFS= read -r d; do
  if [ -f "$d/summary.json" ] && grep -q '"session_kind"[[:space:]]*:[[:space:]]*"subagent' "$d/summary.json" 2>/dev/null; then
    continue
  fi
  if [ ! -s "$d/updates.jsonl" ]; then
    if [ ! -f "$d/summary.json" ] || ! grep -q '"generated_title"[[:space:]]*:[[:space:]]*"[^"]' "$d/summary.json" 2>/dev/null; then
      continue
    fi
  fi
  mt=$(stat -c %Y "$d" 2>/dev/null || date -r "$d" +%s 2>/dev/null || echo 0)
  printf "%s\t%s\n" "$mt" "$d"
done | sort -nr > "$tmp"
total=$(wc -l < "$tmp" | tr -d " ")
echo "TOTAL	$total"
i=0
while IFS= read -r line; do
  i=$((i + 1))
  if [ "$i" -le "$OFFSET" ]; then continue; fi
  if [ "$i" -gt $((OFFSET + LIMIT)) ]; then break; fi
  mt=${{line%%	*}}
  d=${{line#*	}}
  id=$(basename "$d")
  enc=$(basename "$(dirname "$d")")
  title=""
  if [ -f "$d/summary.json" ]; then
    title=$(sed -n "s/.*\"generated_title\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$d/summary.json" | head -n 1)
  fi
  printf "%s\t%s\t%s\t%s\n" "$id" "$enc" "$mt" "$title"
done < "$tmp"
rm -f "$tmp"
exit 0
"#
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDirEntry {
    pub name: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshListDirResult {
    pub ok: bool,
    pub alias: String,
    pub path: String,
    pub entries: Vec<SshDirEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshRemoteSession {
    pub id: String,
    pub cwd: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshListSessionsResult {
    pub ok: bool,
    pub alias: String,
    pub sessions: Vec<SshRemoteSession>,
    #[serde(default)]
    pub total: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshWatchResult {
    pub ok: bool,
    pub alias: String,
    pub watching: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug)]
enum RemoteLsParse {
    Ok {
        path: String,
        entries: Vec<SshDirEntry>,
    },
    NotADir,
    CdFail,
    Unparseable,
}

fn parse_ls_stdout(stdout: &str) -> RemoteLsParse {
    let mut lines = stdout.lines().map(|l| l.trim_end_matches('\r'));
    while let Some(line) = lines.next() {
        if line.trim() == "GROK_APP_LS_ERR" {
            let code = lines.next().unwrap_or("").trim();
            return match code {
                "not_a_dir" => RemoteLsParse::NotADir,
                "cd_fail" => RemoteLsParse::CdFail,
                _ => RemoteLsParse::Unparseable,
            };
        }
        if line.trim() == "GROK_APP_LS" {
            let path = lines.next().unwrap_or("").trim().to_string();
            let mut entries = Vec::new();
            for rest in lines {
                let name = rest.trim();
                if name.is_empty() || name == "." || name == ".." {
                    continue;
                }
                let is_dir = name.ends_with('/');
                let name = name.trim_end_matches('/').to_string();
                if name.is_empty() {
                    continue;
                }
                entries.push(SshDirEntry { name, is_dir });
            }
            return RemoteLsParse::Ok { path, entries };
        }
    }
    RemoteLsParse::Unparseable
}

pub fn parse_sess_stdout(stdout: &str) -> Option<(u32, Vec<SshRemoteSession>)> {
    let mut lines = stdout.lines().map(|l| l.trim_end_matches('\r'));
    while let Some(line) = lines.next() {
        if line.trim() != "GROK_APP_SESS" {
            continue;
        }
        let mut sessions = Vec::new();
        let mut total: Option<u32> = None;
        for rest in lines {
            let rest = rest.trim();
            if rest.is_empty() {
                continue;
            }
            if rest.starts_with("TOTAL") {
                let n = rest
                    .split(['\t', ' '])
                    .nth(1)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                total = Some(n);
                continue;
            }
            let mut parts = rest.splitn(4, '\t');
            let id = parts.next().unwrap_or("").trim();
            let enc = parts.next().unwrap_or("").trim();
            let mtime = parts.next().unwrap_or("").trim();
            let title = parts.next().unwrap_or("").trim();
            if id.is_empty() {
                continue;
            }
            sessions.push(SshRemoteSession {
                id: id.to_string(),
                cwd: percent_decode_path(enc),
                title: title.to_string(),
                updated_at: unix_mtime_to_rfc3339(mtime),
            });
        }
        let total = total.unwrap_or(sessions.len() as u32);
        return Some((total, sessions));
    }
    None
}

fn persist_watch_alias(alias: &str, on: bool) -> Result<Vec<String>, String> {
    let mut s = crate::store::load_settings();
    let mut set: Vec<String> = s
        .ssh_watch_aliases
        .into_iter()
        .filter(|a| is_safe_ssh_alias(a))
        .collect();
    if on {
        if !set.iter().any(|a| a == alias) {
            set.push(alias.to_string());
        }
    } else {
        set.retain(|a| a != alias);
    }
    s.ssh_watch_aliases = set.clone();
    crate::store::save_settings(&s)?;
    Ok(set)
}

#[tauri::command]
pub async fn ssh_watch_start(alias: String) -> Result<SshWatchResult, String> {
    let alias = alias.trim().to_string();
    if !is_safe_ssh_alias(&alias) {
        return Ok(SshWatchResult {
            ok: false,
            alias,
            watching: false,
            error: Some("Host alias is not a concrete OpenSSH Host name".into()),
            error_code: Some("invalid_alias".into()),
        });
    }
    let Some(ssh) = find_ssh_binary() else {
        return Ok(SshWatchResult {
            ok: false,
            alias,
            watching: false,
            error: Some("OpenSSH client (ssh) was not found on this machine".into()),
            error_code: Some("ssh_missing".into()),
        });
    };
    if ssh_control_master_enabled() {
        let dir = control_dir();
        if let Err(e) = std::fs::create_dir_all(&dir) {
            return Ok(SshWatchResult {
                ok: false,
                alias,
                watching: false,
                error: Some(format!("Could not create SSH control dir: {e}")),
                error_code: Some("other".into()),
            });
        }
        let path = control_path(&alias);
        let mut cmd = Command::new(&ssh);
        process_util::apply_cli_env_tokio(&mut cmd);
        apply_base_ssh_opts(&mut cmd);
        apply_control_opts(&mut cmd, &alias, "yes");
        cmd.arg("-fN")
            .arg(&alias)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let out = timeout(Duration::from_secs(SSH_OVERALL_TIMEOUT_SECS), cmd.output()).await;
        match out {
            Err(_) => {
                return Ok(SshWatchResult {
                    ok: false,
                    alias,
                    watching: false,
                    error: Some("Connection timed out".into()),
                    error_code: Some("timeout".into()),
                });
            }
            Ok(Err(e)) => {
                return Ok(SshWatchResult {
                    ok: false,
                    alias,
                    watching: false,
                    error: Some(truncate_err(&e.to_string())),
                    error_code: Some("other".into()),
                });
            }
            Ok(Ok(o)) if !o.status.success() => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                let mut check = Command::new(&ssh);
                process_util::apply_cli_env_tokio(&mut check);
                check.arg("-O").arg("check");
                push_ssh_opt(&mut check, "ControlPath", path.to_string_lossy().as_ref());
                check
                    .arg(&alias)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                let already = timeout(Duration::from_secs(3), check.output())
                    .await
                    .ok()
                    .and_then(|r| r.ok())
                    .map(|c| c.status.success())
                    .unwrap_or(false);
                if !already {
                    let (code, msg) = classify_ssh_stderr(&stderr);
                    return Ok(SshWatchResult {
                        ok: false,
                        alias,
                        watching: false,
                        error: Some(msg),
                        error_code: Some(code.into()),
                    });
                }
            }
            Ok(Ok(_)) => {}
        }
    } else {
        // Windows OpenSSH cannot mux (`ssh -f` / ControlMaster). Reachability
        // is enough to mark the host watched; later commands open their own SSH.
        let mut cmd = Command::new(&ssh);
        process_util::apply_cli_env_tokio(&mut cmd);
        apply_base_ssh_opts(&mut cmd);
        cmd.arg(&alias)
            .arg(wrap_remote_posix("true"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        let out = timeout(Duration::from_secs(SSH_OVERALL_TIMEOUT_SECS), cmd.output()).await;
        match out {
            Err(_) => {
                return Ok(SshWatchResult {
                    ok: false,
                    alias,
                    watching: false,
                    error: Some("Connection timed out".into()),
                    error_code: Some("timeout".into()),
                });
            }
            Ok(Err(e)) => {
                return Ok(SshWatchResult {
                    ok: false,
                    alias,
                    watching: false,
                    error: Some(truncate_err(&e.to_string())),
                    error_code: Some("other".into()),
                });
            }
            Ok(Ok(o)) if !o.status.success() => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                let (code, msg) = classify_ssh_stderr(&stderr);
                return Ok(SshWatchResult {
                    ok: false,
                    alias,
                    watching: false,
                    error: Some(msg),
                    error_code: Some(code.into()),
                });
            }
            Ok(Ok(_)) => {}
        }
    }
    persist_watch_alias(&alias, true)?;
    Ok(SshWatchResult {
        ok: true,
        alias,
        watching: true,
        error: None,
        error_code: None,
    })
}

#[tauri::command]
pub async fn ssh_watch_stop(alias: String) -> Result<SshWatchResult, String> {
    let alias = alias.trim().to_string();
    if !is_safe_ssh_alias(&alias) {
        return Ok(SshWatchResult {
            ok: false,
            alias,
            watching: false,
            error: Some("Host alias is not a concrete OpenSSH Host name".into()),
            error_code: Some("invalid_alias".into()),
        });
    }
    if ssh_control_master_enabled() {
        if let Some(ssh) = find_ssh_binary() {
            let path = control_path(&alias);
            let mut cmd = Command::new(&ssh);
            process_util::apply_cli_env_tokio(&mut cmd);
            cmd.arg("-O").arg("exit");
            push_ssh_opt(&mut cmd, "ControlPath", path.to_string_lossy().as_ref());
            cmd.arg(&alias)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            let _ = timeout(Duration::from_secs(5), cmd.output()).await;
        }
    }
    persist_watch_alias(&alias, false)?;
    Ok(SshWatchResult {
        ok: true,
        alias,
        watching: false,
        error: None,
        error_code: None,
    })
}

