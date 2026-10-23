/**
 * Per-session director toggle, one-shot composer intents, and the child-model
 * field. Does not write `~/.grok`. Persistence is `session_set_director_mode`
 * (session index only). An already-open chat is steered by wrapping the send.
 */
import { useSyncExternalStore } from "react";
import type { DirectorIntent } from "./directorMode";

type Listener = () => void;

type DirectorRow = {
  on: boolean;
  model: string;
  intent: DirectorIntent | null;
};

export type DirectorSendWrap = {
  directorOn: boolean;
  intent: DirectorIntent | null;
  childModel: string;
  inheritanceOn: boolean;
};

const rows = new Map<string, DirectorRow>();
let inheritanceOn = false;
let revision = 0;
const listeners = new Set<Listener>();

function publish(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

export function directorKey(sessionId: string | null | undefined): string {
  const id = (sessionId || "").trim();
  return id || "__draft__";
}

export function subscribeDirector(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDirectorRevision(): number {
  return revision;
}

export function useDirectorRevision(): number {
  return useSyncExternalStore(
    subscribeDirector,
    getDirectorRevision,
    getDirectorRevision,
  );
}

function rowOf(sessionId: string | null | undefined): DirectorRow {
  const key = directorKey(sessionId);
  return rows.get(key) ?? { on: false, model: "", intent: null };
}

export function readDirectorSendWrap(sessionId: string | null | undefined): DirectorSendWrap {
  const row = rowOf(sessionId);
  return {
    directorOn: row.on,
    intent: row.intent,
    childModel: row.model,
    inheritanceOn,
  };
}

export function directorOnFor(sessionId: string | null | undefined): boolean {
  return rowOf(sessionId).on;
}

export function directorModelFor(sessionId: string | null | undefined): string {
  return rowOf(sessionId).model;
}

export function directorIntentFor(sessionId: string | null | undefined): DirectorIntent | null {
  return rowOf(sessionId).intent;
}

export function directorInheritanceOn(): boolean {
  return inheritanceOn;
}

/** First sight of a session row. Later toggles win over a stale list refresh. */
export function hydrateDirectorOn(sessionId: string, on: boolean): void {
  const key = directorKey(sessionId);
  if (key === "__draft__" || rows.has(key)) return;
  rows.set(key, { on, model: "", intent: null });
  publish();
}

export function setDirectorOn(sessionId: string | null | undefined, on: boolean): void {
  const key = directorKey(sessionId);
  const prev = rows.get(key) ?? { on: false, model: "", intent: null };
  if (prev.on === on && rows.has(key)) return;
  rows.set(key, { ...prev, on });
  publish();
}

export function setDirectorModel(sessionId: string | null | undefined, model: string): void {
  const key = directorKey(sessionId);
  const prev = rows.get(key) ?? { on: false, model: "", intent: null };
  if (prev.model === model) return;
  rows.set(key, { ...prev, model });
  publish();
}

/** Arm the next send. Does not send by itself. */
export function armDirectorIntent(
  sessionId: string | null | undefined,
  intent: DirectorIntent,
): void {
  const key = directorKey(sessionId);
  const prev = rows.get(key) ?? { on: false, model: "", intent: null };
  rows.set(key, { ...prev, intent: prev.intent === intent ? null : intent });
  publish();
}

export function consumeDirectorIntent(sessionId: string | null | undefined): void {
  const key = directorKey(sessionId);
  const prev = rows.get(key);
  if (!prev?.intent) return;
  rows.set(key, { ...prev, intent: null });
  publish();
}

export function setDirectorInheritanceOn(on: boolean): void {
  if (inheritanceOn === on) return;
  inheritanceOn = on;
  publish();
}
