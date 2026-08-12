//! Headless Grok turns for Remote IM (spawn `grok -p` streaming; ACP fallback later).

use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::oneshot;

use super::context::{extract_context_signals, ContextCompactSnapshot, ContextUsageSnapshot};

#[cfg(unix)]
const PROCESS_TREE_GRACE: std::time::Duration = std::time::Duration::from_millis(200);
const VERSION_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);
type ConfigureCommand = fn(&mut Command);
pub const PROCESS_SUPERVISION_ERROR_CODE: &str = "remote_im_process_supervision_failed";

pub struct GrokTurnResult {
    pub text: String,
    pub session_id: Option<String>,
    pub error: Option<String>,
    pub usage: Option<ContextUsageSnapshot>,
    pub compact: Option<ContextCompactSnapshot>,
    pub cancelled: bool,
}

fn cancelled_result() -> GrokTurnResult {
    GrokTurnResult {
        text: String::new(),
        session_id: None,
        error: None,
        usage: None,
        compact: None,
        cancelled: true,
    }
}

fn cancellation_requested(cancel: &mut Option<oneshot::Receiver<()>>) -> bool {
    match cancel.as_mut().map(oneshot::Receiver::try_recv) {
        Some(Ok(())) | Some(Err(oneshot::error::TryRecvError::Closed)) => true,
        Some(Err(oneshot::error::TryRecvError::Empty)) | None => false,
    }
}

async fn wait_for_cancellation(cancel: &mut Option<oneshot::Receiver<()>>) {
    match cancel {
        Some(cancel_rx) => {
            let _ = cancel_rx.await;
        }
        None => std::future::pending::<()>().await,
    }
}

