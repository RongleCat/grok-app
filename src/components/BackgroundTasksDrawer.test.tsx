/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createT } from "@/i18n";
import type { FleetRow } from "@/lib/backgroundFleet";
import type { WorkflowRunRecord } from "@/lib/workflowRunView";
import { BackgroundFleetList } from "./BackgroundTasksDrawer";

const tr = createT("en");

afterEach(() => cleanup());

function list(
  rows: FleetRow[],
  extra?: {
    sessionBillTokens?: number;
    finishedOpen?: boolean;
    onToggleFinished?: () => void;
    detailId?: string | null;
    workflowByRowId?: ReadonlyMap<string, WorkflowRunRecord>;
  },
) {
  return render(
    <BackgroundFleetList
      rows={rows}
      sessionBillTokens={extra?.sessionBillTokens}
      locale="en"
      tr={tr}
      nowMs={1_700_000_000_000}
      finishedOpen={extra?.finishedOpen ?? false}
      onToggleFinished={extra?.onToggleFinished ?? (() => undefined)}
      focusId={null}
      detailId={extra?.detailId ?? null}
      stopNote={null}
      onView={() => undefined}
      onStop={() => undefined}
      onReveal={() => undefined}
      onCopyPath={() => undefined}
      copiedPath={null}
      workflowByRowId={extra?.workflowByRowId}
    />,
  );
}

