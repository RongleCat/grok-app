import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import type { Ref } from "react";

export function QueueEditModal(props: {
  locale: Locale;
  open: boolean;
  text: string;
  textareaRef: Ref<HTMLTextAreaElement>;
  onTextChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const tr = createT(props.locale);
  return (
    <GlassModal
      open={props.open}
      onClose={props.onClose}
      title={tr("composer.queueEditTitle")}
      size="md"
      closeLabel={tr("common.close")}
      wrapBody
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={props.onClose}
          >
            {tr("composer.queueEditCancel")}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            onClick={props.onSave}
          >
            {tr("composer.queueEditSave")}
          </button>
        </>
      }
    >
      <label className="composer__queue-edit-field">
        <span className="sr-only">{tr("composer.queueEditTitle")}</span>
        <textarea
          ref={props.textareaRef}
          className="composer__queue-edit-textarea settings-input"
          value={props.text}
          onChange={(e) => props.onTextChange(e.target.value)}
          rows={6}
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              props.onClose();
            }
            if (
              e.key === "Enter" &&
              (e.metaKey || e.ctrlKey) &&
              !e.shiftKey &&
              !e.altKey
            ) {
              e.preventDefault();
              props.onSave();
            }
          }}
        />
      </label>
    </GlassModal>
  );
}
