import type { ChatMessage, MessageSegment, SessionState } from "./types";
import { isTurnPromptMessage } from "./types";
import { buildSegmentsFromLegacy } from "./segments";

export function truncateBeforeLastUser(messages: ChatMessage[]): ChatMessage[] {
  let cut = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isTurnPromptMessage(messages[i])) {
      cut = i;
      break;
    }
  }
  return messages.slice(0, cut);
}

/**
 * Id of the last non-streaming assistant message in the current (last user) turn.
 * Used to gate regenerate-last-reply UI.
 */
export function lastRegenerableAssistantId(
  messages: ChatMessage[],
): string | null {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isTurnPromptMessage(messages[i])) {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return null;

  let lastAssistantId: string | null = null;
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role === "assistant" && !m.streaming) {
      lastAssistantId = m.id;
    }
  }
  return lastAssistantId;
}

/** True when `assistantId` is the regenerable last assistant for the last user turn. */
export function canRegenerateAssistant(
  messages: ChatMessage[],
  assistantId: string,
): boolean {
  return lastRegenerableAssistantId(messages) === assistantId;
}

/** Number of user-role messages (0-based prompt index length). */
export function countUserPrompts(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => (isTurnPromptMessage(m) ? n + 1 : n), 0);
}

/**
 * 0-based user prompt index for a message id, or `-1` when not a user message.
 */
export function userPromptIndexOf(
  messages: ChatMessage[],
  messageId: string,
): number {
  let idx = 0;
  for (const m of messages) {
    if (!isTurnPromptMessage(m)) continue;
    if (m.id === messageId) return idx;
    idx += 1;
  }
  return -1;
}

/**
 * End index (exclusive) of the full turn for `userPromptIndex` (0-based).
 * A turn = that user message + following non-user rows until the next user.
 * Returns `-1` when the index is out of range.
 */
export function endIndexThroughUserPrompt(
  messages: ChatMessage[],
  userPromptIndex: number,
): number {
  let userI = 0;
  for (let i = 0; i < messages.length; i++) {
    if (!isTurnPromptMessage(messages[i])) continue;
    if (userI === userPromptIndex) {
      let j = i + 1;
      while (j < messages.length && !isTurnPromptMessage(messages[j])) j += 1;
      return j;
    }
    userI += 1;
  }
  return -1;
}

/**
 * Keep messages through the end of the turn for `userPromptIndex` (0-based).
 * Matches ACP `/rewind` semantics: discard everything **after** the selected turn.
 * Returns a copy; empty when index is out of range.
 */
export function truncateThroughUserPrompt(
  messages: ChatMessage[],
  userPromptIndex: number,
): ChatMessage[] {
  const end = endIndexThroughUserPrompt(messages, userPromptIndex);
  if (end < 0) return [];
  return messages.slice(0, end);
}

/** True when journal has rows after the selected user turn (something to drop). */
export function canRewindToUserPrompt(
  messages: ChatMessage[],
  userPromptIndex: number,
): boolean {
  const end = endIndexThroughUserPrompt(messages, userPromptIndex);
  return end >= 0 && end < messages.length;
}

export interface LocalRewindPoint {
  promptIndex: number;
  messageId: string;
  preview: string;
}

/** Build rewind points from the local journal (one per user prompt). */
export function localRewindPoints(
  messages: ChatMessage[],
  opts?: { previewMax?: number },
): LocalRewindPoint[] {
  const max = opts?.previewMax ?? 80;
  const out: LocalRewindPoint[] = [];
  let idx = 0;
  for (const m of messages) {
    if (!isTurnPromptMessage(m)) continue;
    const raw = (m.content || "").replace(/\s+/g, " ").trim();
    const preview =
      raw.length > max ? `${raw.slice(0, Math.max(1, max - 1))}…` : raw || "…";
    out.push({ promptIndex: idx, messageId: m.id, preview });
    idx += 1;
  }
  return out;
}

/**
 * Messages for a forked session: through optional user prompt (full turn), or full history.
 * Remaps ids by default so the fork is independent of the source journal.
 */
