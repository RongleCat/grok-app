/** API domain: fs */

import {
  invoke,
  isTauri,
} from "./host";

export async function projectAddDialog(trust: boolean) {
  return invoke<{
    id: string;
    name: string;
    path: string;
    trusted: boolean;
    pathOk: boolean;
  } | null>("project_add_dialog", { trust });
}

export async function pickDirectory() {
  return invoke<string | null>("pick_directory");
}

/** Native multi-file picker for composer attachments (empty if cancelled). */
export async function pickAttachFiles() {
  return invoke<string[]>("pick_attach_files");
}

/** Native folder picker for attaching a directory. */
export async function pickAttachFolder() {
  return invoke<string | null>("pick_attach_folder");
}

/**
 * Persist clipboard/webview File bytes into the app attachments dir.
 * Returns a classified path entry for `@path` agent refs.
 */
export async function saveTempAttachment(
  bytesBase64: string,
  suggestedName?: string | null,
  mime?: string | null,
) {
  return invoke<PathEntry>("save_temp_attachment", {
    bytesBase64,
    suggestedName: suggestedName ?? null,
    mime: mime ?? null,
  });
}

/**
 * Read an image from the OS clipboard (native) and save under attachments/paste.
 * Fallback when the WebView paste event has no File objects (macOS screenshots).
 * Returns null when the clipboard has no image.
 */
export async function clipboardPasteImage() {
  if (!isTauri()) return null;
  return invoke<PathEntry | null>("clipboard_paste_image");
}

/**
 * Absolute paths from the OS clipboard file list (Explorer / Finder copy).
 * Empty when the clipboard has no files (screenshots, text).
 */
export async function clipboardFilePaths() {
  if (!isTauri()) return [];
  try {
    const paths = await invoke<string[]>("clipboard_file_paths");
    return Array.isArray(paths) ? paths.filter((p) => !!p?.trim()) : [];
  } catch {
    return [];
  }
}

export interface PathEntry {
  path: string;
  name: string;
  isDir: boolean;
  exists: boolean;
}

/** Classify absolute paths as file/dir for drag-drop. */
export async function pathsClassify(paths: string[]) {
  if (!paths.length) return [];
  return invoke<PathEntry[]>("paths_classify", { paths });
}

/** Open with OS default app. */
export async function pathOpen(path: string) {
  return invoke<void>("path_open", { path });
}

/** Reveal in Finder / Explorer. */
export async function pathReveal(path: string) {
  return invoke<void>("path_reveal", { path });
}

/** Optional git unified diff for a project file (session Changes panel). */
export interface GitFileDiffResult {
  available: boolean;
  diff?: string | null;
  relativePath?: string | null;
  reason?: string | null;
}

export async function gitFileDiff(projectPath: string, path: string) {
  return invoke<GitFileDiffResult>("git_file_diff", { projectPath, path });
}

/** One file in the bulk review bundle (side Review tab). */
export interface GitReviewFile {
  path: string;
  absolutePath: string;
  name: string;
  kind: string;
  status: string;
  added: number;
  removed: number;
  diff?: string | null;
  binary: boolean;
}

/** Soft-fail bulk workspace diff for Review — one IPC instead of N× git_file_diff. */
export interface GitReviewBundleResult {
  available: boolean;
  branch?: string | null;
  upstream?: string | null;
  files: GitReviewFile[];
  totalAdded: number;
  totalRemoved: number;
  reason?: string | null;
}

export async function gitReviewBundle(projectPath: string) {
  return invoke<GitReviewBundleResult>("git_review_bundle", { projectPath });
}

/** One workspace file from `git status --porcelain` (Changes → Workspace). */
export interface GitStatusEntry {
  path: string;
  absolutePath: string;
  status: string;
  indexStatus: string;
  worktreeStatus: string;
  kind: string;
  name: string;
  originalPath?: string | null;
}

export interface GitStatusResult {
  available: boolean;
  files: GitStatusEntry[];
  branch?: string | null;
  reason?: string | null;
}

/** Soft-fail workspace git status for the project path. */
export async function gitStatus(projectPath: string) {
  return invoke<GitStatusResult>("git_status", { projectPath });
}

/** File content at HEAD (before snapshot for local unified diffs). */
export interface GitShowFileResult {
  available: boolean;
  content?: string | null;
  relativePath?: string | null;
  reason?: string | null;
}

export async function gitShowFile(projectPath: string, path: string) {
  return invoke<GitShowFileResult>("git_show_file", { projectPath, path });
}

