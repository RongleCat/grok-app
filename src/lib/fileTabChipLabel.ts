/**
 * Chip labels for open file tabs.
 * Unique basename → just the file name.
 * Colliding names → shortest distinguishing parent suffix (`src/utils.ts`).
 * Pure — no DOM / i18n.
 */

export type FileTabChipSource = {
  id: string;
  path?: string | null;
  name?: string | null;
};

function normalizePath(path?: string | null): string {
  return (path || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

export function fileTabBasename(
  path?: string | null,
  name?: string | null,
): string {
  const p = normalizePath(path);
  if (p) {
    const base = p.split("/").pop();
    if (base) return base;
  }
  const n = (name || "").trim();
  return n || "file";
}

function pathSegments(
  path?: string | null,
  name?: string | null,
): string[] {
  const p = normalizePath(path);
  if (p) return p.split("/").filter(Boolean);
  const n = fileTabBasename(path, name);
  return n ? [n] : [];
}

/**
 * Map tab id → chip label. Callers pass already-localized `name` when
 * the stored name may be an i18n key (empty file workspace tab).
 */
export function disambiguateFileTabLabels(
  tabs: readonly FileTabChipSource[],
): Map<string, string> {
  const out = new Map<string, string>();
  const items = tabs.map((t) => ({
    id: t.id,
    segs: pathSegments(t.path, t.name),
    base: fileTabBasename(t.path, t.name),
  }));

  const byBase = new Map<string, typeof items>();
  for (const it of items) {
    const arr = byBase.get(it.base) ?? [];
    arr.push(it);
    byBase.set(it.base, arr);
  }

  for (const it of items) {
    const group = byBase.get(it.base) ?? [it];
    if (group.length === 1 || it.segs.length === 0) {
      out.set(it.id, it.base);
      continue;
    }
    let take = 1;
    while (take <= it.segs.length) {
      const suffix = it.segs.slice(-take).join("/");
      const clash = group.some(
        (o) => o.id !== it.id && o.segs.slice(-take).join("/") === suffix,
      );
      if (!clash) {
        out.set(it.id, suffix);
        break;
      }
      take += 1;
    }
    if (!out.has(it.id)) {
      out.set(it.id, it.segs.join("/") || it.base);
    }
  }
  return out;
}
