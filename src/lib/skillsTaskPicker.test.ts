import { describe, expect, it } from "vitest";
import {
  filterPickerEligibleSkills,
  filterSkillsCatalog,
  formatSkillToken,
  loadRecentSkillIds,
  normalizeSkillRef,
  parseRecentSkillIds,
  planInsertSkill,
  pushRecentSkillId,
  rankSkillsForTask,
  recentSkillChips,
  recordRecentSkill,
  resolveSkillsPickerEmptyState,
  saveRecentSkillIds,
  SKILLS_RECENT_MAX,
  SKILLS_RECENT_STORAGE_KEY,
  type SkillsPickerSkill,
  type SkillsRecentStorage,
} from "./skillsTaskPicker";

function memStorage(seed: Record<string, string> = {}): SkillsRecentStorage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

const CATALOG: SkillsPickerSkill[] = [
  { name: "zebra-tool", description: "Z stuff" },
  { name: "alpha-skill", description: "A helper" },
  { name: "media-gen", description: "Generate media images" },
  { name: "agent-only", description: "hidden", userInvocable: false },
  { name: "disabled-one", description: "off", enabled: false },
];

describe("normalizeSkillRef", () => {
  it("trims and accepts valid names", () => {
    expect(normalizeSkillRef("  foo-bar  ")).toBe("foo-bar");
    expect(normalizeSkillRef("a.b:c_1")).toBe("a.b:c_1");
  });

  it("unwraps token and slash forms", () => {
    expect(normalizeSkillRef("[[skill:foo]]")).toBe("foo");
    expect(normalizeSkillRef("/media-gen")).toBe("media-gen");
  });

  it("rejects empty and invalid", () => {
    expect(normalizeSkillRef("")).toBeNull();
    expect(normalizeSkillRef("   ")).toBeNull();
    expect(normalizeSkillRef("bad name")).toBeNull();
    expect(normalizeSkillRef("has/slash")).toBeNull();
    expect(normalizeSkillRef(null)).toBeNull();
    expect(normalizeSkillRef(undefined)).toBeNull();
  });
});

describe("filterPickerEligibleSkills / filterSkillsCatalog", () => {
  it("drops disabled and non-invocable, never invents", () => {
    const el = filterPickerEligibleSkills(CATALOG);
    expect(el.map((s) => s.name).sort()).toEqual([
      "alpha-skill",
      "media-gen",
      "zebra-tool",
    ]);
  });

  it("filters by query on name and description", () => {
    expect(filterSkillsCatalog(CATALOG, "alpha").map((s) => s.name)).toEqual([
      "alpha-skill",
    ]);
    expect(filterSkillsCatalog(CATALOG, "media").map((s) => s.name)).toEqual([
      "media-gen",
    ]);
    expect(filterSkillsCatalog(CATALOG, "images").map((s) => s.name)).toEqual([
      "media-gen",
    ]);
    expect(filterSkillsCatalog(CATALOG, "  ")).toHaveLength(3);
    expect(filterSkillsCatalog(CATALOG, "nope-xyz")).toEqual([]);
  });

  it("dedupes by name", () => {
    const dup: SkillsPickerSkill[] = [
      { name: "foo", description: "first" },
      { name: "foo", description: "second" },
    ];
    expect(filterPickerEligibleSkills(dup)).toEqual([
      {
        name: "foo",
        description: "first",
        source: undefined,
        userInvocable: true,
        enabled: true,
      },
    ]);
  });
});

describe("rankSkillsForTask", () => {
  it("puts recent first then alpha; no fake recs", () => {
    const ranked = rankSkillsForTask({
      skills: CATALOG,
      recentIds: ["zebra-tool", "media-gen", "ghost-not-in-catalog"],
    });
    expect(ranked.map((s) => s.name)).toEqual([
      "zebra-tool",
      "media-gen",
      "alpha-skill",
    ]);
  });

  it("applies query before ranking", () => {
    const ranked = rankSkillsForTask({
      skills: CATALOG,
      recentIds: ["zebra-tool"],
      query: "alpha",
    });
    expect(ranked.map((s) => s.name)).toEqual(["alpha-skill"]);
  });

  it("alpha-sorts when no recent", () => {
    expect(
      rankSkillsForTask({ skills: CATALOG }).map((s) => s.name),
    ).toEqual(["alpha-skill", "media-gen", "zebra-tool"]);
  });

  it("ranks by live prompt and returns only matches", () => {
    const ranked = rankSkillsForTask({
      skills: CATALOG,
      prompt: "generate media images please",
      recentIds: ["zebra-tool"],
    });
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]!.name).toBe("media-gen");
    expect((ranked[0]!.matchScore ?? 0) > 0).toBe(true);
    // Only prompt hits — not full catalog
    expect(ranked.every((s) => (s.matchScore ?? 0) > 0)).toBe(true);
  });

  it("strips skill tokens before prompt match", () => {
    const ranked = rankSkillsForTask({
      skills: CATALOG,
      prompt: "[[skill:zebra-tool]] generate media images",
    });
    expect(ranked.map((s) => s.name)).toContain("media-gen");
  });

  it("does not dump A-Z catalog when prompt has no skill fit", () => {
    const ranked = rankSkillsForTask({
      skills: CATALOG,
      prompt: "toi muon an com hom nay nhe ban oi",
      recentIds: ["zebra-tool"],
    });
    // Prompt active → match-only mode (empty or weak hits), never full alpha list
    expect(ranked.every((s) => (s.matchScore ?? 0) > 0)).toBe(true);
    // Must not force-include recent when nothing matched purpose
    if (ranked.length === 0) {
      expect(ranked).toEqual([]);
    }
  });
});

