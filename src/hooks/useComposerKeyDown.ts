import {
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ComposerAtFileEntry } from "@/components/ComposerAtPanel";
import type { ComposerPlusEntry } from "@/components/ComposerPlusPanel";
import {
  collectUserPromptHistory,
  promptHistoryListNavFromKey,
  shouldHandlePromptHistoryKey,
  stepPromptHistory,
  stepPromptHistoryListIndex,
  type PromptHistoryEntry,
  type PromptHistoryScope,
} from "@/lib/composerPromptHistory";
import { composerHasSendPayload } from "@/lib/composerQuotes";
import {
  composerSteerLive,
  resolveComposerSubmitAction,
  type ComposerSendKeyPref,
} from "@/lib/composerSendKey";
import { isDraftEmpty, parseStoredContent } from "@/lib/draftDoc";
import type { SessionState } from "@/lib/session/types";
import type { SlashItem } from "@/lib/slashCatalog";

/**
 * Latest-snapshot bag for the composer keyboard FSM. The hook stores it
 * behind a ref so every render rebinds the freshest values — the handler
 * itself is never a stale closure and stays off the memo-dep graph.
 */
export type ComposerKeyDownCtx = {
  // @-file menu
  atMenuOpen: boolean;
  atEntries: ComposerAtFileEntry[];
  atActiveIndex: number;
  setAtActiveIndex: Dispatch<SetStateAction<number>>;
  applyAtFile: (entry: ComposerAtFileEntry) => void;
  closeAtMenu: () => void;
  // slash / "+" menu
  composerMenuOpen: boolean;
  composerMenuEntriesRef: RefObject<ComposerPlusEntry[]>;
  slashActiveIndex: number;
  setSlashActiveIndex: Dispatch<SetStateAction<number>>;
  pickComposerFiles: () => unknown;
  applyCreateVideo: () => void;
  closeComposerMenu: () => void;
  setJsonSchemaDraft: Dispatch<SetStateAction<string>>;
  sessionJsonSchema: string | null | undefined;
  setShowJsonSchemaModal: Dispatch<SetStateAction<boolean>>;
  applySlashItem: (item: SlashItem) => void;
  // prompt history (session browse + recent picker)
  promptHistoryOpenRef: RefObject<boolean>;
  closePromptHistory: () => void;
  openPromptHistory: (opts?: {
    focusFilter?: boolean;
    seedDraft?: boolean;
  }) => void;
  promptHistoryEntries: PromptHistoryEntry[];
  promptHistoryActive: number;
  setPromptHistoryActive: Dispatch<SetStateAction<number>>;
  applyPromptHistoryEntry: (
    entry: PromptHistoryEntry,
    opts?: {
      close?: boolean;
      listIndex?: number;
      scope?: PromptHistoryScope;
    },
  ) => void;
  promptHistoryFocusFilter: boolean;
  promptHistoryScope: PromptHistoryScope;
  promptHistoryIndexRef: MutableRefObject<number | null>;
  setPromptHistoryIndex: Dispatch<SetStateAction<number | null>>;
  setDraft: (next: string | ((prev: string) => string)) => void;
  getDraft: () => string;
  messagesRef: RefObject<
    ReadonlyArray<{ role: string; content?: string | null }>
  >;
  // Enter / send resolution
  composerSendKeyPref: ComposerSendKeyPref;
  canGuideQueuedMessage: boolean;
  sessionState: SessionState;
  steerFromComposer: () => unknown;
  attachments: readonly unknown[];
  chatAttachments: readonly unknown[];
  quotesRef: RefObject<readonly unknown[]>;
  send: () => unknown;
  // Escape fallthrough
  attachChatOpenRef: RefObject<boolean>;
  closeAttachChat: () => void;
};

/**
 * Composer keyboard router: @-menu nav, slash/plus palette, prompt-history
 * browse (picker + CLI-like ↑/↓), Enter send-vs-steer, Escape unwind.
 * Returns a stable ref whose `.current` is rebound to the newest snapshot
 * each render — callers pass `ref.current(e)` from a single useCallback.
 */
