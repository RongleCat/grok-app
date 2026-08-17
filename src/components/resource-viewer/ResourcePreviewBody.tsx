/**
 * Resource pane preview body — file kinds, editor shell, and Changes diff view.
 * Presentational: all actions/state come from props (behavior freeze).
 */

import { lazy, Suspense, type ReactNode } from "react";
import * as api from "@/lib/api";
import type { Locale, MessageKey } from "@/i18n";
import {
  formatMediaLoadErrorMessage,
  mediaLoadErrorLabelMap,
  resolveMediaLoadError,
} from "@/lib/mediaLoadPro";
import { HtmlBrowser } from "@/components/HtmlBrowser";
import { MarkdownBody } from "@/components/MarkdownBody";
import { OverlayScroll } from "@/components/OverlayScroll";
import { ImageUi } from "@/components/ImageUi";
import { revealInOsLabel } from "@/lib/appPlatform";
import {
  IconCheck,
  IconClose,
  IconCopy,
  IconEdit,
  IconExternalLink,
  IconFiles,
  IconFolder,
  IconChat,
  IconRewind,
} from "@/components/icons";
import { isOfficeKind } from "@/lib/filePreviewSrc";
import { Tip } from "@/components/ui/tooltip";
import { normalizePath } from "@/lib/sessionChanges";
import { formatHunkSnippet } from "@/lib/diffComment";
import {
  diffActionTip,
  planFileActionGates,
  planHunkActionGates,
  type UnifiedHunk,
} from "@/lib/diffAccept";
import {
  isResourceDraftDirty,
  isResourceTextEditable,
} from "@/lib/resourceEdit";
import type { DiffLayout, DiffViewState, FileTab, SideMode } from "./types";
import { formatSize, guessOfficeKind } from "./helpers";

const MarkdownTiptapEditor = lazy(async () => {
  const m = await import("@/components/MarkdownTiptapEditor");
  return { default: m.MarkdownTiptapEditor };
});
const FileMediaPlayer = lazy(async () => {
  const m = await import("@/components/FileMediaPlayer");
  return { default: m.FileMediaPlayer };
});
const OfficeDocumentPreview = lazy(async () => {
  const m = await import("@/components/OfficeDocumentPreview");
  return { default: m.OfficeDocumentPreview };
});
const CodePreview = lazy(async () => {
  const m = await import("@/components/CodePreview");
  return { default: m.CodePreview };
});
const CodeFileEditor = lazy(async () => {
  const m = await import("@/components/CodeFileEditor");
  return { default: m.CodeFileEditor };
});

export type ResourcePreviewBodyProps = {
  tr: (key: MessageKey, vars?: Record<string, string>) => string;
  locale: Locale;
  sideMode: SideMode;
  diffView: DiffViewState | null;
  diffLayout: DiffLayout;
  setDiffLayout: (v: DiffLayout) => void;
  activeTab: FileTab | null;
  projectPath: string | null;
  pathCopyFlash: boolean;
  diffDecisionByPath: Record<string, "accepted" | "rejected">;
  restorableAfterByPath: Record<string, string>;
  diffActionBusy: boolean;
  /** Workspace git probe available (reject prefers checkout). */
  workspaceAvailable?: boolean;
  diffHunks: UnifiedHunk[];
  remainingHunkCount: number;
  onDiffCommentToChat?: (prompt: string) => void;
  setDiffCommentError: (
    v: "empty" | "too_long" | "no_path" | "no_snippet" | null,
  ) => void;
  setDiffCommentNote: (v: string) => void;
  setDiffCommentTarget: (
    v: {
      path: string;
      name: string;
      hunkIndex: number;
      hunkHeader: string;
      hunkSnippet: string;
    } | null,
  ) => void;
  openChangeInEditor: (path: string) => void;
  openChangeInPane: (path: string) => void;
  revealChangePath: (path: string) => void;
  copyChangePath: (path: string) => void;
  updateActiveDraft: (text: string) => void;
  saveActiveFile: (opts?: { force?: boolean }) => void | Promise<void>;
  revertActiveDraft: () => void;
  toggleActiveEditMode: () => void;
  runAcceptFile: (path: string, afterOverride?: string | null) => void | Promise<void>;
  requestRejectFile: (path: string) => void;
  runRestoreFile: (path: string) => void | Promise<void>;
  runAcceptHunk: (hunkIndex: number) => void | Promise<void>;
  runRejectHunk: (hunkIndex: number) => void | Promise<void>;
  requestBatchAcceptHunks: () => void;
  requestBatchRejectHunks: () => void;
};

