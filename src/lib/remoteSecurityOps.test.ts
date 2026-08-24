import { describe, expect, it } from "vitest";
import {
  aggregateAllowFromSummary,
  allowFromSummaryKey,
  buildRemoteSecurityChecklist,
  checklistStatusTone,
  classifyRemoteSecurityRisk,
  DANGEROUS_WRITE_CONFIRMS,
  formatRemoteSecuritySummaryText,
  isAllowFromOpen,
  parseAllowFromList,
  redactRemoteSecurityText,
  remoteSecurityRiskKey,
  remoteSecurityRiskTone,
  summarizeAllowFrom,
  summarizeAllowFromRaw,
} from "./remoteSecurityOps";

describe("parseAllowFromList", () => {
  it("returns empty for null / blank", () => {
    expect(parseAllowFromList(null)).toEqual([]);
    expect(parseAllowFromList("")).toEqual([]);
    expect(parseAllowFromList("  ,  ; \n")).toEqual([]);
  });

  it("splits comma / semicolon / newline and trims", () => {
    const entries = parseAllowFromList("ou_a, ou_b; ou_c\nou_d");
    expect(entries.map((e) => e.value)).toEqual([
      "ou_a",
      "ou_b",
      "ou_c",
      "ou_d",
    ]);
    expect(entries.every((e) => !e.wildcard)).toBe(true);
  });

  it("marks wildcard and dedupes case-insensitively", () => {
    const entries = parseAllowFromList("*, ou_1, OU_1, *");
    expect(entries).toEqual([
      { value: "*", wildcard: true },
      { value: "ou_1", wildcard: false },
    ]);
  });
});

describe("summarizeAllowFrom", () => {
  it("empty / open / restricted", () => {
    expect(summarizeAllowFrom([])).toBe("empty");
    expect(summarizeAllowFrom([{ value: "*", wildcard: true }])).toBe(
      "open_acl",
    );
    expect(
      summarizeAllowFrom([
        { value: "u1", wildcard: false },
        { value: "u2", wildcard: false },
      ]),
    ).toBe("restricted");
  });

  it("wildcard wins even with ids present", () => {
    expect(
      summarizeAllowFrom([
        { value: "u1", wildcard: false },
        { value: "*", wildcard: true },
      ]),
    ).toBe("open_acl");
  });

  it("raw helpers", () => {
    expect(summarizeAllowFromRaw("*")).toBe("open_acl");
    expect(summarizeAllowFromRaw("a,b")).toBe("restricted");
    expect(summarizeAllowFromRaw("")).toBe("empty");
    expect(isAllowFromOpen("*")).toBe(true);
    expect(isAllowFromOpen("x")).toBe(false);
  });
});

describe("classifyRemoteSecurityRisk", () => {
  it("ok when restricted ACL and writes off", () => {
    expect(
      classifyRemoteSecurityRisk({
        allowFromOpen: false,
        writeEnabled: false,
        rateLimited: false,
      }),
    ).toBe("ok");
  });

  it("warn on open ACL or write or rate limit alone", () => {
    expect(
      classifyRemoteSecurityRisk({
        allowFromOpen: true,
        writeEnabled: false,
        rateLimited: false,
      }),
    ).toBe("warn");
    expect(
      classifyRemoteSecurityRisk({
        allowFromOpen: false,
        writeEnabled: true,
        rateLimited: false,
      }),
    ).toBe("warn");
    expect(
      classifyRemoteSecurityRisk({
        allowFromOpen: false,
        writeEnabled: false,
        rateLimited: true,
      }),
    ).toBe("warn");
  });

  it("danger when open ACL + write, or write + auth error", () => {
    expect(
      classifyRemoteSecurityRisk({
        allowFromOpen: true,
        writeEnabled: true,
        rateLimited: false,
      }),
    ).toBe("danger");
    expect(
      classifyRemoteSecurityRisk({
        allowFromOpen: false,
        writeEnabled: true,
        rateLimited: false,
        bridgeErrorKind: "auth",
      }),
    ).toBe("danger");
  });

  it("warn on config/crash without open+write", () => {
    expect(
      classifyRemoteSecurityRisk({
        allowFromOpen: false,
        writeEnabled: false,
        rateLimited: false,
        bridgeErrorKind: "crash",
      }),
    ).toBe("warn");
  });
});

