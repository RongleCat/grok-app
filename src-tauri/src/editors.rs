//! Detect local apps that can open project paths (editors, terminals, git GUIs).
//! Candidate list is app-owned; detection uses PATH + common install paths.
//! App icons are extracted on macOS from `.app` bundles (icns → png via `sips`).
//!
//! Detection is cached (memory + disk). Full scans (esp. icon extraction) run on a
//! background thread so UI never blocks; startup kicks a non-blocking refresh.

use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(target_os = "macos")]
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};

use crate::paths::{app_data_root, ensure_app_dirs};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedEditor {
    pub id: String,
    pub label: String,
    pub command: String,
    pub available: bool,
    /// `data:image/png;base64,...` when an icon could be extracted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorsListResult {
    pub editors: Vec<DetectedEditor>,
    /// Finder / Explorer icon for “Reveal in file manager”.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finder_icon: Option<String>,
    /// Generic “open with system default” icon.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_icon: Option<String>,
    /// Unix ms when this snapshot was built (for UI/debug).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scanned_at: Option<u64>,
}

struct Candidate {
    id: &'static str,
    label: &'static str,
    bins: &'static [&'static str],
    /// Launch strategy (see `open_in_editor`).
    kind: OpenKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OpenKind {
    /// VS Code family: `cmd [-g path:line]`.
    EditorGoto,
    /// Pass path as single argument.
    PathArg,
    /// Open folder/file parent in a terminal.
    Terminal,
    /// Git desktop GUI (repo root).
    GitGui,
}

const CANDIDATES: &[Candidate] = &[
    // ── Editors ───────────────────────────────────────────────────────────
    Candidate {
        id: "code",
        label: "Visual Studio Code",
        bins: &["code", "code.cmd"],
        kind: OpenKind::EditorGoto,
    },
    Candidate {
        id: "cursor",
        label: "Cursor",
        bins: &["cursor", "cursor.cmd"],
        kind: OpenKind::EditorGoto,
    },
    Candidate {
        id: "codium",
        label: "VSCodium",
        bins: &["codium", "codium.cmd"],
        kind: OpenKind::EditorGoto,
    },
    Candidate {
        id: "windsurf",
        label: "Windsurf",
        bins: &["windsurf", "windsurf.cmd"],
        kind: OpenKind::EditorGoto,
    },
    Candidate {
        id: "zed",
        label: "Zed",
        bins: &["zed", "zeditor"],
        kind: OpenKind::EditorGoto,
    },
    Candidate {
        id: "sublime",
        label: "Sublime Text",
        bins: &["subl", "sublime_text"],
        kind: OpenKind::PathArg,
    },
    Candidate {
        id: "idea",
        label: "IntelliJ IDEA",
        bins: &["idea", "idea64", "idea.sh"],
        kind: OpenKind::PathArg,
    },
    // ── Terminals ─────────────────────────────────────────────────────────
    Candidate {
        id: "terminal",
        label: "Terminal",
        bins: &[],
        kind: OpenKind::Terminal,
    },
    Candidate {
        id: "iterm",
        label: "iTerm",
        bins: &["iterm2"],
        kind: OpenKind::Terminal,
    },
    Candidate {
        id: "warp",
        label: "Warp",
        bins: &["warp", "warp-cli"],
        kind: OpenKind::Terminal,
    },
    Candidate {
        id: "wt",
        label: "Windows Terminal",
        bins: &["wt", "wt.exe"],
        kind: OpenKind::Terminal,
    },
    Candidate {
        id: "cmd",
        label: "Command Prompt",
        bins: &["cmd", "cmd.exe"],
        kind: OpenKind::Terminal,
    },
    Candidate {
        id: "powershell",
        label: "Windows PowerShell",
        bins: &["powershell", "powershell.exe"],
        kind: OpenKind::Terminal,
    },
    Candidate {
        id: "pwsh",
        label: "PowerShell",
        bins: &["pwsh", "pwsh.exe"],
        kind: OpenKind::Terminal,
    },
    Candidate {
        id: "alacritty",
        label: "Alacritty",
        bins: &["alacritty"],
        kind: OpenKind::Terminal,
    },
    Candidate {
        id: "kitty",
        label: "kitty",
        bins: &["kitty"],
        kind: OpenKind::Terminal,
    },
    Candidate {
        id: "wezterm",
        label: "WezTerm",
        bins: &["wezterm", "wezterm-gui"],
        kind: OpenKind::Terminal,
    },
    // ── Git GUIs ──────────────────────────────────────────────────────────
    Candidate {
        id: "fork",
        label: "Fork",
        bins: &["fork"],
        kind: OpenKind::GitGui,
    },
    Candidate {
        id: "sourcetree",
        label: "SourceTree",
        bins: &["stree", "sourcetree"],
        kind: OpenKind::GitGui,
    },
    Candidate {
        id: "github-desktop",
        label: "GitHub Desktop",
        bins: &["github", "github-desktop"],
        kind: OpenKind::GitGui,
    },
];