export function ResourcePreviewBody({
  tr,
  locale,
  sideMode,
  diffView,
  diffLayout,
  setDiffLayout,
  activeTab,
  projectPath,
  pathCopyFlash,
  diffDecisionByPath,
  restorableAfterByPath,
  diffActionBusy,
  workspaceAvailable = false,
  diffHunks,
  remainingHunkCount,
  onDiffCommentToChat,
  setDiffCommentError,
  setDiffCommentNote,
  setDiffCommentTarget,
  openChangeInEditor,
  openChangeInPane,
  revealChangePath,
  copyChangePath,
  updateActiveDraft,
  saveActiveFile,
  revertActiveDraft,
  toggleActiveEditMode,
  runAcceptFile,
  requestRejectFile,
  runRestoreFile,
  runAcceptHunk,
  runRejectHunk,
  requestBatchAcceptHunks,
  requestBatchRejectHunks,
}: ResourcePreviewBodyProps): ReactNode {
  // Session / workspace change diff takes over the preview in Changes mode.
  if (sideMode === "changes" && diffView) {
    if (diffView.loading) {
      return (
        <div className="rp-preview__msg">{tr("changes.loadingDiff")}</div>
      );
    }

    const srcLabel =
      diffView.source === "git"
        ? tr("changes.sourceGit")
        : diffView.source === "head"
          ? tr("changes.sourceHead")
          : diffView.source === "payload"
            ? tr("changes.sourcePayload")
            : diffView.source === "after"
              ? tr("changes.sourceAfter")
              : null;
    const hasSplitSides =
      typeof diffView.beforeText === "string" &&
      typeof diffView.afterText === "string";
    const showSplit = diffLayout === "split" && hasSplitSides;

    const pathKey = normalizePath(diffView.path);
    const decision = pathKey ? diffDecisionByPath[pathKey] : undefined;
    const afterSnapshot =
      (pathKey && typeof restorableAfterByPath[pathKey] === "string"
        ? restorableAfterByPath[pathKey]
        : null) ??
      (typeof diffView.afterText === "string" ? diffView.afterText : null);
    const beforeSnapshot =
      typeof diffView.beforeText === "string" ? diffView.beforeText : null;
    const fileGates = planFileActionGates({
      hasProject: !!projectPath,
      isTauri: api.isTauri(),
      busy: diffActionBusy,
      hasGitRepo: workspaceAvailable,
      after: afterSnapshot,
      before: beforeSnapshot,
      decision: decision ?? null,
    });
    const hunkGates = planHunkActionGates({
      hasProject: !!projectPath,
      isTauri: api.isTauri(),
      busy: diffActionBusy,
      hunkCount: diffHunks.length,
      remainingCount: remainingHunkCount,
      before: beforeSnapshot,
      after: afterSnapshot,
    });
    const acceptTip = diffActionTip(fileGates.accept, "changes.acceptTip");
    const rejectTip = diffActionTip(fileGates.reject, "changes.rejectTip");
    const restoreTip = diffActionTip(fileGates.restore, "changes.restoreTip");

    const toolbar = (
      <div className="rp-diff-toolbar" role="toolbar" aria-label={tr("changes.title")}>
        <span className="rp-diff-toolbar__name" title={diffView.path}>
          {diffView.name}
        </span>
        {srcLabel ? (
          <span className="rp-diff-toolbar__source">{srcLabel}</span>
        ) : null}
        {decision === "accepted" ? (
          <span className="rp-diff-toolbar__decision is-accept">
            {tr("changes.acceptDone")}
          </span>
        ) : null}
        {decision === "rejected" ? (
          <span className="rp-diff-toolbar__decision is-reject">
            {tr("changes.rejectDone")}
          </span>
        ) : null}
        <span className="rp-diff-toolbar__spacer" />
        {hasSplitSides ? (
          <div className="rp-diff-toolbar__toggle" role="group">
            <button
              type="button"
              className={
                "rp-diff-toolbar__btn" +
                (diffLayout === "unified" ? " is-active" : "")
              }
              aria-pressed={diffLayout === "unified"}
              onClick={() => setDiffLayout("unified")}
            >
              {tr("changes.viewUnified")}
            </button>
            <button
              type="button"
              className={
                "rp-diff-toolbar__btn" +
                (diffLayout === "split" ? " is-active" : "")
              }
              aria-pressed={diffLayout === "split"}
              onClick={() => setDiffLayout("split")}
            >
              {tr("changes.viewSplit")}
            </button>
          </div>
        ) : null}
        <div className="rp-diff-toolbar__actions" role="group">
          <Tip label={tr(acceptTip.messageKey as MessageKey)}>
            <button
              type="button"
              className="chrome-btn rp-diff-action rp-diff-action--accept"
              disabled={fileGates.accept.disabled}
              onClick={() => void runAcceptFile(diffView.path)}
              aria-label={tr("changes.accept")}
              data-testid="changes-accept"
            >
              <IconCheck size={14} />
            </button>
          </Tip>
          <Tip label={tr(rejectTip.messageKey as MessageKey)}>
            <button
              type="button"
              className="chrome-btn rp-diff-action rp-diff-action--reject"
              disabled={fileGates.reject.disabled}
              onClick={() => requestRejectFile(diffView.path)}
              aria-label={tr("changes.reject")}
              data-testid="changes-reject"
            >
              <IconClose size={14} />
            </button>
          </Tip>
          <Tip label={tr(restoreTip.messageKey as MessageKey)}>
            <button
              type="button"
              className="chrome-btn rp-diff-action rp-diff-action--restore"
              disabled={fileGates.restore.disabled}
              onClick={() => void runRestoreFile(diffView.path)}
              aria-label={tr("changes.restore")}
              data-testid="changes-restore"
            >
              <IconRewind size={14} />
            </button>
          </Tip>
        </div>
        <Tip label={tr("changes.openFile")}>
          <button
            type="button"
            className="chrome-btn"
            onClick={() => openChangeInPane(diffView.path)}
            aria-label={tr("changes.openFile")}
          >
            <IconFiles size={14} />
          </button>
        </Tip>
        <Tip label={tr("changes.openInEditor")}>
          <button
            type="button"
            className="chrome-btn"
            onClick={() => void openChangeInEditor(diffView.path)}
            aria-label={tr("changes.openInEditor")}
          >
            <IconExternalLink size={14} />
          </button>
        </Tip>
        <Tip label={tr("changes.reveal")}>
          <button
            type="button"
            className="chrome-btn"
            onClick={() => void revealChangePath(diffView.path)}
            aria-label={tr("changes.reveal")}
          >
            <IconFolder size={14} />
          </button>
        </Tip>
        <Tip label={pathCopyFlash ? tr("changes.pathCopied") : tr("changes.copyPath")}>
          <button
            type="button"
            className="chrome-btn"
            onClick={() => void copyChangePath(diffView.path)}
            aria-label={tr("changes.copyPath")}
          >
            <IconCopy size={14} />
          </button>
        </Tip>
      </div>
    );

    const hunkAcceptTip = diffActionTip(
      hunkGates.accept,
      "changes.acceptHunkTip",
    );
    const hunkRejectTip = diffActionTip(
      hunkGates.reject,
      "changes.rejectHunkTip",
    );
    const hunkAcceptAllTip = diffActionTip(
      hunkGates.acceptAll,
      "changes.acceptAllHunksTip",
    );
    const hunkRejectAllTip = diffActionTip(
      hunkGates.rejectAll,
      "changes.rejectAllHunksTip",
    );

    // Show hunk bar whenever we have parseable hunks so disabled reasons
    // surface when before/after snapshots are missing (honest residual).
    const hunkBar =
      diffHunks.length > 0 ? (
        <div
          className="rp-diff-hunks"
          role="toolbar"
          aria-label={tr("changes.hunks")}
        >
          <span className="rp-diff-hunks__label">{tr("changes.hunks")}</span>
          {remainingHunkCount > 1 ? (
            <div className="rp-diff-hunks__batch" role="group">
              <Tip label={tr(hunkAcceptAllTip.messageKey as MessageKey)}>
                <button
                  type="button"
                  className="chrome-btn rp-diff-action rp-diff-action--accept rp-changes-batch-btn"
                  disabled={hunkGates.acceptAll.disabled}
                  data-testid="changes-accept-all-hunks"
                  onClick={() => requestBatchAcceptHunks()}
                  aria-label={tr("changes.acceptAllHunks")}
                >
                  <IconCheck size={12} />
                  <span>{tr("changes.acceptAllRemainingShort")}</span>
                </button>
              </Tip>
              <Tip label={tr(hunkRejectAllTip.messageKey as MessageKey)}>
                <button
                  type="button"
                  className="chrome-btn rp-diff-action rp-diff-action--reject rp-changes-batch-btn"
                  disabled={hunkGates.rejectAll.disabled}
                  data-testid="changes-reject-all-hunks"
                  onClick={() => requestBatchRejectHunks()}
                  aria-label={tr("changes.rejectAllHunks")}
                >
                  <IconClose size={12} />
                  <span>{tr("changes.rejectAllRemainingShort")}</span>
                </button>
              </Tip>
            </div>
          ) : null}
          {diffHunks.map((h, idx) => (
            <div key={`${h.header}-${idx}`} className="rp-diff-hunks__row">
              <span className="rp-diff-hunks__name" title={h.header}>
                {tr("changes.hunkLabel", { n: String(idx + 1) })}
              </span>
              <Tip label={tr(hunkAcceptTip.messageKey as MessageKey)}>
                <button
                  type="button"
                  className="chrome-btn rp-diff-action rp-diff-action--accept"
                  disabled={hunkGates.accept.disabled}
                  onClick={() => void runAcceptHunk(idx)}
                  aria-label={tr("changes.acceptHunk")}
                >
                  <IconCheck size={12} />
                </button>
              </Tip>
              <Tip label={tr(hunkRejectTip.messageKey as MessageKey)}>
                <button
                  type="button"
                  className="chrome-btn rp-diff-action rp-diff-action--reject"
                  disabled={hunkGates.reject.disabled}
                  onClick={() => void runRejectHunk(idx)}
                  aria-label={tr("changes.rejectHunk")}
                >
                  <IconClose size={12} />
                </button>
              </Tip>
              {onDiffCommentToChat ? (
                <Tip label={tr("changes.commentTip")}>
                  <button
                    type="button"
                    className="chrome-btn rp-diff-action rp-diff-action--comment"
                    data-testid={`changes-comment-hunk-${idx}`}
                    onClick={() => {
                      setDiffCommentError(null);
                      setDiffCommentNote("");
                      setDiffCommentTarget({
                        path: diffView.path,
                        name: diffView.name,
                        hunkIndex: idx,
                        hunkHeader: h.header,
                        hunkSnippet: formatHunkSnippet(h),
                      });
                    }}
                    aria-label={tr("changes.comment")}
                  >
                    <IconChat size={12} />
                  </button>
                </Tip>
              ) : null}
            </div>
          ))}
        </div>
      ) : null;

    if (showSplit) {
      return (
        <div className="rp-diff-host">
          {toolbar}
          {hunkBar}
          <div className="rp-diff-split">
            <div className="rp-diff-split__pane">
              <div className="rp-diff-split__label">
                {tr("changes.split.before")}
              </div>
                            <Suspense fallback={null}>
                <CodePreview
                code={diffView.beforeText ?? ""}
                fileName={diffView.name}
                className="rp-diff-split__code"
                />              </Suspense>
            </div>
            <div className="rp-diff-split__pane">
              <div className="rp-diff-split__label">
                {tr("changes.split.after")}
              </div>
                            <Suspense fallback={null}>
                <CodePreview
                code={diffView.afterText ?? ""}
                fileName={diffView.name}
                className="rp-diff-split__code"
                />              </Suspense>
            </div>
          </div>
        </div>
      );
    }

    if (diffView.unified) {
      return (
        <div className="rp-diff-host">
          {toolbar}
          {hunkBar}
                    <Suspense fallback={null}>
            <CodePreview
            code={diffView.unified}
            fileName={`${diffView.name}.diff`}
            language="diff"
            footer={srcLabel}
            />          </Suspense>
        </div>
      );
    }
    if (diffView.afterOnly) {
      return (
        <div className="rp-diff-host">
          {toolbar}
                    <Suspense fallback={null}>
            <CodePreview
            code={diffView.afterOnly}
            fileName={diffView.name}
            footer={tr("changes.afterOnly")}
            />          </Suspense>
        </div>
      );
    }
    return (
      <div className="rp-changes-empty">
        <div className="rp-changes-empty__title">{tr("changes.noDiff")}</div>
        <div className="rp-changes-empty__hint">{tr("changes.noDiffHint")}</div>
        <div className="rp-changes-empty__actions">
          <button
            type="button"
            className="rp-tool-btn"
            onClick={() => openChangeInPane(diffView.path)}
          >
            <IconFiles size={14} />
            <span className="rp-tool-btn__label">
              {tr("changes.openFile")}
            </span>
          </button>
          <button
            type="button"
            className="rp-tool-btn"
            onClick={() => void openChangeInEditor(diffView.path)}
          >
            <IconExternalLink size={14} />
            <span className="rp-tool-btn__label">
              {tr("changes.openInEditor")}
            </span>
          </button>
          <button
            type="button"
            className="rp-tool-btn"
            onClick={() => void revealChangePath(diffView.path)}
          >
            <IconFolder size={14} />
            <span className="rp-tool-btn__label">{tr("changes.reveal")}</span>
          </button>
          <button
            type="button"
            className="rp-tool-btn"
            onClick={() => void copyChangePath(diffView.path)}
          >
            <IconCopy size={14} />
            <span className="rp-tool-btn__label">
              {pathCopyFlash
                ? tr("changes.pathCopied")
                : tr("changes.copyPath")}
            </span>
          </button>
        </div>
      </div>
    );
  }

  // URL tabs render via EmbeddedBrowser below (native Webview host).
  // Keep other kinds here so useMemo deps stay correct.
  if (activeTab?.tabKind === "url" && activeTab.url) {
    return null;
  }
  const preview = activeTab?.preview;
  if (!preview) {
    if (activeTab?.error) {
      return <div className="rp-preview__msg">{activeTab.error}</div>;
    }
    return null;
  }
  if (preview.error && !preview.text && !preview.base64 && !preview.stream) {
    // Soft-fail: classified media.err.* copy instead of raw host dumps.
    const resolved = resolveMediaLoadError(preview.error, "preview");
    return (
      <div className="rp-preview__msg">
        {formatMediaLoadErrorMessage(resolved, tr)}
      </div>
    );
  }
  const mediaSrc = activeTab?.mediaSrc ?? null;
  const dataUrl =
    preview.base64 && preview.mime
      ? `data:${preview.mime};base64,${preview.base64}`
      : null;
  const src = mediaSrc || dataUrl;

  // Text editor shell: full-height pane + in-content toolbar (not chrome).
  // All editable kinds open in **preview** first (CodePreview highlight + line
  // numbers for code/json/text; rendered markdown for .md). Edit is a
  // highlighted CodeMirror for code, TipTap for markdown.
  const canEdit = isResourceTextEditable({
    kind: preview.kind,
    text: activeTab?.baselineText ?? preview.text,
    truncated: preview.truncated,
    error: preview.error,
  });
  if (canEdit && activeTab && activeTab.draftText != null) {
    const draftText = activeTab.draftText;
    const isMarkdown = preview.kind === "markdown";
    const isHtml = preview.kind === "html";
    const showEditor = !!activeTab.editMode;
    const dirty = isResourceDraftDirty(draftText, activeTab.baselineText);

    const codePreviewBody = (() => {
      if (preview.kind === "json") {
        try {
          return JSON.stringify(JSON.parse(draftText || "{}"), null, 2);
        } catch {
          return draftText;
        }
      }
      return draftText;
    })();

    return (
      <div className="rp-editor">
        <div
          className="rp-editor__toolbar"
          role="toolbar"
          aria-label={tr("resources.editorToolbar")}
        >
          <Tip
            label={
              activeTab.editMode
                ? tr("resources.previewMode")
                : tr("resources.editMode")
            }
          >
            <button
              type="button"
              className={
                "rp-editor__tool-btn" +
                (activeTab.editMode ? " is-on" : "")
              }
              disabled={!!activeTab.saving}
              onClick={toggleActiveEditMode}
              aria-pressed={!!activeTab.editMode}
              aria-label={
                activeTab.editMode
                  ? tr("resources.previewMode")
                  : tr("resources.editMode")
              }
            >
              <IconEdit size={14} />
              <span className="rp-editor__tool-btn-label">
                {activeTab.editMode
                  ? tr("resources.previewMode")
                  : tr("resources.editMode")}
              </span>
            </button>
          </Tip>
          <div className="rp-editor__toolbar-spacer" />
          {dirty ? (
            <Tip label={tr("resources.revert")}>
              <button
                type="button"
                className="rp-editor__tool-btn"
                disabled={!!activeTab.saving}
                onClick={() => revertActiveDraft()}
              >
                {tr("resources.revert")}
              </button>
            </Tip>
          ) : null}
          <Tip label={tr("resources.save")}>
            <button
              type="button"
              className={
                "rp-editor__tool-btn rp-editor__tool-btn--save" +
                (dirty ? " is-dirty" : "")
              }
              disabled={!!activeTab.saving || !dirty}
              onClick={() => void saveActiveFile()}
            >
              {activeTab.saving
                ? tr("resources.saving")
                : tr("resources.save")}
            </button>
          </Tip>
          {dirty ? (
            <span className="rp-editor__dirty-label" role="status">
              {tr("resources.unsaved")}
            </span>
          ) : null}
        </div>
        {preview.truncated ? (
          <div className="rp-editor__banner" role="status">
            {tr("resources.truncated")}
          </div>
        ) : null}
        {showEditor ? (
          isMarkdown ? (
            <Suspense fallback={null}>
              <MarkdownTiptapEditor
                key={activeTab.id}
                value={draftText}
                onChange={updateActiveDraft}
                onSave={() => void saveActiveFile()}
                disabled={!!activeTab.saving}
                labels={{
                  bold: tr("resources.mdFmt.bold"),
                  italic: tr("resources.mdFmt.italic"),
                  strike: tr("resources.mdFmt.strike"),
                  code: tr("resources.mdFmt.code"),
                  h1: tr("resources.mdFmt.h1"),
                  h2: tr("resources.mdFmt.h2"),
                  h3: tr("resources.mdFmt.h3"),
                  bulletList: tr("resources.mdFmt.bulletList"),
                  orderedList: tr("resources.mdFmt.orderedList"),
                  blockquote: tr("resources.mdFmt.blockquote"),
                  link: tr("resources.mdFmt.link"),
                  hr: tr("resources.mdFmt.hr"),
                  linkPlaceholder: tr("resources.mdFmt.linkPlaceholder"),
                  linkApply: tr("resources.mdFmt.linkApply"),
                  placeholder: tr("resources.mdFmt.placeholder"),
                  editorAria: tr("resources.editorAria", {
                    name: preview.name,
                  }),
                }}
              />
            </Suspense>
          ) : (
            <Suspense fallback={null}>
              <CodeFileEditor
                key={activeTab.id}
                value={draftText}
                fileName={preview.name}
                language={preview.kind === "json" ? "json" : undefined}
                onChange={updateActiveDraft}
                onSave={() => void saveActiveFile()}
                disabled={!!activeTab.saving}
                ariaLabel={tr("resources.editorAria", { name: preview.name })}
              />
            </Suspense>
          )
        ) : isMarkdown ? (
          <OverlayScroll className="rp-editor__preview-scroll">
            <div className="rp-editor__preview-body rp-preview__md">
              <MarkdownBody>
                {draftText || preview.text || ""}
              </MarkdownBody>
            </div>
          </OverlayScroll>
        ) : isHtml ? (
          <HtmlBrowser
            title={preview.name}
            absolutePath={preview.absolutePath || null}
            html={draftText || preview.text}
          />
        ) : (
          <div className="rp-editor__code-preview">
            <Suspense fallback={null}>
              <CodePreview
                code={codePreviewBody}
                fileName={preview.name}
                language={preview.kind === "json" ? "json" : undefined}
                focusLine={activeTab.focusLine}
                footer={
                  preview.truncated ? tr("resources.truncated") : null
                }
              />
            </Suspense>
          </div>
        )}
      </div>
    );
  }

  // Word / Excel / PDF rich preview
  if (
    isOfficeKind(preview.kind) &&
    preview.absolutePath &&
    preview.kind !== "image"
  ) {
    return (
            <Suspense fallback={null}>
        <OfficeDocumentPreview
        kind={preview.kind === "office" ? guessOfficeKind(preview.name) : preview.kind}
        absolutePath={preview.absolutePath}
        name={preview.name}
        locale={locale}
        textFallback={preview.text}
        errorFromHost={preview.error}
        embedded
        />      </Suspense>
    );
  }

  switch (preview.kind) {
    case "image":
      // Render SVG via <img>/media URL so the webview image sandbox blocks scripts.
      return src ? (
        <ImageUi
          layout="pane"
          className="rp-preview__img"
          src={src}
          alt={preview.name}
          path={preview.absolutePath || undefined}
          labels={{
            viewImage: tr("image.view"),
            copyImage: tr("image.copy"),
            reveal: revealInOsLabel(tr),
            copyPath: tr("attach.copyPath"),
            loadFailed: tr("media.err.other"),
            loadFailedByKind: mediaLoadErrorLabelMap(tr),
          }}
        />
      ) : (
        <div className="rp-preview__msg">
          {preview.error
            ? formatMediaLoadErrorMessage(
                resolveMediaLoadError(preview.error, "preview"),
                tr,
              )
            : tr("media.err.mediaServerUnavailable")}
        </div>
      );
    case "pdf":
      // Handled above via OfficeDocumentPreview; keep iframe fallback
      return src ? (
        <iframe
          className="rp-preview__frame"
          title={preview.name}
          src={src}
        />
      ) : (
        <div className="rp-preview__msg">{tr("resources.binary")}</div>
      );
    case "audio":
    case "video":
      return src ? (
                <Suspense fallback={null}>
          <FileMediaPlayer
          kind={preview.kind}
          src={src}
          mime={preview.mime}
          title={preview.name}
          absolutePath={preview.absolutePath || undefined}
          labels={{
          loadError: tr("media.loadError"),
          openExternal: tr("media.openExternal"),
          loading: tr("resources.loading"),
          t: tr,
          }}
          />        </Suspense>
      ) : (
        <div className="rp-preview__msg">{tr("resources.binary")}</div>
      );
    case "markdown":
      return (
        <div className="rp-preview__md">
          <MarkdownBody>
            {activeTab?.draftText ?? preview.text ?? ""}
          </MarkdownBody>
        </div>
      );
    case "html":
      // Do not use file:// in iframe — WKWebView/Tauri blocks it (blank page).
      // HtmlBrowser uses srcDoc (host text) or asset fetch; scripts work, full-bleed.
      return (
        <HtmlBrowser
          title={preview.name}
          absolutePath={preview.absolutePath || null}
          html={preview.text}
        />
      );
    case "json": {
      let body = preview.text ?? "";
      try {
        body = JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        /* keep raw */
      }
      return (
                <Suspense fallback={null}>
          <CodePreview
          code={body}
          fileName={preview.name.endsWith(".json") ? preview.name : "data.json"}
          language="json"
          focusLine={activeTab?.focusLine}
          footer={
          preview.truncated ? tr("resources.truncated") : null
          }
          />        </Suspense>
      );
    }
    default:
      if (preview.text) {
        return (
                    <Suspense fallback={null}>
            <CodePreview
            code={preview.text}
            fileName={preview.name}
            focusLine={activeTab?.focusLine}
            footer={
            preview.truncated ? tr("resources.truncated") : null
            }
            />          </Suspense>
        );
      }
      return (
        <div className="rp-preview__msg">
          {preview.error
            ? formatMediaLoadErrorMessage(
                resolveMediaLoadError(preview.error, "preview"),
                tr,
              )
            : tr("resources.binary")}
          <div className="rp-preview__meta">
            {preview.name} · {formatSize(preview.size)}
          </div>
        </div>
      );
  }
}
