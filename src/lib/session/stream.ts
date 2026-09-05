import { isDisplayableAttachmentPath } from "../attachments";
import type {
  ChatMessage,
  MessageAttachment,
  MessageSegment,
  StreamPayload,
} from "./types";
import { isTurnPromptMessage } from "./types";
import { stripUserAttachmentRefs } from "./rewind";
import {
  appendContentToSegments,
  appendThoughtToSegments,
  compactMessageSegments,
  deriveFieldsFromSegments,
  ensureSegments,
} from "./segments";
import { syncTurnToolsIntoAssistant } from "./tools";

export interface GeneratedImagePayload {
  sessionId?: string;
  messageId?: string;
  path: string;
  name?: string;
}

/**
 * Attach an image_gen / image_edit result to the current assistant bubble.
 * Prefer streaming assistant; fall back to last assistant; create one if needed.
 */
export function applyGeneratedImage(
  messages: ChatMessage[],
  payload: GeneratedImagePayload,
): ChatMessage[] {
  const path = (payload.path || "").trim();
  if (!path) return messages;
  // Reject false extracts (`/img_001.png`) and site-root CMS paths — they
  // become dead paperclip cards that cannot open or preview.
  if (!isDisplayableAttachmentPath(path)) return messages;
  const name =
    (payload.name || "").trim() ||
    path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ||
    path;
  const att: MessageAttachment = { path, name, isDir: false };

  let idx = payload.messageId
    ? messages.findIndex((m) => m.id === payload.messageId)
    : -1;
  if (idx < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === "assistant" && m.streaming) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "assistant") {
        idx = i;
        break;
      }
    }
  }

  if (idx < 0) {
    return [
      ...messages,
      {
        id: payload.messageId || `a-img-${Date.now()}`,
        role: "assistant",
        content: "",
        streaming: true,
        attachments: [att],
      },
    ];
  }

  const prev = messages[idx]!;
  const existing = prev.attachments ?? [];
  if (existing.some((a) => a.path === path)) return messages;
  const next = messages.slice();
  next[idx] = {
    ...prev,
    attachments: [...existing, att],
  };
  return next;
}

/**
 * Index of the last user message — stream chunks only bind to the current turn
 * (after this index). Prevents a late/orphan chunk from appending onto an older
 * assistant and looking like "history re-appeared after the new question".
 */
export function lastUserMessageIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isTurnPromptMessage(messages[i])) return i;
  }
  return -1;
}

/**
 * Last painted user row, including mid-turn steer / interjection.
 *
 * Turn-prompt helpers skip interjections so edit/rewind still treat the
 * original question as the turn start. Stream binding must not: after 引导
 * the pre-steer assistant is frozen, and leftover Host chunks on that id
 * would revive it (Worked-for rail swaps collapsed ↔ full tool list).
 */
export function lastUserRowIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

/**
 * Drop stuck streaming flags on assistants from previous turns (before last user).
 * Call when starting a new send so the next stream never binds to old bubbles.
 */
export function clearPriorTurnStreaming(messages: ChatMessage[]): ChatMessage[] {
  const lastUser = lastUserMessageIndex(messages);
  let changed = false;
  const next = messages.map((m, i) => {
    if (m.role !== "assistant" || !m.streaming) return m;
    // Keep streaming only on the active turn (after last user).
    if (i > lastUser) return m;
    changed = true;
    return { ...m, streaming: false };
  });
  return changed ? next : messages;
}

/**
 * Remove empty optimistic assistant placeholders left behind when a real stream
 * message was created separately (id mismatch). Keeps at most one streaming
 * assistant after the last user message.
 */
export function dedupeCurrentTurnAssistants(
  messages: ChatMessage[],
): ChatMessage[] {
  const lastUser = lastUserMessageIndex(messages);
  if (lastUser < 0) return messages;
  const turn = messages.slice(lastUser + 1);
  const assistants = turn
    .map((m, i) => ({ m, i: lastUser + 1 + i }))
    .filter(({ m }) => m.role === "assistant" && !m.isError);
  if (assistants.length <= 1) return messages;

  // Prefer the one with content/thought or host uuid; drop empty pending shells.
  const keep = [...assistants].sort((a, b) => {
    const score = (x: ChatMessage) =>
      (x.content?.trim() ? 4 : 0) +
      (x.thought?.trim() ? 2 : 0) +
      (x.streaming ? 1 : 0) +
      (!x.id.startsWith("a-pending-") && !x.id.startsWith("t-") ? 1 : 0);
    return score(b.m) - score(a.m);
  })[0]!;

  const dropIds = new Set(
    assistants.filter((a) => a.i !== keep.i).map((a) => a.m.id),
  );
  // Only drop empties that look like optimistic leftovers
  const dropEmpty = new Set(
    assistants
      .filter(
        (a) =>
          a.i !== keep.i &&
          !a.m.content?.trim() &&
          !a.m.thought?.trim() &&
          (a.m.id.startsWith("a-pending-") || a.m.id.startsWith("t-")),
      )
      .map((a) => a.m.id),
  );
  if (!dropEmpty.size) return messages;
  return messages.filter((m) => !dropEmpty.has(m.id) || dropIds.size === 0);
}