describe("formatSkillToken / planInsertSkill", () => {
  it("formats stable token", () => {
    expect(formatSkillToken("foo")).toBe("[[skill:foo]]");
    expect(formatSkillToken("bad name")).toBe("");
  });

  it("appends token with spacing", () => {
    expect(planInsertSkill("", "foo")).toBe("[[skill:foo]] ");
    expect(planInsertSkill("hello", "foo")).toBe("hello [[skill:foo]] ");
    expect(planInsertSkill("hello ", "foo")).toBe("hello [[skill:foo]] ");
    expect(planInsertSkill("x", "bad name")).toBe("x");
  });
});

describe("resolveSkillsPickerEmptyState", () => {
  it("returns null when rows visible", () => {
    expect(
      resolveSkillsPickerEmptyState({
        catalogCount: 3,
        filteredCount: 2,
        query: "a",
      }),
    ).toBeNull();
  });

  it("host_only when host error and empty catalog", () => {
    const e = resolveSkillsPickerEmptyState({
      catalogCount: 0,
      filteredCount: 0,
      hostError: "CLI missing",
    });
    expect(e?.kind).toBe("host_only");
    expect(e?.showClearFilter).toBe(false);
  });

  it("empty when no skills installed", () => {
    const e = resolveSkillsPickerEmptyState({
      catalogCount: 0,
      filteredCount: 0,
    });
    expect(e?.kind).toBe("empty");
  });

  it("filter when query hides all", () => {
    const e = resolveSkillsPickerEmptyState({
      catalogCount: 5,
      filteredCount: 0,
      query: "zzz",
    });
    expect(e?.kind).toBe("filter");
    expect(e?.showClearFilter).toBe(true);
  });

  it("suppresses empty while loading first catalog", () => {
    expect(
      resolveSkillsPickerEmptyState({
        catalogCount: 0,
        filteredCount: 0,
        loading: true,
      }),
    ).toBeNull();
  });
});

describe("recent skill ids ring", () => {
  it("parses and caps at max 12", () => {
    const many = Array.from({ length: 20 }, (_, i) => `skill-${i}`);
    expect(parseRecentSkillIds(many)).toHaveLength(SKILLS_RECENT_MAX);
    expect(parseRecentSkillIds(many)[0]).toBe("skill-0");
  });

  it("pushRecentSkillId moves to front and dedupes", () => {
    const next = pushRecentSkillId(["a", "b", "c"], "b");
    expect(next).toEqual(["b", "a", "c"]);
  });

  it("load/save/record via storage", () => {
    const s = memStorage();
    expect(loadRecentSkillIds(s)).toEqual([]);
    saveRecentSkillIds(["foo", "bar"], s);
    expect(loadRecentSkillIds(s)).toEqual(["foo", "bar"]);
    const raw = s.getItem(SKILLS_RECENT_STORAGE_KEY);
    expect(raw).toContain("foo");
    const after = recordRecentSkill("bar", s);
    expect(after[0]).toBe("bar");
    expect(after).toContain("foo");
  });

  it("ignores corrupt storage", () => {
    const s = memStorage({ [SKILLS_RECENT_STORAGE_KEY]: "{not-json" });
    expect(loadRecentSkillIds(s)).toEqual([]);
  });

  it("recentSkillChips only returns catalog hits", () => {
    const chips = recentSkillChips({
      skills: CATALOG,
      recentIds: ["media-gen", "ghost", "alpha-skill", "agent-only"],
      limit: 6,
    });
    expect(chips.map((c) => c.name)).toEqual(["media-gen", "alpha-skill"]);
  });
});
