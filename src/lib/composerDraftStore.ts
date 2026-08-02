/**
 * External composer draft store.
 *
 * Typing updates live here so App (and other heavy parents) do not re-render
 * on every keystroke. Subscribe via useSyncExternalStore in small islands
 * (editor, stats, send chrome) only.
 */

import { isDraftEmpty, parseStoredContent } from "@/lib/draftDoc";

export type ComposerDraftMeta = {
  /** True when draft has no skill chips and no non-whitespace text. */
  empty: boolean;
  /** Raw stored-string length (for stats / clear thresholds). */
  length: number;
};

type Listener = () => void;

let draft = "";
let meta: ComposerDraftMeta = { empty: true, length: 0 };

const listeners = new Set<Listener>();
const metaListeners = new Set<Listener>();

function computeMeta(text: string): ComposerDraftMeta {
  return {
    empty: isDraftEmpty(parseStoredContent(text)),
    length: text.length,
  };
}

function emit(set: Set<Listener>) {
  for (const listener of set) listener();
}

/** Current draft string (call-time read; safe in event handlers / send). */
export function getDraft(): string {
  return draft;
}

/** useSyncExternalStore snapshot (same as getDraft). */
export function getSnapshot(): string {
  return draft;
}

export function getMetaSnapshot(): ComposerDraftMeta {
  return meta;
}

/**
 * Replace or functionally update the draft.
 * Notifies draft subscribers always on value change; meta only when
 * empty/length change (every char length change re-notifies meta).
 */
export function setDraft(next: string | ((prev: string) => string)): void {
  const value = typeof next === "function" ? next(draft) : next;
  if (value === draft) return;
  draft = value;
  const prevMeta = meta;
  const nextMeta = computeMeta(value);
  meta = nextMeta;
  emit(listeners);
  if (
    prevMeta.empty !== nextMeta.empty ||
    prevMeta.length !== nextMeta.length
  ) {
    emit(metaListeners);
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeMeta(listener: Listener): () => void {
  metaListeners.add(listener);
  return () => {
    metaListeners.delete(listener);
  };
}

export const composerDraftStore = {
  getDraft,
  setDraft,
  subscribe,
  getSnapshot,
  getMetaSnapshot,
  subscribeMeta,
} as const;