fn open_kind_for_id(id: &str) -> OpenKind {
    CANDIDATES
        .iter()
        .find(|c| c.id == id)
        .map(|c| c.kind)
        .unwrap_or(OpenKind::PathArg)
}

fn path_hints(id: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    #[cfg(target_os = "macos")]
    {
        let apps: Vec<&str> = match id {
            "code" => vec![
                "/usr/local/bin/code",
                "/opt/homebrew/bin/code",
                "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
            ],
            "cursor" => vec![
                "/usr/local/bin/cursor",
                "/opt/homebrew/bin/cursor",
                "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
            ],
            "codium" => vec![
                "/usr/local/bin/codium",
                "/opt/homebrew/bin/codium",
                "/Applications/VSCodium.app/Contents/Resources/app/bin/codium",
            ],
            "windsurf" => vec![
                "/usr/local/bin/windsurf",
                "/opt/homebrew/bin/windsurf",
                "/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf",
            ],
            "zed" => vec![
                "/usr/local/bin/zed",
                "/opt/homebrew/bin/zed",
                "/Applications/Zed.app/Contents/MacOS/zed",
            ],
            "sublime" => vec![
                "/usr/local/bin/subl",
                "/opt/homebrew/bin/subl",
                "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl",
            ],
            "idea" => vec![
                "/usr/local/bin/idea",
                "/opt/homebrew/bin/idea",
                "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea",
                "/Applications/IntelliJ IDEA CE.app/Contents/MacOS/idea",
            ],
            "iterm" => vec!["/usr/local/bin/iterm2", "/opt/homebrew/bin/iterm2"],
            "warp" => vec!["/usr/local/bin/warp", "/opt/homebrew/bin/warp"],
            "alacritty" => vec!["/usr/local/bin/alacritty", "/opt/homebrew/bin/alacritty"],
            "kitty" => vec!["/usr/local/bin/kitty", "/opt/homebrew/bin/kitty"],
            "wezterm" => vec!["/usr/local/bin/wezterm", "/opt/homebrew/bin/wezterm"],
            "fork" => vec![
                "/usr/local/bin/fork",
                "/opt/homebrew/bin/fork",
                "/Applications/Fork.app/Contents/Resources/fork_cli",
            ],
            "sourcetree" => vec![
                "/usr/local/bin/stree",
                "/Applications/SourceTree.app/Contents/Resources/stree",
            ],
            "github-desktop" => vec!["/usr/local/bin/github", "/opt/homebrew/bin/github"],
            _ => vec![],
        };
        for a in apps {
            out.push(PathBuf::from(a));
        }
    }
    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let prog = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let prog_x86 =
            std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());
        let user = std::env::var("USERPROFILE").unwrap_or_default();
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());

        // Absolute / system paths first
        let abs: Vec<PathBuf> =
            match id {
                "cmd" => vec![PathBuf::from(&system_root).join(r"System32\cmd.exe")],
                "powershell" => vec![PathBuf::from(&system_root)
                    .join(r"System32\WindowsPowerShell\v1.0\powershell.exe")],
                "pwsh" => vec![
                    PathBuf::from(&prog).join(r"PowerShell\7\pwsh.exe"),
                    PathBuf::from(&prog_x86).join(r"PowerShell\7\pwsh.exe"),
                ],
                "wt" => vec![
                    PathBuf::from(&local).join(r"Microsoft\WindowsApps\wt.exe"),
                    PathBuf::from(&prog).join(r"Windows Terminal\wt.exe"),
                ],
                _ => vec![],
            };
        out.extend(abs);

        let rel = match id {
            "code" => vec![
                r"Programs\Microsoft VS Code\bin\code.cmd",
                r"Microsoft VS Code\bin\code.cmd",
            ],
            "cursor" => vec![
                r"Programs\cursor\resources\app\bin\cursor.cmd",
                r"Programs\Cursor\resources\app\bin\cursor.cmd",
            ],
            "codium" => vec![r"Programs\VSCodium\bin\codium.cmd"],
            "windsurf" => vec![
                r"Programs\Windsurf\bin\windsurf.cmd",
                r"Programs\windsurf\bin\windsurf.cmd",
            ],
            "sublime" => vec![r"Sublime Text\subl.exe", r"Sublime Text 3\subl.exe"],
            "fork" => vec![r"Fork\Fork.exe"],
            "sourcetree" => vec![
                r"Atlassian\SourceTree\SourceTree.exe",
                r"SourceTree\SourceTree.exe",
            ],
            "github-desktop" => vec![
                r"GitHubDesktop\GitHubDesktop.exe",
                r"Apps\GitHubDesktop\GitHubDesktop.exe",
            ],
            "idea" => vec![r"JetBrains\IntelliJ IDEA *\bin\idea64.exe"],
            _ => vec![],
        };
        for root in [
            local.as_str(),
            prog.as_str(),
            prog_x86.as_str(),
            user.as_str(),
        ] {
            if root.is_empty() {
                continue;
            }
            for r in &rel {
                // Glob-ish single segment: expand JetBrains IDEA*
                if r.contains('*') {
                    if let Some(parent) = Path::new(r).parent() {
                        let base = PathBuf::from(root).join(parent);
                        if let Ok(rd) = fs::read_dir(&base) {
                            for ent in rd.flatten() {
                                let name = ent.file_name().to_string_lossy().to_string();
                                if name.starts_with("IntelliJ IDEA") {
                                    let exe = ent.path().join("bin").join("idea64.exe");
                                    if exe.is_file() {
                                        out.push(exe);
                                    }
                                }
                            }
                        }
                    }
                    continue;
                }
                out.push(PathBuf::from(root).join(r));
            }
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let bins: Vec<&str> = match id {
            "code" => vec!["/usr/bin/code", "/usr/local/bin/code", "/snap/bin/code"],
            "cursor" => vec!["/usr/bin/cursor", "/usr/local/bin/cursor"],
            "codium" => vec![
                "/usr/bin/codium",
                "/usr/local/bin/codium",
                "/snap/bin/codium",
            ],
            "windsurf" => vec!["/usr/bin/windsurf", "/usr/local/bin/windsurf"],
            "zed" => vec!["/usr/bin/zed", "/usr/local/bin/zed"],
            "sublime" => vec!["/usr/bin/subl", "/usr/local/bin/subl"],
            "idea" => vec!["/usr/bin/idea", "/usr/local/bin/idea"],
            "alacritty" => vec!["/usr/bin/alacritty", "/usr/local/bin/alacritty"],
            "kitty" => vec!["/usr/bin/kitty", "/usr/local/bin/kitty"],
            "wezterm" => vec!["/usr/bin/wezterm", "/usr/local/bin/wezterm"],
            "warp" => vec!["/usr/bin/warp", "/usr/local/bin/warp"],
            "pwsh" => vec!["/usr/bin/pwsh", "/usr/local/bin/pwsh"],
            "fork" => vec!["/usr/bin/fork", "/usr/local/bin/fork"],
            "github-desktop" => vec!["/usr/bin/github-desktop", "/usr/bin/github"],
            _ => vec![],
        };
        for b in bins {
            out.push(PathBuf::from(b));
        }
    }
    out
}

