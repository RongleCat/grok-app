import { describe, expect, it } from "vitest";
import {
  emptyProjectInspectSummary,
  filterInspectSections,
  formatInspectJsonForCopy,
  formatInspectSectionJson,
  inspectCountsLine,
  inspectSectionCount,
  inspectSectionCounts,
  inspectSectionDocsUrl,
  inspectSectionHasContent,
  inspectSectionPaths,
  inspectSectionSlice,
  isSensitiveKey,
  normalizeProjectInspectSummary,
  redactSensitiveValue,
  sliceInspectList,
  summarizeInspectJson,
  INSPECT_SECTION_IDS,
} from "./projectInspect";

describe("normalizeProjectInspectSummary", () => {
  it("fills list fields and derives names/hooks for older host payloads", () => {
    const base = emptyProjectInspectSummary();
    const normalized = normalizeProjectInspectSummary({
      ...base,
      skills: { ...base.skills, names: [], sample: ["fallback-skill"] },
      hooks: [{ event: "stop" }],
      hooksCount: 0,
    });

    expect(normalized.skills.names).toEqual(["fallback-skill"]);
    expect(normalized.hooksCount).toBe(1);
    expect(normalized.plugins).toEqual([]);
  });
});

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
      source: { type: "configToml", path: "/home/u/.grok/config.toml" },
      env: { API_KEY: "sk-secretsecretsecretsecret" },
    },
  ],
  agents: [{ name: "explore", source: { type: "builtin" } }],
  hooks: [
    {
      event: "stop",
      hookType: "file",
      target: "/tmp/demo/.grok/hooks/stop.json",
      source: { type: "project" },
      matcher: null,
    },
  ],
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
  it("extracts counts, rules, plugins, mcp, hooks without env", () => {
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
    expect(s.skills.names).toEqual(["help", "internal"]);
    expect(s.mcp).toEqual([
      {
        name: "context7",
        transport: "stdio",
        target: "/usr/bin/npx",
        source: "configToml",
      },
    ]);
    // Must not leak env
    expect(JSON.stringify(s.mcp)).not.toContain("API_KEY");
    expect(JSON.stringify(s.mcp)).not.toContain("sk-secret");
    expect(s.agents[0].name).toBe("explore");
    expect(s.hooksCount).toBe(1);
    expect(s.hooks).toHaveLength(1);
    expect(s.hooks[0].event).toBe("stop");
    expect(s.hooks[0].hookType).toBe("file");
    expect(s.hooks[0].target).toContain("stop.json");
    expect(s.hooks[0].source).toBe("project");
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
    expect(emptyProjectInspectSummary().skills.names).toEqual([]);
    expect(emptyProjectInspectSummary().hooks).toEqual([]);
    const bad = summarizeInspectJson("nope");
    expect(bad.error).toMatch(/Invalid/);
    expect(bad.plugins).toEqual([]);
    expect(bad.hooks).toEqual([]);
  });

  it("counts bare hook numbers without inventing rows", () => {
    const s = summarizeInspectJson({ hooks: [1, 2] });
    expect(s.hooks).toEqual([]);
    expect(s.hooksCount).toBe(2);
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
    expect(text).toContain('"hooks"');
    expect(text).not.toContain("sk-secret");
    expect(text).not.toContain("API_KEY");
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe("inspectCountsLine", () => {
  it("returns length counters including hooks", () => {
    const s = summarizeInspectJson(SAMPLE_INSPECT);
    expect(inspectCountsLine(s)).toEqual({
      plugins: 1,
      skills: 2,
      mcp: 1,
      rules: 1,
      agents: 1,
      hooks: 1,
    });
  });
});

describe("section chips / filter helpers", () => {
  const s = summarizeInspectJson(SAMPLE_INSPECT, {
    projectPath: "/tmp/demo",
    hasProjectGrokDir: true,
    projectGrokPath: "/tmp/demo/.grok",
  });

  it("counts per section including all", () => {
    const counts = inspectSectionCounts(s);
    expect(counts.plugins).toBe(1);
    expect(counts.skills).toBe(2);
    expect(counts.mcp).toBe(1);
    expect(counts.hooks).toBe(1);
    expect(counts.agents).toBe(1);
    expect(counts.rules).toBe(1);
    expect(counts.config).toBe(1);
    expect(counts.models).toBeGreaterThan(0);
    expect(counts.permissions).toBe(1);
    expect(counts.all).toBeGreaterThan(counts.plugins);
    expect(INSPECT_SECTION_IDS[0]).toBe("all");
  });

  it("filterInspectSections returns non-empty inventory for all", () => {
    const ids = filterInspectSections(s, "all");
    expect(ids).toContain("plugins");
    expect(ids).toContain("skills");
    expect(ids).toContain("hooks");
    expect(ids).toContain("mcp");
    expect(ids).not.toContain("all" as never);
  });

  it("filterInspectSections narrows to one section", () => {
    expect(filterInspectSections(s, "hooks")).toEqual(["hooks"]);
    expect(filterInspectSections(s, "plugins")).toEqual(["plugins"]);
  });

  it("empty summary yields empty filter", () => {
    const empty = emptyProjectInspectSummary();
    expect(filterInspectSections(empty, "all")).toEqual([]);
    expect(inspectSectionHasContent(empty, "plugins")).toBe(false);
    expect(inspectSectionCount(empty, "all")).toBe(0);
  });

  it("formatInspectSectionJson is secret-safe per section", () => {
    const hooksJson = formatInspectSectionJson(s, "hooks");
    expect(hooksJson).toContain("stop");
    expect(hooksJson).not.toContain("sk-secret");
    const skillsJson = formatInspectSectionJson(s, "skills");
    expect(skillsJson).toContain("help");
    expect(skillsJson).not.toContain("Help skill");
    const allJson = formatInspectSectionJson(s, "all");
    expect(() => JSON.parse(allJson)).not.toThrow();
  });

  it("inspectSectionSlice returns focused payload", () => {
    expect(inspectSectionSlice(s, "agents")).toEqual(s.agents);
    expect(inspectSectionSlice(s, "mcp")).toEqual(s.mcp);
    const hooks = inspectSectionSlice(s, "hooks") as {
      count: number;
      hooks: unknown[];
    };
    expect(hooks.count).toBe(1);
    expect(hooks.hooks).toHaveLength(1);
  });

  it("inspectSectionPaths collects reveal-able paths only", () => {
    expect(inspectSectionPaths(s, "rules")).toEqual(["/tmp/demo/AGENTS.md"]);
    expect(inspectSectionPaths(s, "plugins")[0]).toContain("installed-plugins");
    expect(inspectSectionPaths(s, "hooks")[0]).toContain("stop.json");
    expect(inspectSectionPaths(s, "config")[0]).toContain("config.toml");
    // HTTP targets are skipped
    const withHttp = summarizeInspectJson({
      mcpServers: [
        {
          name: "remote",
          transport: "http",
          target: "https://example.com/mcp",
        },
      ],
    });
    expect(inspectSectionPaths(withHttp, "mcp")).toEqual([]);
  });

  it("inspectSectionDocsUrl is null without homepage fields", () => {
    expect(inspectSectionDocsUrl(s, "plugins")).toBeNull();
    expect(inspectSectionDocsUrl(s, "all")).toBeNull();
  });

  it("sliceInspectList expands long lists", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const collapsed = sliceInspectList(items, { limit: 8, expanded: false });
    expect(collapsed.visible).toHaveLength(8);
    expect(collapsed.hidden).toBe(12);
    const expanded = sliceInspectList(items, { limit: 8, expanded: true });
    expect(expanded.visible).toHaveLength(20);
    expect(expanded.hidden).toBe(0);
  });
});