export function forkMessages(
  messages: ChatMessage[],
  options?: {
    throughUserPromptIndex?: number | null;
    remapIds?: boolean;
    idPrefix?: string;
  },
): ChatMessage[] {
  const through = options?.throughUserPromptIndex;
  const sliced =
    through == null || through === undefined
      ? messages.slice()
      : truncateThroughUserPrompt(messages, through);
  const remap = options?.remapIds !== false;
  if (!remap) {
    return sliced.map((m) => ({
      ...m,
      streaming: false,
      thoughtPhases: m.thoughtPhases ? [...m.thoughtPhases] : undefined,
      segments: m.segments ? m.segments.map((s) => ({ ...s })) : undefined,
      attachments: m.attachments
        ? m.attachments.map((a) => ({ ...a }))
        : undefined,
    }));
  }
  const prefix = options?.idPrefix ?? `fork-${Date.now().toString(36)}`;
  return sliced.map((m, i) => ({
    ...m,
    id: `${prefix}-${i}-${m.id}`,
    streaming: false,
    thoughtPhases: m.thoughtPhases ? [...m.thoughtPhases] : undefined,
    segments: m.segments ? m.segments.map((s) => ({ ...s })) : undefined,
    attachments: m.attachments
      ? m.attachments.map((a) => ({ ...a }))
      : undefined,
  }));
}

/** Default fork title from source title. */
export function forkSessionTitle(sourceTitle: string | undefined | null): string {
  const base = (sourceTitle || "").trim() || "chat";
  if (/^fork of\b/i.test(base)) return base;
  return `Fork of ${base}`;
}

/** Client-only ids from optimistic send UI (`u-171…`, `a-pending-…`, etc.). */
export function isClientOptimisticId(id: string): boolean {
  return (
    /^u-\d+$/.test(id) ||
    id.startsWith("a-pending-") ||
    /^a-\d+$/.test(id) ||
    /^t-\d+$/.test(id)
  );
}

/** Drop client optimistic shells (keep host UUIDs and tool-* journal rows). */
export function stripClientOptimistic(
  messages: ChatMessage[],
): ChatMessage[] {
  return messages.filter((m) => !isClientOptimisticId(m.id));
}

/**
 * Remove optimistic user/pending-assistant rows that host journal already
 * replaced under a different id (same body). Fixes: switch away after a turn
 * completes → switch back → first user bubble duplicated at the end.
 *
 * Optimistic users are **replaced in place** by the host row (not dropped then
 * left at the tail), so order stays U → A → … instead of A → … → U.
 */
export function reconcileOptimisticDuplicates(
  messages: ChatMessage[],
): ChatMessage[] {
  const realUsersByContent = new Map<string, ChatMessage>();
  for (const m of messages) {
    if (m.role === "user" && !isClientOptimisticId(m.id)) {
      const key = m.content.trim();
      if (key && !realUsersByContent.has(key)) {
        realUsersByContent.set(key, m);
      }
    }
  }
  const hasHostAssistant = messages.some(
    (m) =>
      m.role === "assistant" &&
      !isClientOptimisticId(m.id) &&
      !m.id.startsWith("a-pending-"),
  );
  const placedRealUserIds = new Set<string>();
  const out: ChatMessage[] = [];

  for (const m of messages) {
    if (m.role === "user" && isClientOptimisticId(m.id)) {
      const real = realUsersByContent.get(m.content.trim());
      if (real) {
        if (!placedRealUserIds.has(real.id)) {
          out.push(real);
          placedRealUserIds.add(real.id);
        }
        continue;
      }
      out.push(m);
      continue;
    }
    if (m.role === "user" && !isClientOptimisticId(m.id)) {
      if (placedRealUserIds.has(m.id)) continue;
      out.push(m);
      placedRealUserIds.add(m.id);
      continue;
    }
    if (m.id.startsWith("a-pending-")) {
      if (!m.streaming) continue;
      if (hasHostAssistant) continue;
      out.push(m);
      continue;
    }
    out.push(m);
  }
  return out;
}

/**
 * Snapshot the thread being navigated away from.
 *
 * Never replaces a populated cache with an empty view: the workbench can be
 * mid-clear (or was never painted, because the send belonged to a chat the user
 * had already left) while the cache still holds that turn's real bubbles.
 * Clobbering it there is how a user prompt went missing from the cache and had
 * to be recovered from disk on the next open.
 */
