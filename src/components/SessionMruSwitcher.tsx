/**
 * Temporary Ctrl+Tab chat switcher. Shows while Ctrl is held; gone on release.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createT, type Locale } from "@/i18n";
import {
  getSessionMruPanelState,
  pickSessionMruPanelIndex,
  subscribeSessionMruPanel,
} from "@/lib/sessionMruPanelStore";

export function SessionMruSwitcher({ locale }: { locale: Locale }) {
  const state = useSyncExternalStore(
    subscribeSessionMruPanel,
    getSessionMruPanelState,
    getSessionMruPanelState,
  );
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const tr = createT(locale);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [state?.index, state?.rows.length]);

  if (!state || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="overlay session-mru-overlay"
      role="presentation"
    >
      <div
        className="search-panel session-mru-panel"
        role="listbox"
        aria-label={tr("shortcuts.recentSessionMruPanel")}
        aria-activedescendant={
          state.rows[state.index]
            ? `session-mru-${state.rows[state.index]!.id}`
            : undefined
        }
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className="search-panel__head">
          <div className="search-panel__body">
            <div className="search-panel__title">
              {tr("shortcuts.recentSessionMruPanel")}
            </div>
            <div className="session-mru-panel__hint">
              {tr("shortcuts.recentSessionMruPanelHint")}
            </div>
          </div>
        </div>
        <div className="search-panel__results">
          {state.rows.map((row, index) => {
            const active = index === state.index;
            const title = row.title || tr("tray.untitled");
            return (
              <button
                key={row.id}
                type="button"
                id={`session-mru-${row.id}`}
                ref={active ? activeRef : undefined}
                className={
                  active
                    ? "search-panel__row is-active"
                    : "search-panel__row"
                }
                role="option"
                aria-selected={active}
                onClick={() => pickSessionMruPanelIndex(index)}
              >
                <span className="search-panel__body">
                  <span className="search-panel__title">{title}</span>
                  {row.projectName ? (
                    <span className="search-panel__snippet">
                      {row.projectName}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
