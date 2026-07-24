import { describe, expect, it } from "vitest";
import {
  countDisabled,
  filterEnabledByName,
  filterPluginsByLoadState,
  isCliMissingError,
  isExtensionEnabled,
  mergeEnableSet,
  mergeInspectErrors,
  mcpMetaLine,
  normalizePluginInstallSource,
  normalizePluginUpdateName,
  normalizeSkillSource,
  pluginLoadLabel,
  pluginMetaLine,
  pluginProvidesLine,
  pluginRowKey,
  pluginStatusTone,
  shortPathLabel,
  skillMetaLine,
  skillSourceTone,
  sortMcpByName,
  sortPluginsByName,
  sortSkillsByName,
} from "./extensionsUi";

describe("enable-set merge / filter", () => {
  it("defaults to enabled when missing", () => {
    expect(isExtensionEnabled(undefined)).toBe(true);
    expect(isExtensionEnabled(null)).toBe(true);
    expect(isExtensionEnabled(true)).toBe(true);
    expect(isExtensionEnabled(false)).toBe(false);
  });

  it("mergeEnableSet builds default-on map with overlay", () => {
    expect(mergeEnableSet(["a", "b", "c"], { b: false })).toEqual({
      a: true,
      b: false,
      c: true,
    });
    expect(mergeEnableSet(["a"], null)).toEqual({ a: true });
    expect(mergeEnableSet(["  ", "x"], { x: false })).toEqual({ x: false });
  });

  it("filterEnabledByName drops only explicit false", () => {
    const items = [{ name: "keep" }, { name: "drop" }, { name: "default" }];
    expect(filterEnabledByName(items, { drop: false }).map((i) => i.name)).toEqual([
      "keep",
      "default",
    ]);
    expect(filterEnabledByName(items, undefined).map((i) => i.name)).toEqual([
      "keep",
      "drop",
      "default",
    ]);
  });

  it("countDisabled only counts explicit false", () => {
    expect(countDisabled(["a", "b", "c"], { a: false, b: true })).toBe(1);
    expect(countDisabled(["a"], {})).toBe(0);
  });
});

describe("isCliMissingError", () => {
  it("detects host CLI missing message", () => {
    expect(isCliMissingError("Grok Build CLI not found")).toBe(true);
    expect(isCliMissingError("CLI not found")).toBe(true);
  });

  it("ignores other errors and empty", () => {
    expect(isCliMissingError(null)).toBe(false);
    expect(isCliMissingError("")).toBe(false);
    expect(isCliMissingError("grok inspect timed out after 12s")).toBe(false);
    expect(isCliMissingError("Failed to parse grok inspect JSON")).toBe(false);
  });
});

describe("normalizeSkillSource / skillSourceTone", () => {
  it("normalizes empty source", () => {
    expect(normalizeSkillSource("")).toBe("unknown");
    expect(normalizeSkillSource(null)).toBe("unknown");
    expect(normalizeSkillSource("  project  ")).toBe("project");
  });

  it("maps known tones", () => {
    expect(skillSourceTone("user")).toBe("user");
    expect(skillSourceTone("project")).toBe("project");
    expect(skillSourceTone("plugin")).toBe("plugin");
    expect(skillSourceTone("something-else")).toBe("muted");
  });
});

describe("skillMetaLine / mcpMetaLine", () => {
  it("builds skill meta", () => {
    expect(
      skillMetaLine({
        name: "demo",
        source: "user",
        userInvocable: true,
      }),
    ).toBe("user · user-invocable");
    expect(
      skillMetaLine({ name: "x", source: "project", userInvocable: false }),
    ).toBe("project");
  });

  it("builds mcp meta and skips empties", () => {
    expect(
      mcpMetaLine({
        name: "s",
        transport: "stdio",
        compatibilityStatus: "ok",
        vendor: "xai",
      }),
    ).toBe("stdio · ok · xai");
    expect(
      mcpMetaLine({
        name: "s",
        transport: "  ",
        compatibilityStatus: null,
        vendor: "acme",
      }),
    ).toBe("acme");
  });
});

