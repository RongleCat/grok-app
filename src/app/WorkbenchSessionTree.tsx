/**
 * Sidebar session tree: projects, orphans, multi-select bar.
 * Catalog paint lives here. Open/new-chat and UserMenu stay with the host.
 */
import type { CSSProperties, Dispatch, MouseEvent, ReactNode, SetStateAction } from "react";
import { SidebarProjectsMoreMenu } from "@/components/SidebarProjectsMoreMenu";
import { activeSpaceLabel } from "@/lib/projectSpaces";
import { OverlayScroll } from "@/components/OverlayScroll";
import { VirtualList } from "@/components/VirtualList";
import { SpaceSwitcher } from "@/components/SpaceSwitcher";
import { SidebarTreeReveal } from "@/components/SidebarTreeReveal";
import {
  SidebarSessionRow,
  type SidebarSessionRowLabels,
  type SidebarSessionWorktreeBadgeProp,
} from "@/components/SidebarSessionRow";
import { Tip } from "@/components/ui/tooltip";
import {
  IconArrowsVerticalCollapse,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconFolder,
  IconHome,
  IconListCheck,
  IconMore,
  IconPin,
  IconNewChat as IconSquarePen,
} from "@/components/icons";
import { createT } from "@/i18n";
import type { Locale } from "@/i18n";
import type { Project, SessionRow } from "@/lib/app/sidebarModels";
import { projectDisplayName } from "@/lib/app/sidebarModels";
import type { ContextMenuState } from "@/lib/app/appDialogTypes";
import { areAllIdsSelected } from "@/lib/sessionSelect";
import { sortSessionsForSidebar } from "@/lib/sidebarDateGroups";
import {
  hideSshProjectInLocalTree,
  isProjectFolderMissing,
} from "@/lib/projectPath";
import { useSshWatch } from "@/providers/SshWatchProvider";
import { resolveProjectColorCss } from "@/lib/projectColor";
import { notePreview } from "@/lib/sessionNotes";
import { SESSION_DROP_ORPHAN } from "@/lib/sessionMoveProject";
import { isMirrorClient } from "@/lib/mirrorTransport";
import type { SidebarProjectReorderApi } from "@/hooks/useSidebarProjectReorder";
import type { ProjectSpacesState } from "@/lib/projectSpaces";
import { SshRemoteSessionRail } from "@/components/SshRemoteSessionRail";

type TFn = ReturnType<typeof createT>;

export type WorkbenchSessionTreeProps = {
  tr: TFn;
  locale: Locale;
  projects: Project[];
  visibleProjects: Project[];
  sessions: SessionRow[];
  projectsOpen: boolean;
  setProjectsOpen: Dispatch<SetStateAction<boolean>>;
  historyOpen: boolean;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  expandedProjects: Record<string, boolean>;
  setExpandedProjects: Dispatch<SetStateAction<Record<string, boolean>>>;
  projectSpaces: {
    state: ProjectSpacesState;
    switchTo: (id: string) => void;
  };
  promptCreateSpace: () => void;
  promptRenameSpace: (id: string) => void;
  confirmDeleteSpace: (id: string) => void;
  sessionSelectMode: boolean;
  selectedSessionIds: ReadonlySet<string>;
  selectableSessionCount: number;
  enterSessionSelectMode: (preselectId?: string) => void;
  exitSessionSelectMode: () => void;
  toggleSessionSelected: (id: string, opts?: { shiftKey?: boolean }) => void;
  toggleSessionsSelected: (ids: readonly string[]) => void;
  unreadSessionIds: ReadonlySet<string>;
  handleClearAllSessionUnread: () => void;
  setCtxMenu: Dispatch<SetStateAction<ContextMenuState>>;
  addProject: (autoTrust?: boolean) => void | Promise<void>;
  projectReorder: SidebarProjectReorderApi;
  openProjectMenu: (e: MouseEvent, proj: Project) => void;
  newChat: (project?: Project | null) => void | Promise<void>;
  onNewRemoteConversation?: (alias: string, cwd: string) => void;
  onImportedSessionsChanged?: () => void;
  relocateProject: (proj: Project) => void | Promise<void>;
  trustProject: (proj?: Project | null) => void | Promise<void>;
  viewingSessionId: string | null;
  busyIds: ReadonlySet<string>;
  planPendingSessionIds: ReadonlySet<string>;
  mutedSessionIds: ReadonlySet<string>;
  sessionNotesMap: Record<string, string | undefined>;
  sidebarSessionLabels: SidebarSessionRowLabels;
  sidebarShowRelativeTime: boolean;
  sidebarRowMetrics: { rowHeight: number; gap: number };
  buildSidebarWorktreeBadge: (
    s: SessionRow,
  ) => SidebarSessionWorktreeBadgeProp | null;
  onSidebarSessionOpen: (s: { id: string }) => void;
  onSidebarSessionContextMenu: (e: MouseEvent, s: { id: string }) => void;
  onSidebarSessionPin: (s: { id: string; pinned?: boolean }) => void;
  onSidebarSessionArchive: (s: { id: string; archived?: boolean }) => void;
  onSidebarSessionMenu: (e: MouseEvent, s: { id: string }) => void;
  onSidebarSessionRename: (s: { id: string }, title: string) => void;
  confirmBulkSetArchived: (archived: boolean) => void;
  deleteSessionsConfirm: (rows: SessionRow[]) => void;
  sidebarCliImportCta?: ReactNode;
};

