/**
 * Project rules dialog — list AGENTS.md / CLAUDE.md / .grok rules,
 * expand a row to edit with TipTap, save back to disk.
 */

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as api from "@/lib/api";
import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { OverlayScroll } from "@/components/OverlayScroll";
import { Tip } from "@/components/ui/tooltip";
import {
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconPlus,
  IconRefresh,
} from "@/components/icons";
import {
  isFsWriteConflict,
  isResourceDraftDirty,
} from "@/lib/resourceEdit";
import {
  filterProjectRulesList,
  presentProjectRulesSoftFail,
  projectRuleKindChipLetter,
  projectRuleKindLabelKey,
  summarizeProjectRules,
  validateProjectRuleDraft,
} from "@/lib/rulesPromptPro";

// TipTap only loads when a rule row is actually expanded for editing —
// keeps the 533KB tiptap vendor chunk out of the modal's own chunk.
const MarkdownTiptapEditor = lazy(async () => {
  const m = await import("@/components/MarkdownTiptapEditor");
  return { default: m.MarkdownTiptapEditor };
});

export type ProjectRulesModalProps = {
  open: boolean;
  onClose: () => void;
  projectPath: string | null;
  projectName?: string | null;
  locale: Locale;
};

type RuleRow = {
  name: string;
  relativePath: string;
  absolutePath: string;
  kind: string;
};

type DraftState = {
  relativePath: string;
  absolutePath: string;
  name: string;
  baselineText: string;
  draftText: string;
  mtimeMs: number | null;
  truncated: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
};

function normalizeRules(
  res: api.ProjectRulesListResult | api.ProjectRuleEntry[] | null | undefined,
): { rules: RuleRow[]; hasAgentsMd: boolean } {
  const list = Array.isArray(res)
    ? res
    : Array.isArray(res?.rules)
      ? res.rules
      : [];
  const rules: RuleRow[] = list
    .map((r) => {
      const relativePath = String(r.relativePath || r.path || "").trim();
      const absolutePath = String(r.absolutePath || "").trim();
      const name =
        String(r.name || "").trim() ||
        relativePath.split(/[/\\]/).pop() ||
        relativePath;
      const kind = String(r.kind || "").trim();
      return { name, relativePath, absolutePath, kind };
    })
    .filter((r) => r.relativePath || r.absolutePath);
  const hasAgentsMd = Array.isArray(res)
    ? rules.some((r) => r.kind === "agents_md")
    : Boolean(res?.hasAgentsMd);
  return { rules, hasAgentsMd };
}

