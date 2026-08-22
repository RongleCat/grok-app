//! cloudflared quick tunnel lifecycle (DESIGN §9).
//!
//! Select a host-binary or Docker adapter, parse the public URL from logs,
//! and wait for `Registered tunnel connection` before declaring ready.
//! Stop tears down the process group and any managed container so no orphan
//! tunnel keeps the mirror reachable (REQUIREMENT known pitfall).

#![allow(dead_code)] // residual-clippy: public_url field/method
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::oneshot;
use tokio::time::timeout;

// tokio::process::Command::pre_exec is available on Unix without importing
// std::os::unix::process::CommandExt. On Windows, `creation_flags` is an
// inherent tokio method — no std CommandExt import needed.

/// How long to wait for URL + registered connection.
const TUNNEL_READY_TIMEOUT: Duration = Duration::from_secs(90);
/// First Docker run can pull the official image before cloudflared starts.
const DOCKER_TUNNEL_READY_TIMEOUT: Duration = Duration::from_secs(180);
const DOCKER_DAEMON_TIMEOUT: Duration = Duration::from_secs(8);
/// A single QUIC disconnect can be transient. Two failures before registration
/// are enough to prove the default transport is not becoming usable, while
/// keeping the HTTP/2 retry well below the normal Docker readiness timeout.
const QUIC_FAILURES_BEFORE_HTTP2_RETRY: usize = 2;
const DEFAULT_CLOUDFLARED_IMAGE: &str = "cloudflare/cloudflared:latest";
const DOCKER_CONTAINER_PREFIX: &str = "grok-mirror-cloudflared-";
const DOCKER_MIRROR_LABEL: &str = "com.grokapp.mirror=1";

/// Internal adapter seam: host binary remains the preferred path; Docker is
/// selected only when cloudflared is absent from the desktop app's PATH.
#[derive(Debug, Clone)]
enum TunnelAdapter {
    HostBinary {
        bin: PathBuf,
    },
    Docker {
        bin: PathBuf,
        image: String,
        container_name: String,
    },
}

#[derive(Debug, Clone)]
struct DockerCleanup {
    bin: PathBuf,
    container_name: String,
}

struct TunnelCommandSpec {
    program: PathBuf,
    args: Vec<String>,
    adapter_name: &'static str,
    ready_timeout: Duration,
    docker_cleanup: Option<DockerCleanup>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TunnelProtocol {
    Auto,
    Http2,
}

impl TunnelProtocol {
    fn label(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Http2 => "http2",
        }
    }
}

#[derive(Debug)]
struct TunnelAttemptError {
    message: String,
    retry_with_http2: bool,
}

impl TunnelAttemptError {
    fn other(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retry_with_http2: false,
        }
    }

    fn quic_unavailable() -> Self {
        Self {
            message: "cloudflared QUIC transport failed repeatedly before registration".into(),
            retry_with_http2: true,
        }
    }
}

