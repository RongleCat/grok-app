import { describe, expect, it } from "vitest";
import {
  applyPluginAtSlash,
  isDraftEmpty,
  parseStoredContent,
  serializeForAgent,
  serializeStored,
} from "./draftDoc";
import {
  buildSlashCatalog,
  inferPluginNameFromPath,
  pluginSkillsMap,
  pluginsToSlashItems,
  type SkillInfo,
} from "./slashCatalog";

describe("inferPluginNameFromPath", () => {
  it("reads installed-plugins and .grok/plugins segments", () => {
    expect(
      inferPluginNameFromPath(
        "/Users/me/.grok/installed-plugins/agent-plugin-codex/skills/x/SKILL.md",
      ),
    ).toBe("agent-plugin-codex");
    expect(
      inferPluginNameFromPath("/Users/me/.grok/plugins/foo/skills/bar/SKILL.md"),
    ).toBe("foo");
    expect(
      inferPluginNameFromPath("D:\\\\work\\\\.grok\\\\plugins\\\\pdf\\\\skills\\\\a\\\\SKILL.md"),
    ).toBe("pdf");
    expect(
      inferPluginNameFromPath("/Users/İ/.grok/plugins/foo/skills/bar/SKILL.md"),
    ).toBe("foo");
  });

  it("ignores user / bundled / project skill paths", () => {
    expect(
      inferPluginNameFromPath("/Users/me/.grok/skills/help/SKILL.md"),
    ).toBeNull();
    expect(
      inferPluginNameFromPath("/Users/me/.grok/bundled/skills/pdf/SKILL.md"),
    ).toBeNull();
    expect(
      inferPluginNameFromPath("/repo/.grok/skills/local/SKILL.md"),
    ).toBeNull();
    expect(inferPluginNameFromPath(null)).toBeNull();
  });
});

describe("pluginsToSlashItems", () => {
  const skills: SkillInfo[] = [
    {
      name: "word-eq",
      description: "eq",
      source: "plugin",
      pluginName: "word-tools",
    },
    {
      name: "word-table",
      description: "tbl",
      source: "plugin",
      pluginName: "word-tools",
    },
    {
      name: "hidden",
      description: "no",
      source: "plugin",
      pluginName: "word-tools",
      userInvocable: false,
    },
    {
      name: "solo",
      description: "s",
      source: "plugin",
      path: "/Users/me/.grok/plugins/solo-pack/skills/solo/SKILL.md",
    },
    { name: "user-skill", description: "u", source: "user" },
  ];

  it("emits one plugin row per pack with invocable skills", () => {
    const items = pluginsToSlashItems(skills);
    expect(items.map((i) => i.name).sort()).toEqual(["solo-pack", "word-tools"]);
    const word = items.find((i) => i.name === "word-tools")!;
    expect(word.kind).toBe("plugin");
    expect(word.id).toBe("plugin:word-tools");
    expect(word.aliases).toEqual(["word-eq", "word-table"]);
  });

  it("omits empty or fully hidden plugins", () => {
    expect(
      pluginsToSlashItems([
        {
          name: "x",
          description: "",
          source: "plugin",
          pluginName: "empty",
          userInvocable: false,
        },
      ]),
    ).toEqual([]);
  });

  it("puts plugin rows ahead of skills in the catalog", () => {
    const cat = buildSlashCatalog(skills);
    const kinds = cat.skills.map((i) => i.kind);
    expect(kinds[0]).toBe("plugin");
    expect(kinds).toContain("skill");
  });
});

describe("pluginSkillsMap", () => {
  it("maps plugin → enabled invocable skill names", () => {
    const map = pluginSkillsMap([
      { name: "a", description: "", pluginName: "p" },
      { name: "b", description: "", pluginName: "p", enabled: false },
      { name: "c", description: "", pluginName: "p", userInvocable: false },
      { name: "d", description: "", source: "user" },
    ]);
    expect(map).toEqual({ p: ["a"] });
  });
});

describe("plugin draft tokens", () => {
  it("round-trips [[plugin:name]]", () => {
    const stored = "[[plugin:word-tools]] hello";
    const segs = parseStoredContent(stored);
    expect(segs).toEqual([
      { type: "plugin", name: "word-tools" },
      { type: "text", text: " hello" },
    ]);
    expect(serializeStored(segs)).toBe(stored);
    expect(isDraftEmpty([{ type: "plugin", name: "word-tools" }])).toBe(false);
  });

  it("inserts a plugin chip at a slash range", () => {
    expect(applyPluginAtSlash("/word", 0, 5, "word-tools")).toBe(
      "[[plugin:word-tools]] ",
    );
  });

  it("expands a plugin chip to its skills and drops redundant skill chips", () => {
    const segs = parseStoredContent(
      "[[plugin:word-tools]][[skill:word-eq]] please",
    );
    expect(
      serializeForAgent(segs, {
        pluginSkills: { "word-tools": ["word-eq", "word-table"] },
      }),
    ).toBe("/word-eq /word-table\nplease");
  });

  it("does not send an empty plugin name", () => {
    expect(
      serializeForAgent([{ type: "plugin", name: "missing" }], {
        pluginSkills: {},
      }),
    ).toBe("");
  });
});
