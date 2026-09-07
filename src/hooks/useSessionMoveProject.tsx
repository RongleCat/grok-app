/**
 * Confirm + apply moving App chats between projects (or Default workspace).
 * Host `session_move_to_project` is the only write path.
 */
import {
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ContextMenuItem } from "@/components/ContextMenu";
import { IconFolder } from "@/components/icons";
import type { AppDialog } from "@/lib/app/appDialogTypes";
import {
  isGeneralProject,
  projectDisplayName,
  type Project,
  type SessionRow,
} from "@/lib/app/sidebarModels";
import * as api from "@/lib/api";
import type { MessageKey } from "@/i18n";
import { isProjectFolderMissing } from "@/lib/projectPath";
import {
  applySessionMoveMeta,
  buildSessionMoveMenuTargets,
  classifySessionMoveError,
  evaluateSessionMove,
  sessionMoveConfirmKeys,
  sessionMoveErrorKey,
} from "@/lib/sessionMoveProject";

type Tr = (key: MessageKey, vars?: Record<string, string>) => string;

export function useSessionMoveProject(opts: {
  tr: Tr;
  projects: Project[];
  sessions: SessionRow[];
  busyIds: Set<string>;
  viewingSessionId: string | null;
  setAppDialog: (d: AppDialog) => void;
  showToast: (msg: string, ms?: number) => void;
  setSessions: Dispatch<SetStateAction<SessionRow[]>>;
  setActiveProject: Dispatch<SetStateAction<Project | null>>;
  setExpandedProjects: Dispatch<SetStateAction<Record<string, boolean>>>;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  onViewingMoved: (sessionId: string) => void;
  refreshSessions: () => Promise<void>;
  onMoved?: () => void;
}) {
  const {
    tr,
    projects,
    sessions,
    busyIds,
    viewingSessionId,
    setAppDialog,
    showToast,
    setSessions,
    setActiveProject,
    setExpandedProjects,
    setHistoryOpen,
    onViewingMoved,
    refreshSessions,
    onMoved,
  } = opts;

  const applyMove = useCallback(
    async (rows: SessionRow[], targetProjectId: string | null) => {
      if (!api.isTauri()) {
        showToast(tr("error.needTauri"), 4000);
        return;
      }
      const target = targetProjectId
        ? (projects.find((p) => p.id === targetProjectId) ?? null)
        : null;
      let ok = 0;
      let firstErr: unknown = null;
      const movedIds: string[] = [];
      for (const row of rows) {
        try {
          await api.sessionMoveToProject(row.id, targetProjectId);
          ok += 1;
          movedIds.push(row.id);
        } catch (e) {
          if (!firstErr) firstErr = e;
        }
      }
      if (ok > 0) {
        setSessions((list) =>
          list.map((s) =>
            movedIds.includes(s.id)
              ? applySessionMoveMeta(s, targetProjectId)
              : s,
          ),
        );
        if (target) {
          setExpandedProjects((e) => ({ ...e, [target.id]: true }));
        } else {
          setHistoryOpen(true);
        }
        if (viewingSessionId && movedIds.includes(viewingSessionId)) {
          setActiveProject(target);
          onViewingMoved(viewingSessionId);
        }
        await refreshSessions();
        onMoved?.();
        const projectName = target
          ? projectDisplayName(target, tr)
          : tr("sidebar.otherSessions");
        if (ok === 1) {
          const name = (rows[0]?.title || tr("session.untitled")).trim();
          showToast(
            tr("session.move.ok", { name, project: projectName }),
            3200,
          );
        } else {
          showToast(
            tr("session.move.manyOk", {
              n: String(ok),
              project: projectName,
            }),
            3200,
          );
        }
      }
      if (firstErr) {
        const kind = classifySessionMoveError(firstErr);
        const name = target ? projectDisplayName(target, tr) : "";
        showToast(tr(sessionMoveErrorKey(kind), { name }), 4500);
      }
    },
    [
      onMoved,
      onViewingMoved,
      projects,
      refreshSessions,
      setActiveProject,
      setExpandedProjects,
      setHistoryOpen,
      setSessions,
      showToast,
      tr,
      viewingSessionId,
    ],
  );

  const requestMove = useCallback(
    (rows: SessionRow[], targetProjectId: string | null) => {
      const unique = rows.filter(
        (r, i, a) => a.findIndex((x) => x.id === r.id) === i,
      );
      if (!unique.length) return;
      const target =
        targetProjectId &&
        !isGeneralProject(
          projects.find((p) => p.id === targetProjectId) ?? null,
        )
          ? (projects.find((p) => p.id === targetProjectId) ?? null)
          : null;
      const pid = target?.id ?? null;
      const blocked: string[] = [];
      const toMove: SessionRow[] = [];
      for (const row of unique) {
        const ev = evaluateSessionMove({
          session: row,
          targetProjectId: pid,
          projects,
          busy: busyIds.has(row.id),
        });
        if (ev.reason === "same_project") continue;
        if (!ev.allowed) {
          blocked.push(ev.reason);
          continue;
        }
        toMove.push(row);
      }
      if (!toMove.length) {
        const reason = blocked[0];
        if (reason === "busy") {
          showToast(tr("session.move.busy"), 4000);
        } else if (reason === "untrusted" && target) {
          showToast(
            tr("session.move.untrusted", {
              name: projectDisplayName(target, tr),
            }),
            4000,
          );
        } else if (reason === "path_missing" && target) {
          showToast(
            tr("session.move.pathMissing", {
              name: projectDisplayName(target, tr),
            }),
            4000,
          );
        } else if (reason === "project_not_found") {
          showToast(tr("session.move.notFound"), 4000);
        }
        return;
      }
      const keys = sessionMoveConfirmKeys({
        count: toMove.length,
      });
      const firstName = (toMove[0]?.title || tr("session.untitled")).trim();
      const projectName = target
        ? projectDisplayName(target, tr)
        : tr("sidebar.otherSessions");
      setAppDialog({
        kind: "confirm",
        title: tr(keys.title),
        message: tr(keys.message, {
          name: firstName,
          n: String(toMove.length),
          project: projectName,
        }),
        confirmLabel: tr(keys.action, { n: String(toMove.length) }),
        onConfirm: () => {
          void applyMove(toMove, pid);
        },
      });
    },
    [applyMove, busyIds, projects, setAppDialog, showToast, tr],
  );

  const moveMenuItemsFor = useCallback(
    (row: SessionRow): ContextMenuItem[] => {
      const targets = buildSessionMoveMenuTargets({
        projects,
        currentProjectId: row.projectId,
        otherSessionsLabel: tr("sidebar.otherSessions"),
      });
      if (!targets.length) return [];
      return [
        {
          id: "move",
          label: tr("session.move"),
          icon: <IconFolder size={16} />,
          children: targets.map((t) => ({
            id: t.id ? `move-${t.id}` : "move-orphan",
            label: t.id ? t.label : tr("sidebar.otherSessions"),
            disabled: t.disabled || busyIds.has(row.id),
            onClick: () => requestMove([row], t.id),
          })),
        },
      ];
    },
    [busyIds, projects, requestMove, tr],
  );

  const bulkMoveMenuItems = useCallback(
    (ids: string[]): ContextMenuItem[] => {
      const rows = sessions.filter((s) => ids.includes(s.id));
      if (!rows.length) return [];
      const current =
        rows.length === 1 ? (rows[0]?.projectId ?? null) : undefined;
      const targets = buildSessionMoveMenuTargets({
        projects,
        currentProjectId: current ?? null,
        otherSessionsLabel: tr("sidebar.otherSessions"),
      });
      // Multi-select: always include Default workspace + every project.
      const list =
        rows.length > 1
          ? [
              {
                id: null as string | null,
                label: tr("sidebar.otherSessions"),
                disabled: false,
              },
              ...projects
                .filter((p) => !isGeneralProject(p))
                .map((p) => ({
                  id: p.id as string | null,
                  label: p.name,
                  disabled: !p.trusted || isProjectFolderMissing(p),
                })),
            ]
          : targets;
      return list.map((t) => ({
        id: t.id ? `bulk-move-${t.id}` : "bulk-move-orphan",
        label: t.label,
        disabled: t.disabled,
        onClick: () => requestMove(rows, t.id),
      }));
    },
    [projects, requestMove, sessions, tr],
  );

  return { requestMove, moveMenuItemsFor, bulkMoveMenuItems };
}
