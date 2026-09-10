/**
 * Session / bulk-move sidebar context-menu items.
 */
import type { Dispatch, RefObject, SetStateAction } from "react";
import { type ContextMenuItem } from "@/components/ContextMenu";
import * as api from "@/lib/api";
import { IconArchive, IconArrowsMinimize, IconBell, IconBellOff, IconChat, IconCheck, IconCircle, IconCopy, IconExportImage, IconExternalLink, IconFiles, IconFolder, IconFork, IconGitBranch, IconList, IconListCheck, IconListNumbers, IconNotes, IconPin, IconPinOff, IconPlan, IconPuzzle, IconRename, IconRewind, IconRobot, IconSettings, IconTrash, IconUpload } from "@/components/icons";
import { dispatchCollapseAllActivity } from "@/lib/collapseAllActivity";
import { canRemoveWorktree, pathsEqual, type GitWorktreeEntry, type SessionWorktreeBadge } from "@/lib/gitWorktree";
import { canOpenSessionInNewWindow } from "@/lib/multiWindow";
import { isSessionExportJournalEmpty, joinSessionExportMenuSuffix, resolveSessionExportPath, sessionExportFormatNameKey, sessionExportMenuSuffixKeys } from "@/lib/sessionExportPro";
import { normalizeMaxAgentTurns } from "@/lib/sessionMaxAgentTurns";
import { canOfferResumeWithCodeRestore } from "@/lib/sessionResumeRestore";
import { sanitizeSystemPromptOverride } from "@/lib/sessionSystemPrompt";
import { createT } from "@/i18n";
import type { ChatMessage, SessionSnapshot } from "@/lib/session";
import { type Project, type SessionRow } from "@/lib/app/sidebarModels";
import type { ContextMenuState } from "@/lib/app/appDialogTypes";
import type { StreamSessionExportFormat } from "@/lib/streamSessionExport";
import type { TranscriptFilterMode } from "@/lib/transcriptFilterPref";

type TFn = ReturnType<typeof createT>;

/** Minimal session identity the export callbacks operate on. */
export type SessionExportTarget = {
  id: string;
  title: string;
  projectId?: string | null;
};

