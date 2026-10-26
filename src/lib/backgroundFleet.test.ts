import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./session/types";
import { enTasks } from "@/i18n/messages/en/tasks";
import {
  buildBackgroundFleet,
  fleetChipKind,
  fleetElapsedMs,
  fleetInheritsParentModel,
  fleetStopPlan,
  type FleetWireEvent,
} from "./backgroundFleet";

const CHILD_A = "01a0a5e5-0487-7692-be57-24038f33f89c";
const CHILD_B = "01a0a84b-1bba-76d1-9721-9e38e56d3de8";

function tool(partial: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    role: "tool",
    content: partial.content || partial.toolKind || "tool",
    marker: "tool_step",
    ...partial,
  };
}

describe("buildBackgroundFleet", () => {
  it("keeps two concurrent spawn_subagent calls as siblings", () => {
    const fleet = buildBackgroundFleet({
      messages: [
        tool({
          id: "tool-spawn-a",
          toolCallId: "spawn-a",
          toolKind: "spawn_subagent",
          content: "Subagent",
          toolInput: "Audit the decoder",
          toolStatus: "in_progress",
          toolOutput: `Subagent started in background.\nsubagent_id: ${CHILD_A}\n`,
        }),
        tool({
          id: "tool-read",
          toolCallId: "read-1",
          toolKind: "read_file",
          content: "Read",
          toolInput: "src/lib/backgroundFleet.ts",
          toolStatus: "completed",
        }),
        tool({
          id: "tool-spawn-b",
          toolCallId: "spawn-b",
          toolKind: "spawn_subagent",
          content: "Subagent",
          toolInput: "Review the drawer",
          toolStatus: "in_progress",
          toolOutput: `Subagent started in background.\nsubagent_id: ${CHILD_B}\n`,
        }),
      ],
    });
    const agents = fleet.rows.filter((row) => row.kind === "agent");
    expect(agents.map((row) => row.id)).toEqual(["spawn-a", "spawn-b"]);
    expect(fleet.rows.some((row) => row.id === "read-1")).toBe(false);
    expect(agents[0]?.childSessionId).toBe(CHILD_A);
    expect(agents[1]?.childSessionId).toBe(CHILD_B);
  });

  it("stops a finished subagent even while its tool row is still in progress", () => {
    const fleet = buildBackgroundFleet({
      messages: [
        tool({
          id: "tool-spawn-a",
          toolCallId: "spawn-a",
          toolKind: "spawn_subagent",
          content: "Subagent",
          toolInput: "Audit",
          toolStatus: "in_progress",
          streaming: true,
          toolOutput: `subagent_id: ${CHILD_A}\n<subagent_meta>id=${CHILD_A}, duration_ms=4000</subagent_meta>\n<subagent_result>\ndone\n</subagent_result>`,
        }),
        tool({
          id: "tool-wf",
          toolCallId: "wf-1",
          toolKind: "workflow",
          content: "Workflow",
          toolStatus: "completed",
          streaming: true,
          toolOutput: "Workflow 'phase-demo' started in the background.",
        }),
      ],
    });
    const agent = fleet.rows.find((row) => row.id === "spawn-a");
    const workflow = fleet.rows.find((row) => row.kind === "workflow");
    expect(agent?.running).toBe(false);
    expect(workflow?.running).toBe(false);
    expect(workflow?.title).toBe("phase-demo");
  });

  it("leaves a tool with no fleet mark out of the list", () => {
    const fleet = buildBackgroundFleet({
      messages: [
        tool({
          id: "tool-read",
          toolCallId: "read-1",
          toolKind: "read_file",
          toolStatus: "completed",
        }),
        tool({
          id: "tool-sh",
          toolCallId: "sh-fg",
          toolKind: "run_terminal_command",
          content: "cargo test",
          toolInput: "cargo test",
          toolStatus: "completed",
        }),
      ],
    });
    expect(fleet.rows).toEqual([]);
  });

  it("renders a monitor snapshot as a shell row without tokens or a phase", () => {
    const events: FleetWireEvent[] = [
      {
        kind: "task_completed",
        body: {
          will_wake: false,
          task_snapshot: {
            task_id: "call-mon-1",
            kind: "monitor",
            command: "tail -f build.log",
            display_command: "tail -f build.log",
            output: "line-b",
            output_file: "/tmp/fleet-fixture/mon-1.log",
            completed: true,
            exit_code: 0,
            start_time: { secs_since_epoch: 1_700_000_000, nanos_since_epoch: 0 },
            end_time: { secs_since_epoch: 1_700_000_002, nanos_since_epoch: 0 },
          },
        },
      },
    ];
    const fleet = buildBackgroundFleet({ events });
    expect(fleet.rows).toHaveLength(1);
    const row = fleet.rows[0]!;
    expect(row.kind).toBe("shell");
    expect(row.shellKind).toBe("monitor");
    expect(row.running).toBe(false);
    expect(row.lastLine).toBe("line-b");
    expect(row.outputFile).toBe("/tmp/fleet-fixture/mon-1.log");
    expect(row.tokens).toBeUndefined();
    expect(row.model).toBeUndefined();
    expect(row.phase).toBeUndefined();
    expect(fleetElapsedMs(row, 0)).toBe(2000);
  });

  it("uses inherits-parent when the spawn payload names no model and hides missing tokens", () => {
    const fleet = buildBackgroundFleet({
      messages: [
        tool({
          id: "tool-spawn-a",
          toolCallId: "spawn-a",
          toolKind: "spawn_subagent",
          toolInput: "Audit",
          toolStatus: "in_progress",
          fleetHint: { prompt: "List the fields." },
        }),
      ],
    });
    const row = fleet.rows[0]!;
    expect(row.model).toBeUndefined();
    expect(row.tokens).toBeUndefined();
    expect(fleetInheritsParentModel(row)).toBe(true);
    expect(row.prompt).toBe("List the fields.");
  });

  it("keeps an explicit spawn model and does not invent a phase on a workflow", () => {
    const fleet = buildBackgroundFleet({
      messages: [
        tool({
          id: "tool-spawn-a",
          toolCallId: "spawn-a",
          toolKind: "spawn_subagent",
          toolInput: "Audit",
          toolStatus: "completed",
          fleetHint: { model: "grok-4.6-build" },
          toolOutput: `<subagent_meta>id=${CHILD_A}, type=general, tool_calls=3, turns=2, duration_ms=1200</subagent_meta>\n<subagent_result>done</subagent_result>`,
        }),
        tool({
          id: "tool-wf",
          toolCallId: "wf-1",
          toolKind: "workflow",
          content: "Workflow: deep-research",
          toolStatus: "in_progress",
          fleetHint: {
            sourceName: "deep-research",
            argsLine: "Which fleet fields exist?",
            agentBudget: 6,
          },
        }),
      ],
    });
    const agent = fleet.rows.find((row) => row.id === "spawn-a")!;
    const flow = fleet.rows.find((row) => row.id === "wf-1")!;
    expect(agent.model).toBe("grok-4.6-build");
    expect(fleetInheritsParentModel(agent)).toBe(false);
    expect(agent.toolCount).toBe(3);
    expect(agent.durationMs).toBe(1200);
    expect(agent.completion).toBe("done");
    expect(flow.title).toBe("deep-research");
    expect(flow.summary).toBe("Which fleet fields exist?");
    expect(flow.phase).toBeUndefined();
    expect(flow.agentCount).toBeUndefined();
    expect(flow.kind).toBe("workflow");
  });

  it("lets subagent_meta tool_calls win over mirrored titles", () => {
    const fleet = buildBackgroundFleet({
      messages: [
        tool({
          id: "tool-spawn-a",
          toolCallId: "spawn-a",
          toolKind: "spawn_subagent",
          toolInput: "Audit",
          toolStatus: "in_progress",
          toolOutput: `subagent_id: ${CHILD_A}\n<subagent_meta>id=${CHILD_A}, tool_calls=4, duration_ms=10</subagent_meta>`,
        }),
        tool({
          id: "tool-m1",
          toolCallId: "m1",
          toolKind: "read_file",
          content: `[subagent:general] Read decoder (${CHILD_A.slice(0, 8)})`,
          toolStatus: "completed",
        }),
        tool({
          id: "tool-m2",
          toolCallId: "m2",
          toolKind: "read_file",
          content: `[subagent:general] Read drawer (${CHILD_A.slice(0, 8)})`,
          toolStatus: "completed",
        }),
      ],
    });
    const agent = fleet.rows.find((row) => row.kind === "agent")!;
    expect(agent.toolCount).toBe(4);
    expect(agent.activity).toBe("Read drawer");
    expect(fleet.rows.filter((row) => row.kind === "agent")).toHaveLength(1);
  });

  it("counts mirrored titles only when subagent_meta has not arrived", () => {
    const fleet = buildBackgroundFleet({
      messages: [
        tool({
          id: "tool-spawn-a",
          toolCallId: "spawn-a",
          toolKind: "spawn_subagent",
          toolInput: "Audit",
          toolStatus: "in_progress",
          toolOutput: `subagent_id: ${CHILD_A}\n`,
        }),
        tool({
          id: "tool-m1",
          toolCallId: "m1",
          toolKind: "read_file",
          content: `[subagent:general] Read decoder (${CHILD_A.slice(0, 8)})`,
          toolStatus: "completed",
        }),
      ],
    });
    expect(fleet.rows[0]?.toolCount).toBe(1);
    expect(fleet.rows[0]?.activity).toBe("Read decoder");
  });

  it("does not attach a mirrored title until the full subagent id is known", () => {
    const fleet = buildBackgroundFleet({
      messages: [
        tool({
          id: "tool-spawn-a",
          toolCallId: "spawn-a",
          toolKind: "spawn_subagent",
          toolInput: "Audit",
          toolStatus: "in_progress",
        }),
        tool({
          id: "tool-m1",
          toolCallId: "m1",
          toolKind: "read_file",
          content: `[subagent:general] Read decoder (${CHILD_A.slice(0, 8)})`,
          toolStatus: "completed",
        }),
      ],
    });
    expect(fleet.rows).toHaveLength(1);
    expect(fleet.rows[0]?.toolCount).toBeUndefined();
    expect(fleet.rows[0]?.activity).toBeUndefined();
  });

  it("shows a phase bar only when both numbers are present", () => {
    const fleet = buildBackgroundFleet({
      messages: [
        tool({
          id: "tool-wf",
          toolCallId: "wf-1",
          toolKind: "workflow",
          content: "Workflow: deep-research",
          toolStatus: "in_progress",
          fleetHint: { phaseIndex: 0, phaseTotal: 6, agentCount: 2 },
        }),
      ],
    });
    expect(fleet.rows[0]?.phase).toEqual({ done: 0, total: 6 });
    expect(fleet.rows[0]?.agentCount).toBe(2);
  });

  it("keeps the last output line and does not drop finished rows when the live list is empty", () => {
    const fleet = buildBackgroundFleet({
      events: [
        {
          kind: "task_completed",
          body: {
            task_snapshot: {
              task_id: "call-sh",
              kind: "bash",
              command: "pnpm test",
              output: "first\n\nlast-ok",
              completed: true,
            },
          },
        },
        { kind: "background_tasks", body: { tasks: [] } },
      ],
    });
    expect(fleet.rows).toHaveLength(1);
    expect(fleet.rows[0]?.lastLine).toBe("last-ok");
    expect(fleet.rows[0]?.running).toBe(false);
  });

  it("folds a background shell tool and its task id into one row", () => {
    const fleet = buildBackgroundFleet({
      messages: [
        tool({
          id: "tool-sh",
          toolCallId: "call-sh",
          toolKind: "run_terminal_command",
          content: "[bg] pnpm test",
          toolInput: "pnpm test",
          toolStatus: "in_progress",
          fleetHint: { background: true, blockUntilMs: 0 },
        }),
      ],
      events: [
        {
          kind: "task_backgrounded",
          body: {
            task_id: "task-9",
            tool_call_id: "call-sh",
            command: "pnpm test",
            output_file: "/tmp/fleet-fixture/sh.log",
          },
        },
      ],
    });
    expect(fleet.rows).toHaveLength(1);
    expect(fleet.rows[0]?.id).toBe("task-9");
    expect(fleet.rows[0]?.toolCallId).toBe("call-sh");
    expect(fleet.rows[0]?.outputFile).toBe("/tmp/fleet-fixture/sh.log");
    expect(fleet.rows[0]?.running).toBe(true);
  });

  it("passes the session bill through separately from child rows", () => {
    const fleet = buildBackgroundFleet({
      messages: [
        tool({
          id: "tool-spawn-a",
          toolCallId: "spawn-a",
          toolKind: "spawn_subagent",
          toolInput: "Audit",
          toolStatus: "in_progress",
        }),
      ],
      sessionBillTokens: 1700,
    });
    expect(fleet.sessionBillTokens).toBe(1700);
    expect(fleet.rows[0]?.tokens).toBeUndefined();
  });
});

