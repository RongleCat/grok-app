import { describe, expect, it } from "vitest";
import {
  buildMemoryOpsSummary,
  clearMemoryScopeUnavailableKey,
  memoryOpsModeChipLabelKey,
  planClearMemoryScope,
  resolveMemoryOpsEmptyState,
  resolveMemoryOpsMode,
  resolveMemoryOpsPresenceChips,
} from "./memoryOpsCenter";

describe("resolveMemoryOpsMode", () => {
  it("returns memory_off only when disabled", () => {
    expect(
      resolveMemoryOpsMode({
        memoryEnabled: false,
        embedModelSet: true,
      }),
    ).toEqual(["memory_off"]);
  });

  it("shows app_keyword when memory is on and embed unknown", () => {
    expect(
      resolveMemoryOpsMode({
        memoryEnabled: true,
        embedModelSet: null,
      }),
    ).toEqual(["app_keyword"]);
    expect(
      resolveMemoryOpsMode({
        memoryEnabled: true,
        embedModelSet: false,
      }),
    ).toEqual(["app_keyword"]);
  });

  it("adds cli_hybrid + hybrid_unavailable when embed set (no host hybrid)", () => {
    expect(
      resolveMemoryOpsMode({
        memoryEnabled: true,
        embedModelSet: true,
      }),
    ).toEqual(["app_keyword", "cli_hybrid", "hybrid_unavailable"]);
  });

  it("omits hybrid_unavailable when hybrid is available", () => {
    expect(
      resolveMemoryOpsMode({
        memoryEnabled: true,
        embedModelSet: true,
        hybridUnavailable: false,
      }),
    ).toEqual(["app_keyword", "cli_hybrid"]);
  });

  it("never invents hybrid browser chips without embed", () => {
    expect(
      resolveMemoryOpsMode({
        memoryEnabled: true,
        embedModelSet: false,
        hybridUnavailable: false,
      }),
    ).toEqual(["app_keyword"]);
  });

  it("maps chip ids to i18n keys", () => {
    expect(memoryOpsModeChipLabelKey("app_keyword")).toBe(
      "settings.memoryOps.mode.appKeyword",
    );
    expect(memoryOpsModeChipLabelKey("cli_hybrid")).toBe(
      "settings.memoryOps.mode.cliHybrid",
    );
    expect(memoryOpsModeChipLabelKey("hybrid_unavailable")).toBe(
      "settings.memoryOps.mode.hybridUnavailable",
    );
    expect(memoryOpsModeChipLabelKey("memory_off")).toBe(
      "settings.memoryOps.mode.memoryOff",
    );
  });
});

describe("resolveMemoryOpsEmptyState", () => {
  it("memory off", () => {
    const s = resolveMemoryOpsEmptyState({ memoryEnabled: false });
    expect(s?.kind).toBe("memory_off");
    expect(s?.showClearActions).toBe(false);
  });

  it("no project", () => {
    const s = resolveMemoryOpsEmptyState({
      memoryEnabled: true,
      hasProject: false,
    });
    expect(s?.kind).toBe("no_project");
  });

  it("empty catalog", () => {
    const s = resolveMemoryOpsEmptyState({
      memoryEnabled: true,
      hasProject: true,
      entryCount: 0,
      embedModelSet: false,
    });
    expect(s?.kind).toBe("empty_catalog");
    expect(s?.showEmbedLink).toBe(true);
  });

  it("returns null when catalog has files", () => {
    expect(
      resolveMemoryOpsEmptyState({
        memoryEnabled: true,
        hasProject: true,
        entryCount: 3,
        embedModelSet: true,
      }),
    ).toBeNull();
  });
});

