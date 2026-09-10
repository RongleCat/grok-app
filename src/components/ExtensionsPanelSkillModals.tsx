/**
 * Skills tab modal farm for ExtensionsPanel: new-skill scaffold, editor,
 * save feedback, discard confirm, and write-conflict confirm. Extracted
 * verbatim from the panel (WP: giant-component decomposition) — the modal
 * state cluster threads through as one props bundle.
 */
import { GlassModal } from "@/components/GlassModal";
import {
  skillEditBadgeTone,
  skillEditHint,
  skillEditKindLabel,
  type SkillEditKind,
  type SkillEditPresentation,
} from "@/lib/skillEditFeedback";
import { createT } from "@/i18n";
import { isExtensionEnabled, shortPathLabel } from "@/lib/extensionsUi";
import type * as api from "@/lib/api";

type TFn = ReturnType<typeof createT>;

type SkillEditorState = {
  skill: api.SkillDto;
  path: string;
  baselineText: string;
  draftText: string;
  mtimeMs: number | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  savedHint: string | null;
};

export type ExtensionsPanelSkillModalsProps = {
  tr: TFn;
  actionBusy: string | null;
  skillKindLabels: Partial<Record<SkillEditKind, string>>;
  skillKindHints: Partial<Record<SkillEditKind, string>>;
  skillNewSanitized: string | null;
  submitSkillNew: () => Promise<void>;
  requestCloseSkillEditor: () => void;
  validateSkillEditor: () => void;
  closeSkillEditor: () => void;
  openSkillEditor: (skill: api.SkillDto, opts?: { force?: boolean }) => Promise<void>;
  projectPath: string | null;
  saveSkillEditor: (opts?: { force?: boolean }) => Promise<void>;
  skillEditor: SkillEditorState | null;
  setSkillEditor: (
    next: SkillEditorState | null | ((prev: SkillEditorState | null) => SkillEditorState | null),
  ) => void;
  skillEditorDirty: boolean;
  skillFeedback: SkillEditPresentation | null;
  skillNewOpen: boolean;
  skillNewName: string;
  skillNewDesc: string;
  skillNewScope: "user" | "project";
  skillNewError: string | null;
  skillDiscardOpen: boolean;
  skillConflictOpen: boolean;
  skillFeedbackOpen: boolean;
  setSkillNewOpen: (open: boolean) => void;
  setSkillNewName: (v: string) => void;
  setSkillNewDesc: (v: string) => void;
  setSkillNewScope: (v: "user" | "project") => void;
  setSkillNewError: (v: string | null) => void;
  setSkillDiscardOpen: (v: boolean) => void;
  setSkillConflictOpen: (v: boolean) => void;
  setSkillFeedbackOpen: (v: boolean) => void;
};