export function WorkbenchSessionTree(props: WorkbenchSessionTreeProps) {
  const {
    tr,
    locale,
    projects,
    visibleProjects,
    sessions,
    projectsOpen,
    setProjectsOpen,
    historyOpen,
    setHistoryOpen,
    expandedProjects,
    setExpandedProjects,
    projectSpaces,
    promptCreateSpace,
    promptRenameSpace,
    confirmDeleteSpace,
    sessionSelectMode,
    selectedSessionIds,
    selectableSessionCount,
    enterSessionSelectMode,
    exitSessionSelectMode,
    toggleSessionSelected,
    toggleSessionsSelected,
    unreadSessionIds,
    handleClearAllSessionUnread,
    setCtxMenu,
    addProject,
    projectReorder,
    openProjectMenu,
    newChat,
    onNewRemoteConversation,
    onImportedSessionsChanged,
    relocateProject,
    trustProject,
    viewingSessionId,
    busyIds,
    planPendingSessionIds,
    mutedSessionIds,
    sessionNotesMap,
    sidebarSessionLabels,
    sidebarShowRelativeTime,
    sidebarRowMetrics,
    buildSidebarWorktreeBadge,
    onSidebarSessionOpen,
    onSidebarSessionContextMenu,
    onSidebarSessionPin,
    onSidebarSessionArchive,
    onSidebarSessionMenu,
    onSidebarSessionRename,
    confirmBulkSetArchived,
    sidebarCliImportCta,
    deleteSessionsConfirm,
  } = props;

  const { watchAliases } = useSshWatch();
  const treeProjects = visibleProjects.filter(
    (p) => !hideSshProjectInLocalTree(p, watchAliases),
  );
  const sessionsForProject = (projectId: string) =>
    sessions.filter((s) => s.projectId === projectId && !s.archived);
  const orphanSessions = sessions.filter(
    (s) =>
      (!s.projectId || !projects.some((p) => p.id === s.projectId)) &&
      !s.archived,
  );
  const orphanSessionIds = orphanSessions.map((s) => s.id);
  const orphanAllSelected = areAllIdsSelected(
    selectedSessionIds,
    orphanSessionIds,
  );
  const session = { sessionId: viewingSessionId };

  return (
    <>
          <OverlayScroll
            className="sidebar__scroll"
            viewportClassName="sidebar__scroll-inner"
            syncTreeReveal
          >
            {/* L1 — Projects section */}
            <div className="tree-l1">
              <button
                type="button"
                className="tree-l1__head"
                onClick={() => setProjectsOpen((v) => !v)}
                aria-expanded={projectsOpen}
                aria-label={tr("sidebar.projects")}
              >
                <span className="tree-l1__chevron" aria-hidden>
                  {projectsOpen ? (
                    <IconChevronDown size={14} />
                  ) : (
                    <IconChevronRight size={14} />
                  )}
                </span>
                <span className="tree-l1__label">
                  {activeSpaceLabel(projectSpaces.state, {
                    all: tr("sidebar.spaces.all"),
                    default: tr("sidebar.spaces.default"),
                    projects: tr("sidebar.projects"),
                  })}
                </span>
              </button>
              <div className="tree-l1__actions">
                <SpaceSwitcher
                  state={projectSpaces.state}
                  projectIds={projects.map((p) => p.id)}
                  labels={{
                    projects: tr("sidebar.projects"),
                    all: tr("sidebar.spaces.all"),
                    default: tr("sidebar.spaces.default"),
                    switch: tr("sidebar.spaces.switch"),
                    new: tr("sidebar.spaces.new"),
                    rename: tr("sidebar.spaces.rename"),
                    delete: tr("sidebar.spaces.delete"),
                  }}
                  onSelect={(id) => projectSpaces.switchTo(id)}
                  onNew={() => promptCreateSpace()}
                  onRename={(id) => promptRenameSpace(id)}
                  onDelete={(id) => confirmDeleteSpace(id)}
                />
                {sessionSelectMode ? (
                  <Tip label={tr("common.cancel")}>
                    <button
                      type="button"
                      className="tree-l1__action"
                      aria-label={tr("common.cancel")}
                      onClick={(e) => {
                        e.stopPropagation();
                        exitSessionSelectMode();
                      }}
                    >
                      <IconClose size={15} />
                    </button>
                  </Tip>
                ) : (
                  <>
                    {projects.length > 0 ? (
                      <Tip label={tr("sidebar.collapseAllProjects")}>
                        <button
                          type="button"
                          className="tree-l1__action"
                          aria-label={tr("sidebar.collapseAllProjects")}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedProjects((prev) => {
                              const next = { ...prev };
                              for (const p of projects) {
                                next[p.id] = false;
                              }
                              return next;
                            });
                          }}
                        >
                          <IconArrowsVerticalCollapse size={15} />
                        </button>
                      </Tip>
                    ) : null}
                    <SidebarProjectsMoreMenu
                      label={tr("sidebar.more")}
                      items={[
                        ...(selectableSessionCount > 0
                          ? [
                              {
                                id: "select" as const,
                                label: tr("sidebar.select"),
                                onClick: () => enterSessionSelectMode(),
                              },
                            ]
                          : []),
                        ...(unreadSessionIds.size > 0
                          ? [
                              {
                                id: "clearUnread" as const,
                                label: tr("session.clearAllUnread"),
                                onClick: () => handleClearAllSessionUnread(),
                              },
                            ]
                          : []),
                        ...(selectableSessionCount > 0
                          ? [
                              {
                                id: "archiveOlder" as const,
                                label: tr("sidebar.archiveOlder"),
                                onClick: (anchor: { x: number; y: number }) =>
                                  setCtxMenu({
                                    kind: "archive-older",
                                    x: anchor.x,
                                    y: anchor.y,
                                  }),
                              },
                            ]
                          : []),
                        ...(!isMirrorClient()
                          ? [
                              {
                                id: "addProject" as const,
                                label: tr("sidebar.addProject"),
                                onClick: () => void addProject(false),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </>
                )}
              </div>
            </div>

            <SshRemoteSessionRail
              t={tr}
              locale={locale}
              showRelativeTime={sidebarShowRelativeTime}
              onOpenSession={(id) => onSidebarSessionOpen({ id })}
              onNewConversation={onNewRemoteConversation}
              onImportedSessionsChanged={onImportedSessionsChanged}
            />
            <SidebarTreeReveal open={projectsOpen} className="tree-reveal--projects">
            {projects.length === 0 && (
              <div className="sidebar-empty">
                {tr("sidebar.noProjects")}
                {sidebarCliImportCta}
              </div>
            )}

            {projects.length > 0 &&
              visibleProjects.length === 0 && (
              <div className="sidebar-empty sidebar-empty--space">
                {tr("sidebar.spaces.empty")}
                <div className="sidebar-empty__hint">
                  {tr("sidebar.spaces.emptyHint")}
                </div>
              </div>
            )}

            {treeProjects.map((proj) => {
                const open = expandedProjects[proj.id] !== false;
                const projSessions = sessionsForProject(proj.id);
                const projSessionIds = projSessions.map((s) => s.id);
                const projAllSelected = areAllIdsSelected(
                  selectedSessionIds,
                  projSessionIds,
                );
                return (
                  <div key={proj.id} className="tree-project">
                    {/* L2 — project folder: expand/collapse; drag row to reorder */}
                    <div
                      className={
                        "tree-l2" +
                        (isProjectFolderMissing(proj)
                          ? " tree-l2--path-missing"
                          : "") +
                        (sessionSelectMode ? " tree-l2--select-mode" : "") +
                        (projectReorder.enabled ? " tree-l2--reorderable" : "")
                      }
                      data-project-reorder-id={proj.id}
                      data-session-drop={proj.id}
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      {...(projectReorder.enabled
                        ? projectReorder.bindRow(proj.id)
                        : {})}
                      onClick={() => {
                        // After a completed drag, ignore the trailing click.
                        if (projectReorder.suppressNextClick()) return;
                        setExpandedProjects((e) => ({
                          ...e,
                          [proj.id]: !open,
                        }));
                      }}
                      onContextMenu={(e) => openProjectMenu(e, proj)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setExpandedProjects((ex) => ({
                            ...ex,
                            [proj.id]: !open,
                          }));
                        }
                      }}
                    >
                      <span className="tree-l2__icon">
                        <IconFolder size={15} />
                      </span>
                      {resolveProjectColorCss(proj.color) ? (
                        <span
                          className="tree-l2__color-dot"
                          style={
                            {
                              "--project-color": resolveProjectColorCss(
                                proj.color,
                              ),
                            } as CSSProperties
                          }
                          aria-hidden
                        />
                      ) : null}
                      <Tip
                        label={
                          isProjectFolderMissing(proj)
                            ? tr("project.pathMissing", { name: proj.name })
                            : proj.path
                        }
                      >
                        <span className="tree-l2__name">
                          {proj.pinned ? (
                            <IconPin size={12} className="tree-l2__pin" />
                          ) : null}
                          {projectDisplayName(proj, tr)}
                        </span>
                      </Tip>
                      {isProjectFolderMissing(proj) ? (
                        <span className="project-row__badge project-row__badge--path-missing">
                          {tr("sidebar.pathMissing")}
                        </span>
                      ) : !proj.trusted ? (
                        <span className="project-row__badge">
                          {tr("sidebar.untrusted")}
                        </span>
                      ) : null}
                      <span
                        className={
                          "tree-l2__actions" +
                          (sessionSelectMode
                            ? " tree-l2__actions--select-mode"
                            : "")
                        }
                      >
                        {sessionSelectMode ? (
                          projSessionIds.length > 0 ? (
                            <button
                              type="button"
                              className={
                                "tree-l2__select-all" +
                                (projAllSelected
                                  ? " tree-l2__select-all--on"
                                  : "")
                              }
                              aria-label={
                                projAllSelected
                                  ? tr("sidebar.deselectAllInGroup")
                                  : tr("sidebar.selectAllInGroup")
                              }
                              aria-pressed={projAllSelected}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSessionsSelected(projSessionIds);
                              }}
                            >
                              <span
                                className={
                                  "tree-l3__check" +
                                  (projAllSelected ? " is-on" : "")
                                }
                                aria-hidden
                              >
                                {projAllSelected ? (
                                  <IconCheck size={11} stroke={2.4} />
                                ) : null}
                              </span>
                              <span className="tree-l2__select-all-label">
                                {projAllSelected
                                  ? tr("sidebar.deselectAllInGroup")
                                  : tr("sidebar.selectAllInGroup")}
                              </span>
                            </button>
                          ) : null
                        ) : (
                          <>
                            <Tip label={tr("sidebar.newConversation")}>
                              <button
                                type="button"
                                className="tree-icon-btn"
                                disabled={
                                  !proj.trusted ||
                                  isProjectFolderMissing(proj)
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void newChat(proj);
                                }}
                              >
                                <IconSquarePen size={14} />
                              </button>
                            </Tip>
                            <Tip label={tr("sidebar.menu")}>
                              <button
                                type="button"
                                className="tree-icon-btn"
                                onClick={(e) => openProjectMenu(e, proj)}
                              >
                                <IconMore size={14} />
                              </button>
                            </Tip>
                          </>
                        )}
                      </span>
                    </div>

                    <SidebarTreeReveal open={open}>
                      <div className="tree-l3-list-wrap">
                        {isProjectFolderMissing(proj) && (
                          <button
                            type="button"
                            className="tree-l3 tree-l3--hint"
                            onClick={(e) => {
                              e.stopPropagation();
                              void relocateProject(proj);
                            }}
                          >
                            {tr("sidebar.relocateProject")}
                          </button>
                        )}
                        {!proj.trusted && !isProjectFolderMissing(proj) && (
                          <button
                            type="button"
                            className="tree-l3 tree-l3--hint"
                            onClick={(e) => {
                              e.stopPropagation();
                              void trustProject(proj);
                            }}
                          >
                            {tr("sidebar.trustProject")}
                          </button>
                        )}
                        {projSessions.length > 0
                          ? (() => {
                              const sortedSessions =
                                sortSessionsForSidebar(projSessions);
                              return (
                                <VirtualList
                                  className="tree-l3-list"
                                  items={sortedSessions}
                                  getKey={(s) => s.id}
                                  rowHeight={sidebarRowMetrics.rowHeight}
                                  gap={sidebarRowMetrics.gap}
                                  scrollToKey={
                                    session.sessionId &&
                                    sortedSessions.some(
                                      (x) => x.id === session.sessionId,
                                    )
                                      ? session.sessionId
                                      : null
                                  }
                                  renderItem={(s) => {
                                    const working = busyIds.has(s.id);
                                    const checked =
                                      selectedSessionIds.has(s.id);
                                    const unread = unreadSessionIds.has(s.id);
                                    const planPending =
                                      planPendingSessionIds.has(s.id);
                                    const noteRaw =
                                      sessionNotesMap[s.id]?.trim() || "";
                                    return (
                                      <SidebarSessionRow
                                        session={s}
                                        variant="project"
                                        active={session.sessionId === s.id}
                                        working={working}
                                        unread={unread}
                                        planPending={planPending}
                                        checked={checked}
                                        selectMode={sessionSelectMode}
                                        muted={mutedSessionIds.has(s.id)}
                                        noteTitle={
                                          noteRaw
                                            ? notePreview(noteRaw) ||
                                              sidebarSessionLabels.noteAria
                                            : null
                                        }
                                        worktreeBadge={buildSidebarWorktreeBadge(
                                          s,
                                        )}
                                        labels={sidebarSessionLabels}
                                        locale={locale}
                                        showRelativeTime={
                                          sidebarShowRelativeTime
                                        }
                                        onOpen={onSidebarSessionOpen}
                                        onContextMenu={
                                          onSidebarSessionContextMenu
                                        }
                                        onToggleSelect={toggleSessionSelected}
                                        onPin={onSidebarSessionPin}
                                        onArchive={onSidebarSessionArchive}
                                        onMenu={onSidebarSessionMenu}
                                        onRename={onSidebarSessionRename}
                                      />
                                    );
                                  }}
                                />
                              );
                            })()
                          : null}
                        {projSessions.length === 0 && proj.trusted && (
                          <div className="sidebar-empty" style={{ padding: "4px 10px" }}>
                            {tr("sidebar.noChats")}
                          </div>
                        )}
                      </div>
                    </SidebarTreeReveal>
                  </div>
                );
              })}
            </SidebarTreeReveal>

            {/* Orphans / history — block wrap so the reveal is not a flex item */}
            <div className="tree-orphan">
            <div className="tree-l1" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="tree-l1__head"
                data-session-drop={SESSION_DROP_ORPHAN}
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen((v) => !v)}
              >
                <span className="tree-l1__chevron" aria-hidden>
                  {historyOpen ? (
                    <IconChevronDown size={14} />
                  ) : (
                    <IconChevronRight size={14} />
                  )}
                </span>
                <span className="tree-l1__icon" aria-hidden>
                  <IconHome size={14} />
                </span>
                <span className="tree-l1__label">
                  {tr("sidebar.otherSessions")}
                </span>
              </button>
              {!sessionSelectMode && orphanSessionIds.length > 0 ? (
                <div className="tree-l1__actions">
                  <Tip label={tr("sidebar.select")}>
                    <button
                      type="button"
                      className="tree-l1__action"
                      aria-label={tr("sidebar.select")}
                      onClick={(e) => {
                        e.stopPropagation();
                        enterSessionSelectMode();
                      }}
                    >
                      <IconListCheck size={15} />
                    </button>
                  </Tip>
                </div>
              ) : null}
              {sessionSelectMode && orphanSessionIds.length > 0 ? (
                <div className="tree-l1__actions tree-l1__actions--select-mode">
                  <button
                    type="button"
                    className={
                      "tree-l1__select-all" +
                      (orphanAllSelected ? " tree-l1__select-all--on" : "")
                    }
                    aria-label={
                      orphanAllSelected
                        ? tr("sidebar.deselectAllInGroup")
                        : tr("sidebar.selectAllInGroup")
                    }
                    aria-pressed={orphanAllSelected}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSessionsSelected(orphanSessionIds);
                    }}
                  >
                    <span
                      className={
                        "tree-l3__check" +
                        (orphanAllSelected ? " is-on" : "")
                      }
                      aria-hidden
                    >
                      {orphanAllSelected ? (
                        <IconCheck size={11} stroke={2.4} />
                      ) : null}
                    </span>
                    <span className="tree-l1__select-all-label">
                      {orphanAllSelected
                        ? tr("sidebar.deselectAllInGroup")
                        : tr("sidebar.selectAllInGroup")}
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
            {orphanSessions.length > 0
              ? (() => {
                  const sortedOrphans = sortSessionsForSidebar(orphanSessions);
                  return (
                    <SidebarTreeReveal open={historyOpen}>
                      <div className="tree-l3-list-wrap">
                      <VirtualList
                        className="tree-orphan-list"
                        items={sortedOrphans}
                        getKey={(s) => s.id}
                        rowHeight={sidebarRowMetrics.rowHeight}
                        gap={sidebarRowMetrics.gap}
                        scrollToKey={
                          session.sessionId &&
                          sortedOrphans.some(
                            (x) => x.id === session.sessionId,
                          )
                            ? session.sessionId
                            : null
                        }
                        renderItem={(s) => {
                          const working = busyIds.has(s.id);
                          const checked = selectedSessionIds.has(s.id);
                          const unread = unreadSessionIds.has(s.id);
                          const planPending =
                            planPendingSessionIds.has(s.id);
                          const noteRaw =
                            sessionNotesMap[s.id]?.trim() || "";
                          return (
                            <SidebarSessionRow
                              session={s}
                              variant="orphan"
                              active={session.sessionId === s.id}
                              working={working}
                              unread={unread}
                              planPending={planPending}
                              checked={checked}
                              selectMode={sessionSelectMode}
                              muted={mutedSessionIds.has(s.id)}
                              noteTitle={
                                noteRaw
                                  ? notePreview(noteRaw) ||
                                    sidebarSessionLabels.noteAria
                                  : null
                              }
                              worktreeBadge={buildSidebarWorktreeBadge(s)}
                              labels={sidebarSessionLabels}
                              locale={locale}
                              showRelativeTime={sidebarShowRelativeTime}
                              onOpen={onSidebarSessionOpen}
                              onContextMenu={onSidebarSessionContextMenu}
                              onToggleSelect={toggleSessionSelected}
                              onPin={onSidebarSessionPin}
                              onArchive={onSidebarSessionArchive}
                              onMenu={onSidebarSessionMenu}
                              onRename={onSidebarSessionRename}
                            />
                          );
                        }}
                      />
                      </div>
                    </SidebarTreeReveal>
                  );
                })()
              : null}
              {historyOpen && projects.length > 0 ? sidebarCliImportCta : null}
            </div>
          </OverlayScroll>

          {sessionSelectMode ? (
            <div className="sidebar-select-bar" role="toolbar">
              <span className="sidebar-select-bar__count">
                {tr("sidebar.selectedCount", {
                  n: selectedSessionIds.size,
                })}
              </span>
              <div className="sidebar-select-bar__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={exitSessionSelectMode}
                >
                  {tr("common.cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={selectedSessionIds.size === 0}
                  onClick={(e) => {
                    setCtxMenu({
                      kind: "session-move",
                      ids: [...selectedSessionIds],
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                >
                  {tr("sidebar.moveSelected", {
                    n: selectedSessionIds.size,
                  })}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={selectedSessionIds.size === 0}
                  onClick={() => confirmBulkSetArchived(true)}
                >
                  {tr("sidebar.archiveSelected", {
                    n: selectedSessionIds.size,
                  })}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm btn--danger"
                  disabled={selectedSessionIds.size === 0}
                  onClick={() => {
                    const rows = sessions.filter((s) =>
                      selectedSessionIds.has(s.id),
                    );
                    deleteSessionsConfirm(rows);
                  }}
                >
                  {tr("sidebar.deleteSelected", {
                    n: selectedSessionIds.size,
                  })}
                </button>
              </div>
            </div>
          ) : null}

    </>
  );
}
