/**
 * Design Mode inspector — lives in React chrome so i18n / composer work.
 * Hover + click stay inside the child Webview overlay.
 */

import { useMemo } from "react";
import { createT, type Locale } from "@/i18n";
import {
  formatRect,
  inspectorStyleRows,
  selectorLabel,
  type DesignModeSelection,
  type DesignModeShot,
  type DesignModeStatus,
} from "@/lib/browserDesignMode";

export type BrowserDesignModePanelProps = {
  locale: Locale | string;
  status: DesignModeStatus;
  localPreview: boolean;
  selection: DesignModeSelection | null;
  shot: DesignModeShot;
  note: string;
  includeShot: boolean;
  sending?: boolean;
  onNoteChange: (note: string) => void;
  onIncludeShotChange: (next: boolean) => void;
  onSend: () => void;
  onClear: () => void;
};

export function BrowserDesignModePanel({
  locale,
  status,
  localPreview,
  selection,
  shot,
  note,
  includeShot,
  sending = false,
  onNoteChange,
  onIncludeShotChange,
  onSend,
  onClear,
}: BrowserDesignModePanelProps) {
  const tr = useMemo(() => createT(locale as Locale), [locale]);
  const rows = useMemo(
    () => (selection ? inspectorStyleRows(selection) : []),
    [selection],
  );
  const shotReady = shot.status === "ok" && !!shot.dataUrl;
  const canSend = !!selection && !sending;

  if (status === "unavailable") {
    return (
      <div
        className="sw-dm"
        data-testid="side-browser-dm-panel"
        data-dm-status="unavailable"
      >
        <p className="sw-dm__banner">{tr("side.browser.designModeUnavailable")}</p>
      </div>
    );
  }

  if (!selection) {
    return (
      <div
        className="sw-dm"
        data-testid="side-browser-dm-panel"
        data-dm-status={status}
      >
        <p className="sw-dm__hint">{tr("side.browser.designModeHint")}</p>
        {!localPreview ? (
          <p className="sw-dm__sub">{tr("side.browser.designModeLocalHint")}</p>
        ) : null}
      </div>
    );
  }

  const label = selectorLabel(selection);

  return (
    <div
      className="sw-dm sw-dm--open"
      data-testid="side-browser-dm-panel"
      data-dm-status={status}
      data-dm-tag={selection.tag}
    >
      <div className="sw-dm__head">
        <div className="sw-dm__ident">
          <code className="sw-dm__sel" title={label}>
            {label}
          </code>
          <span className="sw-dm__path" title={selection.cssPath}>
            {selection.cssPath}
          </span>
        </div>
        <button
          type="button"
          className="sw-dm__text-btn"
          onClick={onClear}
          data-testid="side-browser-dm-clear"
        >
          {tr("side.browser.designModeClear")}
        </button>
      </div>
      <div className="sw-dm__meta">
        <span>{formatRect(selection.rect)}</span>
        {selection.text ? (
          <span className="sw-dm__text" title={selection.text}>
            {selection.text}
          </span>
        ) : null}
      </div>
      {rows.length ? (
        <dl className="sw-dm__styles" aria-label={tr("side.browser.designModeStyles")}>
          {rows.slice(0, 10).map((row) => (
            <div key={row.key} className="sw-dm__row">
              <dt>{row.label}</dt>
              <dd>
                {row.key === "color" || row.key === "backgroundColor" ? (
                  <i
                    className="sw-dm__swatch"
                    style={{ background: row.value }}
                    aria-hidden
                  />
                ) : null}
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <label className="sw-dm__note">
        <span className="sr-only">
          {tr("side.browser.designModeNotePh")}
        </span>
        <textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder={tr("side.browser.designModeNotePh")}
          rows={2}
          data-testid="side-browser-dm-note"
        />
      </label>
      <div className="sw-dm__actions">
        <button
          type="button"
          className={
            "sw-dm__shot" + (includeShot && shotReady ? " is-on" : "")
          }
          aria-pressed={includeShot && shotReady}
          disabled={!shotReady}
          onClick={() => onIncludeShotChange(!includeShot)}
          data-testid="side-browser-dm-shot"
        >
          {tr("side.browser.designModeIncludeShot")}
        </button>
        <button
          type="button"
          className="sw-dm__send"
          disabled={!canSend}
          onClick={onSend}
          data-testid="side-browser-dm-send"
        >
          {sending
            ? tr("side.browser.designModeSending")
            : tr("side.browser.designModeSend")}
        </button>
      </div>
    </div>
  );
}
