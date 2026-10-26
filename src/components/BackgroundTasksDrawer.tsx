/**
 * Background tasks for the open chat, in a column on the right of that chat.
 * The task transcript stays closed until View transcript.
 * Distinct from the tool-step Tasks panel.
 */
import { useEffect, useMemo, useState } from "react";
import { IconClose } from "@/components/icons";
import type { MessageKey } from "@/i18n";
import { intlLocale } from "@/i18n";
import * as api from "@/lib/api";
import {
  backgroundFleetEvents,
  clearFleetFocus,
  FLEET_DRAFT_ID,
  noteFleetRowsForAutoOpen,
  setBackgroundTasksOpen,
  useBackgroundTasks,
} from "@/lib/backgroundTasksStore";
import {
  buildBackgroundFleet,
  fleetElapsedMs,
  fleetInheritsParentModel,
  fleetStopPlan,
  type FleetRow,
} from "@/lib/backgroundFleet";
import { formatTokenCount } from "@/lib/contextUsage";
import { formatStatDuration } from "@/lib/heatmapStats";
import { useSessionSpend } from "@/hooks/useSessionSpend";
import { useSubagents } from "@/hooks/useSubagents";
import { useViewingMessages } from "@/hooks/useSessionTranscript";
import { sessionTranscriptStore } from "@/lib/sessionTranscriptStore";
import {
  applyLiveSubagentTokens,
  phaseGroups,
  presentFleet,
  workflowAgentElapsedMs,
  workflowHeaderStats,
  type WorkflowAgentRecord,
  type WorkflowRunRecord,
} from "@/lib/workflowRunView";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

function formatCount(locale: string, n: number): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(n);
}

function formatElapsedMs(locale: string, ms: number | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const secs = Math.max(0, Math.round(ms / 1000));
  if (secs <= 0) return formatStatDuration(1, locale).replace(/^1/, "0") || "0s";
  return formatStatDuration(secs, locale);
}

function workflowHead(
  run: WorkflowRunRecord | undefined,
  row: FleetRow,
): { agentCount?: number; tokensUsed?: number } {
  if (run) return workflowHeaderStats(run);
  return { agentCount: row.agentCount, tokensUsed: row.tokens };
}

function formatElapsed(locale: string, row: FleetRow, nowMs: number): string | null {
  const ms = fleetElapsedMs(row, nowMs);
  if (ms == null || !Number.isFinite(ms)) return null;
  const secs = Math.max(0, Math.round(ms / 1000));
  if (secs <= 0) return formatStatDuration(1, locale).replace(/^1/, "0") || "0s";
  return formatStatDuration(secs, locale);
}

