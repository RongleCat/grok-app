/**
 * Session chrome badges: mute, unread, plan-pending.
 *
 * Owns the Sets, localStorage sync, clear-on-view, and dock/tray count.
 * Host fills {@link SessionChromeBadgesHost} in place so tr / dialog /
 * viewing-id stay late-bound. Plan chrome still lives on the host and
 * only calls {@link markPlanPendingBadge}.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { createT } from "@/i18n";
import * as api from "@/lib/api";
import type { AppDialog } from "@/lib/app/appDialogTypes";
import {
  applyPlanPendingMembership,
  type SessionPlanState,
} from "@/lib/planSession";
import {
  clearAllMutes as clearAllSessionMutes,
  loadMutedSessionIds,
  SESSION_MUTE_CHANGE_EVENT,
  shouldConfirmClearAllMutes,
  toggle as toggleSessionMute,
} from "@/lib/sessionMute";
import {
  clearAllUnread as clearAllSessionUnread,
  clearUnread as clearSessionUnread,
  isWorkbenchForeground,
  loadUnreadSessionIds,
  markUnread as markSessionUnread,
  SESSION_UNREAD_CHANGE_EVENT,
  shouldConfirmClearAllUnread,
} from "@/lib/sessionUnread";
import { resolveTrayBusyBadgeCount } from "@/lib/trayNotifyPro";

type TFn = ReturnType<typeof createT>;

export type SessionChromeBadgesHost = {
  tr: TFn;
  setAppDialog: (dialog: AppDialog) => void;
  viewingSessionId: () => string | null | undefined;
};

function emptyHost(): SessionChromeBadgesHost {
  const noop = () => {};
  return {
    tr: ((k: string) => k) as TFn,
    setAppDialog: noop,
    viewingSessionId: () => null,
  };
}

export function createSessionChromeBadgesHost(): SessionChromeBadgesHost {
  return emptyHost();
}

export function useSessionChromeBadges(opts: {
  hostRef: MutableRefObject<SessionChromeBadgesHost>;
  viewedSessionId: string | null | undefined;
  isSecondaryWindow: boolean;
  trayBusyBadge: boolean;
  winTaskbarOverlay: boolean;
}) {
  const hostRef = opts.hostRef;

  const [mutedSessionIds, setMutedSessionIds] = useState<Set<string>>(
    () => loadMutedSessionIds(),
  );
  useEffect(() => {
    const onChange = () => setMutedSessionIds(loadMutedSessionIds());
    window.addEventListener(SESSION_MUTE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(SESSION_MUTE_CHANGE_EVENT, onChange);
  }, []);

  /**
   * Sessions that finished a turn while not viewed (localStorage Set).
   * Independent of mute — muted chats still show the sidebar unread dot.
   */
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(
    () => loadUnreadSessionIds(),
  );
  useEffect(() => {
    const onChange = () => setUnreadSessionIds(loadUnreadSessionIds());
    window.addEventListener(SESSION_UNREAD_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(SESSION_UNREAD_CHANGE_EVENT, onChange);
  }, []);

  /**
   * Clear one session's unread marker and sync React state immediately so
   * sidebar dots + dock/tray badge count drop without waiting solely on the
   * storage CustomEvent (open / focus / mark-as-read paths share this).
   */
  const applyClearSessionUnread = useCallback(
    (sessionId: string | null | undefined) => {
      const id = typeof sessionId === "string" ? sessionId.trim() : "";
      if (!id) return;
      clearSessionUnread(id);
      setUnreadSessionIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [],
  );

  /**
   * Manual "mark as unread" while the chat is still open: hold the badge until
   * the user leaves and re-opens the thread (auto clear-on-view still applies).
   */
  const manualUnreadHoldIdsRef = useRef<Set<string>>(new Set());
  const applyMarkSessionUnread = useCallback(
    (sessionId: string | null | undefined) => {
      const id = typeof sessionId === "string" ? sessionId.trim() : "";
      if (!id) return;
      markSessionUnread(id);
      setUnreadSessionIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      if (hostRef.current.viewingSessionId() === id) {
        manualUnreadHoldIdsRef.current.add(id);
      }
    },
    [hostRef],
  );

  /**
   * Sessions with an open plan review gate (or restored re-park wait).
   * Sidebar badge only — does not change open/busy/select interactions.
   */
  const [planPendingSessionIds, setPlanPendingSessionIds] = useState<
    Set<string>
  >(() => new Set());
  const markPlanPendingBadge = useCallback(
    (sessionId: string | null | undefined, plan: SessionPlanState) => {
      setPlanPendingSessionIds((prev) =>
        applyPlanPendingMembership(prev, sessionId, plan),
      );
    },
    [],
  );

  const handleToggleSessionMute = useCallback((sessionId: string) => {
    toggleSessionMute(sessionId);
    setMutedSessionIds(loadMutedSessionIds());
  }, []);

  const applyClearAllUnread = useCallback(() => {
    clearAllSessionUnread();
    manualUnreadHoldIdsRef.current.clear();
    setUnreadSessionIds(loadUnreadSessionIds());
  }, []);

  const handleClearAllSessionUnread = useCallback(() => {
    const n = unreadSessionIds.size;
    if (n <= 0) return;
    const h = hostRef.current;
    if (shouldConfirmClearAllUnread(n)) {
      h.setAppDialog({
        kind: "confirm",
        title: h.tr("session.clearAllUnreadTitle"),
        message: h.tr("session.clearAllUnreadBody", { n: String(n) }),
        confirmLabel: h.tr("session.clearAllUnreadAction"),
        onConfirm: () => {
          applyClearAllUnread();
        },
      });
      return;
    }
    applyClearAllUnread();
  }, [unreadSessionIds.size, hostRef, applyClearAllUnread]);

  const applyClearAllMutes = useCallback(() => {
    clearAllSessionMutes();
    setMutedSessionIds(loadMutedSessionIds());
  }, []);

  const handleClearAllSessionMutes = useCallback(() => {
    const n = mutedSessionIds.size;
    if (n <= 0) return;
    const h = hostRef.current;
    if (shouldConfirmClearAllMutes(n)) {
      h.setAppDialog({
        kind: "confirm",
        title: h.tr("session.clearAllMutesTitle"),
        message: h.tr("session.clearAllMutesBody", { n: String(n) }),
        confirmLabel: h.tr("session.clearAllMutesAction"),
        onConfirm: () => {
          applyClearAllMutes();
        },
      });
      return;
    }
    applyClearAllMutes();
  }, [mutedSessionIds.size, hostRef, applyClearAllMutes]);

  const handleClearSessionUnread = useCallback(
    (sessionId: string) => {
      manualUnreadHoldIdsRef.current.delete(sessionId);
      applyClearSessionUnread(sessionId);
    },
    [applyClearSessionUnread],
  );

  const handleMarkSessionUnread = useCallback(
    (sessionId: string) => {
      applyMarkSessionUnread(sessionId);
    },
    [applyMarkSessionUnread],
  );

  // Binding a session while the workbench is in front clears its unread
  // (sidebar + dock/tray badge + pet done-bubble). Hidden / unfocused
  // windows are not a read — the bubble stays until they click it or
  // actually view this chat with the window focused.
  useEffect(() => {
    if (!opts.viewedSessionId) return;
    manualUnreadHoldIdsRef.current.delete(opts.viewedSessionId);
    if (!isWorkbenchForeground()) return;
    applyClearSessionUnread(opts.viewedSessionId);
  }, [opts.viewedSessionId, applyClearSessionUnread]);

  // Dock/taskbar or OS focus while already on a finished chat: clear that
  // session's unread so the badge and pet bubble drop without re-clicking.
  useEffect(() => {
    const clearViewingIfPresent = () => {
      const id = hostRef.current.viewingSessionId();
      if (!id) return;
      if (manualUnreadHoldIdsRef.current.has(id)) return;
      if (!isWorkbenchForeground()) return;
      applyClearSessionUnread(id);
    };
    const onVis = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible"
      ) {
        clearViewingIfPresent();
      }
    };
    window.addEventListener("focus", clearViewingIfPresent);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", clearViewingIfPresent);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [applyClearSessionUnread, hostRef]);

  // Dock / tray badge: unread sessions that finished a turn in the background.
  // Secondary windows must not overwrite the dock badge (main owns chrome).
  useEffect(() => {
    const resolved = resolveTrayBusyBadgeCount({
      enabled: opts.trayBusyBadge,
      busyCount: unreadSessionIds.size,
      isSecondaryWindow: opts.isSecondaryWindow,
    });
    if (!resolved.apply) return;
    void api.traySetBusyCount(resolved.count);
  }, [unreadSessionIds.size, opts.trayBusyBadge, opts.isSecondaryWindow]);

  // Windows taskbar overlay: independent of trayBusyBadge (default off).
  useEffect(() => {
    const resolved = resolveTrayBusyBadgeCount({
      enabled: opts.winTaskbarOverlay,
      busyCount: unreadSessionIds.size,
      isSecondaryWindow: opts.isSecondaryWindow,
    });
    if (!resolved.apply) return;
    void api.traySetWindowsOverlay(resolved.count);
  }, [unreadSessionIds.size, opts.winTaskbarOverlay, opts.isSecondaryWindow]);

  return {
    mutedSessionIds,
    unreadSessionIds,
    planPendingSessionIds,
    applyClearSessionUnread,
    applyMarkSessionUnread,
    markPlanPendingBadge,
    handleToggleSessionMute,
    handleClearSessionUnread,
    handleMarkSessionUnread,
    handleClearAllSessionUnread,
    handleClearAllSessionMutes,
  };
}
