import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { MessageKey } from "@/i18n";
import type { Project, SessionRow } from "@/lib/app/sidebarModels";
import type { ComposerPrefs } from "@/lib/api";
import type { CustomProvider } from "@/lib/api";
import * as api from "@/lib/api";
import type { ModelOption } from "@/lib/grokCatalog";
import { GROK_BUILD_MODELS } from "@/lib/grokCatalog";
import type {
  AskUserPayload,
  ChatMessage,
  PermissionPayload,
  SessionSnapshot,
} from "@/lib/session";
import { IDLE_SNAPSHOT } from "@/lib/session";
import {
  automationReuseSessionId,
  computeNextRunAt,
  resolveAutomationReuseRow,
  type Automation,
} from "@/lib/automations";
import {
  effectiveAutomationProviderId,
  officialAutomationModelIds,
} from "@/lib/automationModelRoute";
import { recordAutomationRun } from "@/lib/automationRunHistory";
import { recordAutomationBusySkip, useAutomationRunFailure } from "@/hooks/useAutomationRunFailure";
import type { SessionNavHost } from "@/hooks/useSessionNavigation";
import type { useComposerController } from "@/hooks/useComposerController";
import { isProjectFolderMissing } from "@/lib/projectPath";
import { sessionTranscriptStore } from "@/lib/sessionTranscriptStore";

/** Composer state the run-now flow resets before creating a fresh chat. */
type ComposerSetters = Pick<
  ReturnType<typeof useComposerController>,
  "setDraft" | "setAttachments" | "setQuotes"
>;

/** Everything the run-now flow needs from the workbench shell. */
export interface AutomationRunNowContext {
  projects: Project[];
  sessions: SessionRow[];
  availableModels: ModelOption[];
  customProviders: CustomProvider[];
  generalWorkspacePath: string | null;
  tr: (key: MessageKey, vars?: Record<string, string | number>) => string;
  applyComposerPrefs: (prefs: ComposerPrefs, catalog: ModelOption[]) => void;
  setLocalError: (message: string | null) => void;
  setMainPane: (pane: "chat" | "automations" | "kanban") => void;
  closeSettings: () => void;
  setActiveProject: (project: Project | null) => void;
  setExpandedProjects: (
    update: (expanded: Record<string, boolean>) => Record<string, boolean>,
  ) => void;
  setHistoryOpen: (open: boolean) => void;
  invalidateOpenPipelines: () => void;
  bumpViewEpoch: () => void;
  composer: ComposerSetters;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setPerm: Dispatch<SetStateAction<PermissionPayload | null>>;
  setAskUser: Dispatch<SetStateAction<AskUserPayload | null>>;
  setRetryStatus: (value: null) => void;
  setSession: Dispatch<SetStateAction<SessionSnapshot>>;
  setLiveHost: (snapshot: SessionSnapshot) => void;
  refreshSessions: () => Promise<void>;
  openSessionRef: MutableRefObject<
    (session: SessionRow, project?: Project | null) => Promise<void>
  >;
  openingSessionIdRef: MutableRefObject<string | null>;
  viewingSessionIdRef: MutableRefObject<string | null>;
  liveHostRef: MutableRefObject<SessionSnapshot>;
  messagesBySessionRef: MutableRefObject<Map<string, ChatMessage[]>>;
  sessionNavHostRef: MutableRefObject<SessionNavHost>;
}

/**
 * Run a scheduled automation now: open its chat, connect, apply the stored
 * route, and send the prompt.
 * @returns true when the prompt was handed to the agent (mark_run applied).
 */