export type WorkbenchSessionContextMenuProps = {
  ctxMenu: ContextMenuState;
  activeProject: Project | null;
  addSessionPluginDir: (s: SessionRow) => Promise<void>;
  applyAttachedChat: (id: string, title: string, updatedAt?: string) => void;
  archiveSession: (s: SessionRow, archived?: boolean) => Promise<void>;
  bulkMoveMenuItems: (ids: string[]) => ContextMenuItem[];
  busyIds: Set<string>;
  canRewindSession: boolean;
  clearSessionPluginDirs: (s: SessionRow) => Promise<void>;
  confirmExportSessionTraceUpload: (sessionId?: string | null) => void;
  confirmForkSession: (source: SessionRow, throughUserPromptIndex?: number | null) => void;
  confirmRemoveWorktree: (wt: GitWorktreeEntry) => void;
  confirmResumeWithCodeRestore: (source: SessionRow) => void;
  copyConversationMarkdown: (sessionMeta?: SessionExportTarget) => Promise<void>;
  copySessionId: (s: SessionRow) => Promise<void>;
  deleteSessionConfirm: (s: SessionRow) => void;
  enterSessionSelectMode: (preselectId?: string) => void;
  exportSessionDiagnostic: (sessionId?: string | null) => Promise<void>;
  exportSessionHtml: (sessionMeta?: SessionExportTarget) => Promise<void>;
  exportSessionJson: (sessionMeta?: SessionExportTarget) => Promise<void>;
  exportSessionPlain: (sessionMeta?: SessionExportTarget) => Promise<void>;
  exportSessionStreamNdjson: (
    format: StreamSessionExportFormat,
    sessionMeta?: SessionExportTarget,
  ) => Promise<void>;
  exportSessionTrace: (
    sessionId?: string | null,
    opts?: { localOnly?: boolean },
  ) => Promise<void>;
  forkBusy: boolean;
  gitWorktrees: GitWorktreeEntry[];
  gitWorktreesAvailable: boolean | null;
  handleClearAllSessionUnread: () => void;
  handleClearSessionUnread: (sessionId: string) => void;
  handleMarkSessionUnread: (sessionId: string) => void;
  handleToggleSessionMute: (sessionId: string) => void;
  isSecondaryWindow: boolean;
  messages: ChatMessage[];
  moveMenuItemsFor: (row: SessionRow) => ContextMenuItem[];
  mutedSessionIds: Set<string>;
  navigator: Navigator;
  openExportSessionImage: (sessionMeta?: SessionExportTarget) => void;
  openExportSessionMd: (sessionMeta?: SessionExportTarget) => void;
  openRewindTimeline: (sessionId: string) => Promise<void>;
  openSessionInNewWindow: (s: SessionRow) => void;
  openSessionMaxTurns: (s: SessionRow) => void;
  openSessionNote: (s: SessionRow) => void;
  openSessionRules: (s: SessionRow) => void;
  openSessionSysPrompt: (s: SessionRow) => void;
  openShipFlow: () => void;
  pinSession: (s: SessionRow, pinned?: boolean) => Promise<void>;
  projects: Project[];
  renameSession: (s: SessionRow) => void;
  resumeRestoreBusy: boolean;
  runDuplicateSession: (source: SessionRow) => Promise<void>;
  session: SessionSnapshot;
  sessionSelectMode: boolean;
  sessionWorktreeBadgeFor: (s: SessionRow) => SessionWorktreeBadge | null;
  sessions: SessionRow[];
  setLocalError: Dispatch<SetStateAction<string | null>>;
  setShowPlanHistory: Dispatch<SetStateAction<boolean>>;
  setShowTraces: Dispatch<SetStateAction<boolean>>;
  showToast: (msg: string, ms?: number) => void;
  toggleTranscriptFilter: () => void;
  transcriptFilter: TranscriptFilterMode;
  tr: TFn;
  unreadSessionIds: Set<string>;
  viewingSessionIdRef: RefObject<string | null>;
};

