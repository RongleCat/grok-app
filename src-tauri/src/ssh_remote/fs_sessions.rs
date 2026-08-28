#[tauri::command]
pub async fn ssh_list_dir(alias: String, path: Option<String>) -> Result<SshListDirResult, String> {
    let alias = alias.trim().to_string();
    if !is_safe_ssh_alias(&alias) {
        return Ok(SshListDirResult {
            ok: false,
            alias,
            path: path.unwrap_or_default(),
            entries: Vec::new(),
            error: Some("invalid alias".into()),
            error_code: Some("invalid_alias".into()),
        });
    }
    let dir = path.unwrap_or_default();
    if dir.contains('\0') {
        return Ok(SshListDirResult {
            ok: false,
            alias,
            path: dir,
            entries: Vec::new(),
            error: Some("invalid path".into()),
            error_code: Some("invalid_path".into()),
        });
    }
    match run_ssh(
        &alias,
        &remote_ls_script(&dir),
        true,
        SSH_OVERALL_TIMEOUT_SECS,
    )
    .await
    {
        Err(SshRunErr::Missing) => Ok(SshListDirResult {
            ok: false,
            alias,
            path: dir,
            entries: Vec::new(),
            error: Some("ssh missing".into()),
            error_code: Some("ssh_missing".into()),
        }),
        Err(SshRunErr::Timeout) => Ok(SshListDirResult {
            ok: false,
            alias,
            path: dir,
            entries: Vec::new(),
            error: Some("timeout".into()),
            error_code: Some("timeout".into()),
        }),
        Err(SshRunErr::Spawn(e)) => Ok(SshListDirResult {
            ok: false,
            alias,
            path: dir,
            entries: Vec::new(),
            error: Some(truncate_err(&e)),
            error_code: Some("spawn".into()),
        }),
        Ok(run) if !run.success => {
            let (code, msg) = classify_ssh_stderr(&run.stderr);
            Ok(SshListDirResult {
                ok: false,
                alias,
                path: dir,
                entries: Vec::new(),
                error: Some(format!("{code}: {msg}")),
                error_code: Some(code.to_string()),
            })
        }
        Ok(run) => match parse_ls_stdout(&run.stdout) {
            RemoteLsParse::Ok { path, entries } => Ok(SshListDirResult {
                ok: true,
                alias,
                path,
                entries,
                error: None,
                error_code: None,
            }),
            // Listing a file (or a missing path) is not an SSH outage.
            // The files pane still opens the file over ssh_read_file.
            RemoteLsParse::NotADir => Ok(SshListDirResult {
                ok: false,
                alias,
                path: dir,
                entries: Vec::new(),
                error: None,
                error_code: Some("not_a_dir".into()),
            }),
            RemoteLsParse::CdFail => Ok(SshListDirResult {
                ok: false,
                alias,
                path: dir,
                entries: Vec::new(),
                error: None,
                error_code: Some("cd_fail".into()),
            }),
            RemoteLsParse::Unparseable => Ok(SshListDirResult {
                ok: false,
                alias,
                path: dir,
                entries: Vec::new(),
                error: Some("remote ls failed".into()),
                error_code: Some("parse".into()),
            }),
        },
    }
}

const MAX_SSH_TEXT_BYTES: u64 = 2 * 1024 * 1024;

const REMOTE_READ_PY: &str = r#"python3 -c '
import json, os, sys, time
path = os.environ.get("GROK_APP_FILE", "")
rel = os.environ.get("GROK_APP_REL", "")
name = os.path.basename(path) or "file"
def emit(obj):
    sys.stdout.write("GROK_APP_READ\n")
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()
if not path or not os.path.isfile(path):
    emit({"ok": False, "error": "not a file", "name": name, "relativePath": rel, "absolutePath": path, "size": 0, "kind": "text", "mime": "text/plain", "truncated": False, "mtimeMs": 0, "text": None})
    sys.exit(0)
