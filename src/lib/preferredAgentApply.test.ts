import { describe, expect, it } from "vitest";
import {
  agentSpawnCliArgs,
  buildPreferredAgentApplyBanner,
  buildPreferredAgentApplyFooter,
  classifyPreferredAgentSoftFail,
  normalizePreferredAgent,
  preferredAgentApplyMessageKey,
  preferredAgentApplyNoteKey,
  preferredAgentSoftFailMessageKey,
  resolvePreferredAgentApplyEffect,
  sessionHasLiveAgent,
} from "./preferredAgentApply";

describe("normalizePreferredAgent + agentSpawnCliArgs (spawn flags)", () => {
  it("omits --agent for empty / sentinels", () => {
    expect(normalizePreferredAgent("")).toBeNull();
    expect(normalizePreferredAgent("default")).toBeNull();
    expect(normalizePreferredAgent("NONE")).toBeNull();
    expect(agentSpawnCliArgs("")).toBeNull();
    expect(agentSpawnCliArgs("cli-default")).toBeNull();
  });

  it("builds top-level --agent NAME when set", () => {
    expect(normalizePreferredAgent("  explore  ")).toBe("explore");
    expect(agentSpawnCliArgs("explore")).toEqual(["--agent", "explore"]);
    expect(agentSpawnCliArgs("  plan  ")).toEqual(["--agent", "plan"]);
  });

  it("soft-fails control characters (omit flag)", () => {
    expect(normalizePreferredAgent("ex\nplore")).toBeNull();
    expect(agentSpawnCliArgs("a\0b")).toBeNull();
  });
});

describe("sessionHasLiveAgent (re-export)", () => {
  it("matches modelEffortApply live states", () => {
    expect(sessionHasLiveAgent("ready")).toBe(true);
    expect(sessionHasLiveAgent("streaming")).toBe(true);
    expect(sessionHasLiveAgent("awaiting_permission")).toBe(true);
    expect(sessionHasLiveAgent("idle")).toBe(false);
    expect(sessionHasLiveAgent(null)).toBe(false);
  });
});

describe("resolvePreferredAgentApplyEffect", () => {
  it("idle → next_message", () => {
    expect(
      resolvePreferredAgentApplyEffect({ hasLiveAgent: false }),
    ).toBe("next_message");
  });

  it("live → soft_respawn (no mid-session agent hot-swap)", () => {
    expect(
      resolvePreferredAgentApplyEffect({ hasLiveAgent: true }),
    ).toBe("soft_respawn");
  });
});

describe("preferredAgentApplyMessageKey / note", () => {
  it("maps effects to stable keys", () => {
    expect(preferredAgentApplyMessageKey("next_message")).toBe(
      "settings.preferredAgent.apply.nextMessage",
    );
    expect(preferredAgentApplyMessageKey("soft_respawn")).toBe(
      "settings.preferredAgent.apply.softRespawn",
    );
    expect(preferredAgentApplyNoteKey()).toBe(
      "settings.preferredAgent.apply.note",
    );
  });
});

describe("buildPreferredAgentApplyBanner", () => {
  it("includes optional agent name var", () => {
    expect(
      buildPreferredAgentApplyBanner({
        effect: "soft_respawn",
        agentName: "explore",
      }),
    ).toEqual({
      messageKey: "settings.preferredAgent.apply.softRespawn",
      vars: { name: "explore" },
    });
    expect(
      buildPreferredAgentApplyBanner({
        effect: "next_message",
        agentName: "  ",
      }),
    ).toEqual({
      messageKey: "settings.preferredAgent.apply.nextMessage",
      vars: {},
    });
  });
});

describe("buildPreferredAgentApplyFooter", () => {
  it("resolves effect from live state", () => {
    expect(
      buildPreferredAgentApplyFooter({
        hasLiveAgent: true,
        agentName: "plan",
      }).messageKey,
    ).toBe("settings.preferredAgent.apply.softRespawn");
    expect(
      buildPreferredAgentApplyFooter({
        hasLiveAgent: false,
      }).messageKey,
    ).toBe("settings.preferredAgent.apply.nextMessage");
  });
});

describe("classifyPreferredAgentSoftFail", () => {
  const catalog = [
    { name: "explore" },
    { name: "custom" },
  ];

  it("default for empty / sentinels", () => {
    expect(classifyPreferredAgentSoftFail("", catalog)).toEqual({
      kind: null,
      name: null,
      willSpawn: false,
    });
    expect(classifyPreferredAgentSoftFail("default", catalog).willSpawn).toBe(
      false,
    );
  });

  it("invalid_chars soft-fail — no spawn flag", () => {
    const r = classifyPreferredAgentSoftFail("bad\nname", catalog);
    expect(r).toEqual({
      kind: "invalid_chars",
      name: null,
      willSpawn: false,
    });
    expect(preferredAgentSoftFailMessageKey(r.kind)).toBe(
      "settings.preferredAgent.apply.invalidChars",
    );
  });

  it("missing_catalog soft-fail — still spawns saved name", () => {
    const r = classifyPreferredAgentSoftFail("ghost-agent", catalog);
    expect(r).toEqual({
      kind: "missing_catalog",
      name: "ghost-agent",
      willSpawn: true,
    });
    expect(preferredAgentSoftFailMessageKey(r.kind)).toBe(
      "settings.agentsPersonas.preferredMissing",
    );
    expect(agentSpawnCliArgs(r.name)).toEqual(["--agent", "ghost-agent"]);
  });

  it("matched catalog name is ok", () => {
    expect(classifyPreferredAgentSoftFail("  Explore  ", catalog)).toEqual({
      kind: null,
      name: "explore",
      willSpawn: true,
    });
  });

  it("without catalog does not invent missing soft-fail", () => {
    expect(classifyPreferredAgentSoftFail("ghost", null).kind).toBeNull();
    expect(classifyPreferredAgentSoftFail("ghost", []).kind).toBeNull();
  });
});

describe("apply effect matrix (effort-like honesty)", () => {
  const cases: Array<{
    live: boolean;
    effect: ReturnType<typeof resolvePreferredAgentApplyEffect>;
  }> = [
    { live: false, effect: "next_message" },
    { live: true, effect: "soft_respawn" },
  ];

  for (const c of cases) {
    it(`hasLiveAgent=${c.live} → ${c.effect}`, () => {
      expect(
        resolvePreferredAgentApplyEffect({ hasLiveAgent: c.live }),
      ).toBe(c.effect);
      expect(
        buildPreferredAgentApplyBanner({ effect: c.effect }).messageKey,
      ).toBe(preferredAgentApplyMessageKey(c.effect));
    });
  }
});
