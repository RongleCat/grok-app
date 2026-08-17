/**
 * Per-session composer draft memory (localStorage).
 *
 * One buffer per real session so a half-typed follow-up survives switching
 * threads and coming back. Complements `composerProjectDraft` (new-chat page
 * only). Cleared after a successful send or explicit composer clear.
 */

import type { Attachment } from "@/lib/attachments";
import {
  normalizeComposerQuotes,
  type ComposerQuote,
} from "@/lib/composerQuotes";
import { isDraftEmpty, parseStoredContent } from "@/lib/draftDoc";

export const COMPOSER_SESSION_DRAFTS_STORAGE_KEY = "grok.composerSessionDrafts";

export type ComposerSessionDraft = {
  text: string;
  attachments: Attachment[];
  quotes?: ComposerQuote[];
  goalMode?: boolean;
  updatedAt: number;
};

/** Minimal storage surface for unit tests without jsdom. */
export interface ComposerSessionDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStorage(): ComposerSessionDraftStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

export function sessionDraftKey(
  sessionId: string | null | undefined,
): string | null {
  const id = (sessionId ?? "").trim();
  return id || null;
}

export function emptyComposerSessionDraft(): ComposerSessionDraft {
  return { text: "", attachments: [], goalMode: false, updatedAt: 0 };
}

export function isComposerSessionDraftEmpty(
  draft: ComposerSessionDraft | null | undefined,
): boolean {
  if (!draft) return true;
  if (draft.attachments?.length) return false;
  if (draft.quotes?.length) return false;
  return isDraftEmpty(parseStoredContent(draft.text || ""));
}

function normalizeAttachment(raw: unknown): Attachment | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const path = typeof o.path === "string" ? o.path.trim() : "";
  if (!path) return null;
  const name =
    typeof o.name === "string" && o.name.trim()
      ? o.name.trim()
      : path.split(/[/\\]/).pop() || path;
  return { path, name, isDir: !!o.isDir };
}

function normalizeDraft(raw: unknown): ComposerSessionDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const text = typeof o.text === "string" ? o.text : "";
  const attsRaw = Array.isArray(o.attachments) ? o.attachments : [];
  const attachments = attsRaw
    .map(normalizeAttachment)
    .filter((a): a is Attachment => !!a);
  const updatedAt =
    typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
      ? o.updatedAt
      : 0;
  const goalMode = o.goalMode === true;
  const quotes = normalizeComposerQuotes(o.quotes);
  return { text, attachments, quotes, goalMode, updatedAt };
}

/** Load full map (invalid JSON → {}). */
export function loadAllComposerSessionDrafts(
  storage: ComposerSessionDraftStorage = defaultStorage(),
): Record<string, ComposerSessionDraft> {
  try {
    const raw = storage.getItem(COMPOSER_SESSION_DRAFTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, ComposerSessionDraft> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const key = (k || "").trim();
      if (!key) continue;
      const d = normalizeDraft(v);
      if (d && !isComposerSessionDraftEmpty(d)) out[key] = d;
    }
    return out;
  } catch {
    return {};
  }
}

export function loadComposerSessionDraft(
  sessionId: string | null | undefined,
  storage: ComposerSessionDraftStorage = defaultStorage(),
): ComposerSessionDraft | null {
  const k = sessionDraftKey(sessionId);
  if (!k) return null;
  const map = loadAllComposerSessionDrafts(storage);
  const direct = map[k] ?? null;
  return direct && !isComposerSessionDraftEmpty(direct) ? direct : null;
}

export function saveComposerSessionDraft(
  sessionId: string | null | undefined,
  draft: {
    text: string;
    attachments?: Attachment[];
    quotes?: ComposerQuote[];
    goalMode?: boolean;
  },
  storage: ComposerSessionDraftStorage = defaultStorage(),
): void {
  const k = sessionDraftKey(sessionId);
  if (!k) return;
  const next: ComposerSessionDraft = {
    text: draft.text ?? "",
    attachments: (draft.attachments ?? [])
      .map((a) => normalizeAttachment(a))
      .filter((a): a is Attachment => !!a),
    quotes: normalizeComposerQuotes(draft.quotes),
    goalMode: !!draft.goalMode,
    updatedAt: Date.now(),
  };

  try {
    const map = loadAllComposerSessionDrafts(storage);
    if (isComposerSessionDraftEmpty(next)) {
      delete map[k];
    } else {
      map[k] = next;
    }
    // Cap entries so a long-lived profile cannot grow forever.
    const keys = Object.keys(map);
    const MAX = 120;
    if (keys.length > MAX) {
      const sorted = keys
        .map((id) => ({ id, t: map[id]?.updatedAt ?? 0 }))
        .sort((a, b) => a.t - b.t);
      for (let i = 0; i < sorted.length - MAX; i++) {
        delete map[sorted[i]!.id];
      }
    }
    storage.setItem(COMPOSER_SESSION_DRAFTS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* private mode / quota */
  }
}

export function clearComposerSessionDraft(
  sessionId: string | null | undefined,
  storage: ComposerSessionDraftStorage = defaultStorage(),
): void {
  saveComposerSessionDraft(sessionId, { text: "", attachments: [] }, storage);
}