describe("fleetChipKind", () => {
  it("collapses only host-marked fleet rows", () => {
    expect(fleetChipKind({ name: "spawn_subagent", title: "Subagent" })).toBe("agent");
    expect(fleetChipKind({ name: "workflow", title: "Workflow: deep-research" })).toBe("workflow");
    expect(
      fleetChipKind({
        name: "run_terminal_command",
        title: "[bg] cargo test",
        hint: { background: true, blockUntilMs: 0 },
      }),
    ).toBe("shell");
    expect(fleetChipKind({ name: "monitor", title: "[monitor] tail" })).toBe("shell");
    expect(fleetChipKind({ name: "scheduler_create", title: "loop" })).toBe("shell");
    expect(fleetChipKind({ name: "run_terminal_command", title: "cargo test" })).toBeNull();
    expect(fleetChipKind({ name: "read_file", title: "Read" })).toBeNull();
  });
});

describe("fleetStopPlan", () => {
  it("queues a director instruction only while a turn is streaming", () => {
    expect(
      fleetStopPlan({
        taskId: "call-1",
        streaming: true,
        interjectAvailable: true,
      }),
    ).toEqual({ kind: "interject", text: "stop task call-1" });
  });

  it("stays on the no-kill copy when interject is unavailable", () => {
    expect(
      fleetStopPlan({
        taskId: "call-1",
        streaming: true,
        interjectAvailable: false,
      }),
    ).toEqual({ kind: "unavailable", messageKey: "fleet.stopUnavailable" });
    expect(
      fleetStopPlan({
        taskId: "call-1",
        streaming: false,
        interjectAvailable: true,
      }).kind,
    ).toBe("unavailable");
    expect(enTasks["fleet.stopUnavailable"]).toMatch(/not available over ACP/i);
    expect(enTasks["tasks.noKill"]).toMatch(/not available over ACP/i);
  });
});