describe("planClearMemoryScope", () => {
  it("plans workspace clear when cwd present", () => {
    const plan = planClearMemoryScope("workspace", {
      memoryEnabled: true,
      hasCwd: true,
    });
    expect(plan.available).toBe(true);
    expect(plan.confirmNeeded).toBe(true);
    expect(plan.hostScope).toBe("workspace");
    expect(plan.cliArgs).toEqual(["memory", "clear", "-y", "--workspace"]);
    expect(plan.unavailableReason).toBeNull();
    expect(plan.logMeta.available).toBe(true);
  });

  it("soft-fails workspace without cwd", () => {
    const plan = planClearMemoryScope("workspace", {
      memoryEnabled: true,
      hasCwd: false,
    });
    expect(plan.available).toBe(false);
    expect(plan.confirmNeeded).toBe(false);
    expect(plan.unavailableReason).toBe("no_cwd");
    expect(plan.hostScope).toBeNull();
    expect(plan.cliArgs).toEqual([]);
  });

  it("plans global clear via host --global (no cwd required)", () => {
    const plan = planClearMemoryScope("global", {
      memoryEnabled: true,
      hasCwd: false,
    });
    expect(plan.available).toBe(true);
    expect(plan.confirmNeeded).toBe(true);
    expect(plan.hostScope).toBe("global");
    expect(plan.cliArgs).toEqual(["memory", "clear", "-y", "--global"]);
    expect(plan.unavailableReason).toBeNull();
  });

  it("plans all clear via host --all", () => {
    const plan = planClearMemoryScope("all", { memoryEnabled: true });
    expect(plan.available).toBe(true);
    expect(plan.hostScope).toBe("all");
    expect(plan.cliArgs).toEqual(["memory", "clear", "-y", "--all"]);
  });

  it("session scope is soft-unavailable", () => {
    const plan = planClearMemoryScope("session", {
      memoryEnabled: true,
      hasCwd: true,
    });
    expect(plan.available).toBe(false);
    expect(plan.confirmNeeded).toBe(false);
    expect(plan.unavailableReason).toBe("session_not_supported");
    expect(plan.cliArgs).toEqual([]);
    expect(clearMemoryScopeUnavailableKey("session_not_supported")).toBe(
      "settings.memoryOps.clear.unavailable.session",
    );
  });

  it("memory off soft-fails clear without inventing CLI args", () => {
    for (const scope of ["workspace", "global", "all"] as const) {
      const plan = planClearMemoryScope(scope, {
        memoryEnabled: false,
        hasCwd: true,
      });
      expect(plan.available).toBe(false);
      expect(plan.confirmNeeded).toBe(false);
      expect(plan.unavailableReason).toBe("memory_off");
      expect(plan.hostScope).toBeNull();
      expect(plan.cliArgs).toEqual([]);
    }
  });

  it("respects restricted hostScopes (soft-fail)", () => {
    const planAll = planClearMemoryScope("all", {
      memoryEnabled: true,
      hostScopes: ["workspace"],
    });
    expect(planAll.available).toBe(false);
    expect(planAll.unavailableReason).toBe("host_missing");
    expect(planAll.cliArgs).toEqual([]);

    const planGlobal = planClearMemoryScope("global", {
      memoryEnabled: true,
      hostScopes: ["workspace", "all"],
    });
    expect(planGlobal.available).toBe(false);
    expect(planGlobal.unavailableReason).toBe("host_missing");
    expect(planGlobal.cliArgs).toEqual([]);
  });
});

describe("resolveMemoryOpsPresenceChips", () => {
  it("reports set/unset without inventing running status", () => {
    expect(
      resolveMemoryOpsPresenceChips({
        dreamEnabled: true,
        watcherEnabled: null,
      }),
    ).toEqual([
      { id: "dream", presence: "set_on" },
      { id: "watcher", presence: "unset" },
    ]);
    expect(
      resolveMemoryOpsPresenceChips({
        dreamEnabled: false,
        watcherEnabled: false,
      }),
    ).toEqual([
      { id: "dream", presence: "set_off" },
      { id: "watcher", presence: "set_off" },
    ]);
  });
});

describe("buildMemoryOpsSummary", () => {
  it("builds redacted summary and never invents hybrid without CLI", () => {
    const s = buildMemoryOpsSummary({
      memoryEnabled: true,
      embedModel: "text-embedding-3-small",
      dreamEnabled: true,
      watcherEnabled: null,
      entryCount: 2,
      memoryRoot: "/tmp/home/memory",
      cwd: "/Users/me/proj",
    });
    expect(s.embedConfigured).toBe(true);
    expect(s.dreamPresence).toBe("set_on");
    expect(s.watcherPresence).toBe("unset");
    expect(s.modeChips).toContain("app_keyword");
    expect(s.modeChips).toContain("cli_hybrid");
    expect(s.modeChips).toContain("hybrid_unavailable");
    expect(s.searchKind).toBe("hybrid_unavailable");
    expect(s.lines.some((l) => l.startsWith("memoryEnabled="))).toBe(true);
    expect(s.lines.join("\n")).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  });

  it("redacts sensitive tokens in embed model / paths", () => {
    const s = buildMemoryOpsSummary({
      memoryEnabled: true,
      embedModel: "sk-abcdefghijklmnopqrstuvwxyz",
      cwd: "Bearer abcdefghijklmnop",
    });
    expect(s.embedModel).toContain("[REDACTED]");
    expect(s.lines.some((l) => l.includes("[REDACTED]"))).toBe(true);
  });

  it("memory off summary is honest", () => {
    const s = buildMemoryOpsSummary({
      memoryEnabled: false,
      embedModel: "text-embedding-3-small",
    });
    expect(s.modeChips).toEqual(["memory_off"]);
    expect(s.memoryEnabled).toBe(false);
  });
});
