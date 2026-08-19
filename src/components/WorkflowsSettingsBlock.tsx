/**
 * Settings → Runtime → Tools: workflows discovery + template create +
 * soft-fail headless run + local recent-run history.
 * No visual workflow editor; author via create-workflow skill / edit `.rhai`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { createT, intlLocale, type Locale, type MessageKey } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { Select } from "@/components/Select";
import {
  WORKFLOW_RUN_PROGRESS_EVENT,
  appendWorkflowRunLiveLog,
  formatDiscoveredWorkflowNames,
  formatWorkflowRunElapsed,
  formatWorkflowRunStatusLine,
  isValidWorkflowName,
  isWorkflowRunOk,
  prepareWorkflowRunLogForDisplay,
  resolveWorkflowRunCopyText,
  resolveWorkflowRunHonestyNote,
  resolveWorkflowRunLogDelivery,
  workflowRunLogDeliveryMessageKey,
  workflowRunReasonKey,
  type WorkflowDefLike,
  type WorkflowRunMode,
  type WorkflowRunProgressPayload,
  type WorkflowRunResultLike,
  type WorkflowScope,
} from "@/lib/workflows";
import {
  clearWorkflowRunHistory,
  filterWorkflowRunHistory,
  loadWorkflowRunHistory,
  planCreateWorkflow,
  recordWorkflowRunHistory,
  resolveWorkflowsAuthorEmptyState,
  sanitizeWorkflowName,
  workflowRunResultToHistoryOutcome,
  WORKFLOW_RUN_HISTORY_CHANGE_EVENT,
  type WorkflowCreateScope,
  type WorkflowRunHistoryFilter,
  type WorkflowRunHistoryRecord,
} from "@/lib/workflowsAuthor";

const RUN_REASON_KEYS: Record<string, MessageKey> = {
  ok: "settings.workflows.run.reason.ok",
  invalid_name: "settings.workflows.run.reason.invalid_name",
  cli_missing: "settings.workflows.run.reason.cli_missing",
  timeout: "settings.workflows.run.reason.timeout",
  spawn_failed: "settings.workflows.run.reason.spawn_failed",
  empty: "settings.workflows.run.reason.empty",
  nonzero_exit: "settings.workflows.run.reason.nonzero_exit",
  soft_fail: "settings.workflows.run.reason.soft_fail",
};

const EMPTY_LIST_KEYS: Record<string, MessageKey> = {
  no_workflows: "settings.workflows.empty.no_workflows",
  scan_soft_fail: "settings.workflows.empty.scan_soft_fail",
  browser_only: "settings.workflows.empty.browser_only",
  history_empty: "settings.workflows.empty.history_empty",
};

export type WorkflowsDiscoveryBlockProps = {
  locale: Locale;
  projectPath?: string | null;
  /** App session data mode — shared never rewrites `~/.grok`. */
  sessionDataMode?: string | null;
  showToast?: (msg: string, ms?: number) => void;
};

function asScope(raw: string): WorkflowScope {
  if (raw === "project" || raw === "agent_home") return raw;
  return "user";
}

type RunState = {
  name: string;
  mode: WorkflowRunMode;
  busy: boolean;
  result: WorkflowRunResultLike | null;
  error: string | null;
  /** Progressive headless log while busy (host `workflows://run-progress`). */
  liveLog: string;
  /** True when ≥1 host progress event was applied (honest live label). */
  sawProgress: boolean;
  /** Last elapsedMs from progress events. */
  elapsedMs: number;
};

function formatHistoryWhen(at: string, locale: Locale): string {
  try {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return at;
    return d.toLocaleString(intlLocale(locale));
  } catch {
    return at;
  }
}

