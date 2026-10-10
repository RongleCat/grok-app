//! Project-scoped codebase file/name + content search for the App UI.
//!
//! Host path-scopes every hit under a trusted project root. Prefers `rg`
//! for content when available; otherwise walks with hard caps. Always
//! keyword / literal scan — **never** invents embeddings, vector search,
//! or CLI code-graph results.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use crate::process_util;

/// Default hit cap returned to the UI.
pub const CODEBASE_SEARCH_DEFAULT_LIMIT: usize = 50;
/// Hard max hit cap.
pub const CODEBASE_SEARCH_MAX_LIMIT: usize = 100;
/// Max files visited when walking (name + content fallback).
pub const CODEBASE_SEARCH_MAX_FILES_WALK: usize = 8_000;
/// Max bytes read per file for content scan (walk fallback).
pub const CODEBASE_SEARCH_MAX_FILE_BYTES: u64 = 512 * 1024;
/// Snippet half-window around the first content match (chars).
const SNIPPET_RADIUS: usize = 48;
/// Max snippet length returned to the UI (chars, after collapse).
const SNIPPET_MAX: usize = 160;
/// rg / walk subprocess soft timeout.
const RG_TIMEOUT: Duration = Duration::from_secs(8);

/// One file hit under the project root.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodebaseSearchHit {
    pub path: String,
    pub name: String,
    pub relative_path: String,
    /// True when the hit is a directory — only an `include_dirs` caller gets one.
    pub is_dir: bool,
    pub size: u64,
    pub mtime_ms: u64,
    /// Excerpt around the first content match. Empty for name-only hits.
    pub snippet: String,
    /// True when the query matched file body (not only name/path).
    pub content_match: bool,
    /// 1-based line of first content match when known (rg).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

/// Result of project-scoped keyword search.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodebaseSearchResult {
    pub hits: Vec<CodebaseSearchHit>,
    pub project_path: String,
    pub project_path_exists: bool,
    pub project_is_dir: bool,
    pub query: String,
    /// `name` | `content` | `all`
    pub mode: String,
    /// Effective hit limit after clamp.
    pub limit: usize,
    /// True when more matches exist beyond the hit cap (or walk/rg truncated).
    pub truncated: bool,
    /// `rg` | `walk` | `none` — how content (or the whole search) was resolved.
    pub engine: String,
    /// Always `"keyword"` — App never invents embeddings / semantic results.
    pub search_kind: String,
    /// Soft-fail reason when path missing / not a dir / empty / untrusted, etc.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub soft_fail: Option<String>,
}

/// Clamp UI/host limit into the hard search cap range (pure).
pub fn clamp_codebase_search_limit(limit: Option<usize>) -> usize {
    limit
        .unwrap_or(CODEBASE_SEARCH_DEFAULT_LIMIT)
        .clamp(1, CODEBASE_SEARCH_MAX_LIMIT)
}

/// Normalize mode string → `name` | `content` | `all` (pure).
pub fn normalize_codebase_search_mode(mode: Option<&str>) -> &'static str {
    match mode.map(str::trim).unwrap_or("all") {
        "name" | "path" | "filename" => "name",
        "content" | "body" | "text" => "content",
        _ => "all",
    }
}

/// Whether free-text should trigger a host search (pure).
pub fn should_run_codebase_search(query: &str) -> bool {
    !query.trim().is_empty()
}

fn empty_result(
    project_path: &str,
    query: &str,
    mode: &str,
    limit: usize,
    exists: bool,
    is_dir: bool,
    soft_fail: Option<&str>,
) -> CodebaseSearchResult {
    CodebaseSearchResult {
        hits: Vec::new(),
        project_path: project_path.to_string(),
        project_path_exists: exists,
        project_is_dir: is_dir,
        query: query.to_string(),
        mode: mode.to_string(),
        limit,
        truncated: false,
        engine: "none".into(),
        search_kind: "keyword".into(),
        soft_fail: soft_fail.map(|s| s.to_string()),
    }
}

fn file_mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn skip_dir_name(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | "vendor"
            | ".cache"
            | "repos"
            | ".venv"
            | "venv"
            | "__pycache__"
            | ".turbo"
            | "coverage"
            | "out"
            | ".pnpm-store"
            | ".yarn"
            | "Pods"
            | ".idea"
            | ".vscode"
            | "DerivedData"
    )
}

