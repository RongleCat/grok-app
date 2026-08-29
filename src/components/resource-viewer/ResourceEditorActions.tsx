/**
 * Edit / Preview / Save / Revert cluster for the resource text editor.
 * Used in the in-preview toolbar and the files dual-row chrome.
 */

import type { MessageKey } from "@/i18n";
import { IconEdit } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";

export type ResourceEditorActionsProps = {
  tr: (key: MessageKey, vars?: Record<string, string>) => string;
  editMode: boolean;
  saving: boolean;
  dirty: boolean;
  onToggleEdit: () => void;
  onSave: () => void;
  onRevert: () => void;
  /**
   * split — Edit left, Save right (in-preview toolbar).
   * start — Edit + Save clustered left (files toolbar filename slot).
   */
  align?: "split" | "start";
  className?: string;
  title?: string;
  testIds?: {
    edit?: string;
    save?: string;
    revert?: string;
  };
};

export function ResourceEditorActions({
  tr,
  editMode,
  saving,
  dirty,
  onToggleEdit,
  onSave,
  onRevert,
  align = "split",
  className,
  title,
  testIds,
}: ResourceEditorActionsProps) {
  const editLabel = editMode
    ? tr("resources.previewMode")
    : tr("resources.editMode");
  const saveBtn = (
    <Tip label={tr("resources.save")}>
      <button
        type="button"
        className={
          "rp-editor__tool-btn rp-editor__tool-btn--save" +
          (dirty ? " is-dirty" : "")
        }
        disabled={saving || !dirty}
        onClick={onSave}
        data-testid={testIds?.save}
      >
        {saving ? tr("resources.saving") : tr("resources.save")}
      </button>
    </Tip>
  );
  const revertBtn = dirty ? (
    <Tip label={tr("resources.revert")}>
      <button
        type="button"
        className="rp-editor__tool-btn"
        disabled={saving}
        onClick={onRevert}
        data-testid={testIds?.revert}
      >
        {tr("resources.revert")}
      </button>
    </Tip>
  ) : null;
  const dirtyLabel = dirty ? (
    <span className="rp-editor__dirty-label" role="status">
      {tr("resources.unsaved")}
    </span>
  ) : null;
  return (
    <div
      className={
        "rp-editor__toolbar-actions" +
        (align === "split"
          ? " rp-editor__toolbar-actions--split"
          : " rp-editor__toolbar-actions--start") +
        (className ? ` ${className}` : "")
      }
      role="toolbar"
      aria-label={tr("resources.editorToolbar")}
      title={title}
    >
      <Tip label={editLabel}>
        <button
          type="button"
          className={"rp-editor__tool-btn" + (editMode ? " is-on" : "")}
          disabled={saving}
          onClick={onToggleEdit}
          aria-pressed={editMode}
          aria-label={editLabel}
          data-testid={testIds?.edit}
        >
          <IconEdit size={14} />
          <span className="rp-editor__tool-btn-label">{editLabel}</span>
        </button>
      </Tip>
      {align === "start" ? saveBtn : null}
      {align === "split" ? (
        <div className="rp-editor__toolbar-spacer" />
      ) : null}
      {revertBtn}
      {align === "split" ? saveBtn : null}
      {dirtyLabel}
    </div>
  );
}
