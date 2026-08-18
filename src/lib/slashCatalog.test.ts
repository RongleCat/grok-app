import { describe, expect, it } from "vitest";
import {
  buildSlashCatalog,
  builtinSlashItems,
  countSlashByKind,
  filterPickerSkills,
  filterSlashItems,
  filterSlashItemsByKind,
  flattenFilteredCatalog,
  hasActiveSlashFilters,
  resolveSlashMenuEmptyState,
  skillsToSlashItems,
  slashKindLabelKey,
  type SkillInfo,
  type SlashItem,
} from "./slashCatalog";

describe("builtinSlashItems", () => {
  it("includes expected commands with i18n keys", () => {
    const items = builtinSlashItems();
    const names = items.map((i) => i.name);
    expect(names).toEqual([
      "goal",
      "goal-clear",
      "plan",
      "workflow",
      "workflows",
      "compact",
      "status",
      "usage",
      "cost",
      "mcp",
      "doctor",
      "tutorial",
      "new",
      "automations",
      "live-voice",
      "settings",
      "pet",
      "export",
      "copy",
      "find",
      "history",
      "attach-chat",
      "extensions",
      "yolo",
    ]);

    const goal = items.find((i) => i.name === "goal")!;
    expect(goal.kind).toBe("mode");
    expect(goal.mode).toBe("goal");
    expect(goal.titleKey).toBe("slash.goal");
    expect(goal.descriptionKey).toBe("slash.goalDesc");

    const goalClear = items.find((i) => i.name === "goal-clear")!;
    expect(goalClear.kind).toBe("action");
    expect(goalClear.action).toBe("goal-clear");
    expect(goalClear.titleKey).toBe("slash.goalClear");
    expect(goalClear.descriptionKey).toBe("slash.goalClearDesc");

    const plan = items.find((i) => i.name === "plan")!;
    expect(plan.kind).toBe("mode");
    expect(plan.mode).toBe("plan");

    const compact = items.find((i) => i.name === "compact")!;
    expect(compact.kind).toBe("action");
    expect(compact.action).toBe("compact");

    const usage = items.find((i) => i.name === "usage")!;
    expect(usage.kind).toBe("action");
    expect(usage.action).toBe("usage");
    const cost = items.find((i) => i.name === "cost")!;
    expect(cost.action).toBe("usage");

    const doctor = items.find((i) => i.name === "doctor")!;
    expect(doctor.kind).toBe("action");
    expect(doctor.action).toBe("doctor");

    const tutorial = items.find((i) => i.name === "tutorial")!;
    expect(tutorial.kind).toBe("action");
    expect(tutorial.action).toBe("tutorial");
    expect(tutorial.titleKey).toBe("slash.tutorial");
    expect(tutorial.descriptionKey).toBe("slash.tutorialDesc");

    const exportItem = items.find((i) => i.id === "export")!;
    expect(exportItem.kind).toBe("action");
    expect(exportItem.action).toBe("export");
    expect(exportItem.titleKey).toBe("slash.export");
    expect(exportItem.descriptionKey).toBe("slash.exportDesc");

    const copyItem = items.find((i) => i.id === "copy")!;
    expect(copyItem.kind).toBe("action");
    expect(copyItem.action).toBe("copy");
    expect(copyItem.titleKey).toBe("slash.copy");
    expect(copyItem.descriptionKey).toBe("slash.copyDesc");

    const findItem = items.find((i) => i.id === "find")!;
    expect(findItem.kind).toBe("action");
    expect(findItem.action).toBe("find");
    expect(findItem.titleKey).toBe("slash.find");
    expect(findItem.descriptionKey).toBe("slash.findDesc");

    const historyItem = items.find((i) => i.id === "history")!;
    expect(historyItem.kind).toBe("action");
    expect(historyItem.action).toBe("history");
    expect(historyItem.titleKey).toBe("slash.history");
    expect(historyItem.descriptionKey).toBe("slash.historyDesc");

    const extensionsItem = items.find((i) => i.id === "extensions")!;
    expect(extensionsItem.kind).toBe("action");
    expect(extensionsItem.action).toBe("extensions");
    expect(extensionsItem.titleKey).toBe("slash.extensions");
    expect(extensionsItem.descriptionKey).toBe("slash.extensionsDesc");

    const yolo = items.find((i) => i.name === "yolo")!;
    expect(yolo.kind).toBe("action");
    expect(yolo.action).toBe("yolo");

    const workflow = items.find((i) => i.name === "workflow")!;
    expect(workflow.kind).toBe("action");
    expect(workflow.action).toBe("workflow");
    expect(workflow.titleKey).toBe("slash.workflow");
    expect(workflow.descriptionKey).toBe("slash.workflowDesc");

    const workflows = items.find((i) => i.name === "workflows")!;
    expect(workflows.kind).toBe("action");
    expect(workflows.action).toBe("workflows");
    expect(workflows.titleKey).toBe("slash.workflows");
    expect(workflows.descriptionKey).toBe("slash.workflowsDesc");

    expect(workflow.aliases).toEqual(expect.arrayContaining(["工作流"]));
    expect(
      filterSlashItems(items, "工作流").map((i) => i.name),
    ).toEqual(["workflow", "workflows"]);
  });
});

