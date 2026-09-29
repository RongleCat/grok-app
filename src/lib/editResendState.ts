/**
 * Session shell + live host transitions for edit-and-resend.
 * Rewind failure marks ready only on the chat that was rewound, and undoes
 * the optimistic liveHost `streaming` flag this resend applied.
 */

import { truncateBeforeLastUser } from "@/lib/session/rewind";
import type {
  AgentError,
  ChatMessage,
  MessageAttachment,
  SessionState,
} from "@/lib/session/types";

type ShellSnap = {
  sessionId: string | null;
  state: SessionState;
  lastError: AgentError | null;
};

export function shellReadyAfterRewindFailure<T extends ShellSnap>(
  prev: T,
  targetSessionId: string | null,
): T {
  if (!targetSessionId || prev.sessionId !== targetSessionId) return prev;
  if (prev.state !== "streaming") return prev;
  return { ...prev, state: "ready" };
}

/** Put back the live host snapshot from before the optimistic streaming flag. */
export function restoreOptimisticLiveHost<T extends ShellSnap>(
  current: T,
  before: T,
  targetSessionId: string | null,
  tookOver: boolean,
): T {
  if (!tookOver) return current;
  if (targetSessionId) {
    if (current.sessionId !== targetSessionId) return current;
  } else if (current.sessionId) {
    return current;
  }
  if (current.state !== "streaming") return current;
  return before;
}

export function optimisticLiveHostForEditResend<T extends ShellSnap>(
  prev: T,
  sendTargetId: string | null,
): T {
  if (sendTargetId && prev.sessionId && prev.sessionId !== sendTargetId) {
    return prev;
  }
  return {
    ...prev,
    sessionId: sendTargetId ?? prev.sessionId,
    state: "streaming",
    lastError: null,
  };
}

export function shellAfterEditResendStart<T extends ShellSnap>(prev: T): T {
  if (prev.state === "streaming" || prev.state === "awaiting_permission") {
    return prev;
  }
  return { ...prev, state: "streaming", lastError: null };
}

export function messagesAfterEditResend(
  prev: ChatMessage[],
  opts: {
    userId: string;
    pendingAssistantId: string;
    content: string;
    attachments?: MessageAttachment[];
    createdAt: string;
  },
): ChatMessage[] {
  const kept = truncateBeforeLastUser(prev);
  return [
    ...kept,
    {
      id: opts.userId,
      role: "user",
      content: opts.content,
      attachments: opts.attachments?.length ? opts.attachments : undefined,
      createdAt: opts.createdAt,
    },
    {
      id: opts.pendingAssistantId,
      role: "assistant",
      content: "",
      streaming: true,
      createdAt: opts.createdAt,
    },
  ];
}