impl TunnelAdapter {
    fn command_spec(&self, local_port: u16, protocol: TunnelProtocol) -> TunnelCommandSpec {
        match self {
            Self::HostBinary { bin } => TunnelCommandSpec {
                program: bin.clone(),
                args: vec![
                    "tunnel".into(),
                    "--url".into(),
                    format!("http://127.0.0.1:{local_port}"),
                    "--no-autoupdate".into(),
                ],
                adapter_name: "host_binary",
                ready_timeout: TUNNEL_READY_TIMEOUT,
                docker_cleanup: None,
            },
            Self::Docker {
                bin,
                image,
                container_name,
            } => {
                let mut args = vec![
                    "run".into(),
                    "--rm".into(),
                    "--name".into(),
                    container_name.clone(),
                    "--label".into(),
                    DOCKER_MIRROR_LABEL.into(),
                ];
                #[cfg(target_os = "linux")]
                args.extend(["--network".into(), "host".into()]);
                args.extend([
                    image.clone(),
                    "tunnel".into(),
                    "--url".into(),
                    docker_tunnel_origin(local_port),
                ]);
                if protocol == TunnelProtocol::Http2 {
                    args.extend(["--protocol".into(), "http2".into()]);
                }
                args.push("--no-autoupdate".into());
                TunnelCommandSpec {
                    program: bin.clone(),
                    args,
                    adapter_name: "docker",
                    ready_timeout: DOCKER_TUNNEL_READY_TIMEOUT,
                    docker_cleanup: Some(DockerCleanup {
                        bin: bin.clone(),
                        container_name: container_name.clone(),
                    }),
                }
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn docker_tunnel_origin(local_port: u16) -> String {
    // Host networking preserves the loopback-only security posture on Linux.
    format!("http://127.0.0.1:{local_port}")
}

#[cfg(not(target_os = "linux"))]
fn docker_tunnel_origin(local_port: u16) -> String {
    // Docker Desktop exposes the macOS/Windows host through this stable name;
    // container-local 127.0.0.1 would point at cloudflared itself.
    format!("http://host.docker.internal:{local_port}")
}

/// Live tunnel process (own process group on Unix).
pub struct TunnelHandle {
    child: Child,
    /// Process group / leader pid for group kill (Unix).
    pgid: Option<i32>,
    adapter_name: &'static str,
    docker_cleanup: Option<DockerCleanup>,
    pub public_url: String,
}

impl TunnelHandle {
    pub fn public_url(&self) -> &str {
        &self.public_url
    }

    /// Non-blocking poll: true if cloudflared has exited (ephemeral tunnel died).
    pub fn poll_exited(&mut self) -> bool {
        match self.child.try_wait() {
            Ok(Some(status)) => {
                // status() holds the mirror runtime mutex while polling; never
                // block that path on a Docker daemon round-trip.
                cleanup_docker_container_in_background(self.docker_cleanup.clone());
                tracing::warn!(
                    ?status,
                    adapter = self.adapter_name,
                    "mirror cloudflared process exited"
                );
                true
            }
            Ok(None) => false,
            Err(e) => {
                cleanup_docker_container_in_background(self.docker_cleanup.clone());
                tracing::warn!(error = %e, "mirror cloudflared try_wait failed");
                true
            }
        }
    }

    /// Stop the selected adapter and remove Docker containers before reaping
    /// the attached client process. This keeps stop/quit free of tunnel orphans.
    pub fn stop(mut self) {
        cleanup_docker_container(self.docker_cleanup.take());
        kill_process_group(self.child.id(), self.pgid.take());
        // Best-effort reaping so we don't leave zombies.
        let _ = self.child.start_kill();
        tauri::async_runtime::spawn(async move {
            let _ = self.child.wait().await;
        });
    }
}

/// Result of starting a quick tunnel against a local loopback port.
pub struct TunnelStart {
    pub handle: TunnelHandle,
    pub public_url: String,
}

/// Spawn a quick tunnel through the host cloudflared binary, or through the
/// official Docker image when the host binary is not available.
///
/// Returns only after logs show a public URL **and**
/// `Registered tunnel connection` (or errors out).
pub async fn start_quick_tunnel(local_port: u16) -> Result<TunnelStart, String> {
    let adapter = select_tunnel_adapter(local_port).await?;
    match start_tunnel_attempt(&adapter, local_port, TunnelProtocol::Auto).await {
        Ok(start) => Ok(start),
        Err(primary)
            if matches!(adapter, TunnelAdapter::Docker { .. }) && primary.retry_with_http2 =>
        {
            tracing::warn!(
                error = %primary.message,
                "mirror Docker tunnel retrying with HTTP/2 transport"
            );
            start_tunnel_attempt(&adapter, local_port, TunnelProtocol::Http2)
                .await
                .map_err(|fallback| {
                    format!(
                        "{}; HTTP/2 retry failed: {}",
                        primary.message, fallback.message
                    )
                })
        }
        Err(error) => Err(error.message),
    }
}

async fn start_tunnel_attempt(
    adapter: &TunnelAdapter,
    local_port: u16,
    protocol: TunnelProtocol,
) -> Result<TunnelStart, TunnelAttemptError> {
    let spec = adapter.command_spec(local_port, protocol);
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(false);

    // New process group / session so stop can kill descendants.
    #[cfg(unix)]
    {
        // SAFETY: pre_exec runs in child before exec; setsid creates a new session = process group.
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
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| {
        TunnelAttemptError::other(format!(
            "failed to spawn {} cloudflared adapter: {e}",
            spec.adapter_name
        ))
    })?;
    let pid = child.id();
    let pgid = pid.map(|p| p as i32);

    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            terminate_failed_tunnel(&mut child, pid, pgid, spec.docker_cleanup.clone());
            return Err(TunnelAttemptError::other("cloudflared stdout missing"));
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            terminate_failed_tunnel(&mut child, pid, pgid, spec.docker_cleanup.clone());
            return Err(TunnelAttemptError::other("cloudflared stderr missing"));
        }
    };

    let detect_quic_failure =
        matches!(adapter, TunnelAdapter::Docker { .. }) && protocol == TunnelProtocol::Auto;
    let (tx, rx) = oneshot::channel::<Result<(String, bool), TunnelAttemptError>>();
    tauri::async_runtime::spawn(async move {
        let result = pump_tunnel_logs(stdout, stderr, detect_quic_failure).await;
        let _ = tx.send(result);
    });

    let ready = timeout(spec.ready_timeout, rx).await;
    let (public_url, registered) = match ready {
        Ok(Ok(Ok(pair))) => pair,
        Ok(Ok(Err(e))) => {
            terminate_failed_tunnel(&mut child, pid, pgid, spec.docker_cleanup.clone());
            return Err(e);
        }
        Ok(Err(_)) => {
            terminate_failed_tunnel(&mut child, pid, pgid, spec.docker_cleanup.clone());
            return Err(TunnelAttemptError::other(
                "cloudflared log pump closed without ready signal",
            ));
        }
        Err(_) => {
            terminate_failed_tunnel(&mut child, pid, pgid, spec.docker_cleanup.clone());
            return Err(TunnelAttemptError::other(format!(
                "cloudflared did not become ready within {}s",
                spec.ready_timeout.as_secs()
            )));
        }
    };

    if !registered {
        terminate_failed_tunnel(&mut child, pid, pgid, spec.docker_cleanup.clone());
        return Err(TunnelAttemptError::other(
            "cloudflared printed URL but never 'Registered tunnel connection'",
        ));
    }

    let public_url = public_url.trim_end_matches('/').to_string();

    tracing::info!(
        %public_url,
        ?pid,
        adapter = spec.adapter_name,
        protocol = protocol.label(),
        "mirror cloudflared tunnel registered"
    );

    Ok(TunnelStart {
        handle: TunnelHandle {
            child,
            pgid,
            adapter_name: spec.adapter_name,
            docker_cleanup: spec.docker_cleanup,
            public_url: public_url.clone(),
        },
        public_url,
    })
}

async fn select_tunnel_adapter(local_port: u16) -> Result<TunnelAdapter, String> {
    if let Ok(bin) = which::which("cloudflared") {
        return Ok(TunnelAdapter::HostBinary { bin });
    }

    let docker = find_docker_binary().ok_or_else(|| {
        "cloudflared not found on PATH and Docker CLI is unavailable — install cloudflared, or install/start Docker Desktop, or set GROK_MIRROR_NO_TUNNEL=1"
            .to_string()
    })?;
    ensure_docker_daemon(&docker).await?;
    cleanup_stale_docker_containers(&docker).await?;

    let image = std::env::var("GROK_MIRROR_CLOUDFLARED_IMAGE")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_CLOUDFLARED_IMAGE.to_string());

    Ok(TunnelAdapter::Docker {
        bin: docker,
        image,
        container_name: docker_container_name(local_port),
    })
}

fn find_docker_binary() -> Option<PathBuf> {
    if let Ok(bin) = which::which("docker") {
        return Some(bin);
    }

    #[cfg(target_os = "windows")]
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        let candidate = PathBuf::from(program_files)
            .join("Docker")
            .join("Docker")
            .join("resources")
            .join("bin")
            .join("docker.exe");
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    // Finder/LaunchServices apps often inherit a minimal PATH. Check official
    // Docker Desktop and common package-manager locations before declaring the
    // Docker adapter unavailable.
    #[cfg(target_os = "macos")]
    const CANDIDATES: &[&str] = &[
        "/Applications/Docker.app/Contents/Resources/bin/docker",
        "/opt/homebrew/bin/docker",
        "/usr/local/bin/docker",
        "/usr/bin/docker",
    ];
    #[cfg(target_os = "linux")]
    const CANDIDATES: &[&str] = &["/usr/bin/docker", "/usr/local/bin/docker"];
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    const CANDIDATES: &[&str] = &[];

    CANDIDATES
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

async fn ensure_docker_daemon(docker: &Path) -> Result<(), String> {
    let mut probe = Command::new(docker);
    crate::process_util::apply_no_window_tokio(&mut probe);
    probe
        .arg("info")
        .arg("--format")
        .arg("{{.ServerVersion}}")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);

    match timeout(DOCKER_DAEMON_TIMEOUT, probe.status()).await {
        Ok(Ok(status)) if status.success() => Ok(()),
        Ok(_) => Err(
            "cloudflared not found on PATH and Docker daemon is unavailable — start Docker Desktop and retry, or set GROK_MIRROR_NO_TUNNEL=1"
                .into(),
        ),
        Err(_) => Err(
            "cloudflared not found on PATH and Docker daemon check timed out — start Docker Desktop and retry, or set GROK_MIRROR_NO_TUNNEL=1"
                .into(),
        ),
    }
}

async fn cleanup_stale_docker_containers(docker: &Path) -> Result<(), String> {
    // A force-killed desktop process cannot run its normal stop hook. Since
    // Grok is single-instance, any container with our private name prefix is
    // stale when a new mirror adapter is being selected.
    let mut list = Command::new(docker);
    crate::process_util::apply_no_window_tokio(&mut list);
    list.args([
        "ps",
        "--all",
        "--quiet",
        "--filter",
        &format!("name={DOCKER_CONTAINER_PREFIX}"),
    ])
    .stdin(Stdio::null())
    .stderr(Stdio::null())
    .kill_on_drop(true);
    let output = match timeout(DOCKER_DAEMON_TIMEOUT, list.output()).await {
        Ok(Ok(output)) if output.status.success() => output,
        _ => {
            return Err(
                "cloudflared not found on PATH and stale Docker mirror cleanup could not be checked — restart Docker Desktop and retry"
                    .into(),
            )
        }
    };

    let ids: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|id| !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit()))
        .take(32)
        .map(str::to_string)
        .collect();
    if ids.is_empty() {
        return Ok(());
    }

    let mut remove = Command::new(docker);
    crate::process_util::apply_no_window_tokio(&mut remove);
    remove
        .args(["rm", "--force"])
        .args(&ids)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    match timeout(DOCKER_DAEMON_TIMEOUT, remove.status()).await {
        Ok(Ok(status)) if status.success() => {
            tracing::info!(count = ids.len(), "mirror stale Docker tunnels removed");
            Ok(())
        }
        _ => Err(
            "cloudflared not found on PATH and stale Docker mirror containers could not be removed — restart Docker Desktop and retry"
                .into(),
        ),
    }
}

