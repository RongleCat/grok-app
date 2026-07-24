/**
 * Workspace git status helpers for the Changes panel.
 * Pure functions for kind labels, filtering, path resolve, and porcelain classification.
 */

import { normalizePath, pathBaseName } from "@/lib/sessionChanges";

/** Coarse workspace change kinds (aligned with Host `git_status_kind`). */
export type WorkspaceGitKind =
  | "modified"
  | "added"
  | "deleted"
  | "untracked"
  | "renamed"
  | "copied"
  | "typechange"
  | "conflict"
  | "ignored"
  | "unknown";

/** UI row for a workspace git entry (frontend-normalized). */
export interface WorkspaceGitFile {
  /** Repo-relative path (merge / filter key). */
  path: string;
  /** Absolute path when known. */
  absolutePath: string;
  /** Two-char porcelain code. */
  status: string;
  indexStatus: string;
  worktreeStatus: string;
  kind: WorkspaceGitKind;
  name: string;
  originalPath?: string;
}

/** Raw entry shape from the `git_status` Tauri command. */
export interface WorkspaceGitRawEntry {
  path?: string | null;
  absolutePath?: string | null;
  status?: string | null;
  indexStatus?: string | null;
  worktreeStatus?: string | null;
  kind?: string | null;
  name?: string | null;
  originalPath?: string | null;
}

const KIND_SET = new Set<string>([
  "modified",
  "added",
  "deleted",
  "untracked",
  "renamed",
  "copied",
  "typechange",
  "conflict",
  "ignored",
  "unknown",
]);

/** Classify porcelain XY chars into a coarse kind. */
export function classifyGitStatusCode(
  indexStatus: string,
  worktreeStatus: string,
): WorkspaceGitKind {
  const x = (indexStatus || " ").charAt(0) || " ";
  const y = (worktreeStatus || " ").charAt(0) || " ";
  if (x === "?" && y === "?") return "untracked";
  if (x === "!" && y === "!") return "ignored";
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
    return "conflict";
  }
  for (const c of [y, x]) {
    if (c === "R") return "renamed";
    if (c === "C") return "copied";
    if (c === "A") return "added";
    if (c === "D") return "deleted";
    if (c === "T") return "typechange";
    if (c === "M") return "modified";
  }
  if (x !== " " || y !== " ") return "modified";
  return "unknown";
}

/** Parse a two-char status string (` M`, `??`, `MM`, …). */
export function classifyGitStatusString(status: string): WorkspaceGitKind {
  const s = status || "  ";
  const x = s.charAt(0) || " ";
  const y = s.charAt(1) || " ";
  return classifyGitStatusCode(x, y);
}

/** Normalize a Host/API entry into a stable UI row. */
export function normalizeWorkspaceGitEntry(
  raw: WorkspaceGitRawEntry,
  projectPath?: string | null,
): WorkspaceGitFile | null {
  const rel = normalizePath(raw.path || "");
  if (!rel) return null;
  const absRaw = normalizePath(raw.absolutePath || "");
  const abs =
    absRaw ||
    resolveWorkspaceAbsolutePath(projectPath, rel) ||
    rel;
  const status = (raw.status || "  ").slice(0, 2).padEnd(2, " ");
  const indexStatus = (raw.indexStatus || status.charAt(0) || " ").slice(0, 1);
  const worktreeStatus = (
    raw.worktreeStatus ||
    status.charAt(1) ||
    " "
  ).slice(0, 1);
  const kindRaw = (raw.kind || "").toLowerCase().trim();
  const kind: WorkspaceGitKind = KIND_SET.has(kindRaw)
    ? (kindRaw as WorkspaceGitKind)
    : classifyGitStatusCode(indexStatus, worktreeStatus);
  const name =
    (raw.name || "").trim() || pathBaseName(rel) || pathBaseName(abs) || rel;
  const originalPath = raw.originalPath
    ? normalizePath(raw.originalPath) || undefined
    : undefined;
  return {
    path: rel,
    absolutePath: abs,
    status,
    indexStatus,
    worktreeStatus,
    kind,
    name,
    originalPath,
  };
}

export function normalizeWorkspaceGitEntries(
  raw: WorkspaceGitRawEntry[] | null | undefined,
  projectPath?: string | null,
): WorkspaceGitFile[] {
  if (!raw || raw.length === 0) return [];
  const out: WorkspaceGitFile[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const e = normalizeWorkspaceGitEntry(r, projectPath);
    if (!e) continue;
    const key = e.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** Case-insensitive filter by path / name / kind / status code. */
export function filterWorkspaceGitEntries(
  entries: WorkspaceGitFile[],
  query: string,
): WorkspaceGitFile[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) =>
      e.name.toLowerCase().includes(q) ||
      e.path.toLowerCase().includes(q) ||
      e.kind.toLowerCase().includes(q) ||
      e.status.toLowerCase().includes(q) ||
      (e.originalPath || "").toLowerCase().includes(q),
  );
}

/**
 * Absolute path under project for a repo-relative path.
 * Returns empty string when project is missing.
 */
export function resolveWorkspaceAbsolutePath(
  projectPath: string | null | undefined,
  relativePath: string,
): string {
  const root = normalizePath(projectPath || "");
  const rel = normalizePath(relativePath || "");
  if (!rel) return "";
  // Already absolute (unix or windows drive)
  if (rel.startsWith("/") || /^[a-zA-Z]:\//.test(rel)) return rel;
  if (!root) return rel;
  return `${root.replace(/\/+$/, "")}/${rel.replace(/^\/+/, "")}`;
}

/** i18n key suffix for a workspace kind (`changes.workspace.kind.modified`, …). */
export function workspaceGitKindMessageKey(
  kind: WorkspaceGitKind | string,
): string {
  const k = (kind || "unknown").toLowerCase();
  if (KIND_SET.has(k)) return `changes.workspace.kind.${k}`;
  return "changes.workspace.kind.unknown";
}

/** Short badge letter for list rows (M / A / D / U / R / C / ! / ?). */
export function workspaceGitKindBadge(kind: WorkspaceGitKind | string): string {
  switch ((kind || "").toLowerCase()) {
    case "modified":
    case "typechange":
      return "M";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "untracked":
      return "U";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "conflict":
      return "!";
    case "ignored":
      return "I";
    default:
      return "?";
  }
}

/**
 * Whether a workspace entry is safe to consider for a future discard action
 * (unstaged tracked modification only — not untracked, not staged-only, not conflict).
 * Currently unused in UI (discard skipped as risky); kept for product completeness.
 */
export function isSafeDiscardCandidate(entry: WorkspaceGitFile): boolean {
  if (entry.kind === "untracked" || entry.kind === "ignored") return false;
  if (entry.kind === "conflict" || entry.kind === "deleted") return false;
  if (entry.kind === "renamed" || entry.kind === "copied") return false;
  // Staged side must be clean (space); worktree dirty
  const idx = entry.indexStatus || " ";
  const wt = entry.worktreeStatus || " ";
  return idx === " " && wt !== " " && wt !== "?" && wt !== "!";
}
