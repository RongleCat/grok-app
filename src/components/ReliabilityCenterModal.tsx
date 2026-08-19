/**
 * Reliability / Observability center — aggregate long-task signals:
 * busy sessions, stall / end-of-turn stalls, recent error-deck cards,
 * a persisted stall timeline (localStorage ring), and the cross-session
 * tool/permission audit ledger (host JSONL).
 * Actions: export support bundle, open Doctor, clear stall/audit, export audit,
 * export redacted stall history JSON.
 * No secrets from logs.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { GlassModal } from "@/components/GlassModal";
import {
  IconActivity,
  IconAlertTriangle,
  IconClose,
  IconDoctor,
} from "@/components/icons";
import { ProcessBudgetPanel } from "@/components/ProcessBudgetPanel";
import { createT, intlLocale, type Locale, type MessageKey } from "@/i18n";
import * as api from "@/lib/api";
import {
  auditLedgerEventKey,
  filterAuditLedger,
  parseAuditLedgerList,
  serializeAuditLedgerJsonl,
  toAuditLedgerExportFilter,
  type AuditLedgerEntry,
  type AuditLedgerEvent,
} from "@/lib/auditLedger";
import type { ProcessLimitEvent } from "@/lib/processBudget";
import {
  assembleGoalOrchView,
  filterGoalOrchEvents,
  formatGoalOrchSummaryText,
  goalOrchPhaseLabelKey,
  phasesPresentInEvents,
  resolveGoalOrchEmptyState,
  type GoalOrchEvent,
  type GoalOrchPhaseFilter,
} from "@/lib/goalOrch";
import {
  applyClearStallHistoryPlan,
  buildStallHistoryExport,
  buildStallTimelineSnapshot,
  filterStallHistory,
  loadStallHistory,
  planClearStallHistory,
  serializeStallHistoryExport,
  serializeStallTimelineSnapshot,
  STALL_HISTORY_CHANGE_EVENT,
  STALL_HISTORY_STORAGE_KEY,
  type ReliabilityBusySession,
  type ReliabilityCenterView,
  type ReliabilityErrorEntry,
  type ReliabilityStallKind,
  type ReliabilityStallSignal,
  type StallHistoryEntry,
} from "@/lib/reliabilityCenter";
import {
  formatStallDuration,
  planOpenStallSession,
  resolveStallTimelineEmptyState,
} from "@/lib/stallTimelinePro";
import {
  canSupportBundleExport,
  formatSupportBundleManifest,
  planSupportBundleExport,
  resolveSupportBundleEmptyState,
  resolveSupportBundleSoftFail,
  resolveSupportBundleStallJson,
  type SupportBundleExportPlan,
} from "@/lib/supportBundlePro";

export type ReliabilityCenterModalProps = {
  open: boolean;
  onClose: () => void;
  locale: Locale;
  view: ReliabilityCenterView;
  onOpenDoctor: () => void;
  /** Jump to a busy / stall session (optional). */
  onSelectSession?: (sessionId: string) => void;
  /**
   * Session ids currently known (sidebar / list). Enables Open session on
   * stall timeline rows when the chat still exists.
   */
  existingSessionIds?: ReadonlySet<string> | readonly string[];
  /**
   * Display-only: show Goal orchestration section (CLI goal_updated events).
   * Default true when omitted.
   */
  goalOrchUiEnabled?: boolean;
  /** In-memory ring of observed goal phase events (never invented). */
  goalOrchEvents?: GoalOrchEvent[];
  /** Last process_limit toast context for process-budget honesty. */
  lastProcessLimit?: ProcessLimitEvent | null;
};

type StallKindFilter = "all" | ReliabilityStallKind;

function formatWhen(ms: number, locale: Locale): string {
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(
      intlLocale(locale),
      { dateStyle: "short", timeStyle: "medium" },
    );
  } catch {
    return "";
  }
}

function busyStatusKey(status: ReliabilityBusySession["status"]): MessageKey {
  switch (status) {
    case "streaming":
      return "tasks.activity.streaming";
    case "awaiting_permission":
      return "tasks.activity.permission";
    case "connecting":
      return "tasks.activity.connecting";
    default:
      return "tasks.activity.other";
  }
}

function stallKindKey(kind: ReliabilityStallSignal["kind"]): MessageKey {
  switch (kind) {
    case "active":
      return "reliability.stall.kind.active";
    case "hard_end":
      return "reliability.stall.kind.hardEnd";
    case "terminal":
      return "reliability.stall.kind.terminal";
    case "end_of_turn":
      return "reliability.stall.kind.endOfTurn";
    default:
      return "reliability.stall.kind.terminal";
  }
}

