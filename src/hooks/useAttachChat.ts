/**
 * Attach-another-chat orchestration (picker, chips, sidebar icon click).
 * State may live in useComposerController; this hook owns the wiring.
 * No sidebar → composer drag — row-body drag is session-move.
 */
import {
  useCallback,
  useMemo,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { MessageKey } from "@/i18n";
import { useFloatingMenu } from "@/lib/floatingMenu";
import {
  addChatRef,
  filterAttachableSessions,
  loadRecentAttachIds,
  lookupChatStatus,
  lookupChatTitle,
  MAX_ATTACHED_CHATS,
  nextChatAttachScope,
  parseChatAttachScope,
  rememberRecentAttach,
  removeChatRef,
  setChatRefScope,
  type ChatRef,
} from "@/lib/chatAttach";

export type AttachChatSession = {
  id: string;
  title: string;
  updatedAt?: string;
  archived?: boolean;
  projectId?: string | null;
};

type Tr = (key: MessageKey, vars?: Record<string, string>) => string;

export function useAttachChat(opts: {
  sessions: AttachChatSession[];
  currentSessionId: string | null | undefined;
  currentProjectId: string | null;
  chatAttachments: ChatRef[];
  setChatAttachments: Dispatch<SetStateAction<ChatRef[]>>;
  attachChatOpen: boolean;
  setAttachChatOpen: Dispatch<SetStateAction<boolean>>;
  attachChatFilter: string;
  setAttachChatFilter: Dispatch<SetStateAction<string>>;
  attachChatActive: number;
  setAttachChatActive: Dispatch<SetStateAction<number>>;
  attachChatPanelRef: RefObject<HTMLDivElement | null>;
  composerShellRef: RefObject<HTMLElement | null>;
  composerInputRef: RefObject<HTMLDivElement | null>;
  showToast: (msg: string, ms?: number) => void;
  tr: Tr;
  onBeforeOpenPicker: () => void;
  openSession: (row: AttachChatSession) => void;
}) {
  const {
    sessions,
    currentSessionId,
    currentProjectId,
    chatAttachments,
    setChatAttachments,
    attachChatOpen,
    setAttachChatOpen,
    attachChatFilter,
    setAttachChatFilter,
    setAttachChatActive,
    attachChatPanelRef,
    composerShellRef,
    composerInputRef,
    showToast,
    tr,
    onBeforeOpenPicker,
    openSession,
  } = opts;

  const closeAttachChat = useCallback(() => {
    setAttachChatOpen(false);
    setAttachChatFilter("");
    setAttachChatActive(0);
  }, [setAttachChatOpen, setAttachChatFilter, setAttachChatActive]);

  const attachableSessions = useMemo(
    () =>
      filterAttachableSessions(sessions, {
        currentId: currentSessionId,
        alreadyIds: chatAttachments.map((c) => c.sessionId),
        query: attachChatFilter,
        currentProjectId,
        recentIds: loadRecentAttachIds(),
      }),
    [
      sessions,
      currentSessionId,
      chatAttachments,
      attachChatFilter,
      currentProjectId,
    ],
  );

  const { pos: attachChatPos, style: attachChatStyle } = useFloatingMenu({
    open: attachChatOpen,
    triggerRef: composerShellRef,
    panelRef: attachChatPanelRef,
    roots: [composerShellRef, composerInputRef, attachChatPanelRef],
    onClose: closeAttachChat,
    placement: "up",
    fitContent: false,
    matchTriggerWidth: true,
    minWidth: 280,
    estHeight: 280,
    gap: 8,
    deps: [attachChatFilter, attachableSessions.length],
  });

  const openAttachChat = useCallback(() => {
    const candidates = filterAttachableSessions(sessions, {
      currentId: currentSessionId,
      alreadyIds: chatAttachments.map((c) => c.sessionId),
    });
    if (candidates.length === 0) {
      showToast(
        chatAttachments.length >= MAX_ATTACHED_CHATS
          ? tr("attachChat.limit", { n: String(MAX_ATTACHED_CHATS) })
          : tr("attachChat.empty"),
        2400,
      );
      return;
    }
    onBeforeOpenPicker();
    setAttachChatFilter("");
    setAttachChatActive(0);
    setAttachChatOpen(true);
  }, [
    sessions,
    currentSessionId,
    chatAttachments,
    showToast,
    tr,
    onBeforeOpenPicker,
    setAttachChatFilter,
    setAttachChatActive,
    setAttachChatOpen,
  ]);

  const applyAttachedChat = useCallback(
    (id: string, title: string, updatedAt?: string) => {
      const result = addChatRef(
        chatAttachments,
        { sessionId: id, title, attachedUpdatedAt: updatedAt },
        { currentId: currentSessionId },
      );
      if (!result.added) {
        if (result.reason === "limit") {
          showToast(
            tr("attachChat.limit", { n: String(MAX_ATTACHED_CHATS) }),
            2400,
          );
        } else if (result.reason === "self") {
          showToast(tr("attachChat.self"), 2400);
        }
        return;
      }
      setChatAttachments(result.refs);
      rememberRecentAttach(id);
      closeAttachChat();
      const label = title.trim() || id.slice(0, 8);
      showToast(tr("attachChat.ok", { title: label }), 2200);
      requestAnimationFrame(() => {
        composerInputRef.current?.focus?.();
      });
    },
    [
      chatAttachments,
      currentSessionId,
      closeAttachChat,
      showToast,
      tr,
      setChatAttachments,
      composerInputRef,
    ],
  );

  const onSidebarSessionAttach = useCallback(
    (s: { id: string; title: string; updatedAt?: string }) => {
      applyAttachedChat(s.id, s.title, s.updatedAt);
    },
    [applyAttachedChat],
  );

  const cycleAttachedChatScope = useCallback(
    (id: string) => {
      setChatAttachments((prev) => {
        const cur = prev.find((r) => r.sessionId === id);
        if (!cur) return prev;
        return setChatRefScope(prev, id, nextChatAttachScope(cur.scope));
      });
    },
    [setChatAttachments],
  );

  const attachedChatLookup = useMemo(
    () => ({
      titleOf: (id: string) =>
        lookupChatTitle(id, sessions, tr("attachChat.missing")),
      statusOf: (id: string) => lookupChatStatus(id, sessions),
      onOpen: (id: string) => {
        const row = sessions.find((s) => s.id === id);
        if (!row) {
          showToast(tr("attachChat.missing"), 2400);
          return;
        }
        openSession(row);
      },
    }),
    [sessions, showToast, tr, openSession],
  );

  const attachScopeLabel = useCallback(
    (scope?: string) => {
      const sc = parseChatAttachScope(scope);
      if (sc === "user") return tr("attachChat.scopeUser");
      if (sc === "full") return tr("attachChat.scopeFull");
      return tr("attachChat.scopeRecent");
    },
    [tr],
  );

  const removeAttachedChat = useCallback(
    (id: string) => {
      setChatAttachments((prev) => removeChatRef(prev, id));
    },
    [setChatAttachments],
  );

  return {
    closeAttachChat,
    openAttachChat,
    applyAttachedChat,
    onSidebarSessionAttach,
    cycleAttachedChatScope,
    attachedChatLookup,
    attachScopeLabel,
    attachableSessions,
    attachChatPos,
    attachChatStyle,
    removeAttachedChat,
  };
}