describe("sort helpers", () => {
  it("sorts skills and mcp by name case-insensitively", () => {
    expect(sortSkillsByName([{ name: "zeta" }, { name: "Alpha" }]).map((s) => s.name)).toEqual([
      "Alpha",
      "zeta",
    ]);
    expect(sortMcpByName([{ name: "b" }, { name: "a" }]).map((s) => s.name)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("shortPathLabel", () => {
  it("returns short paths unchanged", () => {
    expect(shortPathLabel("/tmp/a")).toBe("/tmp/a");
  });

  it("truncates long paths keeping basename tail", () => {
    const long =
      "/Users/someone/Library/Application Support/com.grokapp.grok-app/agent-home/skills/my-skill/SKILL.md";
    const label = shortPathLabel(long, 40);
    expect(label.startsWith("…")).toBe(true);
    expect(label.length).toBeLessThanOrEqual(40);
    expect(label.includes("SKILL.md") || label.includes("my-skill")).toBe(true);
  });

  it("handles empty", () => {
    expect(shortPathLabel("")).toBe("");
    expect(shortPathLabel(null)).toBe("");
  });
});

describe("mergeInspectErrors", () => {
  it("returns null when both empty", () => {
    expect(mergeInspectErrors(null, undefined)).toBeNull();
    expect(mergeInspectErrors("", "")).toBeNull();
  });

  it("prefers CLI missing message", () => {
    expect(
      mergeInspectErrors("Grok Build CLI not found", "timeout"),
    ).toBe("Grok Build CLI not found");
    expect(
      mergeInspectErrors("timeout", "Grok Build CLI not found"),
    ).toBe("Grok Build CLI not found");
  });

  it("dedupes identical messages", () => {
    expect(mergeInspectErrors("same", "same")).toBe("same");
  });

  it("joins distinct non-cli errors", () => {
    expect(mergeInspectErrors("a", "b")).toBe("a · b");
  });

  it("includes plugins error and prefers CLI missing across three", () => {
    expect(mergeInspectErrors("a", "b", "c")).toBe("a · b · c");
    expect(
      mergeInspectErrors("timeout", null, "Grok Build CLI not found"),
    ).toBe("Grok Build CLI not found");
  });
});

describe("plugin helpers", () => {
  it("sorts plugins by name", () => {
    expect(
      sortPluginsByName([{ name: "zeta" }, { name: "Alpha" }]).map((p) => p.name),
    ).toEqual(["Alpha", "zeta"]);
  });

  it("maps load state separately from CLI install status", () => {
    expect(pluginLoadLabel(true)).toBe("enabled");
    expect(pluginLoadLabel(false)).toBe("disabled");
    expect(pluginStatusTone("installed", false)).toBe("disabled");
    expect(pluginStatusTone("installed", true)).toBe("enabled");
  });

  it("builds plugin meta, provides, and row key like Grok Build", () => {
    expect(
      pluginMetaLine({
        name: "demo",
        scope: "user",
        version: "1.5.0",
        marketplace: "xAI Official",
      }),
    ).toBe("user · v1.5.0 · xAI Official");
    expect(
      pluginMetaLine({
        name: "demo",
        source: "https://github.com/ChromeDevTools/chrome-devtools-mcp",
      }),
    ).toContain("ChromeDevTools/chrome-devtools-mcp");
    expect(
      pluginProvidesLine({
        name: "superpowers",
        provides: { skills: 14, agents: 0, hooks: true, mcpServers: 0 },
      }),
    ).toBe("14 skills · hooks");
    expect(
      pluginProvidesLine({
        name: "github",
        provides: { skills: 0, agents: 0, hooks: false, mcpServers: 1 },
      }),
    ).toBe("1 MCP");
    expect(
      pluginRowKey({
        name: "cloudflare",
        repoKey: "skills-39968d19",
      }),
    ).toBe("skills-39968d19:cloudflare");
    expect(pluginRowKey({ name: "solo" })).toBe("solo");
  });

  it("filters by load state (Grok Build f key)", () => {
    const rows = [
      { name: "a", enabled: true },
      { name: "b", enabled: false },
      { name: "c", enabled: true },
    ];
    expect(filterPluginsByLoadState(rows, "all").map((p) => p.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(filterPluginsByLoadState(rows, "enabled").map((p) => p.name)).toEqual([
      "a",
      "c",
    ]);
    expect(filterPluginsByLoadState(rows, "disabled").map((p) => p.name)).toEqual([
      "b",
    ]);
  });

  it("normalizes install source and update name", () => {
    expect(normalizePluginInstallSource("  owner/repo  ")).toBe("owner/repo");
    expect(
      normalizePluginInstallSource("https://github.com/a/b.git"),
    ).toBe("https://github.com/a/b.git");
    expect(normalizePluginInstallSource("/tmp/plugin")).toBe("/tmp/plugin");
    expect(normalizePluginInstallSource("")).toBeNull();
    expect(normalizePluginInstallSource("   ")).toBeNull();
    expect(normalizePluginInstallSource(null)).toBeNull();

    expect(normalizePluginUpdateName("  demo ")).toBe("demo");
    expect(normalizePluginUpdateName("")).toBeNull();
    expect(normalizePluginUpdateName(undefined)).toBeNull();
  });
});