/// Known `.app` bundles for icon extraction + app-only detection (macOS).
#[cfg(target_os = "macos")]
fn app_bundle_for_id(id: &str) -> Option<PathBuf> {
    let paths: Vec<&str> = match id {
        "code" => vec![
            "/Applications/Visual Studio Code.app",
            "/Applications/VS Code.app",
        ],
        "cursor" => vec!["/Applications/Cursor.app"],
        "codium" => vec!["/Applications/VSCodium.app"],
        "windsurf" => vec!["/Applications/Windsurf.app"],
        "zed" => vec!["/Applications/Zed.app"],
        "sublime" => vec!["/Applications/Sublime Text.app"],
        "idea" => vec![
            "/Applications/IntelliJ IDEA.app",
            "/Applications/IntelliJ IDEA CE.app",
        ],
        "terminal" => vec!["/System/Applications/Utilities/Terminal.app"],
        "iterm" => vec!["/Applications/iTerm.app"],
        "warp" => vec!["/Applications/Warp.app"],
        "alacritty" => vec!["/Applications/Alacritty.app"],
        "kitty" => vec!["/Applications/kitty.app"],
        "wezterm" => vec!["/Applications/WezTerm.app"],
        "fork" => vec!["/Applications/Fork.app"],
        "sourcetree" => vec!["/Applications/SourceTree.app"],
        "github-desktop" => vec!["/Applications/GitHub Desktop.app"],
        "finder" => vec!["/System/Library/CoreServices/Finder.app"],
        "system" => vec![],
        _ => vec![],
    };
    paths.into_iter().map(PathBuf::from).find(|p| p.is_dir())
}

