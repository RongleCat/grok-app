import { beforeEach, describe, expect, it } from "vitest";
import type { FleetRow } from "./backgroundFleet";
import {
  applyLiveSubagentTokens,
  phaseGroups,
  presentFleet,
  resetWorkflowClocks,
  workflowAgentElapsedMs,
  workflowHeaderStats,
  type WorkflowRunRecord,
} from "./workflowRunView";

beforeEach(() => {
  resetWorkflowClocks();
});

function run(partial: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    runId: "wf_1",
    name: "review-changes-2",
    status: "running",
    running: true,
    currentPhase: "Review",
    agentBudget: 8,
    agentsUsed: 2,
    phases: [{ title: "Implement" }, { title: "Review" }],
    agents: [
      {
        agentId: "a1",
        label: "impl:L1",
        phase: "Implement",
        state: "completed",
        running: false,
        tokensUsed: 10,
      },
      {
        agentId: "a2",
        label: "review:late",
        phase: "Review",
        state: "running",
        running: true,
      },
    ],
    ...partial,
  };
}

const workflowRow: FleetRow = {
  id: "tool-1",
  kind: "workflow",
  running: true,
  title: "review-changes",
};

describe("phaseGroups", () => {
  it("places a later agent into the phase named on its record", () => {
    const grouped = phaseGroups(run());
    expect(grouped.phases.map((phase) => phase.title)).toEqual(["Implement", "Review"]);
    expect(grouped.phases[1]?.current).toBe(true);
    expect(grouped.phases[1]?.agents.map((agent) => agent.label)).toEqual(["review:late"]);
    expect(grouped.ungrouped).toEqual([]);
  });

  it("keeps an agent with no phase outside the phase list", () => {
    const grouped = phaseGroups(
      run({
        agents: [
          { agentId: "a3", label: "loose", state: "running", running: true },
        ],
      }),
    );
    expect(grouped.phases.every((phase) => phase.agents.length === 0)).toBe(true);
    expect(grouped.ungrouped.map((agent) => agent.agentId)).toEqual(["a3"]);
  });
});

describe("presentFleet", () => {
  it("attaches a suffixed run name to the workflow row and hides that agent", () => {
    const presented = presentFleet(
      [
        workflowRow,
        {
          id: "a2",
          kind: "agent",
          running: true,
          title: "review:late",
          childSessionId: "a2",
        },
      ],
      [run()],
      10_000,
    );
    expect(presented.byId.get("tool-1")?.runId).toBe("wf_1");
    expect(presented.rows.map((row) => row.id)).toEqual(["tool-1"]);
    expect(presented.rows[0]?.running).toBe(true);
  });

  it("treats a finished run as finished even when the tool row is still running", () => {
    const finished = run({ status: "complete", running: false, currentPhase: "Review" });
    const grouped = phaseGroups(finished);
    expect(grouped.phases.every((phase) => !phase.current)).toBe(true);
    expect(grouped.phases.flatMap((phase) => phase.agents).every((agent) => !agent.running)).toBe(true);
    const presented = presentFleet(
      [{ ...workflowRow, title: "Workflow", running: true }],
      [finished],
      10_000,
    );
    expect(presented.byId.get("tool-1")?.runId).toBe("wf_1");
    expect(presented.rows[0]?.running).toBe(false);
  });

  it("adds a run that has no workflow tool row yet", () => {
    const presented = presentFleet([], [run({ elapsedMs: 1500 })], 10_000);
    expect(presented.rows.map((row) => row.id)).toEqual(["wf_1"]);
    expect(presented.rows[0]?.kind).toBe("workflow");
    expect(presented.rows[0]?.startedAtMs).toBe(8_500);
  });

  it("keeps the workflow clock start still so a later second moves the elapsed time", () => {
    const sample = run({ elapsedMs: 1500 });
    const first = presentFleet([], [sample], 10_000);
    const second = presentFleet([], [sample], 11_000);
    expect(first.rows[0]?.startedAtMs).toBe(8_500);
    expect(second.rows[0]?.startedAtMs).toBe(8_500);
  });
});

