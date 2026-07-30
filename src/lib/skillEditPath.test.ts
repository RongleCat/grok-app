import { describe, expect, it } from "vitest";
import {
  buildSkillEditRoots,
  isPathUnderSkillRoot,
  isSkillEditable,
  isSkillPathAllowed,
  normalizeSkillFsPath,
  resolveSkillMdPath,
  skillPathHasTraversal,
} from "./skillEditPath";

describe("normalizeSkillFsPath", () => {
  it("normalizes backslashes and trailing slash", () => {
    // Avoid trailing `\` before a template close (escapes the backtick).
    expect(normalizeSkillFsPath("C:\\Users\\me\\.grok\\skills\\")).toBe(
      "C:/Users/me/.grok/skills",
    );
    expect(normalizeSkillFsPath("/tmp/skills//a/")).toBe("/tmp/skills/a");
  });

  it("trims whitespace", () => {
    expect(normalizeSkillFsPath("  /home/u/.grok/skills  ")).toBe(
      "/home/u/.grok/skills",
    );
  });
});

describe("skillPathHasTraversal", () => {
  it("rejects parent segments and empty", () => {
    expect(skillPathHasTraversal("../etc/passwd")).toBe(true);
    expect(skillPathHasTraversal("/skills/../secret")).toBe(true);
    expect(skillPathHasTraversal("")).toBe(true);
    expect(skillPathHasTraversal("/skills/./x")).toBe(true);
  });

  it("allows normal absolute skill paths", () => {
    expect(skillPathHasTraversal("/Users/me/.grok/skills/help/SKILL.md")).toBe(
      false,
    );
    expect(skillPathHasTraversal("C:/Users/me/.grok/skills/help/SKILL.md")).toBe(
      false,
    );
  });
});

describe("isPathUnderSkillRoot", () => {
  it("matches descendants and equality", () => {
    expect(
      isPathUnderSkillRoot(
        "/Users/me/.grok/skills/help/SKILL.md",
        "/Users/me/.grok/skills",
      ),
    ).toBe(true);
    expect(
      isPathUnderSkillRoot("/Users/me/.grok/skills", "/Users/me/.grok/skills"),
    ).toBe(true);
  });

  it("does not match path prefix false positives", () => {
    expect(
      isPathUnderSkillRoot("/Users/me/.grok/skills-evil/x", "/Users/me/.grok/skills"),
    ).toBe(false);
    expect(isPathUnderSkillRoot("/foo/bar", "/foobar")).toBe(false);
  });

  it("blocks traversal", () => {
    expect(
      isPathUnderSkillRoot(
        "/Users/me/.grok/skills/../secrets",
        "/Users/me/.grok/skills",
      ),
    ).toBe(false);
  });
});

describe("buildSkillEditRoots", () => {
  it("builds user, agent-home, and project roots", () => {
    const roots = buildSkillEditRoots({
      userHome: "/Users/me",
      agentHome: "/Users/me/Library/Application Support/com.grokapp.grok-app/agent-home",
      projectPath: "/Users/me/Code/demo",
    });
    expect(roots).toEqual([
      "/Users/me/.grok/skills",
      "/Users/me/Library/Application Support/com.grokapp.grok-app/agent-home/skills",
      "/Users/me/Code/demo/.grok/skills",
    ]);
  });

  it("skips empty and dedupes", () => {
    expect(buildSkillEditRoots({})).toEqual([]);
    const roots = buildSkillEditRoots({
      userHome: "/u",
      agentHome: "/u/.grok", // would yield /u/.grok/skills
      projectPath: null,
    });
    // userHome → /u/.grok/skills, agentHome /u/.grok → /u/.grok/skills (deduped)
    expect(roots).toEqual(["/u/.grok/skills"]);
  });
});

describe("resolveSkillMdPath", () => {
  it("keeps SKILL.md paths", () => {
    expect(resolveSkillMdPath("/home/u/.grok/skills/help/SKILL.md")).toBe(
      "/home/u/.grok/skills/help/SKILL.md",
    );
  });

  it("appends SKILL.md for skill directories", () => {
    expect(resolveSkillMdPath("/home/u/.grok/skills/help")).toBe(
      "/home/u/.grok/skills/help/SKILL.md",
    );
  });

  it("rejects traversal", () => {
    expect(resolveSkillMdPath("/home/u/.grok/skills/../x")).toBeNull();
    expect(resolveSkillMdPath("")).toBeNull();
  });
});

describe("isSkillPathAllowed", () => {
  const roots = [
    "/Users/me/.grok/skills",
    "/Users/me/.grok-app/agent-home/skills",
    "/Users/me/Code/demo/.grok/skills",
  ];

  it("allows user skill SKILL.md", () => {
    expect(
      isSkillPathAllowed("/Users/me/.grok/skills/help/SKILL.md", roots),
    ).toBe(true);
    expect(isSkillPathAllowed("/Users/me/.grok/skills/help", roots)).toBe(true);
  });

  it("allows agent-home and project skills", () => {
    expect(
      isSkillPathAllowed(
        "/Users/me/.grok-app/agent-home/skills/my-skill/SKILL.md",
        roots,
      ),
    ).toBe(true);
    expect(
      isSkillPathAllowed(
        "/Users/me/Code/demo/.grok/skills/local/SKILL.md",
        roots,
      ),
    ).toBe(true);
  });

  it("blocks bundled / plugin / outside roots", () => {
    expect(
      isSkillPathAllowed("/Users/me/.grok/bundled/skills/pdf/SKILL.md", roots),
    ).toBe(false);
    expect(
      isSkillPathAllowed(
        "/Users/me/.grok/plugins/foo/skills/bar/SKILL.md",
        roots,
      ),
    ).toBe(false);
    expect(isSkillPathAllowed("/etc/passwd", roots)).toBe(false);
    expect(isSkillPathAllowed("/Users/me/.grok/skills/../.ssh/id_rsa", roots)).toBe(
      false,
    );
  });

  it("blocks nested paths deeper than skill/SKILL.md", () => {
    expect(
      isSkillPathAllowed(
        "/Users/me/.grok/skills/help/nested/SKILL.md",
        roots,
      ),
    ).toBe(false);
  });

  it("blocks empty roots", () => {
    expect(
      isSkillPathAllowed("/Users/me/.grok/skills/help/SKILL.md", []),
    ).toBe(false);
  });
});

describe("isSkillEditable", () => {
  const roots = ["/Users/me/.grok/skills"];

  it("requires path under roots", () => {
    expect(
      isSkillEditable(
        { path: "/Users/me/.grok/skills/help/SKILL.md" },
        roots,
      ),
    ).toBe(true);
    expect(isSkillEditable({ path: null }, roots)).toBe(false);
    expect(isSkillEditable({ path: "" }, roots)).toBe(false);
    expect(
      isSkillEditable(
        { path: "/Users/me/.grok/bundled/skills/x/SKILL.md" },
        roots,
      ),
    ).toBe(false);
  });
});
