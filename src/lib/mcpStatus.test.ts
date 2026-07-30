import { describe, expect, it } from "vitest";
import {
  detectAuthToneFromText,
  indexDoctorServerStatuses,
  inferMcpStatusTone,
  lookupServerStatus,
  mapIssuesToServers,
  mcpAuthGuidanceKey,
  mcpStatusBadgeMod,
  mcpStatusLabelKey,
  redactMcpText,
  statusFromDoctorServer,
  type McpDoctorReportLike,
} from "./mcpStatus";

/** Fixture shaped like host `mcp_doctor` / `grok mcp doctor --json`. */
const DOCTOR_FIXTURE: McpDoctorReportLike = {
  ok: false,
  summary: { total: 3, healthy: 1, unhealthy: 2 },
  sources: [
    { path: "~/.grok/config.toml", status: "found", serverCount: 3 },
  ],
  servers: [
    {
      name: "context7",
      transport: "stdio",
      target: "npx",
      healthy: true,
      checks: [
        { label: "server started", passed: true, detail: "1.2s" },
      ],
    },
    {
      name: "github",
      transport: "http",
      target: "https://api.github.com/mcp",
      healthy: false,
      checks: [
        {
          label: "handshake",
          passed: false,
          detail: "401 Unauthorized — token expired",
          hint: "re-authenticate the MCP server",
        },
      ],
    },
    {
      name: "broken",
      transport: "http",
      target: "https://example.com",
      healthy: false,
      checks: [
        {
          label: "handshake failed",
          passed: false,
          detail: "connection refused",
          hint: "check remote URL",
        },
      ],
    },
  ],
  issues: [
    {
      server: "github",
      message: "OAuth token expired for github",
    },
    {
      name: "orphan-svc",
      message: "auth required before use",
    },
    "generic warning about slow startup",
  ],
};

describe("redactMcpText", () => {
  it("redacts env-style secrets and bearer tokens", () => {
    const raw =
      "failed with GITHUB_TOKEN=ghs_abc123secret and Bearer abcdefghijklmnop";
    const out = redactMcpText(raw);
    expect(out).not.toContain("ghs_abc123secret");
    expect(out).not.toMatch(/Bearer\s+abcdef/i);
    expect(out).toContain("[REDACTED]");
    expect(out).toContain("GITHUB_TOKEN=");
  });

  it("returns empty for nullish", () => {
    expect(redactMcpText(null)).toBe("");
    expect(redactMcpText(undefined)).toBe("");
  });
});

describe("detectAuthToneFromText", () => {
  it("detects expired", () => {
    expect(detectAuthToneFromText("Token expired")).toBe("auth_expired");
    expect(detectAuthToneFromText("SESSION EXPIRED")).toBe("auth_expired");
  });

  it("detects auth required / 401", () => {
    expect(detectAuthToneFromText("401 Unauthorized")).toBe("auth_required");
    expect(detectAuthToneFromText("authentication required")).toBe(
      "auth_required",
    );
    expect(detectAuthToneFromText("invalid token")).toBe("auth_required");
  });

  it("returns null when no auth keywords", () => {
    expect(detectAuthToneFromText("connection refused")).toBeNull();
    expect(detectAuthToneFromText("")).toBeNull();
  });

  it("prioritizes expired over generic auth", () => {
    expect(
      detectAuthToneFromText("unauthorized because token expired"),
    ).toBe("auth_expired");
  });
});

describe("inferMcpStatusTone", () => {
  it("returns ok for healthy without warnings", () => {
    expect(inferMcpStatusTone(["server started"], true)).toBe("ok");
  });

  it("returns warn for healthy with warning keywords", () => {
    expect(inferMcpStatusTone(["slow response warning"], true)).toBe("warn");
  });

  it("returns error for unhealthy connection failures", () => {
    expect(inferMcpStatusTone(["connection refused"], false)).toBe("error");
  });

  it("returns auth tones from text even when healthy flag set", () => {
    expect(inferMcpStatusTone(["token expired"], false)).toBe("auth_expired");
    expect(inferMcpStatusTone(["401 unauthorized"], false)).toBe(
      "auth_required",
    );
  });

  it("returns unknown with no signal", () => {
    expect(inferMcpStatusTone([], null)).toBe("unknown");
  });
});

