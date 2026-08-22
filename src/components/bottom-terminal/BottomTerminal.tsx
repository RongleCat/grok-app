/**
 * Chat-column bottom terminal — tab strip + persist-mounted PTY hosts.
 * Closed panels keep height 0 so xterm sessions survive the toggle.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createT, type Locale } from "@/i18n";
import {
  IconChevronDown,
  IconClose,
  IconPlus,
  IconTerminal,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { TerminalTab } from "@/components/side-workbench/TerminalTab";
import { isSideTabMiddleClick } from "@/lib/sideWorkbench";
import { paneSplitSizeStyle } from "@/lib/paneSplitMotion";
import type { BottomTerminalState } from "@/lib/bottomTerminal";

export type BottomTerminalProps = {
  locale: Locale | string;
  projectPath?: string | null;
  state: BottomTerminalState;
  onAddTab: () => void;
  onCloseTab: (id: string) => void;
  onActivateTab: (id: string) => void;
  onHeightChange: (height: number, maxPx?: number) => void;
  onClosePanel: () => void;
};

export function BottomTerminal({
  locale,
  projectPath = null,
  state,
  onAddTab,
  onCloseTab,
  onActivateTab,
  onHeightChange,
  onClosePanel,
}: BottomTerminalProps) {
  const tr = useMemo(() => createT(locale as Locale), [locale]);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startH: number; max: number } | null>(
    null,
  );
  const [resizing, setResizing] = useState(false);
  const paintH = state.open ? state.height : 0;

  const onResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const main = panelRef.current?.closest(".main");
      const max = Math.floor((main?.clientHeight ?? window.innerHeight) * 0.6);
      dragRef.current = {
        startY: e.clientY,
        startH: state.height,
        max,
      };
      setResizing(true);
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
    },
    [state.height],
  );

  const onResizePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dy = drag.startY - e.clientY;
      onHeightChange(drag.startH + dy, drag.max);
    },
    [onHeightChange],
  );

  const onResizePointerUp = useCallback(() => {
    dragRef.current = null;
    setResizing(false);
  }, []);

  const many = state.tabs.length > 1;

  return (
    <div
      ref={panelRef}
      className={"bt" + (resizing ? " is-resizing" : "")}
      data-open={state.open ? "true" : "false"}
      data-testid="bottom-terminal"
      aria-hidden={!state.open}
      aria-label={tr("terminal.panelAria")}
      style={paneSplitSizeStyle(paintH, "y", resizing)}
    >
      <div
            className="bt__resize"
            role="separator"
            aria-orientation="horizontal"
            aria-label={tr("terminal.resize")}
            data-testid="bottom-terminal-resize"
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
            onPointerCancel={onResizePointerUp}
          />
          <div className="rp-chrome bt__chrome">
            <div className="rp-tabs__scroll bt__tabs" role="tablist">
              {state.tabs.map((tab, i) => {
                const active = tab.id === state.activeId;
                const label = many
                  ? `${tr("side.tab.terminal")} ${i + 1}`
                  : tr("side.tab.terminal");
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    title={label}
                    className={
                      "rp-tab rp-tab--named" +
                      (active ? " is-active" : " is-inactive")
                    }
                    data-testid="bottom-terminal-tab"
                    onClick={() => onActivateTab(tab.id)}
                    onAuxClick={(e) => {
                      if (!isSideTabMiddleClick(e)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                    onMouseDown={(e) => {
                      if (isSideTabMiddleClick(e)) e.preventDefault();
                    }}
                  >
                    <IconTerminal size={14} />
                    <span className="rp-tab__name">{label}</span>
                    {active ? (
                      <span
                        className="rp-tab__x"
                        role="button"
                        tabIndex={0}
                        title={tr("side.tabClose")}
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloseTab(tab.id);
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
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="rp-chrome__actions">
              <Tip label={tr("terminal.new")}>
                <button
                  type="button"
                  className="chrome-btn"
                  aria-label={tr("terminal.new")}
                  data-testid="bottom-terminal-new"
                  onClick={onAddTab}
                >
                  <IconPlus size={16} />
                </button>
              </Tip>
              <Tip label={tr("terminal.closePanel")}>
                <button
                  type="button"
                  className="chrome-btn"
                  aria-label={tr("terminal.closePanel")}
                  data-testid="bottom-terminal-close"
                  onClick={onClosePanel}
                >
                  <IconChevronDown size={16} />
                </button>
              </Tip>
            </div>
          </div>

      <div className="bt__body">
        {state.tabs.map((tab) => {
          const isActive = state.open && tab.id === state.activeId;
          return (
            <div
              key={tab.id}
              className="bt__persist-host sw__persist-host"
              hidden={!isActive}
              aria-hidden={!isActive}
              data-bt-tab-id={tab.id}
            >
              <TerminalTab
                locale={locale}
                tabId={tab.id}
                projectPath={projectPath}
                active={isActive}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