describe("BackgroundFleetList", () => {
  it("keeps unknown tokens and phases blank and labels an agent with no model", () => {
    list([
      { id: "agent-1", kind: "agent", running: true, title: "Audit the decoder" },
      { id: "wf-1", kind: "workflow", running: false, title: "deep-research" },
    ]);
    expect(screen.getByTestId("fleet-row-agent-1")).toBeTruthy();
    expect(screen.queryByTestId("fleet-row-wf-1")).toBeNull();
    expect(screen.queryByTestId("fleet-tokens-agent-1")).toBeNull();
    expect(screen.queryByTestId("fleet-phase-agent-1")).toBeNull();
    expect(screen.getByTestId("fleet-model-agent-1").textContent).toContain("inherits parent");
    expect(screen.queryByTestId("fleet-session-bill")).toBeNull();
  });

  it("shows a session bill and a phase only when those numbers were passed", () => {
    const onToggleFinished = vi.fn();
    list(
      [
        {
          id: "wf-1",
          kind: "workflow",
          running: true,
          title: "deep-research",
          phase: { done: 0, total: 6 },
          agentCount: 2,
          tokens: 40,
        },
      ],
      { sessionBillTokens: 1700, onToggleFinished },
    );
    expect(screen.getByTestId("fleet-session-bill").textContent).toContain("1,700");
    expect(screen.getByTestId("fleet-phase-wf-1").textContent).toContain("0/6");
    expect(screen.getByTestId("fleet-agents-wf-1").textContent).toContain("2");
    expect(screen.getByTestId("fleet-tokens-wf-1").textContent).toContain("40");
    fireEvent.click(screen.getByRole("button", { name: /Finished/ }));
    expect(onToggleFinished).toHaveBeenCalled();
  });

  it("keeps the task transcript closed until View transcript", () => {
    const row: FleetRow = {
      id: "sh-1",
      kind: "shell",
      running: true,
      title: "Count",
      lastLine: "shell-tick 3",
      prompt: "print the ticks",
    };
    const view = list([row]);
    expect(screen.queryByText(/shell-tick 3/)).toBeNull();
    expect(screen.queryByText(/print the ticks/)).toBeNull();
    expect(screen.getByRole("button", { name: "View transcript" })).toBeTruthy();
    view.rerender(
      <BackgroundFleetList
        rows={[row]}
        locale="en"
        tr={tr}
        nowMs={1_700_000_000_000}
        finishedOpen={false}
        onToggleFinished={() => undefined}
        focusId={null}
        detailId="sh-1"
        stopNote={null}
        onView={() => undefined}
        onStop={() => undefined}
        onReveal={() => undefined}
        onCopyPath={() => undefined}
        copiedPath={null}
      />,
    );
    expect(screen.getByTestId("fleet-transcript-sh-1").textContent).toContain("shell-tick 3");
    expect(screen.getByTestId("fleet-transcript-sh-1").textContent).toContain("print the ticks");
  });

  it("draws a later agent under the phase named on the workflow run", () => {
    const run: WorkflowRunRecord = {
      runId: "wf_1",
      name: "deep-research",
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
          durationMs: 4_000,
        },
        {
          agentId: "a2",
          label: "review:late",
          phase: "Review",
          state: "running",
          running: true,
          model: "grok-4.7",
          tokensUsed: 30,
          startedAtMs: 1_700_000_000_000 - 5_000,
        },
      ],
    };
    const view = list([{ id: "wf-1", kind: "workflow", running: true, title: "deep-research" }], {
      workflowByRowId: new Map([["wf-1", run]]),
    });
    const phases = screen.getByTestId("fleet-phases-wf_1");
    expect(phases.textContent).toContain("Implement");
    expect(phases.textContent).toContain("Review");
    expect(phases.textContent).toContain("impl:L1");
    expect(phases.textContent).toContain("review:late");
    expect(phases.textContent).toContain("Budget");
    expect(phases.textContent).toContain("Model");
    expect(phases.textContent).toContain("Tokens");
    expect(phases.textContent).toContain("Time");
    expect(screen.getByTestId("fleet-phase-model-a2").textContent).toBe("grok-4.7");
    expect(screen.getByTestId("fleet-agents-wf-1").textContent).toBe("2 agents");
    expect(screen.getByTestId("fleet-tokens-wf-1").textContent).toBe("30 tokens");
    expect(screen.getByTestId("fleet-phase-tokens-a2").textContent).toBe("30");
    expect(screen.getByTestId("fleet-phase-tokens-a1").textContent).toBe("");
    expect(screen.getByTestId("fleet-phase-model-a1").textContent).toContain("inherits parent");
    expect(screen.getByTestId("fleet-phase-agent-a1").className).toContain("is-settled");
    expect(screen.getByTestId("fleet-phase-agent-a2").className).toContain("is-running");
    expect(phases.querySelector(".chat-fleet__phase.is-settled")?.textContent).toContain(
      "impl:L1",
    );
    const frozen = screen.getByTestId("fleet-phase-time-a1").textContent;
    const ticking = screen.getByTestId("fleet-phase-time-a2").textContent;
    expect(frozen).not.toBe("");
    expect(ticking).not.toBe("");
    view.rerender(
      <BackgroundFleetList
        rows={[{ id: "wf-1", kind: "workflow", running: true, title: "deep-research" }]}
        locale="en"
        tr={tr}
        nowMs={1_700_000_000_000 + 3_000}
        finishedOpen={false}
        onToggleFinished={() => undefined}
        focusId={null}
        detailId={null}
        stopNote={null}
        onView={() => undefined}
        onStop={() => undefined}
        onReveal={() => undefined}
        onCopyPath={() => undefined}
        copiedPath={null}
        workflowByRowId={new Map([["wf-1", run]])}
      />,
    );
    expect(screen.getByTestId("fleet-phase-time-a1").textContent).toBe(frozen);
    expect(screen.getByTestId("fleet-phase-time-a2").textContent).not.toBe(ticking);
    expect(screen.queryByTestId("fleet-transcript-wf-1")).toBeNull();
  });

  it("sums the workflow token total and updates it when an agent count changes", () => {
    const row = {
      id: "wf-1",
      kind: "workflow" as const,
      running: true,
      title: "f55-ipsec-dynamic-terminate-timeout",
      startedAtMs: 1_700_000_000_000 - 4_425_000,
    };
    const agents = [
      {
        agentId: "a1",
        label: "impl:one",
        phase: "Implement",
        state: "done",
        running: false,
        tokensUsed: 858_000,
      },
      {
        agentId: "a2",
        label: "review:late",
        phase: "Review",
        state: "running",
        running: true,
        tokensUsed: 400,
      },
    ];
    const record = (tokens: number): WorkflowRunRecord => ({
      runId: "wf_1",
      name: "f55-ipsec-dynamic-terminate-timeout",
      status: "running",
      running: true,
      objective: "Confirm, fix, name timeouts",
      phases: [{ title: "Implement" }, { title: "Review" }],
      agents: agents.map((agent) =>
        agent.agentId === "a2" ? { ...agent, tokensUsed: tokens } : agent,
      ),
    });
    const view = list([row], { workflowByRowId: new Map([["wf-1", record(400)]]) });
    expect(screen.getByTestId("fleet-agents-wf-1").textContent).toBe("2 agents");
    expect(screen.getByTestId("fleet-tokens-wf-1").textContent).toBe("858.4K tokens");
    expect(screen.getByTestId("fleet-elapsed-wf-1").textContent).not.toBe("");
    const rowText = screen.getByTestId("fleet-row-wf-1").textContent ?? "";
    const objectiveAt = rowText.indexOf("Confirm, fix, name timeouts");
    expect(objectiveAt).toBeGreaterThan(-1);
    expect(objectiveAt).toBeLessThan(rowText.indexOf("Phases"));
    view.rerender(
      <BackgroundFleetList
        rows={[row]}
        locale="en"
        tr={tr}
        nowMs={1_700_000_000_000}
        finishedOpen={false}
        onToggleFinished={() => undefined}
        focusId={null}
        detailId={null}
        stopNote={null}
        onView={() => undefined}
        onStop={() => undefined}
        onReveal={() => undefined}
        onCopyPath={() => undefined}
        copiedPath={null}
        workflowByRowId={new Map([["wf-1", record(2_400)]])}
      />,
    );
    expect(screen.getByTestId("fleet-tokens-wf-1").textContent).toBe("860.4K tokens");
  });
});