describe("skillsToSlashItems", () => {
  it("maps skill info to slash items", () => {
    const skills: SkillInfo[] = [
      {
        name: "aihot",
        description: "Hot tips",
        source: "user",
        userInvocable: true,
      },
      { name: "hidden", description: "nope", userInvocable: false },
    ];
    const items = skillsToSlashItems(skills);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "skill:aihot",
      kind: "skill",
      name: "aihot",
      displayTitle: "aihot",
      displayDescription: "Hot tips",
      source: "user",
    });
  });

  it("includes skills when userInvocable is undefined", () => {
    expect(
      skillsToSlashItems([{ name: "x", description: "d" }]),
    ).toHaveLength(1);
  });

  it("hides Extension-disabled skills", () => {
    const skills: SkillInfo[] = [
      { name: "on", description: "yes", enabled: true },
      { name: "off", description: "no", enabled: false },
      { name: "default", description: "yes" },
    ];
    expect(skillsToSlashItems(skills).map((i) => i.name)).toEqual([
      "on",
      "default",
    ]);
  });

  it("prefers project skill when name collides with global", () => {
    const skills: SkillInfo[] = [
      {
        name: "shared",
        description: "user copy",
        source: "user",
        userInvocable: true,
      },
      {
        name: "Shared",
        description: "project copy",
        source: "project",
        userInvocable: true,
      },
    ];
    const items = skillsToSlashItems(skills);
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe("project");
    expect(items[0]!.displayDescription).toBe("project copy");
  });

  it("localizes imagine skill and pins it first", () => {
    const items = skillsToSlashItems([
      { name: "other", description: "misc" },
      {
        name: "imagine",
        description: "How to use image_gen",
        source: "bundled",
      },
    ]);
    expect(items.map((i) => i.name)).toEqual(["imagine", "other"]);
    expect(items[0]).toMatchObject({
      id: "skill:imagine",
      kind: "skill",
      name: "imagine",
      titleKey: "skill.imagine",
      descriptionKey: "skill.imagineDesc",
    });
  });
});

describe("filterPickerSkills", () => {
  it("keeps only enabled + invocable named skills", () => {
    const got = filterPickerSkills([
      { name: "a", description: "A", userInvocable: true, enabled: true },
      { name: "b", description: "B", userInvocable: false },
      { name: "c", description: "C", enabled: false },
      { name: "  ", description: "blank" },
      { name: "d", description: "D" },
    ]);
    expect(got.map((s) => s.name)).toEqual(["a", "d"]);
  });
});