export function useAutomationRunNow(
  context: AutomationRunNowContext,
): (auto: Automation) => Promise<boolean> {
  const ctxRef = useRef(context);
  useEffect(() => {
    ctxRef.current = context;
  }, [context]);
  const automationRunLockRef = useRef(false);
  const failAutomationRun = useAutomationRunFailure(context.setLocalError);

  return useCallback(
    async (auto: Automation): Promise<boolean> => {
      const {
        projects,
        sessions,
        availableModels,
        customProviders,
        generalWorkspacePath,
        tr,
        applyComposerPrefs,
        setLocalError,
        setMainPane,
        closeSettings,
        setActiveProject,
        setExpandedProjects,
        setHistoryOpen,
        invalidateOpenPipelines,
        bumpViewEpoch,
        composer,
        setMessages,
        setPerm,
        setAskUser,
        setRetryStatus,
        setSession,
        setLiveHost,
        refreshSessions,
        openSessionRef,
        openingSessionIdRef,
        viewingSessionIdRef,
        liveHostRef,
        messagesBySessionRef,
        sessionNavHostRef,
      } = ctxRef.current;
      if (automationRunLockRef.current) {
        // Soft skip — do not invent a fire; only note busy contention.
        return recordAutomationBusySkip(auto);
      }
      automationRunLockRef.current = true;
      let createdSessionId: string | null = null;
      try {
        const reuseId = automationReuseSessionId(auto);
        // The local list can lag behind another window. Confirm with the host
        // before treating the configured chat as deleted.
        const reusedRow = await resolveAutomationReuseRow(
          reuseId,
          sessions,
          api.isTauri() ? api.sessionsList : undefined,
        );
        const proj = reusedRow
          ? (projects.find((p) => p.id === reusedRow.projectId) ?? null)
          : auto.projectId
            ? (projects.find((p) => p.id === auto.projectId) ?? null)
            : null;
        if (proj && !proj.trusted) {
          return failAutomationRun(
            auto,
            tr("project.trustFirst", { name: proj.name }),
          );
        }
        if (proj && isProjectFolderMissing(proj)) {
          return failAutomationRun(
            auto,
            tr("project.pathMissing", { name: proj.name }),
          );
        }
        setMainPane("chat");
        closeSettings();
        if (reusedRow) {
          // Show the configured chat first; its journal stays intact.
          await openSessionRef.current(reusedRow, proj);
        } else {
          setActiveProject(proj);
          if (proj) {
            setExpandedProjects((e) => ({ ...e, [proj.id]: true }));
          } else {
            setHistoryOpen(true);
          }
          openingSessionIdRef.current = null;
          invalidateOpenPipelines();
          bumpViewEpoch();
          viewingSessionIdRef.current = null;
          sessionTranscriptStore.setViewingSessionId(null);
          sessionTranscriptStore.clearJournalLoad();
          setMessages([]);
          composer.setAttachments([]);
          composer.setQuotes([]);
          setPerm(null);
          setAskUser(null);
          setRetryStatus(null);
          setLocalError(null);
          composer.setDraft("");
          setSession({
            ...IDLE_SNAPSHOT,
            sessionId: null,
            title: auto.title || tr("session.new"),
            state: "idle",
            backend: "grok_agent_stdio",
          });
          {
            const idle = { ...IDLE_SNAPSHOT };
            setLiveHost(idle);
            liveHostRef.current = idle;
          }
          if (api.isTauri()) {
            try {
              await api.sessionDisconnect();
            } catch {
              /* ignore */
            }
          }
        }

        let sessionId: string | null = reusedRow?.id ?? null;
        if (!sessionId && api.isTauri()) {
          const meta = (await api.sessionCreate(
            proj?.id,
            auto.title || tr("session.new"),
            { scheduled: true },
          )) as { id: string; title?: string; scheduled?: boolean };
          sessionId = meta.id;
          createdSessionId = meta.id;
          viewingSessionIdRef.current = meta.id;
          setSession((prev) => ({
            ...prev,
            sessionId: meta.id,
            title: meta.title || auto.title,
          }));
          await refreshSessions();
        }

        // Persist provider/model/effort for this session before connect when
        // possible. A reused chat keeps its own model, reasoning and route.
        const runProviderId = effectiveAutomationProviderId(
          auto,
          officialAutomationModelIds(availableModels, GROK_BUILD_MODELS),
          customProviders,
        );
        if (
          !reusedRow &&
          proj?.sshAlias &&
          runProviderId &&
          runProviderId !== "official"
        ) {
          if (createdSessionId && api.isTauri()) {
            try {
              await api.sessionDelete(createdSessionId);
              await refreshSessions();
            } catch {
              /* ignore */
            }
          }
          return failAutomationRun(auto, tr("automations.errSshOfficial"));
        }
        if (
          sessionId &&
          !reusedRow &&
          api.isTauri() &&
          (auto.modelId || auto.effort || runProviderId)
        ) {
          try {
            await api.composerPrefsSet({
              sessionId,
              projectId: proj?.id ?? null,
              modelId: auto.modelId,
              effort: auto.effort,
              providerId: runProviderId ?? undefined,
            });
          } catch (e) {
            if (createdSessionId && api.isTauri()) {
              try {
                await api.sessionDelete(createdSessionId);
                await refreshSessions();
              } catch {
                /* ignore */
              }
            }
            return failAutomationRun(auto, String(e));
          }
        }

        const claimed = sessionId
          ? sessionNavHostRef.current.connect.claim(sessionId)
          : false;
        let snap;
        try {
          snap = await api.sessionConnect({
            projectPath: proj?.path || generalWorkspacePath || undefined,
            sessionId: sessionId ?? undefined,
            mode: "agent",
            sshAlias: proj?.sshAlias ?? null,
          });
        } finally {
          if (claimed && sessionId) {
            sessionNavHostRef.current.connect.release(sessionId);
          }
        }
        setLiveHost(snap);
        liveHostRef.current = snap;
        if (snap.sessionId) {
          viewingSessionIdRef.current = snap.sessionId;
          sessionId = snap.sessionId;
        }
        setSession({
          ...snap,
          title: snap.title || auto.title || snap.title,
        });
        if (snap.lastError || snap.state !== "ready") {
          const detail = `${snap.lastError?.code ?? "AGENT_CRASHED"}: ${snap.lastError?.message ?? "connect failed"}`;
          // Drop empty shell sessions so the sidebar does not show ghosts.
          if (createdSessionId && api.isTauri()) {
            try {
              await api.sessionDelete(createdSessionId);
              await refreshSessions();
            } catch {
              /* ignore */
            }
            if (viewingSessionIdRef.current === createdSessionId) {
              viewingSessionIdRef.current = null;
              setSession({ ...IDLE_SNAPSHOT, state: "idle" });
            }
          }
          return failAutomationRun(
            auto,
            tr("automations.connectFailed", { detail }),
          );
        }

        if (sessionId && !reusedRow && auto.modelId && api.isTauri()) {
          try {
            const prefs = await api.sessionSetModel(auto.modelId, {
              sessionId,
              projectId: proj?.id ?? null,
            });
            // The agent switch is async; reflect it in the open composer at
            // once so "Run now" does not look like it kept the default model.
            if (prefs && viewingSessionIdRef.current === sessionId) {
              applyComposerPrefs(prefs, availableModels);
            }
          } catch {
            /* soft-fail */
          }
        }

        const promptBody = `[Scheduled: ${auto.title}]\n\n${auto.prompt}`;
        const autoMsgs: ChatMessage[] = [
          {
            id: `u-auto-${Date.now()}`,
            role: "user",
            content: promptBody,
            createdAt: new Date().toISOString(),
          },
        ];
        if (!reusedRow) {
          if (sessionId) {
            messagesBySessionRef.current.set(sessionId, autoMsgs);
          }
          setMessages(autoMsgs);
        }
        setSession((prev) => ({
          ...prev,
          state: "streaming",
          lastError: null,
          title: reusedRow ? prev.title : auto.title || prev.title,
        }));

        try {
          await api.sessionSend(promptBody, null, sessionId);
        } catch (sendErr) {
          const errText = String(sendErr);
          const failed: ChatMessage[] = [
            ...(reusedRow ? sessionTranscriptStore.getMessages() : autoMsgs),
            {
              id: `err-auto-${Date.now()}`,
              role: "assistant",
              content: errText,
              isError: true,
              createdAt: new Date().toISOString(),
            },
          ];
          if (sessionId) {
            messagesBySessionRef.current.set(sessionId, failed);
          }
          setSession((prev) =>
            prev.sessionId === sessionId
              ? { ...prev, state: "ready" }
              : prev,
          );
          return failAutomationRun(auto, errText);
        }

        // The configured chat was gone and we created a replacement. Write
        // back only the target, and only while the schedule still points at
        // the missing chat, so a mid-run edit wins.
        if (reuseId && !reusedRow && sessionId && api.isTauri()) {
          try {
            await api.automationRebindReuseSession(auto.id, reuseId, sessionId);
          } catch {
            /* soft-fail: a later run will retry the fallback */
          }
        }

        const lastRunAt = new Date().toISOString();
        const nextRunAt =
          auto.frequency === "once"
            ? null
            : computeNextRunAt(
                { ...auto, enabled: auto.frequency !== "once" },
                new Date(Date.now() + 60_000),
              );
        await api.automationMarkRun(auto.id, lastRunAt, nextRunAt);
        if (auto.frequency === "once") {
          await api.automationSetEnabled(auto.id, false);
        }
        recordAutomationRun({
          scheduleId: auto.id,
          name: auto.title,
          outcome: "ok",
          source: "run_now",
          at: lastRunAt,
        });
        return true;
      } catch (e) {
        return failAutomationRun(auto, String(e));
      } finally {
        automationRunLockRef.current = false;
      }
    },
    [failAutomationRun],
  );
}