export function snapshotOutgoingMessages(
  cached: ChatMessage[] | undefined,
  viewed: ChatMessage[],
): ChatMessage[] {
  if (viewed.length) return viewed;
  return cached?.length ? cached : viewed;
}

/**
 * When reopening a session, prefer the in-memory cache over disk if the cache
 * is ahead (optimistic user bubble, partial stream). If disk has messages the
 * cache lacks (e.g. Remote IM appends), merge by id so IM turns are never lost.
 *
 * After a turn completes (nothing streaming), disk is the base of truth and
 * client optimistic ids must not reappear as trailing duplicates.
 */
export function preferSessionMessages(
  cached: ChatMessage[] | undefined,
  stored: ChatMessage[],
): ChatMessage[] {
  if (!cached?.length) return stored;
  if (!stored.length) return cached;

  if (cached.some((m) => m.streaming)) {
    // Keep streaming cache; fold disk-only rows (Remote IM); drop optimistic
    // duplicates already persisted under host UUIDs.
    return reconcileOptimisticDuplicates(
      mergeSessionMessagesById(cached, stored),
    );
  }

  // Completed: prefer cache when it has live-interleaved tool segments that
  // disk cannot represent yet; otherwise disk is authoritative.
  const cacheHasLiveToolSegs = cached.some(
    (m) =>
      m.role === "assistant" &&
      m.segments?.some((s) => s.kind === "tool"),
  );
  const storedHasLiveToolSegs = stored.some(
    (m) =>
      m.role === "assistant" &&
      m.segments?.some((s) => s.kind === "tool"),
  );

  if (cacheHasLiveToolSegs && !storedHasLiveToolSegs) {
    return reconcileOptimisticDuplicates(
      mergeSessionMessagesById(cached, stored),
    );
  }

  // Disk base + non-optimistic cache-only extras (never reattach u-${ts}).
  return reconcileOptimisticDuplicates(
    mergeSessionMessagesById(stored, stripClientOptimistic(cached)),
  );
}

/**
 * Last non-error assistant after the last user prompt (current turn body).
 */
function lastTurnAssistantIndex(messages: ChatMessage[]): number {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user" && m.marker !== "interjection") {
      lastUser = i;
      break;
    }
  }
  for (let i = messages.length - 1; i > lastUser; i--) {
    const m = messages[i]!;
    if (m.role === "assistant" && !m.isError) return i;
  }
  return -1;
}

/** User prompts that start a turn (skip mid-turn 引导). */
function promptUserCount(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (m.role === "user" && m.marker !== "interjection") n += 1;
  }
  return n;
}

/**
 * Cross-id last-turn lift is only valid when journal has caught up to the
 * UI's last user prompt. Queue flush paints the next `u-*` + empty
 * `a-pending-*` while turn-1 rehydrate retries (400/900ms) still hold the
 * previous journal; copying that longer body onto the pending bubble then
 * makes turn-2 tokens look like a replay.
 */
export function canLiftJournalLastTurn(
  ui: ChatMessage[],
  journal: ChatMessage[],
): boolean {
  return promptUserCount(ui) <= promptUserCount(journal);
}

/**
 * After a turn ends, lift any longer body/thought/attachments from the journal
 * into the live UI list (same id, or last-turn id-mismatch heal).
 *
 * Host stream coalesce can leave the bubble short of the journal when the last
 * IPC batch is dropped on force-end — reopening already recovered via disk;
 * this heals the open chat without a full remount.
 *
 * Cross-id heal: mid-turn reconcile can mint a new assistant UUID while the
 * live bubble still uses the stream id. Match the last turn's richest journal
 * body onto the UI's last assistant when it is strictly longer.
 * Skip when the UI already has a newer user prompt than disk (queued
 * follow-up painted during turn-1 rehydrate retries).
 */
