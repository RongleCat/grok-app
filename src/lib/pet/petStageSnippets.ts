/**
 * Stage-reply snippets for pet bubbles.
 *
 * A chip is only shown once the agent emits assistant body text (not thinking,
 * not the session title). Each session keeps its own latest stage independently
 * so concurrent chats stack instead of overwriting each other.
 */

export const PET_SNIPPET_MAX = 96;
const STAGE_TEXT_CAP = 2_000;

export type PetStageStreamChunk = {
  sessionId?: string | null;
  text?: string | null;
  kind?: string | null;
  messageId?: string | null;
  done?: boolean;
};

export type PetStageRow = {
  text: string;
  snippet: string;
  updatedAt: number;
  messageId: string;
  turnKey: number;
};

/** Fold host stream payloads: full snapshots replace, deltas append. */
export function foldStageDelta(prev: string, incoming: string): string {
  if (!incoming) return prev;
  if (!prev) return incoming;
  if (incoming === prev) return prev;
  if (incoming.startsWith(prev)) return incoming;
  if (prev.startsWith(incoming) && incoming.length < prev.length) return prev;
  if (prev.endsWith(incoming)) return prev;
  return prev + incoming;
}

/** Latest paragraph, clipped — this is the chip headline. */
export function petStageSnippetFromText(full: string): string {
  const paras = full
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const last = paras[paras.length - 1] || full.replace(/\s+/g, " ").trim();
  if (!last) return "";
  if (last.length <= PET_SNIPPET_MAX) return last;
  return `${last.slice(0, PET_SNIPPET_MAX).trimEnd()}…`;
}

function capStageText(text: string): string {
  if (text.length <= STAGE_TEXT_CAP) return text;
  return text.slice(text.length - STAGE_TEXT_CAP);
}

export function applyPetStageStream(
  prev: PetStageRow | undefined,
  chunk: PetStageStreamChunk,
  turnKey = 0,
  now = Date.now(),
): PetStageRow | null {
  const sessionId = chunk.sessionId?.trim();
  if (!sessionId) return prev ?? null;
  if ((chunk.kind || "assistant") === "thought") return prev ?? null;
  const incoming = chunk.text ?? "";
  if (!incoming) return prev ?? null;

  const msgId = (chunk.messageId ?? "").trim();
  const newTurn = !!(prev && turnKey && prev.turnKey && turnKey > prev.turnKey);
  const newStage = !!(prev && !newTurn && msgId && prev.messageId && msgId !== prev.messageId);
  const base = newTurn || newStage || !prev ? "" : prev.text;
  const text = capStageText(foldStageDelta(base, incoming));
  const snippet = petStageSnippetFromText(text);
  if (!snippet) return prev ?? null;
  if (
    prev &&
    !newTurn &&
    !newStage &&
    prev.text === text &&
    prev.snippet === snippet
  ) {
    return prev;
  }
  return {
    text,
    snippet,
    updatedAt: now,
    messageId: msgId || prev?.messageId || "",
    turnKey: turnKey || prev?.turnKey || 0,
  };
}

type Listener = () => void;

class PetStageSnippetStore {
  private rows: Record<string, PetStageRow> = {};
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getMap(): Readonly<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [id, row] of Object.entries(this.rows)) {
      if (row.snippet) out[id] = row.snippet;
    }
    return out;
  }

  get(sessionId: string): string {
    return this.rows[sessionId]?.snippet ?? "";
  }

  updatedAt(sessionId: string): number {
    return this.rows[sessionId]?.updatedAt ?? 0;
  }

  applyStream(chunk: PetStageStreamChunk, turnKey = 0, now = Date.now()): boolean {
    const id = chunk.sessionId?.trim();
    if (!id) return false;
    const prev = this.rows[id];
    const next = applyPetStageStream(prev, chunk, turnKey, now);
    if (next === prev || next == null) return false;
    this.rows[id] = next;
    this.notify();
    return true;
  }

  /** Drop a snippet from a previous turn once a new live turn has started. */
  pruneStale(sessionId: string, startedAt: number | null | undefined): boolean {
    const id = sessionId.trim();
    if (!id) return false;
    const row = this.rows[id];
    if (!row) return false;
    if (!startedAt || !row.turnKey || startedAt <= row.turnKey) return false;
    delete this.rows[id];
    this.notify();
    return true;
  }

  clear(sessionId: string): void {
    if (!(sessionId in this.rows)) return;
    delete this.rows[sessionId];
    this.notify();
  }

  resetForTests(): void {
    this.rows = {};
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

export const petStageSnippetStore = new PetStageSnippetStore();
