import { describe, expect, it } from "vitest";
import {
  autoPackSkills,
  formatSkillPackForComposer,
  rankSkillsForPrompt,
  tokenizePrompt,
} from "./skillPromptMatch";

const CATALOG = [
  {
    name: "vercel-react-best-practices",
    description: "React and Next.js performance optimization guidelines",
  },
  {
    name: "vercel-composition-patterns",
    description: "React composition patterns compound components",
  },
  {
    name: "find-skills",
    description: "Discover and install agent skills from the ecosystem",
  },
  {
    name: "web-design-guidelines",
    description: "Web interface guidelines layout typography accessibility",
  },
  {
    name: "sqli-sql-injection",
    description: "SQL injection testing playbook",
  },
];

describe("tokenizePrompt", () => {
  it("drops stopwords and keeps domain tokens", () => {
    const t = tokenizePrompt("help me optimize React performance please");
    expect(t).toContain("react");
    expect(t).toContain("performance");
    expect(t).toContain("optimize");
    expect(t).not.toContain("please");
    expect(t).not.toContain("help");
  });

  it("expands Vietnamese purpose phrases to domain tokens", () => {
    const t = tokenizePrompt("toi uu hieu nang React app");
    expect(t).toContain("react");
    expect(t.some((x) => x === "performance" || x === "optimize")).toBe(true);
  });
});

describe("rankSkillsForPrompt", () => {
  it("ranks react performance skills above sql", () => {
    const hits = rankSkillsForPrompt({
      skills: CATALOG,
      prompt: "optimize React app performance re-render list",
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.name).toMatch(/react|composition|web-design/i);
    expect(hits.map((h) => h.name)).toContain("vercel-react-best-practices");
    expect(hits[0]!.score).toBeGreaterThan(0);
  });

  it("ranks by purpose for Vietnamese performance prompt", () => {
    const hits = rankSkillsForPrompt({
      skills: CATALOG,
      prompt: "toi uu hieu nang React, giam re-render list",
    });
    expect(hits.map((h) => h.name)).toContain("vercel-react-best-practices");
    expect(hits[0]!.name).toMatch(/react|composition/i);
  });

  it("returns empty when prompt has only stopwords", () => {
    const hits = rankSkillsForPrompt({
      skills: CATALOG,
      prompt: "please help me",
    });
    expect(hits).toEqual([]);
  });

  it("never invents skill names", () => {
    const hits = rankSkillsForPrompt({
      skills: CATALOG,
      prompt: "react performance",
    });
    for (const h of hits) {
      expect(CATALOG.some((c) => c.name === h.name)).toBe(true);
    }
  });
});

describe("autoPackSkills + formatSkillPackForComposer", () => {
  it("packs top hits and formats tokens", () => {
    const hits = rankSkillsForPrompt({
      skills: CATALOG,
      prompt: "find a skill for react performance",
    });
    const pack = autoPackSkills(hits, { max: 3, minScore: 1 });
    expect(pack.length).toBeGreaterThan(0);
    const text = formatSkillPackForComposer(pack, "do the thing");
    expect(text).toContain("do the thing");
    expect(text).toMatch(/\[\[skill:/);
  });
});