st = os.stat(path)
size = st.st_size
mtime_ms = int(st.st_mtime * 1000)
limit = 2097152
raw = open(path, "rb").read(limit + 1)
truncated = len(raw) > limit
raw = raw[:limit]
text = None
err = None
try:
    text = raw.decode("utf-8")
except Exception:
    err = "not utf-8 text"
    text = None
emit({"ok": err is None, "error": err, "name": name, "relativePath": rel, "absolutePath": path, "size": size, "kind": "text", "mime": "text/plain", "truncated": truncated, "mtimeMs": mtime_ms, "text": text})
'
"#;

const REMOTE_WRITE_PY: &str = r#"python3 -c '
import json, os, sys, time
path = os.environ.get("GROK_APP_FILE", "")
rel = os.environ.get("GROK_APP_REL", "")
exp = os.environ.get("GROK_APP_EXPECT_MTIME", "").strip()
def emit(obj):
    sys.stdout.write("GROK_APP_WRITE\n")
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()
if not path or not os.path.isfile(path):
    emit({"ok": False, "error": "not a file: " + path})
    sys.exit(0)
data = sys.stdin.buffer.read()
if len(data) > 2097152:
    emit({"ok": False, "error": "file too large to save in-app (max 2097152 bytes)"})
    sys.exit(0)
st = os.stat(path)
actual = int(st.st_mtime * 1000)
if exp:
    try:
        expected = int(exp)
    except Exception:
        expected = 0
    if expected > 0 and actual > 0 and actual != expected:
        emit({"ok": False, "error": "CONFLICT: file changed on disk (mtime %d, expected %d)" % (actual, expected)})
        sys.exit(0)
parent = os.path.dirname(path)
tmp = os.path.join(parent, ".%s.grok-save-%d" % (os.path.basename(path), os.getpid()))
open(tmp, "wb").write(data)
os.replace(tmp, path)
st = os.stat(path)
emit({"ok": True, "relativePath": rel, "absolutePath": path, "size": st.st_size, "mtimeMs": int(st.st_mtime * 1000)})
'
"#;

fn remote_read_script(abs: &str, rel: &str) -> String {
    format!(
        "export GROK_APP_FILE={}\nexport GROK_APP_REL={}\n{REMOTE_READ_PY}",
        posix_single_quote(abs),
        posix_single_quote(rel),
    )
}

fn remote_write_script(abs: &str, rel: &str, expected_mtime_ms: Option<u64>) -> String {
    let exp = expected_mtime_ms
        .filter(|n| *n > 0)
        .map(|n| n.to_string())
        .unwrap_or_default();
    format!(
        "export GROK_APP_FILE={}\nexport GROK_APP_REL={}\nexport GROK_APP_EXPECT_MTIME={}\n{REMOTE_WRITE_PY}",
        posix_single_quote(abs),
        posix_single_quote(rel),
        posix_single_quote(&exp),
    )
}

fn parse_marked_json(stdout: &str, marker: &str) -> Option<serde_json::Value> {
    let idx = stdout.find(marker)?;
    let rest = stdout[idx + marker.len()..].trim_start();
    let line = rest.lines().next()?.trim();
    serde_json::from_str(line).ok()
}

fn ssh_io_err(run: SshRunErr) -> String {
    match run {
        SshRunErr::Missing => "ssh missing".into(),
        SshRunErr::Timeout => "timeout".into(),
        SshRunErr::Spawn(e) => truncate_err(&e),
    }
}

