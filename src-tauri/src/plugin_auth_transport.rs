//! Private stdin transport for legacy Node plugin CLIs.
use std::path::Path;
use std::process::{Output, Stdio};
use std::time::Duration;
use tokio::io::AsyncWriteExt;

const BOOTSTRAP: &str = include_str!("plugin_auth_stdin.mjs");

pub fn command(script: &Path) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("node");
    cmd.args(["--input-type=module", "--eval", BOOTSTRAP]);
    cmd.arg(script);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::process_util::apply_no_window_tokio(&mut cmd);
    cmd
}

pub fn execute(
    mut cmd: tokio::process::Command,
    args: &[String],
    timeout: Duration,
) -> Result<Output, String> {
    let payload = serde_json::to_vec(args).map_err(|_| "Invalid plugin auth input")?;
    if payload.len() > 65536 {
        return Err("Plugin auth input is too large".into());
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "Could not create plugin auth runtime")?;
    runtime.block_on(async move {
        tokio::time::timeout(timeout, async move {
            let mut child = cmd
                .spawn()
                .map_err(|e| format!("Failed to start plugin: {e}"))?;
            let mut input = child.stdin.take().ok_or("Plugin stdin is unavailable")?;
            input
                .write_all(&payload)
                .await
                .map_err(|_| "Could not send plugin auth input")?;
            drop(input);
            child
                .wait_with_output()
                .await
                .map_err(|e| format!("Plugin auth process failed: {e}"))
        })
        .await
        .map_err(|_| "Plugin auth timed out".to_string())?
    })
}

pub fn redact_output(text: &str, args: &[String]) -> String {
    let mut values = args
        .windows(2)
        .filter(|pair| {
            matches!(
                pair[0].as_str(),
                "--api-key"
                    | "--api-secret"
                    | "--access-token"
                    | "--access-token-secret"
                    | "--client-secret"
            )
        })
        .map(|pair| pair[1].as_str())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    values.sort_by_key(|value| std::cmp::Reverse(value.len()));
    let mut safe = text.to_owned();
    for value in values {
        safe = safe.replace(value, "[redacted]");
        let encoded: String = url::form_urlencoded::byte_serialize(value.as_bytes()).collect();
        safe = safe.replace(&encoded, "[redacted]");
        if let Ok(json) = serde_json::to_string(value) {
            safe = safe.replace(&json[1..json.len() - 1], "[redacted]");
        }
    }
    safe
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(std::path::PathBuf);

    impl Fixture {
        fn new(source: &str) -> Self {
            let root = std::env::temp_dir()
                .join(format!("grok-private-auth-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap();
            std::fs::write(root.join("plugin with spaces.mjs"), source).unwrap();
            Self(root)
        }

        fn script(&self) -> std::path::PathBuf {
            self.0.join("plugin with spaces.mjs")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn private_pipe_reaches_legacy_node_parser_on_this_host() {
        let fixture = Fixture::new("process.stdout.write(JSON.stringify(process.argv.slice(2)));");
        let args = vec![
            "login".into(),
            "--api-secret".into(),
            "synthetic-密钥-+\"".into(),
        ];
        let out = execute(command(&fixture.script()), &args, Duration::from_secs(10)).unwrap();
        assert!(out.status.success());
        assert_eq!(
            serde_json::from_slice::<Vec<String>>(&out.stdout).unwrap(),
            args
        );
    }

    #[test]
    fn stalled_plugin_is_bounded_by_timeout() {
        let fixture = Fixture::new("setInterval(() => {}, 1000);");
        let started = std::time::Instant::now();
        let result = execute(
            command(&fixture.script()),
            &["status".into()],
            Duration::from_millis(500),
        );
        assert!(result.unwrap_err().contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn command_contains_only_launcher_and_script_not_credentials() {
        let cmd = command(Path::new("C:/plugin with spaces/scripts/x-api.mjs"));
        let argv = cmd
            .as_std()
            .get_args()
            .map(|x| x.to_string_lossy())
            .collect::<Vec<_>>();
        assert_eq!(argv.len(), 4);
        assert_eq!(argv[3], "C:/plugin with spaces/scripts/x-api.mjs");
        assert!(!argv.iter().any(|arg| arg.contains("synthetic-secret")));
    }

    #[test]
    fn errors_redact_exact_encoded_and_json_escaped_secrets() {
        let secret = "dummy+secret\nwith\"quotes";
        let args = vec!["login".into(), "--client-secret".into(), secret.into()];
        let encoded: String = url::form_urlencoded::byte_serialize(secret.as_bytes()).collect();
        let json = serde_json::to_string(secret).unwrap();
        let output = format!("Error: {secret} {encoded} {}", &json[1..json.len() - 1]);
        assert_eq!(
            redact_output(&output, &args),
            "Error: [redacted] [redacted] [redacted]"
        );
    }

    #[test]
    fn an_empty_secret_does_not_replace_every_character() {
        assert_eq!(
            redact_output("Error: unavailable", &["--api-key".into(), "".into()]),
            "Error: unavailable"
        );
    }
}
