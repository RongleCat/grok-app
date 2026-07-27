//! Detect local code editors and open project files in them.
//! Candidate list is app-owned; detection uses PATH + common install paths.
//! App icons are extracted on macOS from `.app` bundles (icns → png via `sips`).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Serialize;

use crate::paths::{app_data_root, ensure_app_dirs};

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorsListResult {
    pub editors: Vec<DetectedEditor>,
    /// Finder / Explorer icon for “Reveal in file manager”.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finder_icon: Option<String>,
    /// Generic “open with system default” icon.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_icon: Option<String>,
}

struct Candidate {
    id: &'static str,
    label: &'static str,
    bins: &'static [&'static str],
}

const CANDIDATES: &[Candidate] = &[
    Candidate {
        id: "code",
        label: "Visual Studio Code",
        bins: &["code", "code.cmd"],
    },
    Candidate {
        id: "cursor",
        label: "Cursor",
        bins: &["cursor", "cursor.cmd"],
    },
    Candidate {
        id: "codium",
        label: "VSCodium",
        bins: &["codium", "codium.cmd"],
    },
    Candidate {
        id: "windsurf",
        label: "Windsurf",
        bins: &["windsurf", "windsurf.cmd"],
    },
    Candidate {
        id: "zed",
        label: "Zed",
        bins: &["zed", "zeditor"],
    },
];

fn path_hints(id: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    #[cfg(target_os = "macos")]
    {
        let apps = match id {
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
            _ => vec![],
        };
        for root in [local.as_str(), prog.as_str(), prog_x86.as_str()] {
            if root.is_empty() {
                continue;
            }
            for r in &rel {
                out.push(PathBuf::from(root).join(r));
            }
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let bins = match id {
            "code" => vec!["/usr/bin/code", "/usr/local/bin/code"],
            "cursor" => vec!["/usr/bin/cursor", "/usr/local/bin/cursor"],
            "codium" => vec!["/usr/bin/codium", "/usr/local/bin/codium"],
            "windsurf" => vec!["/usr/bin/windsurf", "/usr/local/bin/windsurf"],
            "zed" => vec!["/usr/bin/zed", "/usr/local/bin/zed"],
            _ => vec![],
        };
        for b in bins {
            out.push(PathBuf::from(b));
        }
    }
    out
}

/// Known `.app` bundles for icon extraction (macOS).
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
        "finder" => vec!["/System/Library/CoreServices/Finder.app"],
        "system" => vec![],
        _ => vec![],
    };
    paths.into_iter().map(PathBuf::from).find(|p| p.is_dir())
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
    // Fallback: any .icns that looks like an app icon (skip tiny file-type icons by size).
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
            // Skip language / file-type icons when possible.
            if name.contains("document")
                || name == "default.icns"
                || name.len() <= 8 && !name.starts_with("app")
            {
                // still allow if nothing else
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
        _ => None,
    }
}

fn icon_cache_dir() -> PathBuf {
    let _ = ensure_app_dirs();
    let d = app_data_root().join("cache").join("app-icons");
    let _ = fs::create_dir_all(&d);
    d
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

fn resolve_candidate(c: &Candidate) -> Option<DetectedEditor> {
    let mut command: Option<String> = None;
    for bin in c.bins {
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
    let command = command?;
    Some(DetectedEditor {
        id: c.id.into(),
        label: c.label.into(),
        command,
        available: true,
        icon_data_url: resolve_icon_data_url(c.id),
    })
}

/// Return only editors present on this machine (with icons when available).
pub fn detect_editors() -> Vec<DetectedEditor> {
    let mut out = Vec::new();
    for c in CANDIDATES {
        if let Some(hit) = resolve_candidate(c) {
            out.push(hit);
        }
    }
    out
}

/// Full list payload for UI menus (editors + system icons).
pub fn list_editors_with_icons() -> EditorsListResult {
    EditorsListResult {
        editors: detect_editors(),
        finder_icon: resolve_icon_data_url("finder"),
        system_icon: resolve_icon_data_url("system"),
    }
}

pub fn resolve_editor_command(open_target: Option<&str>) -> Option<String> {
    let list = detect_editors();
    let t = open_target.unwrap_or("").trim().to_ascii_lowercase();
    if t.is_empty() || t == "finder" || t == "explorer" {
        return None;
    }
    if t == "editor" {
        return list
            .iter()
            .find(|e| e.id == "cursor")
            .or_else(|| list.iter().find(|e| e.id == "code"))
            .or_else(|| list.first())
            .map(|e| e.command.clone())
            .or_else(|| std::env::var("GROK_APP_EDITOR").ok());
    }
    if let Some(by_id) = list.iter().find(|e| e.id == t) {
        return Some(by_id.command.clone());
    }
    // Absolute path or bare command name
    if t.contains('/') || t.contains('\\') || t.ends_with(".cmd") || t.ends_with(".exe") {
        return Some(open_target.unwrap().trim().to_string());
    }
    Some(open_target.unwrap().trim().to_string())
}

/// Open file (optional line) in the resolved editor, or OS default if none.
pub fn open_in_editor(
    file_path: &str,
    line: Option<u32>,
    editor: Option<&str>,
) -> Result<(), String> {
    let path = PathBuf::from(file_path);
    if !path.exists() {
        return Err(format!("path not found: {file_path}"));
    }
    let abs = path
        .canonicalize()
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();

    let cmd = resolve_editor_command(editor);
    if let Some(cmd) = cmd {
        // VS Code family: -g path:line
        let mut args: Vec<String> = Vec::new();
        if let Some(ln) = line {
            args.push("-g".into());
            args.push(format!("{abs}:{ln}"));
        } else {
            args.push(abs.clone());
        }
        let mut c = crate::process_util::command(&cmd);
        c.args(&args)
            .spawn()
            .map_err(|e| format!("failed to open editor `{cmd}`: {e}"))?;
        return Ok(());
    }

    // Fallback: OS default open
    #[cfg(target_os = "macos")]
    {
        crate::process_util::command("open")
            .arg(&abs)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        // rundll32 avoids cmd console flash and handles paths with spaces.
        crate::process_util::command("rundll32")
            .args(["url.dll,FileProtocolHandler", &abs])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        crate::process_util::command("xdg-open")
            .arg(&abs)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Whether a path looks like a known editor binary (for tests / doctor).
#[allow(dead_code)]
pub fn is_executable_file(p: &Path) -> bool {
    fs::metadata(p).map(|m| m.is_file()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_editors_runs() {
        let list = detect_editors();
        // Environment-dependent; just ensure it does not panic.
        let _ = list.len();
    }

    #[test]
    fn list_with_icons_shape() {
        let r = list_editors_with_icons();
        let _ = r.editors;
        let _ = r.finder_icon;
        let _ = r.system_icon;
    }
}