#[tauri::command]
pub async fn ssh_read_file(
    alias: String,
    project_path: String,
    relative: String,
) -> Result<crate::fs_browser::FsReadResult, String> {
    let alias = alias.trim().to_string();
    if !is_safe_ssh_alias(&alias) {
        return Err("invalid alias".into());
    }
    let rel = relative.trim().to_string();
    let abs = join_remote_rel(&project_path, &rel)?;
    let name = abs.rsplit('/').next().unwrap_or("file").to_string();
    let kind = remote_file_kind(&name);
    let mime = remote_file_mime(kind).to_string();
    let script = remote_read_script(&abs, &rel);
    match run_ssh(&alias, &script, true, SSH_OVERALL_TIMEOUT_SECS).await {
        Err(e) => Err(ssh_io_err(e)),
        Ok(run) if !run.success => {
            let (_code, msg) = classify_ssh_stderr(&run.stderr);
            Err(msg)
        }
        Ok(run) => {
            let v = parse_marked_json(&run.stdout, "GROK_APP_READ")
                .ok_or_else(|| "remote read failed".to_string())?;
            let err = v
                .get("error")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            if v.get("ok").and_then(|x| x.as_bool()) == Some(false) {
                if let Some(e) = err.clone() {
                    if e.starts_with("not a file") {
                        return Err(e);
                    }
                }
            }
            Ok(crate::fs_browser::FsReadResult {
                relative_path: rel,
                name,
                absolute_path: abs,
                size: v.get("size").and_then(|x| x.as_u64()).unwrap_or(0),
                kind: kind.to_string(),
                mime,
                text: v
                    .get("text")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string()),
                base64: None,
                stream: false,
                truncated: v
                    .get("truncated")
                    .and_then(|x| x.as_bool())
                    .unwrap_or(false),
                error: err,
                mtime_ms: v.get("mtimeMs").and_then(|x| x.as_u64()).unwrap_or(0),
            })
        }
    }
}

#[tauri::command]
pub async fn ssh_write_file(
    alias: String,
    project_path: String,
    relative: String,
    content: String,
    expected_mtime_ms: Option<u64>,
) -> Result<crate::fs_browser::FsWriteResult, String> {
    let alias = alias.trim().to_string();
    if !is_safe_ssh_alias(&alias) {
        return Err("invalid alias".into());
    }
    let rel = relative.trim().to_string();
    let abs = join_remote_rel(&project_path, &rel)?;
    if content.len() as u64 > MAX_SSH_TEXT_BYTES {
        return Err(format!(
            "file too large to save in-app (max {MAX_SSH_TEXT_BYTES} bytes)"
        ));
    }
    let script = remote_write_script(&abs, &rel, expected_mtime_ms);
    match run_ssh_io(
        &alias,
        &script,
        true,
        SSH_OVERALL_TIMEOUT_SECS,
        Some(content.as_bytes()),
    )
    .await
    {
        Err(e) => Err(ssh_io_err(e)),
        Ok(run) if !run.success => {
            let (_code, msg) = classify_ssh_stderr(&run.stderr);
            Err(msg)
        }
        Ok(run) => {
            let v = parse_marked_json(&run.stdout, "GROK_APP_WRITE")
                .ok_or_else(|| "remote write failed".to_string())?;
            if v.get("ok").and_then(|x| x.as_bool()) == Some(false) {
                let err = v
                    .get("error")
                    .and_then(|x| x.as_str())
                    .unwrap_or("remote write failed");
                return Err(err.to_string());
            }
            Ok(crate::fs_browser::FsWriteResult {
                relative_path: rel,
                absolute_path: abs,
                size: v.get("size").and_then(|x| x.as_u64()).unwrap_or(0),
                mtime_ms: v.get("mtimeMs").and_then(|x| x.as_u64()).unwrap_or(0),
            })
        }
    }
}

fn sess_fail(alias: String, error: impl Into<String>) -> SshListSessionsResult {
    SshListSessionsResult {
        ok: false,
        alias,
        sessions: Vec::new(),
        total: 0,
        error: Some(error.into()),
    }
}