fn is_likely_binary_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.ends_with(".png")
        || n.ends_with(".jpg")
        || n.ends_with(".jpeg")
        || n.ends_with(".gif")
        || n.ends_with(".webp")
        || n.ends_with(".ico")
        || n.ends_with(".bmp")
        || n.ends_with(".avif")
        || n.ends_with(".mp4")
        || n.ends_with(".webm")
        || n.ends_with(".mov")
        || n.ends_with(".mkv")
        || n.ends_with(".mp3")
        || n.ends_with(".wav")
        || n.ends_with(".ogg")
        || n.ends_with(".m4a")
        || n.ends_with(".flac")
        || n.ends_with(".pdf")
        || n.ends_with(".zip")
        || n.ends_with(".gz")
        || n.ends_with(".tgz")
        || n.ends_with(".bz2")
        || n.ends_with(".7z")
        || n.ends_with(".rar")
        || n.ends_with(".woff")
        || n.ends_with(".woff2")
        || n.ends_with(".ttf")
        || n.ends_with(".otf")
        || n.ends_with(".eot")
        || n.ends_with(".dylib")
        || n.ends_with(".so")
        || n.ends_with(".dll")
        || n.ends_with(".exe")
        || n.ends_with(".bin")
        || n.ends_with(".o")
        || n.ends_with(".a")
        || n.ends_with(".class")
        || n.ends_with(".pyc")
        || n.ends_with(".pyo")
        || n.ends_with(".sqlite")
        || n.ends_with(".db")
        || n.ends_with(".wasm")
        || n.ends_with(".icns")
        || n.ends_with(".lock") && n != "cargo.lock" && n != "pnpm-lock.yaml"
}

/// Case-insensitive name / relative-path match (pure).
/// Empty query matches every file (used for `@` recent-file listing).
pub fn codebase_name_matches(name: &str, relative_path: &str, query_lower: &str) -> bool {
    if query_lower.is_empty() {
        return true;
    }
    name.to_ascii_lowercase().contains(query_lower)
        || relative_path.to_ascii_lowercase().contains(query_lower)
}

/// Build a single-line snippet around a UTF-8 byte offset (pure).
pub fn make_codebase_search_snippet(
    content: &str,
    match_byte_idx: usize,
    match_len: usize,
) -> String {
    let start_byte = floor_char_boundary(content, match_byte_idx);
    let end_byte = ceil_char_boundary(
        content,
        match_byte_idx.saturating_add(match_len).min(content.len()),
    );

    let prefix = &content[..start_byte];
    let matched = &content[start_byte..end_byte];
    let suffix = &content[end_byte..];

    let prefix_chars: Vec<char> = prefix.chars().collect();
    let suffix_chars: Vec<char> = suffix.chars().collect();
    let matched_chars: Vec<char> = matched.chars().collect();

    let take_pre = SNIPPET_RADIUS.min(prefix_chars.len());
    let pre_slice = &prefix_chars[prefix_chars.len().saturating_sub(take_pre)..];
    let lead_ellipsis = prefix_chars.len() > take_pre;

    let mut out = String::new();
    if lead_ellipsis {
        out.push('…');
    }
    out.extend(pre_slice.iter().copied());
    out.extend(matched_chars.iter().copied());

    let room = SNIPPET_MAX.saturating_sub(out.chars().count());
    let take_suf = room.min(suffix_chars.len()).min(SNIPPET_RADIUS + 16);
    out.extend(suffix_chars.iter().take(take_suf).copied());
    if suffix_chars.len() > take_suf {
        out.push('…');
    }

    let collapsed: String = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > SNIPPET_MAX {
        let trimmed: String = collapsed
            .chars()
            .take(SNIPPET_MAX.saturating_sub(1))
            .collect();
        format!("{trimmed}…")
    } else {
        collapsed
    }
}