/**
 * Apply a Host-authored user turn (mirror / other window / API send).
 *
 * Local composers already paint an optimistic `u-…` bubble; when the Host
 * UUID arrives, reconcile that row instead of duplicating. Mirror clients
 * that never ran local optimistic UI get the user row + a live assistant shell.
 */
export function applyRemoteUserMessage(
  messages: ChatMessage[],
  user: ChatMessage,
  streamMessageId?: string | null,
): ChatMessage[] {
  if (!user?.id || user.role !== "user") return messages;
  if (messages.some((m) => m.id === user.id)) {
    return ensureLiveAssistantAfterUser(messages, user.id, streamMessageId);
  }

  const userText = (user.content || "").trim();
  let optimisticIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user" || m.marker === "interjection") continue;
    const id = m.id || "";
    // Optimistic composer ids: `u-<ts>` / `u-auto-…` (see isClientOptimisticId).
    if (
      userText &&
      (m.content || "").trim() === userText &&
      (/^u-\d+$/.test(id) || id.startsWith("u-auto-"))
    ) {
      optimisticIdx = i;
    }
    break;
  }

  let next: ChatMessage[];
  if (optimisticIdx >= 0) {
    next = messages.map((m, i) =>
      i === optimisticIdx
        ? {
            ...user,
            attachments: user.attachments?.length
              ? user.attachments
              : m.attachments,
          }
        : m,
    );
  } else {
    next = [...messages, { ...user, role: "user" }];
  }
  return ensureLiveAssistantAfterUser(next, user.id, streamMessageId);
}

function ensureLiveAssistantAfterUser(
  messages: ChatMessage[],
  userId: string,
  streamMessageId?: string | null,
): ChatMessage[] {
  const userIdx = messages.findIndex((m) => m.id === userId);
  if (userIdx < 0) return messages;
  const after = messages.slice(userIdx + 1);
  const hasLive = after.some((m) => m.role === "assistant" && m.streaming);
  if (hasLive) return messages;
  const postId =
    (typeof streamMessageId === "string" && streamMessageId.trim()) ||
    `a-pending-${userId}`;
  if (messages.some((m) => m.id === postId)) return messages;
  return [
    ...messages,
    {
      id: postId,
      role: "assistant",
      content: "",
      streaming: true,
    },
  ];
}

/**
 * Insert a mid-turn user interjection and freeze the assistant segment above it.
 * Post-interjection stream chunks carry a fresh host message id and append a new row.
 *
 * Always leaves a **live streaming** assistant after the interjection so the
 * thinking timer / “in progress” chrome keep updating while the agent pivots
 * (otherwise the UI freezes between steer ACK and the next token).
 *
 * @param postStreamMessageId Host’s new stream segment id when known (from
 *   `session://interjection`); otherwise a client `a-pending-steer-…` shell.
 */
