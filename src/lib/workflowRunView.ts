/**
 * Group workflow agents by the phase name on each agent record.
 * A later agent with that same name joins the phase. An agent with no phase
 * stays outside the phase list.
 */
import type { FleetRow } from "./backgroundFleet";

export interface WorkflowPhaseRecord {
  title: string;
  detail?: string;
}

export interface WorkflowAgentRecord {
  agentId: string;
  label: string;
  phase?: string;
  state: string;
  running: boolean;
  /** Resolved model. Absent when the sub-agent record has none. */
  model?: string;
  tokensUsed?: number;
  durationMs?: number;
  /** Unix millis from the sub-agent record. Absent until that file exists. */
  startedAtMs?: number;
}

/** One merged `session://subagent` row, limited to the fields this view reads. */
export interface LiveSubagentTokens {
  subagentId: string;
  tokensUsed?: number;
  /** True after a finished update. A progress count must not replace a settled file total. */
  finished?: boolean;
}

export interface WorkflowRunRecord {
  runId: string;
  name: string;
  status: string;
  running: boolean;
  currentPhase?: string;
  agentBudget?: number;
  agentsUsed?: number;
  elapsedMs?: number;
  objective?: string;
  phases: WorkflowPhaseRecord[];
  agents: WorkflowAgentRecord[];
}

export interface PhaseGroup {
  title: string;
  current: boolean;
  agents: WorkflowAgentRecord[];
}

export function phaseGroups(run: WorkflowRunRecord): {
  phases: PhaseGroup[];
  ungrouped: WorkflowAgentRecord[];
} {
  const titles: string[] = [];
  const seen = new Set<string>();
  for (const phase of run.phases) {
    const title = phase.title.trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
  }
  const buckets = new Map<string, WorkflowAgentRecord[]>();
  const ungrouped: WorkflowAgentRecord[] = [];
  for (const agent of run.agents) {
    const phase = agent.phase?.trim() ?? "";
    if (!phase) {
      ungrouped.push(agent);
      continue;
    }
    if (!seen.has(phase)) {
      seen.add(phase);
      titles.push(phase);
    }
    const list = buckets.get(phase) ?? [];
    list.push(agent);
    buckets.set(phase, list);
  }
  const current = run.running ? (run.currentPhase?.trim() ?? "") : "";
  const settled = (agent: WorkflowAgentRecord): WorkflowAgentRecord =>
    run.running ? agent : { ...agent, running: false };
  return {
    phases: titles.map((title) => ({
      title,
      current: title === current,
      agents: (buckets.get(title) ?? []).map(settled),
    })),
    ungrouped: ungrouped.map(settled),
  };
}

/** Wall-clock anchors so a polled elapsed value still ticks between reads. */
const runClockAnchor = new Map<string, number>();
const agentClockLatch = new Map<string, number>();

export function resetWorkflowClocks(): void {
  runClockAnchor.clear();
  agentClockLatch.clear();
}

/**
 * Elapsed time for one workflow session.
 * A running session counts from its start. A finished session keeps its duration.
 */
export function workflowAgentElapsedMs(
  agent: WorkflowAgentRecord,
  nowMs: number,
): number | undefined {
  if (!agent.running) {
    agentClockLatch.delete(agent.agentId);
    return agent.durationMs;
  }
  const recorded = agent.startedAtMs;
  const start =
    recorded != null && Number.isFinite(recorded)
      ? recorded
      : latchedAgentStart(agent.agentId, nowMs);
  return Math.max(0, nowMs - start);
}

function latchedAgentStart(id: string, nowMs: number): number {
  const existing = agentClockLatch.get(id);
  if (existing != null) return existing;
  agentClockLatch.set(id, nowMs);
  return nowMs;
}

/**
 * Stable start for a running workflow row.
 * A later poll with the same elapsed does not move the start, so the clock ticks.
 */
export function runClockStartMs(run: WorkflowRunRecord, nowMs: number): number | undefined {
  if (!run.running) {
    runClockAnchor.delete(run.runId);
    return undefined;
  }
  if (run.elapsedMs != null && Number.isFinite(run.elapsedMs)) {
    const implied = nowMs - run.elapsedMs;
    const latched = runClockAnchor.get(run.runId);
    if (latched == null || implied + 500 < latched) {
      runClockAnchor.set(run.runId, implied);
    }
    return runClockAnchor.get(run.runId);
  }
  const starts = run.agents
    .map((agent) => agent.startedAtMs)
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (starts.length > 0) {
    const start = Math.min(...starts);
    runClockAnchor.set(run.runId, start);
    return start;
  }
  const latched = runClockAnchor.get(run.runId);
  if (latched != null) return latched;
  runClockAnchor.set(run.runId, nowMs);
  return nowMs;
}

