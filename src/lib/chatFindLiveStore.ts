/**
 * Live in-chat find snapshot.
 * The find bar publishes here so stream ticks do not setState the workbench.
 */

import type { ChatFindMatch } from "@/lib/chatFind";

export type ChatFindLiveActive = {
  messageId: string;
  occurrence: number;
};

export type ChatFindLiveSnapshot = {
  query: string;
  index: number;
  matchCount: number;
  hitIds: ReadonlySet<string>;
  active: ChatFindLiveActive | null;
};

const EMPTY_HITS: ReadonlySet<string> = new Set();

export const EMPTY_CHAT_FIND_LIVE: ChatFindLiveSnapshot = {
  query: "",
  index: 0,
  matchCount: 0,
  hitIds: EMPTY_HITS,
  active: null,
};

type Listener = () => void;

let snapshot: ChatFindLiveSnapshot = EMPTY_CHAT_FIND_LIVE;
const listeners = new Set<Listener>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function getChatFindLiveSnapshot(): ChatFindLiveSnapshot {
  return snapshot;
}

export function subscribeChatFindLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetChatFindLive(): void {
  if (snapshot === EMPTY_CHAT_FIND_LIVE) return;
  snapshot = EMPTY_CHAT_FIND_LIVE;
  emit();
}

export function publishChatFindLive(input: {
  query: string;
  index: number;
  matches: readonly ChatFindMatch[];
}): void {
  const next = buildChatFindLiveSnapshot(input, snapshot);
  if (next === snapshot) return;
  snapshot = next;
  emit();
}

export function buildChatFindLiveSnapshot(
  input: {
    query: string;
    index: number;
    matches: readonly ChatFindMatch[];
  },
  prev: ChatFindLiveSnapshot = EMPTY_CHAT_FIND_LIVE,
): ChatFindLiveSnapshot {
  const query = input.query;
  const matches = input.matches;
  const matchCount = matches.length;
  const clamped =
    matchCount === 0
      ? 0
      : input.index >= 0 && input.index < matchCount
        ? input.index
        : 0;

  const hitIds = hitIdsFromMatches(matches, prev.hitIds);
  const hit = matchCount > 0 ? matches[clamped]! : null;
  const active: ChatFindLiveActive | null = hit
    ? prev.active &&
      prev.active.messageId === hit.messageId &&
      prev.active.occurrence === hit.occurrence
      ? prev.active
      : { messageId: hit.messageId, occurrence: hit.occurrence }
    : null;

  if (
    prev.query === query &&
    prev.index === clamped &&
    prev.matchCount === matchCount &&
    prev.hitIds === hitIds &&
    prev.active === active
  ) {
    return prev;
  }

  return { query, index: clamped, matchCount, hitIds, active };
}

function hitIdsFromMatches(
  matches: readonly ChatFindMatch[],
  prev: ReadonlySet<string>,
): ReadonlySet<string> {
  if (matches.length === 0) return EMPTY_HITS;
  const next = new Set<string>();
  for (const m of matches) next.add(m.messageId);
  if (next.size === prev.size) {
    let same = true;
    for (const id of next) {
      if (!prev.has(id)) {
        same = false;
        break;
      }
    }
    if (same) return prev;
  }
  return next;
}

export function resetChatFindLiveForTests(): void {
  snapshot = EMPTY_CHAT_FIND_LIVE;
  listeners.clear();
}