describe("filterSlashItems", () => {
  const items: SlashItem[] = [
    {
      id: "goal",
      kind: "mode",
      name: "goal",
      titleKey: "slash.goal",
      mode: "goal",
    },
    {
      id: "skill:aihot",
      kind: "skill",
      name: "aihot",
      displayTitle: "aihot",
      displayDescription: "AI hot reload helper",
    },
    {
      id: "doctor",
      kind: "action",
      name: "doctor",
      displayDescription: "health check",
    },
  ];

  it("returns all on empty query", () => {
    expect(filterSlashItems(items, "")).toHaveLength(3);
    expect(filterSlashItems(items, "  ")).toHaveLength(3);
  });

  it("filters by name substring", () => {
    expect(filterSlashItems(items, "go").map((i) => i.name)).toEqual(["goal"]);
    expect(filterSlashItems(items, "aih").map((i) => i.name)).toEqual([
      "aihot",
    ]);
  });

  it("filters by description only when query length >= 4", () => {
    expect(filterSlashItems(items, "health").map((i) => i.name)).toEqual([
      "doctor",
    ]);
    // "hot" is 3 chars — name-only; aihot matches by name, doctor does not
    expect(filterSlashItems(items, "hot").map((i) => i.name)).toEqual([
      "aihot",
    ]);
  });

  it("does not match description for short queries", () => {
    const onlyName = filterSlashItems(items, "a").map((i) => i.name);
    expect(onlyName).not.toContain("doctor");
  });

  it("dedupes skills by name", () => {
    const skills: SkillInfo[] = [
      { name: "make-pdf", description: "a" },
      { name: "make-pdf", description: "b" },
      { name: "docx", description: "c" },
    ];
    const items = skillsToSlashItems(skills);
    expect(items.map((i) => i.name)).toEqual(["make-pdf", "docx"]);
  });

  it("is case-insensitive", () => {
    expect(filterSlashItems(items, "GOAL").map((i) => i.name)).toEqual([
      "goal",
    ]);
  });

  it("matches resolved Chinese i18n titles", () => {
    const resolve = (item: SlashItem) => {
      if (item.name === "goal") return { title: "目标", description: "设置目标" };
      if (item.name === "aihot")
        return { title: "aihot", description: "中文资讯热点" };
      return {};
    };
    expect(
      filterSlashItems(items, "目标", resolve).map((i) => i.name),
    ).toEqual(["goal"]);
    expect(
      filterSlashItems(items, "资讯", resolve).map((i) => i.name),
    ).toEqual(["aihot"]);
  });

  it("matches Chinese in displayDescription without resolver", () => {
    const zh: SlashItem[] = [
      {
        id: "skill:x",
        kind: "skill",
        name: "x",
        displayTitle: "x",
        displayDescription: "查询 AI 热点新闻",
      },
    ];
    expect(filterSlashItems(zh, "热点").map((i) => i.name)).toEqual(["x"]);
  });
});

describe("filterSlashItems ranking", () => {
  const peerDesc =
    "call review-commit after execute-spec, thread-closeout, or thread-scope";

  function skill(name: string, description: string): SlashItem {
    return {
      id: `skill:${name}`,
      kind: "skill",
      name,
      displayTitle: name,
      displayDescription: description,
    };
  }

  const items: SlashItem[] = [
    skill("commit", peerDesc),
    skill("execute-spec", peerDesc),
    skill("thread-closeout", peerDesc),
    skill("thread-scope", peerDesc),
    skill("review-commit", "Review changes, fix, verify, and commit"),
    { id: "goal", kind: "mode", name: "goal", mode: "goal" },
    { id: "goal-clear", kind: "action", name: "goal-clear", action: "goal-clear" },
    {
      id: "skill:aihot",
      kind: "skill",
      name: "aihot",
      displayTitle: "aihot",
      displayDescription: "AI hot reload helper",
    },
  ];

  it("selects review-commit from kebab initials (/rc)", () => {
    expect(filterSlashItems(items, "rc").map((i) => i.name)).toEqual([
      "review-commit",
    ]);
  });

  it("selects review-commit from a hyphenated name prefix (/review-)", () => {
    expect(filterSlashItems(items, "review-").map((i) => i.name)).toEqual([
      "review-commit",
    ]);
  });

  it("does not let peer descriptions steal the highlight from review-commit", () => {
    expect(filterSlashItems(items, "review-co").map((i) => i.name)).toEqual([
      "review-commit",
    ]);
  });

  it("ranks exact name ahead of a longer substring (/commit)", () => {
    expect(filterSlashItems(items, "commit").map((i) => i.name)[0]).toBe(
      "commit",
    );
  });

  it("keeps existing name-substring matches", () => {
    expect(filterSlashItems(items, "go").map((i) => i.name)).toEqual([
      "goal",
      "goal-clear",
    ]);
    expect(filterSlashItems(items, "aih").map((i) => i.name)).toEqual([
      "aihot",
    ]);
  });

  it("puts review-commit first in the flattened palette", () => {
    const cat = buildSlashCatalog([
      { name: "commit", description: peerDesc },
      { name: "execute-spec", description: peerDesc },
      { name: "thread-closeout", description: peerDesc },
      { name: "thread-scope", description: peerDesc },
      { name: "review-commit", description: "Review changes and commit" },
    ]);
    expect(flattenFilteredCatalog(cat, "rc").flat[0]!.name).toBe(
      "review-commit",
    );
    expect(flattenFilteredCatalog(cat, "review-").flat[0]!.name).toBe(
      "review-commit",
    );
  });
});