#[cfg(not(target_os = "macos"))]
fn app_bundle_for_id(_id: &str) -> Option<PathBuf> {
    None
}

/// Prefer main app icns names over file-type icons.
#[cfg(target_os = "macos")]
fn preferred_icns_names(id: &str) -> &'static [&'static str] {
    match id {
        "code" => &["Code.icns", "Electron.icns", "code.icns"],
        "cursor" => &["Cursor.icns", "Electron.icns", "Code.icns", "cursor.icns"],
        "codium" => &["VSCodium.icns", "Code.icns", "Electron.icns"],
        "windsurf" => &["Windsurf.icns", "Electron.icns", "Code.icns"],
        "zed" => &["Zed.icns", "AppIcon.icns"],
        "sublime" => &["Sublime Text.icns", "AppIcon.icns"],
        "idea" => &["idea.icns", "AppIcon.icns"],
        "terminal" => &["Terminal.icns"],
        "iterm" => &["AppIcon.icns", "iTerm.icns"],
        "warp" => &["AppIcon.icns", "Warp.icns", "electron.icns"],
        "alacritty" => &["alacritty.icns", "AppIcon.icns"],
        "kitty" => &["kitty.icns", "AppIcon.icns"],
        "wezterm" => &["terminal.icns", "AppIcon.icns"],
        "fork" => &["AppIcon.icns", "Fork.icns", "electron.icns"],
        "sourcetree" => &["SourceTree.icns", "AppIcon.icns"],
        "github-desktop" => &["electron.icns", "AppIcon.icns", "GitHub Desktop.icns"],
        "finder" => &["Finder.icns"],
        "system" => &["GenericApplicationIcon.icns"],
        _ => &["AppIcon.icns", "app.icns", "electron.icns"],
    }
}