/** Agent count and token sum for the workflow header. A missing count stays missing. */
export function workflowHeaderStats(run: WorkflowRunRecord): {
  agentCount: number;
  tokensUsed?: number;
} {
  let tokens = 0;
  let any = false;
  for (const agent of run.agents) {
    const count = agent.tokensUsed;
    if (count == null || !Number.isFinite(count) || count < 0) continue;
    tokens += count;
    any = true;
  }
  return {
    agentCount: run.agents.length,
    ...(any ? { tokensUsed: tokens } : {}),
  };
}

/**
 * Copy a live sub-agent token count onto the workflow agent with the same id.
 * A progress count fills a running row. A settled file total stays until the
 * sub-agent reports finished. A missing count stays missing.
 */
export function applyLiveSubagentTokens(
  run: WorkflowRunRecord,
  live: readonly LiveSubagentTokens[],
): WorkflowRunRecord {
  if (live.length === 0 || run.agents.length === 0) return run;
  const byAgent = new Map<string, LiveSubagentTokens>();
  for (const row of live) {
    const id = row.subagentId.trim();
    if (id) byAgent.set(id, row);
  }
  if (byAgent.size === 0) return run;
  let changed = false;
  const agents = run.agents.map((agent) => {
    const row = byAgent.get(agent.agentId);
    const liveCount = row?.tokensUsed;
    if (liveCount == null || !Number.isFinite(liveCount)) return agent;
    if (!agent.running && agent.tokensUsed != null && !row?.finished) return agent;
    if (agent.tokensUsed === liveCount) return agent;
    changed = true;
    return { ...agent, tokensUsed: liveCount };
  });
  return changed ? { ...run, agents } : run;
}

function withRunClock(row: FleetRow, run: WorkflowRunRecord, nowMs: number): FleetRow {
  const summary = row.summary || run.objective;
  if (!run.running) {
    return {
      ...row,
      running: false,
      summary,
      durationMs: row.durationMs ?? run.elapsedMs,
    };
  }
  const started = row.startedAtMs ?? runClockStartMs(run, nowMs);
  return {
    ...row,
    running: true,
    summary,
    ...(started != null ? { startedAtMs: started } : {}),
  };
}

function isGenericWorkflowTitle(title: string): boolean {
  const key = title.trim().toLowerCase();
  return key === "" || key === "workflow";
}

function namesMatch(title: string, name: string): boolean {
  if (!title || !name) return false;
  if (title === name) return true;
  if (name.startsWith(`${title}-`)) return true;
  if (title.startsWith(`${name}-`)) return true;
  return false;
}

/** Prefer an exact name, then a run that is still open. */
export function matchWorkflowRun(
  title: string,
  runs: readonly WorkflowRunRecord[],
  used: ReadonlySet<string>,
): WorkflowRunRecord | null {
  const want = title.trim().toLowerCase();
  const candidates = runs.filter(
    (run) => !used.has(run.runId) && namesMatch(want, run.name.trim().toLowerCase()),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => rank(b, want) - rank(a, want));
  return candidates[0] ?? null;
}

function rank(run: WorkflowRunRecord, want: string): number {
  const name = run.name.trim().toLowerCase();
  return (name === want ? 4 : 0) + (run.running ? 2 : 0);
}

function syntheticRow(run: WorkflowRunRecord, nowMs: number): FleetRow {
  return withRunClock(
    {
      id: run.runId,
      kind: "workflow",
      running: run.running,
      title: run.name,
      summary: run.objective,
    },
    run,
    nowMs,
  );
}

/**
 * Attach each run to the workflow row with the same name. Runs the chat has
 * not shown as a tool row yet are added. Agents already drawn under a phase
 * are removed from the flat agent list.
 */
export function presentFleet(
  rows: readonly FleetRow[],
  runs: readonly WorkflowRunRecord[],
  nowMs: number,
): { rows: FleetRow[]; byId: Map<string, WorkflowRunRecord> } {
  const used = new Set<string>();
  const byId = new Map<string, WorkflowRunRecord>();
  const claimed = new Set<string>();
  const next: FleetRow[] = [];
  for (const row of rows) {
    if (row.kind !== "workflow") {
      next.push(row);
      continue;
    }
    let run = matchWorkflowRun(row.title, runs, used);
    if (!run && isGenericWorkflowTitle(row.title)) {
      const leftover = runs.filter((item) => !used.has(item.runId));
      if (leftover.length === 1) run = leftover[0] ?? null;
    }
    if (!run) {
      next.push(row);
      continue;
    }
    used.add(run.runId);
    byId.set(row.id, run);
    for (const agent of run.agents) claimed.add(agent.agentId);
    next.push(withRunClock(row, run, nowMs));
  }
  for (const run of runs) {
    if (used.has(run.runId)) continue;
    byId.set(run.runId, run);
    for (const agent of run.agents) claimed.add(agent.agentId);
    next.push(syntheticRow(run, nowMs));
  }
  return {
    rows: next.filter((row) => {
      if (row.kind !== "agent") return true;
      if (row.childSessionId && claimed.has(row.childSessionId)) return false;
      return !claimed.has(row.id);
    }),
    byId,
  };
}
