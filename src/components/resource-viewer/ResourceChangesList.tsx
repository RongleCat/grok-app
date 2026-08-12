/**
 * Changes side-list — session tool edits + workspace git rows.
 */

import type { RefObject } from "react";
import type { MessageKey } from "@/i18n";
import * as api from "@/lib/api";
import {
  IconCheck,
  IconClose,
  IconCopy,
  IconExternalLink,
  IconFiles,
  IconFolder,
  IconUpload,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import {
  changeListKey,
  normalizePath,
  pathRelativeToProject,
  sessionFileLineDelta,
  type SessionFileChange,
} from "@/lib/sessionChanges";
import {
  resolveWorkspaceAbsolutePath,
  workspaceGitKindBadge,
  type WorkspaceGitFile,
  type WorkspaceGitKind,
} from "@/lib/workspaceGit";
import {
  resolveSessionSectionEmpty,
  resolveWorkspaceSectionEmpty,
  type ChangesKindFilter,
} from "@/lib/resourceChangesHonesty";
import { diffActionTip, planFileActionGates } from "@/lib/diffAccept";
import type { ChangeSelectionSource } from "./types";
import { FileKindMark } from "./FileKindMark";

export type ResourceChangesListProps = {
  tr: (key: MessageKey, vars?: Record<string, string>) => string;
  changesListRef: RefObject<HTMLDivElement | null>;
  projectPath: string | null;
  query: string;
  filteredChanges: SessionFileChange[];
  filteredWorkspace: WorkspaceGitFile[];
  changeCount: number;
  workspaceCount: number;
  workspaceFiles: WorkspaceGitFile[];
  workspaceLoading: boolean;
  workspaceAvailable: boolean;
  workspaceBranch: string | null;
  selectedChangeSource: ChangeSelectionSource | null;
  selectedChangePath: string | null;
  diffActionBusy: boolean;
  onShip?: () => void;
  changeStatusLabel: (status: string) => string;
  workspaceKindLabel: (kind: string) => string;
  workspaceUnavailableLabel: () => string;
  /** Optional second-line hint for unavailable workspace git. */
  workspaceUnavailableHint?: () => string | null;
  kindFilter?: ChangesKindFilter;
  onKindFilterChange?: (kind: ChangesKindFilter) => void;
  showKindFilters?: boolean;
  presentKindFilters?: WorkspaceGitKind[];
  workspaceKindCounts?: Record<WorkspaceGitKind, number>;
  loadChangeDiff: (c: SessionFileChange) => void;
  loadWorkspaceDiff: (w: WorkspaceGitFile) => void;
  runAcceptFile: (path: string, afterOverride?: string | null) => void;
  requestRejectFile: (path: string) => void;
  rememberRestorable: (path: string, after: string | null | undefined) => void;
  openChangeInPane: (path: string) => void;
  openChangeInEditor: (path: string) => void;
  revealChangePath: (path: string) => void;
  copyChangePath: (path: string) => void;
  requestBatchAcceptSession: () => void;
  requestBatchRejectSession: () => void;
};

function SectionEmpty({
  title,
  hint,
}: {
  title: string;
  hint?: string | null;
}) {
  return (
    <div
      className="rp-changes-empty rp-changes-section__empty"
      data-testid="changes-section-empty"
    >
      <div className="rp-changes-empty__title">{title}</div>
      {hint ? <div className="rp-changes-empty__hint">{hint}</div> : null}
    </div>
  );
}

export function ResourceChangesList({
  tr,
  changesListRef,
  projectPath,
  query,
  filteredChanges,
  filteredWorkspace,
  changeCount,
  workspaceCount,
  workspaceFiles,
  workspaceLoading,
  workspaceAvailable,
  workspaceBranch,
  selectedChangeSource,
  selectedChangePath,
  diffActionBusy,
  onShip,
  changeStatusLabel,
  workspaceKindLabel,
  workspaceUnavailableLabel,
  workspaceUnavailableHint,
  kindFilter = "all",
  onKindFilterChange,
  showKindFilters = false,
  presentKindFilters = [],
  workspaceKindCounts,
  loadChangeDiff,
  loadWorkspaceDiff,
  runAcceptFile,
  requestRejectFile,
  rememberRestorable,
  openChangeInPane,
  openChangeInEditor,
  revealChangePath,
  copyChangePath,
  requestBatchAcceptSession,
  requestBatchRejectSession,
}: ResourceChangesListProps) {
  const sessionEmpty = resolveSessionSectionEmpty({
    query,
    sessionCount: changeCount,
  });
  const workspaceEmpty = resolveWorkspaceSectionEmpty({
    query,
    kindFilter,
    workspaceCount,
    filteredCount: filteredWorkspace.length,
  });
  const unavailHint =
    typeof workspaceUnavailableHint === "function"
      ? workspaceUnavailableHint()
      : null;

  return (
    <div
      className="rp-changes-list"
      role="list"
      ref={changesListRef}
      tabIndex={0}
      aria-label={tr("changes.title")}
      data-testid="changes-list"
    >
      {/* ── Session (agent tool edits) ── */}
      <div className="rp-changes-section">
        <div className="rp-changes-section__head">
          <span className="rp-changes-section__title">
            {tr("changes.section.session")}
          </span>
          {changeCount > 0 ? (
            <span className="rp-changes-section__count">{changeCount}</span>
          ) : null}
          {changeCount > 0 ? (
            <div
              className="rp-changes-section__batch"
              role="group"
              aria-label={tr("changes.batchGroup")}
            >
              <Tip label={tr("changes.acceptAllRemainingTip")}>
                <button
                  type="button"
                  className="chrome-btn rp-diff-action rp-diff-action--accept rp-changes-batch-btn"
                  disabled={
                    !projectPath || !api.isTauri() || diffActionBusy
                  }
                  data-testid="changes-accept-all"
                  onClick={() => requestBatchAcceptSession()}
                  aria-label={tr("changes.acceptAllRemaining")}
                >
                  <IconCheck size={12} />
                  <span>{tr("changes.acceptAllRemainingShort")}</span>
                </button>
              </Tip>
              <Tip label={tr("changes.rejectAllRemainingTip")}>
                <button
                  type="button"
                  className="chrome-btn rp-diff-action rp-diff-action--reject rp-changes-batch-btn"
                  disabled={
                    !projectPath || !api.isTauri() || diffActionBusy
                  }
                  data-testid="changes-reject-all"
                  onClick={() => requestBatchRejectSession()}
                  aria-label={tr("changes.rejectAllRemaining")}
                >
                  <IconClose size={12} />
                  <span>{tr("changes.rejectAllRemainingShort")}</span>
                </button>
              </Tip>
            </div>
          ) : null}
        </div>

        {filteredChanges.length === 0 ? (
          <SectionEmpty
            title={tr(sessionEmpty.titleKey as MessageKey)}
            hint={
              sessionEmpty.hintKey
                ? tr(sessionEmpty.hintKey as MessageKey)
                : null
            }
          />
        ) : (
          filteredChanges.map((c) => {
            const active =
              selectedChangeSource === "session" &&
              selectedChangePath != null &&
              normalizePath(c.path) === normalizePath(selectedChangePath);
            const rel =
              pathRelativeToProject(c.path, projectPath) || c.path;
            const delta = sessionFileLineDelta(c);
            const rowGates = planFileActionGates({
              hasProject: !!projectPath,
              isTauri: api.isTauri(),
              busy: diffActionBusy,
              hasGitRepo: workspaceAvailable,
              after: typeof c.after === "string" ? c.after : null,
              before: typeof c.before === "string" ? c.before : null,
            });
            const acceptTip = diffActionTip(rowGates.accept, "changes.acceptTip");
            const rejectTip = diffActionTip(rowGates.reject, "changes.rejectTip");
            return (
              <div
                key={changeListKey("session", c.path)}
                className={
                  "rp-changes-row" + (active ? " is-active" : "")
                }
                role="listitem"
                aria-selected={active}
              >
                <button
                  type="button"
                  className="rp-changes-row__main"
                  title={c.path}
                  onClick={() => void loadChangeDiff(c)}
                >
                  <FileKindMark name={c.name} isDir={false} />
                  <span className="rp-changes-row__meta">
                    <span className="rp-changes-row__name-row">
                      <span className="rp-changes-row__name">{c.name}</span>
                      {delta ? (
                        <span
                          className="rp-changes-row__delta"
                          aria-label={tr("changes.lineDelta", {
                            a: String(delta.added),
                            d: String(delta.removed),
                          })}
                        >
                          <span className="rp-changes-row__add">
                            +{delta.added}
                          </span>
                          <span className="rp-changes-row__del">
                            −{delta.removed}
                          </span>
                        </span>
                      ) : null}
                    </span>
                    <span
                      className="rp-changes-row__path rp-changes-row__path--link"
                      title={tr("changes.openFile")}
                      onClick={(e) => {
                        e.stopPropagation();
                        openChangeInPane(c.path);
                      }}
                      data-testid="changes-path-link"
                    >
                      {rel}
                    </span>
                    <span className="rp-changes-row__kind">
                      {c.toolKind}
                      {c.status
                        ? ` · ${changeStatusLabel(c.status)}`
                        : ""}
                    </span>
                  </span>
                </button>
                <div className="rp-changes-row__actions">
                  <Tip label={tr(acceptTip.messageKey as MessageKey)}>
                    <button
                      type="button"
                      className="chrome-btn rp-diff-action rp-diff-action--accept"
                      disabled={rowGates.accept.disabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        void runAcceptFile(
                          c.path,
                          typeof c.after === "string" ? c.after : null,
                        );
                      }}
                      aria-label={tr("changes.accept")}
                    >
                      <IconCheck size={13} />
                    </button>
                  </Tip>
                  <Tip label={tr(rejectTip.messageKey as MessageKey)}>
                    <button
                      type="button"
                      className="chrome-btn rp-diff-action rp-diff-action--reject"
                      disabled={rowGates.reject.disabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (typeof c.after === "string") {
                          rememberRestorable(c.path, c.after);
                        }
                        requestRejectFile(c.path);
                      }}
                      aria-label={tr("changes.reject")}
                    >
                      <IconClose size={13} />
                    </button>
                  </Tip>
                  <Tip label={tr("changes.openFile")}>
                    <button
                      type="button"
                      className="chrome-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        openChangeInPane(c.path);
                      }}
                    >
                      <IconFiles size={13} />
                    </button>
                  </Tip>
                  <Tip label={tr("changes.openInEditor")}>
                    <button
                      type="button"
                      className="chrome-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void openChangeInEditor(c.path);
                      }}
                    >
                      <IconExternalLink size={13} />
                    </button>
                  </Tip>
                  <Tip label={tr("changes.reveal")}>
                    <button
                      type="button"
                      className="chrome-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void revealChangePath(c.path);
                      }}
                    >
                      <IconFolder size={13} />
                    </button>
                  </Tip>
                  <Tip label={tr("changes.copyPath")}>
                    <button
                      type="button"
                      className="chrome-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void copyChangePath(c.path);
                      }}
                    >
                      <IconCopy size={13} />
                    </button>
                  </Tip>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Workspace (git status) ── */}
      <div className="rp-changes-section">
        <div className="rp-changes-section__head">
          <span className="rp-changes-section__title">
            {tr("changes.section.workspace")}
          </span>
          {workspaceCount > 0 ? (
            <span className="rp-changes-section__count">
              {workspaceCount}
            </span>
          ) : null}
          {workspaceBranch ? (
            <span
              className="rp-changes-section__branch"
              title={tr("changes.workspace.branch", {
                branch: workspaceBranch,
              })}
            >
              {workspaceBranch}
            </span>
          ) : null}
          {onShip && workspaceAvailable && workspaceBranch ? (
            <Tip label={tr("composer.worktreeShipTip")}>
              <button
                type="button"
                className="chrome-btn rp-changes-section__ship"
                onClick={() => onShip()}
                aria-label={tr("composer.worktreeShip")}
                data-testid="changes-workspace-ship"
              >
                <IconUpload size={13} />
                <span>{tr("composer.worktreeShip")}</span>
              </button>
            </Tip>
          ) : null}
        </div>

        {workspaceAvailable &&
        showKindFilters &&
        onKindFilterChange &&
        presentKindFilters.length > 0 ? (
          <div
            className="rp-changes-kind-filters"
            role="tablist"
            aria-label={tr("changes.kindFilterLabel")}
            data-testid="changes-kind-filters"
          >
            <button
              type="button"
              role="tab"
              aria-selected={kindFilter === "all"}
              className={
                "rp-changes-kind-chip" +
                (kindFilter === "all" ? " is-active" : "")
              }
              onClick={() => onKindFilterChange("all")}
            >
              <span>{tr("changes.kindFilterAll")}</span>
              <span className="rp-changes-kind-chip__count">
                {workspaceFiles.length}
              </span>
            </button>
            {presentKindFilters.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kindFilter === k}
                className={
                  "rp-changes-kind-chip" +
                  (kindFilter === k ? " is-active" : "")
                }
                onClick={() => onKindFilterChange(k)}
              >
                <span>{workspaceKindLabel(k)}</span>
                <span className="rp-changes-kind-chip__count">
                  {workspaceKindCounts?.[k] ?? 0}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {workspaceLoading && workspaceFiles.length === 0 ? (
          <SectionEmpty title={tr("changes.workspace.loading")} />
        ) : !workspaceAvailable ? (
          <SectionEmpty
            title={workspaceUnavailableLabel()}
            hint={unavailHint}
          />
        ) : filteredWorkspace.length === 0 ? (
          <SectionEmpty
            title={tr(workspaceEmpty.titleKey as MessageKey)}
            hint={
              workspaceEmpty.hintKey
                ? tr(workspaceEmpty.hintKey as MessageKey)
                : null
            }
          />
        ) : (
          filteredWorkspace.map((w) => {
            const abs =
              normalizePath(w.absolutePath) ||
              resolveWorkspaceAbsolutePath(projectPath, w.path);
            const active =
              selectedChangeSource === "workspace" &&
              selectedChangePath != null &&
              (normalizePath(selectedChangePath) === abs ||
                normalizePath(selectedChangePath) ===
                  normalizePath(w.path));
            const wsGates = planFileActionGates({
              hasProject: !!projectPath,
              isTauri: api.isTauri(),
              busy: diffActionBusy,
              hasGitRepo: workspaceAvailable,
              kind: w.kind,
              after: null,
              before: null,
            });
            const wsAcceptTip = diffActionTip(wsGates.accept, "changes.acceptTip");
            const wsRejectTip = diffActionTip(wsGates.reject, "changes.rejectTip");
            return (
              <div
                key={changeListKey("workspace", abs || w.path)}
                className={
                  "rp-changes-row" + (active ? " is-active" : "")
                }
                role="listitem"
                aria-selected={active}
              >
                <button
                  type="button"
                  className="rp-changes-row__main"
                  title={abs || w.path}
                  onClick={() => void loadWorkspaceDiff(w)}
                >
                  <span
                    className={
                      "rp-changes-badge rp-changes-badge--" + w.kind
                    }
                    aria-hidden
                  >
                    {workspaceGitKindBadge(w.kind)}
                  </span>
                  <span className="rp-changes-row__meta">
                    <span className="rp-changes-row__name">{w.name}</span>
                    <span
                      className="rp-changes-row__path rp-changes-row__path--link"
                      title={tr("changes.openFile")}
                      onClick={(e) => {
                        e.stopPropagation();
                        openChangeInPane(abs || w.path);
                      }}
                      data-testid="changes-path-link"
                    >
                      {w.path}
                    </span>
                    <span className="rp-changes-row__kind">
                      {workspaceKindLabel(w.kind)}
                      {w.status.trim() ? ` · ${w.status}` : ""}
                    </span>
                  </span>
                </button>
                <div className="rp-changes-row__actions">
                  <Tip label={tr(wsAcceptTip.messageKey as MessageKey)}>
                    <button
                      type="button"
                      className="chrome-btn rp-diff-action rp-diff-action--accept"
                      disabled={wsGates.accept.disabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        void runAcceptFile(abs || w.path);
                      }}
                      aria-label={tr("changes.accept")}
                    >
                      <IconCheck size={13} />
                    </button>
                  </Tip>
                  <Tip label={tr(wsRejectTip.messageKey as MessageKey)}>
                    <button
                      type="button"
                      className="chrome-btn rp-diff-action rp-diff-action--reject"
                      disabled={wsGates.reject.disabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        requestRejectFile(abs || w.path);
                      }}
                      aria-label={tr("changes.reject")}
                    >
                      <IconClose size={13} />
                    </button>
                  </Tip>
                  <Tip label={tr("changes.openFile")}>
                    <button
                      type="button"
                      className="chrome-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        openChangeInPane(abs || w.path);
                      }}
                    >
                      <IconFiles size={13} />
                    </button>
                  </Tip>
                  <Tip label={tr("changes.openInEditor")}>
                    <button
                      type="button"
                      className="chrome-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void openChangeInEditor(abs || w.path);
                      }}
                    >
                      <IconExternalLink size={13} />
                    </button>
                  </Tip>
                  <Tip label={tr("changes.reveal")}>
                    <button
                      type="button"
                      className="chrome-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void revealChangePath(abs || w.path);
                      }}
                    >
                      <IconFolder size={13} />
                    </button>
                  </Tip>
                  <Tip label={tr("changes.copyPath")}>
                    <button
                      type="button"
                      className="chrome-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void copyChangePath(abs || w.path);
                      }}
                    >
                      <IconCopy size={13} />
                    </button>
                  </Tip>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
