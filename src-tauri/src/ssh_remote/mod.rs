//! SSH hosts from OpenSSH config: list, test, watch, remote files, PTY, ACP.
//!
//! Transport is the system `ssh` binary so `~/.ssh/config` (ProxyJump, keys,
//! ssh-agent) keeps working. Aliases are argv, never interpolated into a shell.
//! Remote commands are POSIX (`/bin/sh -c`). Windows clients skip ControlMaster.

use std::collections::{HashMap, HashSet};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tokio::time::timeout;

use crate::process_util;

const SSH_CONNECT_TIMEOUT_SECS: u64 = 8;
const SSH_OVERALL_TIMEOUT_SECS: u64 = 15;
const SSH_INSPECT_TIMEOUT_SECS: u64 = 25;
const INCLUDE_DEPTH_MAX: u32 = 8;
const ERROR_CHARS: usize = 240;

/// Remote POSIX snippet. Constant — no host alias inside.
const REMOTE_PROBE: &str = r#"BIN=""
if command -v grok >/dev/null 2>&1; then
  BIN=$(command -v grok)
elif [ -x "$HOME/.grok/bin/grok" ]; then
  BIN="$HOME/.grok/bin/grok"
fi
echo GROK_APP_PROBE
if [ -z "$BIN" ]; then
  echo CLI_MISSING
  echo AUTH_MISSING
  echo
  echo
  exit 0
fi
echo CLI_OK
if [ -f "$HOME/.grok/auth.json" ]; then
  echo AUTH_OK
else
  echo AUTH_MISSING
fi
echo "$BIN"
"$BIN" --version 2>/dev/null | head -n 1
exit 0
"#;

const INSTALL_REMOTE: &str = "curl -fsSL https://x.ai/cli/install.sh | bash";
const LOGIN_REMOTE: &str = "grok login --device-auth";

include!("config.rs");
include!("acp_run.rs");
include!("fs_sessions.rs");
include!("skills_browser.rs");
#[cfg(test)]
include!("tests.rs");