#[tauri::command]
pub async fn ssh_list_sessions(
    alias: String,
    offset: Option<u32>,
    limit: Option<u32>,
) -> Result<SshListSessionsResult, String> {
    let alias = alias.trim().to_string();
    if !is_safe_ssh_alias(&alias) {
        return Ok(sess_fail(alias, "invalid alias"));
    }
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(20);
    let remote = remote_sess_script(offset, limit);
    match run_ssh(&alias, &remote, true, SSH_OVERALL_TIMEOUT_SECS).await {
        Err(SshRunErr::Missing) => Ok(sess_fail(alias, "ssh missing")),
        Err(SshRunErr::Timeout) => Ok(sess_fail(alias, "timeout")),
        Err(SshRunErr::Spawn(e)) => Ok(sess_fail(alias, truncate_err(&e))),
        Ok(run) if !run.success => {
            let (_code, msg) = classify_ssh_stderr(&run.stderr);
            Ok(sess_fail(alias, msg))
        }
        Ok(run) => {
            let (total, sessions) = parse_sess_stdout(&run.stdout).unwrap_or((0, Vec::new()));
            Ok(SshListSessionsResult {
                ok: true,
                alias,
                sessions,
                total,
                error: None,
            })
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshOpenSessionResult {
    pub ok: bool,
    pub alias: String,
    pub remote_session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default)]
    pub message_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn remote_hist_script(session_id: &str) -> String {
    format!(
        r#"SID={session_id}
SESS="$HOME/.grok/sessions"
if command -v python3 >/dev/null 2>&1; then
  SID="$SID" python3 -c '
import os, sys
def emit(s):
    sys.stdout.write(s)
    sys.stdout.write("\n")
    sys.stdout.flush()
sid = os.environ.get("SID", "")
root = os.path.expanduser("~/.grok/sessions")
found = None
if os.path.isdir(root) and sid:
    for enc in os.listdir(root):
        d = os.path.join(root, enc, sid)
        if os.path.isdir(d):
            found = d
            break
emit("GROK_APP_HIST")
if not found:
    emit("KIND\tmissing")
    emit("GROK_APP_HIST_END")
    sys.exit(0)
kind = "empty"
path = None
for name, label in (("chat_history.jsonl", "chat_history"), ("updates.jsonl", "updates")):
    p = os.path.join(found, name)
    if os.path.isfile(p) and os.path.getsize(p) > 0:
        kind = label
        path = p
        break
emit("KIND\t" + kind)
if path:
    f = open(path, "r", encoding="utf-8", errors="replace")
    data = f.read(2097152)
    f.close()
    sys.stdout.write(data)
    if data and not data.endswith("\n"):
        sys.stdout.write("\n")
    sys.stdout.flush()
emit("GROK_APP_HIST_END")
' && exit 0
fi
echo GROK_APP_HIST
d=$(find "$SESS" -mindepth 2 -maxdepth 2 -type d -name "$SID" 2>/dev/null | head -n 1)
if [ -z "$d" ]; then
  echo "KIND	missing"
  echo GROK_APP_HIST_END
  exit 0
fi
if [ -s "$d/chat_history.jsonl" ]; then
  echo "KIND	chat_history"
  head -c 2097152 "$d/chat_history.jsonl"
  echo
elif [ -s "$d/updates.jsonl" ]; then
  echo "KIND	updates"
  head -c 2097152 "$d/updates.jsonl"
  echo
else
  echo "KIND	empty"
fi
echo GROK_APP_HIST_END
exit 0
"#
    )
}

struct RemoteHist {
    kind: String,
    body: String,
}

fn parse_hist_stdout(stdout: &str) -> Option<RemoteHist> {
    let marker = "GROK_APP_HIST";
    let idx = stdout.find(marker)?;
    let prefix = &stdout[..idx];
    let rest = &stdout[idx + marker.len()..];
    let mut kind = "empty".to_string();
    let mut body = String::new();
    let mut after_kind = false;
    for line in rest.lines().map(|l| l.trim_end_matches('\r')) {
        let trimmed = line.trim();
        if !after_kind {
            if let Some(k) = trimmed.strip_prefix("KIND") {
                kind = k.trim().trim_start_matches('\t').trim().to_string();
                after_kind = true;
                continue;
            }
            if trimmed.is_empty() || trimmed == marker {
                continue;
            }
            after_kind = true;
        }
        if trimmed == "GROK_APP_HIST_END" {
            break;
        }
        body.push_str(line);
        body.push('\n');
    }
    // Python used to mix print() and buffer.write(), so the jsonl landed
    // *before* GROK_APP_HIST and the wrapped body was empty.
    if body.trim().is_empty() && !prefix.trim().is_empty() {
        body = prefix.to_string();
    }
    Some(RemoteHist { kind, body })
}

fn import_index_path() -> std::path::PathBuf {
    crate::paths::app_data_root().join("ssh-imported-sessions.json")
}

fn load_import_index() -> HashMap<String, String> {
    std::fs::read_to_string(import_index_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_import_index(map: &HashMap<String, String>) -> Result<(), String> {
    let dir = crate::paths::app_data_root();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    std::fs::write(import_index_path(), raw).map_err(|e| e.to_string())
}

fn bind_imported_agent_session(
    mut meta: crate::store::SessionMeta,
    remote_id: &str,
) -> Result<crate::store::SessionMeta, String> {
    let rid = remote_id.trim();
    if crate::cli_sessions::validate_agent_session_id(rid).is_err() {
        return Ok(meta);
    }
    if meta.agent_session_id.as_deref() != Some(rid) {
        meta.agent_session_id = Some(rid.to_string());
        crate::store::update_session_meta(&meta)?;
    }
    Ok(meta)
}

fn persist_imported_journal(app_id: &str, pairs: Vec<(String, String)>) -> Result<(), String> {
    let now = chrono::Utc::now();
    let msgs: Vec<crate::store::ChatMessageStored> = pairs
        .into_iter()
        .enumerate()
        .map(|(i, (role, content))| crate::store::ChatMessageStored {
            id: uuid::Uuid::new_v4().to_string(),
            role,
            content,
            thought: None,
            created_at: now + chrono::Duration::milliseconds(i as i64),
            is_error: false,
            attachments: None,
            marker: None,
        })
        .collect();
    crate::store::save_messages(app_id, &msgs)
}

fn pairs_from_hist(hist: &RemoteHist) -> Vec<(String, String)> {
    if hist.kind == "missing" || hist.kind == "empty" || hist.body.trim().is_empty() {
        return Vec::new();
    }
    if hist.kind == "updates" {
        let pairs = crate::cli_sessions::parse_acp_updates_text(&hist.body);
        if !pairs.is_empty() {
            return pairs;
        }
        return crate::cli_sessions::parse_chat_history_text(&hist.body).unwrap_or_default();
    }
    crate::cli_sessions::parse_chat_history_text(&hist.body)
        .unwrap_or_else(|_| crate::cli_sessions::parse_acp_updates_text(&hist.body))
}

fn open_fail(
    alias: String,
    remote_session_id: String,
    error: impl Into<String>,
) -> SshOpenSessionResult {
    SshOpenSessionResult {
        ok: false,
        alias,
        remote_session_id,
        app_session_id: None,
        title: None,
        project_id: None,
        message_count: 0,
        error: Some(error.into()),
    }
}

#[tauri::command]
pub async fn ssh_open_session(
    alias: String,
    session_id: String,
    cwd: Option<String>,
    title_hint: Option<String>,
) -> Result<SshOpenSessionResult, String> {
    let alias = alias.trim().to_string();
    let session_id = session_id.trim().to_string();
    if !is_safe_ssh_alias(&alias) {
        return Ok(open_fail(alias, session_id, "invalid alias"));
    }
    if crate::cli_sessions::validate_agent_session_id(&session_id).is_err() {
        return Ok(open_fail(alias, session_id, "invalid session id"));
    }
    let script = remote_hist_script(&session_id);
    let hist = match run_ssh(&alias, &script, true, 30).await {
        Err(SshRunErr::Missing) => {
            return Ok(open_fail(alias, session_id, "ssh missing"));
        }
        Err(SshRunErr::Timeout) => {
            return Ok(open_fail(alias, session_id, "timeout"));
        }
        Err(SshRunErr::Spawn(e)) => {
            return Ok(open_fail(alias, session_id, truncate_err(&e)));
        }
        Ok(run) if !run.success => {
            let (_code, msg) = classify_ssh_stderr(&run.stderr);
            return Ok(open_fail(alias, session_id, msg));
        }
        Ok(run) => parse_hist_stdout(&run.stdout),
    };
    let Some(hist) = hist else {
        return Ok(open_fail(
            alias,
            session_id,
            "could not read remote session",
        ));
    };
    if hist.kind == "missing" {
        return Ok(open_fail(alias, session_id, "remote session not found"));
    }
    let pairs = pairs_from_hist(&hist);
    if pairs.is_empty() {
        return Ok(open_fail(
            alias,
            session_id,
            "this session has no chat content",
        ));
    }
    let title = title_hint
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && !looks_like_agent_uuid(s))
        .or_else(|| {
            pairs
                .iter()
                .find(|(r, _)| r == "user")
                .map(|(_, c)| crate::session_title::heuristic_title(c))
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Remote chat".into());

    let project_id = cwd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|path| crate::store::add_ssh_project(&alias, path.to_string(), true).ok())
        .map(|p| p.id);

    let key = format!("{alias}:{session_id}");
    let mut index = load_import_index();
    let existing = index.get(&key).cloned().filter(|id| {
        crate::store::load_sessions_index()
            .iter()
            .any(|s| s.id == *id)
    });

    let meta = if let Some(app_id) = existing {
        persist_imported_journal(&app_id, pairs.clone())?;
        let _ = crate::store::rename_session(&app_id, &title);
        let mut meta = crate::store::load_sessions_index()
            .into_iter()
            .find(|s| s.id == app_id)
            .ok_or_else(|| "imported session missing after write".to_string())?;
        if let Some(pid) = project_id.clone() {
            if meta.project_id.as_deref() != Some(pid.as_str()) {
                meta.project_id = Some(pid);
                crate::store::update_session_meta(&meta)?;
            }
        }
        meta
    } else {
        let meta = crate::store::create_session(project_id.clone(), Some(title.clone()), false)?;
        persist_imported_journal(&meta.id, pairs)?;
        index.insert(key, meta.id.clone());
        save_import_index(&index)?;
        meta
    };
    let meta = bind_imported_agent_session(meta, &session_id)?;

    let message_count = crate::store::load_messages(&meta.id).len() as u32;
    Ok(SshOpenSessionResult {
        ok: true,
        alias,
        remote_session_id: session_id,
        app_session_id: Some(meta.id),
        title: Some(meta.title),
        project_id: meta.project_id,
        message_count,
        error: None,
    })
}

const SSH_DELETE_MAX: usize = 50;

const REMOTE_DEL_PY: &str = r##"python3 -c '
import os, sys, shutil
root = os.path.expanduser("~/.grok/sessions")
sys.stdout.write("GROK_APP_DEL\n")
sys.stdout.flush()
ids = [ln.strip() for ln in sys.stdin.read().splitlines() if ln.strip()]
for sid in ids:
    if (not sid) or ("/" in sid) or ("\\" in sid) or sid in (".", "..") or (".." in sid):
        sys.stdout.write(sid + "\tbad\n")
        continue
    found = None
    if os.path.isdir(root):
        for enc in os.listdir(root):
            d = os.path.join(root, enc, sid)
            if os.path.isdir(d):
                found = d
                break
    if not found:
        sys.stdout.write(sid + "\tmissing\n")
        continue
    try:
        shutil.rmtree(found)
        sys.stdout.write(sid + "\tok\n")
    except Exception:
        sys.stdout.write(sid + "\terror\n")
'
"##;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDeleteSessionsResult {
    pub ok: bool,
    pub alias: String,
    pub deleted: Vec<String>,
    #[serde(default)]
    pub missing: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub(crate) fn parse_del_stdout(stdout: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut on = false;
    for line in stdout.lines() {
        if line.trim() == "GROK_APP_DEL" {
            on = true;
            continue;
        }
        if !on {
            continue;
        }
        let Some((id, status)) = line.split_once('\t') else {
            continue;
        };
        let id = id.trim();
        let status = status.trim();
        if id.is_empty() || status.is_empty() {
            continue;
        }
        out.push((id.to_string(), status.to_string()));
    }
    out
}

fn forget_local_for_remote(alias: &str, remote_id: &str) {
    let key = format!("{alias}:{remote_id}");
    let mut index = load_import_index();
    let mut app_ids: Vec<String> = Vec::new();
    if let Some(id) = index.remove(&key) {
        app_ids.push(id);
    }
    let _ = save_import_index(&index);
    for s in crate::store::load_sessions_index() {
        if s.agent_session_id.as_deref() == Some(remote_id) {
            app_ids.push(s.id);
        }
    }
    app_ids.sort();
    app_ids.dedup();
    for id in app_ids {
        let _ = crate::store::delete_session(&id);
    }
}

#[tauri::command]
pub async fn ssh_delete_sessions(
    alias: String,
    session_ids: Vec<String>,
) -> Result<SshDeleteSessionsResult, String> {
    let alias = alias.trim().to_string();
    if !is_safe_ssh_alias(&alias) {
        return Ok(SshDeleteSessionsResult {
            ok: false,
            alias,
            deleted: Vec::new(),
            missing: Vec::new(),
            error: Some("invalid alias".into()),
        });
    }
    let mut ids: Vec<String> = Vec::new();
    for raw in session_ids {
        if let Ok(id) = crate::cli_sessions::validate_agent_session_id(&raw) {
            if !ids.iter().any(|x| x == id) {
                ids.push(id.to_string());
            }
        }
        if ids.len() >= SSH_DELETE_MAX {
            break;
        }
    }
    if ids.is_empty() {
        return Ok(SshDeleteSessionsResult {
            ok: true,
            alias,
            deleted: Vec::new(),
            missing: Vec::new(),
            error: None,
        });
    }
    let stdin = ids.join("\n");
    let run = match run_ssh_io(&alias, REMOTE_DEL_PY, true, 30, Some(stdin.as_bytes())).await {
        Err(SshRunErr::Missing) => {
            return Ok(SshDeleteSessionsResult {
                ok: false,
                alias,
                deleted: Vec::new(),
                missing: Vec::new(),
                error: Some("ssh missing".into()),
            });
        }
        Err(SshRunErr::Timeout) => {
            return Ok(SshDeleteSessionsResult {
                ok: false,
                alias,
                deleted: Vec::new(),
                missing: Vec::new(),
                error: Some("timeout".into()),
            });
        }
        Err(SshRunErr::Spawn(e)) => {
            return Ok(SshDeleteSessionsResult {
                ok: false,
                alias,
                deleted: Vec::new(),
                missing: Vec::new(),
                error: Some(truncate_err(&e)),
            });
        }
        Ok(run) if !run.success => {
            let (_code, msg) = classify_ssh_stderr(&run.stderr);
            return Ok(SshDeleteSessionsResult {
                ok: false,
                alias,
                deleted: Vec::new(),
                missing: Vec::new(),
                error: Some(msg),
            });
        }
        Ok(run) => run,
    };
    let rows = parse_del_stdout(&run.stdout);
    let mut deleted = Vec::new();
    let mut missing = Vec::new();
    for (id, status) in rows {
        match status.as_str() {
            "ok" | "missing" => {
                forget_local_for_remote(&alias, &id);
                if status == "ok" {
                    deleted.push(id);
                } else {
                    missing.push(id);
                }
            }
            _ => {}
        }
    }
    Ok(SshDeleteSessionsResult {
        ok: true,
        alias,
        deleted,
        missing,
        error: None,
    })
}
