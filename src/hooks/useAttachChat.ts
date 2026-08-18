/**
 * Attach-another-chat orchestration (picker, chips, grip-hold drag).
 * State may live in useComposerController; this hook owns the wiring.
 */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
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
  type SessionDragPayload,
} from "@/lib/chatAttach";
import {
  armAttachDragClickBlocker,
  classifySessionAttachDrop,
  createAttachDragClickGuard,
  isSessionAttachPointerStartTarget,
  sessionAttachDragPastThreshold,
  sessionAttachDropReadyFromPoint,
  setSessionAttachDragLock,
} from "@/lib/sessionAttachDrag";

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
  sessionSelectMode: boolean;
  chatAttachments: ChatRef[];
  setChatAttachments: Dispatch<SetStateAction<ChatRef[]>>;
  attachChatOpen: boolean;
  setAttachChatOpen: Dispatch<SetStateAction<boolean>>;
  attachChatFilter: string;
  setAttachChatFilter: Dispatch<SetStateAction<string>>;
  attachChatActive: number;
  setAttachChatActive: Dispatch<SetStateAction<number>>;
  attachChatPanelRef: RefObject<HTMLDivElement | null>;
  sessionDragRef: MutableRefObject<SessionDragPayload | null>;
  setSessionDropReady: Dispatch<SetStateAction<boolean>>;
  composerShellRef: RefObject<HTMLElement | null>;
  composerWrapRef: RefObject<HTMLDivElement | null>;
  composerInputRef: RefObject<HTMLDivElement | null>;
  hitDragZone: (x: number, y: number) => "sidebar" | "main";
  showToast: (msg: string, ms?: number) => void;
  tr: Tr;
  onBeforeOpenPicker: () => void;
  openSession: (row: AttachChatSession) => void;
}) {
  const {
    sessions,
    currentSessionId,
    currentProjectId,
    sessionSelectMode,
    chatAttachments,
    setChatAttachments,
    attachChatOpen,
    setAttachChatOpen,
    attachChatFilter,
    setAttachChatFilter,
    setAttachChatActive,
    attachChatPanelRef,
    sessionDragRef,
    setSessionDropReady,
    composerShellRef,
    composerWrapRef,
    composerInputRef,
    hitDragZone,
    showToast,
    tr,
    onBeforeOpenPicker,
    openSession,
  } = opts;

  const applyAttachedChatRef = useRef<(
    id: string,
    title: string,
    updatedAt?: string,
  ) => void>(() => {});
  const clickGuardRef = useRef(createAttachDragClickGuard());
  const [sessionDragGhost, setSessionDragGhost] = useState<{
    x: number;
    y: number;
    title: string;
    ready: boolean;
  } | null>(null);

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
  applyAttachedChatRef.current = applyAttachedChat;

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

  const sessionRowDragProps = (s: {
    id: string;
    title: string;
    updatedAt?: string;
  }) => {
    if (sessionSelectMode) return undefined;
    return {
      onPointerDown: (e: ReactPointerEvent) => {
        if (e.button !== 0) return;
        if (!isSessionAttachPointerStartTarget(e.target)) return;
        const payload: SessionDragPayload = {
          id: s.id,
          title: s.title || "",
          updatedAt: s.updatedAt,
        };
        const startX = e.clientX;
        const startY = e.clientY;
        let started = false;
        let cancelled = false;
        setSessionAttachDragLock(true);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* capture optional */
        }

        const composerEl =
          composerWrapRef.current ?? composerShellRef.current;
        const kindAt = (x: number, y: number) =>
          classifySessionAttachDrop({
            overComposer: sessionAttachDropReadyFromPoint(x, y, {
              composerEl,
              zone: hitDragZone(x, y),
            }),
            zone: hitDragZone(x, y),
          });

        const onMove = (ev: PointerEvent) => {
          ev.preventDefault();
          window.getSelection()?.removeAllRanges();
          if (!started) {
            if (
              !sessionAttachDragPastThreshold(
                ev.clientX - startX,
                ev.clientY - startY,
              )
            ) {
              return;
            }
            started = true;
            sessionDragRef.current = payload;
          }
          const kind = kindAt(ev.clientX, ev.clientY);
          const ready = kind === "composer";
          setSessionDropReady(ready);
          setSessionDragGhost({
            x: ev.clientX,
            y: ev.clientY,
            title: payload.title || payload.id.slice(0, 8),
            ready,
          });
        };

        const cleanup = () => {
          window.removeEventListener("pointermove", onMove, moveOpts);
          window.removeEventListener("pointerup", finish, true);
          window.removeEventListener("pointercancel", finish, true);
          window.removeEventListener("keydown", onKey, true);
          setSessionAttachDragLock(false);
          setSessionDragGhost(null);
          window.getSelection()?.removeAllRanges();
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* already released */
          }
        };

        const finish = (ev: PointerEvent) => {
          cleanup();
          if (started) {
            armAttachDragClickBlocker(clickGuardRef.current, Date.now());
          }
          if (!started || cancelled) return;
          const kind = kindAt(ev.clientX, ev.clientY);
          sessionDragRef.current = null;
          setSessionDropReady(false);
          if (kind === "composer") {
            applyAttachedChatRef.current(
              payload.id,
              payload.title,
              payload.updatedAt,
            );
            return;
          }
          showToast(tr("attachChat.cancelled"), 1600);
        };

        const onKey = (ev: KeyboardEvent) => {
          if (ev.key !== "Escape") return;
          ev.preventDefault();
          cancelled = true;
          cleanup();
          sessionDragRef.current = null;
          setSessionDropReady(false);
          if (started) {
            armAttachDragClickBlocker(clickGuardRef.current, Date.now());
            showToast(tr("attachChat.cancelled"), 1600);
          }
        };

        const moveOpts: AddEventListenerOptions = {
          capture: true,
          passive: false,
        };
        window.addEventListener("pointermove", onMove, moveOpts);
        window.addEventListener("pointerup", finish, true);
        window.addEventListener("pointercancel", finish, true);
        window.addEventListener("keydown", onKey, true);
      },
      consumeClick: () => clickGuardRef.current.consume(Date.now()),
    };
  };

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
    applyAttachedChatRef,
    onSidebarSessionAttach,
    cycleAttachedChatScope,
    attachedChatLookup,
    attachScopeLabel,
    attachableSessions,
    attachChatPos,
    attachChatStyle,
    sessionRowDragProps,
    sessionDragGhost,
    removeAttachedChat,
  };
}