fn docker_container_name(local_port: u16) -> String {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!(
        "{DOCKER_CONTAINER_PREFIX}{}-{local_port}-{nonce}",
        std::process::id()
    )
}

fn terminate_failed_tunnel(
    child: &mut Child,
    pid: Option<u32>,
    pgid: Option<i32>,
    docker_cleanup: Option<DockerCleanup>,
) {
    cleanup_docker_container(docker_cleanup);
    kill_process_group(pid, pgid);
    let _ = child.start_kill();
}

fn cleanup_docker_container(cleanup: Option<DockerCleanup>) {
    let Some(cleanup) = cleanup else {
        return;
    };
    let status = std::process::Command::new(&cleanup.bin)
        .args(["rm", "--force", &cleanup.container_name])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match status {
        Ok(status) if status.success() => {
            tracing::info!(container = %cleanup.container_name, "mirror Docker tunnel removed");
        }
        Ok(status) => {
            tracing::debug!(?status, container = %cleanup.container_name, "mirror Docker tunnel already absent or could not be removed");
        }
        Err(error) => {
            tracing::warn!(%error, container = %cleanup.container_name, "mirror Docker tunnel cleanup failed");
        }
    }
}

fn cleanup_docker_container_in_background(cleanup: Option<DockerCleanup>) {
    if cleanup.is_none() {
        return;
    }
    std::thread::spawn(move || cleanup_docker_container(cleanup));
}

