/**
 * Review / Changes empty honesty + workspace kind filter helpers.
 *
 * Classifies empty / unavailable states so UI never pretends a clean tree
 * when git is missing, the path is not a repo, or the Host load failed.
 * Pure — no DOM / Tauri side effects.
 */

import type { WorkspaceGitFile, WorkspaceGitKind } from "./workspaceGit";

/** Why workspace git status is not usable for listing. */
export type WorkspaceGitUnavailableKind =
  | "no_project"
  | "host_only"
  | "no_repo"
  | "no_git"
  | "load_error"
  | "unavailable";

/** Empty honesty for the Review tab stack (and shared pick preview). */
export type ReviewEmptyKind =
  | "not_git"
  | "no_project"
  | "loading"
  | "load_error"
  | "empty"
  | "filter_empty"
  | "ok";

/** Empty honesty for the Changes side list / preview when nothing is selected. */
export type ChangesPreviewEmptyKind =
  | "no_project"
  | "loading"
  | "no_repo"
  | "load_error"
  | "empty"
  | "pick"
  | "ok";

/** Kind chip filter for workspace (and review) rows. */
export type ChangesKindFilter = "all" | WorkspaceGitKind;

/** Ordered kinds shown as chips when present. */
export const CHANGES_KIND_FILTER_ORDER: readonly WorkspaceGitKind[] = [
  "modified",
  "added",
  "untracked",
  "deleted",
  "renamed",
  "copied",
  "typechange",
  "conflict",
  "ignored",
  "unknown",
] as const;

