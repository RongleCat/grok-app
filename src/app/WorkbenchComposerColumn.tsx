/**
 * Composer column: welcome mark, permission bar, context chips, portal wrap.
 * Draft/queue chrome lives in WorkbenchComposerShell.
 */
import * as api from "@/lib/api";
import { ComposerProjectMenu } from "@/components/ComposerProjectMenu";
import { ComposerWorktreeMenu } from "@/components/ComposerWorktreeMenu";
import { PermissionCountdown } from "@/components/PermissionCountdown";
import { SuperGrokMark } from "@/components/SuperGrokMark";
import { IconFileDiff, IconGitBranch } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { projectDisplayName } from "@/lib/app/sidebarModels";
import { isMirrorClient } from "@/lib/mirrorTransport";
import {
  displayPermissionPreview,
  formatPermissionSummary,
  mapPermissionButtons,
} from "@/lib/permissionOptions";
import { type CSSProperties, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { WorkbenchComposerShell } from "@/app/WorkbenchComposerShell";

export type WorkbenchComposerColumnProps = {
  [key: string]: any;
};

export function WorkbenchComposerColumn(p: WorkbenchComposerColumnProps) {
  const {
    account,
    activeProject,
    addProjectFromPicker,
    bindSessionProject,
    cliWorktrees,
    cliWorktreesAvailable,
    cliWorktreesLoading,
    cliWorktreesReason,
    composerWrapRef,
    confirmRemoveWorktree,
    customRouteActive,
    formatPermCountdown,
    gitDirtySummary,
    gitWorktrees,
    gitWorktreesAvailable,
    gitWorktreesLoading,
    gitWorktreesReason,
    openAsidePane,
    openShipFlow,
    openWorktreeCreate,
    openWorktreeGc,
    perm,
    permBarRef,
    permCountdownStartedAt,
    permissionTimeoutSec,
    phoneLayout,
    projects,
    refreshCliWorktrees,
    refreshGitWorktrees,
    resizingSidebar,
    resolvePermission,
    sessionChangesSummary,
    setResourceOpenTarget,
    showToast,
    sideDockActive,
    switchToWorktree,
    welcomeBrandKind,
    welcomeProviderBrandNode,
    welcomeSession,
    welcomeMotionEnabled,
    welcomeIntroActive,
    welcomePrompt,
    setWelcomeIntroActive,
    dockSidebarOccupied,
    mainPane,
    tr,
    session,
  } = p;
  const [permBusy, setPermBusy] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);
  const previewText = displayPermissionPreview(perm?.preview);
  useEffect(() => {
    setPermBusy(false);
    setPermError(null);
  }, [perm?.rpcId, perm?.sessionId]);
  return (() => {
            const composerNode = (
          <div
            ref={composerWrapRef}
            className={
              "composer-wrap composer-wrap--float" +
              (welcomeSession && !sideDockActive
                ? " composer-wrap--welcome"
                : "") +
              (sideDockActive ? " composer-wrap--side-dock" : "") +
              (resizingSidebar ? " is-sidebar-resizing" : "")
            }
            style={
              sideDockActive
                ? ({
                    ["--sw-sidebar-occupied"]: `${dockSidebarOccupied}px`,
                  } as CSSProperties)
                : undefined
            }
            data-side-dock={sideDockActive ? "true" : undefined}
          >
            {welcomeSession && welcomeBrandKind && !sideDockActive ? (
              <div
                className={
                  "composer-welcome-mark" +
                  (welcomeMotionEnabled && welcomeIntroActive
                    ? " is-entering"
                    : "")
                }
              >
                <div className="composer-welcome-brand">
                  {welcomeProviderBrandNode ?? (
                    <SuperGrokMark
                      kind={welcomeBrandKind}
                      title={
                        customRouteActive
                          ? "SuperGrok"
                          : account?.billing?.subscriptionTier?.trim() ||
                            (welcomeBrandKind === "heavy"
                              ? "SuperGrok Heavy"
                              : "SuperGrok")
                      }
                    />
                  )}
                </div>
                <div
                  className="composer-welcome-prompt"
                  style={
                    {
                      ["--welcome-prompt-steps"]: String(
                        Math.max(1, Array.from(String(welcomePrompt ?? "")).length),
                      ),
                    } as CSSProperties
                  }
                  onAnimationEnd={() => setWelcomeIntroActive(false)}
                >
                  {welcomePrompt}
                </div>
              </div>
            ) : null}
            {perm ? (
              <div
                ref={permBarRef}
                className="perm-bar"
                role="dialog"
                aria-modal="true"
                aria-labelledby="perm-bar-title"
                aria-describedby="perm-bar-summary"
              >
                <div className="sr-only" aria-live="assertive">
                  {tr("a11y.permissionNeeded")}
                </div>
                <div className="perm-bar__head">
                  <span className="perm-bar__badge" id="perm-bar-title">
                    {tr("perm.title")}
                  </span>
                  <span className="perm-bar__tool">
                    {perm.title || perm.toolName}
                  </span>
                  {permissionTimeoutSec > 0 ? (
                    <PermissionCountdown
                      startedAtMs={permCountdownStartedAt}
                      timeoutSec={permissionTimeoutSec}
                      format={formatPermCountdown}
                    />
                  ) : null}
                </div>
                <p className="perm-bar__summary" id="perm-bar-summary">
                  {formatPermissionSummary({
                    toolName: perm.toolName,
                    title: perm.title,
                    command: previewText,
                  })}
                </p>
                {previewText ? (
                  <pre className="perm-bar__preview">{previewText}</pre>
                ) : null}
                {permError ? (
                  <p className="perm-bar__error" role="alert">
                    {permError}
                  </p>
                ) : null}
                <div className="perm-bar__actions" role="group">
                  {mapPermissionButtons(
                    perm.options,
                    {
                      allowOnce: tr("perm.allowOnce"),
                      allowSession: tr("perm.allowSession"),
                      deny: tr("perm.deny"),
                    },
                    perm.toolName,
                  ).map((btn) => (
                    <button
                      key={btn.decision + btn.optionId}
                      type="button"
                      className={
                        "perm-bar__btn" +
                        (btn.decision === "allow_once"
                          ? " perm-bar__btn--allow"
                          : btn.decision === "deny"
                            ? " perm-bar__btn--deny"
                            : " perm-bar__btn--session")
                      }
                      disabled={permBusy}
                      title={
                        btn.decision === "allow_once"
                          ? tr("perm.hintOnce")
                          : btn.decision === "allow_session"
                            ? tr("perm.hintSession")
                            : tr("perm.hintDeny")
                      }
                      onClick={() => {
                        if (permBusy) return;
                        setPermBusy(true);
                        setPermError(null);
                        void Promise.resolve(
                          resolvePermission(perm, btn.decision, btn.optionId),
                        )
                          .catch((e: unknown) => {
                            setPermError(String(e));
                          })
                          .finally(() => setPermBusy(false));
                      }}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {(() => {
              // Desktop composer always shows the workspace chip (including
              // unbound / default workspace). Phone uses PhoneComposerToolsSheet.
              const showComposerProjectRow = !phoneLayout;
              // Env menu (chat chrome) already shows change stats — hide
              // the duplicate composer context chips to avoid two "N 变更".
              const envOwnsChangeSummary =
                mainPane === "chat" && !phoneLayout;
              const showChangesChips =
                !phoneLayout &&
                !envOwnsChangeSummary &&
                (!!sessionChangesSummary || !!gitDirtySummary);
              const showContextBar =
                showComposerProjectRow || showChangesChips;
              return (
            <div
              className={
                "composer-stack" +
                (showContextBar ? " composer-stack--with-context" : "")
              }
            >
            {/* Workspace / branch + session/workspace change chips.
                Hidden entirely when the bar would be empty. */}
            {showContextBar ? (
              <div
                className="composer__context-bar"
                aria-label={
                  showComposerProjectRow
                    ? tr("composer.pickProject")
                    : tr("changes.chipAria")
                }
              >
                {showComposerProjectRow ? (
                  <>
                <ComposerProjectMenu
                  variant="context"
                  activeProject={
                    activeProject
                      ? {
                          ...activeProject,
                          name: projectDisplayName(activeProject, tr),
                        }
                      : null
                  }
                  projects={projects.map((p: any) => ({
                    ...p,
                    name: projectDisplayName(p, tr),
                  }))}
                  labels={{
                    noProject: tr("project.general"),
                    pickProject: tr("composer.pickProject"),
                    addProject: tr("composer.addProject"),
                    pathMissing: tr("project.pathMissingShort"),
                  }}
                  disabled={
                    session.state === "streaming" ||
                    session.state === "awaiting_permission"
                  }
                    onSelect={(proj: any) => {
                    // Menu default-workspace row still passes null; bind resolves it.
                    const full = proj
                      ? projects.find((p: any) => p.id === proj.id) ?? null
                      : null;
                    void bindSessionProject(full);
                  }}
                  onAdd={() => {
                    void addProjectFromPicker({ bindSession: true });
                  }}
                />
                {activeProject && gitWorktreesAvailable === true ? (
                  <ComposerWorktreeMenu
                    variant="context"
                    activePath={activeProject.path}
                    worktrees={gitWorktrees}
                    worktreesAvailable={gitWorktreesAvailable}
                    worktreesLoading={gitWorktreesLoading}
                    worktreesReason={gitWorktreesReason}
                    cliWorktrees={cliWorktrees}
                    cliWorktreesAvailable={cliWorktreesAvailable}
                    cliWorktreesLoading={cliWorktreesLoading}
                    cliWorktreesReason={cliWorktreesReason}
                    disabled={
                      session.state === "streaming" ||
                      session.state === "awaiting_permission"
                    }
                    labels={{
                      worktrees: tr("composer.worktrees"),
                      worktreesEmpty: tr("composer.worktreesEmpty"),
                      worktreesUnavailable: tr(
                        "composer.worktreesUnavailable",
                      ),
                      worktreesLoading: tr("composer.worktreesLoading"),
                      worktreeCurrent: tr("composer.worktreeCurrent"),
                      worktreeMain: tr("composer.worktreeMain"),
                      worktreeDetached: tr("composer.worktreeDetached"),
                      worktreeTip: tr("composer.worktreeTip"),
                      worktreeNew: tr("composer.worktreeNew"),
                      worktreeNewChat: tr("composer.worktreeNewChat"),
                      worktreeGc: tr("composer.worktreeGc"),
                      worktreeShip: tr("composer.worktreeShip"),
                      worktreeShipTip: tr("composer.worktreeShipTip"),
                      worktreeRemove: tr("composer.worktreeRemove"),
                      worktreeRemoveTip: tr("composer.worktreeRemoveTip"),
                      cliWorktrees: tr("composer.cliWorktrees"),
                      cliWorktreesEmpty: tr("composer.cliWorktreesEmpty"),
                      cliWorktreesUnavailable: tr(
                        "composer.cliWorktreesUnavailable",
                      ),
                      cliWorktreesLoading: tr("composer.cliWorktreesLoading"),
                      cliWorktreeRefresh: tr("composer.cliWorktreeRefresh"),
                      cliWorktreeReveal: tr("composer.cliWorktreeReveal"),
                      cliWorktreeOpen: tr("composer.cliWorktreeOpen"),
                      cliWorktreeOpenUnavailable: tr(
                        "composer.cliWorktreeOpenUnavailable",
                      ),
                      cliWorktreeMissingPath: tr(
                        "composer.cliWorktreeMissingPath",
                      ),
                    }}
                    onSwitch={(wt) => {
                      void switchToWorktree(wt);
                    }}
                    onCreate={() => openWorktreeCreate()}
                    onCreateAndChat={() =>
                      openWorktreeCreate({ startNewChat: true })
                    }
                    onGc={openWorktreeGc}
                    onShip={openShipFlow}
                    onRemove={confirmRemoveWorktree}
                    onOpen={() => {
                      void refreshGitWorktrees();
                      void refreshCliWorktrees();
                    }}
                    onCliRefresh={() => {
                      void refreshCliWorktrees();
                    }}
                    onCliReveal={(wt) => {
                      const p = wt.path?.trim();
                      if (!p) return;
                      void api
                        .pathReveal(p)
                        .catch((e) => showToast(String(e), 3500));
                    }}
                    onCliOpen={(wt) => {
                      if (!wt.pathOk || !wt.path?.trim()) {
                        showToast(
                          tr("composer.cliWorktreeOpenUnavailable"),
                          3500,
                        );
                        return;
                      }
                      void switchToWorktree({
                        path: wt.path,
                        branch: wt.branch ?? null,
                        detached: !wt.branch || wt.branch === "HEAD",
                        isMain: false,
                        locked: false,
                        prunable: false,
                        head: wt.head ?? null,
                      });
                    }}
                  />
                ) : null}
                  </>
                ) : null}
                {showChangesChips ? (
                  <div className="composer__context-changes">
                    {sessionChangesSummary ? (
                      <Tip label={tr("changes.chipTip")}>
                        <button
                          type="button"
                          className="composer__context-item composer__context-item--changes"
                          data-testid="session-changes-chip"
                          aria-label={
                            sessionChangesSummary.mode === "diff"
                              ? `${tr("changes.chipAria")}: ${tr(
                                  "changes.chipDiff",
                                  {
                                    a: String(
                                      sessionChangesSummary.addedLines ?? 0,
                                    ),
                                    d: String(
                                      sessionChangesSummary.removedLines ?? 0,
                                    ),
                                  },
                                )}`
                              : `${tr("changes.chipAria")}: ${tr(
                                  "changes.chipFiles",
                                  {
                                    n: String(sessionChangesSummary.fileCount),
                                  },
                                )}`
                          }
                          onClick={() => {
                            openAsidePane();
                            setResourceOpenTarget({ type: "changes" });
                          }}
                        >
                          <IconFileDiff size={14} aria-hidden />
                          <span className="composer__context-label chip__label--nums">
                            {sessionChangesSummary.mode === "diff"
                              ? tr("changes.chipDiff", {
                                  a: String(
                                    sessionChangesSummary.addedLines ?? 0,
                                  ),
                                  d: String(
                                    sessionChangesSummary.removedLines ?? 0,
                                  ),
                                })
                              : tr("changes.chipFiles", {
                                  n: String(sessionChangesSummary.fileCount),
                                })}
                          </span>
                        </button>
                      </Tip>
                    ) : null}
                    {gitDirtySummary ? (
                      <Tip label={tr("changes.workspace.chipTip")}>
                        <button
                          type="button"
                          className="composer__context-item composer__context-item--git-dirty"
                          data-testid="git-dirty-chip"
                          aria-label={`${tr("changes.workspace.chipAria")}: ${tr(
                            "changes.workspace.chip",
                            { n: String(gitDirtySummary.count) },
                          )}`}
                          onClick={() => {
                            const path = activeProject?.path?.trim() || "";
                            if (
                              api.isTauri() &&
                              !isMirrorClient() &&
                              path
                            ) {
                              openAsidePane();
                              setResourceOpenTarget({ type: "changes" });
                            } else if (path) {
                              showToast(
                                tr("changes.workspace.toastPath", {
                                  path,
                                }),
                                4000,
                              );
                            }
                          }}
                        >
                          <IconGitBranch size={14} aria-hidden />
                          <span className="composer__context-label chip__label--nums">
                            {tr("changes.workspace.chip", {
                              n: String(gitDirtySummary.count),
                            })}
                          </span>
                        </button>
                      </Tip>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <WorkbenchComposerShell {...p} />
            </div>
              );
            })()}
          </div>
            );
            return sideDockActive && typeof document !== "undefined"
              ? createPortal(composerNode, document.body)
              : composerNode;
          })();
}
