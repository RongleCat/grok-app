import { createT, type Locale, type MessageKey } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { sessionExportFormatNameKey } from "@/lib/sessionExportPro";
import type { SessionExportPathResolution } from "@/lib/sessionExportPro";

export type ExportMdHonesty = {
  journalEmpty: boolean | null;
  sizeClassKey: string | null;
  sizeBytesLabel: string | null;
  canAct: boolean;
  path: SessionExportPathResolution | null;
};

export function ExportMdModal(props: {
  locale: Locale;
  open: boolean;
  busy: boolean;
  includeThoughts: boolean;
  includeTools: boolean;
  honesty: ExportMdHonesty;
  onClose: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onIncludeThoughtsChange: (value: boolean) => void;
  onIncludeToolsChange: (value: boolean) => void;
}) {
  const tr = createT(props.locale);
  const honesty = props.honesty;
  const blocked = props.busy || !props.open || !honesty.canAct;
  return (
    <GlassModal
      open={props.open}
      onClose={() => {
        if (props.busy) return;
        props.onClose();
      }}
      title={tr("session.exportMdTitle")}
      size="sm"
      closeLabel={tr("common.close")}
      closeOnOverlay={!props.busy}
      showClose={!props.busy}
      wrapBody
      className="export-md-modal"
    >
      <div className="export-md-options">
        <p className="export-md-options__msg">{tr("session.exportMdHint")}</p>
        <div
          className="export-md-options__meta"
          role="status"
          aria-live="polite"
        >
          <span className="export-md-options__chip">
            {tr(sessionExportFormatNameKey("markdown") as MessageKey)}
            {" · .md"}
          </span>
          {honesty.path?.badgeKeys.map((key) => (
            <span
              key={key}
              className={
                key === "session.exportPath.cli"
                  ? "export-md-options__chip export-md-options__chip--cli"
                  : "export-md-options__chip"
              }
            >
              {tr(key as MessageKey)}
            </span>
          ))}
          {honesty.sizeClassKey ? (
            <span className="export-md-options__chip">
              {tr("session.exportSizeHint", {
                size: honesty.sizeBytesLabel
                  ? `${tr(honesty.sizeClassKey as MessageKey)} · ${honesty.sizeBytesLabel}`
                  : tr(honesty.sizeClassKey as MessageKey),
              })}
            </span>
          ) : null}
        </div>
        {honesty.path?.cliSkipReasonKey ? (
          <p className="export-md-options__path-hint" role="status">
            {tr(honesty.path.cliSkipReasonKey as MessageKey)}
          </p>
        ) : null}
        {honesty.journalEmpty === true ? (
          <p className="export-md-options__empty" role="status">
            {tr("session.exportEmpty")}
          </p>
        ) : null}
        <label className="export-md-options__row">
          <input
            type="checkbox"
            checked={props.includeThoughts}
            disabled={props.busy}
            onChange={(e) => props.onIncludeThoughtsChange(e.target.checked)}
          />
          <span>{tr("session.exportMdIncludeThoughts")}</span>
        </label>
        <label className="export-md-options__row">
          <input
            type="checkbox"
            checked={props.includeTools}
            disabled={props.busy}
            onChange={(e) => props.onIncludeToolsChange(e.target.checked)}
          />
          <span>{tr("session.exportMdIncludeTools")}</span>
        </label>
        <div className="export-md-options__actions" role="group">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={props.busy}
            onClick={props.onClose}
          >
            {tr("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={blocked}
            onClick={props.onCopy}
          >
            {tr("session.exportMdCopy")}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            disabled={blocked}
            onClick={props.onDownload}
          >
            {props.busy
              ? tr("session.exportMdWorking")
              : tr("session.exportMdDownload")}
          </button>
        </div>
      </div>
    </GlassModal>
  );
}
