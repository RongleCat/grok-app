/**
 * Session open navigation: generation abort, viewing bind, journal hydrate
 * schedule, and warm-connect debounce.
 *
 * Composer / plan / gates / catalog stay with the workbench composition root
 * via {@link SessionNavHost} (in-place field updates, never a null ref).
 * `sendQueue` / composer focus bind after `useSendQueue` in AppWorkbench.
 */
import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
} from "react";
import * as api from "@/lib/api";
import type { Project, SessionRow } from "@/lib/app/sidebarModels";
import {
  hydrateSessionJournal,
  type HydrateSessionJournalResult,
} from "@/lib/sessionJournalHydrate";
import {
  DEFERRED_RECONCILE_MS,
  WARM_CONNECT_DEBOUNCE_MS,
  shouldApplyOpenSessionResult,
} from "@/lib/sessionOpenSwitch";
import {
  IDLE_SNAPSHOT,
  isSessionLiveStreaming,
  snapshotOutgoingMessages,
} from "@/lib/session";
import { sessionLiveMapStore } from "@/lib/sessionLiveMapStore";
import {
  projectHostIntoLiveMap,
  resumeStateForSession,
} from "@/lib/sessionLiveStore";
import {
  shouldDeferWarmConnectForForeignBusy,
  shouldSkipWarmConnect,
} from "@/lib/multiWindow";
import { sessionShellStore } from "@/lib/sessionShellStore";
import { sessionTranscriptStore } from "@/lib/sessionTranscriptStore";
import { useSessionShellActions } from "@/hooks/useSessionShell";

export type SessionNavHost = {
  chrome: {
    goToChat: () => void;
    closePhoneDrawerIfNeeded: () => void;
  };
  catalog: {
    resolveProject: (
      s: SessionRow,
      hint?: Project | null,
    ) => Project | null;
    setActiveProject: (p: Project | null) => void;
    markScheduled: (sessionId: string) => void;
    rememberLastSession: (
      sessionId: string,
      projectId: string | null,
    ) => void;
    clearUnread: (sessionId: string) => void;
    getActiveProject: () => Project | null;
    rejectUnusable: (project: Project | null) => boolean;
    revealInSidebar: (project: Project | null) => void;
  };
  composer: {
    stashLeaving: (leavingSessionId: string | null) => void;
    restoreForSession: (sessionId: string) => void;
    restoreForNewChat: (
      project: Project | null,
      seedDraft?: string,
    ) => void;
    clearDraftQueue: () => void;
    requestFocus: () => void;
  };
  draft: {
    setAutomationSetup: (on: boolean) => void;
    resetUsageAndClock: () => void;
    resetPlanAndGates: () => void;
    newChatTitle: () => string;
    startWelcomeIntro: () => void;
  };
  plan: {
    stashLeaving: (sessionId: string) => void;
    restoreChrome: (
      sessionId: string,
      stillThisOpen: () => boolean,
    ) => void;
  };
  hydrate: {
    applyOpenResult: (
      sessionId: string,
      result: HydrateSessionJournalResult,
    ) => void;
    applyReconcileResult: (
      sessionId: string,
      result: HydrateSessionJournalResult,
    ) => void;
  };
  gates: {
    restoreForSession: (
      sessionId: string,
      opts: { stillThisOpen: () => boolean; liveSessionId: string | null },
    ) => void;
    clearEditingAndSchema: (jsonSchema: string | null | undefined) => void;
    setLocalError: (msg: string | null) => void;
  };
  connect: {
    isSecondaryWindow: () => boolean;
    isSendInFlight: (sessionId: string) => boolean;
    isConnecting: (sessionId: string) => boolean;
    claim: (sessionId: string) => boolean;
    release: (sessionId: string) => void;
    workspacePath: () => string | undefined;
    isProjectWarmable: (project: Project | null) => boolean;
  };
};

function stub(name: string): () => never {
  return () => {
    throw new Error(`SessionNavHost.${name} used before AppWorkbench binder`);
  };
}

