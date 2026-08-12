import { describe, expect, it } from "vitest";
import {
  buildVoiceSessionChips,
  formatVoiceSessionChipLabel,
  formatVoiceToolStatus,
  hasRunningVoiceDelegates,
  mapSessionsToVoiceChipInputs,
  mergeVoiceSessionsForChips,
  normalizeVoiceChipStatus,
  planVoiceEnd,
  resolveKeepAgentsBanner,
  resolveVoiceCenterEmptyState,
  voiceCenterEmptyMessageKey,
} from "./voiceCommandCenter";

describe("buildVoiceSessionChips", () => {
  it("builds chips from real titles and statuses; never invents ids", () => {
    const chips = buildVoiceSessionChips([
      { id: "abc12345xyz", title: "Fix tests", status: "streaming", isDelegated: true },
      { id: "other", title: "Chat", status: "idle", isDelegated: false },
    ]);
    expect(chips).toHaveLength(1); // prefer delegated only when any delegated
    expect(chips[0].label).toBe("Fix tests");
    expect(chips[0].status).toBe("running");
    expect(chips[0].isDelegated).toBe(true);
    expect(chips[0].tone).toBe("running");
  });

  it("falls back to short id when title missing", () => {
    const chips = buildVoiceSessionChips(
      [{ id: "abcdefghij", title: "", status: "ready", isDelegated: true }],
      { preferDelegatedOnly: false },
    );
    expect(chips[0].label).toBe("abcdefgh");
  });

  it("includes non-delegated when none are delegated", () => {
    const chips = buildVoiceSessionChips([
      { id: "a", title: "One", status: "idle" },
      { id: "b", title: "Two", status: "streaming" },
    ]);
    expect(chips).toHaveLength(2);
    // running first
    expect(chips[0].id).toBe("b");
    expect(chips[0].status).toBe("running");
  });

  it("drops empty ids", () => {
    expect(
      buildVoiceSessionChips([
        { id: "  ", title: "x" },
        { id: "ok", title: "Y", isDelegated: true },
      ]),
    ).toHaveLength(1);
  });

  it("sorts permission ahead of running among delegated", () => {
    const chips = buildVoiceSessionChips([
      {
        id: "1",
        title: "A",
        status: "streaming",
        isDelegated: true,
      },
      {
        id: "2",
        title: "B",
        status: "awaiting_permission",
        isDelegated: true,
      },
    ]);
    expect(chips.map((c) => c.id)).toEqual(["2", "1"]);
    expect(chips[0].status).toBe("permission");
  });
});

describe("normalizeVoiceChipStatus / formatVoiceSessionChipLabel", () => {
  it("maps known tokens; unknown stays unknown", () => {
    expect(normalizeVoiceChipStatus("STREAMING")).toBe("running");
    expect(normalizeVoiceChipStatus("awaiting_permission")).toBe("permission");
    expect(normalizeVoiceChipStatus("completed")).toBe("done");
    expect(normalizeVoiceChipStatus("failed")).toBe("error");
    expect(normalizeVoiceChipStatus("weird_token")).toBe("unknown");
    expect(normalizeVoiceChipStatus("")).toBe("unknown");
  });

  it("truncates long titles honestly", () => {
    const long = "x".repeat(40);
    expect(formatVoiceSessionChipLabel("id1", long).endsWith("…")).toBe(true);
    expect(formatVoiceSessionChipLabel("id1", long).length).toBeLessThanOrEqual(
      28,
    );
  });
});

describe("mergeVoiceSessionsForChips", () => {
  it("marks host delegated ids and fills missing titles as null", () => {
    const rows = mergeVoiceSessionsForChips({
      delegatedIds: ["d1", "d2"],
      sessions: [
        { id: "d1", title: "Voice task", status: "streaming" },
        { id: "side", title: "Other", status: "idle" },
      ],
    });
    const d1 = rows.find((r) => r.id === "d1");
    const d2 = rows.find((r) => r.id === "d2");
    const side = rows.find((r) => r.id === "side");
    expect(d1?.isDelegated).toBe(true);
    expect(d1?.title).toBe("Voice task");
    expect(d2?.isDelegated).toBe(true);
    expect(d2?.title).toBeNull();
    expect(side?.isDelegated).toBe(false);
  });
});

describe("mapSessionsToVoiceChipInputs", () => {
  it("maps real sessions + liveMap status; drops empty ids", () => {
    const rows = mapSessionsToVoiceChipInputs({
      sessions: [
        { id: "a", title: "Fix tests" },
        { id: "  ", title: "skip" },
        { id: "b", title: "" },
      ],
      liveStates: { a: "streaming", b: undefined },
      untitledLabel: "Untitled",
    });
    expect(rows).toEqual([
      { id: "a", title: "Fix tests", status: "streaming" },
      { id: "b", title: "Untitled", status: "idle" },
    ]);
  });

  it("never invents streaming without liveMap", () => {
    const rows = mapSessionsToVoiceChipInputs({
      sessions: [{ id: "x", title: "Chat" }],
      liveStates: null,
      untitledLabel: "Untitled",
    });
    expect(rows[0].status).toBe("idle");
  });
});

