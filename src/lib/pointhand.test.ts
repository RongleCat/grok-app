import { describe, expect, it } from "vitest";
import {
  POINTHAND_SKILL_MD,
  POINTHAND_SKILL_NAME,
  pointhandPresetFields,
  skillFrontmatterName,
} from "./pointhand";

describe("pointhand preset", () => {
  it("fills a stdio node server with an allow-list", () => {
    expect(pointhandPresetFields()).toEqual({
      name: "pointhand",
      command: "node",
      args: "C:/Tools/PointHand/client/dist/index.js",
      env: "POINTHAND_ALLOW=mspaint.exe",
    });
  });

  it("normalizes Windows paths and allow-list spacing", () => {
    const f = pointhandPresetFields("D:\\PH\\client\\dist\\index.js", " mspaint.exe , Illustrator.exe ,");
    expect(f.args).toBe("D:/PH/client/dist/index.js");
    expect(f.env).toBe("POINTHAND_ALLOW=mspaint.exe,Illustrator.exe");
  });

  it("omits env when the allow-list is empty", () => {
    expect(pointhandPresetFields(undefined, "").env).toBe("");
  });

  it("bundles a SKILL.md the CLI can load", () => {
    expect(skillFrontmatterName(POINTHAND_SKILL_MD)).toBe(POINTHAND_SKILL_NAME);
    expect(POINTHAND_SKILL_MD).toMatch(/^---\r?\n[\s\S]*description: .+/);
    expect(POINTHAND_SKILL_MD).toContain("emergency_stop");
  });
});