export function ExtensionsPanelSkillModals(p: ExtensionsPanelSkillModalsProps) {
  const {
    tr,
    actionBusy,
    skillKindLabels,
    skillKindHints,
    skillNewSanitized,
    submitSkillNew,
    requestCloseSkillEditor,
    validateSkillEditor,
    closeSkillEditor,
    openSkillEditor,
    projectPath,
    saveSkillEditor,
    skillEditor,
    setSkillEditor,
    skillEditorDirty,
    skillFeedback,
    skillNewOpen,
    skillNewName,
    skillNewDesc,
    skillNewScope,
    skillNewError,
    skillDiscardOpen,
    skillConflictOpen,
    skillFeedbackOpen,
    setSkillNewOpen,
    setSkillNewName,
    setSkillNewDesc,
    setSkillNewScope,
    setSkillNewError,
    setSkillDiscardOpen,
    setSkillConflictOpen,
    setSkillFeedbackOpen,
  } = p;
  return (
    <>
      <GlassModal
        open={skillNewOpen}
        onClose={() => {
          if (actionBusy !== "skill:create") setSkillNewOpen(false);
        }}
        title={tr("ext.skills.newTitle")}
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={actionBusy === "skill:create"}
              onClick={() => setSkillNewOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={
                actionBusy === "skill:create" || !skillNewSanitized
              }
              onClick={() => void submitSkillNew()}
            >
              {actionBusy === "skill:create"
                ? tr("ext.skills.newWorking")
                : tr("ext.skills.newSubmit")}
            </button>
          </>
        }
      >
        <form
          className="app-dialog__form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitSkillNew();
          }}
        >
          <label className="field">
            <span>{tr("ext.skills.newName")}</span>
            <input
              className="app-dialog__input"
              value={skillNewName}
              onChange={(e) => {
                setSkillNewName(e.target.value);
                setSkillNewError(null);
              }}
              placeholder={tr("ext.skills.newNamePlaceholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={actionBusy === "skill:create"}
              autoFocus
            />
            <span className="ext-field-hint">
              {skillNewSanitized
                ? tr("ext.skills.newNameHintOk", { name: skillNewSanitized })
                : tr("ext.skills.newNameHint")}
            </span>
          </label>
          <label className="field">
            <span>{tr("ext.skills.newDescription")}</span>
            <textarea
              className="app-dialog__input ext-env-textarea"
              value={skillNewDesc}
              onChange={(e) => {
                setSkillNewDesc(e.target.value);
                setSkillNewError(null);
              }}
              placeholder={tr("ext.skills.newDescriptionPlaceholder")}
              rows={3}
              spellCheck
              disabled={actionBusy === "skill:create"}
            />
            <span className="ext-field-hint">
              {tr("ext.skills.newDescriptionHint")}
            </span>
          </label>
          <fieldset className="field" disabled={actionBusy === "skill:create"}>
            <legend>{tr("ext.skills.newScope")}</legend>
            <label className="ext-radio-row">
              <input
                type="radio"
                name="skill-new-scope"
                checked={skillNewScope === "user"}
                onChange={() => setSkillNewScope("user")}
              />
              <span>{tr("ext.skills.newScopeUser")}</span>
            </label>
            <label className="ext-radio-row">
              <input
                type="radio"
                name="skill-new-scope"
                checked={skillNewScope === "project"}
                onChange={() => setSkillNewScope("project")}
                disabled={!projectPath?.trim()}
              />
              <span>
                {projectPath?.trim()
                  ? tr("ext.skills.newScopeProject")
                  : tr("ext.skills.newScopeProjectDisabled")}
              </span>
            </label>
            <span className="ext-field-hint">{tr("ext.skills.newScopeHint")}</span>
          </fieldset>
          {skillNewError ? (
            <p className="ext-alert" role="alert">
              <span className="ext-alert__body">{skillNewError}</span>
            </p>
          ) : null}
        </form>
      </GlassModal>

      <GlassModal
        open={!!skillEditor}
        onClose={requestCloseSkillEditor}
        title={
          skillEditor
            ? tr("ext.skills.editTitle", { name: skillEditor.skill.name })
            : tr("ext.skills.edit")
        }
        size="lg"
        closeLabel={tr("common.close")}
        closeOnOverlay={!skillEditor?.saving}
        wrapBody
        bodyClassName="ext-skill-editor"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!!skillEditor?.saving}
              onClick={requestCloseSkillEditor}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={
                !skillEditor || skillEditor.loading || skillEditor.saving
              }
              onClick={validateSkillEditor}
            >
              {tr("ext.skills.editValidate")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={
                !skillEditor ||
                skillEditor.loading ||
                skillEditor.saving ||
                !!skillEditor.error ||
                !skillEditorDirty
              }
              onClick={() => void saveSkillEditor()}
            >
              {skillEditor?.saving
                ? tr("ext.skills.editSaving")
                : tr("common.save")}
            </button>
          </>
        }
      >
        {skillEditor ? (
          <>
            {!isExtensionEnabled(skillEditor.skill.enabled) ? (
              <p className="ext-skill-editor__note" role="status">
                {tr("ext.skills.editDisabledNote")}
              </p>
            ) : null}
            {skillEditor.path ? (
              <p className="ext-skill-editor__path" title={skillEditor.path}>
                {shortPathLabel(skillEditor.path, 72) || skillEditor.path}
              </p>
            ) : null}
            {skillEditor.loading ? (
              <p className="ext-empty">{tr("ext.skills.editLoading")}</p>
            ) : skillEditor.error && !skillEditor.baselineText ? (
              <p className="ext-alert ext-alert--error" role="alert">
                <span className="ext-alert__body">{skillEditor.error}</span>
              </p>
            ) : (
              <textarea
                className="ext-skill-editor__textarea"
                value={skillEditor.draftText}
                onChange={(e) =>
                  setSkillEditor((s) =>
                    s
                      ? {
                          ...s,
                          draftText: e.target.value,
                          savedHint: null,
                          error: null,
                        }
                      : s,
                  )
                }
                spellCheck={false}
                disabled={skillEditor.saving}
                aria-label={tr("ext.skills.editAria", {
                  name: skillEditor.skill.name,
                })}
                rows={18}
              />
            )}
            {skillEditor.error && skillEditor.baselineText ? (
              <p className="ext-skill-editor__error" role="alert">
                {skillEditor.error}
                {skillFeedback ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm ext-skill-editor__details-btn"
                      onClick={() => setSkillFeedbackOpen(true)}
                    >
                      {tr("ext.skills.feedback.viewDetails")}
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
            {skillEditor.savedHint ? (
              <p
                className={
                  "ext-skill-editor__saved" +
                  (skillFeedback && !skillFeedback.blocking
                    ? skillFeedback.severity === "warn"
                      ? " ext-skill-editor__status--warn"
                      : skillFeedback.severity === "ok"
                        ? " ext-skill-editor__status--ok"
                        : ""
                    : " ext-skill-editor__status--ok")
                }
                role="status"
              >
                {skillEditor.savedHint}
                {skillFeedback && !skillFeedback.blocking ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm ext-skill-editor__details-btn"
                      onClick={() => setSkillFeedbackOpen(true)}
                    >
                      {tr("ext.skills.feedback.viewDetails")}
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
          </>
        ) : null}
      </GlassModal>

      <GlassModal
        open={skillFeedbackOpen && !!skillFeedback}
        onClose={() => setSkillFeedbackOpen(false)}
        title={
          skillFeedback?.phase === "validate"
            ? tr("ext.skills.feedback.resultValidateTitle")
            : skillFeedback?.phase === "load"
              ? tr("ext.skills.feedback.resultLoadTitle")
              : skillFeedback?.phase === "create"
                ? tr("ext.skills.feedback.resultCreateTitle")
                : tr("ext.skills.feedback.resultSaveTitle")
        }
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        bodyClassName="ext-skill-feedback"
        footer={
          <>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => setSkillFeedbackOpen(false)}
            >
              {tr("common.close")}
            </button>
          </>
        }
      >
        {skillFeedback ? (
          <div className="ext-skill-feedback__body">
            <div className="ext-skill-feedback__meta">
              <span
                className={
                  "ext-badge ext-badge--" +
                  skillEditBadgeTone(skillFeedback.severity)
                }
              >
                {skillEditKindLabel(skillFeedback.kind, skillKindLabels)}
              </span>
              {skillFeedback.name ? (
                <span className="ext-badge ext-badge--muted">
                  /{skillFeedback.name}
                </span>
              ) : null}
              {skillFeedback.sizeBytes != null ? (
                <span className="ext-badge ext-badge--muted">
                  {tr("ext.skills.feedback.sizeBytes", {
                    n: String(skillFeedback.sizeBytes),
                  })}
                </span>
              ) : null}
            </div>
            <p
              className={
                "ext-skill-feedback__summary" +
                (skillFeedback.severity === "ok"
                  ? " ext-skill-feedback__summary--ok"
                  : skillFeedback.severity === "err"
                    ? " ext-skill-feedback__summary--err"
                    : skillFeedback.severity === "warn"
                      ? " ext-skill-feedback__summary--warn"
                      : "")
              }
            >
              {skillFeedback.summary}
            </p>
            {skillEditHint(skillFeedback.kind, skillKindHints) ? (
              <p className="ext-skill-feedback__hint">
                {skillEditHint(skillFeedback.kind, skillKindHints)}
              </p>
            ) : null}
            {skillFeedback.detail &&
            skillFeedback.detail !== skillFeedback.summary ? (
              <p className="ext-skill-feedback__detail">
                {skillFeedback.detail}
              </p>
            ) : null}
            {skillFeedback.issues.length > 1 ? (
              <ul className="ext-skill-feedback__issues">
                {skillFeedback.issues.map((issue, idx) => (
                  <li key={`${issue.kind}-${idx}`}>
                    <span
                      className={
                        "ext-badge ext-badge--" +
                        skillEditBadgeTone(issue.severity)
                      }
                    >
                      {skillEditKindLabel(issue.kind, skillKindLabels)}
                    </span>
                    {issue.detail ? (
                      <span className="ext-skill-feedback__issue-detail">
                        {issue.detail}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {skillFeedback.reason ? (
              <p className="ext-skill-feedback__reason">
                <span className="ext-skill-feedback__label">
                  {tr("ext.skills.feedback.reason")}
                </span>
                <code>{skillFeedback.reason}</code>
              </p>
            ) : null}
            {skillFeedback.path ? (
              <p className="ext-skill-feedback__path" title={skillFeedback.path}>
                <span className="ext-skill-feedback__label">
                  {tr("ext.skills.feedback.path")}
                </span>
                <code>
                  {shortPathLabel(skillFeedback.path, 64) || skillFeedback.path}
                </code>
              </p>
            ) : null}
          </div>
        ) : null}
      </GlassModal>

      <GlassModal
        open={skillDiscardOpen}
        onClose={() => setSkillDiscardOpen(false)}
        title={tr("ext.skills.editDiscardTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setSkillDiscardOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                setSkillDiscardOpen(false);
                closeSkillEditor();
              }}
            >
              {tr("ext.skills.editDiscard")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">{tr("ext.skills.editDiscardBody")}</p>
      </GlassModal>

      <GlassModal
        open={skillConflictOpen}
        onClose={() => setSkillConflictOpen(false)}
        title={tr("ext.skills.editConflictTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setSkillConflictOpen(false);
                if (skillEditor) void openSkillEditor(skillEditor.skill);
              }}
            >
              {tr("ext.skills.editConflictReload")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => {
                setSkillConflictOpen(false);
                void saveSkillEditor({ force: true });
              }}
            >
              {tr("ext.skills.editConflictOverwrite")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">{tr("ext.skills.editConflictBody")}</p>
      </GlassModal>
    </>
  );
}