/** Write full file content under project (Changes Accept / Restore / reject-before). */
export interface ApplyFilePatchResult {
  ok: boolean;
  absolutePath?: string | null;
  relativePath?: string | null;
  reason?: string | null;
}

export async function applyFilePatch(
  projectPath: string,
  path: string,
  content: string,
) {
  return invoke<ApplyFilePatchResult>("apply_file_patch", {
    projectPath,
    path,
    content,
  });
}

/** Restore path to HEAD or delete untracked (with confirm). */
export interface GitCheckoutFileResult {
  ok: boolean;
  absolutePath?: string | null;
  relativePath?: string | null;
  needsUntrackedConfirm?: boolean;
  reason?: string | null;
  action?: string | null;
}

export async function gitCheckoutFile(
  projectPath: string,
  path: string,
  confirmUntracked = false,
) {
  return invoke<GitCheckoutFileResult>("git_checkout_file", {
    projectPath,
    path,
    confirmUntracked,
  });
}

/** Delete a project file (non-git untracked reject after confirm). */
export async function deleteProjectFile(
  projectPath: string,
  path: string,
  confirm = false,
) {
  return invoke<GitCheckoutFileResult>("delete_project_file", {
    projectPath,
    path,
    confirm,
  });
}

export interface FsEntry {
  name: string;
  relativePath: string;
  isDir: boolean;
  size: number;
  ext: string;
}

export interface FsReadResult {
  relativePath: string;
  name: string;
  /** Absolute path for loopback media HTTP streaming (video/audio/large images). */
  absolutePath: string;
  size: number;
  kind: string;
  mime: string;
  text: string | null;
  base64: string | null;
  /** Prefer asset-protocol stream instead of base64 embed. */
  stream: boolean;
  truncated: boolean;
  error: string | null;
  /** Last modified (ms since epoch) for edit conflict checks. */
  mtimeMs?: number;
}

export interface FsWriteResult {
  relativePath: string;
  absolutePath: string;
  size: number;
  mtimeMs: number;
}

/** List directory under a trusted project root (relative path, "" = root). */
export async function fsListDir(projectPath: string, relative = "") {
  return invoke<FsEntry[]>("fs_list_dir", {
    projectPath,
    relative: relative || null,
  });
}

/**
 * Project-scoped keyword file/name + content search.
 * Host uses `rg` when available, else walk with caps. Soft-fails when path
 * missing / not a dir / untrusted. `searchKind` is always `"keyword"` —
 * never invents embeddings or CLI code-graph results.
 */
export type CodebaseSearchHit = {
  path: string;
  name: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
  snippet: string;
  contentMatch: boolean;
  line?: number | null;
};

export type CodebaseSearchResult = {
  hits: CodebaseSearchHit[];
  projectPath: string;
  projectPathExists: boolean;
  projectIsDir: boolean;
  query: string;
  /** name | content | all */
  mode: string;
  limit: number;
  truncated: boolean;
  /** rg | walk | none */
  engine: string;
  /** Always `"keyword"`. */
  searchKind: string;
  softFail?: string | null;
};

export async function projectCodebaseSearch(opts: {
  projectPath: string;
  query: string;
  mode?: "name" | "content" | "all" | string | null;
  limit?: number | null;
}) {
  return invoke<CodebaseSearchResult>("project_codebase_search", {
    projectPath: opts.projectPath,
    query: opts.query,
    mode: opts.mode ?? null,
    limit: opts.limit ?? null,
  });
}

/** Read file under project root for preview (text or base64). */
export async function fsReadFile(projectPath: string, relative: string) {
  return invoke<FsReadResult>("fs_read_file", {
    projectPath,
    relative,
  });
}

/** Save UTF-8 text under project root. Pass mtime from last read to detect conflicts. */
export async function fsWriteFile(
  projectPath: string,
  relative: string,
  content: string,
  expectedMtimeMs?: number | null,
) {
  return invoke<FsWriteResult>("fs_write_file", {
    projectPath,
    relative,
    content,
    expectedMtimeMs: expectedMtimeMs ?? null,
  });
}

/** Save UTF-8 text to an absolute path open in the resource pane. */
export async function fsWriteAbsolute(
  path: string,
  content: string,
  expectedMtimeMs?: number | null,
) {
  return invoke<FsWriteResult>("fs_write_absolute", {
    path,
    content,
    expectedMtimeMs: expectedMtimeMs ?? null,
  });
}

/** Read absolute filesystem path for chat → resource pane preview. */
export async function fsReadAbsolute(path: string) {
  return invoke<FsReadResult>("fs_read_absolute", { path });
}