/// Read stdout+stderr until we have URL and Registered, or process dies.
async fn pump_tunnel_logs(
    stdout: impl tokio::io::AsyncRead + Unpin + Send + 'static,
    stderr: impl tokio::io::AsyncRead + Unpin + Send + 'static,
    detect_quic_failure: bool,
) -> Result<(String, bool), TunnelAttemptError> {
    let (line_tx, mut line_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    let tx_out = line_tx.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = tx_out.send(line);
        }
    });
    let tx_err = line_tx;
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = tx_err.send(line);
        }
    });

    let mut public_url: Option<String> = None;
    let mut registered = false;
    let mut quic_failures = 0usize;

    while let Some(line) = line_rx.recv().await {
        tracing::debug!(target: "mirror_tunnel", "{line}");
        if public_url.is_none() {
            if let Some(u) = extract_trycloudflare_url(&line) {
                public_url = Some(u);
            }
        }
        if line.contains("Registered tunnel connection") {
            registered = true;
        }
        if detect_quic_failure && is_quic_connectivity_failure(&line) {
            quic_failures += 1;
            if quic_failures >= QUIC_FAILURES_BEFORE_HTTP2_RETRY {
                return Err(TunnelAttemptError::quic_unavailable());
            }
        }
        if let Some(ref u) = public_url {
            if registered {
                return Ok((u.clone(), true));
            }
        }
    }

    match public_url {
        Some(u) if registered => Ok((u, true)),
        Some(u) => Ok((u, false)),
        None => Err(TunnelAttemptError::other(
            "cloudflared exited before printing a public URL",
        )),
    }
}