describe("resolveVoiceCenterEmptyState", () => {
  it("prioritizes no_auth then no_mic when transcript empty", () => {
    expect(
      resolveVoiceCenterEmptyState({
        hasMic: false,
        hasAuth: false,
        hasDelegates: false,
        transcriptEmpty: true,
      }),
    ).toBe("no_auth");
    expect(
      resolveVoiceCenterEmptyState({
        hasMic: false,
        hasAuth: true,
        hasDelegates: false,
        transcriptEmpty: true,
      }),
    ).toBe("no_mic");
  });

  it("returns null when transcript has real content (even if mic soft-fails)", () => {
    expect(
      resolveVoiceCenterEmptyState({
        hasMic: true,
        hasAuth: true,
        hasDelegates: true,
        transcriptEmpty: false,
      }),
    ).toBeNull();
    expect(
      resolveVoiceCenterEmptyState({
        hasMic: false,
        hasAuth: true,
        hasDelegates: false,
        transcriptEmpty: false,
      }),
    ).toBeNull();
  });

  it("distinguishes empty transcript with/without delegates", () => {
    expect(
      resolveVoiceCenterEmptyState({
        hasMic: true,
        hasAuth: true,
        hasDelegates: false,
        transcriptEmpty: true,
      }),
    ).toBe("transcript_empty");
    expect(
      resolveVoiceCenterEmptyState({
        hasMic: true,
        hasAuth: true,
        hasDelegates: true,
        transcriptEmpty: true,
      }),
    ).toBe("transcript_empty_with_delegates");
  });

  it("maps kinds to i18n keys without inventing STT", () => {
    expect(voiceCenterEmptyMessageKey("transcript_empty")).toBe(
      "voice.transcriptEmpty",
    );
    expect(voiceCenterEmptyMessageKey("no_auth")).toBe(
      "voice.center.empty.noAuth",
    );
    expect(voiceCenterEmptyMessageKey(null)).toBeNull();
  });
});

describe("formatVoiceToolStatus", () => {
  it("formats running tool with real name only", () => {
    const f = formatVoiceToolStatus({
      name: "create_agent_session",
      status: "tool_running",
    });
    expect(f.status).toBe("tool_running");
    expect(f.name).toBe("create_agent_session");
    expect(f.busy).toBe(true);
    expect(f.messageKey).toBe("voice.toolRunning");
    expect(f.label).toContain("create_agent_session");
  });

  it("never invents a tool when name absent", () => {
    const f = formatVoiceToolStatus({ status: "tool_running" });
    expect(f.name).toBeNull();
    // status alone with no name still surfaces when raw present
    expect(f.messageKey).toBe("voice.toolRunning");
  });

  it("returns idle empty for blank input", () => {
    expect(formatVoiceToolStatus(null)).toEqual({
      status: "idle",
      name: null,
      label: "",
      messageKey: null,
      busy: false,
    });
    expect(formatVoiceToolStatus({ name: "", status: "" }).status).toBe("idle");
  });

  it("maps permission and soft-fail tokens", () => {
    expect(
      formatVoiceToolStatus({ name: "bash", status: "permission_pending" })
        .status,
    ).toBe("permission_pending");
    expect(
      formatVoiceToolStatus({ name: "bash", status: "cancelled" }).status,
    ).toBe("soft_fail");
  });
});

describe("resolveKeepAgentsBanner", () => {
  it("defaults to keep on undefined/true", () => {
    expect(resolveKeepAgentsBanner(true).keep).toBe(true);
    expect(resolveKeepAgentsBanner(undefined).keep).toBe(true);
    expect(resolveKeepAgentsBanner(undefined).messageKey).toBe(
      "voice.center.keepAgentsOn",
    );
    expect(resolveKeepAgentsBanner(false).keep).toBe(false);
    expect(resolveKeepAgentsBanner(false).messageKey).toBe(
      "voice.center.keepAgentsOff",
    );
  });
});

describe("planVoiceEnd", () => {
  it("keeps delegates when keepAgents is on", () => {
    const plan = planVoiceEnd({
      keepAgents: true,
      hasRunningDelegates: true,
    });
    expect(plan.willCancelDelegates).toBe(false);
    expect(plan.actions).toContain("keep_delegates");
    expect(plan.actions).not.toContain("cancel_delegates");
    expect(plan.noteMessageKey).toBe("voice.center.endNote.keepRunning");
  });

  it("cancels delegates only when pref off and running observed", () => {
    const plan = planVoiceEnd({
      keepAgents: false,
      hasRunningDelegates: true,
    });
    expect(plan.willCancelDelegates).toBe(true);
    expect(plan.actions).toContain("cancel_delegates");
    expect(plan.noteMessageKey).toBe("voice.center.endNote.cancelDelegates");
  });

  it("does not claim cancel when no running delegates", () => {
    const plan = planVoiceEnd({
      keepAgents: false,
      hasRunningDelegates: false,
    });
    expect(plan.willCancelDelegates).toBe(false);
    expect(plan.noteMessageKey).toBe("voice.center.endNote.stopOnly");
  });

  it("always stops voice and cancels in-flight tools", () => {
    const plan = planVoiceEnd({
      keepAgents: true,
      hasRunningDelegates: false,
    });
    expect(plan.actions[0]).toBe("stop_voice");
    expect(plan.actions).toContain("cancel_in_flight_tools");
  });
});

describe("hasRunningVoiceDelegates", () => {
  it("only counts delegated running/permission chips", () => {
    expect(
      hasRunningVoiceDelegates([
        {
          id: "1",
          label: "A",
          status: "running",
          isDelegated: false,
          tone: "running",
        },
      ]),
    ).toBe(false);
    expect(
      hasRunningVoiceDelegates([
        {
          id: "1",
          label: "A",
          status: "running",
          isDelegated: true,
          tone: "running",
        },
      ]),
    ).toBe(true);
    expect(hasRunningVoiceDelegates([])).toBe(false);
  });
});
