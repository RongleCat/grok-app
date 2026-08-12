/**
 * Codex-style right Side Workbench shell.
 * Visual shell reuses ResourceViewer `.rp` / `.rp-chrome` styles — function
 * layer only; does not invent a second design system.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "@/i18n";
import type { PlanReviewState } from "@/lib/planBody";
import { shouldOpenPlanSideTab } from "@/lib/planModePro";
import type { SessionFileChange } from "@/lib/sessionChanges";
import {
  activeSideTab,
  applySideStripClose,
  closeAllSideTabs,
  closeOtherSideTabs,
  closeSideTab,
  closeSideTabsToLeft,
  closeSideTabsToRight,
  emptySideWorkbenchState,
  isCloseSideTabChord,
  openSideTab,
  openSideTabFromPicker,
  setActiveSideTab,
  setTreeVisible,
  toggleSideExpanded,
  type SidePickerKind,
  type SideWorkbenchState,
} from "@/lib/sideWorkbench";
import { isShortcutRecordingActive } from "@/lib/shortcutRemap";
import * as api from "@/lib/api";
import type { ResourceOpenTarget } from "@/components/ResourceViewer";
import type { SkillInfo } from "@/lib/slashCatalog";
import type { SkillsPickerSkill } from "@/lib/skillsTaskPicker";
import { FilesWorkspace } from "./FilesWorkspace";
import { PlanTab, type PlanTabChrome } from "./PlanTab";
import { ReviewTab } from "./ReviewTab";
import { SkillsTab } from "./SkillsTab";
import { SidePicker } from "./SidePicker";
import { SideTabBar } from "./SideTabBar";
import { SideTabBody } from "./SideTabBody";

export type SideWorkbenchProps = {
  locale: Locale | string;
  projectPath?: string | null;
  projectName?: string | null;
  isGitProject?: boolean;
  state?: SideWorkbenchState;
  onStateChange?: (next: SideWorkbenchState) => void;
  onCloseSide: () => void;
  onExpandedChange?: (expanded: boolean) => void;
  /** Bottom-docked compressed composer over expanded side content. */
  dockComposer?: boolean;
  onToggleDockComposer?: () => void;
  paneActive?: boolean;
  sessionChanges?: SessionFileChange[];
  plan?: PlanReviewState | null;
  planFocusKey?: number | null;
  /** PLAN-MODE-PRO empty-state context for Plan tab. */
  planChrome?: PlanTabChrome | null;
  onApprovePlan?: () => void;
  onRequestPlanChanges?: (note?: string) => void;
  onDismissPlan?: () => void;
  onOpenPlanHistory?: () => void;
  openRequest?: ResourceOpenTarget | null;
  onOpenRequestConsumed?: () => void;
  autoOpenPlanTab?: boolean;
  /** Host skills catalog for Find skills side tab. */
  skillInfos?: readonly SkillInfo[];
  skillsLoading?: boolean;
  skillsLoadError?: string | null;
  onSelectSkill?: (skill: SkillsPickerSkill) => void;
};