fn is_quic_connectivity_failure(line: &str) -> bool {
    let line = line.to_ascii_lowercase();
    line.contains("quic")
        && (line.contains("failed")
            || line.contains("timeout")
            || line.contains("no recent network activity"))
}

/// Extract first `https://*.trycloudflare.com` (or similar quick-tunnel host) from a log line.
pub fn extract_trycloudflare_url(line: &str) -> Option<String> {
    for token in line.split_whitespace() {
        let t = token.trim_matches(|c: char| c == '"' || c == '\'' || c == '|' || c == ',');
        if let Some(rest) = t.strip_prefix("https://") {
            if rest.contains("trycloudflare.com")
                || rest.contains("cfargotunnel.com")
                || rest.ends_with(".cloudflareaccess.com")
            {
                let cleaned = t
                    .trim_end_matches(|c: char| {
                        matches!(c, ')' | ']' | '.' | ',' | ';' | '"' | '\'')
                    })
                    .to_string();
                if cleaned.starts_with("https://") {
                    return Some(cleaned);
                }
            }
        }
    }
    if let Some(start) = line.find("https://") {
        let rest = &line[start..];
        let end = rest
            .find(|c: char| c.is_whitespace() || c == '|' || c == '"' || c == '\'')
            .unwrap_or(rest.len());
        let candidate = rest[..end].trim_end_matches([')', ']', '.', ',', ';']);
        if candidate.contains("trycloudflare.com") || candidate.contains("cfargotunnel.com") {
            return Some(candidate.to_string());
        }
    }
    None
}

