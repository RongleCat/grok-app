import { createT, type Locale, type MessageKey } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import type { ExportImageMetaParts, ExportImagePreviewPhase } from "@/lib/exportSharePro";
import { shareCardSkinMessageKey } from "@/lib/exportSharePro";
import { SHARE_CARD_SKIN_IDS, type ShareCardSkinId } from "@/lib/shareCardSkins";

export function ExportImageModal(props: {
  locale: Locale;
  open: boolean;
  busy: boolean;
  canAct: boolean;
  skin: ShareCardSkinId;
  smart: boolean;
  previewPhase: ExportImagePreviewPhase;
  previewUrl: string | null;
  optionsMatch: boolean;
  previewError: string | null;
  bytesLabel: string | null;
  metaParts: ExportImageMetaParts;
  onClose: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onSkinChange: (skin: ShareCardSkinId) => void;
  onSmartChange: (value: boolean) => void;
}) {
  const tr = createT(props.locale);
  const showPreview = props.previewUrl && props.optionsMatch;
  return (
    <GlassModal
      open={props.open}
      onClose={props.onClose}
      title={tr("session.exportImageTitle")}
      size="md"
      closeLabel={tr("common.close")}
      closeOnOverlay={!props.busy}
      showClose={!props.busy}
      wrapBody
      className="export-md-modal export-image-modal"
    >
      <div className="export-md-options">
        <div
          className="export-image-skins"
          role="radiogroup"
          aria-label={tr("session.exportImageTheme")}
        >
          {SHARE_CARD_SKIN_IDS.map((skinId) => (
            <button
              key={skinId}
              type="button"
              role="radio"
              aria-checked={props.skin === skinId}
              className={
                "export-image-skin" +
                (props.skin === skinId ? " export-image-skin--active" : "")
              }
              disabled={props.busy}
              data-skin={skinId}
              onClick={() => props.onSkinChange(skinId)}
            >
              <span
                className="export-image-skin__swatch"
                aria-hidden
                data-skin={skinId}
              />
              <span className="export-image-skin__label">
                {tr(shareCardSkinMessageKey(skinId) as MessageKey)}
              </span>
            </button>
          ))}
        </div>
        <div
          className="export-image-meta"
          aria-live="polite"
          data-phase={props.previewPhase}
        >
          <span className="export-image-meta__chip">
            {tr(props.metaParts.modeKey as MessageKey)}
          </span>
          <span className="export-image-meta__chip">
            {tr(props.metaParts.skinKey as MessageKey)}
          </span>
          {props.metaParts.layoutKey ? (
            <span className="export-image-meta__chip export-image-style-chip">
              {tr(props.metaParts.layoutKey as MessageKey)}
            </span>
          ) : null}
          {props.bytesLabel && props.previewPhase === "ready" ? (
            <span
              className="export-image-meta__chip export-image-meta__chip--muted"
              title={tr("session.exportImageSize")}
            >
              {props.bytesLabel}
            </span>
          ) : null}
        </div>
        <div
          key={showPreview ? props.previewUrl : "export-image-preview-empty"}
          className={
            "export-image-preview" +
            (props.previewPhase === "error"
              ? " export-image-preview--error"
              : "") +
            (props.previewPhase === "rendering"
              ? " export-image-preview--busy"
              : "")
          }
          aria-busy={props.busy}
          aria-live="polite"
          data-phase={props.previewPhase}
        >
          {showPreview ? (
            <img
              src={props.previewUrl ?? ""}
              alt={tr("session.exportImagePreview")}
              className="export-image-preview__img"
            />
          ) : props.previewError ? (
            <p className="export-image-preview__err" role="alert">
              {props.previewError}
            </p>
          ) : (
            <p className="export-image-preview__placeholder">
              {props.previewPhase === "rendering" || props.busy
                ? tr("session.exportImageWorking")
                : tr("session.exportImagePreview")}
            </p>
          )}
        </div>
        <label className="export-md-options__row">
          <input
            type="checkbox"
            checked={props.smart}
            disabled={props.busy}
            onChange={(e) => props.onSmartChange(e.target.checked)}
          />
          <span>
            {tr("session.exportImageSmart")}
            <span className="export-image-smart-hint">
              {" "}
              — {tr("session.exportImageSmartDesc")}
            </span>
          </span>
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
            disabled={!props.canAct || props.busy}
            onClick={props.onCopy}
          >
            {tr("session.exportImageCopy")}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            disabled={!props.canAct || props.busy}
            onClick={props.onDownload}
          >
            {props.busy
              ? tr("session.exportImageWorking")
              : tr("session.exportImageDownload")}
          </button>
        </div>
      </div>
    </GlassModal>
  );
}