export function ProjectRulesModal({
  open,
  onClose,
  projectPath,
  projectName = null,
  locale,
}: ProjectRulesModalProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [hasAgentsMd, setHasAgentsMd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const pendingAction = useRef<null | (() => void)>(null);
  const loadSeq = useRef(0);
  const contentSeq = useRef(0);

  const dirty = isResourceDraftDirty(draft?.draftText, draft?.baselineText);
  const draftValidation = useMemo(
    () =>
      validateProjectRuleDraft({
        draftText: draft?.draftText,
        baselineText: draft?.baselineText,
        truncated: draft?.truncated,
        loading: draft?.loading,
        saving: draft?.saving,
      }),
    [draft],
  );

  const ruleKindLabel = useCallback(
    (kind: string) => tr(projectRuleKindLabelKey(kind)),
    [tr],
  );

  const refreshRules = useCallback(async () => {
    if (!open) return;
    if (!projectPath || !api.isTauri()) {
      setRules([]);
      setHasAgentsMd(false);
      setLoading(false);
      const soft = presentProjectRulesSoftFail(null, {
        needProject: !projectPath,
        needTauri: Boolean(projectPath) && !api.isTauri(),
      });
      setListError(tr(soft.messageKey));
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    setListError(null);
    try {
      const res = await api.projectRulesList(projectPath);
      if (seq !== loadSeq.current) return;
      const parsed = normalizeRules(res);
      setRules(parsed.rules);
      setHasAgentsMd(parsed.hasAgentsMd);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setRules([]);
      setHasAgentsMd(false);
      const soft = presentProjectRulesSoftFail(e);
      setListError(
        soft.detail.trim()
          ? `${tr(soft.messageKey)}: ${soft.detail}`
          : tr(soft.messageKey),
      );
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [open, projectPath, tr]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setExpandedPath(null);
      setDraft(null);
      setHint(null);
      setListError(null);
      setDiscardOpen(false);
      setConflictOpen(false);
      pendingAction.current = null;
      return;
    }
    void refreshRules();
  }, [open, refreshRules]);

  const filteredRules = useMemo(
    () => filterProjectRulesList(rules, query),
    [rules, query],
  );

  const rulesSummary = useMemo(
    () => summarizeProjectRules(rules, hasAgentsMd),
    [rules, hasAgentsMd],
  );

  const loadRuleContent = useCallback(
    async (rule: RuleRow) => {
      if (!projectPath || !api.isTauri()) {
        const soft = presentProjectRulesSoftFail(null, {
          needProject: !projectPath,
          needTauri: Boolean(projectPath) && !api.isTauri(),
        });
        setDraft({
          relativePath: rule.relativePath,
          absolutePath: rule.absolutePath,
          name: rule.name,
          baselineText: "",
          draftText: "",
          mtimeMs: null,
          truncated: false,
          loading: false,
          saving: false,
          error: tr(soft.messageKey),
        });
        return;
      }
      const seq = ++contentSeq.current;
      setExpandedPath(rule.relativePath || rule.absolutePath);
      setDraft({
        relativePath: rule.relativePath,
        absolutePath: rule.absolutePath,
        name: rule.name,
        baselineText: "",
        draftText: "",
        mtimeMs: null,
        truncated: false,
        loading: true,
        saving: false,
        error: null,
      });
      try {
        let res: api.FsReadResult;
        const rel = rule.relativePath.trim();
        const abs = rule.absolutePath.trim();
        const underProject =
          !!rel &&
          !rel.startsWith("/") &&
          !/^[A-Za-z]:[\\/]/.test(rel);
        if (underProject) {
          res = await api.fsReadFile(projectPath, rel);
        } else if (abs) {
          res = await api.fsReadAbsolute(abs);
        } else {
          throw new Error(tr("rules.openFailed"));
        }
        if (seq !== contentSeq.current) return;
        const text = res.text ?? "";
        setDraft({
          relativePath: res.relativePath || rel,
          absolutePath: res.absolutePath || abs,
          name: res.name || rule.name,
          baselineText: text,
          draftText: text,
          mtimeMs:
            typeof res.mtimeMs === "number" && Number.isFinite(res.mtimeMs)
              ? res.mtimeMs
              : null,
          truncated: Boolean(res.truncated),
          loading: false,
          saving: false,
          error: res.error || null,
        });
      } catch (e) {
        if (seq !== contentSeq.current) return;
        const soft = presentProjectRulesSoftFail(e);
        setDraft({
          relativePath: rule.relativePath,
          absolutePath: rule.absolutePath,
          name: rule.name,
          baselineText: "",
          draftText: "",
          mtimeMs: null,
          truncated: false,
          loading: false,
          saving: false,
          error: soft.detail.trim()
            ? `${tr(soft.messageKey)}: ${soft.detail}`
            : tr(soft.messageKey),
        });
      }
    },
    [projectPath, tr],
  );

  const runOrConfirmDiscard = useCallback(
    (action: () => void) => {
      if (dirty) {
        pendingAction.current = action;
        setDiscardOpen(true);
        return;
      }
      action();
    },
    [dirty],
  );

  const selectRule = useCallback(
    (rule: RuleRow) => {
      const key = rule.relativePath || rule.absolutePath;
      if (expandedPath === key) {
        runOrConfirmDiscard(() => {
          setExpandedPath(null);
          setDraft(null);
        });
        return;
      }
      runOrConfirmDiscard(() => {
        void loadRuleContent(rule);
      });
    },
    [expandedPath, loadRuleContent, runOrConfirmDiscard],
  );

  const requestClose = useCallback(() => {
    runOrConfirmDiscard(() => {
      onClose();
    });
  }, [onClose, runOrConfirmDiscard]);

  const saveDraft = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!draft || draft.draftText == null) return;
      if (!api.isTauri()) {
        const soft = presentProjectRulesSoftFail(null, { needTauri: true });
        setDraft((d) =>
          d ? { ...d, error: tr(soft.messageKey) } : d,
        );
        return;
      }
      const pre = validateProjectRuleDraft({
        draftText: draft.draftText,
        baselineText: draft.baselineText,
        truncated: draft.truncated,
        loading: draft.loading,
        saving: draft.saving,
      });
      if (!opts?.force && !pre.canSave) {
        if (pre.truncated) {
          setDraft((d) =>
            d ? { ...d, error: tr("rules.truncatedReadonly") } : d,
          );
        }
        return;
      }
      if (
        !isResourceDraftDirty(draft.draftText, draft.baselineText) &&
        !opts?.force
      ) {
        return;
      }
      setDraft((d) => (d ? { ...d, saving: true, error: null } : d));
      try {
        const expected = opts?.force ? null : draft.mtimeMs;
        const underProject =
          !!projectPath &&
          !!draft.relativePath &&
          !draft.relativePath.startsWith("/") &&
          !/^[A-Za-z]:[\\/]/.test(draft.relativePath);
        let w: api.FsWriteResult;
        if (underProject && projectPath) {
          w = await api.fsWriteFile(
            projectPath,
            draft.relativePath,
            draft.draftText,
            expected,
          );
        } else if (draft.absolutePath) {
          w = await api.fsWriteAbsolute(
            draft.absolutePath,
            draft.draftText,
            expected,
          );
        } else {
          throw new Error(tr("resources.saveNoPath"));
        }
        const saved = draft.draftText;
        setDraft((d) =>
          d
            ? {
                ...d,
                saving: false,
                baselineText: saved,
                draftText: saved,
                mtimeMs: w.mtimeMs,
                absolutePath: w.absolutePath || d.absolutePath,
                error: null,
              }
            : d,
        );
        try {
          if (projectPath) {
            await api.projectRulesInvalidateSessions(projectPath);
          }
        } catch {
          /* soft — disk write already succeeded */
        }
        setHint(tr("rules.saved"));
      } catch (e) {
        if (isFsWriteConflict(e)) {
          setDraft((d) => (d ? { ...d, saving: false } : d));
          setConflictOpen(true);
          return;
        }
        const soft = presentProjectRulesSoftFail(e);
        setDraft((d) =>
          d
            ? {
                ...d,
                saving: false,
                error: soft.detail.trim()
                  ? `${tr(soft.messageKey)}: ${soft.detail}`
                  : tr(soft.messageKey),
              }
            : d,
        );
      }
    },
    [draft, projectPath, tr],
  );

  const revertDraft = useCallback(() => {
    setDraft((d) =>
      d
        ? {
            ...d,
            draftText: d.baselineText,
            error: null,
          }
        : d,
    );
  }, []);

  const ensureAgentsTemplate = useCallback(async () => {
    if (!projectPath || !api.isTauri()) {
      const soft = presentProjectRulesSoftFail(null, {
        needProject: !projectPath,
        needTauri: Boolean(projectPath) && !api.isTauri(),
      });
      setListError(tr(soft.messageKey));
      return;
    }
    setHint(null);
    try {
      const res = await api.projectRulesEnsureTemplate(projectPath);
      await refreshRules();
      try {
        await api.projectRulesInvalidateSessions(projectPath);
      } catch {
        /* soft */
      }
      if (res.created) {
        setHint(tr("rules.created"));
      } else {
        setHint(tr("rules.exists"));
      }
      const rel = String(res.relativePath || "AGENTS.md").trim();
      const abs = String(res.absolutePath || "").trim();
      const name = String(res.name || "AGENTS.md").trim();
      const kind = String(res.kind || "agents_md").trim();
      runOrConfirmDiscard(() => {
        void loadRuleContent({
          name,
          relativePath: rel,
          absolutePath: abs,
          kind,
        });
      });
    } catch (e) {
      const soft = presentProjectRulesSoftFail(e);
      setListError(
        soft.detail.trim()
          ? `${tr(soft.messageKey)}: ${soft.detail}`
          : tr(soft.messageKey),
      );
    }
  }, [loadRuleContent, projectPath, refreshRules, runOrConfirmDiscard, tr]);

  const revealRule = useCallback(
    async (rule: RuleRow) => {
      const p = (rule.absolutePath || rule.relativePath || "").trim();
      if (!p || !api.isTauri()) {
        if (!api.isTauri()) {
          setListError(tr("rules.needTauri"));
        }
        return;
      }
      try {
        await api.pathReveal(p);
      } catch (e) {
        const soft = presentProjectRulesSoftFail(e);
        setListError(
          soft.detail.trim()
            ? `${tr(soft.messageKey)}: ${soft.detail}`
            : tr(soft.messageKey),
        );
      }
    },
    [tr],
  );

  const title = projectName
    ? tr("rules.modalTitleNamed", { name: projectName })
    : tr("project.rules");

  const mdLabels = useMemo(
    () => ({
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
        name: draft?.name || tr("rules.title"),
      }),
    }),
    [draft?.name, tr],
  );

  return (
    <>
      <GlassModal
        open={open}
        onClose={requestClose}
        title={title}
        size="lg"
        className="project-rules-modal"
        bodyClassName="project-rules-modal__body"
        wrapBody
        closeLabel={tr("common.close")}
        closeOnOverlay={!dirty && !draft?.saving}
      >
        <div className="prm">
          <div className="prm__toolbar">
            <button
              type="button"
              className="btn btn--ghost prm__tool-btn"
              onClick={() => void ensureAgentsTemplate()}
              disabled={!projectPath || loading}
            >
              <IconPlus size={14} />
              <span>{tr("rules.createTemplate")}</span>
            </button>
            <div className="prm__toolbar-spacer" />
            <Tip label={tr("rules.refresh")}>
              <button
                type="button"
                className="chrome-btn"
                onClick={() => void refreshRules()}
                disabled={loading}
                aria-label={tr("rules.refresh")}
              >
                <IconRefresh size={14} />
              </button>
            </Tip>
          </div>

          <div className="prm__search">
            <input
              className="settings-input prm__search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr("rules.filterPh")}
              aria-label={tr("rules.filterPh")}
              spellCheck={false}
            />
          </div>

          {rulesSummary.total > 0 ? (
            <div className="prm__summary" aria-live="polite">
              <span className="prm__summary-count">
                {tr("rules.count", { n: String(rulesSummary.total) })}
              </span>
              {rulesSummary.hasAgentsMd ? (
                <span className="prm__summary-chip" data-kind="agents_md">
                  A · {tr("rules.kind.agents_md")}
                </span>
              ) : null}
              {rulesSummary.hasClaudeMd ? (
                <span className="prm__summary-chip" data-kind="claude_md">
                  C · {tr("rules.kind.claude_md")}
                </span>
              ) : null}
              {rulesSummary.hasGrokRules ? (
                <span className="prm__summary-chip" data-kind="grok_rules">
                  G · {tr("rules.kind.grok_rules")}
                </span>
              ) : null}
              {rulesSummary.hasNestedAgents ? (
                <span className="prm__summary-chip" data-kind="nested_agents">
                  N · {tr("rules.kind.nested_agents")}
                </span>
              ) : null}
            </div>
          ) : null}

          {hint ? (
            <div className="prm__hint" role="status">
              {hint}
            </div>
          ) : null}
          {listError ? (
            <div className="prm__error" role="alert">
              {listError}
            </div>
          ) : null}

          <OverlayScroll className="prm__list-scroll">
            {loading && rules.length === 0 ? (
              <div className="prm__empty">{tr("rules.loading")}</div>
            ) : filteredRules.length === 0 ? (
              <div className="prm__empty">
                <div>{tr("rules.empty")}</div>
                <div className="prm__empty-hint">{tr("rules.emptyHint")}</div>
              </div>
            ) : (
              <ul className="prm__list" role="list">
                {filteredRules.map((rule) => {
                  const key = rule.relativePath || rule.absolutePath;
                  const isOpen = expandedPath === key;
                  return (
                    <li
                      key={key}
                      className={"prm__item" + (isOpen ? " is-open" : "")}
                    >
                      <div className="prm__row">
                        <button
                          type="button"
                          className="prm__row-main"
                          onClick={() => selectRule(rule)}
                          title={rule.absolutePath || rule.relativePath}
                          aria-expanded={isOpen}
                        >
                          <span className="prm__chevron" aria-hidden>
                            {isOpen ? (
                              <IconChevronDown size={14} />
                            ) : (
                              <IconChevronRight size={14} />
                            )}
                          </span>
                          <span
                            className={
                              "prm__kind-chip prm__kind-chip--" +
                              ((rule.kind || "other").replace(/[^a-z0-9_]/gi, "") ||
                                "other")
                            }
                            aria-hidden
                          >
                            {projectRuleKindChipLetter(rule.kind)}
                          </span>
                          <span className="prm__row-meta">
                            <span className="prm__row-name">{rule.name}</span>
                            <span className="prm__row-path">
                              {rule.relativePath || rule.absolutePath}
                            </span>
                            <span className="prm__row-kind">
                              {ruleKindLabel(rule.kind)}
                            </span>
                          </span>
                        </button>
                        <div className="prm__row-actions">
                          <Tip label={tr("rules.reveal")}>
                            <button
                              type="button"
                              className="chrome-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                void revealRule(rule);
                              }}
                              aria-label={tr("rules.reveal")}
                            >
                              <IconFolder size={13} />
                            </button>
                          </Tip>
                        </div>
                      </div>

                      {isOpen && draft ? (
                        <div className="prm__editor">
                          <div
                            className="rp-editor__toolbar prm__editor-toolbar"
                            role="toolbar"
                            aria-label={tr("resources.editorToolbar")}
                          >
                            <span className="prm__editor-file">
                              {draft.name}
                              {dirty ? (
                                <span
                                  className="rp-editor__dirty-label"
                                  role="status"
                                >
                                  {tr("resources.unsaved")}
                                </span>
                              ) : null}
                            </span>
                            <div className="rp-editor__toolbar-spacer" />
                            {dirty ? (
                              <button
                                type="button"
                                className="rp-editor__tool-btn"
                                disabled={!!draft.saving || draft.loading}
                                onClick={revertDraft}
                              >
                                {tr("resources.revert")}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className={
                                "rp-editor__tool-btn rp-editor__tool-btn--save" +
                                (draftValidation.canSave ? " is-dirty" : "")
                              }
                              disabled={!draftValidation.canSave}
                              onClick={() => void saveDraft()}
                            >
                              {draft.saving
                                ? tr("resources.saving")
                                : tr("resources.save")}
                            </button>
                          </div>
                          {draft.truncated ? (
                            <div
                              className="rp-editor__banner prm__banner--warn"
                              role="status"
                            >
                              {tr("rules.truncatedReadonly")}
                            </div>
                          ) : null}
                          {draftValidation.emptyWarn ? (
                            <div
                              className="prm__banner prm__banner--warn"
                              role="status"
                            >
                              {tr("rules.draftEmptyWarn")}
                            </div>
                          ) : null}
                          {draft.error ? (
                            <div className="prm__error" role="alert">
                              {draft.error}
                            </div>
                          ) : null}
                          {draft.loading ? (
                            <div className="prm__empty">
                              {tr("rules.loading")}
                            </div>
                          ) : (
                            <div className="prm__editor-host">
                              <Suspense
                                fallback={
                                  <div className="prm__empty">
                                    {tr("rules.loading")}
                                  </div>
                                }
                              >
                                <MarkdownTiptapEditor
                                  key={
                                    draft.relativePath ||
                                    draft.absolutePath ||
                                    draft.name
                                  }
                                  value={draft.draftText}
                                  onChange={(md) =>
                                    setDraft((d) =>
                                      d
                                        ? {
                                            ...d,
                                            draftText: md,
                                            error: null,
                                          }
                                        : d,
                                    )
                                  }
                                  onSave={() => void saveDraft()}
                                  disabled={!!draft.saving || draft.truncated}
                                  labels={mdLabels}
                                />
                              </Suspense>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {!hasAgentsMd && rules.length > 0 ? (
              <div className="prm__empty-hint prm__empty-hint--footer">
                {tr("rules.noAgentsHint")}
              </div>
            ) : null}
          </OverlayScroll>
        </div>
      </GlassModal>

      <GlassModal
        open={discardOpen}
        onClose={() => {
          setDiscardOpen(false);
          pendingAction.current = null;
        }}
        title={tr("resources.discardTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setDiscardOpen(false);
                pendingAction.current = null;
              }}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => {
                const action = pendingAction.current;
                pendingAction.current = null;
                setDiscardOpen(false);
                setDraft(null);
                setExpandedPath(null);
                action?.();
              }}
            >
              {tr("resources.discardConfirm")}
            </button>
          </>
        }
      >
        <p className="rp-modal-copy">{tr("resources.discardBody")}</p>
      </GlassModal>

      <GlassModal
        open={conflictOpen}
        onClose={() => setConflictOpen(false)}
        title={tr("resources.conflictTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setConflictOpen(false);
                if (draft) {
                  const rule: RuleRow = {
                    name: draft.name,
                    relativePath: draft.relativePath,
                    absolutePath: draft.absolutePath,
                    kind: "",
                  };
                  void loadRuleContent(rule);
                }
              }}
            >
              {tr("resources.conflictReload")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => {
                setConflictOpen(false);
                void saveDraft({ force: true });
              }}
            >
              {tr("resources.conflictOverwrite")}
            </button>
          </>
        }
      >
        <p className="rp-modal-copy">{tr("resources.conflictBody")}</p>
      </GlassModal>
    </>
  );
}