export function upgradeMessagesFromJournal(
  ui: ChatMessage[],
  journal: ChatMessage[],
): ChatMessage[] {
  if (!ui.length || !journal.length) return ui;
  const jById = new Map(journal.map((m) => [m.id, m] as const));
  let changed = false;
  const next = ui.map((m) => {
    const j = jById.get(m.id);
    if (!j) return m;

    const uiContent = m.content ?? "";
    const jContent = j.content ?? "";
    const uiThought = m.thought ?? "";
    const jThought = j.thought ?? "";
    const richerContent = jContent.length > uiContent.length;
    const richerThought = jThought.length > uiThought.length;
    const richerAtts =
      (j.attachments?.length ?? 0) > (m.attachments?.length ?? 0);
    if (!richerContent && !richerThought && !richerAtts) return m;

    changed = true;
    let out: ChatMessage = {
      ...m,
      content: richerContent ? jContent : uiContent,
      thought: richerThought ? jThought : m.thought,
      thoughtPhases: richerThought
        ? (j.thoughtPhases ?? m.thoughtPhases)
        : m.thoughtPhases,
      attachments: richerAtts ? j.attachments : m.attachments,
      // Mid-turn switch-back reconcile must not freeze a still-running
      // bubble (that stopped the thinking timer while the agent kept going).
      // Turn-end callers clear streaming on `ui` *before* this merge.
      streaming: !!m.streaming,
    };

    const hasLiveTools = out.segments?.some((s) => s.kind === "tool");
    if (!hasLiveTools) {
      out = {
        ...out,
        segments: buildSegmentsFromLegacy(
          out.content,
          out.thought,
          out.thoughtPhases,
        ),
      };
    } else if (richerContent) {
      const segs = (out.segments ?? []).map((s) =>
        s.kind === "content" || s.kind === "thought" || s.kind === "tool"
          ? { ...s }
          : s,
      ) as MessageSegment[];
      let found = false;
      for (let i = segs.length - 1; i >= 0; i--) {
        if (segs[i]!.kind === "content") {
          segs[i] = { kind: "content", text: jContent };
          found = true;
          break;
        }
      }
      if (!found && jContent) {
        segs.push({ kind: "content", text: jContent });
      }
      out = { ...out, segments: segs };
    }
    return out;
  });

  // Last-turn cross-id heal (after per-id pass). Skip when the UI already
  // has a newer user prompt than disk — that's the queued follow-up, not
  // an id mismatch on the turn that just finished.
  const uiAsstIdx = lastTurnAssistantIndex(next);
  const jAsstIdx = lastTurnAssistantIndex(journal);
  if (
    uiAsstIdx >= 0 &&
    jAsstIdx >= 0 &&
    canLiftJournalLastTurn(next, journal)
  ) {
    const uiAsst = next[uiAsstIdx]!;
    const jAsst = journal[jAsstIdx]!;
    // Prefer the richest journal assistant in the same turn (not only the
    // last row — mid-status reconcile can trail a full stream row).
    let bestJ = jAsst;
    {
      let lastUser = -1;
      for (let i = journal.length - 1; i >= 0; i--) {
        const m = journal[i];
        if (m?.role === "user" && m.marker !== "interjection") {
          lastUser = i;
          break;
        }
      }
      for (let i = lastUser + 1; i < journal.length; i++) {
        const m = journal[i]!;
        if (m.role !== "assistant" || m.isError) continue;
        if ((m.content ?? "").length > (bestJ.content ?? "").length) {
          bestJ = m;
        }
      }
    }
    const uiContent = uiAsst.content ?? "";
    const jContent = bestJ.content ?? "";
    if (jContent.length > uiContent.length) {
      changed = true;
      let out: ChatMessage = {
        ...uiAsst,
        content: jContent,
        thought:
          (bestJ.thought ?? "").length > (uiAsst.thought ?? "").length
            ? bestJ.thought
            : uiAsst.thought,
        leadFragments: bestJ.leadFragments ?? uiAsst.leadFragments,
        streaming: !!uiAsst.streaming,
      };
      const hasLiveTools = out.segments?.some((s) => s.kind === "tool");
      if (!hasLiveTools) {
        out = {
          ...out,
          segments: buildSegmentsFromLegacy(
            out.content,
            out.thought,
            out.thoughtPhases,
          ),
        };
      } else {
        const segs = (out.segments ?? []).map((s) =>
          s.kind === "content" || s.kind === "thought" || s.kind === "tool"
            ? { ...s }
            : s,
        ) as MessageSegment[];
        let found = false;
        for (let i = segs.length - 1; i >= 0; i--) {
          if (segs[i]!.kind === "content") {
            segs[i] = { kind: "content", text: jContent };
            found = true;
            break;
          }
        }
        if (!found && jContent) {
          segs.push({ kind: "content", text: jContent });
        }
        out = { ...out, segments: segs };
      }
      next[uiAsstIdx] = out;
    }
  }

  return changed ? next : ui;
}