export function buildSessionContextMenuItems(
  p: WorkbenchSessionContextMenuProps,
): ContextMenuItem[] {
  const {
    activeProject,
    addSessionPluginDir,
    applyAttachedChat,
    archiveSession,
    bulkMoveMenuItems,
    busyIds,
    canRewindSession,
    clearSessionPluginDirs,
    confirmExportSessionTraceUpload,
    confirmForkSession,
    confirmRemoveWorktree,
    confirmResumeWithCodeRestore,
    copyConversationMarkdown,
    copySessionId,
    deleteSessionConfirm,
    enterSessionSelectMode,
    exportSessionDiagnostic,
    exportSessionHtml,
    exportSessionJson,
    exportSessionPlain,
    exportSessionStreamNdjson,
    exportSessionTrace,
    forkBusy,
    gitWorktrees,
    handleClearAllSessionUnread,
    handleClearSessionUnread,
    handleMarkSessionUnread,
    handleToggleSessionMute,
    isSecondaryWindow,
    messages,
    mutedSessionIds,
    navigator,
    openExportSessionImage,
    openExportSessionMd,
    openRewindTimeline,
    openSessionInNewWindow,
    openSessionMaxTurns,
    openSessionNote,
    openSessionRules,
    openSessionSysPrompt,
    openShipFlow,
    pinSession,
    projects,
    renameSession,
    resumeRestoreBusy,
    runDuplicateSession,
    session,
    sessionSelectMode,
    sessionWorktreeBadgeFor,
    sessions,
    setLocalError,
    setShowPlanHistory,
    setShowTraces,
    showToast,
    toggleTranscriptFilter,
    tr,
    moveMenuItemsFor,
    gitWorktreesAvailable,
    transcriptFilter,
    unreadSessionIds,
    viewingSessionIdRef,
  } = p;
  const ctxMenu = p.ctxMenu;
  let items: ContextMenuItem[] = [];
        if (ctxMenu?.kind === "session-move") {
          items = bulkMoveMenuItems(ctxMenu.ids);
        } else if (ctxMenu?.kind === "session") {
          const s = sessions.find((x) => x.id === ctxMenu.id);
          if (s) {
            const isOpen =
              session.sessionId === s.id ||
              viewingSessionIdRef.current === s.id;
            const wtBadge = sessionWorktreeBadgeFor(s);
            const sessionMuted = mutedSessionIds.has(s.id);
            const sessionUnread = unreadSessionIds.has(s.id);
            const canPopOut = canOpenSessionInNewWindow({
              isDesktopHost: api.isDesktopHost(),
              isSecondaryWindow,
              sessionId: s.id,
            });

            const settingsChildren: ContextMenuItem[] = [
              {
                id: "session-note",
                label: tr("session.note"),
                icon: <IconNotes size={16} />,
                onClick: () => openSessionNote(s),
              },
              {
                id: "session-rules",
                label: tr("session.rules"),
                icon: <IconList size={16} />,
                onClick: () => openSessionRules(s),
              },
              {
                id: "session-sys-prompt",
                label: sanitizeSystemPromptOverride(s.systemPromptOverride)
                  ? tr("session.sysPromptActive")
                  : tr("session.sysPrompt"),
                icon: <IconRobot size={16} />,
                onClick: () => openSessionSysPrompt(s),
              },
              {
                id: "session-max-turns",
                label:
                  normalizeMaxAgentTurns(s.maxAgentTurns) != null
                    ? tr("session.maxTurnsCount", {
                        n: String(normalizeMaxAgentTurns(s.maxAgentTurns)),
                      })
                    : tr("session.maxTurns"),
                icon: <IconListNumbers size={16} />,
                onClick: () => openSessionMaxTurns(s),
              },
              {
                id: "session-plugin-add",
                label:
                  (s.pluginDirs?.length ?? 0) > 0
                    ? tr("session.pluginDirsAddCount", {
                        n: String(s.pluginDirs!.length),
                      })
                    : tr("session.pluginDirsAdd"),
                icon: <IconPuzzle size={16} />,
                onClick: () => {
                  void addSessionPluginDir(s);
                },
              },
              ...((s.pluginDirs?.length ?? 0) > 0
                ? [
                    {
                      id: "session-plugin-clear",
                      label: tr("session.pluginDirsClear"),
                      icon: <IconPuzzle size={16} />,
                      onClick: () => {
                        void clearSessionPluginDirs(s);
                      },
                    } satisfies ContextMenuItem,
                  ]
                : []),
            ];

            const conversationChildren: ContextMenuItem[] = [
              {
                id: "rewind",
                label: tr("session.rewind"),
                icon: <IconRewind size={16} />,
                disabled: !isOpen || !canRewindSession,
                onClick: () => {
                  void openRewindTimeline(s.id);
                },
              },
              {
                id: "collapse-all-activity",
                label: tr("session.collapseAllActivity"),
                icon: <IconArrowsMinimize size={16} />,
                disabled: !isOpen,
                onClick: () => {
                  dispatchCollapseAllActivity();
                },
              },
              {
                id: "transcript-filter",
                label:
                  transcriptFilter === "conversation"
                    ? tr("session.transcriptFilter.showTools")
                    : tr("session.transcriptFilter.hideTools"),
                icon: <IconChat size={16} />,
                disabled: !isOpen,
                onClick: () => {
                  toggleTranscriptFilter();
                },
              },
              {
                id: "plan-history",
                label: tr("plan.history"),
                icon: <IconPlan size={16} />,
                onClick: () => {
                  setShowPlanHistory(true);
                },
              },
            ];

            const copyChildren: ContextMenuItem[] = [
              {
                id: "copy-md",
                label: tr("session.copyMd"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void copyConversationMarkdown({
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "copy-id",
                label: tr("session.copyId"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void copySessionId(s);
                },
              },
              ...(wtBadge
                ? [
                    {
                      id: "wt-copy-path",
                      label: tr("session.worktreeCopyPath"),
                      icon: <IconCopy size={16} />,
                      onClick: () => {
                        void (async () => {
                          try {
                            await navigator.clipboard.writeText(wtBadge.path);
                          } catch {
                            setLocalError(wtBadge.path);
                          }
                        })();
                      },
                    } satisfies ContextMenuItem,
                  ]
                : []),
            ];

            // Soft-empty honesty for the live session only (other sessions load on demand).
            const liveExportable =
              s.id === session.sessionId
                ? messages.map((m) => ({
                    role: m.role,
                    content: m.content,
                    thought: m.thought,
                    createdAt: m.createdAt,
                    marker: m.marker,
                  }))
                : null;
            const liveJournalEmptyMd =
              liveExportable != null
                ? isSessionExportJournalEmpty(liveExportable, {
                    format: "markdown",
                  })
                : null;
            const liveJournalEmptyJson =
              liveExportable != null
                ? isSessionExportJournalEmpty(liveExportable, {
                    format: "json",
                  })
                : null;
            const liveJournalEmptyPlain =
              liveExportable != null
                ? isSessionExportJournalEmpty(liveExportable, {
                    format: "plain",
                  })
                : null;
            const liveJournalEmptyHtml =
              liveExportable != null
                ? isSessionExportJournalEmpty(liveExportable, {
                    format: "html",
                  })
                : null;
            const menuAgentLinked = (() => {
              if (s.id === session.sessionId) {
                const live = (session.agentSessionId || "").trim();
                if (live) return live;
              }
              return (s.agentSessionId || "").trim() || null;
            })();
            const pathSuffix = (
              format: "markdown" | "plain" | "json" | "html",
              empty: boolean | null,
            ) => {
              const path = resolveSessionExportPath({
                format,
                mode: "download",
                hasAgentSession: menuAgentLinked,
                cliHostAvailable: api.isTauri(),
              });
              const keys = sessionExportMenuSuffixKeys({
                journalEmpty: empty,
                path,
              });
              return joinSessionExportMenuSuffix(
                keys.map((k) => tr(k as Parameters<typeof tr>[0])),
              );
            };
            // Clearer format labels: short name + extension + path badges.
            const formatMenuLabel = (
              format: "markdown" | "plain" | "json" | "html",
              empty: boolean | null,
            ) => {
              const name = tr(
                sessionExportFormatNameKey(format) as Parameters<typeof tr>[0],
              );
              const ext =
                format === "markdown"
                  ? ".md"
                  : format === "plain"
                    ? ".txt"
                    : format === "json"
                      ? ".json"
                      : ".html";
              return `${name} (${ext})${pathSuffix(format, empty)}`;
            };

            const exportChildren: ContextMenuItem[] = [
              {
                id: "export-image",
                label: tr("session.exportImage"),
                icon: <IconExportImage size={16} />,
                onClick: () => {
                  openExportSessionImage({
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-md",
                label: formatMenuLabel("markdown", liveJournalEmptyMd),
                icon: <IconCopy size={16} />,
                disabled: liveJournalEmptyMd === true,
                onClick: () => {
                  if (liveJournalEmptyMd === true) {
                    showToast(tr("session.exportEmpty"));
                    return;
                  }
                  openExportSessionMd({
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-plain",
                label: formatMenuLabel("plain", liveJournalEmptyPlain),
                icon: <IconCopy size={16} />,
                disabled: liveJournalEmptyPlain === true,
                onClick: () => {
                  void exportSessionPlain({
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-json",
                label: formatMenuLabel("json", liveJournalEmptyJson),
                icon: <IconCopy size={16} />,
                disabled: liveJournalEmptyJson === true,
                onClick: () => {
                  void exportSessionJson({
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-html",
                label: formatMenuLabel("html", liveJournalEmptyHtml),
                icon: <IconCopy size={16} />,
                disabled: liveJournalEmptyHtml === true,
                onClick: () => {
                  void exportSessionHtml({
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-stream-json",
                label: tr("session.exportStreamJson"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void exportSessionStreamNdjson("streaming-json", {
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-stream-messages-json",
                label: tr("session.exportStreamMessagesJson"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void exportSessionStreamNdjson("streaming-messages-json", {
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-trace-local",
                label: tr("session.exportTraceLocal"),
                icon: <IconArchive size={16} />,
                onClick: () => {
                  void exportSessionTrace(s.id, { localOnly: true });
                },
              },
              {
                id: "export-trace-upload",
                label: tr("session.exportTraceUpload"),
                icon: <IconArchive size={16} />,
                onClick: () => {
                  confirmExportSessionTraceUpload(s.id);
                },
              },
              {
                id: "export-bundle",
                label: tr("session.exportBundle"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void exportSessionDiagnostic(s.id);
                },
              },
              {
                id: "traces",
                label: tr("session.traces"),
                icon: <IconFolder size={16} />,
                onClick: () => {
                  setShowTraces(true);
                },
              },
            ];

            const worktreeChildren: ContextMenuItem[] = wtBadge
              ? [
                  {
                    id: "wt-reveal",
                    label: tr("session.worktreeReveal"),
                    icon: <IconExternalLink size={16} />,
                    onClick: () => {
                      void (async () => {
                        try {
                          await api.fsOpenPath(wtBadge.path);
                        } catch (e) {
                          showToast(String(e), 4000);
                        }
                      })();
                    },
                  },
                  {
                    id: "wt-copy-path-sub",
                    label: tr("session.worktreeCopyPath"),
                    icon: <IconCopy size={16} />,
                    onClick: () => {
                      void (async () => {
                        try {
                          await navigator.clipboard.writeText(wtBadge.path);
                        } catch {
                          setLocalError(wtBadge.path);
                        }
                      })();
                    },
                  },
                  {
                    id: "wt-ship",
                    label: tr("composer.worktreeShip"),
                    icon: <IconUpload size={16} />,
                    onClick: () => {
                      openShipFlow();
                    },
                  },
                  {
                    id: "wt-remove",
                    label: tr("composer.worktreeRemove"),
                    icon: <IconTrash size={16} />,
                    danger: true,
                    onClick: () => {
                      const fromList =
                        gitWorktrees.find((w) =>
                          pathsEqual(w.path, wtBadge.path),
                        ) ?? null;
                      const wt: api.GitWorktreeEntry = fromList ?? {
                        path: wtBadge.path,
                        branch: wtBadge.branch,
                        detached: !wtBadge.branch,
                        isMain: false,
                        locked: false,
                        prunable: false,
                      };
                      if (!canRemoveWorktree(wt) && fromList?.isMain) {
                        showToast(tr("composer.worktreeRemoveFailed"), 3500);
                        return;
                      }
                      confirmRemoveWorktree({ ...wt, isMain: false });
                    },
                  },
                ]
              : [];

            const resumeRestoreItem = (() => {
              const proj = s.projectId
                ? projects.find((x) => x.id === s.projectId) ?? null
                : null;
              const path = proj?.path?.trim() || "";
              const gitKnown =
                activeProject &&
                path &&
                pathsEqual(activeProject.path, path)
                  ? gitWorktreesAvailable
                  : null;
              if (
                !canOfferResumeWithCodeRestore(path, {
                  gitAvailable: gitKnown,
                })
              ) {
                return null;
              }
              return {
                id: "resume-restore",
                label: tr("session.resumeRestore"),
                icon: <IconGitBranch size={16} />,
                disabled:
                  resumeRestoreBusy ||
                  forkBusy ||
                  busyIds.has(s.id) ||
                  (isOpen && !canRewindSession),
                onClick: () => confirmResumeWithCodeRestore(s),
              } satisfies ContextMenuItem;
            })();

            items = [
              {
                id: "attach-chat",
                label: tr("chat.selectionAddToInput"),
                icon: <IconChat size={16} />,
                disabled: s.id === session.sessionId,
                onClick: () => {
                  applyAttachedChat(s.id, s.title, s.updatedAt);
                },
              },
              ...(sessionSelectMode
                ? []
                : [
                    {
                      // Primary discovery path for bulk archive/delete: the
                      // group header icon alone was too easy to miss.
                      id: "select",
                      label: tr("sidebar.select"),
                      icon: <IconListCheck size={16} />,
                      onClick: () => enterSessionSelectMode(s.id),
                    } satisfies ContextMenuItem,
                  ]),
              {
                id: "pin",
                label: s.pinned ? tr("session.unpin") : tr("session.pin"),
                icon: s.pinned ? (
                  <IconPinOff size={16} />
                ) : (
                  <IconPin size={16} />
                ),
                onClick: () => {
                  void pinSession(s, !s.pinned);
                },
              },
              ...moveMenuItemsFor(s),
              ...(canPopOut
                ? [
                    {
                      id: "open-new-window",
                      label: tr("session.openInNewWindow"),
                      icon: <IconExternalLink size={16} />,
                      onClick: () => openSessionInNewWindow(s),
                    } satisfies ContextMenuItem,
                  ]
                : []),
              {
                id: "mute",
                label: sessionMuted
                  ? tr("session.unmute")
                  : tr("session.mute"),
                icon: sessionMuted ? (
                  <IconBell size={16} />
                ) : (
                  <IconBellOff size={16} />
                ),
                onClick: () => handleToggleSessionMute(s.id),
              },
              {
                id: sessionUnread ? "clear-unread" : "mark-unread",
                label: sessionUnread
                  ? tr("session.clearUnread")
                  : tr("session.markUnread"),
                icon: sessionUnread ? (
                  <IconCheck size={16} />
                ) : (
                  <IconCircle size={16} />
                ),
                onClick: () => {
                  if (sessionUnread) handleClearSessionUnread(s.id);
                  else handleMarkSessionUnread(s.id);
                },
              },
              ...(unreadSessionIds.size > 0
                ? [
                    {
                      id: "clear-all-unread",
                      label: tr("session.clearAllUnread"),
                      icon: <IconCheck size={16} />,
                      onClick: () => handleClearAllSessionUnread(),
                    } satisfies ContextMenuItem,
                  ]
                : []),
              {
                id: "rename",
                label: tr("session.rename"),
                icon: <IconRename size={16} />,
                onClick: () => renameSession(s),
              },
              {
                id: "session-settings",
                label: tr("session.menuSettings"),
                icon: <IconSettings size={16} />,
                children: settingsChildren,
              },
              {
                id: "fork",
                label: tr("session.fork"),
                icon: <IconFork size={16} />,
                onClick: () => confirmForkSession(s),
              },
              {
                id: "duplicate",
                label: tr("session.duplicate"),
                icon: <IconFiles size={16} />,
                disabled:
                  forkBusy ||
                  busyIds.has(s.id) ||
                  (isOpen && !canRewindSession),
                onClick: () => {
                  void runDuplicateSession(s);
                },
              },
              ...(resumeRestoreItem ? [resumeRestoreItem] : []),
              {
                id: "conversation",
                label: tr("session.menuConversation"),
                icon: <IconChat size={16} />,
                children: conversationChildren,
              },
              ...(worktreeChildren.length > 0
                ? [
                    {
                      id: "worktree",
                      label: tr("session.menuWorktree"),
                      icon: <IconGitBranch size={16} />,
                      children: worktreeChildren,
                    } satisfies ContextMenuItem,
                  ]
                : []),
              {
                id: "copy",
                label: tr("session.menuCopy"),
                icon: <IconCopy size={16} />,
                children: copyChildren,
              },
              {
                id: "export",
                label: tr("session.menuExport"),
                icon: <IconExportImage size={16} />,
                children: exportChildren,
              },
              {
                id: "archive",
                label: s.archived
                  ? tr("sidebar.unarchive")
                  : tr("sidebar.archive"),
                icon: <IconArchive size={16} />,
                onClick: () => {
                  void archiveSession(s, !s.archived);
                },
              },
              {
                id: "delete",
                label: tr("session.delete"),
                icon: <IconTrash size={16} />,
                danger: true,
                onClick: () => deleteSessionConfirm(s),
              },
            ];
          }
        }
  return items;
}