describe("statusFromDoctorServer", () => {
  it("marks healthy servers ok", () => {
    const s = statusFromDoctorServer(DOCTOR_FIXTURE.servers![0]);
    expect(s?.tone).toBe("ok");
    expect(s?.needsAuthRefresh).toBe(false);
    expect(s?.healthy).toBe(true);
  });

  it("detects auth_expired from failed checks", () => {
    const s = statusFromDoctorServer(DOCTOR_FIXTURE.servers![1]);
    expect(s?.tone).toBe("auth_expired");
    expect(s?.needsAuthRefresh).toBe(true);
    expect(s?.issues.length).toBeGreaterThan(0);
    expect(s?.reason).toBeTruthy();
  });

  it("marks connection failures as error", () => {
    const s = statusFromDoctorServer(DOCTOR_FIXTURE.servers![2]);
    expect(s?.tone).toBe("error");
    expect(s?.needsAuthRefresh).toBe(false);
  });

  it("never leaks secrets in reason/issues", () => {
    const s = statusFromDoctorServer({
      name: "leaky",
      healthy: false,
      checks: [
        {
          label: "auth",
          passed: false,
          detail: "API_TOKEN=supersecretvalue123 failed",
        },
      ],
    });
    expect(s?.reason).not.toContain("supersecretvalue123");
    expect(s?.issues.join(" ")).not.toContain("supersecretvalue123");
    expect(s?.issues.join(" ")).toContain("[REDACTED]");
  });

  it("returns null without a name", () => {
    expect(statusFromDoctorServer({ healthy: true })).toBeNull();
  });
});

describe("mapIssuesToServers", () => {
  it("maps by server / name fields and text mention", () => {
    const map = mapIssuesToServers(
      [
        { server: "github", message: "token expired" },
        { name: "orphan-svc", message: "auth required" },
        "context7 is slow",
        "unscoped noise",
      ],
      ["context7", "github"],
    );
    expect(map.get("github")?.[0]).toMatch(/token expired/i);
    expect(map.get("orphan-svc")?.[0]).toMatch(/auth required/i);
    expect(map.get("context7")?.[0]).toMatch(/slow/i);
    expect(map.get("")?.[0]).toMatch(/unscoped/i);
  });
});

describe("indexDoctorServerStatuses", () => {
  it("indexes fixture servers with auth and error tones", () => {
    const index = indexDoctorServerStatuses(DOCTOR_FIXTURE);
    expect(index.size).toBeGreaterThanOrEqual(3);

    const ctx = lookupServerStatus(index, "context7");
    expect(ctx?.tone).toBe("ok");

    const gh = lookupServerStatus(index, "github");
    expect(gh?.tone).toBe("auth_expired");
    expect(gh?.needsAuthRefresh).toBe(true);
    // Extra top-level issue for github should be attached.
    expect(gh?.issues.some((i) => /oauth|token|expired/i.test(i))).toBe(true);

    const broken = lookupServerStatus(index, "broken");
    expect(broken?.tone).toBe("error");

    // Synthetic orphan from issues[]
    const orphan = lookupServerStatus(index, "orphan-svc");
    expect(orphan?.tone).toBe("auth_required");
  });

  it("looks up case-insensitively", () => {
    const index = indexDoctorServerStatuses(DOCTOR_FIXTURE);
    expect(lookupServerStatus(index, "GITHUB")?.name).toBe("github");
  });

  it("handles empty / null report", () => {
    expect(indexDoctorServerStatuses(null).size).toBe(0);
    expect(indexDoctorServerStatuses({}).size).toBe(0);
  });

  it("handles report with only issues array", () => {
    const index = indexDoctorServerStatuses({
      issues: [{ server: "remote", message: "401 Unauthorized" }],
    });
    expect(lookupServerStatus(index, "remote")?.tone).toBe("auth_required");
  });
});

describe("label / badge / guidance helpers", () => {
  it("maps tones to i18n keys and badge mods", () => {
    expect(mcpStatusLabelKey("ok")).toBe("ext.mcp.status.ok");
    expect(mcpStatusLabelKey("auth_expired")).toBe(
      "ext.mcp.status.authExpired",
    );
    expect(mcpStatusBadgeMod("ok")).toBe("ok");
    expect(mcpStatusBadgeMod("error")).toBe("fail");
    expect(mcpStatusBadgeMod("auth_required")).toBe("auth");
    expect(mcpStatusBadgeMod("unknown")).toBe("muted");
  });

  it("returns guidance keys only for auth tones", () => {
    expect(mcpAuthGuidanceKey("auth_expired")).toBe(
      "ext.mcp.auth.expiredHint",
    );
    expect(mcpAuthGuidanceKey("auth_required")).toBe(
      "ext.mcp.auth.requiredHint",
    );
    expect(mcpAuthGuidanceKey("error")).toBeNull();
  });
});