export function BackgroundFleetList({
  rows,
  sessionBillTokens,
  locale,
  tr,
  nowMs,
  finishedOpen,
  onToggleFinished,
  focusId,
  detailId,
  stopNote,
  onView,
  onStop,
  onReveal,
  onCopyPath,
  copiedPath,
  workflowByRowId,
}: {
  rows: FleetRow[];
  sessionBillTokens?: number;
  locale: string;
  tr: TFn;
  nowMs: number;
  finishedOpen: boolean;
  onToggleFinished: () => void;
  focusId: string | null;
  detailId: string | null;
  stopNote: string | null;
  onView: (row: FleetRow) => void;
  onStop: (row: FleetRow) => void;
  onReveal: (path: string) => void;
  onCopyPath: (path: string) => void;
  copiedPath: string | null;
  workflowByRowId?: ReadonlyMap<string, WorkflowRunRecord>;
}) {
  const running = rows.filter((row) => row.running);
  const finished = rows.filter((row) => !row.running);
  return (
    <div className="chat-fleet__list" data-testid="background-tasks">
      {sessionBillTokens != null && sessionBillTokens > 0 ? (
        <p className="chat-fleet__bill" data-testid="fleet-session-bill">
          {tr("fleet.sessionBill", { n: formatCount(locale, sessionBillTokens) })}
        </p>
      ) : null}
      {stopNote ? (
        <p className="chat-fleet__note" role="status">
          {stopNote}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <div className="chat-fleet__empty">
          <p>{tr("fleet.empty")}</p>
          <p className="chat-fleet__note">{tr("fleet.emptyHint")}</p>
        </div>
      ) : (
        <div>
          <p className="chat-fleet__section">{tr("fleet.section.running")}</p>
          {running.length === 0 ? (
            <p className="chat-fleet__note">{tr("fleet.empty")}</p>
          ) : (
            <ul className="chat-fleet__rows">
              {running.map((row) => (
                <FleetRowView
                  key={row.id}
                  row={row}
                  locale={locale}
                  tr={tr}
                  nowMs={nowMs}
                  focused={focusId === row.id || focusId === row.toolCallId}
                  showTranscript={detailId === row.id}
                  onView={onView}
                  onStop={onStop}
                  onReveal={onReveal}
                  onCopyPath={onCopyPath}
                  copiedPath={copiedPath}
                  run={workflowByRowId?.get(row.id)}
                />
              ))}
            </ul>
          )}
          <button
            type="button"
            className="chat-fleet__section chat-fleet__section-toggle"
            aria-expanded={finishedOpen}
            onClick={onToggleFinished}
          >
            {tr("fleet.finishedCount", { n: finished.length })}
          </button>
          {finishedOpen ? (
            <ul className="chat-fleet__rows">
              {finished.map((row) => (
                <FleetRowView
                  key={row.id}
                  row={row}
                  locale={locale}
                  tr={tr}
                  nowMs={nowMs}
                  focused={focusId === row.id || focusId === row.toolCallId}
                  showTranscript={detailId === row.id}
                  onView={onView}
                  onStop={onStop}
                  onReveal={onReveal}
                  onCopyPath={onCopyPath}
                  copiedPath={copiedPath}
                  run={workflowByRowId?.get(row.id)}
                />
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}

function FleetRowView({
  row,
  locale,
  tr,
  nowMs,
  focused,
  onView,
  showTranscript,
  onStop,
  onReveal,
  onCopyPath,
  copiedPath,
  run,
}: {
  row: FleetRow;
  locale: string;
  tr: TFn;
  nowMs: number;
  focused: boolean;
  showTranscript: boolean;
  onView: (row: FleetRow) => void;
  onStop: (row: FleetRow) => void;
  onReveal: (path: string) => void;
  onCopyPath: (path: string) => void;
  copiedPath: string | null;
  run?: WorkflowRunRecord;
}) {
  const elapsed = formatElapsed(locale, row, nowMs);
  const kindLabel =
    row.kind === "workflow"
      ? tr("fleet.kind.workflow")
      : row.kind === "agent"
        ? tr("fleet.kind.agent")
        : tr("fleet.kind.shell");
  const header = row.kind === "workflow" ? workflowHead(run, row) : null;
  return (
    <li
      className={
        "chat-fleet__row session-row" +
        (row.running ? " is-running" : "") +
        (focused ? " session-row--active" : "")
      }
      data-fleet-row={row.id}
      data-testid={`fleet-row-${row.id}`}
    >
      <div className="chat-fleet__row-main">
        <span className={"agent-tasks__dot" + (row.running ? " agent-tasks__dot--running" : "")} />
        <div className="chat-fleet__copy">
          {header ? (
            <>
              <div className="session-row__title">{row.title}</div>
              <div className="session-row__meta chat-fleet__stats">
                <span className="chat-fleet__kind">{kindLabel}</span>
                {elapsed ? <span data-testid={`fleet-elapsed-${row.id}`}>{elapsed}</span> : null}
                {row.phase ? (
                  <span data-testid={`fleet-phase-${row.id}`}>
                    {tr("fleet.phase", {
                      done: formatCount(locale, row.phase.done),
                      total: formatCount(locale, row.phase.total),
                    })}
                  </span>
                ) : null}
              </div>
              {header.agentCount != null || header.tokensUsed != null ? (
                <div className="session-row__meta chat-fleet__stats">
                  {header.agentCount != null ? (
                    <span data-testid={`fleet-agents-${row.id}`}>
                      {tr("fleet.agents", { n: formatCount(locale, header.agentCount) })}
                    </span>
                  ) : null}
                  {header.tokensUsed != null ? (
                    <span data-testid={`fleet-tokens-${row.id}`}>
                      {tr("fleet.tokens", { n: formatTokenCount(header.tokensUsed, locale) })}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {run?.objective ? <p className="chat-fleet__note">{run.objective}</p> : null}
            </>
          ) : (
            <>
              <div className="session-row__title">
                <span className="chat-fleet__kind">{kindLabel}</span>
                {row.title}
              </div>
              <div className="session-row__meta">
                {elapsed ? <span>{elapsed}</span> : null}
                {row.kind === "agent" ? (
                  <span data-testid={`fleet-model-${row.id}`}>
                    {row.model || (fleetInheritsParentModel(row) ? tr("fleet.model.inherits") : "")}
                  </span>
                ) : null}
                {row.toolCount != null ? (
                  <span data-testid={`fleet-tools-${row.id}`}>
                    {tr("fleet.tools", { n: formatCount(locale, row.toolCount) })}
                  </span>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="chat-fleet__actions">
        <button type="button" className="chat-fleet__text-btn" onClick={() => onView(row)}>
          {tr("fleet.view")}
        </button>
        {row.running ? (
          <button type="button" className="chat-fleet__text-btn" onClick={() => onStop(row)}>
            {tr("fleet.stop")}
          </button>
        ) : null}
      </div>
      {run && row.kind === "workflow" ? (
        <WorkflowPhases locale={locale} tr={tr} run={run} nowMs={nowMs} />
      ) : null}
      {showTranscript ? <FleetTranscript row={row} tr={tr} onReveal={onReveal} onCopyPath={onCopyPath} copiedPath={copiedPath} /> : null}
    </li>
  );
}

function WorkflowPhases({
  locale,
  tr,
  run,
  nowMs,
}: {
  locale: string;
  tr: TFn;
  run: WorkflowRunRecord;
  nowMs: number;
}) {
  const grouped = phaseGroups(run);
  const budget =
    run.agentsUsed != null && run.agentBudget != null
      ? tr("fleet.budget", {
          used: formatCount(locale, run.agentsUsed),
          cap: formatCount(locale, run.agentBudget),
        })
      : null;
  return (
    <div className="chat-fleet__phases" data-testid={`fleet-phases-${run.runId}`}>
      <p className="chat-fleet__section">{tr("fleet.phases")}</p>
      {budget ? <p className="chat-fleet__note">{budget}</p> : null}
      {grouped.phases.map((phase) => {
        const settled =
          phase.agents.length > 0 && phase.agents.every((agent) => !agent.running);
        return (
        <div
          key={phase.title}
          className={
            "chat-fleet__phase" +
            (phase.current ? " is-current" : "") +
            (settled ? " is-settled" : "")
          }
        >
          <div className="chat-fleet__phase-head">
            <p className="chat-fleet__phase-title">{phase.title}</p>
            {phase.agents.length > 0 ? (
              <span className="chat-fleet__phase-count">
                {tr("fleet.phase", {
                  done: formatCount(locale, phase.agents.filter((agent) => !agent.running).length),
                  total: formatCount(locale, phase.agents.length),
                })}
              </span>
            ) : null}
          </div>
          {phase.agents.length === 0 ? (
            phase.current ? <p className="chat-fleet__note">{tr("fleet.phaseEmpty")}</p> : null
          ) : (
            <div className="chat-fleet__phase-table">
              <div className="chat-fleet__phase-row chat-fleet__phase-row--head">
                <span />
                <span>{tr("fleet.col.model")}</span>
                <span>{tr("fleet.col.tokens")}</span>
                <span>{tr("fleet.col.time")}</span>
              </div>
              {phase.agents.map((agent) => (
                <WorkflowAgent
                  key={agent.agentId}
                  locale={locale}
                  tr={tr}
                  agent={agent}
                  nowMs={nowMs}
                />
              ))}
            </div>
          )}
        </div>
        );
      })}
      {grouped.ungrouped.length > 0 ? (
        <div className="chat-fleet__phase-table">
          <div className="chat-fleet__phase-row chat-fleet__phase-row--head">
            <span />
            <span>{tr("fleet.col.model")}</span>
            <span>{tr("fleet.col.tokens")}</span>
            <span>{tr("fleet.col.time")}</span>
          </div>
          {grouped.ungrouped.map((agent) => (
            <WorkflowAgent
              key={agent.agentId}
              locale={locale}
              tr={tr}
              agent={agent}
              nowMs={nowMs}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WorkflowAgent({
  locale,
  tr,
  agent,
  nowMs,
}: {
  locale: string;
  tr: TFn;
  agent: WorkflowAgentRecord;
  nowMs: number;
}) {
  const elapsed = formatElapsedMs(locale, workflowAgentElapsedMs(agent, nowMs));
  const dot = agentDotClass(agent);
  const settled = !agent.running;
  return (
    <div
      className={"chat-fleet__phase-row" + (settled ? " is-settled" : " is-running")}
      data-testid={`fleet-phase-agent-${agent.agentId}`}
    >
      <span className="chat-fleet__agent-name">
        <span className={"agent-tasks__dot" + (dot ? " " + dot : "")} />
        <span className="chat-fleet__agent-label">{agent.label}</span>
      </span>
      <span className="chat-fleet__cell" data-testid={`fleet-phase-model-${agent.agentId}`}>
        {agent.model || tr("fleet.model.inherits")}
      </span>
      <span
        className="chat-fleet__cell chat-fleet__cell--num"
        data-testid={`fleet-phase-tokens-${agent.agentId}`}
      >
        {agent.tokensUsed != null ? formatCount(locale, agent.tokensUsed) : ""}
      </span>
      <span
        className="chat-fleet__cell chat-fleet__cell--num chat-fleet__cell--time"
        data-testid={`fleet-phase-time-${agent.agentId}`}
      >
        {elapsed ?? ""}
      </span>
    </div>
  );
}

function agentDotClass(agent: WorkflowAgentRecord): string {
  if (agent.running) return "agent-tasks__dot--running";
  switch (agent.state.trim().toLowerCase()) {
    case "failed":
    case "error":
      return "agent-tasks__dot--failed";
    case "cancelled":
    case "canceled":
    case "interrupted":
      return "agent-tasks__dot--cancelled";
    case "done":
    case "completed":
    case "complete":
    case "success":
      return "agent-tasks__dot--completed";
    default:
      return "";
  }
}

function FleetTranscript({
  row,
  tr,
  onReveal,
  onCopyPath,
  copiedPath,
}: {
  row: FleetRow;
  tr: TFn;
  onReveal: (path: string) => void;
  onCopyPath: (path: string) => void;
  copiedPath: string | null;
}) {
  const hasBody = Boolean(
    row.prompt || row.summary || row.activity || row.lastLine || row.completion || row.outputFile,
  );
  return (
    <div className="chat-fleet__transcript" data-testid={`fleet-transcript-${row.id}`}>
      {row.prompt ? (
        <>
          <p className="chat-fleet__section">{tr("fleet.viewPrompt")}</p>
          <pre className="chat-fleet__pre">{row.prompt}</pre>
        </>
      ) : null}
      {row.summary && row.summary !== row.title && row.summary !== row.prompt ? (
        <pre className="chat-fleet__pre">{row.summary}</pre>
      ) : null}
      {row.activity ? <p className="chat-fleet__note">{row.activity}</p> : null}
      {row.lastLine ? (
        <p className="chat-fleet__note">
          {tr("fleet.lastLine")}: {row.lastLine}
        </p>
      ) : null}
      {row.completion ? (
        <>
          <p className="chat-fleet__section">{tr("fleet.viewSummary")}</p>
          <pre className="chat-fleet__pre">{row.completion}</pre>
        </>
      ) : null}
      {row.outputFile ? (
        <div className="chat-fleet__actions">
          <span className="chat-fleet__note">
            {tr("fleet.outputFile")}: {row.outputFile}
          </span>
          <button type="button" className="chat-fleet__text-btn" onClick={() => onCopyPath(row.outputFile!)}>
            {copiedPath === row.outputFile ? tr("fleet.copied") : tr("fleet.copyPath")}
          </button>
          <button type="button" className="chat-fleet__text-btn" onClick={() => onReveal(row.outputFile!)}>
            {tr("fleet.reveal")}
          </button>
        </div>
      ) : null}
      {!hasBody ? <p className="chat-fleet__note">{tr("fleet.noChildSession")}</p> : null}
    </div>
  );
}

export function BackgroundTasksPane({
  locale,
  tr,
}: {
  locale: string;
  tr: TFn;
}) {
  const ui = useBackgroundTasks();
  const sessionId = ui.sessionId;
  const messages = useViewingMessages();
  const spend = useSessionSpend(sessionId);
  const [finishedOpen, setFinishedOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [stopNote, setStopNote] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRunRecord[]>([]);
  const liveSubagents = useSubagents(sessionId);

  const fleet = useMemo(() => {
    if (!sessionId) {
      return { rows: [] as FleetRow[], sessionBillTokens: undefined as number | undefined };
    }
    const owner = sessionTranscriptStore.getMessagesOwnerSessionId();
    const source =
      owner === sessionId
        ? messages
        : sessionTranscriptStore.getCached(sessionId) ?? [];
    const bill = spend.totalTokens > 0 ? spend.totalTokens : undefined;
    return buildBackgroundFleet({
      messages: source,
      events: backgroundFleetEvents(sessionId),
      sessionBillTokens: bill,
    });
  }, [messages, sessionId, spend.totalTokens, ui.revision]);

  const runsWithTokens = useMemo(
    () => workflowRuns.map((run) => applyLiveSubagentTokens(run, liveSubagents)),
    [workflowRuns, liveSubagents],
  );

  const presented = useMemo(
    () => presentFleet(fleet.rows, runsWithTokens, nowMs),
    [fleet.rows, runsWithTokens, nowMs],
  );

  useEffect(() => {
    if (!sessionId || sessionId === FLEET_DRAFT_ID || !api.isTauri()) {
      setWorkflowRuns([]);
      return;
    }
    let cancel = false;
    const tick = () => {
      void api.workflowRunsForSession(sessionId).then((next) => {
        if (!cancel) setWorkflowRuns(next);
      }).catch(() => undefined);
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancel = true;
      window.clearInterval(id);
    };
  }, [sessionId]);

  useEffect(() => {
    setDetailId(null);
    setStopNote(null);
    setFinishedOpen(false);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (noteFleetRowsForAutoOpen(sessionId, presented.rows)) {
      setBackgroundTasksOpen(true);
    }
  }, [presented.rows, sessionId]);

  const anyRunning = presented.rows.some((row) => row.running);
  useEffect(() => {
    if (!ui.open || !anyRunning) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ui.open, anyRunning]);

  useEffect(() => {
    if (!ui.open || !ui.focusId) return;
    const row = presented.rows.find(
      (item) => item.id === ui.focusId || item.toolCallId === ui.focusId,
    );
    if (row && !row.running) setFinishedOpen(true);
    const handle = window.requestAnimationFrame(() => {
      const node = document.querySelector(
        `[data-fleet-row="${CSS.escape(row?.id || ui.focusId || "")}"]`,
      );
      if (node instanceof HTMLElement) node.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [ui.open, ui.focusId, presented.rows]);

  if (!sessionId || !ui.open) return null;

  const runningCount = presented.rows.filter((row) => row.running).length;
  const onView = (row: FleetRow) => {
    setDetailId((current) => (current === row.id ? null : row.id));
  };
  const onStop = (row: FleetRow) => {
    const plan = fleetStopPlan({
      taskId: row.id,
      streaming: ui.streaming,
      interjectAvailable: api.isTauri(),
    });
    if (plan.kind === "unavailable") {
      setStopNote(tr(plan.messageKey));
      return;
    }
    void api
      .sessionInterject(plan.text, null, null, sessionId)
      .then(() => setStopNote(tr("fleet.stopQueued", { id: row.id })))
      .catch(() => setStopNote(tr("fleet.stopUnavailable")));
  };

  return (
    <aside
      id="chat-fleet-pane"
      className="chat-fleet-pane"
      aria-label={tr("fleet.title")}
      data-testid="chat-fleet-pane"
    >
      <header className="chat-fleet-pane__head">
        <h2 className="chat-fleet-pane__title">
          <span className={"agent-tasks__dot" + (runningCount > 0 ? " agent-tasks__dot--running" : "")} />
          {tr("fleet.title")}
          {runningCount > 0 ? (
            <span className="chat-fleet__count">{formatCount(locale, runningCount)}</span>
          ) : null}
        </h2>
        <button
          type="button"
          className="icon-btn"
          aria-label={tr("fleet.hide")}
          title={tr("fleet.hide")}
          onClick={() => {
            clearFleetFocus();
            setBackgroundTasksOpen(false);
          }}
        >
          <IconClose size={14} />
        </button>
      </header>
      <div className="chat-fleet-pane__body">
        <BackgroundFleetList
          rows={presented.rows}
          workflowByRowId={presented.byId}
          sessionBillTokens={fleet.sessionBillTokens}
          locale={locale}
          tr={tr}
          nowMs={nowMs}
          finishedOpen={finishedOpen}
          onToggleFinished={() => setFinishedOpen((open) => !open)}
          focusId={ui.focusId}
          detailId={detailId}
          stopNote={stopNote}
          onView={onView}
          onStop={onStop}
          onReveal={(path) => {
            if (!api.isTauri()) return;
            void api.pathReveal(path).catch(() => undefined);
          }}
          onCopyPath={(path) => {
            void navigator.clipboard?.writeText(path).then(() => setCopiedPath(path));
          }}
          copiedPath={copiedPath}
        />
      </div>
    </aside>
  );
}