describe("buildSlashCatalog", () => {
  it("splits commands and skills", () => {
    const skills: SkillInfo[] = [
      { name: "s1", description: "one" },
      { name: "s2", description: "two", userInvocable: false },
    ];
    const cat = buildSlashCatalog(skills);
    expect(cat.commands).toEqual(builtinSlashItems());
    expect(cat.skills).toHaveLength(1);
    expect(cat.skills[0]!.name).toBe("s1");
  });
});

describe("filterSlashItems kind chip", () => {
  const items: SlashItem[] = [
    { id: "goal", kind: "mode", name: "goal", mode: "goal" },
    { id: "doctor", kind: "action", name: "doctor", action: "doctor" },
    {
      id: "skill:aihot",
      kind: "skill",
      name: "aihot",
      displayTitle: "aihot",
    },
    {
      id: "help",
      kind: "prompt",
      name: "help",
      displayTitle: "help",
    },
  ];

  it("filters by kind via options object", () => {
    expect(
      filterSlashItems(items, { kind: "mode" }).map((i) => i.name),
    ).toEqual(["goal"]);
    expect(
      filterSlashItems(items, { kind: "action" }).map((i) => i.name),
    ).toEqual(["doctor"]);
    expect(
      filterSlashItems(items, { kind: "skill" }).map((i) => i.name),
    ).toEqual(["aihot"]);
    expect(
      filterSlashItems(items, { kind: "prompt" }).map((i) => i.name),
    ).toEqual(["help"]);
    expect(filterSlashItems(items, { kind: "all" })).toHaveLength(4);
  });

  it("AND-combines kind + query", () => {
    expect(
      filterSlashItems(items, { kind: "mode", query: "go" }).map((i) => i.name),
    ).toEqual(["goal"]);
    expect(
      filterSlashItems(items, { kind: "skill", query: "go" }),
    ).toHaveLength(0);
    expect(
      filterSlashItems(items, { kind: "action", query: "doc" }).map(
        (i) => i.name,
      ),
    ).toEqual(["doctor"]);
  });

  it("keeps string query backward compatible", () => {
    expect(filterSlashItems(items, "goal").map((i) => i.name)).toEqual([
      "goal",
    ]);
  });
});

describe("filterSlashItemsByKind + countSlashByKind", () => {
  const items: SlashItem[] = [
    { id: "goal", kind: "mode", name: "goal" },
    { id: "plan", kind: "mode", name: "plan" },
    { id: "doctor", kind: "action", name: "doctor" },
    { id: "skill:x", kind: "skill", name: "x" },
  ];

  it("filters by kind", () => {
    expect(filterSlashItemsByKind(items, "mode").map((i) => i.name)).toEqual([
      "goal",
      "plan",
    ]);
    expect(filterSlashItemsByKind(items, "all")).toBe(items);
  });

  it("counts per kind", () => {
    expect(countSlashByKind(items)).toEqual({
      all: 4,
      mode: 2,
      action: 1,
      skill: 1,
      prompt: 0,
    });
  });
});

