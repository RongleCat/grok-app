/**
 * Settings → Extensions → Hooks: list / open folders, real try-run,
 * stdin Validate, classified GlassModal results, recent activity
 * (localStorage ring + filter chips + clear honesty).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  IconExternalLink,
  IconFolder,
  IconHooks,
  IconPlus,
  IconRefresh,
} from "@/components/icons";
import { isCliMissingError } from "@/lib/extensionsUi";
import {
  clearHookActivities,
  formatHookActivityTime,
  listHookActivities,
  newHookActivityId,
  planClearHookActivities,
  pushHookActivity,
  redactHookDetail,
  subscribeHookActivities,
  type HookActivityOutcome,
  type HookActivityRecord,
} from "@/lib/hooksDebug";
import {
  classifyHooksExportError,
  hooksExportOutcomeMessageKey,
  planHooksActivityExport,
  resolveHooksExportOutcome,
} from "@/lib/hooksActivityExport";
import {
  countHookActivityOutcomes,
  filterHookActivitiesByOutcome,
  resolveHookActivityEmptyState,
  type HookActivityOutcomeFilter,
} from "@/lib/hookOverride";
import {
  clampHooksTryTimeout,
  formatHooksTryRunOutput,
  formatHooksTryRunSummary,
  HOOKS_TRY_DEFAULT_TIMEOUT_SECS,
  hooksTryRunActivityOutcome,
  isHookScriptTryable,
  validateHooksTryStdin,
} from "@/lib/hooksTryRun";
import {
  buildHooksStdinValidatePresentation,
  buildHooksTryExceptionPresentation,
  buildHooksTryPreflightError,
  buildHooksTryPresentation,
  hooksValidateBadgeTone,
  hooksValidateHint,
  hooksValidateKindLabel,
  type HooksValidateKind,
  type HooksValidatePresentation,
} from "@/lib/hooksValidate";
import {
  formatHookMtime,
  formatHookSize,
  hookMetaLine,
  hookRowKey,
  hookTypeLabel,
  sortHooksByScopeName,
  type HookLike,
} from "@/lib/hooksUi";

const SAMPLE_STDIN = `{
  "hookEventName": "PreToolUse",
  "sessionId": "try-run",
  "cwd": "/tmp",
  "toolName": "run_terminal_command",
  "toolInput": { "command": "echo hi" }
}`;

const OUTCOME_FILTERS: HookActivityOutcomeFilter[] = [
  "all",
  "ok",
  "fail",
  "skip",
];

function outcomeBadgeClass(outcome: HookActivityOutcome): string {
  if (outcome === "ok") return "ext-badge ext-badge--ok";
  if (outcome === "fail") return "ext-badge ext-badge--fail";
  return "ext-badge ext-badge--muted";
}

function outcomeLabel(
  outcome: HookActivityOutcome,
  tr: ReturnType<typeof createT>,
): string {
  if (outcome === "ok") return tr("ext.hooks.activity.ok");
  if (outcome === "fail") return tr("ext.hooks.activity.fail");
  if (outcome === "skip") return tr("ext.hooks.activity.skip");
  return tr("ext.hooks.activity.info");
}

function filterChipLabel(
  id: HookActivityOutcomeFilter,
  tr: ReturnType<typeof createT>,
): string {
  if (id === "all") return tr("ext.hooks.activity.filterAll");
  if (id === "ok") return tr("ext.hooks.activity.ok");
  if (id === "fail") return tr("ext.hooks.activity.fail");
  return tr("ext.hooks.activity.skip");
}

function severityMsgClass(
  severity: HooksValidatePresentation["severity"],
): string {
  if (severity === "ok") return " ext-hooks-try__msg--ok";
  if (severity === "err") return " ext-hooks-try__msg--err";
  if (severity === "warn") return " ext-hooks-try__msg--warn";
  return "";
}

/** Actions the parent tab trail can host (Hooks). */
export type ExtHooksTabActions = {
  refresh: () => void;
  busy: boolean;
  loading: boolean;
};