fn configure_process_tree(cmd: &mut Command) {
    #[cfg(unix)]
    {
        // SAFETY: pre_exec runs in the child before exec. setsid gives every
        // Grok turn its own process group so `/stop` can terminate descendants.
        unsafe {
            cmd.pre_exec(|| {
                if libc_setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Threading::CREATE_SUSPENDED;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW | CREATE_SUSPENDED);
    }
}

struct ProcessTree {
    id: Option<u32>,
    #[cfg(windows)]
    job: Option<WindowsJob>,
}

impl ProcessTree {
    fn capture(child: &mut Child) -> std::io::Result<Self> {
        #[cfg(windows)]
        let job = {
            let pid = child
                .id()
                .ok_or_else(|| std::io::Error::other("child process id is unavailable"))?;
            // Every Windows child is created suspended. Never let it execute
            // unless Job assignment succeeded, so descendants cannot escape.
            let job = WindowsJob::attach(child)?;
            resume_process_thread(pid)?;
            Some(job)
        };
        Ok(Self {
            id: child.id(),
            #[cfg(windows)]
            job,
        })
    }

    fn preserve_background_children(&mut self) {
        #[cfg(windows)]
        if let Some(job) = self.job.as_ref() {
            if let Err(error) = job.disable_kill_on_close() {
                tracing::warn!(
                    %error,
                    "remote_im: failed to preserve background processes after successful turn"
                );
            }
        }
    }
}

async fn capture_process_tree(child: &mut Child) -> std::io::Result<ProcessTree> {
    match ProcessTree::capture(child) {
        Ok(tree) => Ok(tree),
        Err(error) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            Err(error)
        }
    }
}

#[cfg(windows)]
struct WindowsJob(std::os::windows::io::OwnedHandle);

#[cfg(windows)]
impl WindowsJob {
    fn attach(child: &Child) -> std::io::Result<Self> {
        use std::os::windows::io::{FromRawHandle, RawHandle};
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        let process = child
            .raw_handle()
            .ok_or_else(|| std::io::Error::other("child process handle is unavailable"))?;
        // SAFETY: null security/name requests an unnamed job with default ACLs.
        let raw_job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if raw_job.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: CreateJobObjectW returned ownership of a valid HANDLE.
        let job =
            unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(raw_job as RawHandle) };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: pointers refer to live handles/structures for the duration of each call.
        let configured = unsafe {
            SetInformationJobObject(
                raw_job,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: Tokio exposes the live process HANDLE; the job remains owned by `job`.
        let assigned = unsafe { AssignProcessToJobObject(raw_job, process as _) };
        if assigned == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(Self(job))
    }

    fn terminate(&self) {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;
        // SAFETY: the owned Job Object HANDLE is valid while `self` is alive.
        let _ = unsafe { TerminateJobObject(self.0.as_raw_handle() as _, 1) };
    }

    fn disable_kill_on_close(&self) -> std::io::Result<()> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::{
            JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        };

        let limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        // SAFETY: the owned Job Object HANDLE and `limits` remain valid for the call.
        let configured = unsafe {
            SetInformationJobObject(
                self.0.as_raw_handle() as _,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }
}

#[cfg(windows)]
fn resume_process_thread(process_id: u32) -> std::io::Result<()> {
    use std::os::windows::io::{FromRawHandle, RawHandle};
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows_sys::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

    // SAFETY: flags and process id follow the ToolHelp API contract.
    let raw_snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
    if raw_snapshot == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: CreateToolhelp32Snapshot returned ownership of a valid HANDLE.
    let _snapshot =
        unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(raw_snapshot as RawHandle) };
    let mut entry = THREADENTRY32 {
        dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
        ..Default::default()
    };
    // SAFETY: `entry` is initialized with the required size and remains live.
    let mut found = unsafe { Thread32First(raw_snapshot, &mut entry) } != 0;
    while found {
        if entry.th32OwnerProcessID == process_id {
            // SAFETY: opening a non-inheritable handle to the enumerated thread id.
            let raw_thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
            if raw_thread.is_null() {
                return Err(std::io::Error::last_os_error());
            }
            // SAFETY: OpenThread returned ownership of a valid HANDLE.
            let _thread = unsafe {
                std::os::windows::io::OwnedHandle::from_raw_handle(raw_thread as RawHandle)
            };
            // SAFETY: the handle grants THREAD_SUSPEND_RESUME access.
            if unsafe { ResumeThread(raw_thread) } == u32::MAX {
                return Err(std::io::Error::last_os_error());
            }
            return Ok(());
        }
        // SAFETY: snapshot/entry remain valid throughout enumeration.
        found = unsafe { Thread32Next(raw_snapshot, &mut entry) } != 0;
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "initial child thread was not found",
    ))
}

async fn terminate_and_reap(child: &mut Child, process_tree: &ProcessTree) {
    #[cfg(unix)]
    if let Some(pgid) = process_tree.id.map(|value| value as i32) {
        let _ = libc_kill(-pgid, 15); // SIGTERM the turn's process group.
        tokio::time::sleep(PROCESS_TREE_GRACE).await;
        let _ = libc_kill(-pgid, 9); // SIGKILL descendants that ignored SIGTERM.
    }
    #[cfg(windows)]
    if let Some(job) = process_tree.job.as_ref() {
        job.terminate();
    } else if let Some(pid) = process_tree.id {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }

    if let Err(error) = child.start_kill() {
        tracing::debug!(%error, "remote_im: child already exited before cancellation");
    }
    if let Err(error) = child.wait().await {
        tracing::warn!(%error, "remote_im: failed to reap cancelled grok child");
    }
}

async fn read_version_cancellable(
    binary: &Path,
    cancel: &mut Option<oneshot::Receiver<()>>,
) -> Result<Option<String>, ()> {
    if cancellation_requested(cancel) {
        return Err(());
    }

    let mut cmd = Command::new(binary);
    cmd.arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::process_util::apply_cli_env_tokio(&mut cmd);
    configure_process_tree(&mut cmd);

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(_) => return Ok(None),
    };
    let process_tree = match capture_process_tree(&mut child).await {
        Ok(tree) => tree,
        Err(error) => {
            tracing::warn!(
                path = %binary.display(),
                %error,
                "remote_im: failed to supervise cli --version process"
            );
            return Ok(None);
        }
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut output_task = tokio::spawn(async move {
        let stdout = async move {
            let mut bytes = Vec::new();
            if let Some(mut stdout) = stdout {
                let _ = stdout.read_to_end(&mut bytes).await;
            }
            bytes
        };
        let stderr = async move {
            let mut bytes = Vec::new();
            if let Some(mut stderr) = stderr {
                let _ = stderr.read_to_end(&mut bytes).await;
            }
            bytes
        };
        tokio::join!(stdout, stderr)
    });
    let deadline = tokio::time::sleep(VERSION_PROBE_TIMEOUT);
    tokio::pin!(deadline);

    let status = tokio::select! {
        biased;
        _ = wait_for_cancellation(cancel) => {
            terminate_and_reap(&mut child, &process_tree).await;
            output_task.abort();
            let _ = output_task.await;
            return Err(());
        }
        _ = &mut deadline => {
            tracing::warn!(
                path = %binary.display(),
                "remote_im: cli --version timed out after {}s",
                VERSION_PROBE_TIMEOUT.as_secs()
            );
            terminate_and_reap(&mut child, &process_tree).await;
            output_task.abort();
            let _ = output_task.await;
            return Ok(None);
        }
        status = child.wait() => status,
    };

    let (stdout, stderr) = tokio::select! {
        biased;
        _ = wait_for_cancellation(cancel) => {
            terminate_and_reap(&mut child, &process_tree).await;
            output_task.abort();
            let _ = output_task.await;
            return Err(());
        }
        _ = &mut deadline => {
            tracing::warn!(
                path = %binary.display(),
                "remote_im: cli --version pipes timed out after {}s",
                VERSION_PROBE_TIMEOUT.as_secs()
            );
            terminate_and_reap(&mut child, &process_tree).await;
            output_task.abort();
            let _ = output_task.await;
            return Ok(None);
        }
        result = &mut output_task => result.unwrap_or_default(),
    };

    let first_line = |bytes: &[u8]| {
        String::from_utf8_lossy(bytes)
            .lines()
            .next()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
    };
    match status {
        Ok(status) if status.success() => Ok(first_line(&stdout)),
        Ok(_) => Ok(first_line(&stderr).filter(|line| line.to_ascii_lowercase().contains("grok"))),
        Err(_) => Ok(None),
    }
}

pub fn resolve_grok_binary() -> PathBuf {
    if let Ok(p) = which::which("grok") {
        return p;
    }
    let home = crate::process_util::user_home();
    let candidates = [
        home.join(".grok/bin/grok"),
        PathBuf::from("/usr/local/bin/grok"),
        PathBuf::from("/opt/homebrew/bin/grok"),
    ];
    for c in candidates {
        if c.is_file() {
            return c;
        }
    }
    PathBuf::from("grok")
}

/// Same GROK_HOME the App uses for ACP (independent → agent-home, shared → ~/.grok).
/// Without this, `/r` resumes with an agent session id that only exists under agent-home
/// and the CLI reports "Session not found locally" + remote 404.
pub fn resolve_remote_grok_home() -> PathBuf {
    let mode = crate::store::load_settings().session_data_mode;
    crate::paths::resolve_agent_grok_home(&mode)
}

fn apply_agent_env(cmd: &mut Command) {
    let grok_home = resolve_remote_grok_home();
    let _ = std::fs::create_dir_all(&grok_home);
    cmd.env("GROK_HOME", &grok_home);
    // Independent mode may need App-synced auth/providers (same as ACP spawn path).
    let mode = crate::store::load_settings().session_data_mode;
    if mode != "shared" {
        crate::providers::prepare_route_auth_for_agent();
    }
    // GUI-spawned processes often lack ~/.grok/bin on PATH.
    if let Ok(path) = std::env::var("PATH") {
        let home = crate::process_util::user_home();
        let extra = [
            home.join(".grok/bin"),
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ];
        let mut parts: Vec<String> = path.split(':').map(|s| s.to_string()).collect();
        for e in extra {
            let s = e.to_string_lossy().to_string();
            if e.is_dir() && !parts.iter().any(|p| p == &s) {
                parts.insert(0, s);
            }
        }
        cmd.env("PATH", parts.join(":"));
    }
    // Same proxy injection as ACP spawn (NEW-02) — without this, Remote IM
    // turns go direct and only work when the OS has TUN.
    crate::proxy::apply_to_tokio_command(cmd);
}

/// One-shot headless turn with JSON-line stream parse (compatible with Grok Build CLI).
pub async fn run_turn(
    work_dir: &Path,
    prompt: &str,
    session_id: Option<&str>,
    always_approve: bool,
    cancel: Option<oneshot::Receiver<()>>,
    on_delta: Option<tokio::sync::mpsc::Sender<String>>,
) -> GrokTurnResult {
    let binary = resolve_grok_binary();
    run_turn_with_binary(
        &binary,
        work_dir,
        prompt,
        session_id,
        always_approve,
        cancel,
        on_delta,
    )
    .await
}

async fn run_turn_with_binary(
    binary: &Path,
    work_dir: &Path,
    prompt: &str,
    session_id: Option<&str>,
    always_approve: bool,
    cancel: Option<oneshot::Receiver<()>>,
    on_delta: Option<tokio::sync::mpsc::Sender<String>>,
) -> GrokTurnResult {
    run_turn_with_binary_and_env(
        binary,
        work_dir,
        prompt,
        session_id,
        always_approve,
        cancel,
        on_delta,
        apply_agent_env,
    )
    .await
}

async fn run_turn_with_binary_and_env(
    binary: &Path,
    work_dir: &Path,
    prompt: &str,
    session_id: Option<&str>,
    always_approve: bool,
    mut cancel: Option<oneshot::Receiver<()>>,
    on_delta: Option<tokio::sync::mpsc::Sender<String>>,
    configure_command: ConfigureCommand,
) -> GrokTurnResult {
    if cancellation_requested(&mut cancel) {
        return cancelled_result();
    }
    // Soft-fail older CLIs for bg-wait flags and partial stream format upgrade.
    let settings = crate::store::load_settings();
    let cli_ver = match read_version_cancellable(binary, &mut cancel).await {
        Ok(version) => version,
        Err(()) => return cancelled_result(),
    };
    let bg_wait =
        crate::acp_client::background_wait_spawn_flags_from_settings(&settings, cli_ver.as_deref());
    let (fmt, partial) =
        crate::acp_client::resolve_headless_stream_from_settings(&settings, cli_ver.as_deref());
    let args = super::control_plane::grok_turn_cli_args_full(
        prompt,
        session_id,
        always_approve,
        fmt,
        &partial,
        &bg_wait,
    );

    if cancellation_requested(&mut cancel) {
        return cancelled_result();
    }

    let mut cmd = Command::new(binary);
    cmd.args(&args)
        .current_dir(work_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    configure_command(&mut cmd);
    configure_process_tree(&mut cmd);

    tracing::info!(
        binary = %binary.display(),
        cwd = %work_dir.display(),
        resume = ?session_id,
        grok_home = %resolve_remote_grok_home().display(),
        "remote_im: grok turn start"
    );

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return GrokTurnResult {
                text: String::new(),
                session_id: None,
                error: Some(format!("spawn grok failed: {e}")),
                usage: None,
                compact: None,
                cancelled: false,
            };
        }
    };
    let mut process_tree = match capture_process_tree(&mut child).await {
        Ok(tree) => tree,
        Err(error) => {
            tracing::error!(
                binary = %binary.display(),
                %error,
                "remote_im: failed to supervise grok process"
            );
            return GrokTurnResult {
                text: String::new(),
                session_id: None,
                error: Some(PROCESS_SUPERVISION_ERROR_CODE.into()),
                usage: None,
                compact: None,
                cancelled: false,
            };
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut acc = String::new();
    let mut out_sid: Option<String> = None;
    let mut err_msg: Option<String> = None;
    let mut context_usage: Option<ContextUsageSnapshot> = None;
    let mut context_compact: Option<ContextCompactSnapshot> = None;

    // Drain stderr concurrently so the child cannot block on a full pipe.
    let mut stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        if let Some(err) = stderr {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if !buf.is_empty() {
                    buf.push('\n');
                }
                buf.push_str(&line);
            }
        }
        buf
    });

    let mut cancelled = false;
    if let Some(out) = stdout {
        let mut lines = BufReader::new(out).lines();
        loop {
            let next_line = tokio::select! {
                biased;
                _ = wait_for_cancellation(&mut cancel) => {
                    cancelled = true;
                    None
                }
                line = lines.next_line() => Some(line),
            };
            let Some(Ok(Some(line))) = next_line else {
                break;
            };
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                let signals = extract_context_signals(&v);
                if signals.usage.is_some() {
                    context_usage = signals.usage;
                }
                if signals.compact.is_some() {
                    context_compact = signals.compact;
                }
                if let Some(sid) = v
                    .get("session_id")
                    .or_else(|| v.get("sessionId"))
                    .and_then(|x| x.as_str())
                {
                    out_sid = Some(sid.to_string());
                }
                let ty = v
                    .get("type")
                    .or_else(|| v.get("event"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                if ty == "text" || ty == "assistant" || ty == "content_block_delta" {
                    let delta = v
                        .get("data")
                        .or_else(|| v.get("text"))
                        .or_else(|| v.pointer("/delta/text"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("");
                    if !delta.is_empty() {
                        acc.push_str(delta);
                        if let Some(ref tx) = on_delta {
                            let _ = tx.send(delta.to_string()).await;
                        }
                    }
                }
                if ty == "error" {
                    err_msg = Some(
                        v.get("message")
                            .or_else(|| v.get("error"))
                            .and_then(|x| x.as_str())
                            .unwrap_or("grok error")
                            .to_string(),
                    );
                }
            } else {
                // plain text line fallback (CLI often prints resume errors here)
                acc.push_str(&line);
                acc.push('\n');
                if let Some(ref tx) = on_delta {
                    let _ = tx.send(format!("{line}\n")).await;
                }
            }
        }
    }

    let status = if cancelled {
        terminate_and_reap(&mut child, &process_tree).await;
        None
    } else {
        let wait_result = tokio::select! {
            biased;
            _ = wait_for_cancellation(&mut cancel) => None,
            status = child.wait() => Some(status),
        };
        match wait_result {
            Some(status) => Some(status),
            None => {
                cancelled = true;
                terminate_and_reap(&mut child, &process_tree).await;
                None
            }
        }
    };
    if cancelled {
        stderr_task.abort();
        let _ = stderr_task.await;
        return cancelled_result();
    }
    let stderr_text = tokio::select! {
        biased;
        _ = wait_for_cancellation(&mut cancel) => {
            terminate_and_reap(&mut child, &process_tree).await;
            stderr_task.abort();
            let _ = stderr_task.await;
            return cancelled_result();
        }
        result = &mut stderr_task => result.unwrap_or_default(),
    };
    if matches!(status.as_ref(), Some(Ok(status)) if status.success()) {
        process_tree.preserve_background_children();
    }
    if let Some(Ok(st)) = status {
        if !st.success() && acc.trim().is_empty() {
            let se = stderr_text.trim();
            err_msg = Some(if se.is_empty() {
                format!("grok exit {:?}", st.code())
            } else {
                se.chars().take(800).collect()
            });
        }
    }

    // Resume failed under wrong home historically; if we still got a "not found" style
    // error with no useful answer, retry once without --resume so the user is not stuck.
    let resume_failed = session_id.is_some()
        && (acc.contains("not found locally")
            || acc.contains("Failed to restore session")
            || acc.contains("404 Not Found")
            || err_msg
                .as_ref()
                .map(|e| {
                    e.contains("not found") || e.contains("404") || e.contains("Failed to restore")
                })
                .unwrap_or(false));

    if resume_failed {
        tracing::warn!(
            resume = ?session_id,
            cwd = %work_dir.display(),
            grok_home = %resolve_remote_grok_home().display(),
            "remote_im: --resume failed; retrying without resume (new turn in same workdir)"
        );
        let mut fresh = run_turn_simple(
            binary,
            work_dir,
            prompt,
            None,
            always_approve,
            &mut cancel,
            configure_command,
        )
        .await;
        if fresh.cancelled {
            return fresh;
        }
        if fresh.text.trim().is_empty() && fresh.error.is_none() {
            fresh.error = Some(format!(
                "无法恢复会话 `{}`（本地 agent-home 未命中）。已尝试新开一轮但无输出。",
                session_id.unwrap_or("")
            ));
        } else if !fresh.text.trim().is_empty() {
            // Prefix a short notice so user knows history was not loaded.
            let notice = format!(
                "⚠️ 未能恢复历史会话 `{}`，已在同一项目下新开一轮。\n\n",
                session_id.unwrap_or("")
            );
            fresh.text = format!("{notice}{}", fresh.text);
        }
        return fresh;
    }

    // If streaming-json path yields nothing useful, retry simple -p but KEEP resume.
    if acc.trim().is_empty()
        && context_usage.is_none()
        && context_compact.is_none()
        && err_msg
            .as_ref()
            .map(|e| e.contains("exit") || e.contains("spawn"))
            .unwrap_or(true)
    {
        let mut simple = run_turn_simple(
            binary,
            work_dir,
            prompt,
            session_id,
            always_approve,
            &mut cancel,
            configure_command,
        )
        .await;
        // Prefer stream-path session id; else keep requested resume id for continuity.
        if simple.session_id.is_none() {
            simple.session_id = session_id
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .or(out_sid);
        }
        if simple.usage.is_none() {
            simple.usage = context_usage;
        }
        if simple.compact.is_none() {
            simple.compact = context_compact;
        }
        return simple;
    }

    GrokTurnResult {
        text: acc.trim().to_string(),
        session_id: out_sid.or_else(|| {
            session_id
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        }),
        error: err_msg,
        usage: context_usage,
        compact: context_compact,
        cancelled: false,
    }
}

async fn run_turn_simple(
    binary: &Path,
    work_dir: &Path,
    prompt: &str,
    session_id: Option<&str>,
    always_approve: bool,
    cancel: &mut Option<oneshot::Receiver<()>>,
    configure_command: ConfigureCommand,
) -> GrokTurnResult {
    if cancellation_requested(cancel) {
        return cancelled_result();
    }
    // Plain -p path; still pass --resume when bound (AC1/AC5 multi-turn).
    let mut args = vec!["-p".to_string(), prompt.to_string()];
    if always_approve {
        args.push("--always-approve".into());
    }
    if let Some(sid) = session_id.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        args.push("--resume".into());
        args.push(sid.to_string());
    }
    let mut cmd = Command::new(binary);
    cmd.args(&args)
        .current_dir(work_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    configure_command(&mut cmd);
    configure_process_tree(&mut cmd);
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            return GrokTurnResult {
                text: String::new(),
                session_id: session_id
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty()),
                error: Some(e.to_string()),
                usage: None,
                compact: None,
                cancelled: false,
            };
        }
    };
    let mut process_tree = match capture_process_tree(&mut child).await {
        Ok(tree) => tree,
        Err(error) => {
            tracing::error!(
                binary = %binary.display(),
                %error,
                "remote_im: failed to supervise fallback grok process"
            );
            return GrokTurnResult {
                text: String::new(),
                session_id: session_id
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty()),
                error: Some(PROCESS_SUPERVISION_ERROR_CODE.into()),
                usage: None,
                compact: None,
                cancelled: false,
            };
        }
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut output_task = tokio::spawn(async move {
        let stdout = async move {
            let mut bytes = Vec::new();
            if let Some(mut stdout) = stdout {
                let _ = stdout.read_to_end(&mut bytes).await;
            }
            bytes
        };
        let stderr = async move {
            let mut bytes = Vec::new();
            if let Some(mut stderr) = stderr {
                let _ = stderr.read_to_end(&mut bytes).await;
            }
            bytes
        };
        tokio::join!(stdout, stderr)
    });

    let wait_result = tokio::select! {
        biased;
        _ = wait_for_cancellation(cancel) => None,
        status = child.wait() => Some(status),
    };
    let status = match wait_result {
        Some(status) => status,
        None => {
            terminate_and_reap(&mut child, &process_tree).await;
            output_task.abort();
            let _ = output_task.await;
            return cancelled_result();
        }
    };
    let (stdout, stderr) = tokio::select! {
        biased;
        _ = wait_for_cancellation(cancel) => {
            terminate_and_reap(&mut child, &process_tree).await;
            output_task.abort();
            let _ = output_task.await;
            return cancelled_result();
        }
        result = &mut output_task => result.unwrap_or_default(),
    };

    match status {
        Ok(status) => {
            if status.success() {
                process_tree.preserve_background_children();
            }
            let text = String::from_utf8_lossy(&stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&stderr).trim().to_string();
            let err = if !status.success() && text.is_empty() {
                Some(if stderr.is_empty() {
                    format!("grok exit {:?}", status.code())
                } else {
                    stderr
                })
            } else {
                None
            };
            GrokTurnResult {
                text,
                // Preserve resume id when CLI does not echo a new session id.
                session_id: session_id
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty()),
                error: err,
                usage: None,
                compact: None,
                cancelled: false,
            }
        }
        Err(e) => GrokTurnResult {
            text: String::new(),
            session_id: session_id
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            error: Some(e.to_string()),
            usage: None,
            compact: None,
            cancelled: false,
        },
    }
}

