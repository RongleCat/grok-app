import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import type { WorktreeLayout } from "@/lib/gitWorktree";

export function WorktreeCreateModal(props: {
  locale: Locale;
  open: boolean;
  busy: boolean;
  startChat: boolean;
  name: string;
  layout: WorktreeLayout;
  startRef: string;
  previewPath: string | null;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onNameChange: (value: string) => void;
  onLayoutChange: (value: WorktreeLayout) => void;
  onRefChange: (value: string) => void;
}) {
  const tr = createT(props.locale);
  const submit = () => {
    if (props.busy) return;
    props.onSubmit();
  };
  return (
    <GlassModal
      open={props.open}
      onClose={() => {
        if (props.busy) return;
        props.onClose();
      }}
      title={
        props.startChat
          ? tr("composer.worktreeNewChatTitle")
          : tr("composer.worktreeNewTitle")
      }
      size="sm"
      closeLabel={tr("common.close")}
      closeOnOverlay={!props.busy}
      showClose={!props.busy}
      wrapBody
      footer={
        <>
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
            className="btn btn--solid"
            disabled={props.busy || !props.name.trim()}
            onClick={submit}
          >
            {props.busy
              ? tr("composer.worktreeCreating")
              : props.startChat
                ? tr("composer.worktreeCreateChat")
                : tr("composer.worktreeCreate")}
          </button>
        </>
      }
    >
      <form
        className="wt-create"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="wt-create__hint">
          {props.startChat
            ? tr("composer.worktreeNewChatHint")
            : tr("composer.worktreeNewHint")}
        </p>
        <label className="wt-create__field">
          <span className="wt-create__label">{tr("composer.worktreeName")}</span>
          <input
            className="settings-input"
            value={props.name}
            onChange={(e) => props.onNameChange(e.target.value)}
            placeholder={tr("composer.worktreeNamePlaceholder")}
            autoComplete="off"
            autoFocus
            disabled={props.busy}
            spellCheck={false}
          />
        </label>
        <fieldset
          className="wt-create__field wt-create__layout"
          disabled={props.busy}
        >
          <legend className="wt-create__label">
            {tr("composer.worktreeLayout")}
          </legend>
          <label className="wt-create__radio">
            <input
              type="radio"
              name="worktree-layout"
              value="cli"
              checked={props.layout === "cli"}
              onChange={() => props.onLayoutChange("cli")}
            />
            <span>{tr("composer.worktreeLayoutCli")}</span>
          </label>
          <label className="wt-create__radio">
            <input
              type="radio"
              name="worktree-layout"
              value="sibling"
              checked={props.layout === "sibling"}
              onChange={() => props.onLayoutChange("sibling")}
            />
            <span>{tr("composer.worktreeLayoutSibling")}</span>
          </label>
        </fieldset>
        <label className="wt-create__field">
          <span className="wt-create__label">{tr("composer.worktreeRef")}</span>
          <input
            className="settings-input"
            value={props.startRef}
            onChange={(e) => props.onRefChange(e.target.value)}
            placeholder={tr("composer.worktreeRefPlaceholder")}
            autoComplete="off"
            disabled={props.busy}
            spellCheck={false}
          />
        </label>
        {props.previewPath ? (
          <p className="wt-create__preview">
            {tr("composer.worktreePathPreview", { path: props.previewPath })}
          </p>
        ) : null}
        {props.error ? (
          <p className="wt-create__error" role="alert">
            {props.error}
          </p>
        ) : null}
      </form>
    </GlassModal>
  );
}