export function ExtensionsHooksPanel({
  locale,
  projectPath = null,
  cliFound = true,
  query = "",
  hidePageToolbar = false,
  onTabActionsChange,
}: {
  locale: Locale;
  projectPath?: string | null;
  cliFound?: boolean;
  /** Tab-level search query. */
  query?: string;
  /** When true, hide the in-page refresh toolbar (actions live in the tab trail). */
  hidePageToolbar?: boolean;
  /** Register / clear Hooks actions for the parent tab trail. */
  onTabActionsChange?: (actions: ExtHooksTabActions | null) => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const q = query.trim().toLowerCase();
  const [hooks, setHooks] = useState<HookLike[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [activity, setActivity] = useState<HookActivityRecord[]>(() => [
    ...listHookActivities(),
  ]);
  const [outcomeFilter, setOutcomeFilter] =
    useState<HookActivityOutcomeFilter>("all");
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [exportMsg, setExportMsg] = useState<{
    kind: "ok" | "err" | "info";
    text: string;
  } | null>(null);

  // Real try-run panel
  const [tryOpen, setTryOpen] = useState(true);
  const [tryPath, setTryPath] = useState("");
  const [tryJson, setTryJson] = useState(SAMPLE_STDIN);
  const [tryTimeout, setTryTimeout] = useState(
    String(HOOKS_TRY_DEFAULT_TIMEOUT_SECS),
  );
  const [tryRunning, setTryRunning] = useState(false);
  const [tryResult, setTryResult] = useState<api.HooksTryRunResult | null>(
    null,
  );
  const [tryMsg, setTryMsg] = useState<{
    kind: "ok" | "err" | "info" | "warn";
    text: string;
  } | null>(null);

  // GlassModal result (validate or try-run)
  const [resultOpen, setResultOpen] = useState(false);
  const [resultMode, setResultMode] = useState<"validate" | "try">("try");
  const [resultPresentation, setResultPresentation] =
    useState<HooksValidatePresentation | null>(null);

  const cliMissing = !cliFound;

  const kindLabels = useMemo((): Partial<Record<HooksValidateKind, string>> => {
    return {
      ok: tr("ext.hooks.try.kind.ok"),
      timeout: tr("ext.hooks.try.kind.timeout"),
      exit_nonzero: tr("ext.hooks.try.kind.exitNonzero"),
      empty_path: tr("ext.hooks.try.kind.emptyPath"),
      path_outside_hooks: tr("ext.hooks.try.kind.pathOutside"),
      path_not_absolute: tr("ext.hooks.try.kind.pathNotAbsolute"),
      not_found: tr("ext.hooks.try.kind.notFound"),
      not_a_file: tr("ext.hooks.try.kind.notAFile"),
      invalid_path: tr("ext.hooks.try.kind.invalidPath"),
      stdin_too_large: tr("ext.hooks.try.kind.stdinTooLarge"),
      invalid_json: tr("ext.hooks.try.kind.invalidJson"),
      stdin_empty: tr("ext.hooks.try.kind.stdinEmpty"),
      stdin_not_object: tr("ext.hooks.try.kind.stdinNotObject"),
      spawn_failed: tr("ext.hooks.try.kind.spawnFailed"),
      wait_failed: tr("ext.hooks.try.kind.waitFailed"),
      refused: tr("ext.hooks.try.kind.refused"),
      host_only: tr("ext.hooks.try.kind.hostOnly"),
      host_error: tr("ext.hooks.try.kind.hostError"),
      other: tr("ext.hooks.try.kind.other"),
    };
  }, [tr]);

  const kindHints = useMemo((): Partial<Record<HooksValidateKind, string>> => {
    return {
      ok: tr("ext.hooks.try.hint.ok"),
      timeout: tr("ext.hooks.try.hint.timeout"),
      exit_nonzero: tr("ext.hooks.try.hint.exitNonzero"),
      empty_path: tr("ext.hooks.try.hint.emptyPath"),
      path_outside_hooks: tr("ext.hooks.try.hint.pathOutside"),
      path_not_absolute: tr("ext.hooks.try.hint.pathNotAbsolute"),
      not_found: tr("ext.hooks.try.hint.notFound"),
      not_a_file: tr("ext.hooks.try.hint.notAFile"),
      invalid_path: tr("ext.hooks.try.hint.invalidPath"),
      stdin_too_large: tr("ext.hooks.try.hint.stdinTooLarge"),
      invalid_json: tr("ext.hooks.try.hint.invalidJson"),
      stdin_empty: tr("ext.hooks.try.hint.stdinEmpty"),
      stdin_not_object: tr("ext.hooks.try.hint.stdinNotObject"),
      spawn_failed: tr("ext.hooks.try.hint.spawnFailed"),
      wait_failed: tr("ext.hooks.try.hint.waitFailed"),
      refused: tr("ext.hooks.try.hint.refused"),
      host_only: tr("ext.hooks.try.hint.hostOnly"),
      host_error: tr("ext.hooks.try.hint.hostError"),
      other: tr("ext.hooks.try.hint.other"),
    };
  }, [tr]);

  const summaryLabels = useMemo(
    () => ({
      refused: tr("ext.hooks.try.summaryRefused"),
      timedOut: tr("ext.hooks.try.summaryTimedOut"),
      ok: tr("ext.hooks.try.summaryOk"),
    }),
    [tr],
  );

  const stdinValidateLabels = useMemo(
    () => ({
      empty: tr("ext.hooks.try.errEmpty"),
      tooLarge: tr("ext.hooks.try.errTooLarge"),
      invalidJson: tr("ext.hooks.try.errInvalidJson"),
      notObject: tr("ext.hooks.try.errNotObject"),
      ok: tr("ext.hooks.try.validOk"),
      kinds: kindLabels,
    }),
    [tr, kindLabels],
  );

  useEffect(() => {
    setActivity([...listHookActivities()]);
    return subscribeHookActivities((recs) => setActivity([...recs]));
  }, []);

  const filteredActivity = useMemo(
    () => filterHookActivitiesByOutcome(activity, outcomeFilter),
    [activity, outcomeFilter],
  );

  const activityCounts = useMemo(
    () => countHookActivityOutcomes(activity),
    [activity],
  );

  const activityEmptyState = useMemo(
    () =>
      resolveHookActivityEmptyState(activity.length, filteredActivity.length),
    [activity.length, filteredActivity.length],
  );

  const clearPlan = useMemo(
    () => planClearHookActivities(activity),
    [activity],
  );

  const confirmClearActivity = () => {
    clearHookActivities();
    setClearConfirmOpen(false);
    setOutcomeFilter("all");
    setExportMsg(null);
  };

  const showExportOutcome = useCallback(
    (
      outcome: ReturnType<typeof resolveHooksExportOutcome>,
      count = 0,
    ) => {
      const key = hooksExportOutcomeMessageKey(outcome);
      setExportMsg({
        kind: outcome.ok ? "ok" : "err",
        text: tr(key, { count: String(count) }),
      });
    },
    [tr],
  );

  const onCopyActivitySummary = useCallback(async () => {
    const plan = planHooksActivityExport(filteredActivity, {
      outcomeFilter,
    });
    if (plan.empty || !plan.text) {
      showExportOutcome(
        resolveHooksExportOutcome({
          channel: "copy",
          empty: true,
        }),
        0,
      );
      return;
    }
    let copyOk = false;
    let error: unknown;
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(plan.text);
        copyOk = true;
      } else {
        error = Object.assign(new Error("clipboard unavailable"), {
          code: "clipboard",
        });
      }
    } catch (e) {
      error = e;
    }
    showExportOutcome(
      resolveHooksExportOutcome({
        channel: "copy",
        empty: false,
        copyOk,
        error,
      }),
      plan.count,
    );
  }, [filteredActivity, outcomeFilter, showExportOutcome]);

  const onExportActivityJson = useCallback(() => {
    const plan = planHooksActivityExport(filteredActivity, {
      outcomeFilter,
    });
    if (plan.empty) {
      showExportOutcome(
        resolveHooksExportOutcome({
          channel: "download",
          empty: true,
        }),
        0,
      );
      return;
    }
    let error: unknown;
    try {
      const blob = new Blob([plan.json], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = plan.filenameJson;
        a.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      error = e;
      // Normalize unknown throws to download soft-fail when message is vague.
      if (classifyHooksExportError(e) === "other") {
        error = Object.assign(
          e instanceof Error ? e : new Error(String(e)),
          { code: "download" },
        );
      }
    }
    showExportOutcome(
      resolveHooksExportOutcome({
        channel: "download",
        empty: false,
        error,
      }),
      plan.count,
    );
  }, [filteredActivity, outcomeFilter, showExportOutcome]);

  const load = useCallback(async () => {
    if (!api.isTauri()) {
      setHooks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.hooksList(projectPath);
      setHooks(
        sortHooksByScopeName(
          (res.hooks ?? []).map((h) => ({
            name: h.name,
            path: h.path,
            scope: h.scope,
            kind: h.kind,
            ext: h.ext,
            size: h.size ?? 0,
            mtimeMs: h.mtimeMs ?? 0,
          })),
        ),
      );
    } catch (e) {
      setHooks([]);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!onTabActionsChange) return;
    onTabActionsChange({
      refresh: () => {
        void load();
      },
      busy: !!busy,
      loading,
    });
    return () => onTabActionsChange(null);
  }, [onTabActionsChange, load, busy, loading]);

  const openDir = async (scope: "user" | "project", create: boolean) => {
    if (scope === "project" && !projectPath?.trim()) return;
    setBusy(`${scope}:${create ? "c" : "o"}`);
    try {
      await api.hooksOpenDir({ scope, projectPath, create });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const scopeLabel = (scope: string) =>
    scope === "project"
      ? tr("ext.hooks.scope.project")
      : tr("ext.hooks.scope.user");

  const filteredHooks = useMemo(() => {
    if (!q) return hooks;
    return hooks.filter((h) => {
      const hay = [
        h.name,
        h.scope,
        h.kind ?? "",
        h.ext ?? "",
        h.path ?? "",
        hookTypeLabel(h),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [hooks, q]);

  const hooksByScope = useMemo(() => {
    const project: HookLike[] = [];
    const user: HookLike[] = [];
    for (const h of filteredHooks) {
      if (h.scope === "project") project.push(h);
      else user.push(h);
    }
    return [
      { key: "user" as const, label: tr("ext.hooks.group.user"), items: user },
      {
        key: "project" as const,
        label: tr("ext.hooks.group.project"),
        items: project,
      },
    ].filter((g) => g.items.length > 0);
  }, [filteredHooks, tr]);

  const scriptHooks = useMemo(
    () => hooks.filter((h) => isHookScriptTryable(h)),
    [hooks],
  );

  const selectTryPath = (path: string) => {
    setTryPath(path);
    setTryResult(null);
    setTryMsg(null);
    setTryOpen(true);
  };

  const openPresentation = (
    mode: "validate" | "try",
    presentation: HooksValidatePresentation,
  ) => {
    setResultMode(mode);
    setResultPresentation(presentation);
    setResultOpen(true);
    const msgKind =
      presentation.severity === "ok"
        ? "ok"
        : presentation.severity === "warn"
          ? "warn"
          : presentation.severity === "info"
            ? "info"
            : "err";
    setTryMsg({ kind: msgKind, text: presentation.summary });
  };

  const onValidate = () => {
    const { presentation } = buildHooksStdinValidatePresentation(
      tryJson,
      stdinValidateLabels,
    );
    openPresentation("validate", presentation);
  };

  const onTryRun = async () => {
    const path = tryPath.trim();
    const preflight = buildHooksTryPreflightError(path, tryJson, {
      isTauri: api.isTauri(),
      labels: {
        noPath: tr("ext.hooks.try.errNoPath"),
        hostOnly: tr("ext.hooks.try.errHostOnly"),
        tooLarge: tr("ext.hooks.try.errTooLarge"),
        invalidJson: tr("ext.hooks.try.errInvalidJson"),
        kinds: kindLabels,
      },
    });
    if (preflight) {
      setTryResult(null);
      openPresentation("try", preflight);
      return;
    }

    const stdinCheck = validateHooksTryStdin(tryJson);
    if (!stdinCheck.ok) {
      // Should be covered by preflight; belt-and-suspenders.
      const { presentation } = buildHooksStdinValidatePresentation(tryJson, {
        ...stdinValidateLabels,
        empty: tr("ext.hooks.try.errEmpty"),
      });
      openPresentation("try", {
        ...presentation,
        kind:
          presentation.kind === "stdin_empty"
            ? "invalid_json"
            : presentation.kind,
      });
      return;
    }

    const timeoutSecs = clampHooksTryTimeout(
      tryTimeout.trim() ? Number(tryTimeout) : HOOKS_TRY_DEFAULT_TIMEOUT_SECS,
    );
    setTryRunning(true);
    setTryMsg(null);
    setTryResult(null);
    setBusy(`try:${path}`);
    try {
      const res = await api.hooksTryRun({
        path,
        projectPath,
        stdinJson: stdinCheck.body,
        timeoutSecs,
      });
      setTryResult(res);
      const presentation = buildHooksTryPresentation(res, {
        ...summaryLabels,
        fail: tr("ext.hooks.try.summaryFail", {
          code:
            res.exitCode == null || res.exitCode === undefined
              ? "?"
              : String(res.exitCode),
        }),
        kinds: kindLabels,
      });
      openPresentation("try", presentation);

      const baseName = path.split(/[/\\]/).pop() || path;
      const summary = formatHooksTryRunSummary(res, {
        ...summaryLabels,
        fail: tr("ext.hooks.try.summaryFail", {
          code:
            res.exitCode == null || res.exitCode === undefined
              ? "?"
              : String(res.exitCode),
        }),
      });
      pushHookActivity({
        id: newHookActivityId(),
        type: "TryRun",
        outcome: hooksTryRunActivityOutcome(res),
        atMs: Date.now(),
        detail: redactHookDetail(
          [
            summary,
            hooksValidateKindLabel(presentation.kind, kindLabels),
            res.path ? res.path : baseName,
            res.stdout?.trim() ? res.stdout.trim().slice(0, 80) : null,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
        source: "try",
        hookName: baseName,
      });
    } catch (e) {
      setTryResult(null);
      const presentation = buildHooksTryExceptionPresentation(e, {
        kinds: kindLabels,
      });
      openPresentation("try", presentation);
      // Honest fail row when host throws (never invent success).
      const baseName = path.split(/[/\\]/).pop() || path;
      pushHookActivity({
        id: newHookActivityId(),
        type: "TryRun",
        outcome: "fail",
        atMs: Date.now(),
        detail: redactHookDetail(
          [
            presentation.summary,
            hooksValidateKindLabel(presentation.kind, kindLabels),
            baseName,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
        source: "try",
        hookName: baseName,
      });
    } finally {
      setTryRunning(false);
      setBusy(null);
    }
  };

  const resultTitle =
    resultMode === "validate"
      ? tr("ext.hooks.try.resultValidateTitle")
      : tr("ext.hooks.try.resultTryTitle");

  const resultHint = resultPresentation
    ? hooksValidateHint(resultPresentation.kind, kindHints)
    : "";

  return (
    <>
      <div
        className="ext-ref-stack"
        id="settings-anchor-ext-hooks"
        data-testid="ext-hooks-panel"
      >
        {!hidePageToolbar ? (
          <div className="ext-ref-block__head ext-ref-toolbar">
            <span className="ext-ref-block__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={loading || !!busy}
                onClick={() => void load()}
              >
                <IconRefresh size={14} />
                <span>{tr("ext.refresh")}</span>
              </button>
            </span>
          </div>
        ) : null}

        {/* ── Directories ── */}
        <section className="ext-ref-block">
          <div className="ext-ref-section-label">
            {tr("ext.hooks.locationsTitle")}
          </div>
          <div className="ext-ref-dir-bar">
            <div className="ext-ref-dir-group">
              <span className="ext-ref-dir-group__label">
                {tr("ext.hooks.group.user")}
              </span>
              <div className="ext-ref-dir-group__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!!busy || cliMissing}
                  onClick={() => void openDir("user", false)}
                >
                  <IconFolder size={13} />
                  <span>{tr("ext.hooks.openUser")}</span>
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!!busy || cliMissing}
                  onClick={() => void openDir("user", true)}
                >
                  <IconPlus size={13} />
                  <span>{tr("ext.hooks.createUser")}</span>
                </button>
              </div>
            </div>
            <div className="ext-ref-dir-group">
              <span className="ext-ref-dir-group__label">
                {tr("ext.hooks.group.project")}
              </span>
              <div className="ext-ref-dir-group__actions">
                {projectPath?.trim() ? (
                  <>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!!busy || cliMissing}
                      onClick={() => void openDir("project", false)}
                    >
                      <IconFolder size={13} />
                      <span>{tr("ext.hooks.openProject")}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!!busy || cliMissing}
                      onClick={() => void openDir("project", true)}
                    >
                      <IconPlus size={13} />
                      <span>{tr("ext.hooks.createProject")}</span>
                    </button>
                  </>
                ) : (
                  <span className="ext-ref-block__meta">
                    {tr("ext.hooks.emptyProject")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <div
            className={
              "ext-alert" +
              (isCliMissingError(error)
                ? " ext-alert--error"
                : " ext-alert--warn")
            }
            role="alert"
          >
            <div className="ext-alert__title">{tr("ext.hooks.error")}</div>
            <p className="ext-alert__body">{error}</p>
          </div>
        ) : null}

        {/* ── Scripts list ── */}
        <section className="ext-ref-block">
          <div className="ext-ref-section-label">
            {tr("ext.hooks.scriptsTitle")}
            {!loading ? (
              <span className="ext-ref-cat-group__count">{hooks.length}</span>
            ) : null}
          </div>
          {loading ? (
            <p className="ext-ref-empty">{tr("ext.hooks.loading")}</p>
          ) : hooks.length === 0 ? (
            <p className="ext-ref-empty">{tr("ext.hooks.empty")}</p>
          ) : filteredHooks.length === 0 ? (
            <p className="ext-ref-empty">{tr("ext.plugins.filterEmpty")}</p>
          ) : (
            hooksByScope.map((group) => (
              <div key={group.key} className="ext-ref-scope-group">
                <div className="ext-ref-scope-group__label">
                  {group.label}
                  <span className="ext-ref-cat-group__count">
                    {group.items.length}
                  </span>
                </div>
                <ul className="ext-ref-list">
                  {group.items.map((h) => (
                    <li
                      key={hookRowKey(h)}
                      className="ext-ref-row ext-ref-row--dense"
                    >
                      <div className="ext-ref-row__main">
                        <div className="ext-ref-row__icon" aria-hidden>
                          <IconHooks size={14} />
                        </div>
                        <div className="ext-ref-row__body">
                          <div className="ext-ref-row__title">{h.name}</div>
                          <div className="ext-ref-row__desc">
                            {hookMetaLine(h, { locale, scopeLabel })}
                            {" · "}
                            {formatHookSize(h.size)}
                            {h.mtimeMs
                              ? ` · ${formatHookMtime(h.mtimeMs, locale)}`
                              : ""}
                          </div>
                          <div className="ext-ref-row__meta">
                            <span
                              className={
                                "ext-ref-badge" +
                                (h.scope === "project"
                                  ? " ext-badge--project"
                                  : " ext-badge--user")
                              }
                            >
                              {scopeLabel(h.scope)}
                            </span>
                            <span className="ext-ref-badge">
                              {hookTypeLabel(h)}
                            </span>
                          </div>
                        </div>
                        <div className="ext-ref-row__end">
                          {isHookScriptTryable(h) ? (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={!!busy || tryRunning}
                              onClick={() => selectTryPath(h.path)}
                            >
                              <span>{tr("ext.hooks.try.action")}</span>
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={!!busy}
                            onClick={() =>
                              void api
                                .hooksReveal(h.path)
                                .catch((e) => setError(String(e)))
                            }
                          >
                            <IconExternalLink size={13} />
                            <span>{tr("ext.hooks.reveal")}</span>
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>

        {/* ── Try-run (collapsible advanced) ── */}
        <details
          className="ext-ref-advanced ext-hooks-try"
          open={tryOpen}
          onToggle={(e) => setTryOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>{tr("ext.hooks.try.title")}</summary>
          <div className="ext-hooks-try__body">
            <label className="ext-hooks-try__field ext-hooks-try__field--block">
              <span className="ext-hooks-try__label">
                {tr("ext.hooks.try.scriptPath")}
              </span>
              <input
                type="text"
                className="settings-input"
                list="ext-hooks-try-paths"
                value={tryPath}
                onChange={(e) => {
                  setTryPath(e.target.value);
                  setTryMsg(null);
                  setTryResult(null);
                }}
                placeholder={tr("ext.hooks.try.scriptPathPlaceholder")}
                autoComplete="off"
                spellCheck={false}
              />
              <datalist id="ext-hooks-try-paths">
                {scriptHooks.map((h) => (
                  <option key={hookRowKey(h)} value={h.path}>
                    {h.name}
                  </option>
                ))}
              </datalist>
            </label>
            <label className="ext-hooks-try__field ext-hooks-try__field--block">
              <span className="ext-hooks-try__label">
                {tr("ext.hooks.try.stdin")}
              </span>
              <textarea
                className="settings-input ext-hooks-try__textarea"
                value={tryJson}
                onChange={(e) => {
                  setTryJson(e.target.value);
                  setTryMsg(null);
                }}
                rows={8}
                spellCheck={false}
                autoComplete="off"
                aria-label={tr("ext.hooks.try.stdin")}
              />
            </label>
            <div className="ext-hooks-try__row">
              <label className="ext-hooks-try__field ext-hooks-try__field--timeout">
                <span className="ext-hooks-try__label">
                  {tr("ext.hooks.try.timeout")}
                </span>
                <input
                  type="number"
                  className="settings-input"
                  min={1}
                  max={60}
                  step={1}
                  value={tryTimeout}
                  onChange={(e) => setTryTimeout(e.target.value)}
                  aria-label={tr("ext.hooks.try.timeout")}
                />
              </label>
              <div className="ext-hooks-try__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={tryRunning || !!busy}
                  onClick={onValidate}
                >
                  {tr("ext.hooks.try.validate")}
                </button>
                <button
                  type="button"
                  className="btn btn--solid btn--sm"
                  disabled={tryRunning || !!busy || !tryPath.trim()}
                  onClick={() => void onTryRun()}
                >
                  {tryRunning
                    ? tr("ext.hooks.try.running")
                    : tr("ext.hooks.try.run")}
                </button>
                {resultPresentation || tryResult ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={!resultPresentation && !tryResult}
                    onClick={() => {
                      if (resultPresentation) {
                        setResultOpen(true);
                      } else if (tryResult) {
                        openPresentation(
                          "try",
                          buildHooksTryPresentation(tryResult, {
                            ...summaryLabels,
                            fail: tr("ext.hooks.try.summaryFail", {
                              code:
                                tryResult.exitCode == null ||
                                tryResult.exitCode === undefined
                                  ? "?"
                                  : String(tryResult.exitCode),
                            }),
                            kinds: kindLabels,
                          }),
                        );
                      }
                    }}
                  >
                    {tr("ext.hooks.try.viewResult")}
                  </button>
                ) : null}
              </div>
            </div>
            {tryMsg ? (
              <p
                className={
                  "ext-field-hint ext-hooks-try__msg" +
                  severityMsgClass(
                    tryMsg.kind === "ok"
                      ? "ok"
                      : tryMsg.kind === "err"
                        ? "err"
                        : tryMsg.kind === "warn"
                          ? "warn"
                          : "info",
                  )
                }
                role="status"
              >
                {tryMsg.text}
              </p>
            ) : null}
            {tryResult ? (
              <div
                className="ext-hooks-try__result"
                role="region"
                aria-live="polite"
              >
                <div className="ext-hooks-try__result-meta">
                  <span
                    className={
                      "ext-badge " +
                      (tryResult.ok
                        ? "ext-badge--ok"
                        : tryResult.refused
                          ? "ext-badge--muted"
                          : "ext-badge--fail")
                    }
                  >
                    {tryResult.ok
                      ? tr("ext.hooks.activity.ok")
                      : tryResult.refused
                        ? tr("ext.hooks.try.badgeRefused")
                        : tryResult.timedOut
                          ? tr("ext.hooks.try.badgeTimeout")
                          : tr("ext.hooks.activity.fail")}
                  </span>
                  {resultPresentation ? (
                    <span className="ext-badge ext-badge--muted">
                      {hooksValidateKindLabel(
                        resultPresentation.kind,
                        kindLabels,
                      )}
                    </span>
                  ) : null}
                  {tryResult.exitCode != null ? (
                    <span className="ext-badge ext-badge--muted">
                      {tr("ext.hooks.try.exitCode", {
                        code: String(tryResult.exitCode),
                      })}
                    </span>
                  ) : null}
                  {typeof tryResult.durationMs === "number" ? (
                    <span className="ext-badge ext-badge--muted">
                      {tryResult.durationMs}ms
                    </span>
                  ) : null}
                  {tryResult.scope ? (
                    <span className="ext-badge ext-badge--muted">
                      {scopeLabel(tryResult.scope)}
                    </span>
                  ) : null}
                </div>
                {tryResult.path ? (
                  <p
                    className="ext-hooks-try__result-path"
                    title={tryResult.path}
                  >
                    <code>{tryResult.path}</code>
                  </p>
                ) : null}
                {formatHooksTryRunOutput(tryResult) ? (
                  <pre className="ext-hooks-try__output">
                    {formatHooksTryRunOutput(tryResult)}
                  </pre>
                ) : (
                  <p className="ext-ref-block__meta">
                    {tr("ext.hooks.try.noOutput")}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </details>

        {/* ── Recent activity ── */}
        <section className="ext-ref-block ext-hooks-activity">
          <div className="ext-ref-block__head">
            <div className="ext-ref-section-label">
              {tr("ext.hooks.activity.title")}
              {activity.length > 0 ? (
                <span className="ext-ref-cat-group__count">
                  {activity.length}
                </span>
              ) : null}
            </div>
            <div className="ext-ref-block__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                title={tr("ext.hooks.activity.exportHint")}
                onClick={onExportActivityJson}
              >
                {tr("ext.hooks.activity.export")}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                title={tr("ext.hooks.activity.copySummaryHint")}
                onClick={() => void onCopyActivitySummary()}
              >
                {tr("ext.hooks.activity.copySummary")}
              </button>
              {!clearPlan.empty ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setClearConfirmOpen(true)}
                >
                  {tr("ext.hooks.activity.clear")}
                </button>
              ) : null}
            </div>
          </div>
          {activity.length > 0 ? (
            <SegmentedControl
              role="tablist"
              ariaLabel={tr("ext.hooks.activity.filterLabel")}
              className="ext-hooks-activity__chips"
              value={outcomeFilter}
              options={OUTCOME_FILTERS.map((id) => ({
                value: id,
                label: (
                  <>
                    {filterChipLabel(id, tr)}
                    <span className="ext-hooks-activity__count" aria-hidden>
                      {activityCounts[id]}
                    </span>
                  </>
                ),
              }))}
              onChange={(id) => {
                setOutcomeFilter(id);
                setExportMsg(null);
              }}
            />
          ) : null}
          {exportMsg ? (
            <p
              className={
                "ext-field-hint ext-hooks-try__msg" +
                (exportMsg.kind === "ok"
                  ? " ext-hooks-try__msg--ok"
                  : exportMsg.kind === "err"
                    ? " ext-hooks-try__msg--err"
                    : "")
              }
              role="status"
            >
              {exportMsg.text}
            </p>
          ) : null}
          {activityEmptyState === "empty" ? (
            <p className="ext-ref-empty" role="status">
              {tr("ext.hooks.activity.empty")}
            </p>
          ) : activityEmptyState === "filtered" ? (
            <p className="ext-ref-empty" role="status">
              {tr("ext.hooks.activity.emptyFilter")}
            </p>
          ) : (
            <ul className="ext-ref-list">
              {filteredActivity.map((row) => (
                <li
                  key={row.id}
                  className="ext-ref-row ext-ref-row--dense"
                >
                  <div className="ext-ref-row__main">
                    <div className="ext-ref-row__body">
                      <div className="ext-ref-row__title">{row.type}</div>
                      {row.detail ? (
                        <div
                          className="ext-ref-row__desc ext-hooks-activity__detail"
                          title={row.detail}
                        >
                          {row.detail}
                        </div>
                      ) : null}
                      <div className="ext-ref-row__meta">
                        <span className={outcomeBadgeClass(row.outcome)}>
                          {outcomeLabel(row.outcome, tr)}
                        </span>
                        <span className="ext-ref-badge">
                          {formatHookActivityTime(row.atMs, locale)}
                        </span>
                        {row.source === "try" ? (
                          <span className="ext-ref-badge">
                            {tr("ext.hooks.try.badgeTry")}
                          </span>
                        ) : row.source === "debug" ? (
                          <span className="ext-ref-badge">
                            {tr("ext.hooks.activity.sourceDebug")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <GlassModal
        open={clearConfirmOpen && !clearPlan.empty}
        onClose={() => setClearConfirmOpen(false)}
        title={tr("ext.hooks.activity.clearConfirmTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setClearConfirmOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={confirmClearActivity}
            >
              {tr("ext.hooks.activity.clearConfirmOk")}
            </button>
          </>
        }
      >
        <p>
          {tr("ext.hooks.activity.clearConfirmMessage", {
            count: String(clearPlan.count),
          })}
        </p>
      </GlassModal>

      <GlassModal
        open={resultOpen && !!resultPresentation}
        onClose={() => setResultOpen(false)}
        title={resultTitle}
        size="lg"
        closeLabel={tr("common.close")}
        wrapBody
        bodyClassName="ext-hooks-result-modal"
        footer={
          <>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => setResultOpen(false)}
            >
              {tr("common.close")}
            </button>
          </>
        }
      >
        {resultPresentation ? (
          <div className="ext-hooks-result">
            <div className="ext-hooks-result__meta">
              <span
                className={
                  "ext-badge ext-badge--" +
                  hooksValidateBadgeTone(resultPresentation.severity)
                }
              >
                {hooksValidateKindLabel(resultPresentation.kind, kindLabels)}
              </span>
              {resultPresentation.exitCode != null ? (
                <span className="ext-badge ext-badge--muted">
                  {tr("ext.hooks.try.exitCode", {
                    code: String(resultPresentation.exitCode),
                  })}
                </span>
              ) : null}
              {resultPresentation.durationMs != null ? (
                <span className="ext-badge ext-badge--muted">
                  {resultPresentation.durationMs}ms
                </span>
              ) : null}
              {resultPresentation.scope ? (
                <span className="ext-badge ext-badge--muted">
                  {scopeLabel(resultPresentation.scope)}
                </span>
              ) : null}
              {resultPresentation.refused ? (
                <span className="ext-badge ext-badge--muted">
                  {tr("ext.hooks.try.badgeRefused")}
                </span>
              ) : null}
              {resultPresentation.timedOut ? (
                <span className="ext-badge ext-badge--muted">
                  {tr("ext.hooks.try.badgeTimeout")}
                </span>
              ) : null}
            </div>
            <p
              className={
                "ext-hooks-result__summary" +
                severityMsgClass(resultPresentation.severity)
              }
            >
              {resultPresentation.summary}
            </p>
            {resultHint ? (
              <p className="ext-hooks-result__hint">{resultHint}</p>
            ) : null}
            {resultPresentation.detail &&
            resultPresentation.detail !== resultPresentation.summary ? (
              <p className="ext-hooks-result__detail">
                {resultPresentation.detail}
              </p>
            ) : null}
            {resultPresentation.reason ? (
              <p className="ext-hooks-result__reason">
                <span className="ext-hooks-result__label">
                  {tr("ext.hooks.try.reason")}
                </span>
                <code>{resultPresentation.reason}</code>
              </p>
            ) : null}
            {resultPresentation.path ? (
              <p
                className="ext-hooks-result__path"
                title={resultPresentation.path}
              >
                <span className="ext-hooks-result__label">
                  {tr("ext.hooks.try.scriptPath")}
                </span>
                <code>{resultPresentation.path}</code>
              </p>
            ) : null}
            {resultMode === "try" ? (
              resultPresentation.output ? (
                <pre className="ext-hooks-try__output ext-hooks-result__output">
                  {resultPresentation.output}
                </pre>
              ) : resultPresentation.ok ||
                resultPresentation.kind === "exit_nonzero" ||
                resultPresentation.kind === "timeout" ? (
                <p className="ext-field-hint">{tr("ext.hooks.try.noOutput")}</p>
              ) : null
            ) : null}
          </div>
        ) : null}
      </GlassModal>
    </>
  );
}
