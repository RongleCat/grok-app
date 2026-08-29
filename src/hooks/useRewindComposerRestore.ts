import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Attachment } from "@/lib/attachments";
import type { ChatRef } from "@/lib/chatAttach";
import type { ComposerQuote } from "@/lib/composerQuotes";
import { saveComposerSessionDraft } from "@/lib/composerSessionDraft";
import {
  rewindComposerRestore,
  type ChatMessage,
  type RewindComposerRestore,
} from "@/lib/session";

type ComposerFocusEl = { focus?: (opts?: { preventScroll?: boolean }) => void };

/**
 * After rewind, put the discarded user prompt back in the composer.
 * Background rewind only writes that session's draft store.
 */
export function useRewindComposerRestore(opts: {
  viewingSessionIdRef: RefObject<string | null>;
  composerInputRef: RefObject<ComposerFocusEl | null>;
  messagesRef: RefObject<ChatMessage[]>;
  messagesBySessionRef: RefObject<Map<string, ChatMessage[]>>;
  setDraft: (text: string) => void;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setChatAttachments: Dispatch<SetStateAction<ChatRef[]>>;
  setQuotes: Dispatch<SetStateAction<ComposerQuote[]>>;
  setEditingUserMessageId: Dispatch<SetStateAction<string | null>>;
  setEditAttachments: Dispatch<SetStateAction<Attachment[]>>;
}): {
  captureRewindComposerRestore: (
    sessionId: string,
    keepPromptIndex: number | null,
  ) => RewindComposerRestore | null;
  applyRewindComposerRestore: (
    sessionId: string,
    restore: RewindComposerRestore | null,
  ) => void;
} {
  const {
    viewingSessionIdRef,
    composerInputRef,
    messagesRef,
    messagesBySessionRef,
    setDraft,
    setAttachments,
    setChatAttachments,
    setQuotes,
    setEditingUserMessageId,
    setEditAttachments,
  } = opts;

  const captureRewindComposerRestore = useCallback(
    (sessionId: string, keepPromptIndex: number | null) => {
      const prior =
        viewingSessionIdRef.current === sessionId
          ? messagesRef.current
          : (messagesBySessionRef.current.get(sessionId) ?? []);
      return rewindComposerRestore(prior, keepPromptIndex);
    },
    [messagesBySessionRef, messagesRef, viewingSessionIdRef],
  );

  const applyRewindComposerRestore = useCallback(
    (sessionId: string, restore: RewindComposerRestore | null) => {
      if (!restore) return;
      saveComposerSessionDraft(sessionId, {
        text: restore.text,
        attachments: restore.attachments,
      });
      if (viewingSessionIdRef.current !== sessionId) return;
      setDraft(restore.text);
      setAttachments(restore.attachments);
      setChatAttachments([]);
      setQuotes([]);
      setEditingUserMessageId(null);
      setEditAttachments([]);
      requestAnimationFrame(() => {
        composerInputRef.current?.focus?.({ preventScroll: true });
      });
    },
    [
      composerInputRef,
      setAttachments,
      setChatAttachments,
      setDraft,
      setEditAttachments,
      setEditingUserMessageId,
      setQuotes,
      viewingSessionIdRef,
    ],
  );

  return { captureRewindComposerRestore, applyRewindComposerRestore };
}
