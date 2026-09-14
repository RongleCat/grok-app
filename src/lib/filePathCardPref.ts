/**
 * User preference: how chat file-path cards label a path.
 * localStorage-only — does not touch Host AppSettings.
 *
 * - basename (default): filename / URL host only (previous product behavior)
 * - original: the token the model wrote (`~/.grok/sandbox.toml`, not just
 *   `sandbox.toml`)
 *
 * Hover always shows the resolved full path (handled in FilePathCard).
 */

import { pathBasename } from "@/lib/attachments";
import { isHttpUrl } from "@/lib/pathRefs";

export const FILE_PATH_CARD_LABEL_STORAGE_KEY = "grok.filePathCardLabel";

/** Fired on `window` after a successful save (detail = FilePathCardLabelMode). */
export const FILE_PATH_CARD_LABEL_CHANGE_EVENT = "grok-file-path-card-label-change";

export type FilePathCardLabelMode = "basename" | "original";

export const DEFAULT_FILE_PATH_CARD_LABEL: FilePathCardLabelMode = "basename";

/** Minimal storage surface so unit tests need no jsdom. */
export interface FilePathCardLabelStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): FilePathCardLabelStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → basename. */
export function parseFilePathCardLabelPref(
  raw: unknown,
): FilePathCardLabelMode {
  if (raw === "original" || raw === "full" || raw === "as-written") {
    return "original";
  }
  return DEFAULT_FILE_PATH_CARD_LABEL;
}

export function loadFilePathCardLabelPref(
  storage: FilePathCardLabelStorage = defaultStorage(),
): FilePathCardLabelMode {
  try {
    return parseFilePathCardLabelPref(
      storage.getItem(FILE_PATH_CARD_LABEL_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_FILE_PATH_CARD_LABEL;
  }
}

export function saveFilePathCardLabelPref(
  mode: FilePathCardLabelMode,
  storage: FilePathCardLabelStorage = defaultStorage(),
): void {
  const next: FilePathCardLabelMode =
    mode === "original" ? "original" : "basename";
  try {
    storage.setItem(FILE_PATH_CARD_LABEL_STORAGE_KEY, next);
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(FILE_PATH_CARD_LABEL_CHANGE_EVENT, { detail: next }),
      );
    } catch {
      /* ignore */
    }
  }
}

/** Visible card title for the current label mode. */
export function filePathCardDisplayLabel(input: {
  mode: FilePathCardLabelMode;
  path: string;
  resolvedAbs?: string | null;
  kind?: "file" | "url" | "dir";
}): string {
  const isUrl = input.kind === "url" || isHttpUrl(input.path);
  if (isUrl) {
    if (input.mode === "original") return input.path;
    try {
      return new URL(input.path).hostname || input.path;
    } catch {
      return input.path;
    }
  }
  if (input.mode === "original") return input.path;
  return pathBasename(input.resolvedAbs || input.path);
}

/** Instant hover text: resolved abs when known, else the original token. */
export function filePathCardHoverLabel(
  path: string,
  resolvedAbs?: string | null,
): string {
  return (resolvedAbs && resolvedAbs.trim()) || path;
}