export function applyInterjection(
  messages: ChatMessage[],
  interjection: ChatMessage,
  postStreamMessageId?: string | null,
): ChatMessage[] {
  interjection = stripUserAttachmentRefs(interjection);
  const existingIndex = messages.findIndex(
    (message) => message.id === interjection.id,
  );
  const boundaryIndex = existingIndex < 0 ? messages.length : existingIndex;
  const frozenBefore = messages
    .slice(0, boundaryIndex)
    .filter((message) => {
      if (
        message.role !== "assistant" ||
        !message.streaming ||
        !message.id.startsWith("a-pending-")
      ) {
        return true;
      }
      const hasVisibleContent =
        !!message.content.trim() ||
        !!message.thought?.trim() ||
        !!message.segments?.some(
          (segment) => "text" in segment && !!segment.text?.trim(),
        ) ||
        !!message.attachments?.length;
      return hasVisibleContent;
    })
    .map((message) =>
      message.role === "assistant" && message.streaming
        ? { ...message, streaming: false }
        : message,
    );

  const base: ChatMessage[] =
    existingIndex < 0
      ? [...frozenBefore, interjection]
      : [
          ...frozenBefore,
          interjection,
          ...messages.slice(existingIndex + 1),
        ];

  // Drop any leftover streaming assistants *after* the interjection that are
  // still the pre-split segment (should already be frozen above). Then seed a
  // fresh live row for post-steer output.
  const afterIdx = base.findIndex((m) => m.id === interjection.id);
  const head = afterIdx >= 0 ? base.slice(0, afterIdx + 1) : base;
  const tail = afterIdx >= 0 ? base.slice(afterIdx + 1) : [];
  // Keep non-streaming / tool rows after interjection; freeze any still-streaming.
  const frozenTail = tail.map((message) =>
    message.role === "assistant" && message.streaming
      ? { ...message, streaming: false }
      : message,
  );

  const postId =
    (typeof postStreamMessageId === "string" &&
      postStreamMessageId.trim()) ||
    `a-pending-steer-${interjection.id}`;
  // If host id already present as a streaming row, keep it; else append shell.
  const hasPostLive = frozenTail.some(
    (m) =>
      m.role === "assistant" &&
      m.streaming &&
      (m.id === postId || m.id.startsWith("a-pending-steer-")),
  );
  if (hasPostLive) {
    return [...head, ...frozenTail];
  }
  // Prefer replacing an empty frozen trailing assistant with a live shell at postId.
  return [
    ...head,
    ...frozenTail,
    {
      id: postId,
      role: "assistant",
      content: "",
      streaming: true,
    },
  ];
}

/** Visible body on an assistant row (text / thought / segments / media). */
function assistantHasVisibleBody(m: ChatMessage): boolean {
  if (m.content?.trim()) return true;
  if (m.thought?.trim()) return true;
  if (m.attachments?.length) return true;
  if (
    m.segments?.some((s) => {
      if (s.kind === "content" || s.kind === "thought") {
        return !!(s as { text?: string }).text?.trim();
      }
      return s.kind === "tool";
    })
  ) {
    return true;
  }
  return false;
}

