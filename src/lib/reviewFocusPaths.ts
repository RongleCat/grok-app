/**
 * Turn changed-files → Review focus helpers (#998).
 * Keep clicked paths visible even when sessionChanges / git lists are empty.
 */

import {
  normalizePath,
  pathBaseName,
  pathRelativeToProject,
} from "@/lib/sessionChanges";

/** Merge a newly clicked path into the pinned focus list (newest first, unique). */
export function pinReviewFocusPath(
  prev: readonly string[],
  path: string | null | undefined,
): string[] {
  const want = normalizePath(path || "");
  if (!want) return prev.slice();
  const out = [want];
  for (const p of prev) {
    const n = normalizePath(p);
    if (!n || n === want) continue;
    out.push(n);
  }
  return out;
}

/** Resolve display rel/name for a pinned focus path. */
export function reviewFocusPathParts(
  path: string,
  projectPath: string | null | undefined,
): { path: string; relPath: string; name: string; key: string } {
  const want = normalizePath(path);
  const rel =
    pathRelativeToProject(want, projectPath) ||
    pathBaseName(want) ||
    want;
  const name = pathBaseName(want) || rel;
  return {
    path: want,
    relPath: rel,
    name,
    key: `focus:${rel.toLowerCase()}`,
  };
}

/** True when an entry already covers this focus path. */
export function reviewEntryCoversPath(
  entry: { path?: string; relPath?: string; name?: string },
  focusPath: string,
  projectPath?: string | null,
): boolean {
  const want = normalizePath(focusPath);
  if (!want) return false;
  const parts = reviewFocusPathParts(want, projectPath);
  const fp = normalizePath(entry.path || "");
  const fr = normalizePath(entry.relPath || "").toLowerCase();
  const wantRel = normalizePath(parts.relPath).toLowerCase();
  const wantBase = parts.name.toLowerCase();
  if (fp === want || fr === wantRel) return true;
  if (wantBase && pathBaseName(fp).toLowerCase() === wantBase) return true;
  if (wantBase && (fr === wantBase || fr.endsWith("/" + wantBase))) return true;
  return false;
}

/**
 * scrollTop so `childTop` aligns with the container's visible top.
 * Pure — apply only on the Review stack scroller. Never use
 * Element.scrollIntoView: it walks ancestor overflow and can hide the
 * mac Overlay custom titlebar under traffic lights (#1041).
 */
export function scrollTopToAlignChildStart(
  containerScrollTop: number,
  containerTop: number,
  childTop: number,
): number {
  return Math.max(0, containerScrollTop + (childTop - containerTop));
}

/** Align `child` to the top of `container` without touching ancestors. */
export function scrollChildToContainerStart(
  container: HTMLElement,
  child: HTMLElement,
): void {
  const cRect = container.getBoundingClientRect();
  const eRect = child.getBoundingClientRect();
  container.scrollTop = scrollTopToAlignChildStart(
    container.scrollTop,
    cRect.top,
    eRect.top,
  );
}