#[cfg(target_os = "macos")]
fn find_icns_in_resources(res: &Path, id: &str) -> Option<PathBuf> {
    for name in preferred_icns_names(id) {
        let p = res.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    let mut best: Option<(u64, PathBuf)> = None;
    if let Ok(rd) = fs::read_dir(res) {
        for ent in rd.flatten() {
            let p = ent.path();
            if p.extension().and_then(|e| e.to_str()) != Some("icns") {
                continue;
            }
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if name.contains("document") || name == "default.icns" {
                continue;
            }
            let len = ent.metadata().map(|m| m.len()).unwrap_or(0);
            if best.as_ref().map(|(l, _)| len > *l).unwrap_or(true) {
                best = Some((len, p));
            }
        }
    }
    best.map(|(_, p)| p)
}

#[cfg(target_os = "macos")]
fn system_icns_for(id: &str) -> Option<PathBuf> {
    match id {
        "finder" => {
            let p = PathBuf::from(
                "/System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns",
            );
            if p.is_file() {
                Some(p)
            } else {
                None
            }
        }
        "system" => {
            let p = PathBuf::from(
                "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns",
            );
            if p.is_file() {
                Some(p)
            } else {
                None
            }
        }
        "terminal" => {
            let p = PathBuf::from(
                "/System/Applications/Utilities/Terminal.app/Contents/Resources/Terminal.icns",
            );
            if p.is_file() {
                Some(p)
            } else {
                None
            }
        }
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn icon_cache_dir() -> PathBuf {
    let _ = ensure_app_dirs();
    let d = app_data_root().join("cache").join("app-icons");
    let _ = fs::create_dir_all(&d);
    d
}

fn editors_cache_path() -> PathBuf {
    let _ = ensure_app_dirs();
    app_data_root().join("cache").join("editors-list.json")
}

/// Convert icns → cached png (64px) with `sips`, return data URL.
#[cfg(target_os = "macos")]
fn icns_to_data_url(cache_key: &str, icns: &Path) -> Option<String> {
    if !icns.is_file() {
        return None;
    }
    let out = icon_cache_dir().join(format!("{cache_key}.png"));
    let need = match (icns.metadata(), out.metadata()) {
        (Ok(sm), Ok(dm)) => {
            let src_m = sm.modified().ok();
            let dst_m = dm.modified().ok();
            match (src_m, dst_m) {
                (Some(a), Some(b)) => a > b || dm.len() < 64,
                _ => true,
            }
        }
        (Ok(_), Err(_)) => true,
        _ => false,
    };
    if need {
        let status = Command::new("sips")
            .args(["-z", "64", "64", "-s", "format", "png"])
            .arg(icns)
            .arg("--out")
            .arg(&out)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .ok()?;
        if !status.success() || !out.is_file() {
            return None;
        }
    }
    let bytes = fs::read(&out).ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some(format!("data:image/png;base64,{}", B64.encode(bytes)))
}

#[cfg(target_os = "macos")]
fn resolve_icon_data_url(id: &str) -> Option<String> {
    if let Some(icns) = system_icns_for(id) {
        if let Some(url) = icns_to_data_url(id, &icns) {
            return Some(url);
        }
    }
    if let Some(bundle) = app_bundle_for_id(id) {
        let res = bundle.join("Contents/Resources");
        if let Some(icns) = find_icns_in_resources(&res, id) {
            return icns_to_data_url(id, &icns);
        }
    }
    None
}

#[cfg(not(target_os = "macos"))]
fn resolve_icon_data_url(_id: &str) -> Option<String> {
    None
}

fn resolve_on_path(bin: &str) -> Option<String> {
    which::which(bin)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

/// Special command token for macOS app-bundle-only tools (no CLI on PATH).
const MAC_OPEN_PREFIX: &str = "__mac_open__:";

fn resolve_candidate(c: &Candidate, with_icons: bool) -> Option<DetectedEditor> {
    // Platform gates for OS-specific tools
    #[cfg(not(target_os = "macos"))]
    {
        if matches!(c.id, "terminal" | "iterm") {
            return None;
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if matches!(c.id, "cmd" | "powershell" | "wt") {
            // pwsh is cross-platform; keep it
            if c.id != "pwsh" {
                return None;
            }
        }
    }

    let mut command: Option<String> = None;
    for bin in c.bins {
        if bin.is_empty() {
            continue;
        }
        if let Some(hit) = resolve_on_path(bin) {
            command = Some(hit);
            break;
        }
    }
    if command.is_none() {
        for p in path_hints(c.id) {
            if p.is_file() {
                command = Some(p.to_string_lossy().to_string());
                break;
            }
        }
    }
    // App-only on macOS (Terminal.app, GitHub Desktop without CLI, …)
    if command.is_none() {
        if let Some(bundle) = app_bundle_for_id(c.id) {
            let name = bundle
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(c.label);
            command = Some(format!("{MAC_OPEN_PREFIX}{name}"));
        }
    }

    let command = command?;
    Some(DetectedEditor {
        id: c.id.into(),
        label: c.label.into(),
        command,
        available: true,
        icon_data_url: if with_icons {
            resolve_icon_data_url(c.id)
        } else {
            None
        },
    })
}

/// Fast path: binaries / bundles only (no icon extraction).
pub fn detect_editors_fast() -> Vec<DetectedEditor> {
    let mut out = Vec::new();
    for c in CANDIDATES {
        if let Some(hit) = resolve_candidate(c, false) {
            out.push(hit);
        }
    }
    out
}

/// Full detect including icons (may call `sips` — keep off UI thread).
pub fn detect_editors() -> Vec<DetectedEditor> {
    let mut out = Vec::new();
    for c in CANDIDATES {
        if let Some(hit) = resolve_candidate(c, true) {
            out.push(hit);
        }
    }
    out
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn build_full_list() -> EditorsListResult {
    EditorsListResult {
        editors: detect_editors(),
        finder_icon: resolve_icon_data_url("finder"),
        system_icon: resolve_icon_data_url("system"),
        scanned_at: Some(now_ms()),
    }
}

fn build_fast_list() -> EditorsListResult {
    EditorsListResult {
        editors: detect_editors_fast(),
        finder_icon: None,
        system_icon: None,
        scanned_at: Some(now_ms()),
    }
}

// ── Cache ───────────────────────────────────────────────────────────────────

struct EditorsCacheState {
    result: Option<EditorsListResult>,
    last_full_scan: Option<SystemTime>,
}

fn cache_state() -> &'static Mutex<EditorsCacheState> {
    static S: OnceLock<Mutex<EditorsCacheState>> = OnceLock::new();
    S.get_or_init(|| {
        Mutex::new(EditorsCacheState {
            result: load_disk_cache(),
            last_full_scan: None,
        })
    })
}

static REFRESHING: AtomicBool = AtomicBool::new(false);

/// Re-scan at most this often unless forced (icons are expensive on macOS).
const FULL_SCAN_MIN_INTERVAL: Duration = Duration::from_secs(5 * 60);

fn load_disk_cache() -> Option<EditorsListResult> {
    let p = editors_cache_path();
    let bytes = fs::read(&p).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn save_disk_cache(r: &EditorsListResult) {
    let p = editors_cache_path();
    if let Ok(bytes) = serde_json::to_vec_pretty(r) {
        let _ = fs::write(p, bytes);
    }
}

fn merge_icons_from_cache(fast: &mut EditorsListResult, cached: &EditorsListResult) {
    for ed in &mut fast.editors {
        if ed.icon_data_url.is_some() {
            continue;
        }
        if let Some(prev) = cached.editors.iter().find(|e| e.id == ed.id) {
            ed.icon_data_url = prev.icon_data_url.clone();
        }
    }
    if fast.finder_icon.is_none() {
        fast.finder_icon = cached.finder_icon.clone();
    }
    if fast.system_icon.is_none() {
        fast.system_icon = cached.system_icon.clone();
    }
}

/// Non-blocking: schedule a full scan on a background thread if not already running.
/// Optional `app` emits `editors://updated` when done so menus can refresh.
pub fn schedule_background_refresh(app: Option<tauri::AppHandle>) {
    if REFRESHING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    // Skip if we scanned very recently (unless no cache at all).
    {
        let g = cache_state().lock().unwrap_or_else(|e| e.into_inner());
        if g.result.is_some() {
            if let Some(t) = g.last_full_scan {
                if t.elapsed().unwrap_or(Duration::MAX) < FULL_SCAN_MIN_INTERVAL {
                    REFRESHING.store(false, Ordering::SeqCst);
                    return;
                }
            }
        }
    }

    let _ = std::thread::Builder::new()
        .name("editors-scan".into())
        .spawn(move || {
            let result = build_full_list();
            {
                let mut g = cache_state().lock().unwrap_or_else(|e| e.into_inner());
                g.result = Some(result.clone());
                g.last_full_scan = Some(SystemTime::now());
            }
            save_disk_cache(&result);
            REFRESHING.store(false, Ordering::SeqCst);
            if let Some(app) = app {
                use tauri::Emitter;
                let _ = app.emit("editors://updated", &result);
            }
            tracing::debug!(n = result.editors.len(), "editors background scan complete");
        });
}

/// Kick a background scan at app startup (never blocks setup).
pub fn start_background_scan_on_launch(app: tauri::AppHandle) {
    schedule_background_refresh(Some(app));
}

/// Full list payload for UI menus (editors + system icons).
/// Returns cached / fast path immediately; never waits on icon extraction.
pub fn list_editors_with_icons() -> EditorsListResult {
    // 1) Memory / disk cache
    let cached = {
        let g = cache_state().lock().unwrap_or_else(|e| e.into_inner());
        g.result.clone()
    };

    // 2) Fast re-detect binaries (cheap) so newly installed apps show up without
    //    waiting for the full icon scan interval.
    let mut fast = build_fast_list();
    if let Some(ref c) = cached {
        merge_icons_from_cache(&mut fast, c);
        // Prefer cached order when ids match, but keep any new apps from fast.
        let mut by_id: std::collections::HashMap<String, DetectedEditor> = c
            .editors
            .iter()
            .cloned()
            .map(|e| (e.id.clone(), e))
            .collect();
        let fast_ids: std::collections::HashSet<&str> =
            fast.editors.iter().map(|e| e.id.as_str()).collect();
        for e in &mut by_id.values_mut() {
            if !fast_ids.contains(e.id.as_str()) {
                e.available = false;
            }
        }
        for e in &fast.editors {
            by_id
                .entry(e.id.clone())
                .and_modify(|old| {
                    // Keep icon from cache; refresh command path from live detect.
                    old.command = e.command.clone();
                    old.available = true;
                })
                .or_insert_with(|| e.clone());
        }
        // Preserve candidate order
        let mut ordered = Vec::new();
        for c in CANDIDATES {
            if let Some(e) = by_id.remove(c.id) {
                ordered.push(e);
            }
        }
        for (_, e) in by_id {
            ordered.push(e);
        }
        fast.editors = ordered;
        if fast.finder_icon.is_none() {
            fast.finder_icon = c.finder_icon.clone();
        }
        if fast.system_icon.is_none() {
            fast.system_icon = c.system_icon.clone();
        }
    }

    // Publish fast+icons snapshot so next open is instant
    {
        let mut g = cache_state().lock().unwrap_or_else(|e| e.into_inner());
        if g.result.is_none() {
            g.result = Some(fast.clone());
        }
    }

    // 3) Always try a non-blocking full refresh (icons, new apps)
    schedule_background_refresh(None);

    fast
}

include!("editors_more.rs");