/** Stable placeholder; AppWorkbench mutates fields in place each render. */
export function createSessionNavHost(): SessionNavHost {
  return {
    chrome: {
      goToChat: stub("chrome.goToChat"),
      closePhoneDrawerIfNeeded: stub("chrome.closePhoneDrawerIfNeeded"),
    },
    catalog: {
      resolveProject: stub("catalog.resolveProject") as SessionNavHost["catalog"]["resolveProject"],
      setActiveProject: stub("catalog.setActiveProject"),
      markScheduled: stub("catalog.markScheduled"),
      rememberLastSession: stub("catalog.rememberLastSession"),
      clearUnread: stub("catalog.clearUnread"),
      getActiveProject: stub(
        "catalog.getActiveProject",
      ) as SessionNavHost["catalog"]["getActiveProject"],
      rejectUnusable: stub(
        "catalog.rejectUnusable",
      ) as SessionNavHost["catalog"]["rejectUnusable"],
      revealInSidebar: stub("catalog.revealInSidebar"),
    },
    composer: {
      stashLeaving: stub("composer.stashLeaving"),
      restoreForSession: stub("composer.restoreForSession"),
      restoreForNewChat: stub("composer.restoreForNewChat"),
      clearDraftQueue: stub("composer.clearDraftQueue"),
      requestFocus: stub("composer.requestFocus"),
    },
    draft: {
      setAutomationSetup: stub("draft.setAutomationSetup"),
      resetUsageAndClock: stub("draft.resetUsageAndClock"),
      resetPlanAndGates: stub("draft.resetPlanAndGates"),
      newChatTitle: stub("draft.newChatTitle") as SessionNavHost["draft"]["newChatTitle"],
      startWelcomeIntro: stub("draft.startWelcomeIntro"),
    },
    plan: {
      stashLeaving: stub("plan.stashLeaving"),
      restoreChrome: stub("plan.restoreChrome"),
    },
    hydrate: {
      applyOpenResult: stub("hydrate.applyOpenResult"),
      applyReconcileResult: stub("hydrate.applyReconcileResult"),
    },
    gates: {
      restoreForSession: stub("gates.restoreForSession"),
      clearEditingAndSchema: stub("gates.clearEditingAndSchema"),
      setLocalError: stub("gates.setLocalError"),
    },
    connect: {
      isSecondaryWindow: stub("connect.isSecondaryWindow"),
      isSendInFlight: stub("connect.isSendInFlight") as SessionNavHost["connect"]["isSendInFlight"],
      isConnecting: stub("connect.isConnecting") as SessionNavHost["connect"]["isConnecting"],
      claim: stub("connect.claim") as SessionNavHost["connect"]["claim"],
      release: stub("connect.release"),
      workspacePath: stub("connect.workspacePath") as SessionNavHost["connect"]["workspacePath"],
      isProjectWarmable: stub(
        "connect.isProjectWarmable",
      ) as SessionNavHost["connect"]["isProjectWarmable"],
    },
  };
}

export type NewChatOpts = {
  seedDraft?: string;
  switchToChat?: boolean;
  automationSetup?: boolean;
};

export type UseSessionNavigationResult = {
  openSession: (s: SessionRow, project?: Project | null) => Promise<void>;
  newChat: (
    project?: Project | null,
    opts?: NewChatOpts,
  ) => Promise<void>;
  openSessionRef: MutableRefObject<
    (s: SessionRow, project?: Project | null) => Promise<void>
  >;
  openingSessionIdRef: MutableRefObject<string | null>;
  invalidateOpenPipelines: () => void;
};

function bindShellSession(s: SessionRow): void {
  const live = sessionShellStore.getLiveHost();
  const resume = resumeStateForSession(s.id, live, sessionLiveMapStore.getMap());
  if (live.sessionId === s.id) {
    sessionShellStore.setSession({
      ...live,
      title: s.title || live.title || "Untitled",
    });
  } else {
    sessionShellStore.setSession({
      ...IDLE_SNAPSHOT,
      sessionId: s.id,
      title: s.title || "Untitled",
      state: resume.state,
      streamingMessageId: resume.streamingMessageId,
      backend: "grok_agent_stdio",
    });
  }
}

