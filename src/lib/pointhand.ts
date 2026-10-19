/**
 * PointHand (https://github.com/ayzekhdawy/pointhand) — Windows computer-use
 * MCP server. The app only offers a preset for the existing "Add MCP server"
 * form and a bundled Grok skill; nothing is written until the user clicks.
 */
import pointhandSkillMarkdown from "../../skills/pointhand/SKILL.md?raw";

export const POINTHAND_REPO_URL = "https://github.com/ayzekhdawy/pointhand";
export const POINTHAND_RELEASES_URL = `${POINTHAND_REPO_URL}/releases`;
export const POINTHAND_SERVER_NAME = "pointhand";
export const POINTHAND_SKILL_NAME = "pointhand";
/** Example path; the user replaces it with their extracted release folder. */
export const POINTHAND_DEFAULT_ENTRY = "C:/Tools/PointHand/client/dist/index.js";
export const POINTHAND_DEFAULT_ALLOW = "mspaint.exe";

export const POINTHAND_SKILL_MD: string = pointhandSkillMarkdown;

/** Values for the Add MCP form fields (same string shapes the form edits). */
export type PointhandPresetFields = {
  name: string;
  command: string;
  args: string;
  env: string;
};

export function pointhandPresetFields(
  entryPath: string = POINTHAND_DEFAULT_ENTRY,
  allow: string = POINTHAND_DEFAULT_ALLOW,
): PointhandPresetFields {
  const entry = entryPath.trim().replace(/\\/g, "/") || POINTHAND_DEFAULT_ENTRY;
  const allowList = allow
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(",");
  return {
    name: POINTHAND_SERVER_NAME,
    command: "node",
    args: entry,
    env: allowList ? `POINTHAND_ALLOW=${allowList}` : "",
  };
}

/** Frontmatter `name:` of a SKILL.md, or null. */
export function skillFrontmatterName(md: string): string | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!m) return null;
  const line = m[1].split(/\r?\n/).find((l) => l.startsWith("name:"));
  return line ? line.slice(5).trim() || null : null;
}