fn kill_process_group(pid: Option<u32>, pgid: Option<i32>) {
    #[cfg(unix)]
    {
        if let Some(g) = pgid.or(pid.map(|p| p as i32)) {
            // Negative pid → kill process group. libc_kill already wraps the FFI unsafe.
            let rc = libc_kill(-g, 15); // SIGTERM
            if rc != 0 {
                tracing::debug!(
                    pgid = g,
                    "mirror tunnel SIGTERM group failed; trying SIGKILL"
                );
            }
            std::thread::sleep(Duration::from_millis(200));
            let _ = libc_kill(-g, 9);
            return;
        }
    }
    #[cfg(windows)]
    {
        let _ = pgid;
        if let Some(p) = pid {
            let _ = crate::process_util::command("taskkill")
                .args(["/PID", &p.to_string(), "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            return;
        }
    }
    let _ = (pid, pgid);
}

#[cfg(unix)]
fn libc_setsid() -> i32 {
    extern "C" {
        fn setsid() -> i32;
    }
    unsafe { setsid() }
}

#[cfg(unix)]
fn libc_kill(pid: i32, sig: i32) -> i32 {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    unsafe { kill(pid, sig) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    #[test]
    fn extracts_trycloudflare_url() {
        let line = "2024-01-01 INF | https://abc-def.trycloudflare.com |";
        assert_eq!(
            extract_trycloudflare_url(line).as_deref(),
            Some("https://abc-def.trycloudflare.com")
        );
    }

    #[test]
    fn extracts_from_visit_line() {
        let line =
            "Please open the following URL and log in: https://foo-bar-baz.trycloudflare.com";
        assert_eq!(
            extract_trycloudflare_url(line).as_deref(),
            Some("https://foo-bar-baz.trycloudflare.com")
        );
    }

    #[test]
    fn no_url_returns_none() {
        assert!(extract_trycloudflare_url("Registered tunnel connection").is_none());
    }

    #[test]
    fn host_adapter_keeps_loopback_origin() {
        let adapter = TunnelAdapter::HostBinary {
            bin: PathBuf::from("/usr/local/bin/cloudflared"),
        };
        let spec = adapter.command_spec(52770, TunnelProtocol::Auto);
        assert_eq!(spec.adapter_name, "host_binary");
        assert_eq!(spec.program, PathBuf::from("/usr/local/bin/cloudflared"));
        assert!(spec.args.iter().any(|arg| arg == "http://127.0.0.1:52770"));
        assert!(spec.docker_cleanup.is_none());
    }

    #[test]
    fn docker_adapter_uses_official_image_and_managed_container() {
        let adapter = TunnelAdapter::Docker {
            bin: PathBuf::from("/usr/local/bin/docker"),
            image: DEFAULT_CLOUDFLARED_IMAGE.into(),
            container_name: "grok-mirror-test".into(),
        };
        let spec = adapter.command_spec(52770, TunnelProtocol::Auto);
        assert_eq!(spec.adapter_name, "docker");
        assert!(spec.args.iter().any(|arg| arg == DEFAULT_CLOUDFLARED_IMAGE));
        assert!(spec
            .args
            .windows(2)
            .any(|pair| pair[0] == "--name" && pair[1] == "grok-mirror-test"));
        assert!(spec
            .args
            .windows(2)
            .any(|pair| pair[0] == "--label" && pair[1] == DOCKER_MIRROR_LABEL));
        assert_eq!(
            spec.docker_cleanup
                .as_ref()
                .map(|cleanup| cleanup.container_name.as_str()),
            Some("grok-mirror-test")
        );

        #[cfg(target_os = "linux")]
        {
            assert!(spec
                .args
                .windows(2)
                .any(|pair| pair[0] == "--network" && pair[1] == "host"));
            assert!(spec.args.iter().any(|arg| arg == "http://127.0.0.1:52770"));
        }
        #[cfg(not(target_os = "linux"))]
        assert!(spec
            .args
            .iter()
            .any(|arg| arg == "http://host.docker.internal:52770"));
    }

    #[test]
    fn docker_http2_retry_adds_transport_override() {
        let adapter = TunnelAdapter::Docker {
            bin: PathBuf::from("/usr/local/bin/docker"),
            image: DEFAULT_CLOUDFLARED_IMAGE.into(),
            container_name: "grok-mirror-test".into(),
        };

        let automatic = adapter.command_spec(52770, TunnelProtocol::Auto);
        assert!(!automatic
            .args
            .windows(2)
            .any(|pair| pair[0] == "--protocol"));

        let http2 = adapter.command_spec(52770, TunnelProtocol::Http2);
        assert!(http2
            .args
            .windows(2)
            .any(|pair| pair[0] == "--protocol" && pair[1] == "http2"));
    }

    #[test]
    fn identifies_real_quic_failures_but_ignores_successful_prechecks() {
        assert!(is_quic_connectivity_failure(
            "ERR Failed to dial a quic connection error=timeout: no recent network activity"
        ));
        assert!(is_quic_connectivity_failure(
            "ERR failed to accept QUIC stream: timeout: no recent network activity"
        ));
        assert!(!is_quic_connectivity_failure(
            "UDP Connectivity region1.v2.argotunnel.com PASS QUIC connection successful"
        ));
        assert!(!is_quic_connectivity_failure(
            "INF Registered tunnel connection protocol=http2"
        ));
    }

    #[tokio::test]
    async fn repeated_quic_failures_request_http2_retry() {
        let (mut stdout_writer, stdout_reader) = tokio::io::duplex(2048);
        let (mut stderr_writer, stderr_reader) = tokio::io::duplex(2048);

        stdout_writer
            .write_all(b"INF https://retry-me.trycloudflare.com\n")
            .await
            .unwrap();
        stderr_writer
            .write_all(
                b"ERR failed to accept QUIC stream: timeout: no recent network activity\n\
                  ERR Failed to dial a quic connection: timeout: no recent network activity\n",
            )
            .await
            .unwrap();
        stdout_writer.shutdown().await.unwrap();
        stderr_writer.shutdown().await.unwrap();

        let error = pump_tunnel_logs(stdout_reader, stderr_reader, true)
            .await
            .unwrap_err();
        assert!(error.retry_with_http2);
        assert!(error.message.contains("QUIC"));
    }
}
