/**
 * Policy for moving an App chat under another project (or back to
 * Default workspace).
 *
 * Changing projectId also changes agent cwd. Relative journal paths, skill
 * outputs, and FilePathCards then resolve against the new root — so the UI
 * must confirm, and the Host must drop the old agent session instead of
 * session/load into the new folder.
 */

import { GENERAL_PROJECT_ID } from "@/lib/app/sidebarModels";
import type { MessageKey } from "@/i18n";
import { isProjectFolderMissing } from "@/lib/projectPath";

export type SessionMoveReason =
  | "ok"
  | "same_project"
  | "busy"
  | "untrusted"
  | "path_missing"
  | "project_not_found";

export type SessionMoveProject = {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
  pathOk: boolean;
  sshAlias?: string | null;
};

export type SessionMoveRow = {
  id: string;
  title?: string;
  projectId: string | null;
  agentSessionId?: string | null;
  worktreePath?: string | null;
  worktreeBranch?: string | null;
  isWorktreeSession?: boolean;
};

export function normalizeMoveProjectId(
  id: string | null | undefined,
): string | null {
  const t = (id ?? "").trim();
  if (!t || t === GENERAL_PROJECT_ID) return null;
  return t;
}

export function sessionMoveCwdChanges(
  fromProjectId: string | null | undefined,
  toProjectId: string | null | undefined,
): boolean {
  return (
    normalizeMoveProjectId(fromProjectId) !==
    normalizeMoveProjectId(toProjectId)
  );
}

export function evaluateSessionMove(input: {
  session: Pick<SessionMoveRow, "projectId">;
  targetProjectId: string | null;
  projects: Array<Pick<SessionMoveProject, "id" | "trusted" | "pathOk" | "sshAlias">>;
  busy: boolean;
}): {
  allowed: boolean;
  reason: SessionMoveReason;
  cwdChanges: boolean;
  needsConfirm: boolean;
  clearAgentSession: boolean;
  clearWorktree: boolean;
} {
  const from = normalizeMoveProjectId(input.session.projectId);
  const to = normalizeMoveProjectId(input.targetProjectId);
  const cwdChanges = from !== to;
  if (!cwdChanges) {
    return {
      allowed: true,
      reason: "same_project",
      cwdChanges: false,
      needsConfirm: false,
      clearAgentSession: false,
      clearWorktree: false,
    };
  }
  if (to) {
    const proj = input.projects.find((p) => p.id === to);
    if (!proj) {
      return fail("project_not_found", cwdChanges);
    }
    if (!proj.trusted) {
      return fail("untrusted", cwdChanges);
    }
    if (isProjectFolderMissing(proj)) {
      return fail("path_missing", cwdChanges);
    }
  }
  if (input.busy) {
    return fail("busy", cwdChanges);
  }
  return {
    allowed: true,
    reason: "ok",
    cwdChanges: true,
    needsConfirm: true,
    clearAgentSession: true,
    clearWorktree: true,
  };
}

function fail(
  reason: SessionMoveReason,
  cwdChanges: boolean,
): {
  allowed: boolean;
  reason: SessionMoveReason;
  cwdChanges: boolean;
  needsConfirm: boolean;
  clearAgentSession: boolean;
  clearWorktree: boolean;
} {
  return {
    allowed: false,
    reason,
    cwdChanges,
    needsConfirm: false,
    clearAgentSession: false,
    clearWorktree: false,
  };
}

export function applySessionMoveMeta<T extends SessionMoveRow>(
  row: T,
  targetProjectId: string | null,
): T {
  const nextId = normalizeMoveProjectId(targetProjectId);
  if (!sessionMoveCwdChanges(row.projectId, nextId)) {
    return { ...row, projectId: nextId };
  }
  return {
    ...row,
    projectId: nextId,
    agentSessionId: null,
    worktreePath: null,
    worktreeBranch: null,
    isWorktreeSession: false,
  };
}

export type SessionMoveMenuTarget = {
  id: string | null;
  label: string;
  disabled: boolean;
  reason: SessionMoveReason | null;
};

export function buildSessionMoveMenuTargets(input: {
  projects: SessionMoveProject[];
  currentProjectId: string | null | undefined;
  otherSessionsLabel: string;
}): SessionMoveMenuTarget[] {
  const current = normalizeMoveProjectId(input.currentProjectId);
  const out: SessionMoveMenuTarget[] = [];
  if (current) {
    out.push({
      id: null,
      label: input.otherSessionsLabel,
      disabled: false,
      reason: null,
    });
  }
  for (const p of input.projects) {
    const id = normalizeMoveProjectId(p.id);
    if (!id || id === current) continue;
    if (!p.trusted) {
      out.push({ id, label: p.name, disabled: true, reason: "untrusted" });
      continue;
    }
    if (isProjectFolderMissing(p)) {
      out.push({ id, label: p.name, disabled: true, reason: "path_missing" });
      continue;
    }
    out.push({ id, label: p.name, disabled: false, reason: null });
  }
  return out;
}

export function sessionMoveConfirmKeys(input: { count: number }): {
  title: MessageKey;
  message: MessageKey;
  action: MessageKey;
} {
  const many = input.count > 1;
  if (many) {
    return {
      title: "session.move.manyTitle",
      message: "session.move.manyConfirm",
      action: "session.move.manyAction",
    };
  }
  return {
    title: "session.move.title",
    message: "session.move.confirm",
    action: "session.move.action",
  };
}

export type SessionMoveErrorKind =
  | "busy"
  | "untrusted"
  | "path_missing"
  | "not_found"
  | "other";

export function classifySessionMoveError(err: unknown): SessionMoveErrorKind {
  const raw =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : String(err ?? "");
  const s = raw.toLowerCase();
  if (s.includes("session_move_busy")) return "busy";
  if (s.includes("session_move_untrusted")) return "untrusted";
  if (s.includes("session_move_path_missing")) return "path_missing";
  if (s.includes("session_move_not_found") || s.includes("project not found")) {
    return "not_found";
  }
  return "other";
}

export function sessionMoveErrorKey(kind: SessionMoveErrorKind): MessageKey {
  switch (kind) {
    case "busy":
      return "session.move.busy";
    case "untrusted":
      return "session.move.untrusted";
    case "path_missing":
      return "session.move.pathMissing";
    case "not_found":
      return "session.move.notFound";
    default:
      return "session.move.failed";
  }
}

/** Marker on the Other-sessions header so a session drag can unbind. */
export const SESSION_DROP_ORPHAN = "__orphan__";

export function parseSessionDropId(
  raw: string | null | undefined,
): { hit: true; projectId: string | null } | { hit: false } {
  const t = (raw ?? "").trim();
  if (!t) return { hit: false };
  if (t === SESSION_DROP_ORPHAN) return { hit: true, projectId: null };
  return { hit: true, projectId: t };
}

/** Multi-select: dragging one checked row moves the whole selection. */
export function sessionIdsForDrag(input: {
  draggedId: string;
  selectedIds: readonly string[];
  selectMode: boolean;
}): string[] {
  if (
    input.selectMode &&
    input.selectedIds.includes(input.draggedId) &&
    input.selectedIds.length > 1
  ) {
    return [...input.selectedIds];
  }
  return [input.draggedId];
}

export function isSameProjectDrop(
  rows: Array<Pick<SessionMoveRow, "projectId">>,
  targetProjectId: string | null,
): boolean {
  if (!rows.length) return true;
  const to = normalizeMoveProjectId(targetProjectId);
  return rows.every((r) => normalizeMoveProjectId(r.projectId) === to);
}