export function useComposerKeyDown(ctx: ComposerKeyDownCtx) {
  const ref = useRef<(e: ReactKeyboardEvent<HTMLDivElement>) => void>(
    () => {},
  );
  ref.current = (e) => {
    const {
      applyAtFile,
      applyCreateVideo,
      applyPromptHistoryEntry,
      applySlashItem,
      atActiveIndex,
      atEntries,
      atMenuOpen,
      attachChatOpenRef,
      attachments,
      canGuideQueuedMessage,
      chatAttachments,
      closeAtMenu,
      closeAttachChat,
      closeComposerMenu,
      closePromptHistory,
      composerMenuEntriesRef,
      composerMenuOpen,
      composerSendKeyPref,
      getDraft,
      messagesRef,
      openPromptHistory,
      pickComposerFiles,
      promptHistoryActive,
      promptHistoryEntries,
      promptHistoryFocusFilter,
      promptHistoryIndexRef,
      promptHistoryOpenRef,
      promptHistoryScope,
      quotesRef,
      send,
      sessionJsonSchema,
      sessionState,
      setAtActiveIndex,
      setDraft,
      setJsonSchemaDraft,
      setPromptHistoryActive,
      setPromptHistoryIndex,
      setShowJsonSchemaModal,
      setSlashActiveIndex,
      slashActiveIndex,
      steerFromComposer,
    } = ctx;

    if (
      e.nativeEvent.isComposing ||
      (e.nativeEvent as KeyboardEvent).keyCode === 229
    ) {
      return;
    }
    if (atMenuOpen) {
      const n = atEntries.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!n) return;
        setAtActiveIndex((i) => (i + 1) % n);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!n) return;
        setAtActiveIndex((i) => (i - 1 + n) % n);
        return;
      }
      if (
        (e.key === "Enter" || e.key === "Tab") &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        if (!n) return;
        const entry =
          atEntries[
            Math.min(Math.max(0, atActiveIndex), Math.max(0, n - 1))
          ];
        if (entry) applyAtFile(entry);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeAtMenu();
        return;
      }
    }
    if (composerMenuOpen) {
      // Ref = same array the panel renders (never desync).
      const flat = composerMenuEntriesRef.current;
      const n = flat.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!n) return;
        setSlashActiveIndex((i) => (i + 1) % n);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!n) return;
        setSlashActiveIndex((i) => (i - 1 + n) % n);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const entry =
          flat[
            Math.min(Math.max(0, slashActiveIndex), Math.max(0, n - 1))
          ];
        if (!entry) return;
        if (entry.kind === "upload") void pickComposerFiles();
        else if (entry.kind === "create-video") applyCreateVideo();
        else if (entry.kind === "json-schema") {
          closeComposerMenu();
          setJsonSchemaDraft(sessionJsonSchema ?? "");
          setShowJsonSchemaModal(true);
        } else applySlashItem(entry.item);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeComposerMenu();
        return;
      }
      if (e.key === "Tab" && n > 0) {
        e.preventDefault();
        const entry =
          flat[Math.min(Math.max(0, slashActiveIndex), n - 1)]!;
        if (entry.kind === "upload") void pickComposerFiles();
        else if (entry.kind === "create-video") applyCreateVideo();
        else if (entry.kind === "json-schema") {
          closeComposerMenu();
          setJsonSchemaDraft(sessionJsonSchema ?? "");
          setShowJsonSchemaModal(true);
        } else applySlashItem(entry.item);
        return;
      }
    }
    // Prompt history picker open: ↑/↓/Home/End/Page move selection;
    // Enter/Tab apply; Esc closes (Build `/history` + empty-↑).
    if (promptHistoryOpenRef.current && !composerMenuOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        closePromptHistory();
        return;
      }
      if (
        (e.key === "Enter" && !e.ctrlKey && !e.metaKey) ||
        e.key === "Tab"
      ) {
        const entry = promptHistoryEntries[promptHistoryActive];
        if (entry) {
          e.preventDefault();
          applyPromptHistoryEntry(entry, {
            listIndex: promptHistoryActive,
          });
          return;
        }
      }
      const listNav = promptHistoryListNavFromKey(e.key);
      if (listNav) {
        e.preventDefault();
        if (promptHistoryEntries.length === 0) return;
        const liveSeed =
          !promptHistoryFocusFilter && promptHistoryScope === "session";
        // ArrowDown past newest on live session browse: clear + close.
        if (listNav === "down" && promptHistoryActive <= 0 && liveSeed) {
          promptHistoryIndexRef.current = null;
          setPromptHistoryIndex(null);
          setDraft("");
          closePromptHistory();
          return;
        }
        const next = stepPromptHistoryListIndex(
          promptHistoryActive,
          promptHistoryEntries.length,
          listNav,
        );
        setPromptHistoryActive(next);
        const entry = promptHistoryEntries[next];
        if (entry && liveSeed) {
          applyPromptHistoryEntry(entry, {
            close: false,
            listIndex: next,
            scope: "session",
          });
        }
        return;
      }
    }
    // CLI-like prompt history: ↑ on empty draft opens picker + seeds newest.
    // Only when slash palette is closed so palette ↑/↓ is untouched.
    if (
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      !composerMenuOpen &&
      !promptHistoryOpenRef.current
    ) {
      const history = collectUserPromptHistory(messagesRef.current);
      const draftEmpty = isDraftEmpty(parseStoredContent(getDraft()));
      const browsing = promptHistoryIndexRef.current !== null;
      if (
        shouldHandlePromptHistoryKey({
          key: e.key,
          draftEmpty,
          browsing,
          historyLength: history.length,
        })
      ) {
        e.preventDefault();
        if (e.key === "ArrowUp" && !browsing) {
          openPromptHistory({
            focusFilter: false,
            seedDraft: true,
          });
          return;
        }
        const step = stepPromptHistory(
          history,
          promptHistoryIndexRef.current,
          e.key === "ArrowUp" ? "up" : "down",
        );
        promptHistoryIndexRef.current = step.index;
        setPromptHistoryIndex(step.index);
        setDraft(step.text);
        if (step.index == null) {
          closePromptHistory();
        } else if (!promptHistoryOpenRef.current) {
          openPromptHistory({
            focusFilter: false,
            seedDraft: false,
          });
          setPromptHistoryActive(step.index);
        } else {
          setPromptHistoryActive(step.index);
        }
        return;
      }
    }
    const submit = resolveComposerSubmitAction({
      event: e,
      sendPref: composerSendKeyPref,
      canSteer: composerSteerLive({
        canGuideQueuedMessage,
        sessionState: sessionState,
      }),
    });
    if (submit === "steer") {
      e.preventDefault();
      void steerFromComposer();
      return;
    }
    if (submit === "send") {
      e.preventDefault();
      const hasBody = composerHasSendPayload({
        draftEmpty: isDraftEmpty(parseStoredContent(getDraft())),
        attachmentCount: attachments.length,
        chatAttachmentCount: chatAttachments.length,
        quoteCount: quotesRef.current.length,
      });
      if (hasBody && sessionState !== "awaiting_permission") void send();
    }
    if (e.key === "Escape") {
      if (promptHistoryOpenRef.current) {
        closePromptHistory();
        return;
      }
      if (attachChatOpenRef.current) {
        closeAttachChat();
        return;
      }
      closeComposerMenu();
    }
  };
  return ref;
}
