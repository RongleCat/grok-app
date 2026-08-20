/**
 * Account → Recent sessions → sidebar import.
 *
 * Call-log rows use the CLI agent session folder name as `id`.
 * Import is Host `cli_session_import` (idempotent when already linked).
 * Never invents agent ids.
 */

/** Agent session id that is safe to pass to Host import (single path segment). */
export function isImportableAgentSessionId(
  id: string | null | undefined,
): boolean {
  const s = (id ?? "").trim();
  if (!s) return false;
  if (s.includes("\0")) return false;
  if (s.includes("/") || s.includes("\\")) return false;
  if (s === "." || s === "..") return false;
  if (s.includes("..")) return false;
  return true;
}

export type CallLogImportRow = {
  id: string;
  title?: string | null;
};

export type CallLogImportPlan = {
  /** Deduped agent ids to import (not already linked). */
  ids: string[];
  importable: number;
  skippedLinked: number;
  skippedInvalid: number;
  skippedDuplicate: number;
  selected: number;
  hasImportable: boolean;
};

/**
 * Plan an import of visible call-log rows.
 * Skips invalid ids, duplicates, and already-linked agent sessions.
 * Preserves first-seen order.
 */
export function planCallLogImport(
  rows: readonly CallLogImportRow[] | null | undefined,
  linkedAgentIds?: ReadonlySet<string> | readonly string[] | null,
): CallLogImportPlan {
  const list = rows ?? [];
  const linked = toIdSet(linkedAgentIds);
  const ids: string[] = [];
  const seen = new Set<string>();
  let skippedLinked = 0;
  let skippedInvalid = 0;
  let skippedDuplicate = 0;

  for (const row of list) {
    const id = (row?.id ?? "").trim();
    if (!isImportableAgentSessionId(id)) {
      skippedInvalid += 1;
      continue;
    }
    if (seen.has(id)) {
      skippedDuplicate += 1;
      continue;
    }
    seen.add(id);
    if (linked.has(id)) {
      skippedLinked += 1;
      continue;
    }
    ids.push(id);
  }

  return {
    ids,
    importable: ids.length,
    skippedLinked,
    skippedInvalid,
    skippedDuplicate,
    selected: list.length,
    hasImportable: ids.length > 0,
  };
}

function toIdSet(
  linked: ReadonlySet<string> | readonly string[] | null | undefined,
): Set<string> {
  if (!linked) return new Set();
  if (linked instanceof Set) return linked;
  return new Set(linked);
}

/** Run Host import for each planned id. Continues after a single failure. */
export async function runCallLogImport(
  plan: CallLogImportPlan,
  importOne: (id: string) => Promise<{ id: string } | null>,
): Promise<{ imported: Array<{ id: string }>; failed: number }> {
  const imported: Array<{ id: string }> = [];
  let failed = 0;
  for (const id of plan.ids) {
    try {
      const row = await importOne(id);
      if (row?.id) imported.push({ id: row.id });
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { imported, failed };
}

/**
 * Empty-sidebar CTA: show when Host reported CLI call logs and the
 * sidebar has no (or only the current) unarchived App chat.
 * Never invents CLI sessions when callLogCount is 0.
 */
export function shouldShowSidebarCliImportCta(input: {
  unarchivedAppSessionCount: number;
  callLogCount: number;
}): boolean {
  const logs = Math.max(0, Number(input.callLogCount) || 0);
  if (logs <= 0) return false;
  const apps = Math.max(0, Number(input.unarchivedAppSessionCount) || 0);
  return apps <= 1;
}

/**
 * Auto-add an App project for a CLI cwd (untrusted).
 * Skip home, filesystem roots, and shallow paths like /Users/name.
 * Host still refuses missing directories.
 */
export function shouldAutoAddProjectPath(
  path: string | null | undefined,
  home: string | null | undefined,
): boolean {
  const p = normalizePath(path);
  if (!p) return false;
  if (p === "/" || p === ".") return false;
  // Windows drive root: "c:" or "c:/"
  if (/^[a-z]:\/?$/.test(p)) return false;

  const homeN = normalizePath(home);
  if (homeN) {
    if (p === homeN) return false;
    if (homeN.startsWith(`${p}/`)) return false;
  }

  const segs = p.split("/").filter(Boolean);
  return segs.length >= 4;
}

function normalizePath(path: string | null | undefined): string {
  let s = (path ?? "").trim().replace(/\\/g, "/");
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s.toLowerCase();
}
