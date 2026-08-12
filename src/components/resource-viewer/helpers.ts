/**
 * Pure helpers for ResourceViewer (tree width, tab merge, size/name utils).
 */

import { isResourceDraftDirty } from "@/lib/resourceEdit";
import {
  resourceTabPathsEqual,
  type OpenResourceTabResult,
  type ResourceTab,
} from "@/lib/resourceTabs";
import {
  TREE_WIDTH_DEFAULT,
  TREE_WIDTH_KEY,
  TREE_WIDTH_MAX,
  TREE_WIDTH_MIN,
  clampTreeWidth as clampTreeWidthCore,
  loadTreeWidth as loadTreeWidthCore,
  persistTreeWidth as persistTreeWidthCore,
} from "@/lib/resourceTree";
import type { MessageKey } from "@/i18n";
import type { DiffViewState, FileTab } from "./types";

export {
  TREE_WIDTH_DEFAULT,
  TREE_WIDTH_KEY,
  TREE_WIDTH_MAX,
  TREE_WIDTH_MIN,
};

export function loadTreeWidth(): number {
  return loadTreeWidthCore();
}

export function clampTreeWidth(w: number, containerWidth: number): number {
  return clampTreeWidthCore(w, containerWidth);
}

/** Clamp + persist; use on tree resize pointerup (avoids stale width). */
export function persistTreeWidth(w: number, containerWidth: number): number {
  return persistTreeWidthCore(w, containerWidth);
}

export function emptyDiffView(
  path: string,
  name: string,
  loading: boolean,
): DiffViewState {
  return {
    path,
    name,
    loading,
    unified: null,
    afterOnly: null,
    error: null,
    source: null,
    beforeText: null,
    afterText: null,
  };
}

/** Slim strip model for pure open/close/LRU helpers. */
export function fileTabToResourceTab(t: FileTab): ResourceTab {
  const path =
    t.tabKind === "url"
      ? t.url || t.relativePath
      : t.absolutePath || t.relativePath;
  return {
    id: t.id,
    path,
    name: t.name,
    kind: t.preview?.kind,
    dirty: isResourceDraftDirty(t.draftText, t.baselineText),
  };
}

/** Match a file tab by absolute or relative path (normalized). */
export function fileTabMatchesPath(t: FileTab, path: string): boolean {
  if (t.tabKind === "url") {
    return resourceTabPathsEqual(t.url || t.relativePath, path);
  }
  if (t.absolutePath && resourceTabPathsEqual(t.absolutePath, path)) return true;
  if (t.relativePath && resourceTabPathsEqual(t.relativePath, path)) return true;
  return false;
}

/**
 * Apply pure open result onto rich FileTab list (order + LRU drops + optional create).
 */
export function mergeFileTabsFromOpen(
  prev: FileTab[],
  open: OpenResourceTabResult,
  created?: FileTab,
): FileTab[] {
  const byId = new Map(prev.map((t) => [t.id, t]));
  if (created) byId.set(created.id, created);
  for (const id of open.droppedIds) byId.delete(id);
  const out: FileTab[] = [];
  for (const r of open.tabs) {
    const f = byId.get(r.id);
    if (f) out.push(f);
  }
  return out;
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function baseName(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || p;
}

export function guessOfficeKind(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx") || lower.endsWith(".docm")) return "docx";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return "xlsx";
  if (lower.endsWith(".pptx") || lower.endsWith(".pptm")) return "pptx";
  if (lower.endsWith(".pdf")) return "pdf";
  return "docx";
}

/** Map session change status strings to i18n labels. */
export function changeStatusLabel(
  status: string,
  tr: (key: MessageKey, vars?: Record<string, string>) => string,
): string {
  const s = (status || "").toLowerCase();
  if (s === "completed") return tr("changes.status.completed");
  if (s === "failed" || s === "error") return tr("changes.status.failed");
  if (s === "in_progress" || s === "running")
    return tr("changes.status.in_progress");
  if (s === "pending") return tr("changes.status.pending");
  return status || "";
}
