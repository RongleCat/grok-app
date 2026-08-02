/**
 * React bindings for the external composer draft store.
 *
 * - useComposerDraft / useComposerDraftMeta: subscribe (islands only)
 * - useComposerDraftActions: stable setDraft/getDraft (safe at App top level)
 */

import { useSyncExternalStore } from "react";
import {
  getDraft,
  getMetaSnapshot,
  getSnapshot,
  setDraft,
  subscribe,
  subscribeMeta,
  type ComposerDraftMeta,
} from "@/lib/composerDraftStore";

/** Full draft text; re-renders the consumer on every change. Island only. */
export function useComposerDraft(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** empty + length; re-renders when those change. Island only. */
export function useComposerDraftMeta(): ComposerDraftMeta {
  return useSyncExternalStore(subscribeMeta, getMetaSnapshot, getMetaSnapshot);
}

const ACTIONS = {
  setDraft,
  getDraft,
} as const;

/** Stable actions — does not subscribe; safe to call at App top level. */
export function useComposerDraftActions(): {
  setDraft: typeof setDraft;
  getDraft: typeof getDraft;
} {
  return ACTIONS;
}
