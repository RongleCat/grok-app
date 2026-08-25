/**
 * Right resources pane: resize handle + SideWorkbench.
 * Skill insert and plan verbs stay with the host.
 */
import { lazy, Suspense, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { createT, type Locale } from "@/i18n";
import { DEFAULT_LAYOUT } from "@/lib/layout";
import { paneSplitSizeStyle } from "@/lib/paneSplitMotion";
import type { SessionPlanState } from "@/lib/planSession";
import type { SessionFileChange } from "@/lib/sessionChanges";
import type { SkillInfo } from "@/lib/slashCatalog";
import type { SkillsPickerSkill } from "@/lib/skillsTaskPicker";
import type { SideWorkbenchState } from "@/lib/sideWorkbench";
import type { ResourceOpenTarget } from "@/components/ResourceViewer";

const SideWorkbench = lazy(async () => {
  const m = await import("@/components/side-workbench/SideWorkbench");
  return { default: m.SideWorkbench };
});

type TFn = ReturnType<typeof createT>;

export type WorkbenchResourcesAsideProps = {
  tr: TFn;
  locale: Locale;
  layout: { asideCollapsed: boolean; asideWidth: number };
  phoneLayout: boolean;
  sidePaneCoversMain: boolean;
  asideOverlay: boolean;
  resizingAside: boolean;
  asideOpenW: number;
  asidePaint: number;
  beginAsideResize: (width: number) => void;
  effectiveProjectPath: string | null;
  projectName: string;
  sideIsGitProject: boolean;
  sideWorkbench: SideWorkbenchState;
  setSideWorkbench: Dispatch<SetStateAction<SideWorkbenchState>>;
  sideDockComposer: boolean;
  onToggleSideDockComposer: () => void;
  sessionChanges: SessionFileChange[];
  plan: SessionPlanState;
  planFocusKey: number | null;
  composerMode: string;
  planEnabled: boolean;
  planUserClosed: boolean;
  planHistoryNonEmpty: boolean;
  onApprovePlan: () => void;
  onRequestPlanChanges: () => void;
  onDismissPlan: () => void;
  onOpenPlanHistory: () => void;
  resourceOpenTarget: ResourceOpenTarget | null;
  onOpenRequestConsumed: () => void;
  closeActiveSideRequest: { token: number } | null;
  onCloseActiveRequestConsumed: () => void;
  onCloseSide: () => void;
  onExpandedChange: (expanded: boolean) => void;
  skillInfos: readonly SkillInfo[];
  skillsLoading: boolean;
  skillsLoadError: string | null;
  onSelectSkill: (skill: SkillsPickerSkill) => void;
};

export function WorkbenchResourcesAside(props: WorkbenchResourcesAsideProps) {
  const {
    tr,
    locale,
    layout,
    phoneLayout,
    sidePaneCoversMain,
    asideOverlay,
    resizingAside,
    asideOpenW,
    asidePaint,
    beginAsideResize,
    effectiveProjectPath,
    projectName,
    sideIsGitProject,
    sideWorkbench,
    setSideWorkbench,
    sideDockComposer,
    onToggleSideDockComposer,
    sessionChanges,
    plan,
    planFocusKey,
    composerMode,
    planEnabled,
    planUserClosed,
    planHistoryNonEmpty,
    onApprovePlan,
    onRequestPlanChanges,
    onDismissPlan,
    onOpenPlanHistory,
    resourceOpenTarget,
    onOpenRequestConsumed,
    closeActiveSideRequest,
    onCloseActiveRequestConsumed,
    onCloseSide,
    onExpandedChange,
    skillInfos,
    skillsLoading,
    skillsLoadError,
    onSelectSkill,
  } = props;

  const asideMin = layout.asideWidth || DEFAULT_LAYOUT.asideWidth;

  return (
    <aside
      id="workbench-aside"
      className={
        (layout.asideCollapsed ? "aside aside--hidden" : "aside") +
        (resizingAside ? " is-resizing" : "") +
        (phoneLayout ? " aside--phone-overlay" : "") +
        (sidePaneCoversMain ? " aside--side-expanded" : "") +
        (asideOverlay ? " aside--overlay" : "")
      }
      aria-label={tr("a11y.resourcesPane")}
      aria-hidden={layout.asideCollapsed}
      style={
        phoneLayout || (asideOverlay && !layout.asideCollapsed)
          ? undefined
          : sidePaneCoversMain
            ? ({
                width: "calc(100% - var(--sw-sidebar-occupied, 0px))",
                minWidth: "calc(100% - var(--sw-sidebar-occupied, 0px))",
                maxWidth: "calc(100% - var(--sw-sidebar-occupied, 0px))",
                flexBasis: "calc(100% - var(--sw-sidebar-occupied, 0px))",
                ["--aside-rail-min"]: `${asideMin}px`,
              } as CSSProperties)
          : asideOverlay
            ? ({
                width: asideOpenW,
                minWidth: asideOpenW,
                maxWidth: asideOpenW,
                ["--aside-rail-min"]: `${asideOpenW}px`,
              } as CSSProperties)
            : resizingAside
              ? ({
                  ["--aside-rail-min"]: `${asideMin}px`,
                } as CSSProperties)
              : ({
                  ...paneSplitSizeStyle(asidePaint, "x", false),
                  ["--aside-rail-min"]: `${asideMin}px`,
                } as CSSProperties)
      }
    >
      {!layout.asideCollapsed && !sidePaneCoversMain && !asideOverlay && (
        <div
          className="aside-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize files pane"
          onPointerDown={(e) => {
            e.preventDefault();
            beginAsideResize(asideMin);
          }}
        />
      )}
      <div className="aside__inner">
        <Suspense fallback={null}>
          <SideWorkbench
            locale={locale}
            projectPath={effectiveProjectPath}
            projectName={projectName}
            isGitProject={sideIsGitProject}
            state={sideWorkbench}
            onStateChange={setSideWorkbench}
            dockComposer={sideDockComposer}
            onToggleDockComposer={
              phoneLayout ? undefined : onToggleSideDockComposer
            }
            paneActive={!layout.asideCollapsed}
            sessionChanges={sessionChanges}
            plan={plan}
            planFocusKey={planFocusKey}
            planChrome={{
              composerMode,
              planEnabled,
              userClosed: planUserClosed,
              hasHistory: planHistoryNonEmpty,
            }}
            onApprovePlan={onApprovePlan}
            onRequestPlanChanges={onRequestPlanChanges}
            onDismissPlan={onDismissPlan}
            onOpenPlanHistory={onOpenPlanHistory}
            openRequest={resourceOpenTarget}
            onOpenRequestConsumed={onOpenRequestConsumed}
            closeActiveRequest={closeActiveSideRequest}
            onCloseActiveRequestConsumed={onCloseActiveRequestConsumed}
            onCloseSide={onCloseSide}
            closeToggleInBar={phoneLayout}
            onExpandedChange={onExpandedChange}
            skillInfos={skillInfos}
            skillsLoading={skillsLoading}
            skillsLoadError={skillsLoadError}
            onSelectSkill={onSelectSkill}
          />
        </Suspense>
      </div>
    </aside>
  );
}
