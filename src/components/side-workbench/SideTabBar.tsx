/**
 * Shared side workbench top strip — reuses ResourceViewer `.rp-chrome` styles.
 * [ tabs scroll… ][ + ]········[ dock? ][ expand ][ side ]
 * dock = bottom input toggle, only when expanded.
 * Tab chips support a mature right-click menu (close / close others / …).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { createT, type Locale } from "@/i18n";
import {
  IconClose,
  IconFileDiff,
  IconFloatComposer,
  IconFolder,
  IconPanelRight,
  IconPlan,
  IconPlus,
  IconSideExpand,
  IconSkills,
  IconTerminal,
  IconWorld,
} from "@/components/icons";
import { FileKindMark } from "@/components/resource-viewer/FileKindMark";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { Tip } from "@/components/ui/tooltip";
import { useFloatingMenu } from "@/lib/floatingMenu";
import {
  isSideTabMiddleClick,
  resolveSideTabLabel,
  sideTabCopyPath,
  sideTabNeighborFlags,
  type SideTab,
  type SidePickerKind,
} from "@/lib/sideWorkbench";
import { SidePicker } from "./SidePicker";
import { titlebarMaximizeHandlers } from "@/components/WindowControls";

export type SideTabBarProps = {
  locale: Locale | string;
  tabs: SideTab[];
  activeId: string | null;
  isGitProject: boolean;
  /** Project cwd — used to resolve absolute paths for「复制路径」. */
  projectPath?: string | null;
  expanded: boolean;
  /** Bottom-docked compressed composer (only when expanded). */
  dockComposer?: boolean;
  onActivate: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseOtherTabs: (id: string) => void;
  onCloseAllTabs: () => void;
  onCloseTabsToLeft: (id: string) => void;
  onCloseTabsToRight: (id: string) => void;
  onPickNew: (kind: SidePickerKind) => void;
  onToggleExpand: () => void;
  onToggleDockComposer?: () => void;
  onToggleSide: () => void;
};

function tabIcon(tab: SideTab): ReactNode {
  switch (tab.kind) {
    case "file":
      return (
        <FileKindMark
          name={tab.path || tab.name || "file"}
          isDir={false}
        />
      );
    case "browser":
      return <IconWorld size={14} />;
    case "terminal":
      return <IconTerminal size={14} />;
    case "skills":
      return <IconSkills size={14} />;
    case "review":
      return <IconFileDiff size={14} />;
    case "plan":
      return <IconPlan size={14} />;
    default:
      return <IconFolder size={14} />;
  }
}

