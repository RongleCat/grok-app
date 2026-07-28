import { describe, expect, it } from "vitest";
import {
  buildSlashCatalog,
  builtinSlashItems,
  filterPickerSkills,
  filterSlashItems,
  skillsToSlashItems,
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
      "compact",
      "status",
      "mcp",
      "doctor",
      "new",
      "automations",
      "settings",
      "export",
      "copy",
      "find",
      "history",
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

    const doctor = items.find((i) => i.name === "doctor")!;
    expect(doctor.kind).toBe("action");
    expect(doctor.action).toBe("doctor");

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