describe("buildRemoteSecurityChecklist", () => {
  it("passes restricted ACL, rate active, read-only, yolo off", () => {
    const c = buildRemoteSecurityChecklist({
      allowFromSummary: "restricted",
      bridgeState: "listening",
      bridgeLinked: true,
      rateLimited: false,
      inboundRateLimitActive: true,
      mirrorWriteEnabled: false,
      remoteYoloEnabled: false,
      configuredChannelCount: 1,
      connectedChannelCount: 1,
    });
    expect(c.risk).toBe("ok");
    expect(c.flags.inventLiveWithoutBridge).toBe(false);
    expect(c.flags.allowFromOpen).toBe(false);
    expect(c.flags.writeEnabled).toBe(false);
    const byId = Object.fromEntries(c.items.map((i) => [i.id, i]));
    expect(byId.acl?.status).toBe("pass");
    expect(byId.rate_limit?.status).toBe("pass");
    expect(byId.bridge_health?.status).toBe("pass");
    expect(byId.mirror_write?.status).toBe("pass");
    expect(byId.remote_yolo?.status).toBe("pass");
    expect(byId.live_claim?.status).toBe("pass");
  });

  it("warns open ACL and mirror write / yolo", () => {
    const c = buildRemoteSecurityChecklist({
      allowFromSummary: "open_acl",
      bridgeState: "listening",
      bridgeLinked: true,
      mirrorWriteEnabled: true,
      remoteYoloEnabled: true,
      configuredChannelCount: 2,
    });
    expect(c.risk).toBe("danger");
    const byId = Object.fromEntries(c.items.map((i) => [i.id, i]));
    expect(byId.acl?.status).toBe("warn");
    expect(byId.mirror_write?.status).toBe("warn");
    expect(byId.remote_yolo?.status).toBe("warn");
  });

  it("fails empty ACL when channels configured", () => {
    const c = buildRemoteSecurityChecklist({
      allowFromSummary: "empty",
      configuredChannelCount: 1,
      emptyAclChannelCount: 1,
      bridgeState: "stopped",
    });
    expect(c.items.find((i) => i.id === "acl")?.status).toBe("fail");
  });

  it("rate-limited posture is warn not silent pass", () => {
    const c = buildRemoteSecurityChecklist({
      allowFromSummary: "restricted",
      bridgeState: "listening",
      rateLimited: true,
    });
    expect(c.items.find((i) => i.id === "rate_limit")?.status).toBe("warn");
    expect(c.risk).toBe("warn");
  });

  it("never invents live without bridge link", () => {
    const listeningNoLink = buildRemoteSecurityChecklist({
      allowFromSummary: "restricted",
      bridgeState: "listening",
      bridgeLinked: false,
      connectedChannelCount: 0,
    });
    expect(listeningNoLink.flags.inventLiveWithoutBridge).toBe(false);
    expect(listeningNoLink.flags.bridgeLinked).toBe(false);
    expect(
      listeningNoLink.items.find((i) => i.id === "live_claim")?.status,
    ).toBe("warn");

    const stopped = buildRemoteSecurityChecklist({
      allowFromSummary: "restricted",
      bridgeState: "stopped",
      bridgeLinked: false,
    });
    expect(stopped.flags.inventLiveWithoutBridge).toBe(false);
    expect(stopped.items.find((i) => i.id === "live_claim")?.detailKey).toContain(
      "liveHonest",
    );
  });

  it("bridge error → fail health", () => {
    const c = buildRemoteSecurityChecklist({
      allowFromSummary: "restricted",
      bridgeState: "error",
      bridgeErrorKind: "crash",
    });
    expect(c.items.find((i) => i.id === "bridge_health")?.status).toBe("fail");
  });
});