export function SideTabBar({
  locale,
  tabs,
  activeId,
  isGitProject,
  projectPath = null,
  expanded,
  dockComposer = false,
  onActivate,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onPickNew,
  onToggleExpand,
  onToggleDockComposer,
  onToggleSide,
}: SideTabBarProps) {
  const tr = useMemo(() => createT(locale as Locale), [locale]);
  const titlebarMax = titlebarMaximizeHandlers();
  const [plusOpen, setPlusOpen] = useState(false);
  const plusRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fadeL, setFadeL] = useState(false);
  const [fadeR, setFadeR] = useState(false);
  const [tabMenu, setTabMenu] = useState<{
    x: number;
    y: number;
    tab: SideTab;
  } | null>(null);

  const { pos, style } = useFloatingMenu({
    open: plusOpen,
    triggerRef: plusRef,
    panelRef,
    onClose: () => setPlusOpen(false),
    placement: "down",
    // Shrink-wrap to widest row (icon + label + shortcut + padding).
    fitContent: true,
    estHeight: 220,
    gap: 6,
  });

  const updateFades = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setFadeL(false);
      setFadeR(false);
      return;
    }
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setFadeL(scrollLeft > 2);
    setFadeR(scrollLeft + clientWidth < scrollWidth - 2);
  }, []);

  useEffect(() => {
    updateFades();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateFades, { passive: true });
    const ro = new ResizeObserver(updateFades);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateFades);
      ro.disconnect();
    };
  }, [tabs, updateFades]);

  const openTabMenu = useCallback(
    (e: ReactMouseEvent, tab: SideTab) => {
      e.preventDefault();
      e.stopPropagation();
      setPlusOpen(false);
      // Focus the target tab so close actions match user intent.
      onActivate(tab.id);
      setTabMenu({ x: e.clientX, y: e.clientY, tab });
    },
    [onActivate],
  );

  const copyTabPath = useCallback(
    async (tab: SideTab) => {
      // Always absolute filesystem path (never basename / relative alone).
      const text = sideTabCopyPath(tab, projectPath);
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        } catch {
          /* ignore */
        }
      }
    },
    [projectPath],
  );

  const tabMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!tabMenu) return [];
    const tab = tabMenu.tab;
    // Prefer live tabs list (may have changed while menu open).
    const live = tabs.find((t) => t.id === tab.id) ?? tab;
    const flags = sideTabNeighborFlags(tabs, live.id);
    // File preview only — absolute path when resolvable.
    const absPath = sideTabCopyPath(live, projectPath);

    const items: ContextMenuItem[] = [
      {
        id: "close",
        label: tr("side.tab.ctxClose"),
        onClick: () => onCloseTab(live.id),
      },
      {
        id: "close-others",
        label: tr("side.tab.ctxCloseOthers"),
        disabled: !flags.hasOthers,
        onClick: () => onCloseOtherTabs(live.id),
      },
      {
        id: "close-right",
        label: tr("side.tab.ctxCloseRight"),
        disabled: !flags.hasRight,
        onClick: () => onCloseTabsToRight(live.id),
      },
      {
        id: "close-left",
        label: tr("side.tab.ctxCloseLeft"),
        disabled: !flags.hasLeft,
        onClick: () => onCloseTabsToLeft(live.id),
      },
      {
        id: "close-all",
        label: tr("side.tab.ctxCloseAll"),
        danger: true,
        disabled: tabs.length === 0,
        onClick: () => onCloseAllTabs(),
      },
    ];
    if (absPath) {
      items.push(
        { id: "sep-copy", separator: true },
        {
          id: "copy-path",
          label: tr("side.tab.copyPath"),
          onClick: () => {
            void copyTabPath(live);
          },
        },
      );
    }
    return items;
  }, [
    tabMenu,
    tabs,
    projectPath,
    tr,
    onCloseTab,
    onCloseOtherTabs,
    onCloseTabsToLeft,
    onCloseTabsToRight,
    onCloseAllTabs,
    copyTabPath,
  ]);

  return (
    <div
      className="rp-chrome sw-chrome"
      data-testid="side-tab-bar"
      {...titlebarMax}
    >
      {/* Cluster: tabs + + stick together on the left; expand/side stay flush right */}
      <div
        className={
          "sw-tabs-cluster" +
          (fadeL ? " sw-tabs--fade-l" : "") +
          (fadeR ? " sw-tabs--fade-r" : "")
        }
      >
        <div
          ref={scrollRef}
          className="rp-tabs__scroll sw-tabs__scroll"
          role="tablist"
          aria-label={tr("side.tabsAria")}
        >
          {tabs.length === 0 ? (
            <div className="rp-tabs__placeholder">
              <span className="rp-tabs__hint">{tr("side.emptyTabsHint")}</span>
            </div>
          ) : (
            tabs.map((tab) => {
              const active = tab.id === activeId;
              const label = resolveSideTabLabel(tab, (k) => tr(k as never));
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={label}
                  className={
                    "rp-tab" + (active ? " is-active" : " is-inactive")
                  }
                  data-testid={`side-tab-${tab.kind}`}
                  onClick={() => onActivate(tab.id)}
                  onAuxClick={(e) => {
                    // Browser-style middle-click closes the *clicked* tab
                    // (not only the active one). Same path as the × button.
                    if (!isSideTabMiddleClick(e)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  onMouseDown={(e) => {
                    // Prevent middle-click auto-scroll / paste chrome.
                    if (isSideTabMiddleClick(e)) e.preventDefault();
                  }}
                  onContextMenu={(e) => openTabMenu(e, tab)}
                >
                  {tabIcon(tab)}
                  {active ? (
                    <>
                      <span className="rp-tab__name">{label}</span>
                      <span
                        className="rp-tab__x"
                        role="button"
                        tabIndex={0}
                        title={tr("side.tabClose")}
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloseTab(tab.id);
                        }}
                        onAuxClick={(e) => {
                          if (!isSideTabMiddleClick(e)) return;
                          e.preventDefault();
                          e.stopPropagation();
                          onCloseTab(tab.id);
                        }}
                        onContextMenu={(e) => {
                          // Let the tab chip own the menu (not only the ×).
                          e.preventDefault();
                          e.stopPropagation();
                          openTabMenu(e, tab);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            onCloseTab(tab.id);
                          }
                        }}
                      >
                        <IconClose size={12} />
                      </span>
                    </>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
        <Tip label={tr("side.plus")}>
          <button
            ref={plusRef}
            type="button"
            className={"chrome-btn sw-plus" + (plusOpen ? " is-on" : "")}
            aria-label={tr("side.plus")}
            aria-expanded={plusOpen}
            data-testid="side-plus"
            onClick={() => setPlusOpen((v) => !v)}
          >
            <IconPlus size={16} />
          </button>
        </Tip>
      </div>

      {/* Empty strip between tabs/+ and right actions — window drag (titlebar). */}
      <div
        className="sw-chrome__drag"
        data-tauri-drag-region
        aria-hidden
        {...titlebarMax}
      />

      <div className="rp-chrome__actions">
        {/* Dock input: only when side is expanded (icon toggle, default off). */}
        {expanded ? (
          <Tip
            label={
              dockComposer
                ? tr("side.dockComposerOn")
                : tr("side.dockComposer")
            }
          >
            <button
              type="button"
              className={
                "chrome-btn main__pane-toggle" +
                (dockComposer ? " is-on" : "")
              }
              aria-label={
                dockComposer
                  ? tr("side.dockComposerOn")
                  : tr("side.dockComposer")
              }
              aria-pressed={dockComposer}
              data-testid="side-dock-composer"
              onClick={() => onToggleDockComposer?.()}
            >
              <IconFloatComposer size={16} />
            </button>
          </Tip>
        ) : null}
        <Tip label={tr("side.expand")}>
          <button
            type="button"
            className={
              "chrome-btn main__pane-toggle" + (expanded ? " is-on" : "")
            }
            aria-label={tr("side.expand")}
            aria-pressed={expanded}
            data-testid="side-expand"
            onClick={onToggleExpand}
          >
            <IconSideExpand size={16} />
          </button>
        </Tip>
        <Tip label={tr("side.toggle")}>
          <button
            type="button"
            className="chrome-btn main__pane-toggle is-on"
            aria-label={tr("side.toggle")}
            aria-pressed
            data-testid="side-toggle-in-bar"
            onClick={onToggleSide}
          >
            <IconPanelRight size={16} />
          </button>
        </Tip>
      </div>

      {plusOpen && pos
        ? createPortal(
            <div
              ref={panelRef}
              className="menu-panel sw-plus-menu"
              style={style}
              data-testid="side-plus-menu"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <SidePicker
                locale={locale}
                isGitProject={isGitProject}
                compact
                onPick={(kind) => {
                  setPlusOpen(false);
                  onPickNew(kind);
                }}
              />
            </div>,
            document.body,
          )
        : null}

      <ContextMenu
        open={!!tabMenu}
        x={tabMenu?.x ?? 0}
        y={tabMenu?.y ?? 0}
        items={tabMenuItems}
        onClose={() => setTabMenu(null)}
        estimatedWidth={200}
        estimatedHeight={260}
        className="sw-tab-ctx-menu"
      />
    </div>
  );
}