export function WorkflowsDiscoveryBlock({
  locale,
  projectPath,
  sessionDataMode,
  showToast,
}: WorkflowsDiscoveryBlockProps) {
  const t = createT(locale);
  const [loading, setLoading] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowDefLike[]>([]);
  const [skillPath, setSkillPath] = useState<string | null>(null);
  const [userDir, setUserDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runState, setRunState] = useState<RunState | null>(null);

  // Create-from-template modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createScope, setCreateScope] = useState<WorkflowCreateScope>("user");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [overwriteTarget, setOverwriteTarget] = useState<{
    name: string;
    scope: WorkflowCreateScope;
  } | null>(null);

  // Recent runs
  const [history, setHistory] = useState<WorkflowRunHistoryRecord[]>(() =>
    loadWorkflowRunHistory(),
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFilter, setHistoryFilter] =
    useState<WorkflowRunHistoryFilter>("all");
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!api.isTauri()) {
      setWorkflows([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.workflowsList(projectPath);
      const rows: WorkflowDefLike[] = (res.workflows ?? []).map((w) => ({
        name: w.name,
        path: w.path,
        scope: asScope(w.scope),
      }));
      setWorkflows(rows);
      setSkillPath(res.createWorkflowSkill?.trim() || null);
      setUserDir(res.userDir?.trim() || null);
    } catch (e) {
      // Soft-fail: discovery is optional honesty, never block settings.
      setWorkflows([]);
      setError(String(e ?? "workflows_list failed"));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (Array.isArray(detail)) {
        setHistory(detail as WorkflowRunHistoryRecord[]);
      } else {
        setHistory(loadWorkflowRunHistory());
      }
    };
    window.addEventListener(WORKFLOW_RUN_HISTORY_CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener(WORKFLOW_RUN_HISTORY_CHANGE_EVENT, onChange);
    };
  }, []);

  const summary = formatDiscoveredWorkflowNames(workflows);
  const scopeLabels: Partial<Record<WorkflowScope, string>> = {
    project: t("settings.workflows.scope.project"),
    user: t("settings.workflows.scope.user"),
    agent_home: t("settings.workflows.scope.agentHome"),
  };

  const reasonLabel = (reason: string | null | undefined) => {
    const key = workflowRunReasonKey(reason);
    const msgKey = RUN_REASON_KEYS[key] ?? RUN_REASON_KEYS.soft_fail;
    return t(msgKey);
  };

  const listEmpty = resolveWorkflowsAuthorEmptyState({
    workflowCount: workflows.length,
    scanError: !!error,
    isDesktop: api.isTauri(),
    surface: "list",
  });
  const historyEmpty = resolveWorkflowsAuthorEmptyState({
    historyCount: history.length,
    isDesktop: api.isTauri(),
    surface: "history",
  });

  const filteredHistory = useMemo(
    () => filterWorkflowRunHistory(history, historyFilter),
    [history, historyFilter],
  );

  const namePreview = sanitizeWorkflowName(createName);
  // `userDir` from host is already `…/.grok/workflows`; plan user scope via
  // parent of that dir as GROK home (`…/.grok` → user home for resolveWorkflowDirs).
  const plannedUserHome = (() => {
    if (!userDir) return null;
    const trimmed = userDir.replace(/[/\\]+$/g, "");
    // strip `/workflows` then `/.grok` → user home
    const withoutWf = trimmed.replace(/[/\\]workflows$/i, "");
    const withoutGrok = withoutWf.replace(/[/\\]\.grok$/i, "");
    return withoutGrok || null;
  })();
  const createPlan = planCreateWorkflow({
    name: createName,
    scope: createScope,
    projectPath,
    userHome: plannedUserHome,
    isDesktop: api.isTauri(),
  });

  const canSubmitCreate =
    !!namePreview &&
    !createBusy &&
    api.isTauri() &&
    (createScope !== "project" || !!projectPath?.trim());

  const openSkill = async () => {
    if (!skillPath) {
      showToast?.(t("settings.workflows.docsMissing"), 2800);
      return;
    }
    try {
      await api.pathReveal(skillPath);
    } catch {
      showToast?.(t("settings.workflows.docsMissing"), 2800);
    }
  };

  const openUserDir = async () => {
    if (!userDir) return;
    try {
      await api.pathReveal(userDir);
    } catch {
      showToast?.(t("settings.workflows.dirMissing"), 2800);
    }
  };

  const revealPath = async (path: string) => {
    try {
      await api.pathReveal(path);
    } catch {
      showToast?.(t("settings.workflows.dirMissing"), 2800);
    }
  };

  const openInEditor = async (path: string) => {
    if (!api.isTauri()) return;
    try {
      await api.openInEditor({ path });
    } catch {
      try {
        await api.pathReveal(path);
      } catch {
        showToast?.(t("settings.workflows.dirMissing"), 2800);
      }
    }
  };

  const runWorkflow = async (name: string, mode: WorkflowRunMode) => {
    if (!api.isTauri()) {
      showToast?.(t("settings.workflows.run.desktopOnly"), 2800);
      return;
    }
    if (!isValidWorkflowName(name)) {
      setRunState({
        name,
        mode,
        busy: false,
        result: {
          ok: false,
          reason: "invalid_name",
          workflowName: name,
          mode,
        },
        error: null,
        liveLog: "",
        sawProgress: false,
        elapsedMs: 0,
      });
      recordWorkflowRunHistory({
        name,
        mode,
        outcome: "soft_fail",
        reason: "invalid_name",
        source: "settings",
      });
      return;
    }
    setRunState({
      name,
      mode,
      busy: true,
      result: null,
      error: null,
      liveLog: "",
      sawProgress: false,
      elapsedMs: 0,
    });
    let unlisten: (() => void) | undefined;
    try {
      if (api.isTauri()) {
        unlisten = await api.listen<WorkflowRunProgressPayload>(
          WORKFLOW_RUN_PROGRESS_EVENT,
          (p) => {
            if (!p) return;
            const wn = String(p.workflowName ?? "").trim();
            if (wn && wn !== name) return;
            setRunState((prev) => {
              if (!prev || !prev.busy || prev.name !== name) return prev;
              return {
                ...prev,
                liveLog: appendWorkflowRunLiveLog(prev.liveLog, p),
                sawProgress: true,
                elapsedMs:
                  typeof p.elapsedMs === "number" && p.elapsedMs >= 0
                    ? p.elapsedMs
                    : prev.elapsedMs,
              };
            });
          },
        );
      }
      const res = await api.workflowsRun({
        name,
        projectPath,
        mode,
      });
      const result: WorkflowRunResultLike = {
        ok: !!res.ok,
        reason: res.reason ?? (res.ok ? "ok" : "soft_fail"),
        workflowName: res.workflowName ?? name,
        mode: res.mode ?? mode,
        log: res.log ?? null,
        durationMs: res.durationMs ?? null,
        truncated: res.truncated ?? false,
        cliPath: res.cliPath ?? null,
        cliVersion: res.cliVersion ?? null,
      };
      setRunState((prev) => ({
        name,
        mode,
        busy: false,
        result,
        error: null,
        liveLog: prev?.liveLog ?? "",
        sawProgress: prev?.sawProgress ?? false,
        elapsedMs: result.durationMs ?? prev?.elapsedMs ?? 0,
      }));
      recordWorkflowRunHistory({
        name: result.workflowName ?? name,
        mode,
        outcome: workflowRunResultToHistoryOutcome(result),
        reason: result.reason,
        log: result.log,
        durationMs: result.durationMs ?? null,
        source: "settings",
      });
    } catch (e) {
      // Soft-fail: never throw into Settings root.
      const log = String(e ?? "workflows_run failed");
      setRunState((prev) => ({
        name,
        mode,
        busy: false,
        result: {
          ok: false,
          reason: "soft_fail",
          workflowName: name,
          mode,
          log,
        },
        error: log,
        liveLog: prev?.liveLog ?? "",
        sawProgress: prev?.sawProgress ?? false,
        elapsedMs: prev?.elapsedMs ?? 0,
      }));
      recordWorkflowRunHistory({
        name,
        mode,
        outcome: "soft_fail",
        reason: "soft_fail",
        log,
        source: "settings",
      });
    } finally {
      try {
        unlisten?.();
      } catch {
        /* ignore */
      }
    }
  };

  const runCreate = async (opts: {
    name: string;
    scope: WorkflowCreateScope;
    force?: boolean;
  }) => {
    if (!api.isTauri()) {
      setCreateError(t("settings.workflows.create.desktopOnly"));
      return;
    }
    const stem = sanitizeWorkflowName(opts.name);
    if (!stem) {
      setCreateError(t("settings.workflows.create.nameInvalid"));
      return;
    }
    if (opts.scope === "project" && !projectPath?.trim()) {
      setCreateError(t("settings.workflows.create.needProject"));
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const res = await api.workflowsCreate({
        name: stem,
        scope: opts.scope,
        projectPath,
        force: opts.force ?? false,
      });
      setCreateOpen(false);
      setOverwriteTarget(null);
      setCreateName("");
      await refresh();
      showToast?.(
        res.overwritten
          ? t("settings.workflows.create.overwritten", { name: res.name })
          : t("settings.workflows.create.created", { name: res.name }),
        2800,
      );
      if (res.path) {
        void openInEditor(res.path);
      }
    } catch (e) {
      const msg = String(e || "");
      if (/already exists/i.test(msg) && !opts.force) {
        setOverwriteTarget({ name: stem, scope: opts.scope });
        setCreateError(null);
      } else if (/invalid|reserved|path|required/i.test(msg)) {
        setCreateError(t("settings.workflows.create.nameInvalid"));
      } else {
        setCreateError(msg || t("settings.workflows.create.error"));
      }
    } finally {
      setCreateBusy(false);
    }
  };

  // Prefer host final blob; fall back to progressive buffer so a streamed run
  // is never blank after complete when the final field is empty.
  const displayLog = runState
    ? prepareWorkflowRunLogForDisplay(
        runState.result?.log ||
          (!runState.busy && runState.sawProgress ? runState.liveLog : "") ||
          null,
      )
    : null;
  const liveLogDisplay =
    runState?.busy && runState.liveLog
      ? prepareWorkflowRunLogForDisplay(runState.liveLog)
      : null;

  const logDelivery = runState
    ? resolveWorkflowRunLogDelivery({
        busy: runState.busy,
        sawProgress: runState.sawProgress,
        liveLog: runState.liveLog,
        finalLog: runState.result?.log,
      })
    : null;
  const logDeliveryKey = logDelivery
    ? workflowRunLogDeliveryMessageKey(logDelivery)
    : null;

  const honestyNote = runState
    ? resolveWorkflowRunHonestyNote({
        busy: runState.busy,
        ok: runState.result ? isWorkflowRunOk(runState.result) : null,
        reason: runState.result?.reason,
        hasLog: !!(displayLog?.text || runState.liveLog?.trim()),
        sessionDataMode,
      })
    : null;

  const copyLogText = runState
    ? resolveWorkflowRunCopyText({
        sawProgress: runState.sawProgress,
        liveLog: runState.liveLog,
        finalLog: runState.result?.log,
      })
    : "";

  const copyRunLog = async () => {
    if (!copyLogText) {
      showToast?.(t("settings.workflows.run.noLog"), 2200);
      return;
    }
    try {
      await navigator.clipboard.writeText(copyLogText);
      showToast?.(t("settings.workflows.run.copyLogDone"), 1800);
    } catch {
      showToast?.(t("settings.workflows.run.copyLogFailed"), 2800);
    }
  };

  const statusLine = runState?.result
    ? formatWorkflowRunStatusLine(runState.result, {
        ok: t("settings.workflows.run.status.ok"),
        softFail: t("settings.workflows.run.status.softFail"),
        reason: reasonLabel(runState.result.reason),
      })
    : null;

  const anyBusy = !!runState?.busy || createBusy;

  const outcomeLabel = (o: WorkflowRunHistoryRecord["outcome"]) => {
    if (o === "ok") return t("settings.workflows.history.outcome.ok");
    if (o === "error") return t("settings.workflows.history.outcome.error");
    return t("settings.workflows.history.outcome.softFail");
  };

  return (
    <div className="settings-workflows-discovery">
      <div className="settings-row__hint">
        {loading
          ? t("settings.workflows.scanning")
          : summary
            ? t("settings.workflows.discovered", { names: summary })
            : listEmpty
              ? t(
                  EMPTY_LIST_KEYS[listEmpty.key] ??
                    "settings.workflows.noneFound",
                )
              : t("settings.workflows.noneFound")}
        {error ? ` · ${t("settings.workflows.scanSoftFail")}` : null}
      </div>
      <div className="settings-row__hint settings-workflows-run-hint">
        {t("settings.workflows.runHonesty")}
      </div>
      <div className="settings-row__hint settings-workflows-run-hint">
        {t("settings.workflows.authorHint")}
      </div>

      {workflows.length > 0 ? (
        <ul
          className="settings-workflows-list"
          aria-label={t("settings.workflows")}
        >
          {workflows.slice(0, 24).map((w) => {
            const runningThis = anyBusy && runState?.name === w.name;
            return (
              <li key={`${w.scope}:${w.path}`}>
                <div className="settings-workflows-list__row">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    title={w.path}
                    onClick={() => void revealPath(w.path)}
                  >
                    {w.name}
                    <span className="settings-workflows-list__scope">
                      {" "}
                      · {scopeLabels[w.scope] ?? w.scope}
                    </span>
                  </button>
                  <span className="settings-workflows-list__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={anyBusy}
                      title={t("settings.workflows.revealTitle")}
                      onClick={() => void revealPath(w.path)}
                    >
                      {t("settings.workflows.reveal")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={anyBusy}
                      title={t("settings.workflows.openEditorTitle")}
                      onClick={() => void openInEditor(w.path)}
                    >
                      {t("settings.workflows.openEditor")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={anyBusy || !isValidWorkflowName(w.name)}
                      title={t("settings.workflows.run.smokeTitle")}
                      onClick={() => void runWorkflow(w.name, "validate")}
                    >
                      {runningThis && runState?.mode === "validate"
                        ? t("settings.workflows.run.running")
                        : t("settings.workflows.run.smoke")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={anyBusy || !isValidWorkflowName(w.name)}
                      title={t("settings.workflows.run.launchTitle")}
                      onClick={() => void runWorkflow(w.name, "launch")}
                    >
                      {runningThis && runState?.mode === "launch"
                        ? t("settings.workflows.run.running")
                        : t("settings.workflows.run.launch")}
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {runState ? (
        <div
          className={
            "settings-workflows-run-result" +
            (runState.busy
              ? " settings-workflows-run-result--busy"
              : runState.result && isWorkflowRunOk(runState.result)
                ? " settings-workflows-run-result--ok"
                : " settings-workflows-run-result--soft")
          }
          role="status"
          aria-live="polite"
        >
          <div className="settings-workflows-run-result__title">
            {t("settings.workflows.run.resultTitle", {
              name: runState.name,
              mode:
                runState.mode === "launch"
                  ? t("settings.workflows.run.mode.launch")
                  : t("settings.workflows.run.mode.validate"),
            })}
          </div>
          {runState.busy ||
          (logDeliveryKey && logDelivery !== "none") ? (
            <div className="settings-row__hint">
              {runState.busy ? (
                <>
                  {t("settings.workflows.run.running")}
                  {runState.elapsedMs > 0
                    ? ` · ${formatWorkflowRunElapsed(runState.elapsedMs)}`
                    : ""}
                  {" · "}
                </>
              ) : null}
              {logDeliveryKey
                ? t(logDeliveryKey as MessageKey)
                : null}
            </div>
          ) : null}
          {liveLogDisplay?.text ? (
            <pre
              className="settings-workflows-run-result__log settings-workflows-run-result__log--live"
              data-testid="workflows-run-live-log"
            >
              {liveLogDisplay.text}
              {liveLogDisplay.truncated ? "…" : ""}
            </pre>
          ) : null}
          {statusLine ? (
            <div className="settings-workflows-run-result__status">
              {statusLine}
            </div>
          ) : null}
          {runState.result && !isWorkflowRunOk(runState.result) ? (
            <div className="settings-row__hint">
              {t("settings.workflows.run.softFailDetail", {
                reason: reasonLabel(runState.result.reason),
              })}
            </div>
          ) : null}
          {honestyNote?.messageKey ? (
            <div
              className="settings-row__hint"
              data-testid="workflows-run-honesty"
            >
              {t(honestyNote.messageKey as MessageKey)}
            </div>
          ) : null}
          {displayLog?.text ? (
            <pre
              className={
                "settings-workflows-run-result__log" +
                (logDelivery === "batch"
                  ? " settings-workflows-run-result__log--batch"
                  : "")
              }
              tabIndex={0}
              data-testid={
                logDelivery === "batch"
                  ? "workflows-run-batch-log"
                  : "workflows-run-final-log"
              }
            >
              {displayLog.text}
              {displayLog.truncated || runState.result?.truncated
                ? `\n${t("settings.workflows.run.logTruncated")}`
                : ""}
            </pre>
          ) : !runState.busy && logDelivery === "none" ? (
            <div className="settings-row__hint">
              {t("settings.workflows.run.noLog")}
            </div>
          ) : null}
          {copyLogText ? (
            <div className="settings-workflows-run-result__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-testid="workflows-run-copy-log"
                onClick={() => void copyRunLog()}
              >
                {t("settings.workflows.run.copyLog")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Recent runs */}
      <div className="settings-workflows-history">
        <button
          type="button"
          className="btn btn--ghost btn--sm settings-workflows-history__toggle"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((v) => !v)}
        >
          {historyOpen
            ? t("settings.workflows.history.hide")
            : t("settings.workflows.history.show", {
                count: String(history.length),
              })}
        </button>
        {historyOpen ? (
          <div className="settings-workflows-history__panel">
            <div className="settings-row__hint">
              {t("settings.workflows.history.honesty")}
            </div>
            {history.length > 0 ? (
              <div
                className="settings-workflows-history__filters"
                role="group"
                aria-label={t("settings.workflows.history.filter")}
              >
                {(
                  [
                    "all",
                    "ok",
                    "error",
                    "soft_fail",
                    "validate",
                    "launch",
                  ] as WorkflowRunHistoryFilter[]
                ).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={
                      "btn btn--ghost btn--sm" +
                      (historyFilter === f ? " is-active" : "")
                    }
                    onClick={() => setHistoryFilter(f)}
                  >
                    {f === "all"
                      ? t("settings.workflows.history.filter.all")
                      : f === "ok"
                        ? t("settings.workflows.history.outcome.ok")
                        : f === "error"
                          ? t("settings.workflows.history.outcome.error")
                          : f === "soft_fail"
                            ? t("settings.workflows.history.outcome.softFail")
                            : f === "launch"
                              ? t("settings.workflows.run.mode.launch")
                              : t("settings.workflows.run.mode.validate")}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setClearHistoryOpen(true)}
                >
                  {t("settings.workflows.history.clear")}
                </button>
              </div>
            ) : null}
            {historyEmpty ? (
              <div className="settings-row__hint">
                {t("settings.workflows.empty.history_empty")}
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="settings-row__hint">
                {t("settings.workflows.history.filterEmpty")}
              </div>
            ) : (
              <ul
                className="settings-workflows-history__list"
                aria-label={t("settings.workflows.history")}
              >
                {filteredHistory.slice(0, 20).map((h) => (
                  <li key={h.id} className="settings-workflows-history__item">
                    <div className="settings-workflows-history__item-title">
                      <strong>{h.name}</strong>
                      <span className="settings-workflows-list__scope">
                        {" "}
                        ·{" "}
                        {h.mode === "launch"
                          ? t("settings.workflows.run.mode.launch")
                          : t("settings.workflows.run.mode.validate")}
                        {" · "}
                        {outcomeLabel(h.outcome)}
                      </span>
                    </div>
                    <div className="settings-row__hint">
                      {formatHistoryWhen(h.at, locale)}
                      {h.reason ? ` · ${reasonLabel(h.reason)}` : ""}
                      {typeof h.durationMs === "number"
                        ? ` · ${h.durationMs}ms`
                        : ""}
                    </div>
                    {h.logSnippet ? (
                      <pre className="settings-workflows-run-result__log">
                        {h.logSnippet}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      <div
        className="settings-row__actions"
      >
        <button
          type="button"
          className="btn btn--ghost settings-row__action"
          onClick={() => {
            setCreateError(null);
            setCreateOpen(true);
          }}
          disabled={anyBusy || !api.isTauri()}
        >
          {t("settings.workflows.create")}
        </button>
        <button
          type="button"
          className="btn btn--ghost settings-row__action"
          onClick={() => void refresh()}
          disabled={loading || anyBusy}
        >
          {t("settings.workflows.refresh")}
        </button>
        <button
          type="button"
          className="btn btn--ghost settings-row__action"
          onClick={() => void openSkill()}
        >
          {t("settings.workflows.openDocs")}
        </button>
        {userDir ? (
          <button
            type="button"
            className="btn btn--ghost settings-row__action"
            onClick={() => void openUserDir()}
          >
            {t("settings.workflows.openUserDir")}
          </button>
        ) : null}
      </div>

      {/* New from template */}
      <GlassModal
        open={createOpen}
        onClose={() => {
          if (!createBusy) setCreateOpen(false);
        }}
        title={t("settings.workflows.create.title")}
        size="md"
        closeLabel={t("common.close")}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={createBusy}
              onClick={() => setCreateOpen(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={!canSubmitCreate}
              onClick={() =>
                void runCreate({ name: createName, scope: createScope })
              }
            >
              {createBusy
                ? t("settings.workflows.create.creating")
                : t("settings.workflows.create.submit")}
            </button>
          </>
        }
      >
        <form
          className="app-dialog__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmitCreate) {
              void runCreate({ name: createName, scope: createScope });
            }
          }}
        >
          <p className="ext-field-hint">{t("settings.workflows.create.hint")}</p>
          <label className="field">
            <span>{t("settings.workflows.create.name")}</span>
            <input
              className="app-dialog__input"
              value={createName}
              onChange={(e) => {
                setCreateName(e.target.value);
                setCreateError(null);
              }}
              placeholder={t("settings.workflows.create.namePlaceholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={createBusy}
              autoFocus
            />
            {namePreview && namePreview !== createName.trim() ? (
              <span className="ext-field-hint">
                {t("settings.workflows.create.namePreview", {
                  name: namePreview,
                })}
              </span>
            ) : null}
          </label>
          <label className="field">
            <span>{t("settings.workflows.create.scope")}</span>
            <Select
              value={createScope}
              disabled={createBusy}
              aria-label={t("settings.workflows.create.scope")}
              onChange={(v) => {
                setCreateScope(v === "project" ? "project" : "user");
                setCreateError(null);
              }}
              options={[
                {
                  value: "user",
                  label: t("settings.workflows.scope.user"),
                },
                {
                  value: "project",
                  label: t("settings.workflows.scope.project"),
                  disabled: !projectPath?.trim(),
                },
              ]}
            />
            {!projectPath?.trim() ? (
              <span className="ext-field-hint">
                {t("settings.workflows.create.needProjectHint")}
              </span>
            ) : null}
          </label>
          <p className="ext-field-hint">
            {t("settings.workflows.create.argsNote")}
          </p>
          {createPlan.path ? (
            <p className="ext-field-hint" title={createPlan.path}>
              {t("settings.workflows.create.pathPreview", {
                path: createPlan.path,
              })}
            </p>
          ) : null}
          {createError ? (
            <div className="ext-alert ext-alert--error" role="alert">
              <p className="ext-alert__body">{createError}</p>
            </div>
          ) : null}
        </form>
      </GlassModal>

      {/* Overwrite confirm */}
      <GlassModal
        open={!!overwriteTarget}
        onClose={() => {
          if (!createBusy) setOverwriteTarget(null);
        }}
        title={t("settings.workflows.create.overwriteTitle")}
        size="sm"
        closeLabel={t("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={createBusy}
              onClick={() => setOverwriteTarget(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={createBusy}
              onClick={() => {
                if (!overwriteTarget) return;
                void runCreate({
                  name: overwriteTarget.name,
                  scope: overwriteTarget.scope,
                  force: true,
                });
              }}
            >
              {createBusy
                ? t("settings.workflows.create.creating")
                : t("settings.workflows.create.overwrite")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">
          {t("settings.workflows.create.overwriteBody", {
            name: overwriteTarget?.name ?? "",
          })}
        </p>
      </GlassModal>

      {/* Clear history confirm */}
      <GlassModal
        open={clearHistoryOpen}
        onClose={() => setClearHistoryOpen(false)}
        title={t("settings.workflows.history.clearTitle")}
        size="sm"
        closeLabel={t("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setClearHistoryOpen(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => {
                clearWorkflowRunHistory();
                setHistory([]);
                setClearHistoryOpen(false);
              }}
            >
              {t("settings.workflows.history.clearConfirm")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">
          {t("settings.workflows.history.clearBody", {
            count: String(history.length),
          })}
        </p>
      </GlassModal>
    </div>
  );
}
