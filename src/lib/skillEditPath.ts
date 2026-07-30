/**
 * Pure path allowlist for in-app SKILL.md editing.
 *
 * Host `skill_read` / `skill_write` enforce the same roots; this module is the
 * shared client-side predicate + unit-tested traversal guard.
 */

const SKILL_MD = "skill.md";

/** Normalize separators and strip a single trailing slash for comparison. */
export function normalizeSkillFsPath(path: string): string {
  let p = (path ?? "").trim().replace(/\\/g, "/");
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  // Collapse duplicate slashes (keep leading // for UNC-ish paths as single / after first).
  p = p.replace(/\/{2,}/g, "/");
  return p;
}

/**
 * True when any path segment is `..` (path traversal) or the string contains a NUL.
 * Does not require the path to exist on disk.
 */
export function skillPathHasTraversal(path: string): boolean {
  const raw = (path ?? "").trim();
  if (!raw || raw.includes("\0")) return true;
  const norm = normalizeSkillFsPath(raw);
  // Absolute Windows drive paths keep "C:" as first segment after split on /.
  const parts = norm.split("/").filter((s) => s.length > 0);
  // Reject `..` only; a lone `.` segment is also unsafe as an unresolved relative.
  return parts.some((seg) => seg === ".." || seg === ".");
}

/**
 * Component-wise: is `path` equal to `root` or a descendant?
 * Rejects `/foo` matching `/foobar` style prefix false-positives.
 */
export function isPathUnderSkillRoot(path: string, root: string): boolean {
  const p = normalizeSkillFsPath(path);
  const r = normalizeSkillFsPath(root);
  if (!p || !r) return false;
  if (skillPathHasTraversal(p) || skillPathHasTraversal(r)) return false;
  if (p === r) return true;
  // Case-insensitive on Windows-style absolute paths (drive letter).
  const pCmp = /^[a-zA-Z]:\//.test(p) ? p.toLowerCase() : p;
  const rCmp = /^[a-zA-Z]:\//.test(r) ? r.toLowerCase() : r;
  if (pCmp === rCmp) return true;
  const prefix = rCmp.endsWith("/") ? rCmp : `${rCmp}/`;
  return pCmp.startsWith(prefix);
}

/**
 * Known writable skill roots:
 * - `{userHome}/.grok/skills` (shared / classic GROK_HOME)
 * - `{agentHome}/skills` (App independent agent-home)
 * - `{projectPath}/.grok/skills` (project-local skills)
 *
 * Vendor/bundled/plugin trees are intentionally omitted.
 */
export function buildSkillEditRoots(opts: {
  userHome?: string | null;
  agentHome?: string | null;
  projectPath?: string | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const n = normalizeSkillFsPath(raw ?? "");
    if (!n || skillPathHasTraversal(n)) return;
    const key = /^[a-zA-Z]:\//.test(n) ? n.toLowerCase() : n;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(n);
  };

  const userHome = (opts.userHome ?? "").trim();
  if (userHome) {
    push(`${normalizeSkillFsPath(userHome)}/.grok/skills`);
  }

  const agentHome = (opts.agentHome ?? "").trim();
  if (agentHome) {
    push(`${normalizeSkillFsPath(agentHome)}/skills`);
  }

  const projectPath = (opts.projectPath ?? "").trim();
  if (projectPath) {
    push(`${normalizeSkillFsPath(projectPath)}/.grok/skills`);
  }

  return out;
}

/**
 * Resolve a skill path (dir or SKILL.md) to the SKILL.md file path.
 * Returns null for empty / traversal / non-skill targets.
 */
export function resolveSkillMdPath(path: string | null | undefined): string | null {
  const raw = (path ?? "").trim();
  if (!raw || skillPathHasTraversal(raw)) return null;
  const norm = normalizeSkillFsPath(raw);
  const base = norm.split("/").pop() ?? "";
  if (base.toLowerCase() === SKILL_MD) {
    return norm;
  }
  // Skill directory → SKILL.md inside it (not nested further).
  if (!base || base === "." || base === "..") return null;
  return `${norm}/SKILL.md`;
}

/**
 * True when `path` resolves to a SKILL.md under one of the allowlisted roots.
 * Blocks path traversal and writes outside known skills trees.
 */
export function isSkillPathAllowed(
  path: string | null | undefined,
  roots: string[],
): boolean {
  const md = resolveSkillMdPath(path);
  if (!md) return false;
  if (!roots || roots.length === 0) return false;
  // SKILL.md must sit at `{root}/{skillName}/SKILL.md` (one level under root).
  for (const root of roots) {
    if (!isPathUnderSkillRoot(md, root)) continue;
    const r = normalizeSkillFsPath(root);
    const rest = md.slice(normalizeSkillFsPath(r).length).replace(/^\//, "");
    // rest = "{skillName}/SKILL.md"
    const parts = rest.split("/").filter(Boolean);
    if (parts.length !== 2) continue;
    if (parts[0] === ".." || parts[0] === ".") continue;
    if (parts[1].toLowerCase() !== SKILL_MD) continue;
    // Reject vendor-ish folder names even if somehow under a root.
    if (parts[0].toLowerCase() === "bundled") continue;
    return true;
  }
  return false;
}

/** Skill row is editable when it has a path under allowlisted roots. */
export function isSkillEditable(
  skill: { path?: string | null } | null | undefined,
  roots: string[],
): boolean {
  const p = skill?.path?.trim();
  if (!p) return false;
  return isSkillPathAllowed(p, roots);
}