#[cfg(unix)]
fn libc_setsid() -> i32 {
    extern "C" {
        fn setsid() -> i32;
    }
    unsafe { setsid() }
}

#[cfg(unix)]
fn libc_kill(pid: i32, signal: i32) -> i32 {
    extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    unsafe { kill(pid, signal) }
}

/// Exposed for unit tests: simple-path argv must include resume.
#[cfg(test)]
pub fn simple_turn_cli_args(
    prompt: &str,
    session_id: Option<&str>,
    always_approve: bool,
) -> Vec<String> {
    let mut args = vec!["-p".to_string(), prompt.to_string()];
    if always_approve {
        args.push("--always-approve".into());
    }
    if let Some(sid) = session_id.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        args.push("--resume".into());
        args.push(sid.to_string());
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn process_exists(pid: u32) -> bool {
        std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("probe process-tree pid")
            .success()
    }

    #[test]
    fn simple_fallback_keeps_resume_flag() {
        let args = simple_turn_cli_args("hi", Some("sess-abc"), false);
        assert!(
            args.windows(2)
                .any(|w| w[0] == "--resume" && w[1] == "sess-abc"),
            "simple path must pass --resume for multi-turn after /r: {args:?}"
        );
        let no = simple_turn_cli_args("hi", None, true);
        assert!(!no.iter().any(|a| a == "--resume"));
    }

    #[test]
    fn remote_grok_home_matches_app_session_data_mode() {
        let mode = crate::store::load_settings().session_data_mode;
        let home = resolve_remote_grok_home();
        let expected = crate::paths::resolve_agent_grok_home(&mode);
        assert_eq!(home, expected);
        // Independent default: must NOT be bare ~/.grok when App stores sessions in agent-home.
        if mode != "shared" {
            assert!(
                home.ends_with("agent-home") || home.to_string_lossy().contains("agent-home"),
                "independent GROK_HOME should be agent-home, got {}",
                home.display()
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_kills_and_reaps_the_grok_child() {
        use std::os::unix::fs::PermissionsExt;

        let test_dir = std::env::temp_dir().join(format!(
            "grok-app-remote-im-cancel-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&test_dir).expect("create cancellation test directory");
        let fake_grok = test_dir.join("grok");
        let parent_pid_file = test_dir.join("grok.pid");
        let descendant_pid_file = test_dir.join("descendant.pid");
        std::fs::write(
            &fake_grok,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo 'grok 1.0.0'\n  exit 0\nfi\nprintf '%s' \"$$\" > \"$(dirname \"$0\")/grok.pid\"\nsleep 600 &\ndescendant=$!\nprintf '%s' \"$descendant\" > \"$(dirname \"$0\")/descendant.pid\"\nwait \"$descendant\"\n",
        )
        .expect("write fake grok executable");
        let mut permissions = std::fs::metadata(&fake_grok)
            .expect("stat fake grok executable")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&fake_grok, permissions).expect("make fake grok executable");

        let (cancel_tx, cancel_rx) = oneshot::channel();
        let fake_grok_for_turn = fake_grok.clone();
        let work_dir = test_dir.clone();
        let turn = tokio::spawn(async move {
            run_turn_with_binary_and_env(
                &fake_grok_for_turn,
                &work_dir,
                "hang",
                None,
                false,
                Some(cancel_rx),
                None,
                |_| {},
            )
            .await
        });

        let (parent_pid, descendant_pid) =
            tokio::time::timeout(std::time::Duration::from_secs(2), async {
                loop {
                    if let (Ok(parent), Ok(descendant)) = (
                        std::fs::read_to_string(&parent_pid_file),
                        std::fs::read_to_string(&descendant_pid_file),
                    ) {
                        if let (Ok(parent), Ok(descendant)) = (
                            parent.trim().parse::<u32>(),
                            descendant.trim().parse::<u32>(),
                        ) {
                            break (parent, descendant);
                        }
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("fake grok process tree did not start");

        cancel_tx
            .send(())
            .expect("turn dropped its cancellation receiver");
        let result = tokio::time::timeout(std::time::Duration::from_secs(2), turn)
            .await
            .expect("cancelled turn did not return")
            .expect("turn task panicked");
        assert!(result.cancelled, "turn did not report cancellation");

        for pid in [parent_pid, descendant_pid] {
            assert!(
                !process_exists(pid),
                "cancelled grok process {pid} survived"
            );
        }

        let _ = std::fs::remove_file(parent_pid_file);
        let _ = std::fs::remove_file(descendant_pid_file);
        let _ = std::fs::remove_file(fake_grok);
        let _ = std::fs::remove_dir(test_dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_kills_descendants_holding_pipes_after_the_leader_exits() {
        use std::os::unix::fs::PermissionsExt;

        let test_dir = std::env::temp_dir().join(format!(
            "grok-app-remote-im-pipe-cancel-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&test_dir).expect("create pipe cancellation test directory");
        let fake_grok = test_dir.join("grok");
        let parent_pid_file = test_dir.join("grok.pid");
        let descendant_pid_file = test_dir.join("descendant.pid");
        std::fs::write(
            &fake_grok,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo 'grok 1.0.0'\n  exit 0\nfi\nprintf '%s' \"$$\" > \"$(dirname \"$0\")/grok.pid\"\nsleep 600 >&2 &\ndescendant=$!\nprintf '%s' \"$descendant\" > \"$(dirname \"$0\")/descendant.pid\"\nexit 0\n",
        )
        .expect("write fake grok executable");
        let mut permissions = std::fs::metadata(&fake_grok)
            .expect("stat fake grok executable")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&fake_grok, permissions).expect("make fake grok executable");

        let (cancel_tx, cancel_rx) = oneshot::channel();
        let fake_grok_for_turn = fake_grok.clone();
        let work_dir = test_dir.clone();
        let turn = tokio::spawn(async move {
            run_turn_with_binary_and_env(
                &fake_grok_for_turn,
                &work_dir,
                "hang through inherited stderr",
                None,
                false,
                Some(cancel_rx),
                None,
                |_| {},
            )
            .await
        });

        let (parent_pid, descendant_pid) =
            tokio::time::timeout(std::time::Duration::from_secs(2), async {
                loop {
                    if let (Ok(parent), Ok(descendant)) = (
                        std::fs::read_to_string(&parent_pid_file),
                        std::fs::read_to_string(&descendant_pid_file),
                    ) {
                        if let (Ok(parent), Ok(descendant)) = (
                            parent.trim().parse::<u32>(),
                            descendant.trim().parse::<u32>(),
                        ) {
                            if !process_exists(parent) && process_exists(descendant) {
                                break (parent, descendant);
                            }
                        }
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("leader did not exit while its descendant kept stderr open");

        cancel_tx
            .send(())
            .expect("turn dropped its cancellation receiver");
        let result = tokio::time::timeout(std::time::Duration::from_secs(2), turn)
            .await
            .expect("pipe-blocked turn did not return after cancellation")
            .expect("turn task panicked");
        assert!(result.cancelled, "turn did not report cancellation");
        assert!(
            !process_exists(parent_pid),
            "grok leader unexpectedly returned"
        );
        assert!(
            !process_exists(descendant_pid),
            "descendant holding stderr survived cancellation"
        );

        let _ = std::fs::remove_file(parent_pid_file);
        let _ = std::fs::remove_file(descendant_pid_file);
        let _ = std::fs::remove_file(fake_grok);
        let _ = std::fs::remove_dir(test_dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_kills_version_probe_descendants_holding_pipes() {
        use std::os::unix::fs::PermissionsExt;

        let test_dir = std::env::temp_dir().join(format!(
            "grok-app-remote-im-version-cancel-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&test_dir).expect("create version cancellation test directory");
        let fake_grok = test_dir.join("grok");
        let parent_pid_file = test_dir.join("version.pid");
        let descendant_pid_file = test_dir.join("version-descendant.pid");
        std::fs::write(
            &fake_grok,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  printf '%s' \"$$\" > \"$(dirname \"$0\")/version.pid\"\n  sleep 600 >&2 &\n  descendant=$!\n  printf '%s' \"$descendant\" > \"$(dirname \"$0\")/version-descendant.pid\"\n  exit 0\nfi\nexit 1\n",
        )
        .expect("write fake grok executable");
        let mut permissions = std::fs::metadata(&fake_grok)
            .expect("stat fake grok executable")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&fake_grok, permissions).expect("make fake grok executable");

        let (cancel_tx, cancel_rx) = oneshot::channel();
        let fake_grok_for_probe = fake_grok.clone();
        let probe = tokio::spawn(async move {
            let mut cancel = Some(cancel_rx);
            read_version_cancellable(&fake_grok_for_probe, &mut cancel).await
        });

        let (parent_pid, descendant_pid) =
            tokio::time::timeout(std::time::Duration::from_secs(2), async {
                loop {
                    if let (Ok(parent), Ok(descendant)) = (
                        std::fs::read_to_string(&parent_pid_file),
                        std::fs::read_to_string(&descendant_pid_file),
                    ) {
                        if let (Ok(parent), Ok(descendant)) = (
                            parent.trim().parse::<u32>(),
                            descendant.trim().parse::<u32>(),
                        ) {
                            if !process_exists(parent) && process_exists(descendant) {
                                break (parent, descendant);
                            }
                        }
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("version leader did not exit while its descendant kept stderr open");

        cancel_tx
            .send(())
            .expect("version probe dropped its cancellation receiver");
        let result = tokio::time::timeout(std::time::Duration::from_secs(2), probe)
            .await
            .expect("version probe did not return after cancellation")
            .expect("version probe task panicked");
        assert!(result.is_err(), "version probe did not report cancellation");
        assert!(
            !process_exists(parent_pid),
            "version leader unexpectedly returned"
        );
        assert!(
            !process_exists(descendant_pid),
            "version descendant holding stderr survived cancellation"
        );

        let _ = std::fs::remove_file(parent_pid_file);
        let _ = std::fs::remove_file(descendant_pid_file);
        let _ = std::fs::remove_file(fake_grok);
        let _ = std::fs::remove_dir(test_dir);
    }
}