describe("hasActiveSlashFilters + slashKindLabelKey", () => {
  it("detects active filters", () => {
    expect(hasActiveSlashFilters({})).toBe(false);
    expect(hasActiveSlashFilters({ query: "  " })).toBe(false);
    expect(hasActiveSlashFilters({ kind: "all" })).toBe(false);
    expect(hasActiveSlashFilters({ query: "go" })).toBe(true);
    expect(hasActiveSlashFilters({ kind: "skill" })).toBe(true);
  });

  it("maps kind chips to i18n keys", () => {
    expect(slashKindLabelKey("all")).toBe("slash.kind.all");
    expect(slashKindLabelKey("mode")).toBe("slash.kind.mode");
    expect(slashKindLabelKey("action")).toBe("slash.kind.action");
    expect(slashKindLabelKey("prompt")).toBe("slash.kind.prompt");
    expect(slashKindLabelKey("skill")).toBe("slash.kind.skill");
  });
});

describe("flattenFilteredCatalog with kind", () => {
  it("applies kind to commands and skills", () => {
    const cat = buildSlashCatalog([{ name: "aihot", description: "tips" }]);
    const modes = flattenFilteredCatalog(cat, { kind: "mode" });
    expect(modes.skills).toHaveLength(0);
    expect(modes.commands.every((c) => c.kind === "mode")).toBe(true);
    expect(modes.flat.length).toBeGreaterThan(0);

    const skillsOnly = flattenFilteredCatalog(cat, { kind: "skill" });
    expect(skillsOnly.commands).toHaveLength(0);
    expect(skillsOnly.skills.map((s) => s.name)).toEqual(["aihot"]);
  });
});

describe("resolveSlashMenuEmptyState", () => {
  it("returns null when filtered rows exist", () => {
    expect(
      resolveSlashMenuEmptyState({
        catalogCount: 5,
        filteredCount: 2,
        query: "go",
      }),
    ).toBeNull();
  });

  it("loading when catalog empty", () => {
    expect(
      resolveSlashMenuEmptyState({
        loading: true,
        catalogCount: 0,
        filteredCount: 0,
      }),
    ).toMatchObject({
      kind: "loading",
      titleKey: "slash.loading",
      showClearFilters: false,
    });
  });

  it("empty catalog (no query)", () => {
    expect(
      resolveSlashMenuEmptyState({
        catalogCount: 0,
        filteredCount: 0,
        query: "",
      }),
    ).toMatchObject({
      kind: "empty_catalog",
      titleKey: "slash.emptyCatalog",
      hintKey: "slash.emptyCatalogHint",
      showClearFilters: false,
    });
  });

  it("no matches for query", () => {
    expect(
      resolveSlashMenuEmptyState({
        catalogCount: 10,
        filteredCount: 0,
        query: "zzzz",
        kind: "all",
      }),
    ).toMatchObject({
      kind: "no_matches",
      titleKey: "slash.noMatches",
      hintKey: "slash.noMatchesHint",
      showClearFilters: true,
    });
  });

  it("filtered empty by kind chip", () => {
    expect(
      resolveSlashMenuEmptyState({
        catalogCount: 10,
        filteredCount: 0,
        query: "",
        kind: "prompt",
      }),
    ).toMatchObject({
      kind: "filtered",
      titleKey: "slash.filteredEmpty",
      hintKey: "slash.filteredEmptyHint",
      showClearFilters: true,
    });
  });

  it("filtered empty with kind + query uses query hint", () => {
    expect(
      resolveSlashMenuEmptyState({
        catalogCount: 10,
        filteredCount: 0,
        query: "xyz",
        kind: "skill",
      }),
    ).toMatchObject({
      kind: "filtered",
      hintKey: "slash.filteredEmptyHintQuery",
      showClearFilters: true,
    });
  });

  it("no-query defensive empty when catalog has items but none visible", () => {
    expect(
      resolveSlashMenuEmptyState({
        catalogCount: 3,
        filteredCount: 0,
        query: "",
        kind: "all",
      }),
    ).toMatchObject({
      kind: "no_query",
      titleKey: "slash.noQueryEmpty",
      showClearFilters: false,
    });
  });
});
