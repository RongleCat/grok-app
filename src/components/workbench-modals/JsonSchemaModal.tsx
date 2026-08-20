import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";

export function JsonSchemaModal(props: {
  locale: Locale;
  open: boolean;
  draft: string;
  hasStoredSchema: boolean;
  onDraftChange: (value: string) => void;
  onClose: () => void;
  onClear: () => void;
  onApply: () => void;
}) {
  const tr = createT(props.locale);
  return (
    <GlassModal
      open={props.open}
      onClose={props.onClose}
      title={tr("composer.jsonSchemaTitle")}
      size="md"
      closeLabel={tr("common.close")}
      wrapBody
      className="json-schema-modal"
      footer={
        <div className="json-schema-modal__actions">
          {props.hasStoredSchema ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={props.onClear}
            >
              {tr("composer.jsonSchemaClear")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={props.onClose}
          >
            {tr("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={props.onApply}
          >
            {tr("composer.jsonSchemaApply")}
          </button>
        </div>
      }
    >
      <p className="json-schema-modal__hint">{tr("composer.jsonSchemaHint")}</p>
      <p className="json-schema-modal__experimental">
        {tr("composer.jsonSchemaExperimental")}
      </p>
      <textarea
        className="json-schema-modal__textarea"
        value={props.draft}
        onChange={(e) => props.onDraftChange(e.target.value)}
        placeholder={tr("composer.jsonSchemaPlaceholder")}
        spellCheck={false}
        aria-label={tr("composer.jsonSchemaTitle")}
      />
    </GlassModal>
  );
}