function reasonText(reason: string | null | undefined): string {
  return String(reason ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Map Host / catch `reason` strings to a stable unavailable kind.
 * Prefer explicit product phrases from git_status / git_review_bundle.
 */
export function classifyWorkspaceGitReasonText(
  reason: string | null | undefined,
): WorkspaceGitUnavailableKind {
  const r = reasonText(reason);
  if (!r) return "unavailable";
  if (
    r.includes("not a git") ||
    r.includes("not a git repository") ||
    r.includes("not a git work") ||
    r === "no_repo"
  ) {
    return "no_repo";
  }
  if (
    r.includes("git not available") ||
    r.includes("git missing") ||
    r === "no_git" ||
    (r.includes("not available") && r.includes("git"))
  ) {
    return "no_git";
  }
  if (
    r.includes("empty path") ||
    r.includes("project not a directory") ||
    r === "no_project"
  ) {
    return "no_project";
  }
  if (
    r.includes("host_only") ||
    r.includes("need tauri") ||
    r.includes("desktop only") ||
    r.includes("not in tauri")
  ) {
    return "host_only";
  }
  // IPC / spawn / parse failures → load_error (never silently “clean”)
  if (
    r.includes("failed") ||
    r.includes("error") ||
    r.includes("timeout") ||
    r.includes("spawn") ||
    r.includes("ipc") ||
    r.includes("eacces") ||
    r.includes("permission") ||
    r.includes("load_error")
  ) {
    return "load_error";
  }
  return "unavailable";
}

/**
 * Classify workspace git surface availability.
 * Returns null when status is available (rows may still be empty).
 */
export function classifyWorkspaceGitUnavailable(input: {
  projectPath?: string | null;
  isTauri?: boolean | null;
  available: boolean;
  reason?: string | null;
  /** When true and not yet available, treat as still loading (no empty banner). */
  loading?: boolean;
}): WorkspaceGitUnavailableKind | null {
  if (input.loading && !input.available) return null;
  const path = String(input.projectPath ?? "").trim();
  if (!path) return "no_project";
  if (input.isTauri === false) return "host_only";
  if (input.available) return null;
  return classifyWorkspaceGitReasonText(input.reason);
}

/** i18n title key for a workspace-unavailable kind. */
export function workspaceGitUnavailableTitleKey(
  kind: WorkspaceGitUnavailableKind,
): string {
  switch (kind) {
    case "no_project":
      return "changes.needProject";
    case "host_only":
      return "changes.workspace.hostOnly";
    case "no_repo":
      return "changes.workspace.noRepo";
    case "no_git":
      return "changes.workspace.noGit";
    case "load_error":
      return "changes.workspace.loadError";
    case "unavailable":
    default:
      return "changes.workspace.unavailable";
  }
}

/** Optional hint key (null when title alone is enough). */
export function workspaceGitUnavailableHintKey(
  kind: WorkspaceGitUnavailableKind,
): string | null {
  switch (kind) {
    case "no_repo":
      return "changes.workspace.noRepoHint";
    case "no_git":
      return "changes.workspace.noGitHint";
    case "load_error":
      return "changes.workspace.loadErrorHint";
    case "host_only":
      return "changes.workspace.hostOnlyHint";
    case "no_project":
      return "changes.needProjectHint";
    default:
      return "changes.workspace.unavailableHint";
  }
}

/**
 * Review tab empty classification (stack + tree).
 * Priority: not_git (no session) → no_project → loading → load_error →
 * filter_empty → empty → ok.
 */
export function resolveReviewEmptyState(input: {
  isGitProject: boolean;
  sessionCount: number;
  projectPath?: string | null;
  loading: boolean;
  /** Classified workspace load failure while git scope was requested. */
  loadErrorKind?: WorkspaceGitUnavailableKind | null;
  /** Total files after merge (pre text filter). */
  fileCount: number;
  /** Visible after text/kind filter. */
  visibleCount: number;
  hasActiveFilter?: boolean;
}): { kind: ReviewEmptyKind; titleKey: string; hintKey: string | null } {
  const sessionCount = Math.max(0, Math.floor(input.sessionCount || 0));
  const fileCount = Math.max(0, Math.floor(input.fileCount || 0));
  const visibleCount = Math.max(0, Math.floor(input.visibleCount || 0));
  const path = String(input.projectPath ?? "").trim();

  if (!input.isGitProject && sessionCount === 0) {
    return {
      kind: "not_git",
      titleKey: "side.review.notGit",
      hintKey: "side.review.notGitHint",
    };
  }

  if (!path && fileCount === 0 && sessionCount === 0) {
    return {
      kind: "no_project",
      titleKey: "main.noProject",
      hintKey: "changes.needProjectHint",
    };
  }

  if (input.loading && fileCount === 0) {
    return {
      kind: "loading",
      titleKey: "resources.loading",
      hintKey: null,
    };
  }

  if (
    fileCount === 0 &&
    input.loadErrorKind &&
    input.loadErrorKind !== "no_project"
  ) {
    return {
      kind: "load_error",
      titleKey: workspaceGitUnavailableTitleKey(input.loadErrorKind),
      hintKey: workspaceGitUnavailableHintKey(input.loadErrorKind),
    };
  }

  if (fileCount === 0) {
    return {
      kind: "empty",
      titleKey: "side.review.empty",
      hintKey: "side.review.emptyHint",
    };
  }

  if (visibleCount === 0 && (input.hasActiveFilter || fileCount > 0)) {
    return {
      kind: "filter_empty",
      titleKey: "changes.filterEmpty",
      hintKey: "changes.filterEmptyHint",
    };
  }

  return { kind: "ok", titleKey: "", hintKey: null };
}

/**
 * Changes preview empty when no file is selected (ResourceViewer center).
 * Prefer honest no-repo / load-error over “no session changes yet”.
 */
export function resolveChangesPreviewEmptyState(input: {
  projectPath?: string | null;
  sessionCount: number;
  workspaceCount: number;
  workspaceLoading: boolean;
  workspaceAvailable: boolean;
  workspaceReason?: string | null;
  isTauri?: boolean | null;
  hasSelection: boolean;
}): {
  kind: ChangesPreviewEmptyKind;
  titleKey: string;
  hintKey: string | null;
} {
  if (input.hasSelection) {
    return { kind: "ok", titleKey: "", hintKey: null };
  }

  const path = String(input.projectPath ?? "").trim();
  const sessionCount = Math.max(0, Math.floor(input.sessionCount || 0));
  const workspaceCount = Math.max(0, Math.floor(input.workspaceCount || 0));
  const total = sessionCount + workspaceCount;

  if (!path) {
    return {
      kind: "no_project",
      titleKey: "main.noProject",
      hintKey: "changes.needProjectHint",
    };
  }

  if (input.workspaceLoading && total === 0) {
    return {
      kind: "loading",
      titleKey: "changes.workspace.loading",
      hintKey: null,
    };
  }

  const unavail = classifyWorkspaceGitUnavailable({
    projectPath: path,
    isTauri: input.isTauri,
    available: input.workspaceAvailable,
    reason: input.workspaceReason,
    loading: input.workspaceLoading,
  });

  if (total === 0 && unavail === "no_repo") {
    return {
      kind: "no_repo",
      titleKey: "changes.workspace.noRepo",
      hintKey:
        sessionCount === 0
          ? "changes.workspace.noRepoHint"
          : workspaceGitUnavailableHintKey("no_repo"),
    };
  }

  if (
    total === 0 &&
    (unavail === "load_error" ||
      unavail === "no_git" ||
      unavail === "unavailable" ||
      unavail === "host_only")
  ) {
    return {
      kind: "load_error",
      titleKey: workspaceGitUnavailableTitleKey(unavail),
      hintKey: workspaceGitUnavailableHintKey(unavail),
    };
  }

  if (total === 0) {
    return {
      kind: "empty",
      titleKey: "changes.empty",
      hintKey: "changes.emptyHint",
    };
  }

  return {
    kind: "pick",
    titleKey: "changes.pickTitle",
    hintKey: "changes.pickHint",
  };
}

/** Session section empty copy (list). */
export function resolveSessionSectionEmpty(input: {
  query: string;
  sessionCount: number;
}): { titleKey: string; hintKey: string | null } {
  if (input.query.trim()) {
    return {
      titleKey: "changes.filterEmpty",
      hintKey: "changes.filterEmptyHint",
    };
  }
  return {
    titleKey: "changes.empty",
    hintKey: "changes.emptyHint",
  };
}

/** Workspace section empty when available but no rows (or filtered out). */
export function resolveWorkspaceSectionEmpty(input: {
  query: string;
  kindFilter: ChangesKindFilter;
  workspaceCount: number;
  filteredCount: number;
}): { titleKey: string; hintKey: string | null } {
  const activeFilter =
    input.query.trim().length > 0 || input.kindFilter !== "all";
  if (activeFilter && input.workspaceCount > 0 && input.filteredCount === 0) {
    return {
      titleKey: "changes.filterEmpty",
      hintKey: "changes.filterEmptyHint",
    };
  }
  return {
    titleKey: "changes.workspace.empty",
    hintKey: "changes.workspace.emptyHint",
  };
}

/** Count workspace rows by kind (for chips). */
export function countWorkspaceKinds(
  files: readonly WorkspaceGitFile[],
): Record<WorkspaceGitKind, number> {
  const out = Object.fromEntries(
    CHANGES_KIND_FILTER_ORDER.map((k) => [k, 0]),
  ) as Record<WorkspaceGitKind, number>;
  for (const f of files) {
    const k = (f.kind || "unknown") as WorkspaceGitKind;
    if (k in out) out[k] += 1;
    else out.unknown += 1;
  }
  return out;
}

/**
 * Kind chips to show: only kinds with count > 0 (plus caller adds "all").
 * Partial polish — hide zero kinds unless currently selected.
 */
export function presentWorkspaceKindFilters(
  counts: Record<WorkspaceGitKind, number>,
  active: ChangesKindFilter,
): WorkspaceGitKind[] {
  return CHANGES_KIND_FILTER_ORDER.filter(
    (k) => (counts[k] ?? 0) > 0 || active === k,
  );
}

/** True when more than one kind is present (chips are useful). */
export function shouldShowKindFilters(
  counts: Record<WorkspaceGitKind, number>,
): boolean {
  let nonzero = 0;
  for (const k of CHANGES_KIND_FILTER_ORDER) {
    if ((counts[k] ?? 0) > 0) nonzero += 1;
    if (nonzero > 1) return true;
  }
  return false;
}

/** Filter workspace rows by kind chip (`all` = no-op). */
export function filterWorkspaceByKind(
  files: readonly WorkspaceGitFile[],
  kind: ChangesKindFilter,
): WorkspaceGitFile[] {
  if (kind === "all") return files.slice();
  return files.filter((f) => (f.kind || "unknown") === kind);
}

/** Filter review/session-ish entries that carry a `kind` field. */
export function filterEntriesByKind<T extends { kind?: string | null }>(
  entries: readonly T[],
  kind: ChangesKindFilter,
): T[] {
  if (kind === "all") return entries.slice();
  return entries.filter((e) => (e.kind || "unknown") === kind);
}

/** Normalize free-form kind filter id from UI. */
export function normalizeChangesKindFilter(
  raw: string | null | undefined,
): ChangesKindFilter {
  const k = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!k || k === "all") return "all";
  if ((CHANGES_KIND_FILTER_ORDER as readonly string[]).includes(k)) {
    return k as WorkspaceGitKind;
  }
  return "all";
}
