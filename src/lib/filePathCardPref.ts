/**
 * User preference: shorten chat file-path chips to the file name.
 * localStorage-only — does not touch Host AppSettings.
 *
 * Default on (previous product behavior). Turn off to keep the token
 * exactly as the model wrote it. Hover always shows the resolved path.
 */

import { pathBasename } from "@/lib/attachments";
import { isHttpUrl, isRealLocalAbsolutePath } from "@/lib/pathRefs";
import { parsePathLineCitation } from "@/lib/pathLineCitation";

export const FILE_PATH_CARD_BASENAME_STORAGE_KEY = "grok.filePathCardBasename";

/** Legacy select key from the unreleased two-option control. */
const LEGACY_LABEL_STORAGE_KEY = "grok.filePathCardLabel";

/** Fired on `window` after a successful save (detail = basenameOnly). */
export const FILE_PATH_CARD_BASENAME_CHANGE_EVENT =
  "grok-file-path-card-basename-change";

export const DEFAULT_FILE_PATH_CARD_BASENAME = true;

/** Minimal storage surface so unit tests need no jsdom. */
export interface FilePathCardBasenameStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): FilePathCardBasenameStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default on. */
export function parseFilePathCardBasenamePref(raw: unknown): boolean {
  if (raw === "0" || raw === "false" || raw === false) return false;
  if (raw === "1" || raw === "true" || raw === true) return true;
  if (raw === "original" || raw === "full" || raw === "as-written") {
    return false;
  }
  if (raw === "basename") return true;
  return DEFAULT_FILE_PATH_CARD_BASENAME;
}

export function loadFilePathCardBasenamePref(
  storage: FilePathCardBasenameStorage = defaultStorage(),
): boolean {
  try {
    const next = storage.getItem(FILE_PATH_CARD_BASENAME_STORAGE_KEY);
    if (next != null) return parseFilePathCardBasenamePref(next);
    return parseFilePathCardBasenamePref(
      storage.getItem(LEGACY_LABEL_STORAGE_KEY),
    );
  } catch {
    /* private mode */
    return DEFAULT_FILE_PATH_CARD_BASENAME;
  }
}

export function saveFilePathCardBasenamePref(
  basenameOnly: boolean,
  storage: FilePathCardBasenameStorage = defaultStorage(),
): void {
  const next = basenameOnly ? true : false;
  try {
    storage.setItem(FILE_PATH_CARD_BASENAME_STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(FILE_PATH_CARD_BASENAME_CHANGE_EVENT, {
          detail: next,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * Model-written token for the chip `path` prop.
 * Strips wrapping `<>` and a trailing `:line[:col]` citation.
 * Must not be replaced with a pathMap / host-resolved absolute.
 */
export function filePathCardWrittenToken(original: string): string {
  const trimmed = original.trim().replace(/^<|>$/g, "");
  if (!trimmed) return "";
  const cited = parsePathLineCitation(trimmed);
  return (cited.path || trimmed).trim();
}

/**
 * Split display vs open: `path` stays the written token; resolved abs is
 * hover/open only. Callers that pass the resolved path as `path` make the
 * "as written" setting show a full disk path.
 */
export function filePathCardTokens(input: {
  written: string;
  resolved?: string | null;
}): { path: string; absolutePath?: string } {
  const path = filePathCardWrittenToken(input.written);
  const abs = (input.resolved || "").trim();
  return {
    path,
    absolutePath:
      abs && isRealLocalAbsolutePath(abs) ? abs : undefined,
  };
}

/** Visible chip title for the current checkbox. */
export function filePathCardDisplayLabel(input: {
  basenameOnly: boolean;
  path: string;
  resolvedAbs?: string | null;
  kind?: "file" | "url" | "dir";
}): string {
  const isUrl = input.kind === "url" || isHttpUrl(input.path);
  if (isUrl) {
    if (!input.basenameOnly) return input.path;
    try {
      return new URL(input.path).hostname || input.path;
    } catch {
      return input.path;
    }
  }
  // Off = model text as written. Never fall back to resolvedAbs here —
  // that is how a short `src/lib/foo.ts` became `/Users/…/foo.ts`.
  if (!input.basenameOnly) return input.path;
  return pathBasename(input.resolvedAbs || input.path);
}

/** Instant hover text: resolved abs when known, else the original token. */
export function filePathCardHoverLabel(
  path: string,
  resolvedAbs?: string | null,
): string {
  return (resolvedAbs && resolvedAbs.trim()) || path;
}