/**
 * Host `ready` for the turn that just finished. Freeze leftover streaming on
 * older rows, but keep an *empty* optimistic queued pending (`a-pending-*` /
 * `t-*`) after the last user when a follow-up is already on screen — auto-flush
 * may have painted that shell, and a stale ready must not settle it.
 *
 * A filled pending (journal already lifted the body) is frozen so a later
 * replay chunk cannot append. A solo current-turn pending is frozen the same
 * as a host-id bubble.
 */
export function settleStreamingOnHostReady(
  messages: ChatMessage[],
): ChatMessage[] {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user" && m.marker !== "interjection") {
      lastUser = i;
      break;
    }
  }
  const queuedFollowUp = promptUserCount(messages) >= 2;
  let changed = false;
  const next = messages.map((m, i) => {
    if (m.role !== "assistant" || !m.streaming) return m;
    if (
      queuedFollowUp &&
      i > lastUser &&
      (m.id.startsWith("a-pending-") || m.id.startsWith("t-")) &&
      !(m.content ?? "").trim()
    ) {
      return m;
    }
    changed = true;
    return { ...m, streaming: false };
  });
  return changed ? next : messages;
}

/**
 * Switch-back / journal-heal safety net: if Host still has a live turn but
 * disk rows never carry `streaming`, mark the current-turn assistant live
 * so thinking chrome and stream attach keep ticking.
 *
 * No-op when the session is idle/ready, an assistant is already streaming,
 * or the turn has no assistant yet (quiet thinking covers that).
 */
export function ensureBusyTurnStreaming(
  messages: ChatMessage[],
  sessionState: SessionState | string | null | undefined,
): ChatMessage[] {
  if (sessionState !== "streaming" && sessionState !== "awaiting_permission") {
    return messages;
  }
  if (messages.some((m) => m.role === "assistant" && m.streaming)) {
    return messages;
  }
  const idx = lastTurnAssistantIndex(messages);
  if (idx < 0) return messages;
  const row = messages[idx]!;
  if (row.isError) return messages;
  const next = messages.slice();
  next[idx] = { ...row, streaming: true };
  return next;
}

/**
 * Union of two message lists by `id`. First list wins on conflict; extras from
 * second are appended. Order: **primary array order** (journal order), then
 * second-only rows in their order.
 *
 * Do **not** re-sort by `createdAt`: Host journal often finalizes the assistant
 * row with a later timestamp than tool_step rows (tools ran mid-turn). Sorting
 * by createdAt turns `U → A → tools` into `U → tools → A` and breaks the
 * transcript timeline on reload.
 */
export function mergeSessionMessagesById(
  primary: ChatMessage[],
  secondary: ChatMessage[],
): ChatMessage[] {
  const primaryIds = new Set(primary.map((m) => m.id));

  // Secondary-only rows are placed **before the next row both lists share**,
  // not appended at the tail. Appending reordered the thread whenever the
  // cache was missing an early row: a mid-turn switch could leave the cache
  // holding only the streaming assistant, and the journal's user prompt — the
  // first thing in the turn — then rendered *after* the whole answer.
  const beforeAnchor = new Map<string, ChatMessage[]>();
  const tail: ChatMessage[] = [];
  const takenIds = new Set<string>();
  let bucket: ChatMessage[] = [];
  for (const m of secondary) {
    if (!m.id) continue;
    if (primaryIds.has(m.id)) {
      if (bucket.length) {
        beforeAnchor.set(m.id, [...(beforeAnchor.get(m.id) ?? []), ...bucket]);
        bucket = [];
      }
      continue;
    }
    if (takenIds.has(m.id)) continue;
    takenIds.add(m.id);
    bucket.push(m);
  }
  tail.push(...bucket);

  // Primary is copied verbatim — including repeated ids, which journal
  // `tool_step` rows legitimately have.
  const out: ChatMessage[] = [];
  const anchored = new Set<string>();
  for (const m of primary) {
    const extras = beforeAnchor.get(m.id);
    if (extras && !anchored.has(m.id)) {
      anchored.add(m.id);
      out.push(...extras);
    }
    out.push(m);
  }
  out.push(...tail);
  return out;
}
