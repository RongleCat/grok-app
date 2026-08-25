/**
 * Center column chrome: drop overlay, toast, title row, top actions.
 * Chat / kanban / automations body stay with the host as children.
 */
import type { Dispatch, MouseEvent, ReactNode, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { Tip } from "@/components/ui/tooltip";
import { OpenLocationButton } from "@/components/OpenLocationButton";
import { EnvInfoButton } from "@/components/side-workbench/EnvInfoButton";
import { BottomTerminalToggle } from "@/components/bottom-terminal/BottomTerminalToggle";
import { PaneToggleButton } from "@/components/PaneToggleButton";
import {
  IconAttach,
  IconClock,
  IconList,
  IconMenu,
  IconMore,
  IconScheduled,
  IconUser,
} from "@/components/icons";
import { createT, type Locale, type MessageKey } from "@/i18n";
import {
  projectDisplayName,
  type Project,
  type SessionRow,
} from "@/lib/app/sidebarModels";
import { revealInOsLabel, type AppPlatform } from "@/lib/appPlatform";
import { parseScheduledUserContent } from "@/lib/automations";
import type { ConnPill } from "@/lib/connStatus";
import { isMirrorClient, mirrorToken } from "@/lib/mirrorTransport";
import { deriveMirrorClientLinkStatus } from "@/lib/mirrorStatus";
import { applySideContextOpen } from "@/lib/sideContextOpen";
import { openSideTab, type SideWorkbenchState } from "@/lib/sideWorkbench";
import type { SessionChangesSummary } from "@/lib/sessionChanges";
import type { GitDirtySummary } from "@/lib/workspaceGit";

type TFn = ReturnType<typeof createT>;

type TitlebarMax = {
  onDoubleClick: (e: { target: EventTarget | null; button?: number }) => void;
  onMouseDown: (e: {
    target: EventTarget | null;
    button: number;
    detail: number;
    preventDefault: () => void;
  }) => void;
};

type ChatTitleSession = {
  sessionId: string | null;
  title?: string | null;
};

export type WorkbenchMainProps = {
  tr: TFn;
  locale: Locale;
  children: ReactNode;
  layout: { sidebarCollapsed: boolean; asideCollapsed: boolean };
  phoneLayout: boolean;
  dragZone: "sidebar" | "main" | null;
  sidePaneCoversMain: boolean;
  toast: string | null;
  dragRegion: "false" | "deep";
  titlebarMax: TitlebarMax;
  mainPane: "chat" | "automations" | "kanban";
  sessions: SessionRow[];
  session: ChatTitleSession;
  activeProject: Project | null;
  messages: ReadonlyArray<{ role: string; content?: string }>;
  openPhoneDrawer: () => void;
  closePhoneDrawer: () => void;
  openSidebarPane: () => void;
  sidebarToggleUnread: boolean;
  openSessionMenu: (e: MouseEvent, s: SessionRow) => void;
  onOpenPhoneAccount: () => void;
  bottomTerminalOpen: boolean;
  onToggleBottomTerminal: () => void;
  mirrorLinkOk: boolean;
  mirrorHostLabel: string | null;
  connPill: ConnPill;
  connPillCanRetry: boolean;
  onRetryAgentConnect: () => void;
  defaultOpenTarget: string;
  persistOpenTarget: (target: string) => void;
  onOpenLocationError: (error: string) => void;
  platform: AppPlatform;
  effectiveProjectPath: string | null;
  sideIsGitProject: boolean;
  sessionChangesSummary: SessionChangesSummary | null;
  gitDirtySummary: GitDirtySummary | null;
  sideWorkbench: SideWorkbenchState;
  setSideWorkbench: Dispatch<SetStateAction<SideWorkbenchState>>;
  openAsidePane: () => void;
  showToast: (text: string, ms?: number) => void;
};

export function WorkbenchMain(props: WorkbenchMainProps) {
  const {
    tr,
    locale,
    children,
    layout,
    phoneLayout,
    dragZone,
    sidePaneCoversMain,
    toast,
    dragRegion,
    titlebarMax,
    mainPane,
    sessions,
    session,
    activeProject,
    messages,
    openPhoneDrawer,
    closePhoneDrawer,
    openSidebarPane,
    sidebarToggleUnread,
    openSessionMenu,
    onOpenPhoneAccount,
    bottomTerminalOpen,
    onToggleBottomTerminal,
    mirrorLinkOk,
    mirrorHostLabel,
    connPill,
    connPillCanRetry,
    onRetryAgentConnect,
    defaultOpenTarget,
    persistOpenTarget,
    onOpenLocationError,
    platform,
    effectiveProjectPath,
    sideIsGitProject,
    sessionChangesSummary,
    gitDirtySummary,
    sideWorkbench,
    setSideWorkbench,
    openAsidePane,
    showToast,
  } = props;

  const cur = sessions.find((s) => s.id === session.sessionId);
  const title =
    cur?.title || session.title || activeProject?.name || tr("session.new");
  const isScheduledSession =
    !!cur?.scheduled ||
    messages.some(
      (m) =>
        m.role === "user" && !!parseScheduledUserContent(m.content || ""),
    );

  return (
    <>
      {!phoneLayout ? (
        <PaneToggleButton
          side="left"
          open={!layout.sidebarCollapsed}
          unread={sidebarToggleUnread}
          label={tr(
            layout.sidebarCollapsed ? "main.leftPaneShow" : "main.leftPaneHide",
          )}
          unreadLabel={tr("main.paneUnread")}
          controlsId="workbench-sidebar"
          onToggle={
            layout.sidebarCollapsed ? openSidebarPane : closePhoneDrawer
          }
        />
      ) : null}
      <main
      className={
        "main" +
        (layout.sidebarCollapsed ? " main--sidebar-hidden" : "") +
        (dragZone === "main" ? " is-drop-target" : "") +
        (dragZone === "sidebar" ? " is-drop-idle" : "") +
        (sidePaneCoversMain ? " main--side-covered" : "")
      }
      aria-hidden={sidePaneCoversMain ? true : undefined}
      // Keep chat DOM mounted under the side overlay; block interaction.
      inert={sidePaneCoversMain ? true : undefined}
    >
      {dragZone === "main" && (
        <div className="drop-overlay drop-overlay--attach" aria-hidden>
          <div className="drop-overlay__card">
            <span className="drop-overlay__icon">
              <IconAttach size={22} />
            </span>
            <strong>{tr("composer.dropAttachTitle")}</strong>
            <span>{tr("composer.dropAttachHint")}</span>
          </div>
        </div>
      )}

      {toast &&
        (typeof document !== "undefined"
          ? createPortal(
              <div className="app-toast" role="status">
                {toast}
              </div>,
              document.body,
            )
          : (
              <div className="app-toast" role="status">
                {toast}
              </div>
            ))}
      <div
        className={"main__top" + (phoneLayout ? " main__top--phone" : "")}
        data-tauri-drag-region={dragRegion}
        {...titlebarMax}
      >
        <div className="main__title-row" data-tauri-drag-region={dragRegion}>
          {phoneLayout ? (
            <PaneToggleButton
              side="left"
              pinned={false}
              open={!layout.sidebarCollapsed}
              unread={sidebarToggleUnread}
              label={tr("phone.menu")}
              unreadLabel={tr("main.paneUnread")}
              icon={<IconMenu size={20} />}
              className="main__phone-menu"
              controlsId="workbench-sidebar"
              onToggle={
                layout.sidebarCollapsed ? openPhoneDrawer : closePhoneDrawer
              }
            />
          ) : null}
          {mainPane === "automations" ? (
            <>
              {!phoneLayout ? (
                <span className="main__title-icon">
                  <IconScheduled size={16} />
                </span>
              ) : null}
              <h1 className="main__title" data-tauri-drag-region={dragRegion}>
                {tr("automations.title")}
              </h1>
            </>
          ) : mainPane === "kanban" ? (
            <>
              {!phoneLayout ? (
                <span className="main__title-icon">
                  <IconList size={16} />
                </span>
              ) : null}
              <h1 className="main__title" data-tauri-drag-region={dragRegion}>
                {tr("kanban.title")}
              </h1>
            </>
          ) : (
            <>
              {isScheduledSession && !phoneLayout ? (
                <span
                  className="main__title-icon"
                  title={tr("automations.msgTag")}
                  aria-label={tr("automations.msgTag")}
                >
                  <IconClock size={16} />
                </span>
              ) : null}
              {phoneLayout ? (
                <h1 className="main__title" data-tauri-drag-region={dragRegion}>
                  {title}
                </h1>
              ) : (
                <Tip label={title}>
                  <h1 className="main__title" data-tauri-drag-region={dragRegion}>
                    {title}
                  </h1>
                </Tip>
              )}
              {cur && !phoneLayout && (
                <Tip label={tr("session.menu")}>
                  <button
                    type="button"
                    className="chrome-btn main__title-menu"
                    onClick={(e) => openSessionMenu(e, cur)}
                  >
                    <IconMore size={16} />
                  </button>
                </Tip>
              )}
            </>
          )}
        </div>
        <div className="main__top-actions">
          {phoneLayout ? (
            <>
              <button
                type="button"
                className="chrome-btn main__phone-account"
                aria-label={tr("phone.account")}
                onClick={onOpenPhoneAccount}
              >
                <IconUser size={20} />
              </button>
              <BottomTerminalToggle
                locale={locale}
                open={bottomTerminalOpen}
                onToggle={onToggleBottomTerminal}
              />
            </>
          ) : (
            <>
              {isMirrorClient() &&
                (() => {
                  const link = deriveMirrorClientLinkStatus({
                    wsConnected: mirrorLinkOk,
                    hasToken: !!mirrorToken(),
                  });
                  const linkLabel = tr(link.labelKey as MessageKey);
                  return (
                    <span
                      className={"status-pill status-pill--" + link.tone}
                      role="status"
                      title={
                        mirrorHostLabel
                          ? `${mirrorHostLabel} · ${linkLabel}`
                          : linkLabel
                      }
                    >
                      <span className="status-pill__dot" aria-hidden />
                      {mirrorLinkOk
                        ? mirrorHostLabel || linkLabel
                        : linkLabel}
                    </span>
                  );
                })()}
              {/* Retry progress is not shown: mid-connect network retries are
                  normal. Final failures surface via session://turn_error. */}
              {mainPane === "chat" &&
                (connPillCanRetry ? (
                  <button
                    type="button"
                    className={`status-pill status-pill--${connPill.tone} status-pill--action`}
                    title={tr("conn.retryHint")}
                    onClick={onRetryAgentConnect}
                  >
                    <span className="status-pill__dot" aria-hidden />
                    {tr(connPill.labelKey as MessageKey)}
                  </button>
                ) : (
                  <span
                    className={`status-pill status-pill--${connPill.tone}`}
                    role="status"
                    title={tr(connPill.labelKey as MessageKey)}
                  >
                    <span className="status-pill__dot" aria-hidden />
                    {tr(connPill.labelKey as MessageKey)}
                  </span>
                ))}
              {mainPane === "chat" &&
                activeProject &&
                !isMirrorClient() && (
                  <OpenLocationButton
                    path={activeProject.path}
                    target={defaultOpenTarget || "finder"}
                    onTargetChange={persistOpenTarget}
                    onOpenError={onOpenLocationError}
                    platform={platform}
                    labels={{
                      openLocation: tr("main.openLocation"),
                      openHint: tr("main.openLocationHint"),
                      openMenu: tr("main.openLocationMenu"),
                      finder: revealInOsLabel(tr, platform),
                      systemDefault: tr("main.openSystemDefault"),
                      copyPath: tr("attach.copyPath"),
                    }}
                  />
                )}
              {mainPane === "chat" ? (
                <EnvInfoButton
                  locale={locale}
                  asideOpen={!layout.asideCollapsed}
                  projectPath={effectiveProjectPath}
                  projectName={
                    activeProject
                      ? projectDisplayName(activeProject, tr)
                      : null
                  }
                  isGitProject={sideIsGitProject}
                  changeSummary={
                    sessionChangesSummary?.mode === "diff"
                      ? {
                          add: sessionChangesSummary.addedLines ?? 0,
                          del: sessionChangesSummary.removedLines ?? 0,
                          fileCount: sessionChangesSummary.fileCount,
                        }
                      : sessionChangesSummary
                        ? {
                            add: 0,
                            del: 0,
                            fileCount: sessionChangesSummary.fileCount,
                          }
                        : gitDirtySummary
                          ? {
                              add: 0,
                              del: 0,
                              fileCount: gitDirtySummary.count,
                            }
                          : null
                  }
                  onJump={(jump) => {
                    if (jump.type === "review") {
                      const result = applySideContextOpen(
                        sideWorkbench,
                        { type: "changes" },
                        { isGitProject: sideIsGitProject },
                      );
                      if (result.noticeKey) {
                        showToast(tr(result.noticeKey), 2400);
                      }
                      if (!result.needAsideOpen) return;
                      setSideWorkbench(result.state);
                      openAsidePane();
                      return;
                    }
                    if (jump.type === "local") {
                      const next = openSideTab(sideWorkbench, "file", {
                        path: effectiveProjectPath || undefined,
                        name: activeProject
                          ? projectDisplayName(activeProject, tr)
                          : undefined,
                      });
                      setSideWorkbench({ ...next, treeVisible: true });
                      openAsidePane();
                    }
                  }}
                />
              ) : null}
              <BottomTerminalToggle
                locale={locale}
                open={bottomTerminalOpen}
                onToggle={onToggleBottomTerminal}
              />
            </>
          )}
        </div>
      </div>
      {children}
      </main>
    </>
  );
}