export function applyStreamChunk(
  messages: ChatMessage[],
  chunk: StreamPayload,
): ChatMessage[] {
  // done-only with empty text: settle finished segments — but never kill an
  // *empty* post-steer shell. Mid-turn interject freezes the prior stream and
  // seeds a live row; a blanket done would clear that row → blank gap until
  // the next thought/body tokens paint (user saw empty then “Thought for Ns”).
  if (chunk.done && !chunk.text) {
    return messages.map((m) => {
      if (m.role !== "assistant" || !m.streaming) return m;
      // Scoped done: only the named segment (keep other live shells).
      if (chunk.messageId && m.id !== chunk.messageId) return m;
      // Empty live shell stays streaming so thinking chrome keeps ticking.
      if (!assistantHasVisibleBody(m)) return m;
      return { ...m, streaming: false };
    });
  }

  if (chunk.kind === "thought") {
    if (!chunk.text) return messages;
    const idx = findCurrentTurnAssistantForStream(messages, chunk.messageId);
    const phaseHint = chunk.thoughtPhase || "open";
    const appendThought = (prev: ChatMessage): ChatMessage => {
      const segs = compactMessageSegments(
        appendThoughtToSegments(
          ensureSegments(prev),
          chunk.text,
          phaseHint,
        ),
      );
      const derived = deriveFieldsFromSegments(segs);
      return {
        ...prev,
        id: adoptHostStreamMessageId(messages, prev, chunk.messageId),
        ...derived,
        segments: segs,
        // Late coalesced thought after Host settled must not re-open 思考中
        // over an answer that is already on the row.
        streaming: keepThoughtStreaming(prev),
      };
    };
    if (idx != null) {
      const next = messages.slice();
      next[idx] = appendThought(next[idx]!);
      return syncTurnToolsIntoAssistant(next, idx);
    }
    const segs: MessageSegment[] = [{ kind: "thought", text: chunk.text }];
    const withAsst: ChatMessage[] = [
      ...messages,
      {
        id: chunk.messageId || `t-${Date.now()}`,
        role: "assistant",
        content: "",
        thought: chunk.text,
        thoughtPhases: [chunk.text],
        segments: segs,
        streaming: true,
      },
    ];
    return syncTurnToolsIntoAssistant(withAsst, withAsst.length - 1);
  }

  // assistant (default)
  if (!chunk.text && !chunk.done) return messages;

  let idx = chunk.messageId
    ? messages.findIndex((m) => m.id === chunk.messageId)
    : -1;
  // Host id may not match optimistic pending — bind only within current turn.
  if (idx < 0) {
    const fallback = findCurrentTurnAssistantForStream(messages, undefined);
    idx = fallback ?? -1;
  } else {
    // Refuse to append onto an assistant from a previous turn (stale id reuse)
    // or a frozen pre-steer bubble (interjection sits after it).
    const bindFloor = lastUserRowIndex(messages);
    if (idx <= bindFloor) {
      const fallback = findCurrentTurnAssistantForStream(messages, undefined);
      idx = fallback ?? -1;
    }
  }

  if (idx < 0) {
    if (!chunk.text) return messages;
    const segs: MessageSegment[] = [{ kind: "content", text: chunk.text }];
    const withAsst: ChatMessage[] = [
      ...messages,
      {
        id: chunk.messageId || `a-${Date.now()}`,
        role: "assistant",
        content: chunk.text,
        segments: segs,
        streaming: !chunk.done,
      },
    ];
    return syncTurnToolsIntoAssistant(withAsst, withAsst.length - 1);
  }

  const next = messages.slice();
  const prev = next[idx]!;
  const segs = compactMessageSegments(
    appendContentToSegments(ensureSegments(prev), chunk.text || ""),
  );
  const derived = deriveFieldsFromSegments(segs);
  next[idx] = {
    ...prev,
    // Prefer host messageId so journal reload dedupes cleanly — but never
    // steal a frozen pre-steer row's id (that remounts two bubbles as one).
    id: adoptHostStreamMessageId(messages, prev, chunk.messageId),
    ...derived,
    segments: segs,
    streaming: !chunk.done,
  };
  return syncTurnToolsIntoAssistant(next, idx);
}

/**
 * Adopt Host's stream message id onto an optimistic pending/temp row.
 * Skip when that id already belongs to another row (frozen pre-steer).
 */
function adoptHostStreamMessageId(
  messages: ChatMessage[],
  prev: ChatMessage,
  hostId: string | undefined,
): string {
  const nextId = (hostId || "").trim();
  if (!nextId) return prev.id;
  const pending =
    !prev.id ||
    prev.id.startsWith("a-pending-") ||
    prev.id.startsWith("t-");
  if (!pending) return prev.id || nextId;
  if (messages.some((m) => m.id === nextId && m.id !== prev.id)) {
    return prev.id;
  }
  return nextId;
}

/**
 * Find the streaming assistant for the *current* paint segment only
 * (after the last user row, including mid-turn 引导).
 */
function findCurrentTurnStreamingAssistant(
  messages: ChatMessage[],
  messageId: string | undefined,
): number | undefined {
  const bindFloor = lastUserRowIndex(messages);
  if (messageId) {
    const byId = messages.findIndex((m) => m.id === messageId);
    // Named id is only valid after the last user/steer row. A pre-steer
    // match would revive the frozen bubble (chat flicker).
    if (byId > bindFloor) return byId;
  }
  for (let i = messages.length - 1; i > bindFloor; i--) {
    const m = messages[i]!;
    if (m.role === "assistant" && m.streaming) return i;
  }
  // No current-segment streaming bubble — do NOT fall back to older turns.
  return undefined;
}

/**
 * Bind late thought/body tokens to this turn's assistant even after Host
 * settled the row (streaming=false). Creating a second bubble left the
 * thought-only row on screen until remount.
 */
function findCurrentTurnAssistantForStream(
  messages: ChatMessage[],
  messageId: string | undefined,
): number | undefined {
  const live = findCurrentTurnStreamingAssistant(messages, messageId);
  if (live != null) return live;
  const bindFloor = lastUserRowIndex(messages);
  for (let i = messages.length - 1; i > bindFloor; i--) {
    const m = messages[i]!;
    if (m.role === "assistant" && !m.isError) return i;
  }
  return undefined;
}

/** Late thought after settle must not flip a finished answer back to 思考中. */
function keepThoughtStreaming(prev: ChatMessage): boolean {
  return !!prev.streaming;
}