export function useSessionNavigation(opts: {
  hostRef: MutableRefObject<SessionNavHost>;
  focusedSessionId: string | null | undefined;
  viewingSessionIdRef: MutableRefObject<string | null>;
  bumpViewEpoch: () => void;
}): UseSessionNavigationResult {
  const { hostRef, focusedSessionId, viewingSessionIdRef, bumpViewEpoch } =
    opts;
  const { setSession, setLiveHost } = useSessionShellActions();

  const openingSessionIdRef = useRef<string | null>(null);
  const openSessionGenRef = useRef(0);
  const warmConnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const deferredReconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const invalidateOpenPipelines = useCallback(() => {
    openSessionGenRef.current += 1;
    if (warmConnectTimerRef.current) {
      clearTimeout(warmConnectTimerRef.current);
      warmConnectTimerRef.current = null;
    }
    if (deferredReconcileTimerRef.current) {
      clearTimeout(deferredReconcileTimerRef.current);
      deferredReconcileTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => invalidateOpenPipelines();
  }, [invalidateOpenPipelines]);

  // Keep viewing id aligned for event handlers — skip while openSession is
  // loading so an intermediate null sessionId cannot wipe the target.
  useEffect(() => {
    if (openingSessionIdRef.current) return;
    viewingSessionIdRef.current = focusedSessionId ?? null;
  }, [focusedSessionId, viewingSessionIdRef]);

  const openSession = useCallback(
    async (s: SessionRow, project?: Project | null) => {
      const host = hostRef.current;
      const proj = host.catalog.resolveProject(s, project);
      host.chrome.goToChat();
      host.chrome.closePhoneDrawerIfNeeded();

      const leavingBeforeOpen = viewingSessionIdRef.current;
      host.composer.stashLeaving(leavingBeforeOpen);

      bumpViewEpoch();
      if (warmConnectTimerRef.current) {
        clearTimeout(warmConnectTimerRef.current);
        warmConnectTimerRef.current = null;
      }
      if (deferredReconcileTimerRef.current) {
        clearTimeout(deferredReconcileTimerRef.current);
        deferredReconcileTimerRef.current = null;
      }
      const openGen = ++openSessionGenRef.current;
      const stillThisOpen = () =>
        shouldApplyOpenSessionResult({
          currentGen: openSessionGenRef.current,
          startedGen: openGen,
          viewingSessionId: viewingSessionIdRef.current,
          targetSessionId: s.id,
        });

      const leavingId = leavingBeforeOpen;
      if (leavingId) {
        sessionTranscriptStore.cacheSession(
          leavingId,
          snapshotOutgoingMessages(
            sessionTranscriptStore.getCached(leavingId),
            sessionTranscriptStore.getMessages(),
          ),
        );
        host.plan.stashLeaving(leavingId);
      }

      openingSessionIdRef.current = s.id;
      viewingSessionIdRef.current = s.id;
      sessionTranscriptStore.setViewingSessionId(s.id);
      if (!sessionTranscriptStore.isJournalHydrated(s.id)) {
        sessionTranscriptStore.beginJournalLoad(s.id);
      } else {
        sessionTranscriptStore.clearJournalLoad();
      }
      bindShellSession(s);
      host.composer.restoreForSession(s.id);
      {
        const early = sessionTranscriptStore.getCached(s.id) ?? [];
        sessionTranscriptStore.cacheSession(s.id, early);
        sessionTranscriptStore.setMessages(early);
      }
      host.catalog.clearUnread(s.id);
      host.plan.restoreChrome(s.id, stillThisOpen);
      host.gates.clearEditingAndSchema(s.jsonSchema);

      const hydrated = await hydrateSessionJournal({
        sessionId: s.id,
        sessionScheduled: !!s.scheduled,
        stillThisOpen,
        liveState: resumeStateForSession(
          s.id,
          sessionShellStore.getLiveHost(),
          sessionLiveMapStore.getMap(),
        ).state,
      });
      if (hydrated.status === "aborted") {
        if (openingSessionIdRef.current === s.id) {
          openingSessionIdRef.current = null;
        }
        return;
      }
      hostRef.current.hydrate.applyOpenResult(s.id, hydrated);
      if (hydrated.status === "applied" && api.isTauri()) {
        if (deferredReconcileTimerRef.current) {
          clearTimeout(deferredReconcileTimerRef.current);
        }
        deferredReconcileTimerRef.current = setTimeout(() => {
          deferredReconcileTimerRef.current = null;
          void (async () => {
            if (!stillThisOpen()) return;
            const recon = await hydrateSessionJournal({
              sessionId: s.id,
              sessionScheduled: !!s.scheduled,
              stillThisOpen,
              liveState: resumeStateForSession(
                s.id,
                sessionShellStore.getLiveHost(),
                sessionLiveMapStore.getMap(),
              ).state,
              reconcile: true,
            });
            if (recon.status !== "applied" || recon.unchanged) return;
            hostRef.current.hydrate.applyReconcileResult(s.id, recon);
          })();
        }, DEFERRED_RECONCILE_MS);
      }
      if (!stillThisOpen()) {
        if (openingSessionIdRef.current === s.id) {
          openingSessionIdRef.current = null;
        }
        return;
      }

      const hostAfter = hostRef.current;
      hostAfter.catalog.setActiveProject(proj);
      bindShellSession(s);
      if (openingSessionIdRef.current === s.id) {
        openingSessionIdRef.current = null;
      }
      hostAfter.gates.setLocalError(null);
      const live = sessionShellStore.getLiveHost();
      hostAfter.gates.restoreForSession(s.id, {
        stillThisOpen,
        liveSessionId: live.sessionId,
      });

      if (
        api.isTauri() &&
        !hostAfter.connect.isSecondaryWindow() &&
        stillThisOpen()
      ) {
        hostAfter.catalog.rememberLastSession(s.id, proj?.id ?? null);
      }

      if (shouldSkipWarmConnect(hostAfter.connect.isSecondaryWindow())) {
        return;
      }
      const foreignBusy =
        Object.entries(sessionLiveMapStore.getMap()).some(
          ([id, snap]) =>
            id !== s.id &&
            (snap.state === "streaming" ||
              snap.state === "awaiting_permission"),
        ) ||
        (!!live.sessionId &&
          live.sessionId !== s.id &&
          isSessionLiveStreaming(live.state));
      const deferForeign = shouldDeferWarmConnectForForeignBusy({
        isSecondaryWindow: hostAfter.connect.isSecondaryWindow(),
        foreignBusy,
      });
      if (
        api.isTauri() &&
        !deferForeign &&
        !hostAfter.connect.isSendInFlight(s.id) &&
        !hostAfter.connect.isConnecting(s.id) &&
        hostAfter.connect.isProjectWarmable(proj) &&
        !(live.sessionId === s.id && live.state === "ready")
      ) {
        const warmId = s.id;
        const warmProjPath =
          proj?.path || hostAfter.connect.workspacePath() || undefined;
        const warmTitle = s.title;
        if (warmConnectTimerRef.current) {
          clearTimeout(warmConnectTimerRef.current);
        }
        warmConnectTimerRef.current = setTimeout(() => {
          warmConnectTimerRef.current = null;
          const c = hostRef.current.connect;
          if (!stillThisOpen()) return;
          if (c.isSendInFlight(warmId) || c.isConnecting(warmId)) return;
          if (shouldSkipWarmConnect(c.isSecondaryWindow())) return;
          if (!c.claim(warmId)) return;
          void (async () => {
            if (!stillThisOpen()) {
              hostRef.current.connect.release(warmId);
              return;
            }
            try {
              const snap = await api.sessionConnect({
                projectPath: warmProjPath,
                sessionId: warmId,
              });
              if (!stillThisOpen()) return;
              setLiveHost(snap);
              if (snap.sessionId === warmId) {
                setSession((prev) => ({
                  ...snap,
                  title: prev.title || warmTitle || snap.title || "Untitled",
                }));
              }
              if (snap.lastError && snap.state !== "ready") {
                console.warn(
                  "warm connect:",
                  snap.lastError.code,
                  snap.lastError.message,
                );
              }
            } catch (e) {
              console.warn("warm connect failed", e);
            } finally {
              hostRef.current.connect.release(warmId);
            }
          })();
        }, WARM_CONNECT_DEBOUNCE_MS);
      }
    },
    [bumpViewEpoch, hostRef, setLiveHost, setSession, viewingSessionIdRef],
  );

  /**
   * Draft new chat: clear UI only. No store row / CLI until first send.
   * `project === undefined` keeps the active project; explicit `null` is orphan.
   */
  const newChat = useCallback(
    async (project?: Project | null, opts?: NewChatOpts) => {
      const host = hostRef.current;
      // Explicit null → orphan; undefined → keep active project when set.
      const proj =
        project === undefined ? host.catalog.getActiveProject() : project;
      if (host.catalog.rejectUnusable(proj)) return;
      host.draft.startWelcomeIntro();

      const leavingId = viewingSessionIdRef.current;
      host.composer.stashLeaving(leavingId);

      host.draft.setAutomationSetup(!!opts?.automationSetup);
      if (opts?.switchToChat !== false) {
        host.chrome.goToChat();
      }
      host.chrome.closePhoneDrawerIfNeeded();
      host.catalog.setActiveProject(proj);
      if (proj) host.catalog.revealInSidebar(proj);

      bumpViewEpoch();
      invalidateOpenPipelines();

      if (leavingId) {
        sessionTranscriptStore.cacheSession(
          leavingId,
          snapshotOutgoingMessages(
            sessionTranscriptStore.getCached(leavingId),
            sessionTranscriptStore.getMessages(),
          ),
        );
        host.plan.stashLeaving(leavingId);
      }
      viewingSessionIdRef.current = null;
      sessionTranscriptStore.setViewingSessionId(null);
      sessionTranscriptStore.clearJournalLoad();
      sessionTranscriptStore.setMessages([]);
      host.draft.resetUsageAndClock();

      host.composer.restoreForNewChat(proj, opts?.seedDraft);
      host.composer.clearDraftQueue();
      host.draft.resetPlanAndGates();
      setSession({
        ...IDLE_SNAPSHOT,
        sessionId: null,
        title: host.draft.newChatTitle(),
        state: "idle",
        backend: "grok_agent_stdio",
      });

      // Never sessionDisconnect: an in-flight turn on the previous live host
      // must keep running. Park it in liveMap so the next draft send can
      // demote+spawn via ensureConnected.
      const prevLive = sessionShellStore.getLiveHost();
      if (
        prevLive.sessionId &&
        isSessionLiveStreaming(prevLive.state)
      ) {
        sessionLiveMapStore.setLiveMap((prev) =>
          projectHostIntoLiveMap(prev, {
            sessionId: prevLive.sessionId,
            state: prevLive.state,
            streamingMessageId: prevLive.streamingMessageId,
          }),
        );
      }
      host.composer.requestFocus();
      api.sessionPrewarm();
    },
    [
      bumpViewEpoch,
      hostRef,
      invalidateOpenPipelines,
      setSession,
      viewingSessionIdRef,
    ],
  );

  const openSessionRef = useRef(openSession);
  openSessionRef.current = openSession;

  return {
    openSession,
    newChat,
    openSessionRef,
    openingSessionIdRef,
    invalidateOpenPipelines,
  };
}