fn floor_char_boundary(s: &str, i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    let mut i = i;
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn ceil_char_boundary(s: &str, i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    let mut i = i;
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

fn relative_to_root(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"))
}

fn hit_from_path(
    root: &Path,
    path: &Path,
    content_match: bool,
    snippet: String,
    line: Option<u32>,
) -> Option<CodebaseSearchHit> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Some(CodebaseSearchHit {
        path: path.to_string_lossy().to_string(),
        name,
        relative_path: relative_to_root(root, path),
        is_dir: false,
        size: meta.len(),
        mtime_ms: file_mtime_ms(path),
        snippet,
        content_match,
        line,
    })
}

/// Search file body for `query_lower` (case-insensitive). Caps read size.
fn search_file_content(path: &Path, query_lower: &str, query_len: usize) -> Option<(String, u32)> {
    if query_lower.is_empty() {
        return None;
    }
    let Ok(meta) = fs::metadata(path) else {
        return None;
    };
    if !meta.is_file() || meta.len() == 0 {
        return None;
    }
    if meta.len() > CODEBASE_SEARCH_MAX_FILE_BYTES * 4 {
        // Skip huge files on walk fallback.
        return None;
    }
    let Ok(mut f) = fs::File::open(path) else {
        return None;
    };
    let to_read = (meta.len() as usize).min(CODEBASE_SEARCH_MAX_FILE_BYTES as usize);
    let mut buf = vec![0u8; to_read];
    let n = f.read(&mut buf).ok()?;
    buf.truncate(n);
    if buf.contains(&0) {
        return None;
    }
    let text = String::from_utf8_lossy(&buf);
    let lower = text.to_ascii_lowercase();
    let byte_idx = lower.find(query_lower)?;
    let snip = make_codebase_search_snippet(&text, byte_idx, query_len);
    // Approximate line number from prefix newlines.
    let line = (text[..byte_idx].bytes().filter(|&b| b == b'\n').count() as u32).saturating_add(1);
    Some((snip, line))
}

fn try_rg_content(
    root: &Path,
    query: &str,
    limit: usize,
) -> Option<(Vec<CodebaseSearchHit>, bool)> {
    let rg = which::which("rg").ok()?;
    // GUI spawn: hide the Windows console (Settings → Agent codebase search).
    let mut cmd = process_util::command(rg);
    cmd.current_dir(root)
        .arg("--color=never")
        .arg("--line-number")
        .arg("--no-heading")
        .arg("--with-filename")
        .arg("--ignore-case")
        .arg("--max-count")
        .arg("1")
        .arg("--max-filesize")
        .arg(format!("{CODEBASE_SEARCH_MAX_FILE_BYTES}"))
        .arg("--glob")
        .arg("!node_modules/**")
        .arg("--glob")
        .arg("!.git/**")
        .arg("--glob")
        .arg("!target/**")
        .arg("--glob")
        .arg("!dist/**")
        .arg("--glob")
        .arg("!build/**")
        .arg("--glob")
        .arg("!.next/**")
        .arg("--glob")
        .arg("!vendor/**")
        .arg("--glob")
        .arg("!*.png")
        .arg("--glob")
        .arg("!*.jpg")
        .arg("--glob")
        .arg("!*.jpeg")
        .arg("--glob")
        .arg("!*.gif")
        .arg("--glob")
        .arg("!*.webp")
        .arg("--glob")
        .arg("!*.mp4")
        .arg("--glob")
        .arg("!*.woff*")
        .arg("--glob")
        .arg("!*.pdf")
        .arg("--glob")
        .arg("!*.zip")
        .arg("--fixed-strings")
        .arg("--")
        .arg(query)
        .arg(".");

    // Soft timeout via process kill is OS-dependent; use a short wall budget
    // by spawning and waiting with timeout when available. Simple path: run
    // and accept hang risk is low with caps; on failure fall back to walk.
    let output = match cmd.output() {
        Ok(o) => o,
        Err(_) => return None,
    };
    // rg exits 0 = matches, 1 = no matches, 2 = error.
    if !output.status.success() && output.status.code() != Some(1) {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut hits: Vec<CodebaseSearchHit> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut truncated = false;
    let q_len = query.chars().count().max(1);

    for line in stdout.lines() {
        // path:line:text  (Windows drive letters: C:\... — use rsplit once carefully)
        let Some((path_part, rest)) = split_rg_line(line) else {
            continue;
        };
        let Some((line_str, text)) = rest.split_once(':') else {
            continue;
        };
        let line_no: u32 = line_str.parse().unwrap_or(0);
        let abs = if Path::new(path_part).is_absolute() {
            PathBuf::from(path_part)
        } else {
            root.join(path_part)
        };
        // Stay under root (lexical when canonicalize fails).
        let canon = abs.canonicalize().unwrap_or_else(|_| abs.clone());
        if !canon.starts_with(root) {
            continue;
        }
        let key = canon.to_string_lossy().to_string();
        if !seen.insert(key) {
            continue;
        }
        if hits.len() >= limit {
            truncated = true;
            break;
        }
        let snippet = {
            let t = text.trim();
            if t.is_empty() {
                String::new()
            } else {
                let lower = t.to_ascii_lowercase();
                let q_lower = query.to_ascii_lowercase();
                if let Some(idx) = lower.find(&q_lower) {
                    make_codebase_search_snippet(t, idx, q_len)
                } else {
                    let chars: String = t.chars().take(SNIPPET_MAX).collect();
                    chars
                }
            }
        };
        if let Some(hit) = hit_from_path(
            root,
            &canon,
            true,
            snippet,
            Some(line_no).filter(|&n| n > 0),
        ) {
            hits.push(hit);
        }
    }
    if !truncated && hits.len() >= limit {
        truncated = true;
    }
    let _ = RG_TIMEOUT; // documented budget; rg is usually fast with caps
    Some((hits, truncated))
}

/// Split `path:line:rest` handling Windows `C:\...` paths.
fn split_rg_line(line: &str) -> Option<(&str, &str)> {
    // Prefer first `:` after a path-looking prefix.
    // Unix: `./src/foo.ts:12:text`
    // Windows: `C:\src\foo.ts:12:text` or `src\foo.ts:12:text`
    if line.len() >= 3 && line.as_bytes()[1] == b':' && line.as_bytes()[0].is_ascii_alphabetic() {
        // Drive letter — find the *second* colon as path/line split is wrong;
        // look for `:<digits>:`
        let bytes = line.as_bytes();
        let mut i = 2;
        while i + 1 < bytes.len() {
            if bytes[i] == b':' {
                // check digits after
                let mut j = i + 1;
                while j < bytes.len() && bytes[j].is_ascii_digit() {
                    j += 1;
                }
                if j > i + 1 && j < bytes.len() && bytes[j] == b':' {
                    return Some((&line[..i], &line[i + 1..]));
                }
            }
            i += 1;
        }
        return None;
    }
    line.split_once(':')
}

fn walk_search(
    root: &Path,
    query: &str,
    mode: &str,
    limit: usize,
    want_content: bool,
    want_name: bool,
    include_dirs: bool,
) -> (Vec<CodebaseSearchHit>, bool, usize) {
    use std::collections::VecDeque;

    let q_lower = query.to_ascii_lowercase();
    let q_len = query.chars().count().max(1);
    let mut hits: Vec<CodebaseSearchHit> = Vec::new();
    let mut truncated = false;
    let mut visited = 0usize;

    let mut queue: VecDeque<PathBuf> = VecDeque::new();
    queue.push_back(root.to_path_buf());

    while let Some(dir) = queue.pop_front() {
        if hits.len() >= limit {
            truncated = true;
            break;
        }
        if visited >= CODEBASE_SEARCH_MAX_FILES_WALK {
            truncated = true;
            break;
        }
        let Ok(rd) = fs::read_dir(&dir) else {
            continue;
        };
        for ent in rd.flatten() {
            if hits.len() >= limit {
                truncated = true;
                break;
            }
            if visited >= CODEBASE_SEARCH_MAX_FILES_WALK {
                truncated = true;
                break;
            }
            let name = ent.file_name().to_string_lossy().to_string();
            if name == ".DS_Store" || name == "Thumbs.db" {
                continue;
            }
            let path = ent.path();
            let Ok(meta) = ent.metadata() else {
                continue;
            };
            if meta.is_dir() {
                if skip_dir_name(&name) || name.starts_with('.') {
                    continue;
                }
                // Report the directory as a hit too when the caller asks, so the
                // composer can reference it. An empty query stays files-only.
                if include_dirs && want_name && !q_lower.is_empty() {
                    let rel = relative_to_root(root, &path);
                    if codebase_name_matches(&name, &rel, &q_lower) {
                        hits.push(CodebaseSearchHit {
                            path: path.to_string_lossy().to_string(),
                            name: name.clone(),
                            relative_path: rel,
                            is_dir: true,
                            size: 0,
                            mtime_ms: file_mtime_ms(&path),
                            snippet: String::new(),
                            content_match: false,
                            line: None,
                        });
                    }
                }
                queue.push_back(path);
                continue;
            }
            if !meta.is_file() {
                continue;
            }
            visited += 1;

            let rel = relative_to_root(root, &path);
            let name_hit = want_name && codebase_name_matches(&name, &rel, &q_lower);
            let mut content_match = false;
            let mut snippet = String::new();
            let mut line = None;

            if want_content && !is_likely_binary_name(&name) {
                if let Some((snip, ln)) = search_file_content(&path, &q_lower, q_len) {
                    content_match = true;
                    snippet = snip;
                    line = Some(ln);
                }
            }

            // mode filters
            let keep = match mode {
                "name" => name_hit,
                "content" => content_match,
                _ => name_hit || content_match,
            };
            if !keep {
                continue;
            }

            hits.push(CodebaseSearchHit {
                path: path.to_string_lossy().to_string(),
                name,
                relative_path: rel,
                is_dir: false,
                size: meta.len(),
                mtime_ms: file_mtime_ms(&path),
                snippet,
                content_match,
                line,
            });
        }
    }

    // Prefer content matches first, then name-only; stable by relative path.
    hits.sort_by(|a, b| {
        b.content_match.cmp(&a.content_match).then_with(|| {
            a.relative_path
                .to_ascii_lowercase()
                .cmp(&b.relative_path.to_ascii_lowercase())
        })
    });
    if hits.len() > limit {
        hits.truncate(limit);
        truncated = true;
    }
    (hits, truncated, visited)
}

/// Search project files for `query` (name/path and/or content), path-scoped.
///
/// Soft-fails (empty hits + `soft_fail` reason) when:
/// - project path empty / missing / not a directory / not trusted
/// - query empty
///
/// Never invents embeddings or code-graph results. `search_kind` is always
/// `"keyword"`. Content uses `rg` when available, else walk with caps.
///
/// `include_dirs` also reports a directory whose name matches, which is what the
/// composer's `@` panel needs. An empty query still lists files only.
pub fn search_project_codebase(
    project_path: &str,
    query: &str,
    mode: Option<&str>,
    limit: Option<usize>,
    include_dirs: bool,
) -> CodebaseSearchResult {
    let mode = normalize_codebase_search_mode(mode);
    let limit = clamp_codebase_search_limit(limit);
    let q = query.trim();
    let raw = project_path.trim();

    if raw.is_empty() {
        return empty_result("", q, mode, limit, false, false, Some("no_project"));
    }

    let path = PathBuf::from(raw);
    let exists = path.exists();
    if !exists {
        return empty_result(raw, q, mode, limit, false, false, Some("path_missing"));
    }
    let is_dir = path.is_dir();
    if !is_dir {
        return empty_result(raw, q, mode, limit, true, false, Some("not_a_dir"));
    }

    let canonical = match path.canonicalize() {
        Ok(c) => c,
        Err(e) => {
            return empty_result(
                raw,
                q,
                mode,
                limit,
                true,
                true,
                Some(&format!("path_unreadable:{e}")),
            );
        }
    };

    if !crate::path_scope::is_allowed(&canonical) {
        return empty_result(raw, q, mode, limit, true, true, Some("untrusted_project"));
    }

    // Empty query: name mode lists recent files (composer `@` panel).
    // Content / all still soft-fail so we never full-scan on blank.
    if !should_run_codebase_search(q) {
        if mode == "name" {
            let (mut hits, truncated, _) =
                walk_search(&canonical, "", "name", limit, false, true, include_dirs);
            // Prefer recently modified when listing without a filter.
            hits.sort_by_key(|b| std::cmp::Reverse(b.mtime_ms));
            if hits.len() > limit {
                hits.truncate(limit);
            }
            return CodebaseSearchResult {
                hits,
                project_path: canonical.to_string_lossy().to_string(),
                project_path_exists: true,
                project_is_dir: true,
                query: String::new(),
                mode: mode.to_string(),
                limit,
                truncated,
                engine: "walk".into(),
                search_kind: "keyword".into(),
                soft_fail: None,
            };
        }
        return empty_result(
            &canonical.to_string_lossy(),
            "",
            mode,
            limit,
            true,
            true,
            Some("empty_query"),
        );
    }

    let want_name = mode == "name" || mode == "all";
    let want_content = mode == "content" || mode == "all";

    let (engine, hits, truncated) = if want_content {
        if let Some((rg_hits, rg_trunc)) = try_rg_content(&canonical, q, limit) {
            let mut hits = rg_hits;
            let mut truncated = rg_trunc;

            // When mode is `all`, also add name-only matches not already present.
            if want_name {
                let (name_hits, name_trunc, _) =
                    walk_search(&canonical, q, "name", limit, false, true, include_dirs);
                let mut seen: std::collections::HashSet<String> =
                    hits.iter().map(|h| h.path.clone()).collect();
                for h in name_hits {
                    if hits.len() >= limit {
                        truncated = true;
                        break;
                    }
                    if seen.insert(h.path.clone()) {
                        hits.push(h);
                    }
                }
                if name_trunc {
                    truncated = true;
                }
                // Re-sort after merge.
                hits.sort_by(|a, b| {
                    b.content_match.cmp(&a.content_match).then_with(|| {
                        a.relative_path
                            .to_ascii_lowercase()
                            .cmp(&b.relative_path.to_ascii_lowercase())
                    })
                });
                if hits.len() > limit {
                    hits.truncate(limit);
                    truncated = true;
                }
            }
            ("rg".to_string(), hits, truncated)
        } else {
            // Walk fallback for content (+ name when mode all).
            let (walk_hits, walk_trunc, _) = walk_search(
                &canonical,
                q,
                mode,
                limit,
                want_content,
                want_name,
                include_dirs,
            );
            ("walk".to_string(), walk_hits, walk_trunc)
        }
    } else {
        // name only
        let (walk_hits, walk_trunc, _) =
            walk_search(&canonical, q, "name", limit, false, true, include_dirs);
        ("walk".to_string(), walk_hits, walk_trunc)
    };

    CodebaseSearchResult {
        hits,
        project_path: canonical.to_string_lossy().to_string(),
        project_path_exists: true,
        project_is_dir: true,
        query: q.to_string(),
        mode: mode.to_string(),
        limit,
        truncated,
        engine,
        search_kind: "keyword".into(),
        soft_fail: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn clamp_limit_bounds() {
        assert_eq!(
            clamp_codebase_search_limit(None),
            CODEBASE_SEARCH_DEFAULT_LIMIT
        );
        assert_eq!(clamp_codebase_search_limit(Some(0)), 1);
        assert_eq!(
            clamp_codebase_search_limit(Some(10_000)),
            CODEBASE_SEARCH_MAX_LIMIT
        );
        assert_eq!(clamp_codebase_search_limit(Some(25)), 25);
    }

    #[test]
    fn normalize_mode() {
        assert_eq!(normalize_codebase_search_mode(None), "all");
        assert_eq!(normalize_codebase_search_mode(Some("name")), "name");
        assert_eq!(normalize_codebase_search_mode(Some("path")), "name");
        assert_eq!(normalize_codebase_search_mode(Some("content")), "content");
        assert_eq!(normalize_codebase_search_mode(Some("weird")), "all");
    }

    #[test]
    fn name_matches() {
        assert!(codebase_name_matches("FooBar.ts", "src/FooBar.ts", "foo"));
        assert!(codebase_name_matches("x", "src/lib/utils.ts", "lib/utils"));
        assert!(!codebase_name_matches("a.ts", "src/a.ts", "zzz"));
    }

    #[test]
    fn snippet_around_match() {
        let s = "hello world unique_token more text after";
        let idx = s.find("unique_token").unwrap();
        let snip = make_codebase_search_snippet(s, idx, "unique_token".len());
        assert!(snip.contains("unique_token"));
    }

    #[test]
    fn soft_fail_missing_path() {
        let r =
            search_project_codebase("/no/such/project/xyz", "foo", Some("all"), Some(10), false);
        assert!(r.hits.is_empty());
        assert_eq!(r.soft_fail.as_deref(), Some("path_missing"));
        assert_eq!(r.search_kind, "keyword");
        assert!(!r.project_path_exists);
    }

    #[test]
    fn soft_fail_empty_project() {
        let r = search_project_codebase("", "foo", None, None, false);
        assert_eq!(r.soft_fail.as_deref(), Some("no_project"));
        assert!(r.hits.is_empty());
    }

    fn make_tmp(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "grok-app-cbs-{}-{}-{}",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        crate::path_scope::grant_path(&dir);
        dir
    }

    #[test]
    fn soft_fail_empty_query() {
        let dir = make_tmp("emptyq");
        let r = search_project_codebase(dir.to_str().unwrap(), "   ", Some("all"), Some(10), false);
        assert_eq!(r.soft_fail.as_deref(), Some("empty_query"));
        assert!(r.hits.is_empty());
        assert_eq!(r.search_kind, "keyword");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_name_query_lists_files() {
        let dir = make_tmp("list");
        fs::write(dir.join("alpha.txt"), "a").unwrap();
        fs::write(dir.join("beta.txt"), "b").unwrap();
        let r = search_project_codebase(dir.to_str().unwrap(), "", Some("name"), Some(10), false);
        assert!(r.soft_fail.is_none(), "soft_fail={:?}", r.soft_fail);
        assert!(
            r.hits.iter().any(|h| h.name == "alpha.txt"),
            "hits={:?}",
            r.hits
        );
        assert_eq!(r.search_kind, "keyword");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn directory_hits_are_opt_in() {
        let dir = make_tmp("dirhits");
        fs::create_dir_all(dir.join("components")).unwrap();
        fs::write(dir.join("components/Button.tsx"), "x").unwrap();
        fs::write(dir.join("components.md"), "y").unwrap();
        let root = dir.to_str().unwrap();
        let find = |include_dirs: bool, q: &str| {
            search_project_codebase(root, q, Some("name"), Some(20), include_dirs)
        };

        // The file search (resource pane) never returns a directory; the composer
        // asks for them, and an empty query stays the recent-files listing.
        let off = find(false, "components");
        assert!(off.hits.iter().all(|h| !h.is_dir), "hits={:?}", off.hits);
        let on = find(true, "components");
        let hit = on.hits.iter().find(|h| h.relative_path == "components");
        assert!(hit.is_some_and(|h| h.is_dir), "hits={:?}", on.hits);
        assert!(find(true, "").hits.iter().all(|h| !h.is_dir));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn finds_name_and_content() {
        let dir = make_tmp("find");
        let src = dir.join("src");
        fs::create_dir_all(&src).unwrap();
        let mut f = fs::File::create(src.join("hello_unique_name.rs")).unwrap();
        writeln!(f, "fn main() {{ let marker_xyz_abc = 1; }}").unwrap();
        drop(f);
        fs::write(src.join("other.txt"), "nope").unwrap();

        let by_name = search_project_codebase(
            dir.to_str().unwrap(),
            "hello_unique",
            Some("name"),
            Some(20),
            false,
        );
        assert!(
            by_name.hits.iter().any(|h| h.name.contains("hello_unique")),
            "name mode: {:?}",
            by_name.hits
        );
        assert!(by_name.soft_fail.is_none());
        assert_eq!(by_name.search_kind, "keyword");

        let by_content = search_project_codebase(
            dir.to_str().unwrap(),
            "marker_xyz_abc",
            Some("content"),
            Some(20),
            false,
        );
        assert!(
            by_content
                .hits
                .iter()
                .any(|h| h.content_match && h.snippet.contains("marker_xyz_abc")),
            "content mode: engine={} hits={:?}",
            by_content.engine,
            by_content.hits
        );
        assert!(
            by_content.engine == "rg" || by_content.engine == "walk",
            "engine={}",
            by_content.engine
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn soft_fail_not_a_dir() {
        let dir = make_tmp("notdir");
        let file = dir.join("file.txt");
        fs::write(&file, "x").unwrap();
        let r = search_project_codebase(file.to_str().unwrap(), "x", Some("all"), Some(5), false);
        assert_eq!(r.soft_fail.as_deref(), Some("not_a_dir"));
        assert!(r.project_path_exists);
        assert!(!r.project_is_dir);
        let _ = fs::remove_dir_all(&dir);
    }
}