function GoalOrchRow({
  event,
  t,
  locale,
}: {
  event: GoalOrchEvent;
  t: ReturnType<typeof createT>;
  locale: Locale;
}) {
  const when = formatWhen(event.at, locale);
  return (
    <li className="reliab-card__row" data-testid="reliab-goal-row">
      <div className="reliab-card__row-main">
        <span className="reliab-card__dot reliab-card__dot--busy" aria-hidden />
        <span className="reliab-card__name" title={event.label}>
          {t(goalOrchPhaseLabelKey(event.phase))}
        </span>
        <span className="reliab-card__meta">{event.label}</span>
      </div>
      {event.detail ? (
        <div className="reliab-card__sub" title={event.detail}>
          {event.detail}
        </div>
      ) : null}
      <div className="reliab-card__sub reliab-card__sub--muted">
        {[
          event.deliverableProgress
            ? t("reliability.goal.progress", {
                progress: event.deliverableProgress,
              })
            : null,
          event.goalId
            ? t("reliability.goal.id", { id: event.goalId })
            : null,
          when,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </li>
  );
}

function BusyRow({
  row,
  t,
  onSelect,
}: {
  row: ReliabilityBusySession;
  t: ReturnType<typeof createT>;
  onSelect?: (sessionId: string) => void;
}) {
  return (
    <li className="reliab-card__row">
      <div className="reliab-card__row-main">
        <span
          className={
            "reliab-card__dot" +
            (row.status === "awaiting_permission"
              ? " reliab-card__dot--warn"
              : " reliab-card__dot--busy")
          }
          aria-hidden
        />
        <span className="reliab-card__name" title={row.title}>
          {row.title}
          {row.isCurrent ? (
            <span className="reliab-card__tag">
              {" "}
              {t("tasks.activity.current")}
            </span>
          ) : null}
        </span>
        <span className="reliab-card__meta">{t(busyStatusKey(row.status))}</span>
      </div>
      {row.liveToolTitle ? (
        <div className="reliab-card__sub" title={row.liveToolTitle}>
          {row.liveToolTitle}
        </div>
      ) : null}
      {!row.isCurrent && onSelect ? (
        <div className="reliab-card__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onSelect(row.sessionId)}
          >
            {t("tasks.activity.open")}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function StallRow({
  signal,
  t,
  locale,
  onSelect,
  existingSessionIds,
}: {
  signal: ReliabilityStallSignal | StallHistoryEntry;
  t: ReturnType<typeof createT>;
  locale: Locale;
  onSelect?: (sessionId: string) => void;
  existingSessionIds?: ReadonlySet<string> | readonly string[];
}) {
  const when = formatWhen(signal.at, locale);
  const durationLabel = formatStallDuration(signal.stallSeconds, locale);
  const secs = durationLabel
    ? t("reliability.stall.seconds", {
        duration: durationLabel,
      })
    : null;
  const openPlan =
    onSelect != null
      ? planOpenStallSession(signal, existingSessionIds)
      : null;

  return (
    <li className="reliab-card__row">
      <div className="reliab-card__row-main">
        <span className="reliab-card__dot reliab-card__dot--warn" aria-hidden />
        <span className="reliab-card__name" title={signal.title ?? undefined}>
          {signal.title || t("reliability.stall.unknownSession")}
        </span>
        <span className="reliab-card__meta">{t(stallKindKey(signal.kind))}</span>
      </div>
      <div className="reliab-card__sub">
        {[
          secs,
          "tier" in signal ? signal.tier : null,
          when,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {openPlan?.ok ? (
        <div className="reliab-card__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onSelect?.(openPlan.sessionId)}
            data-testid="reliab-timeline-open-session"
            title={t("reliability.timeline.openSession")}
          >
            {t("reliability.timeline.openSession")}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function ErrorRow({
  entry,
  locale,
}: {
  entry: ReliabilityErrorEntry;
  locale: Locale;
}) {
  const when = formatWhen(entry.at, locale);
  return (
    <li className="reliab-card__row">
      <div className="reliab-card__row-main">
        <span className="reliab-card__dot reliab-card__dot--err" aria-hidden />
        <span className="reliab-card__name" title={entry.problem}>
          {entry.problem}
        </span>
        {entry.code ? (
          <span className="reliab-card__meta reliab-card__code">{entry.code}</span>
        ) : null}
      </div>
      {entry.cause ? (
        <div className="reliab-card__sub" title={entry.cause}>
          {entry.cause}
        </div>
      ) : null}
      <div className="reliab-card__sub reliab-card__sub--muted">
        {[entry.title, when].filter(Boolean).join(" · ")}
      </div>
    </li>
  );
}

type AuditEventFilter = "all" | AuditLedgerEvent;

function auditDotClass(event: AuditLedgerEvent): string {
  if (event === "permission") return " reliab-card__dot--warn";
  if (event === "tool_end") return " reliab-card__dot--busy";
  return "";
}

async function copyAuditText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function downloadAuditText(filename: string, body: string) {
  const blob = new Blob([body], { type: "application/x-ndjson;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function AuditRow({
  entry,
  t,
  locale,
}: {
  entry: AuditLedgerEntry;
  t: ReturnType<typeof createT>;
  locale: Locale;
}) {
  const when = formatWhen(Date.parse(entry.ts) || 0, locale);
  const meta = [
    entry.permission,
    entry.outcome,
    when,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="reliab-card__row" data-testid="reliab-audit-row">
      <div className="reliab-card__row-main">
        <span
          className={"reliab-card__dot" + auditDotClass(entry.event)}
          aria-hidden
        />
        <span className="reliab-card__name" title={entry.toolName}>
          {entry.toolName}
        </span>
        <span className="reliab-card__meta">{t(auditLedgerEventKey(entry.event))}</span>
      </div>
      {entry.summary ? (
        <div className="reliab-card__sub" title={entry.summary}>
          {entry.summary}
        </div>
      ) : null}
      <div className="reliab-card__sub reliab-card__sub--muted">
        {[
          entry.sessionId
            ? entry.sessionId.slice(0, 8)
            : t("reliability.audit.unknownSession"),
          meta,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </li>
  );
}

function downloadStallHistoryJson(filename: string, body: string) {
  const blob = new Blob([body], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ReliabilityCenterModal({
  open,
  onClose,
  locale,
  view,
  onOpenDoctor,
  onSelectSession,
  existingSessionIds,
  goalOrchUiEnabled = true,
  goalOrchEvents = [],
  lastProcessLimit = null,
}: ReliabilityCenterModalProps) {
  const t = useMemo(() => createT(locale), [locale]);
  const [busy, setBusy] = useState<
    | "zip"
    | "audit-export"
    | "audit-clear"
    | "audit-copy"
    | "goal-copy"
    | "stall-export"
    | null
  >(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [stallHistory, setStallHistory] = useState<StallHistoryEntry[]>(() =>
    loadStallHistory(),
  );
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyKind, setHistoryKind] = useState<StallKindFilter>("all");
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [confirmSupportZip, setConfirmSupportZip] = useState(false);

  const [auditEntries, setAuditEntries] = useState<AuditLedgerEntry[]>([]);
  const [auditQuery, setAuditQuery] = useState("");
  const [auditEvent, setAuditEvent] = useState<AuditEventFilter>("all");
  const [auditSession, setAuditSession] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [confirmClearAudit, setConfirmClearAudit] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  const [goalPhaseFilter, setGoalPhaseFilter] =
    useState<GoalOrchPhaseFilter>("all");

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const raw = await api.auditLedgerList(200);
      setAuditEntries(parseAuditLedgerList(raw, 200));
    } catch {
      setErrorMsg(t("reliability.audit.loadFail"));
      setAuditEntries([]);
    } finally {
      setAuditLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    setStatusMsg(null);
    setErrorMsg(null);
    setBusy(null);
    setHistoryQuery("");
    setHistoryKind("all");
    setConfirmClearHistory(false);
    setConfirmSupportZip(false);
    setStallHistory(loadStallHistory());
    setAuditQuery("");
    setAuditEvent("all");
    setAuditSession("");
    setAuditFrom("");
    setAuditTo("");
    setConfirmClearAudit(false);
    setGoalPhaseFilter("all");
    void loadAudit();
  }, [open, loadAudit]);

  useEffect(() => {
    if (!open) return;
    const refresh = () => setStallHistory(loadStallHistory());
    const onChange = () => refresh();
    window.addEventListener(STALL_HISTORY_CHANGE_EVENT, onChange);
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === STALL_HISTORY_STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(STALL_HISTORY_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (confirmSupportZip) {
          setConfirmSupportZip(false);
          return;
        }
        if (confirmClearHistory) {
          setConfirmClearHistory(false);
          return;
        }
        if (confirmClearAudit) {
          setConfirmClearAudit(false);
          return;
        }
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, confirmClearHistory, confirmClearAudit, confirmSupportZip]);

  const filteredHistory = useMemo(
    () =>
      filterStallHistory(stallHistory, {
        query: historyQuery,
        kind: historyKind,
      }),
    [stallHistory, historyQuery, historyKind],
  );

  const timelineEmpty = useMemo(
    () =>
      resolveStallTimelineEmptyState({
        total: stallHistory.length,
        filtered: filteredHistory.length,
        query: historyQuery,
        kind: historyKind,
      }),
    [stallHistory.length, filteredHistory.length, historyQuery, historyKind],
  );

  const clearHistoryPlan = useMemo(
    () => planClearStallHistory(stallHistory),
    [stallHistory],
  );

  const filteredAudit = useMemo(
    () =>
      filterAuditLedger(auditEntries, {
        query: auditQuery,
        event: auditEvent,
        sessionId: auditSession,
        fromTs: auditFrom || null,
        toTs: auditTo || null,
      }),
    [auditEntries, auditQuery, auditEvent, auditSession, auditFrom, auditTo],
  );

  /** Session-unfiltered ring (Reliability shows all observed sessions). */
  const goalSessionEvents = useMemo(
    () => filterGoalOrchEvents(goalOrchEvents),
    [goalOrchEvents],
  );

  const goalOrchView = useMemo(
    () =>
      assembleGoalOrchView({
        events: goalOrchEvents,
        phase: goalPhaseFilter,
      }),
    [goalOrchEvents, goalPhaseFilter],
  );

  const goalEmpty = useMemo(
    () =>
      resolveGoalOrchEmptyState({
        uiEnabled: goalOrchUiEnabled,
        totalCount: goalSessionEvents.length,
        filteredCount: goalOrchView.count,
        phaseFilter: goalPhaseFilter,
      }),
    [
      goalOrchUiEnabled,
      goalSessionEvents.length,
      goalOrchView.count,
      goalPhaseFilter,
    ],
  );

  /** Phase chips: only observed phases (plus "all" in the render). */
  const goalPhaseChips = useMemo(
    () => phasesPresentInEvents(goalSessionEvents),
    [goalSessionEvents],
  );

  const onCopyGoalSummary = useCallback(async () => {
    setBusy("goal-copy");
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const text = formatGoalOrchSummaryText(goalOrchView.events, {
        title: t("reliability.goal.title"),
        generatedAt: new Date().toISOString(),
      });
      await navigator.clipboard.writeText(text);
      setStatusMsg(t("reliability.goal.copied"));
    } catch (e) {
      setErrorMsg(`${t("reliability.goal.copyFail")}: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }, [goalOrchView.events, t]);

  /** Honest support-zip plan (never invents stall/logs/secrets). */
  const supportPlan: SupportBundleExportPlan = useMemo(() => {
    const hasStall = view.stalls.signals.length > 0;
    return planSupportBundleExport({
      // Host always collects a Doctor report when UI passes null.
      hasDoctor: true,
      hasStallTimeline: hasStall,
      // Audit ledger is a separate export — mark omitted when rows exist.
      hasAudit: auditEntries.length > 0,
      isHost: api.isTauri(),
    });
  }, [view.stalls.signals.length, auditEntries.length]);

  const supportManifestText = useMemo(
    () => formatSupportBundleManifest(supportPlan),
    [supportPlan],
  );

  const supportEmpty = useMemo(
    () =>
      resolveSupportBundleEmptyState({
        isHost: api.isTauri(),
        hasDoctor: supportPlan.hasDoctor,
        hasStallTimeline: supportPlan.hasStallTimeline,
        hasAudit: supportPlan.auditOmitted,
      }),
    [supportPlan],
  );

  const onSupportZipRequest = useCallback(() => {
    setStatusMsg(null);
    setErrorMsg(null);
    if (supportEmpty) {
      setErrorMsg(
        `${t(supportEmpty.titleKey as MessageKey)}. ${t(supportEmpty.hintKey as MessageKey)}`,
      );
      return;
    }
    if (
      !canSupportBundleExport({
        isHost: api.isTauri(),
        busy: !!busy,
      })
    ) {
      return;
    }
    setConfirmSupportZip(true);
  }, [supportEmpty, t, busy]);

  const doSupportZip = useCallback(async () => {
    setConfirmSupportZip(false);
    setBusy("zip");
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      // Structured stall timeline only when signals exist — never invent rows.
      const timeline = buildStallTimelineSnapshot(view.stalls.signals);
      const stallJson = resolveSupportBundleStallJson({
        hasStallTimeline: supportPlan.hasStallTimeline,
        stallJson: serializeStallTimelineSnapshot(timeline),
        signalCount: timeline.count,
      });
      // Host builds Doctor when null; UI does not invent a doctor payload.
      const res = await api.exportSupportBundle(null, stallJson);
      setStatusMsg(`${t("doctor.supportZipDone")}: ${res.path}`);
    } catch (e) {
      const soft = resolveSupportBundleSoftFail(e);
      if (soft.silent) return;
      const base = t(soft.messageKey as MessageKey);
      setErrorMsg(soft.detail ? `${base}: ${soft.detail}` : base);
    } finally {
      setBusy(null);
    }
  }, [t, view.stalls.signals, supportPlan.hasStallTimeline]);

  const onExportStallHistory = useCallback(() => {
    setBusy("stall-export");
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      if (filteredHistory.length === 0) {
        setErrorMsg(t("reliability.timeline.exportEmpty"));
        return;
      }
      const snap = buildStallHistoryExport(filteredHistory, {
        query: historyQuery,
        kind: historyKind,
      });
      const body = serializeStallHistoryExport(snap);
      const stamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, "-");
      downloadStallHistoryJson(`grok-app-stall-timeline-${stamp}.json`, body);
      setStatusMsg(
        t("reliability.timeline.exportDone", { count: snap.count }),
      );
    } catch (e) {
      setErrorMsg(`${t("reliability.timeline.exportFail")}: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }, [t, filteredHistory, historyQuery, historyKind]);

  const doClearHistory = useCallback(() => {
    const plan = planClearStallHistory(loadStallHistory());
    applyClearStallHistoryPlan(plan);
    setStallHistory([]);
    setConfirmClearHistory(false);
    setStatusMsg(
      t("reliability.timeline.clearDone", { count: plan.count }),
    );
  }, [t]);

  const doClearAudit = useCallback(async () => {
    setBusy("audit-clear");
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      await api.auditLedgerClear();
      setAuditEntries([]);
      setConfirmClearAudit(false);
      setStatusMsg(t("reliability.audit.clearDone"));
    } catch (e) {
      setErrorMsg(`${t("reliability.audit.clearFail")}: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }, [t]);

  const auditExportFilter = useMemo(
    () =>
      toAuditLedgerExportFilter({
        event: auditEvent,
        sessionId: auditSession,
        fromTs: auditFrom || null,
        toTs: auditTo || null,
      }),
    [auditEvent, auditSession, auditFrom, auditTo],
  );

  const onExportAudit = useCallback(async () => {
    setBusy("audit-export");
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await api.auditLedgerExport(auditExportFilter);
      setStatusMsg(
        t("reliability.audit.exportDone", {
          path: res.path ?? "",
        }),
      );
    } catch (e) {
      setErrorMsg(`${t("reliability.audit.exportFail")}: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }, [t, auditExportFilter]);

  const onCopyAudit = useCallback(async () => {
    setBusy("audit-copy");
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const body = serializeAuditLedgerJsonl(filteredAudit);
      if (!body.trim()) {
        setErrorMsg(t("reliability.audit.exportEmpty"));
        return;
      }
      const ok = await copyAuditText(body);
      setStatusMsg(
        ok ? t("reliability.audit.copyDone") : t("reliability.audit.copyFail"),
      );
      if (!ok) setErrorMsg(t("reliability.audit.copyFail"));
    } catch (e) {
      setErrorMsg(`${t("reliability.audit.copyFail")}: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }, [t, filteredAudit]);

  const onDownloadAudit = useCallback(() => {
    setStatusMsg(null);
    setErrorMsg(null);
    const body = serializeAuditLedgerJsonl(filteredAudit);
    if (!body.trim()) {
      setErrorMsg(t("reliability.audit.exportEmpty"));
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadAuditText(`grok-app-audit-ledger-${stamp}.jsonl`, body);
    setStatusMsg(t("reliability.audit.downloadDone"));
  }, [t, filteredAudit]);

  const openDoctor = () => {
    onClose();
    onOpenDoctor();
  };

  if (!open) return null;

  const historyChips: { id: StallKindFilter; label: string }[] = [
    { id: "all", label: t("reliability.timeline.filterAll") },
    { id: "active", label: t("reliability.stall.kind.active") },
    { id: "hard_end", label: t("reliability.stall.kind.hardEnd") },
    { id: "terminal", label: t("reliability.stall.kind.terminal") },
    { id: "end_of_turn", label: t("reliability.stall.kind.endOfTurn") },
  ];

  const auditChips: { id: AuditEventFilter; label: string }[] = [
    { id: "all", label: t("reliability.audit.filterAll") },
    {
      id: "permission",
      label: t("reliability.audit.event.permission"),
    },
    {
      id: "tool_start",
      label: t("reliability.audit.event.toolStart"),
    },
    {
      id: "tool_end",
      label: t("reliability.audit.event.toolEnd"),
    },
  ];

  const goalChips: { id: GoalOrchPhaseFilter; label: string }[] = [
    { id: "all", label: t("reliability.goal.filterAll") },
    ...goalPhaseChips.map((p) => ({
      id: p as GoalOrchPhaseFilter,
      label: t(goalOrchPhaseLabelKey(p)),
    })),
  ];



  const clearAuditPortal =
    confirmClearAudit &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        className="overlay app-dialog-overlay"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setConfirmClearAudit(false);
        }}
      >
        <div
          className="modal app-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reliab-audit-clear-title"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header className="modal-head">
            <h2 id="reliab-audit-clear-title" className="modal-title">
              {t("reliability.audit.clearConfirmTitle")}
            </h2>
            <button
              type="button"
              className="icon-btn modal-close"
              onClick={() => setConfirmClearAudit(false)}
              aria-label={t("common.cancel")}
            >
              <IconClose size={16} />
            </button>
          </header>
          <div className="app-dialog__form">
            <p className="app-dialog__msg">
              {t("reliability.audit.clearConfirmMessage")}
            </p>
            <div className="app-dialog__actions modal-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setConfirmClearAudit(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={busy === "audit-clear"}
                onClick={() => void doClearAudit()}
                data-testid="reliab-audit-clear-confirm"
              >
                {t("reliability.audit.clearConfirmAction")}
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <div
      className="overlay doctor-modal-overlay reliab-modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal doctor-modal reliab-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reliab-modal-title"
      >
        <header className="doctor-modal__head">
          <div className="doctor-modal__title-row">
            <IconActivity size={18} />
            <h2 id="reliab-modal-title">{t("reliability.title")}</h2>
          </div>
          <button
            type="button"
            className="icon-btn modal-close doctor-modal__close"
            onClick={onClose}
            aria-label={t("reliability.close")}
          >
            <IconClose size={16} />
          </button>
        </header>

        <p className="reliab-modal__lead">{t("reliability.lead")}</p>

        {(statusMsg || errorMsg) && (
          <div className="doctor-modal__summary" aria-live="polite">
            {statusMsg ? (
              <p className="doctor-modal__status" role="status">
                {statusMsg}
              </p>
            ) : null}
            {errorMsg ? (
              <p className="doctor-modal__status doctor-modal__status--error">
                {errorMsg}
              </p>
            ) : null}
          </div>
        )}

        <div className="doctor-modal__body reliab-modal__body">
          {view.empty &&
          stallHistory.length === 0 &&
          auditEntries.length === 0 &&
          goalSessionEvents.length === 0 ? (
            <div className="reliab-empty" role="status">
              <IconAlertTriangle size={20} className="reliab-empty__icon" />
              <p className="reliab-empty__title">{t("reliability.empty.title")}</p>
              <p className="reliab-empty__body">{t("reliability.empty.body")}</p>
            </div>
          ) : null}

          <ProcessBudgetPanel
            locale={locale}
            active={open}
            variant="card"
            lastProcessLimit={lastProcessLimit}
            id="reliab-process-budget"
          />
          {goalOrchUiEnabled ? (
            <section
              className="reliab-card"
              aria-labelledby="reliab-goal-title"
              data-testid="reliab-goal-orch"
            >
              <header className="reliab-card__head">
                <h3 id="reliab-goal-title" className="reliab-card__title">
                  {t("reliability.goal.title")}
                </h3>
                <span className="reliab-card__count">
                  {t("reliability.goal.count", {
                    count: goalOrchView.count,
                  })}
                </span>
              </header>
              <p className="reliab-card__empty" style={{ marginBottom: 8 }}>
                {t("reliability.goal.lead")}
              </p>

              {goalSessionEvents.length > 0 ? (
                <>
                  <div className="reliab-timeline__toolbar">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={!!busy || goalOrchView.count === 0}
                      onClick={() => void onCopyGoalSummary()}
                      data-testid="reliab-goal-copy"
                    >
                      {busy === "goal-copy"
                        ? "…"
                        : t("reliability.goal.copySummary")}
                    </button>
                    {goalPhaseFilter !== "all" ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setGoalPhaseFilter("all")}
                        data-testid="reliab-goal-clear-filter"
                      >
                        {t("reliability.goal.clearFilter")}
                      </button>
                    ) : null}
                  </div>

                  {goalPhaseChips.length > 0 ? (
                    <div
                      className="reliab-timeline__chips settings-seg"
                      role="tablist"
                      aria-label={t("reliability.goal.filterAria")}
                    >
                      {goalChips.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          role="tab"
                          className={
                            "settings-seg__btn reliab-timeline__chip" +
                            (goalPhaseFilter === c.id ? " is-on" : "")
                          }
                          aria-selected={goalPhaseFilter === c.id}
                          data-testid={`reliab-goal-filter-${c.id}`}
                          onClick={() => setGoalPhaseFilter(c.id)}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}

              {goalEmpty ? (
                <div className="reliab-card__empty" role="status">
                  <p>{t(goalEmpty.titleKey)}</p>
                  <p className="reliab-card__sub--muted">{t(goalEmpty.hintKey)}</p>
                  {goalEmpty.showClearFilters ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      style={{ marginTop: 8 }}
                      onClick={() => setGoalPhaseFilter("all")}
                      data-testid="reliab-goal-clear-filter-empty"
                    >
                      {t("reliability.goal.clearFilter")}
                    </button>
                  ) : null}
                </div>
              ) : (
                <ul className="reliab-card__list">
                  {goalOrchView.events.map((ev) => (
                    <GoalOrchRow
                      key={ev.id}
                      event={ev}
                      t={t}
                      locale={locale}
                    />
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <section className="reliab-card" aria-labelledby="reliab-busy-title">
            <header className="reliab-card__head">
              <h3 id="reliab-busy-title" className="reliab-card__title">
                {t("reliability.busy.title")}
              </h3>
              <span className="reliab-card__count">
                {t("reliability.busy.count", { count: view.busy.count })}
              </span>
            </header>
            {view.hasBusy ? (
              <ul className="reliab-card__list">
                {view.busy.sessions.map((row) => (
                  <BusyRow
                    key={row.sessionId}
                    row={row}
                    t={t}
                    onSelect={onSelectSession}
                  />
                ))}
              </ul>
            ) : (
              <p className="reliab-card__empty">{t("reliability.busy.empty")}</p>
            )}
          </section>

          <section className="reliab-card" aria-labelledby="reliab-stall-title">
            <header className="reliab-card__head">
              <h3 id="reliab-stall-title" className="reliab-card__title">
                {t("reliability.stalls.title")}
              </h3>
              <span className="reliab-card__count">
                {t("reliability.stalls.count", { count: view.stalls.count })}
              </span>
            </header>
            {view.hasStalls ? (
              <ul className="reliab-card__list">
                {view.stalls.signals.map((s) => (
                  <StallRow
                    key={s.id}
                    signal={s}
                    t={t}
                    locale={locale}
                    onSelect={onSelectSession}
                    existingSessionIds={existingSessionIds}
                  />
                ))}
              </ul>
            ) : (
              <p className="reliab-card__empty">{t("reliability.stalls.empty")}</p>
            )}
          </section>

          <section
            className="reliab-card"
            aria-labelledby="reliab-timeline-title"
            data-testid="reliab-timeline-section"
          >
            <header className="reliab-card__head">
              <h3 id="reliab-timeline-title" className="reliab-card__title">
                {t("reliability.timeline.title")}
              </h3>
              <span className="reliab-card__count">
                {t("reliability.timeline.count", {
                  count: stallHistory.length,
                })}
              </span>
            </header>

            {stallHistory.length === 0 ? (
              <div
                className="reliab-card__empty"
                role="status"
                data-testid="reliab-timeline-empty"
              >
                <p>{t("reliability.timeline.empty")}</p>
                <p className="reliab-card__sub reliab-card__sub--muted">
                  {t("reliability.timeline.emptyHint")}
                </p>
              </div>
            ) : (
              <>
                <div className="reliab-timeline__toolbar">
                  <label className="reliab-timeline__search">
                    <span className="sr-only">
                      {t("reliability.timeline.searchPlaceholder")}
                    </span>
                    <input
                      type="search"
                      className="reliab-timeline__search-input"
                      value={historyQuery}
                      onChange={(e) => setHistoryQuery(e.target.value)}
                      placeholder={t("reliability.timeline.searchPlaceholder")}
                      autoComplete="off"
                      data-testid="reliab-timeline-search"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={!!busy || filteredHistory.length === 0}
                    onClick={onExportStallHistory}
                    data-testid="reliab-timeline-export"
                    title={t("reliability.timeline.export")}
                  >
                    {busy === "stall-export"
                      ? "…"
                      : t("reliability.timeline.export")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={!!busy || stallHistory.length === 0}
                    onClick={() => setConfirmClearHistory(true)}
                    data-testid="reliab-timeline-clear"
                  >
                    {t("reliability.timeline.clear")}
                  </button>
                </div>

                <div
                  className="reliab-timeline__chips settings-seg"
                  role="tablist"
                  aria-label={t("reliability.timeline.filterAria")}
                >
                  {historyChips.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="tab"
                      className={
                        "settings-seg__btn reliab-timeline__chip" +
                        (historyKind === c.id ? " is-on" : "")
                      }
                      aria-selected={historyKind === c.id}
                      data-testid={`reliab-timeline-filter-${c.id}`}
                      onClick={() => setHistoryKind(c.id)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>

                {timelineEmpty ? (
                  <div
                    className="reliab-card__empty"
                    role="status"
                    data-testid="reliab-timeline-filter-empty"
                  >
                    <p>{t(timelineEmpty.titleKey as MessageKey)}</p>
                    {timelineEmpty.hintKey ? (
                      <p className="reliab-card__sub reliab-card__sub--muted">
                        {t(timelineEmpty.hintKey as MessageKey)}
                      </p>
                    ) : null}
                    {timelineEmpty.showClearFilters ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        style={{ marginTop: 8 }}
                        onClick={() => {
                          setHistoryQuery("");
                          setHistoryKind("all");
                        }}
                        data-testid="reliab-timeline-clear-filters"
                      >
                        {t("reliability.timeline.clearFilters")}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <ul className="reliab-card__list">
                    {filteredHistory.map((s) => (
                      <StallRow
                        key={s.id}
                        signal={s}
                        t={t}
                        locale={locale}
                        onSelect={onSelectSession}
                        existingSessionIds={existingSessionIds}
                      />
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className="reliab-card" aria-labelledby="reliab-err-title">
            <header className="reliab-card__head">
              <h3 id="reliab-err-title" className="reliab-card__title">
                {t("reliability.errors.title")}
              </h3>
              <span className="reliab-card__count">
                {t("reliability.errors.count", { count: view.errors.count })}
              </span>
            </header>
            {view.hasErrors ? (
              <ul className="reliab-card__list">
                {view.errors.entries.map((e) => (
                  <ErrorRow key={e.id} entry={e} locale={locale} />
                ))}
              </ul>
            ) : (
              <p className="reliab-card__empty">{t("reliability.errors.empty")}</p>
            )}
          </section>

          <section
            className="reliab-card"
            aria-labelledby="reliab-audit-title"
            data-testid="reliab-audit-section"
          >
            <header className="reliab-card__head">
              <h3 id="reliab-audit-title" className="reliab-card__title">
                {t("reliability.audit.title")}
              </h3>
              <span className="reliab-card__count">
                {t("reliability.audit.count", {
                  count: auditEntries.length,
                })}
              </span>
            </header>
            <p className="reliab-card__empty" style={{ marginBottom: 8 }}>
              {t("reliability.audit.lead")}
            </p>

            <div className="reliab-timeline__toolbar">
              <label className="reliab-timeline__search">
                <span className="sr-only">
                  {t("reliability.audit.searchPlaceholder")}
                </span>
                <input
                  type="search"
                  className="reliab-timeline__search-input"
                  value={auditQuery}
                  onChange={(e) => setAuditQuery(e.target.value)}
                  placeholder={t("reliability.audit.searchPlaceholder")}
                  autoComplete="off"
                  data-testid="reliab-audit-search"
                />
              </label>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!!busy || auditLoading}
                onClick={() => void loadAudit()}
                data-testid="reliab-audit-refresh"
              >
                {auditLoading ? "…" : t("reliability.audit.refresh")}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!!busy || filteredAudit.length === 0}
                onClick={() => void onCopyAudit()}
                data-testid="reliab-audit-copy"
                title={t("reliability.audit.copy")}
              >
                {busy === "audit-copy" ? "…" : t("reliability.audit.copy")}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!!busy || filteredAudit.length === 0}
                onClick={onDownloadAudit}
                data-testid="reliab-audit-download"
                title={t("reliability.audit.download")}
              >
                {t("reliability.audit.download")}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!!busy || filteredAudit.length === 0}
                onClick={() => void onExportAudit()}
                data-testid="reliab-audit-export"
                title={t("reliability.audit.export")}
              >
                {busy === "audit-export" ? "…" : t("reliability.audit.export")}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!!busy || auditEntries.length === 0}
                onClick={() => setConfirmClearAudit(true)}
                data-testid="reliab-audit-clear"
              >
                {t("reliability.audit.clear")}
              </button>
            </div>

            <div
              className="reliab-timeline__chips settings-seg"
              role="tablist"
              aria-label={t("reliability.audit.filterAria")}
            >
              {auditChips.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  className={
                    "settings-seg__btn reliab-timeline__chip" +
                    (auditEvent === c.id ? " is-on" : "")
                  }
                  aria-selected={auditEvent === c.id}
                  data-testid={`reliab-audit-filter-${c.id}`}
                  onClick={() => setAuditEvent(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div
              className="reliab-timeline__toolbar"
              style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}
            >
              <label className="reliab-timeline__search" style={{ minWidth: 120 }}>
                <span className="sr-only">
                  {t("reliability.audit.sessionPlaceholder")}
                </span>
                <input
                  type="search"
                  className="reliab-timeline__search-input"
                  value={auditSession}
                  onChange={(e) => setAuditSession(e.target.value)}
                  placeholder={t("reliability.audit.sessionPlaceholder")}
                  autoComplete="off"
                  data-testid="reliab-audit-session"
                />
              </label>
              <label className="reliab-audit__date">
                <span className="sr-only">{t("reliability.audit.fromDate")}</span>
                <input
                  type="date"
                  className="reliab-timeline__search-input"
                  value={auditFrom}
                  onChange={(e) => setAuditFrom(e.target.value)}
                  aria-label={t("reliability.audit.fromDate")}
                  data-testid="reliab-audit-from"
                />
              </label>
              <label className="reliab-audit__date">
                <span className="sr-only">{t("reliability.audit.toDate")}</span>
                <input
                  type="date"
                  className="reliab-timeline__search-input"
                  value={auditTo}
                  onChange={(e) => setAuditTo(e.target.value)}
                  aria-label={t("reliability.audit.toDate")}
                  data-testid="reliab-audit-to"
                />
              </label>
            </div>

            {auditEntries.length === 0 ? (
              <p className="reliab-card__empty">
                {t("reliability.audit.empty")}
              </p>
            ) : filteredAudit.length === 0 ? (
              <p className="reliab-card__empty">
                {t("reliability.audit.emptyFilter")}
              </p>
            ) : (
              <ul className="reliab-card__list">
                {filteredAudit.map((e, i) => (
                  <AuditRow
                    key={`${e.ts}-${e.event}-${e.toolName}-${i}`}
                    entry={e}
                    t={t}
                    locale={locale}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="doctor-modal__foot reliab-modal__foot">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={
              !!busy || !canSupportBundleExport({ isHost: api.isTauri() })
            }
            onClick={onSupportZipRequest}
            title={t("reliability.supportZipHint")}
            data-testid="reliab-support-zip"
          >
            {busy === "zip" ? "…" : t("doctor.supportZip")}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={openDoctor}
          >
            <IconDoctor size={14} />
            {t("reliability.openDoctor")}
          </button>
          <span className="doctor-modal__foot-spacer" />
          <button
            type="button"
            className="btn btn--solid btn--sm"
            onClick={onClose}
          >
            {t("common.close")}
          </button>
        </footer>
      </div>
      <GlassModal
        open={confirmClearHistory}
        onClose={() => setConfirmClearHistory(false)}
        title={t("reliability.timeline.clearConfirmTitle")}
        size="sm"
        closeLabel={t("common.cancel")}
        titleId="reliab-stall-history-clear-title"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setConfirmClearHistory(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={doClearHistory}
              data-testid="reliab-timeline-clear-confirm"
            >
              {t("reliability.timeline.clearConfirmAction")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg" style={{ margin: 0, padding: "12px 16px" }}>
          {t("reliability.timeline.clearConfirmMessage", {
            count: clearHistoryPlan.count,
          })}
        </p>
      </GlassModal>
      <GlassModal
        open={confirmSupportZip}
        onClose={() => setConfirmSupportZip(false)}
        title={t("reliability.supportZip.confirmTitle")}
        size="md"
        closeLabel={t("common.cancel")}
        titleId="reliab-support-zip-confirm-title"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setConfirmSupportZip(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => void doSupportZip()}
              disabled={!!busy}
              data-testid="reliab-support-zip-confirm"
            >
              {t("reliability.supportZip.confirmAction")}
            </button>
          </>
        }
      >
        <div
          className="app-dialog__msg"
          style={{ margin: 0, padding: "12px 16px" }}
          data-testid="reliab-support-zip-checklist"
        >
          <p style={{ margin: "0 0 8px" }}>
            {t("reliability.supportZip.confirmMessage")}
          </p>
          <p
            className="reliab-card__sub reliab-card__sub--muted"
            style={{ margin: "0 0 10px" }}
          >
            {t("reliability.supportZip.secretsNever")}
          </p>
          <p style={{ margin: "0 0 6px", fontWeight: 600 }}>
            {t("reliability.supportZip.checklistTitle")}
          </p>
          <ul
            className="reliab-support-checklist"
            style={{
              margin: "0 0 10px",
              padding: "0 0 0 1.1em",
              listStyle: "disc",
            }}
          >
            {supportPlan.sections.map((s) => (
              <li
                key={s.id}
                data-section={s.id}
                data-included={s.included ? "1" : "0"}
                style={{
                  marginBottom: 4,
                  opacity: s.included ? 1 : 0.55,
                }}
              >
                <span aria-hidden>{s.included ? "✓ " : "– "}</span>
                {t(s.labelKey as MessageKey)}
                {s.included && s.redacted
                  ? ` · ${t("reliability.supportZip.redacted")}`
                  : null}
                {!s.included
                  ? ` · ${t("reliability.supportZip.sectionOmitted")}`
                  : s.availability === "when_available"
                    ? ` · ${t("reliability.supportZip.whenAvailable")}`
                    : null}
              </li>
            ))}
          </ul>
          {supportPlan.auditOmitted ? (
            <p
              className="reliab-card__sub reliab-card__sub--muted"
              style={{ margin: "0 0 8px" }}
            >
              {t("reliability.supportZip.auditNotIncluded")}
            </p>
          ) : null}
          <details style={{ marginTop: 4 }}>
            <summary style={{ cursor: "pointer" }}>
              {t("reliability.supportZip.manifestPreview")}
            </summary>
            <pre
              className="reliab-support-manifest"
              style={{
                margin: "8px 0 0",
                padding: 8,
                fontSize: 11,
                lineHeight: 1.4,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 160,
                overflow: "auto",
                borderRadius: 6,
                background: "var(--surface-2, rgba(0,0,0,0.06))",
              }}
              data-testid="reliab-support-manifest"
            >
              {supportManifestText}
            </pre>
          </details>
        </div>
      </GlassModal>
      {clearAuditPortal}
    </div>
  );
}
