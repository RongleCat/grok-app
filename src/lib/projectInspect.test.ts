import { describe, expect, it } from "vitest";
import {
  emptyProjectInspectSummary,
  formatInspectJsonForCopy,
  inspectCountsLine,
  isSensitiveKey,
  redactSensitiveValue,
  summarizeInspectJson,
} from "./projectInspect";

const SAMPLE_INSPECT = {
  grokVersion: "0.2.111",
  channel: "stable",
  cwd: "/tmp/demo",
  projectRoot: "/tmp/demo/",
  projectTrusted: true,
  projectInstructions: [
    {
      path: "/tmp/demo/AGENTS.md",
      scope: "project",
      fileType: "agents_md",
      sizeBytes: 100,
    },
  ],
  plugins: [
    {
      name: "demo-plugin",
      scope: "user",
      path: "/home/u/.grok/installed-plugins/demo",
      enabled: true,
      provides: { skills: 2, agents: 0, hooks: false, mcpServers: 1 },
    },
  ],
  skills: [
    {
      name: "help",
      description: "Help skill with sk-abcdefghijklmnopqrstuvwxyz123456",
      source: { type: "user", path: "/home/u/.grok/skills/help/SKILL.md" },
      userInvocable: true,
    },
    {
      name: "internal",
      description: "not invocable",
      source: { type: "plugin" },
      userInvocable: false,
    },
  ],
  mcpServers: [
    {
      name: "context7",
      transport: "stdio",
      target: "/usr/bin/npx",
      env: { API_KEY: "sk-secretsecretsecretsecret" },
    },
  ],
  agents: [{ name: "explore", source: { type: "builtin" } }],
  hooks: [{ event: "stop" }],
  configSources: {
    layers: [{ role: "user", path: "/home/u/.grok/config.toml" }],
  },
  permissions: {
    sources: [{}],
    loaded: 1,
    managedSettingsActive: false,
  },
  defaultModel: "grok-4",
};

describe("isSensitiveKey", () => {
  it("flags common secret field names", () => {
    expect(isSensitiveKey("apiKey")).toBe(true);
    expect(isSensitiveKey("api_key")).toBe(true);
    expect(isSensitiveKey("OPENAI_API_KEY")).toBe(true);
    expect(isSensitiveKey("token")).toBe(true);
    expect(isSensitiveKey("client_secret")).toBe(true);
    expect(isSensitiveKey("password")).toBe(true);
  });

  it("allows safe field names", () => {
    expect(isSensitiveKey("name")).toBe(false);
    expect(isSensitiveKey("path")).toBe(false);
    expect(isSensitiveKey("transport")).toBe(false);
    expect(isSensitiveKey("projectRoot")).toBe(false);
  });
});

describe("summarizeInspectJson", () => {
  it("extracts counts, rules, plugins, mcp without env", () => {
    const s = summarizeInspectJson(SAMPLE_INSPECT, {
      projectPath: "/tmp/demo",
      hasProjectGrokDir: true,
      projectGrokPath: "/tmp/demo/.grok",
      modelsHints: ["grok-3"],
    });

    expect(s.projectRoot).toBe("/tmp/demo/");
    expect(s.projectTrusted).toBe(true);
    expect(s.grokVersion).toBe("0.2.111");
    expect(s.hasProjectGrokDir).toBe(true);
    expect(s.projectGrokPath).toBe("/tmp/demo/.grok");
    expect(s.rules).toHaveLength(1);
    expect(s.rules[0].path).toContain("AGENTS.md");
    expect(s.plugins).toHaveLength(1);
    expect(s.plugins[0].name).toBe("demo-plugin");
    expect(s.plugins[0].provides?.skills).toBe(2);
    expect(s.skills.total).toBe(2);
    expect(s.skills.userInvocable).toBe(1);
    expect(s.skills.bySource.user).toBe(1);
    expect(s.skills.bySource.plugin).toBe(1);
    expect(s.skills.sample).toEqual(["help"]);
    expect(s.mcp).toEqual([
      { name: "context7", transport: "stdio", target: "/usr/bin/npx" },
    ]);
    // Must not leak env
    expect(JSON.stringify(s.mcp)).not.toContain("API_KEY");
    expect(JSON.stringify(s.mcp)).not.toContain("sk-secret");
    expect(s.agents[0].name).toBe("explore");
    expect(s.hooksCount).toBe(1);
    expect(s.configLayers[0].path).toContain("config.toml");
    expect(s.modelsHints).toContain("grok-3");
    expect(s.modelsHints).toContain("grok-4");
    expect(s.modelsHints.some((h) => h.startsWith("channel:"))).toBe(true);
    expect(s.permissions.loaded).toBe(1);
    expect(s.permissions.sourcesCount).toBe(1);
  });

  it("does not include skill descriptions (could embed secrets)", () => {
    const s = summarizeInspectJson(SAMPLE_INSPECT);
    const blob = JSON.stringify(s);
    expect(blob).not.toContain("Help skill");
    expect(blob).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
  });

  it("handles null / invalid payload", () => {
    expect(emptyProjectInspectSummary().skills.total).toBe(0);
    const bad = summarizeInspectJson("nope");
    expect(bad.error).toMatch(/Invalid/);
    expect(bad.plugins).toEqual([]);
  });
});

describe("redactSensitiveValue / formatInspectJsonForCopy", () => {
  it("redacts sensitive keys and containers", () => {
    const scrubbed = redactSensitiveValue({
      name: "ok",
      apiKey: "sk-abcdefghijklmnopqrstuvwxyz",
      env: { FOO: "bar" },
      nested: { token: "secret-token-value-here" },
    }) as Record<string, unknown>;
    expect(scrubbed.name).toBe("ok");
    expect(scrubbed.apiKey).toBe("[REDACTED]");
    expect(scrubbed.env).toBe("[REDACTED]");
    expect((scrubbed.nested as { token: string }).token).toBe("[REDACTED]");
  });

  it("copy JSON is pretty and secret-safe", () => {
    const s = summarizeInspectJson(SAMPLE_INSPECT);
    const text = formatInspectJsonForCopy(s);
    expect(text).toContain('"plugins"');
    expect(text).not.toContain("sk-secret");
    expect(text).not.toContain("API_KEY");
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe("inspectCountsLine", () => {
  it("returns length counters", () => {
    const s = summarizeInspectJson(SAMPLE_INSPECT);
    expect(inspectCountsLine(s)).toEqual({
      plugins: 1,
      skills: 2,
      mcp: 1,
      rules: 1,
      agents: 1,
    });
  });
});