/**
 * Smart open for chat file cards: absolute path, project-relative, or
 * suffix search under project (e.g. `05-handoff/next.md` in a subfolder).
 */
export async function fsOpenPath(path: string, projectPath?: string | null) {
  return invoke<FsReadResult>("fs_open_path", {
    path,
    projectPath: projectPath ?? null,
  });
}

/** Resolve-only (no body): path metadata for chat file cards. */
export interface FsResolveResult {
  absolutePath: string;
  name: string;
  size: number;
  isDir: boolean;
}

/**
 * Smart resolve without reading file contents. Prefer this over `fsOpenPath`
 * when you only need an absolute path (card title, missing check, open target).
 */
export async function fsResolvePath(path: string, projectPath?: string | null) {
  return invoke<FsResolveResult>("fs_resolve_path", {
    path,
    projectPath: projectPath ?? null,
  });
}

/** Auto-title session from first user message (heuristic + optional low-effort CLI). */
export async function sessionAutoTitle(id: string, firstMessage: string) {
  return invoke<{
    id: string;
    title: string;
    projectId: string | null;
    updatedAt: string;
  }>("session_auto_title", { id, firstMessage });
}

/** Cached chat video cover (JPEG path under app cache). */
export type VideoPosterResult = {
  posterPath: string;
  fromCache: boolean;
};

/**
 * Get or create a still cover for a local video path.
 * Host uses disk cache keyed by path+mtime+size; extracts via ffmpeg when missing.
 */
export async function mediaVideoPoster(path: string) {
  return invoke<VideoPosterResult>("media_video_poster", { path });
}

/** Cached chat image thumb (JPEG under app cache). */
export type ImageThumbResult = {
  thumbPath: string;
  fromCache: boolean;
  width: number;
  height: number;
  isOriginal: boolean;
};

/**
 * Get or create a chat-card image thumb for a local absolute path or http(s) URL.
 * Host resizes to ≤480px edge and stores under app cache (path+mtime or URL key).
 */
export async function mediaImageThumb(pathOrUrl: string) {
  return invoke<ImageThumbResult>("media_image_thumb", {
    pathOrUrl,
  });
}

/**
 * Persist a client canvas capture (JPEG base64, no data: prefix) into the same cache key.
 */
export async function mediaVideoPosterSave(path: string, jpegBase64: string) {
  return invoke<VideoPosterResult>("media_video_poster_save", {
    path,
    jpegBase64,
  });
}

export async function projectTrust(id: string) {
  return invoke("project_trust", { id });
}

/**
 * Set or clear a project-level permission tier (L10).
 * Pass `null` / `"inherit"` to fall back to the app default.
 * When the project is the live Host context, agent policy is synced.
 */
export async function projectSetPermissionPolicy(
  id: string,
  policy: string | null,
) {
  return invoke("project_set_permission_policy", {
    id,
    policy,
  });
}

/**
 * Set or clear a project-level OS sandbox profile.
 * Pass `null` / `"inherit"` to fall back to app Settings.
 * When the project is the live Host context, soft-respawns the agent.
 */
export async function projectSetSandboxProfile(
  id: string,
  profile: string | null,
) {
  return invoke("project_set_sandbox_profile", {
    id,
    profile,
  });
}

/** Remove project from app list only (no disk / session wipe). */
export async function projectRemove(id: string) {
  return invoke("project_remove", { id });
}

/**
 * Point project at a new directory (folder moved/renamed).
 * Host re-checks is_dir and sets pathOk true.
 */
export async function projectRelocate(id: string, path: string) {
  return invoke<{
    id: string;
    name: string;
    path: string;
    trusted: boolean;
    pathOk: boolean;
    pinned?: boolean;
  }>("project_relocate", { id, path });
}

export async function projectRename(id: string, name: string) {
  return invoke("project_rename", { id, name });
}

export async function projectSetPinned(id: string, pinned: boolean) {
  return invoke("project_set_pinned", { id, pinned });
}

/**
 * Set or clear a project sidebar accent color.
 * Pass `null` / `"none"` to clear. Accepts tokens (`blue`|…) or `#rgb`/`#rrggbb`.
 */
export async function projectSetColor(id: string, color: string | null) {
  return invoke<{
    id: string;
    name: string;
    path: string;
    trusted: boolean;
    pathOk: boolean;
    pinned?: boolean;
    color?: string | null;
  }>("project_set_color", { id, color });
}

export async function projectReveal(id: string) {
  return invoke("project_reveal", { id });
}

export async function projectArchiveSessions(id: string) {
  return invoke<number>("project_archive_sessions", { id });
}