describe("applyLiveSubagentTokens", () => {
  it("fills a running agent from the matching progress count", () => {
    const sample = run();
    const next = applyLiveSubagentTokens(sample, [
      { subagentId: "a2", tokensUsed: 24863 },
    ]);
    expect(next.agents.find((agent) => agent.agentId === "a2")?.tokensUsed).toBe(24863);
    expect(next.agents.find((agent) => agent.agentId === "a1")?.tokensUsed).toBe(10);
  });

  it("replaces a running file snapshot with the later progress count", () => {
    const sample = run({
      agents: [
        {
          agentId: "a2",
          label: "review:late",
          phase: "Review",
          state: "running",
          running: true,
          tokensUsed: 100,
        },
      ],
    });
    const next = applyLiveSubagentTokens(sample, [
      { subagentId: "a2", tokensUsed: 25178 },
    ]);
    expect(next.agents[0]?.tokensUsed).toBe(25178);
  });

  it("leaves the row unchanged when the event omits a count", () => {
    const sample = run();
    expect(applyLiveSubagentTokens(sample, [{ subagentId: "a2" }])).toBe(sample);
    expect(applyLiveSubagentTokens(sample, [])).toBe(sample);
  });

  it("keeps a settled file total until the sub-agent reports finished", () => {
    const sample = run({
      running: false,
      status: "complete",
      agents: [
        {
          agentId: "a1",
          label: "impl:L1",
          phase: "Implement",
          state: "done",
          running: false,
          tokensUsed: 14143,
        },
      ],
    });
    const progress = applyLiveSubagentTokens(sample, [
      { subagentId: "a1", tokensUsed: 12000 },
    ]);
    expect(progress).toBe(sample);
    const finished = applyLiveSubagentTokens(sample, [
      { subagentId: "a1", tokensUsed: 14143, finished: true },
    ]);
    expect(finished).toBe(sample);
    const corrected = applyLiveSubagentTokens(sample, [
      { subagentId: "a1", tokensUsed: 14150, finished: true },
    ]);
    expect(corrected.agents[0]?.tokensUsed).toBe(14150);
  });

  it("shows a progress count on a settled agent that has no file total", () => {
    const sample = run({
      agents: [
        {
          agentId: "a1",
          label: "impl:L1",
          phase: "Implement",
          state: "done",
          running: false,
        },
      ],
    });
    const next = applyLiveSubagentTokens(sample, [
      { subagentId: "a1", tokensUsed: 0 },
    ]);
    expect(next.agents[0]?.tokensUsed).toBe(0);
  });
});

describe("workflowHeaderStats", () => {
  it("counts every agent and sums only the token totals that were reported", () => {
    const stats = workflowHeaderStats(
      run({
        agents: [
          {
            agentId: "a1",
            label: "impl:one",
            state: "done",
            running: false,
            tokensUsed: 14_143,
          },
          {
            agentId: "a2",
            label: "review:one",
            state: "running",
            running: true,
            tokensUsed: 400,
          },
          {
            agentId: "a3",
            label: "review:late",
            state: "running",
            running: true,
          },
        ],
      }),
    );
    expect(stats.agentCount).toBe(3);
    expect(stats.tokensUsed).toBe(14_543);
  });

  it("leaves the token total absent until an agent reports a count", () => {
    const stats = workflowHeaderStats(
      run({
        agents: [
          { agentId: "a2", label: "review:late", state: "running", running: true },
        ],
      }),
    );
    expect(stats.agentCount).toBe(1);
    expect(stats.tokensUsed).toBeUndefined();
  });
});

describe("workflowAgentElapsedMs", () => {
  it("ticks a running session and freezes a finished one", () => {
    const running = {
      agentId: "a2",
      label: "review:late",
      state: "running",
      running: true,
      startedAtMs: 1_000,
    };
    expect(workflowAgentElapsedMs(running, 6_000)).toBe(5_000);
    expect(workflowAgentElapsedMs(running, 7_000)).toBe(6_000);
    expect(
      workflowAgentElapsedMs(
        { ...running, running: false, state: "done", durationMs: 5_500 },
        9_000,
      ),
    ).toBe(5_500);
  });

  it("starts a clock when the session has no start time yet", () => {
    const bare = {
      agentId: "a3",
      label: "impl:one",
      state: "running",
      running: true,
    };
    expect(workflowAgentElapsedMs(bare, 100)).toBe(0);
    expect(workflowAgentElapsedMs(bare, 2_100)).toBe(2_000);
  });
});