describe("aggregateAllowFromSummary", () => {
  it("open wins over restricted", () => {
    const a = aggregateAllowFromSummary([
      { enabled: true, hasCredentials: true, allowFrom: "u1" },
      { enabled: true, hasCredentials: true, allowFrom: "*" },
    ]);
    expect(a.summary).toBe("open_acl");
    expect(a.openCount).toBe(1);
    expect(a.restrictedCount).toBe(1);
  });

  it("restricted when all explicit", () => {
    const a = aggregateAllowFromSummary([
      { enabled: true, allowFrom: "a,b" },
      { enabled: true, allowFrom: "c" },
    ]);
    expect(a.summary).toBe("restricted");
  });

  it("empty when nothing useful", () => {
    const a = aggregateAllowFromSummary([
      { enabled: true, allowFrom: "" },
      { enabled: true, allowFrom: "  " },
    ]);
    expect(a.summary).toBe("empty");
  });
});

describe("formatRemoteSecuritySummaryText / redact", () => {
  it("redacts tokens and urls", () => {
    expect(redactRemoteSecurityText("token=abc123secretvalue")).toContain(
      "token=••••",
    );
    expect(redactRemoteSecurityText("see https://evil.example/t/xyz")).toContain(
      "[url]",
    );
    expect(redactRemoteSecurityText("xoxb-1234567890-abcdef")).toBe("••••");
  });

  it("formats multi-line summary without secrets", () => {
    const text = formatRemoteSecuritySummaryText({
      allowFromSummary: "open_acl",
      bridgeState: "listening",
      bridgeLinked: true,
      rateLimited: false,
      mirrorWriteEnabled: false,
      remoteYoloEnabled: true,
      configuredChannelCount: 2,
      connectedChannelCount: 1,
      lastError: "auth failed token=supersecrettokenvalue https://x.com/t/abc",
    });
    // open ACL + YOLO write → danger
    expect(text).toContain("Risk: danger");
    expect(text).toContain("Allow-from: open_acl");
    expect(text).toContain("Remote YOLO: ON");
    expect(text).toContain("Mirror write: off");
    expect(text).toContain("never invent live");
    expect(text).toContain("Invent live without bridge: false");
    expect(text).not.toMatch(/supersecrettokenvalue/);
    expect(text).not.toMatch(/https:\/\/x\.com/);
    expect(text).toMatch(/Last error:/);
  });
});

describe("dangerous-write inventory + keys", () => {
  it("lists confirm surfaces with requiresConfirm", () => {
    expect(DANGEROUS_WRITE_CONFIRMS.length).toBeGreaterThanOrEqual(5);
    for (const c of DANGEROUS_WRITE_CONFIRMS) {
      expect(c.requiresConfirm).toBe(true);
      expect(c.labelKey.startsWith("settings.remoteIm.security.confirm.")).toBe(
        true,
      );
    }
    const ids = DANGEROUS_WRITE_CONFIRMS.map((c) => c.id);
    expect(ids).toContain("mirror_write_enable");
    expect(ids).toContain("mirror_lan_bind");
    expect(ids).toContain("remote_yolo");
    expect(ids).toContain("timeline_clear");
  });

  it("builds stable i18n / tone helpers", () => {
    expect(remoteSecurityRiskKey("danger")).toBe(
      "settings.remoteIm.security.risk.danger",
    );
    expect(allowFromSummaryKey("restricted")).toBe(
      "settings.remoteIm.security.acl.restricted",
    );
    expect(checklistStatusTone("pass")).toBe("ok");
    expect(checklistStatusTone("fail")).toBe("err");
    expect(remoteSecurityRiskTone("warn")).toBe("warn");
    expect(remoteSecurityRiskTone("danger")).toBe("err");
  });
});
