/**
 * Session connect + live map subscription.
 * Host fills {@link SessionConnectHost} in place; connect logic lives here.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { createT } from "@/i18n";
import * as api from "@/lib/api";
import {
  isGeneralProject,
  projectDisplayName,
  type Project,
} from "@/lib/app/sidebarModels";
import { isActiveJsonSchema } from "@/lib/jsonSchema";
import { canLiveParticipate } from "@/lib/multiWindow";
import { isProjectPathMissing } from "@/lib/projectPath";
import { resolveSessionWorktreeBadge } from "@/lib/gitWorktree";
import { isViewedSessionConnecting } from "@/lib/connStatus";
import { migrateDraftSendClaim, queueSessionKey } from "@/lib/sendQueue";
import { IDLE_SNAPSHOT, type ChatMessage, type SessionSnapshot } from "@/lib/session";
import {
  projectHostIntoLiveMap,
  type SessionLiveMap,
} from "@/lib/sessionLiveStore";
import { reconcileSessionState } from "@/lib/sessionPhase";
import { migrateDraftTurnClock } from "@/lib/turnClock";
import { isSameView, shouldAdoptView, type ViewFocus } from "@/lib/viewFocus";
import { useLiveMapWhen } from "@/hooks/useSessionLiveMap";

type TFn = ReturnType<typeof createT>;

export type SessionConnectHost = {
  tr: TFn;
  session: SessionSnapshot;
  mode: string;
  connecting: boolean;
  activeProject: Project | null;
  generalWorkspacePath: string | null;
  gitWorktrees: api.GitWorktreeEntry[];
  isSecondaryWindowRef: MutableRefObject<boolean>;
  liveHostRef: MutableRefObject<SessionSnapshot>;
  viewingSessionIdRef: MutableRefObject<string | null>;
  messagesBySessionRef: MutableRefObject<Map<string, ChatMessage[]>>;
  turnStartedAtBySessionRef: MutableRefObject<Map<string, number>>;
  sendInFlightRef: MutableRefObject<boolean>;
  sendInFlightBySessionRef: MutableRefObject<Set<string>>;
  sendEpochBySessionRef: MutableRefObject<Map<string, number>>;
  sessionJsonSchemaRef: MutableRefObject<string | null>;
  currentViewFocus: () => ViewFocus;
  syncViewedTurnClock: (sessionId: string) => void;
  setLocalError: (msg: string | null) => void;
  setSession: Dispatch<SetStateAction<SessionSnapshot>>;
  setLiveHost: Dispatch<SetStateAction<SessionSnapshot>>;
  setLiveMap: (
    next: SessionLiveMap | ((prev: SessionLiveMap) => SessionLiveMap),
  ) => void;
  setSessionJsonSchema: Dispatch<SetStateAction<string | null>>;
  setActiveProject: Dispatch<SetStateAction<Project | null>>;
  setExpandedProjects: Dispatch<SetStateAction<Record<string, boolean>>>;
  refreshSessions: () => void | Promise<void>;
};

function emptyHost(): SessionConnectHost {
  const noop = () => {};
  return {
    tr: ((k: string) => k) as TFn,
    session: IDLE_SNAPSHOT,
    mode: "agent",
    connecting: false,
    activeProject: null,
    generalWorkspacePath: null,
    gitWorktrees: [],
    isSecondaryWindowRef: { current: false },
    liveHostRef: { current: IDLE_SNAPSHOT },
    viewingSessionIdRef: { current: null },
    messagesBySessionRef: { current: new Map() },
    turnStartedAtBySessionRef: { current: new Map() },
    sendInFlightRef: { current: false },
    sendInFlightBySessionRef: { current: new Set() },
    sendEpochBySessionRef: { current: new Map() },
    sessionJsonSchemaRef: { current: null },
    currentViewFocus: () => ({ sessionId: null, epoch: 0 }),
    syncViewedTurnClock: noop,
    setLocalError: noop,
    setSession: noop,
    setLiveHost: noop,
    setLiveMap: noop,
    setSessionJsonSchema: noop,
    setActiveProject: noop,
    setExpandedProjects: noop,
    refreshSessions: noop,
  };
}

export function useSessionConnect(opts: {
  hostRef: MutableRefObject<SessionConnectHost>;
  liveMapEnabled: boolean;
  viewedSessionId: string | null | undefined;
}) {
  const [connecting, setConnecting] = useState(false);
  const connectingRef = useRef(false);
  const connectingBySessionRef = useRef<Set<string>>(new Set());
  const ensureConnectCountRef = useRef(0);

  const liveMap = useLiveMapWhen(opts.liveMapEnabled);

  const claimSessionConnection = useCallback(
    (sessionId: string | null | undefined) => {
      const key = queueSessionKey(sessionId);
      const set = connectingBySessionRef.current;
      if (set.has(key)) return false;
      set.add(key);
      return true;
    },
    [],
  );
  const releaseSessionConnection = useCallback((keys: Iterable<string>) => {
    const set = connectingBySessionRef.current;
    for (const key of keys) set.delete(key);
  }, []);
  const syncEnsureConnectingUi = useCallback(() => {
    const h = opts.hostRef.current;
    const viewedActive = isViewedSessionConnecting(
      h.viewingSessionIdRef.current ?? h.session.sessionId,
      connectingBySessionRef.current,
    );
    connectingRef.current = viewedActive;
    setConnecting(viewedActive);
  }, [opts.hostRef]);

  useEffect(() => {
    syncEnsureConnectingUi();
  }, [opts.viewedSessionId, syncEnsureConnectingUi]);

  const ensureConnected = useCallback(
    async (
      forceOrOpts:
        | boolean
        | { force?: boolean; sessionId?: string | null } = false,
    ): Promise<string | null> => {
      const h = opts.hostRef.current;
      if (!canLiveParticipate(h.isSecondaryWindowRef.current)) {
        return null;
      }
      const connectOpts =
        typeof forceOrOpts === "boolean"
          ? {
              force: forceOrOpts,
              sessionId: undefined as string | null | undefined,
            }
          : forceOrOpts;
      const force = !!connectOpts.force;
      const preferredId =
        connectOpts.sessionId !== undefined
          ? connectOpts.sessionId
          : h.session.sessionId;
      const connectProject =
        h.activeProject && !isGeneralProject(h.activeProject)
          ? h.activeProject
          : null;
      if (connectProject && !connectProject.trusted) {
        h.setLocalError(
          h.tr("project.trustFirst", {
            name: projectDisplayName(connectProject, h.tr),
          }),
        );
        return null;
      }
      if (connectProject && isProjectPathMissing(connectProject.pathOk)) {
        h.setLocalError(
          h.tr("project.pathMissing", {
            name: projectDisplayName(connectProject, h.tr),
          }),
        );
        return null;
      }
      if (
        !force &&
        preferredId &&
        h.session.sessionId === preferredId &&
        h.session.state === "ready" &&
        !h.session.lastError
      ) {
        return preferredId;
      }
      if (!force && preferredId) {
        const live = h.liveHostRef.current;
        if (
          live.sessionId === preferredId &&
          live.state === "ready" &&
          !live.lastError
        ) {
          return preferredId;
        }
      }
      const connectKey = queueSessionKey(preferredId);
      const heldConnectKeys = new Set<string>([connectKey]);
      if (connectingBySessionRef.current.has(connectKey)) {
        const waitStart = Date.now();
        while (
          connectingBySessionRef.current.has(connectKey) &&
          Date.now() - waitStart < 120_000
        ) {
          await new Promise((r) => setTimeout(r, 50));
          const live = h.liveHostRef.current;
          if (
            preferredId &&
            live.sessionId === preferredId &&
            live.state === "ready" &&
            !live.lastError
          ) {
            return preferredId;
          }
        }
        if (connectingBySessionRef.current.has(connectKey)) return null;
      }
      if (!claimSessionConnection(preferredId)) return null;
      ensureConnectCountRef.current += 1;
      syncEnsureConnectingUi();
      const originView = h.currentViewFocus();
      try {
        let sessionId = preferredId ?? null;
        if (!sessionId && api.hasHost()) {
          const meta = (await api.sessionCreate(
            connectProject?.id,
            h.tr("session.new"),
          )) as { id: string; title?: string };
          sessionId = meta.id;
          const materializedKey = queueSessionKey(sessionId);
          if (!heldConnectKeys.has(materializedKey)) {
            const claims = connectingBySessionRef.current;
            if (claims.has(materializedKey)) return null;
            claims.delete(connectKey);
            heldConnectKeys.delete(connectKey);
            claims.add(materializedKey);
            heldConnectKeys.add(materializedKey);
          }
          if (
            migrateDraftSendClaim(
              h.sendInFlightBySessionRef.current,
              h.sendEpochBySessionRef.current,
              sessionId,
            )
          ) {
            h.sendInFlightRef.current =
              h.sendInFlightBySessionRef.current.size > 0;
          }
          const pendingSchema = h.sessionJsonSchemaRef.current?.trim() || "";
          if (
            pendingSchema &&
            isActiveJsonSchema(pendingSchema) &&
            api.isTauri()
          ) {
            try {
              const saved = await api.sessionSetJsonSchema(
                meta.id,
                pendingSchema,
              );
              const next =
                typeof saved.jsonSchema === "string" && saved.jsonSchema.trim()
                  ? saved.jsonSchema
                  : pendingSchema;
              h.setSessionJsonSchema(next);
            } catch {
              /* best-effort */
            }
          }
          const draftMsgs = h.messagesBySessionRef.current.get("__draft__");
          if (draftMsgs?.length) {
            h.messagesBySessionRef.current.set(meta.id, draftMsgs);
            h.messagesBySessionRef.current.delete("__draft__");
          }
          if (
            migrateDraftTurnClock(h.turnStartedAtBySessionRef.current, meta.id)
          ) {
            h.syncViewedTurnClock(meta.id);
          }
          if (api.isTauri() && connectProject?.path) {
            const linked = resolveSessionWorktreeBadge(
              null,
              connectProject.path,
              h.gitWorktrees,
            );
            if (linked?.path) {
              try {
                await api.sessionSetWorktree(meta.id, {
                  worktreePath: linked.path,
                  worktreeBranch: linked.branch,
                });
              } catch {
                /* soft-fail */
              }
            }
          }
          if (shouldAdoptView(originView, h.currentViewFocus(), meta.id)) {
            h.viewingSessionIdRef.current = meta.id;
            h.setSession((prev) => ({
              ...prev,
              sessionId: meta.id,
              title: meta.title || h.tr("session.new"),
            }));
            if (connectProject) {
              h.setActiveProject((prev) => prev ?? connectProject);
              h.setExpandedProjects((e) => ({
                ...e,
                [connectProject.id]: true,
              }));
            }
          }
          await h.refreshSessions();
        }
        const snap = await api.sessionConnect({
          projectPath:
            connectProject?.path || h.generalWorkspacePath || undefined,
          sessionId: sessionId ?? undefined,
          mode: h.mode,
        });
        h.setLiveHost(snap);
        h.liveHostRef.current = snap;
        if (
          snap.sessionId &&
          shouldAdoptView(originView, h.currentViewFocus(), snap.sessionId)
        ) {
          h.viewingSessionIdRef.current = snap.sessionId;
          h.setSession((prev) => ({
            ...snap,
            state: reconcileSessionState(snap.state, prev.state),
          }));
          h.setLiveMap((prev) =>
            projectHostIntoLiveMap(prev, {
              sessionId: snap.sessionId,
              state: snap.state,
              streamingMessageId: snap.streamingMessageId,
            }),
          );
        }
        if (snap.lastError || snap.state !== "ready") {
          const code = snap.lastError?.code ?? "AGENT_CRASHED";
          const msg = snap.lastError?.message ?? "connect failed";
          if (h.viewingSessionIdRef.current === (snap.sessionId || sessionId)) {
            h.setLocalError(`${code}: ${msg}`);
          }
          return null;
        }
        if (h.viewingSessionIdRef.current === (snap.sessionId || sessionId)) {
          h.setLocalError(null);
        }
        return snap.sessionId || sessionId || null;
      } catch (e) {
        if (
          (preferredId != null &&
            h.viewingSessionIdRef.current === preferredId) ||
          isSameView(originView, h.currentViewFocus())
        ) {
          h.setLocalError(String(e));
        }
        return null;
      } finally {
        releaseSessionConnection(heldConnectKeys);
        ensureConnectCountRef.current = Math.max(
          0,
          ensureConnectCountRef.current - 1,
        );
        syncEnsureConnectingUi();
      }
    },
    [
      claimSessionConnection,
      opts.hostRef,
      releaseSessionConnection,
      syncEnsureConnectingUi,
    ],
  );

  const retryAgentConnect = useCallback(() => {
    const h = opts.hostRef.current;
    const sid = h.viewingSessionIdRef.current ?? h.session.sessionId;
    h.setLocalError(null);
    void (async () => {
      if (h.session.state === "connecting" || h.connecting) {
        try {
          await api.sessionStop(sid);
        } catch {
          /* Host may not have bound ACP yet */
        }
      }
      const next = await ensureConnected({ force: true, sessionId: sid });
      if (next) h.setLocalError(null);
    })();
  }, [ensureConnected, opts.hostRef]);

  return {
    connecting,
    connectingRef,
    connectingBySessionRef,
    ensureConnectCountRef,
    liveMap,
    claimSessionConnection,
    releaseSessionConnection,
    syncEnsureConnectingUi,
    ensureConnected,
    retryAgentConnect,
  };
}

export function createSessionConnectHost(): SessionConnectHost {
  return emptyHost();
}