export function SideWorkbench({
  locale,
  projectPath = null,
  projectName = null,
  isGitProject = false,
  state: controlled,
  onStateChange,
  onCloseSide,
  onExpandedChange,
  dockComposer = false,
  onToggleDockComposer,
  paneActive = true,
  sessionChanges = [],
  plan = null,
  planFocusKey = null,
  planChrome = null,
  onApprovePlan,
  onRequestPlanChanges,
  onDismissPlan,
  onOpenPlanHistory,
  openRequest = null,
  onOpenRequestConsumed,
  autoOpenPlanTab = true,
  skillInfos = [],
  skillsLoading = false,
  skillsLoadError = null,
  onSelectSkill,
}: SideWorkbenchProps) {
  const [internal, setInternal] = useState(emptySideWorkbenchState);
  const state = controlled ?? internal;
  const lastPlanFocusKey = useRef<number | null>(null);

  const setState = useCallback(
    (next: SideWorkbenchState) => {
      if (onStateChange) onStateChange(next);
      else setInternal(next);
    },
    [onStateChange],
  );

  /**
   * After close mutations: if the strip is empty, collapse the right aside
   * (same as the chrome “hide side” control) so users are not left on the
   * empty picker full-height panel.
   */
  const applyCloseState = useCallback(
    (next: SideWorkbenchState) => {
      setState(next);
      if (next.tabs.length === 0) {
        onCloseSide();
      }
    },
    [setState, onCloseSide],
  );

  /**
   * Browser / non-Tauri preview: ⌘W closes the active side tab first
   * (same pure target as the desktop menu path). Empty strip is a no-op
   * here — there is no host window close in web preview.
   * Desktop: File → Close (⌘W) is owned by the native app menu and routed
   * via `app://close-tab-or-window` (see AppWorkbench).
   */
  useEffect(() => {
    if (!paneActive || api.isTauri()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (isShortcutRecordingActive()) return;
      if (!isCloseSideTabChord(e)) return;
      const result = applySideStripClose(state);
      if (result.closeWindow || result.needsConfirm) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      applyCloseState(result.state);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [paneActive, state, applyCloseState]);

  const active = useMemo(() => activeSideTab(state), [state]);
  const hasFileTabs = state.tabs.some((t) => t.kind === "file");
  const activeFilePath =
    active?.kind === "file" ? (active.path ?? null) : null;

  const pick = useCallback(
    (kind: SidePickerKind) => {
      const next = openSideTabFromPicker(state, kind, { isGitProject });
      if ("created" in next) {
        // Keep treeVisible as-is — file tree is user-toggled only.
        setState(next);
      }
    },
    [state, isGitProject, setState],
  );

  const onTreeFileOpen = useCallback(
    (path: string, name: string) => {
      setState(openSideTab(state, "file", { path, name }));
    },
    [state, setState],
  );

  const onToggleExpand = useCallback(() => {
    const next = toggleSideExpanded(state);
    setState(next);
    onExpandedChange?.(next.expanded);
  }, [state, setState, onExpandedChange]);

  // Process-only plan tab: live plan auto-open, or planFocusKey bump
  // (open-in-resources / review gate) even before a draft is visible.
  useEffect(() => {
    const { open, nextLastFocusKey } = shouldOpenPlanSideTab({
      autoOpenEnabled: autoOpenPlanTab,
      planVisible: !!plan?.visible,
      focusKey: planFocusKey,
      lastFocusKey: lastPlanFocusKey.current,
    });
    lastPlanFocusKey.current = nextLastFocusKey;
    if (!open) return;
    setState(openSideTab(state, "plan", { name: "side.tab.plan" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.visible, planFocusKey, autoOpenPlanTab]);

  // Context open → ensure matching SideTab exists for file requests.
  // Do not force the file tree open; user toggles it from chrome.
  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.type === "file" && openRequest.path) {
      setState(
        openSideTab(state, "file", {
          path: openRequest.path,
          name: openRequest.title,
        }),
      );
    } else if (openRequest.type === "url" && openRequest.url) {
      setState(
        openSideTab(state, "browser", {
          url: openRequest.url,
          title: openRequest.title,
          name: openRequest.title,
        }),
      );
    } else if (openRequest.type === "changes" && isGitProject) {
      setState(openSideTab(state, "review"));
    }
    onOpenRequestConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  return (
    <div
      className={"rp sw" + (state.expanded ? " sw--expanded" : "")}
      data-testid="side-workbench"
      data-expanded={state.expanded ? "true" : "false"}
    >
      <SideTabBar
        locale={locale}
        tabs={state.tabs}
        activeId={state.activeId}
        isGitProject={isGitProject}
        projectPath={projectPath}
        expanded={state.expanded}
        dockComposer={dockComposer}
        onActivate={(id) => setState(setActiveSideTab(state, id))}
        onCloseTab={(id) => applyCloseState(closeSideTab(state, id))}
        onCloseOtherTabs={(id) => setState(closeOtherSideTabs(state, id))}
        onCloseAllTabs={() => applyCloseState(closeAllSideTabs(state))}
        onCloseTabsToLeft={(id) => setState(closeSideTabsToLeft(state, id))}
        onCloseTabsToRight={(id) => setState(closeSideTabsToRight(state, id))}
        onPickNew={pick}
        onToggleExpand={onToggleExpand}
        onToggleDockComposer={onToggleDockComposer}
        onToggleSide={onCloseSide}
      />

      <div className="sw__content">
        {state.tabs.length === 0 || !active ? (
          <div className="rp__empty-state sw__empty" data-testid="side-empty">
            <SidePicker
              locale={locale}
              isGitProject={isGitProject}
              onPick={pick}
            />
          </div>
        ) : (
          <>
            {hasFileTabs ? (
              <div
                className="sw__files-host"
                hidden={active.kind !== "file"}
                aria-hidden={active.kind !== "file"}
              >
                <FilesWorkspace
                  locale={locale}
                  projectPath={projectPath}
                  projectName={projectName}
                  treeVisible={state.treeVisible}
                  onTreeVisibleChange={(v) =>
                    setState(setTreeVisible(state, v))
                  }
                  activePath={activeFilePath}
                  onFileOpen={onTreeFileOpen}
                  paneActive={paneActive && active.kind === "file"}
                />
              </div>
            ) : null}

            {active.kind === "review" ? (
              <ReviewTab
                locale={locale}
                projectPath={projectPath}
                sessionChanges={sessionChanges}
                isGitProject={isGitProject}
                onOpenFile={onTreeFileOpen}
              />
            ) : null}

            {active.kind === "plan" ? (
              <PlanTab
                locale={locale}
                plan={plan}
                planFocusKey={planFocusKey}
                planChrome={planChrome}
                onApprovePlan={onApprovePlan}
                onRequestPlanChanges={onRequestPlanChanges}
                onDismissPlan={onDismissPlan}
                onOpenPlanHistory={onOpenPlanHistory}
              />
            ) : null}

            {active.kind === "skills" ? (
              <SkillsTab
                locale={locale}
                skills={skillInfos}
                loading={skillsLoading}
                hostError={skillsLoadError}
                onSelectSkill={(skill) => onSelectSkill?.(skill)}
              />
            ) : null}

            {/* Keep browser/terminal instances mounted so PTY/xterm sessions
                survive tab switches (VS Code-style). */}
            {state.tabs
              .filter((t) => t.kind === "browser" || t.kind === "terminal")
              .map((tab) => {
                const isActive = active.id === tab.id;
                return (
                  <div
                    key={tab.id}
                    className="sw__persist-host"
                    hidden={!isActive}
                    aria-hidden={!isActive}
                    data-side-tab-id={tab.id}
                    data-side-kind={tab.kind}
                  >
                    <SideTabBody
                      locale={locale}
                      tab={tab}
                      projectPath={projectPath}
                      active={paneActive && isActive}
                    />
                  </div>
                );
              })}
          </>
        )}
      </div>
    </div>
  );
}

export function openSideWorkbenchFile(
  state: SideWorkbenchState,
  path: string,
  name?: string,
): SideWorkbenchState {
  return openSideTab(state, "file", { path, name });
}

export function openSideWorkbenchBrowser(
  state: SideWorkbenchState,
  url: string,
  title?: string,
): SideWorkbenchState {
  return openSideTab(state, "browser", { url, title, name: title });
}

export function openSideWorkbenchReview(
  state: SideWorkbenchState,
): SideWorkbenchState {
  return openSideTab(state, "review");
}

export function openSideWorkbenchSkills(
  state: SideWorkbenchState,
): SideWorkbenchState {
  return openSideTab(state, "skills");
}
