/**
 * Composer send path: executeSend, submit, and post-submit draft clear.
 * Host remains the composition root for composer chrome. Connect/live map
 * live in useSessionConnect; settings prefs in useAppSettingsPrefs.
 */
import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import { serializeDom } from "@/components/ComposerEditor";
import { createT } from "@/i18n";
import * as api from "@/lib/api";
import type { AppDialog } from "@/lib/app/appDialogTypes";
import type { Project, SessionRow } from "@/lib/app/sidebarModels";
import { buildAgentPrompt, type Attachment } from "@/lib/attachments";
import {
  wrapAutomationSetupAgentText,
  looksLikeScheduleIntent,
  looksLikeScheduleUpdateIntent,
} from "@/lib/automationSetup";
import {
  addChatRef,
  lookupChatTitle,
  parseChatTokens,
  prependChatTokens,
  stripChatTokens,
  type ChatRef,
} from "@/lib/chatAttach";
import {
  clearComposerProjectDraft,
  loadComposerProjectDraft,
  projectDraftKey,
  saveComposerProjectDraft,
} from "@/lib/composerProjectDraft";
import {
  appendQuotesToContent,
  serializeQuotesForAgent,
  type ComposerQuote,
} from "@/lib/composerQuotes";
import {
  clearComposerSessionDraft,
  loadComposerSessionDraft,
  saveComposerSessionDraft,
} from "@/lib/composerSessionDraft";
import {
  nextComposerSubmitSettlement,
  shouldClearMatchingProjectDraft,
  shouldClearProjectDraftAfterNewChatSend,
} from "@/lib/composerSubmitClear";
import {
  isDraftEmpty,
  parseStoredContent,
  serializeForAgent,
} from "@/lib/draftDoc";
import { pluginSkillsMap, type SkillInfo } from "@/lib/slashCatalog";
import { countDraftChars } from "@/lib/draftStats";
import {
  isActiveJsonSchema,
  wrapAgentTextWithJsonSchema,
} from "@/lib/jsonSchema";
import { canLiveParticipate } from "@/lib/multiWindow";
import { recordRecentPrompt } from "@/lib/recentPromptHistory";
import { queueSessionKey, shouldEnqueueSend } from "@/lib/sendQueue";
import {
  clearPriorTurnStreaming,
  isSessionNotLiveError,
  isTurnCancelledError,
  type ChatMessage,
  type SessionSnapshot,
} from "@/lib/session";
import {
  projectHostIntoLiveMap,
  type SessionLiveMap,
} from "@/lib/sessionLiveStore";
import { migrateDraftTurnClock, resolveTurnClockKey } from "@/lib/turnClock";
import {
  isViewingSendTarget,
  resolveComposerSendSessionId,
  type ViewFocus,
} from "@/lib/viewFocus";
import { classifyWorkflowSlashLine } from "@/lib/workflowSlash";
import type { ExecuteSendFromQueue } from "@/hooks/useSendQueue";

type TFn = ReturnType<typeof createT>;

export type ExecuteSendOpts = {
  storedDisplay: string;
  att: Attachment[];
  quotes?: ComposerQuote[];
  goalMode: boolean;
  fromQueue?: boolean;
  targetSessionId?: string | null;
  agentTextOverride?: string;
};

export type ComposerSendQueueApi = {
  migrateDraft: (sessionId: string) => void;
  releaseFlushHold: () => void;
  enqueue: (input: {
    storedDisplay: string;
    attachments: Attachment[];
    quotes?: ComposerQuote[];
    goalMode: boolean;
  }) => unknown;
};

export type ComposerSendHost = {
  tr: TFn;
  session: SessionSnapshot;
  sessions: SessionRow[];
  activeProject: Project | null;
  connecting: boolean;
  goalMode: boolean;
  attachments: Attachment[];
  chatAttachments: ChatRef[];
  quotes: ComposerQuote[];
  skillInfos: SkillInfo[];
  editSubmitting: boolean;
  editingUserMessageId: string | null;
  isPlaceholderTitle: (title: string | undefined | null) => boolean;
  isSecondaryWindowRef: MutableRefObject<boolean>;
  viewingSessionIdRef: MutableRefObject<string | null>;
  composerInputRef: RefObject<HTMLElement | null>;
  liveHostRef: MutableRefObject<SessionSnapshot>;
  messagesBySessionRef: MutableRefObject<Map<string, ChatMessage[]>>;
  sessionJsonSchemaRef: MutableRefObject<string | null>;
  automationSetupDraftRef: MutableRefObject<boolean>;
  automationSetupSessionsRef: MutableRefObject<Set<string>>;
  sendInFlightRef: MutableRefObject<boolean>;
  sendInFlightBySessionRef: MutableRefObject<Set<string>>;
  sendEpochRef: MutableRefObject<number>;
  sendEpochBySessionRef: MutableRefObject<Map<string, number>>;
  turnStartedAtBySessionRef: MutableRefObject<Map<string, number>>;
  prefsApplyRef: MutableRefObject<Promise<void>>;
  promptHistoryIndexRef: MutableRefObject<number | null>;
  quotesRef: MutableRefObject<ComposerQuote[]>;
  attachmentsRef: MutableRefObject<Attachment[]>;
  sendQueueRef: MutableRefObject<ComposerSendQueueApi | null>;
  showToastRef: MutableRefObject<(msg: string, ms?: number) => void>;
  sendRef: MutableRefObject<(() => Promise<void>) | null>;
  executeSendFromQueueRef: MutableRefObject<ExecuteSendFromQueue>;
  executeSendLatestRef: MutableRefObject<(opts: ExecuteSendOpts) => Promise<boolean>>;
  claimSendForSession: (sessionId: string | null | undefined) => boolean;
  /** Drop a post-Stop force_idle latch so the new turn can show Stop again. */
  clearStopLatch: () => void;
  currentViewFocus: () => ViewFocus;
  patchSessionMessages: (
    targetSessionId: string | undefined | null,
    reduce: (prev: ChatMessage[]) => ChatMessage[],
  ) => void;
  ensureConnected: (
    forceOrOpts?: boolean | { force?: boolean; sessionId?: string | null },
  ) => Promise<string | null>;
  getDraft: () => string;
  requestComposerFocus: () => void;
  openWorkflowsSettings: () => void;
  applySessionTitle: (sessionId: string, title: string) => void;
  restartTurnClock: (sessionId?: string | null, at?: number) => void;
  syncViewedTurnClock: (sessionId: string) => void;
  setLocalError: (msg: string | null) => void;
  setSession: Dispatch<SetStateAction<SessionSnapshot>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setLiveHost: Dispatch<SetStateAction<SessionSnapshot>>;
  setLiveMap: Dispatch<SetStateAction<SessionLiveMap>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setQuotes: Dispatch<SetStateAction<ComposerQuote[]>>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setChatAttachments: Dispatch<SetStateAction<ChatRef[]>>;
  setAttachChatOpen: Dispatch<SetStateAction<boolean>>;
  setSlashQuery: Dispatch<SetStateAction<any>>;
  setPromptHistoryIndex: Dispatch<SetStateAction<number | null>>;
  setPromptHistoryOpen: Dispatch<SetStateAction<boolean>>;
  setPromptHistoryFilter: Dispatch<SetStateAction<string>>;
  setPromptHistoryActive: Dispatch<SetStateAction<number>>;
  setPromptHistoryFocusFilter: Dispatch<SetStateAction<boolean>>;
  setPromptHistoryScope: Dispatch<SetStateAction<any>>;
  setEditingUserMessageId: Dispatch<SetStateAction<string | null>>;
  setEditAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setRetryStatus: (
    next: {
      attempt: number;
      maxRetries: number;
      reason: string;
      aborting?: boolean;
    } | null,
  ) => void;
  setRecentPromptHistory: Dispatch<SetStateAction<any>>;
  setAppDialog: Dispatch<SetStateAction<AppDialog | null>>;
};

export function useComposerSend(host: ComposerSendHost) {
  const {
    tr,
    session,
    sessions,
    activeProject,
    connecting,
    goalMode,
    attachments,
    chatAttachments,
    quotes,
    skillInfos,
    editSubmitting,
    editingUserMessageId,
    isPlaceholderTitle,
    isSecondaryWindowRef,
    viewingSessionIdRef,
    composerInputRef,
    liveHostRef,
    messagesBySessionRef,
    sessionJsonSchemaRef,
    automationSetupDraftRef,
    automationSetupSessionsRef,
    sendInFlightRef,
    sendInFlightBySessionRef,
    sendEpochRef,
    sendEpochBySessionRef,
    turnStartedAtBySessionRef,
    prefsApplyRef,
    promptHistoryIndexRef,
    quotesRef,
    attachmentsRef,
    sendQueueRef,
    showToastRef,
    sendRef,
    executeSendFromQueueRef,
    executeSendLatestRef,
    claimSendForSession,
    clearStopLatch,
    currentViewFocus,
    patchSessionMessages,
    ensureConnected,
    getDraft,
    requestComposerFocus,
    openWorkflowsSettings,
    applySessionTitle,
    restartTurnClock,
    syncViewedTurnClock,
    setLocalError,
    setSession,
    setMessages,
    setLiveHost,
    setLiveMap,
    setDraft,
    setQuotes,
    setAttachments,
    setChatAttachments,
    setAttachChatOpen,
    setSlashQuery,
    setPromptHistoryIndex,
    setPromptHistoryOpen,
    setPromptHistoryFilter,
    setPromptHistoryActive,
    setPromptHistoryFocusFilter,
    setPromptHistoryScope,
    setEditingUserMessageId,
    setEditAttachments,
    setRetryStatus,
    setRecentPromptHistory,
    setAppDialog,
  } = host;

/**
 * Dispatch one user turn (optimistic UI + connect + session_send).
 * @param targetSessionId When set (queue flush), bind optimistic UI to this id.
 * @param fromQueue Drop user+assistant on failure so requeue does not duplicate.
 */
const executeSend = async (opts: {
  storedDisplay: string;
  att: Attachment[];
  quotes?: ComposerQuote[];
  goalMode: boolean;
  fromQueue?: boolean;
  targetSessionId?: string | null;
  agentTextOverride?: string;
}): Promise<boolean> => {
  // Session-keyed pool: secondary may send via shared Host (session-targeted).
  if (!canLiveParticipate(isSecondaryWindowRef.current)) {
    setLocalError(tr("session.secondaryLiveBanner"));
    return false;
  }
  const { storedDisplay, att, goalMode: useGoal, fromQueue } = opts;
  const quotesForSend = opts.quotes ?? [];
  // 模型/思考等级的落盘可能与发送并发，等它落盘再启动本轮 agent。
  if (!fromQueue) await prefsApplyRef.current;
  const segments = parseStoredContent(storedDisplay);
  if (isDraftEmpty(segments) && !att.length && !quotesForSend.length) {
    sendInFlightRef.current = false;
    return false;
  }
  const journalDisplay = appendQuotesToContent(storedDisplay, quotesForSend);
  // Resolve the target before claiming so the lock is scoped to the chat
  // that will actually receive the prompt (drafts use a stable sentinel).
  const sendTargetId =
    opts.targetSessionId !== undefined
      ? opts.targetSessionId
      : resolveComposerSendSessionId({
          viewingSessionId: viewingSessionIdRef.current,
          shellSessionId: session.sessionId,
        });
  const sendKey = queueSessionKey(sendTargetId);
  if (!claimSendForSession(sendTargetId)) return false;
  // A prior Stop may still be holding force_idle (Host lag). New turn owns Stop/Send.
  clearStopLatch();
  const heldSendKeys = new Set<string>([sendKey]);
  const sendEpoch = (sendEpochBySessionRef.current.get(sendKey) ?? 0) + 1;
  sendEpochBySessionRef.current.set(sendKey, sendEpoch);
  sendEpochRef.current += 1;
  const sendEpochCurrent = () =>
    [...heldSendKeys].every(
      (key) => sendEpochBySessionRef.current.get(key) === sendEpoch,
    );
  // Prefer viewing id over shell sessionId — openSession points viewing at
  // the new chat before journal load finishes setSession; using only shell
  // mis-routed sends into the previous (often stuck) chat.
  const cacheKey = sendTargetId ?? "__draft__";
  // Draft sends have no id to compare, so pin them to the view they came from:
  // otherwise the optimistic bubbles / streaming state paint whatever *new*
  // draft the user opened in the meantime.
  const originView = currentViewFocus();
  const viewingTarget = () =>
    isViewingSendTarget(originView, currentViewFocus(), sendTargetId);

  const pluginSkills = pluginSkillsMap(skillInfos);
  const agentBody = serializeQuotesForAgent(
    quotesForSend,
    serializeForAgent(segments, { goalMode: useGoal, pluginSkills }),
  );
  let agentText = opts.agentTextOverride?.trim()
    ? opts.agentTextOverride
    : buildAgentPrompt(agentBody, att);
  const schemaForSend = sessionJsonSchemaRef.current?.trim() || "";
  if (schemaForSend && isActiveJsonSchema(schemaForSend)) {
    agentText = wrapAgentTextWithJsonSchema(agentText, schemaForSend);
  }
  // Intent from user-visible body only (not /goal prefix or attachment paths).
  const userIntentText = serializeForAgent(segments, { pluginSkills }).trim();
  const explicitAutomationSticky =
    automationSetupDraftRef.current ||
    (!!sendTargetId &&
      automationSetupSessionsRef.current.has(sendTargetId));
  // Goal mode is finite objective work — do not silently enter schedule setup
  // unless the user opened “用 AI 创建” (sticky) for this session.
  const scheduleIntent =
    !useGoal &&
    (looksLikeScheduleIntent(userIntentText) ||
      looksLikeScheduleUpdateIntent(userIntentText));
  const inAutomationSetup = explicitAutomationSticky || scheduleIntent;
  if (inAutomationSetup) {
    agentText = wrapAutomationSetupAgentText(agentText);
  }
  const titleSeed =
    serializeForAgent(segments, { pluginSkills }).replace(/\n/g, " ").trim() ||
    quotesForSend[0]?.text.replace(/\n/g, " ").trim() ||
    att.map((a) => a.name).join(", ");
  const shouldAutoTitle =
    isPlaceholderTitle(session.title) || !sendTargetId;
  const ts = Date.now();
  const userMessageId = `u-${ts}`;
  const pendingAssistantId = `a-pending-${ts}`;
  const dropIds = fromQueue
    ? new Set([userMessageId, pendingAssistantId])
    : new Set([pendingAssistantId]);
  const stripOptimistic = (m: ChatMessage[]) =>
    m.filter((x) => !dropIds.has(x.id));

  if (editingUserMessageId) {
    setEditingUserMessageId(null);
    setEditAttachments([]);
  }

  if (viewingTarget()) setRetryStatus(null);
  const nowIso = new Date().toISOString();
  const appendOptimistic = (m: ChatMessage[]): ChatMessage[] => {
    const cleaned = clearPriorTurnStreaming(m);
    return [
      ...cleaned,
      {
        id: userMessageId,
        role: "user",
        content: journalDisplay,
        attachments: att.length ? att : undefined,
        createdAt: nowIso,
      },
      {
        id: pendingAssistantId,
        role: "assistant",
        content: "",
        streaming: true,
        createdAt: nowIso,
      },
    ];
  };
  if (sendTargetId) {
    patchSessionMessages(sendTargetId, appendOptimistic);
  } else if (viewingTarget()) {
    setMessages((m) => {
      const next = appendOptimistic(m);
      messagesBySessionRef.current.set(cacheKey, next);
      return next;
    });
  } else {
    const prev = messagesBySessionRef.current.get(cacheKey) ?? [];
    messagesBySessionRef.current.set(cacheKey, appendOptimistic(prev));
  }
  if (viewingTarget()) {
    setSession((prev) =>
      prev.state === "streaming" || prev.state === "awaiting_permission"
        ? prev
        : { ...prev, state: "streaming", lastError: null },
    );
    restartTurnClock(
      resolveTurnClockKey(
        sendTargetId ?? viewingSessionIdRef.current,
      ),
    );
  }
  // Optimistic liveHost only when we already own the live slot (or nothing is live).
  // Never stamp streaming onto a foreign mid-turn — ensureConnected demotes first.
  setLiveHost((prev) => {
    if (prev.sessionId) {
      if (sendTargetId && prev.sessionId !== sendTargetId) return prev;
      // Draft / null target while another session is live → leave Host alone.
      if (!sendTargetId && prev.sessionId) return prev;
    }
    const next = {
      ...prev,
      sessionId: sendTargetId ?? prev.sessionId,
      state: "streaming" as const,
      lastError: null,
    };
    liveHostRef.current = next;
    return next;
  });

  const failStrip = () => {
    if (sendTargetId) {
      patchSessionMessages(sendTargetId, stripOptimistic);
    } else {
      const draftMsgs = messagesBySessionRef.current.get("__draft__");
      if (draftMsgs) {
        messagesBySessionRef.current.set(
          "__draft__",
          stripOptimistic(draftMsgs),
        );
      }
      if (viewingTarget()) setMessages((m) => stripOptimistic(m));
    }
    if (viewingTarget()) {
      setSession((prev) =>
        prev.state === "streaming"
          ? { ...prev, state: prev.sessionId ? "ready" : prev.state }
          : prev,
      );
    }
    // Symmetric rollback of optimistic liveHost streaming — otherwise
    // useSendQueue.flush sees streaming forever and auto-flush starves.
    // Mirror the optimistic guard: never rewind a foreign mid-turn we did not claim.
    setLiveHost((prev) => {
      if (prev.sessionId) {
        if (sendTargetId && prev.sessionId !== sendTargetId) return prev;
        if (!sendTargetId && prev.sessionId) return prev;
      }
      if (prev.state !== "streaming") return prev;
      const next = {
        ...prev,
        state: (prev.sessionId ? "ready" : "idle") as SessionSnapshot["state"],
      };
      liveHostRef.current = next;
      return next;
    });
  };

  try {
    let sessionId: string | null = null;
    const live = liveHostRef.current;
    if (
      sendTargetId &&
      live.sessionId === sendTargetId &&
      live.state === "ready" &&
      !live.lastError
    ) {
      sessionId = sendTargetId;
    } else if (
      fromQueue &&
      sendTargetId &&
      viewingSessionIdRef.current !== sendTargetId
    ) {
      failStrip();
      return false;
    } else {
      sessionId = await ensureConnected({ sessionId: sendTargetId });
    }
    if (!sessionId) {
      failStrip();
      return false;
    }
    // ensureConnected can paint Host Ready between connect and sessionSend.
    // Re-assert busy so the composer keeps Stop with no gap.
    if (viewingTarget()) {
      setSession((prev) =>
        prev.state === "streaming"
          ? prev.sessionId === sessionId
            ? prev
            : { ...prev, sessionId }
          : {
              ...prev,
              sessionId,
              state: "streaming",
              lastError: null,
            },
      );
    }
    setLiveHost((prev) => {
      if (prev.sessionId && prev.sessionId !== sessionId) return prev;
      if (prev.state === "streaming" && prev.sessionId === sessionId) return prev;
      const next = {
        ...prev,
        sessionId,
        state: "streaming" as SessionSnapshot["state"],
        lastError: null,
      };
      liveHostRef.current = next;
      return next;
    });
    setLiveMap((prev) =>
      projectHostIntoLiveMap(prev, {
        sessionId,
        state: "streaming",
        streamingMessageId: null,
      }),
    );
    // Draft sends materialize a real id during ensureConnected. Atomically
    // migrate the claim so a second call targeting the new id cannot slip
    // through, while a newly opened draft remains independent.
    const materializedSendKey = queueSessionKey(sessionId);
    if (!heldSendKeys.has(materializedSendKey)) {
      const claims = sendInFlightBySessionRef.current;
      const alreadyOurs =
        claims.has(materializedSendKey) &&
        sendEpochBySessionRef.current.get(materializedSendKey) ===
          sendEpoch;
      if (claims.has(materializedSendKey) && !alreadyOurs) {
        failStrip();
        return false;
      }
      claims.delete(sendKey);
      heldSendKeys.delete(sendKey);
      if (sendEpochBySessionRef.current.get(sendKey) === sendEpoch) {
        sendEpochBySessionRef.current.delete(sendKey);
      }
      if (!alreadyOurs) {
        claims.add(materializedSendKey);
        sendEpochBySessionRef.current.set(materializedSendKey, sendEpoch);
      }
      heldSendKeys.add(materializedSendKey);
    }
    if (fromQueue && sendTargetId && sessionId !== sendTargetId) {
      failStrip();
      return false;
    }
    // Bind draft message cache to the real id early (Host already materialized).
    // Queue migrate waits until sessionSend succeeds so a failed flush can
    // requeue under the original claim key (`__draft__`) without splitting.
    if (!sendTargetId) {
      const draftMsgs = messagesBySessionRef.current.get("__draft__");
      if (draftMsgs?.length) {
        messagesBySessionRef.current.set(sessionId, draftMsgs);
        messagesBySessionRef.current.delete("__draft__");
      }
      if (migrateDraftTurnClock(turnStartedAtBySessionRef.current, sessionId)) {
        syncViewedTurnClock(sessionId);
      }
    }
    // Sticky setup only for explicit “用 AI 创建”, so a one-off “每天…” line
    // does not force every later message in the chat into automation mode.
    if (automationSetupDraftRef.current) {
      automationSetupSessionsRef.current.add(sessionId);
      automationSetupDraftRef.current = false;
    }
    if (
      fromQueue &&
      sendTargetId &&
      liveHostRef.current.sessionId &&
      liveHostRef.current.sessionId !== sendTargetId
    ) {
      failStrip();
      return false;
    }
    // Bind the turn to `sessionId`, never to "whatever is live". Host
    // re-focuses that chat (background/parked → live) before prompting, so a
    // warm connect racing this send cannot deliver it to another chat — and
    // a mid-send "new chat" still lets this turn complete.
    try {
      await api.sessionSend(agentText, journalDisplay, sessionId, att);
    } catch (sendErr) {
      // Stop / stall during Host vision/prepare: prompt never left.
      // Do not retry and do not treat as CONNECT_FAILED (P0-2).
      if (isTurnCancelledError(sendErr)) {
        // Journal already has the user row; drop only the empty assistant shell.
        if (sendTargetId) {
          patchSessionMessages(sendTargetId, (m) =>
            m.filter((x) => x.id !== pendingAssistantId),
          );
        } else if (viewingTarget()) {
          setMessages((m) => m.filter((x) => x.id !== pendingAssistantId));
        }
        if (viewingTarget()) {
          setSession((prev) =>
            prev.state === "streaming"
              ? { ...prev, state: prev.sessionId ? "ready" : prev.state }
              : prev,
          );
        }
        setLiveMap((prev) =>
          projectHostIntoLiveMap(prev, {
            sessionId,
            state: "ready",
            streamingMessageId: null,
          }),
        );
        return true;
      }
      // Host refuses rather than misroute when the chat lost its process
      // (idle recycle / crash while `liveHost` still looked ready).
      // Cold-connect that chat once, then retry the same turn.
      if (!isSessionNotLiveError(sendErr)) throw sendErr;
      if (!sendEpochCurrent()) return false;
      const reconnected = await ensureConnected({
        sessionId,
        force: true,
      });
      if (reconnected !== sessionId) throw sendErr;
      if (!sendEpochCurrent()) return false;
      await api.sessionSend(agentText, journalDisplay, sessionId, att);
    }
    // Ghost heal / newer send superseded this await — do not re-dirty UI.
    if (!sendEpochCurrent()) return false;
    // Keep liveMap busy for this session if the user already left the thread.
    setLiveMap((prev) =>
      projectHostIntoLiveMap(prev, {
        sessionId,
        state: "streaming",
        streamingMessageId: null,
      }),
    );
    // Only after a successful send: move remaining draft follow-ups onto the
    // real session. If this threw, claim requeues under `__draft__` intact.
    if (!sendTargetId) {
      sendQueueRef.current!.migrateDraft(sessionId);
    }
    // Cross-session recent prompts (localStorage ring, max 50).
    // Store display form so chips/skill tokens rehydrate in the composer.
    if (storedDisplay.trim()) {
      setRecentPromptHistory(
        recordRecentPrompt({
          text: storedDisplay,
          sessionId,
          at: nowIso,
        }),
      );
    }
    // `session.autoTitle` is on the mirror allowlist, so phone chats get a
    // real title instead of staying on the "new chat" placeholder forever.
    if (shouldAutoTitle && api.hasHost()) {
      void api
        .sessionAutoTitle(sessionId, titleSeed)
        .then((meta) => {
          if (meta?.title) applySessionTitle(sessionId, meta.title);
        })
        .catch(() => {
          /* ignore */
        });
    }
    return true;
  } catch (e) {
    if (!sendEpochCurrent()) return false;
    failStrip();
    if (viewingTarget()) setLocalError(String(e));
    return false;
  } finally {
    for (const key of heldSendKeys) {
      // A ghost-heal or newer send may already own this session key. An old
      // await must not release that newer claim when it finally settles.
      if (sendEpochBySessionRef.current.get(key) !== sendEpoch) continue;
      sendInFlightBySessionRef.current.delete(key);
      sendEpochBySessionRef.current.delete(key);
    }
    sendInFlightRef.current = sendInFlightBySessionRef.current.size > 0;
  }
};

const persistComposerSubmitClear = (opts?: {
  clearProjectDraft?: boolean;
  clearSessionDraft?: boolean;
  sessionDraftId?: string | null;
  sentText?: string;
  sentAttachments?: Attachment[];
  sentQuotes?: ComposerQuote[];
}) => {
  const projectKey = projectDraftKey(activeProject?.id ?? null);
  const savedProjectDraft = loadComposerProjectDraft(projectKey);
  if (opts?.clearProjectDraft) {
    clearComposerProjectDraft(projectKey);
  } else if (
    shouldClearMatchingProjectDraft({
      projectDraftText: savedProjectDraft?.text,
      projectDraftAttachments: savedProjectDraft?.attachments,
      projectDraftQuotes: savedProjectDraft?.quotes,
      sentText: opts?.sentText ?? "",
      sentAttachments: opts?.sentAttachments,
      sentQuotes: opts?.sentQuotes,
    })
  ) {
    clearComposerProjectDraft(projectKey);
  }
  if (opts?.clearSessionDraft) {
    const sid =
      opts.sessionDraftId ??
      viewingSessionIdRef.current ??
      session.sessionId ??
      null;
    if (sid) clearComposerSessionDraft(sid);
  }
};

/** Wipe the visible composer now. Persist is a separate call after send settles. */
const resetComposerUiAfterSubmit = () => {
  setDraft("");
  setQuotes([]);
  promptHistoryIndexRef.current = null;
  setPromptHistoryIndex(null);
  setPromptHistoryOpen(false);
  setPromptHistoryFilter("");
  setPromptHistoryActive(0);
  setPromptHistoryFocusFilter(false);
  setPromptHistoryScope("session");
  setSlashQuery(null);
  setAttachments([]);
  setChatAttachments([]);
  setAttachChatOpen(false);
  requestAnimationFrame(() => {
    const el = composerInputRef.current;
    if (el) el.style.height = "auto";
  });
};

const clearComposerAfterSubmit = (opts?: {
  /** Drop the per-project new-chat buffer (only when leaving a draft send). */
  clearProjectDraft?: boolean;
  /** Drop the per-session follow-up buffer (send / clear on a real thread). */
  clearSessionDraft?: boolean;
  sessionDraftId?: string | null;
}) => {
  resetComposerUiAfterSubmit();
  persistComposerSubmitClear(opts);
};

/**
 * Wipe the main composer (text + attachments). Also leaves inline edit mode
 * and drops the per-project new-chat buffer when on a draft page, or the
 * per-session follow-up buffer when on a real thread.
 */
const applyClearComposerDraft = useCallback(() => {
  const onDraftPage =
    session.sessionId == null && viewingSessionIdRef.current == null;
  setQuotes([]);
  clearComposerAfterSubmit({
    clearProjectDraft: onDraftPage,
    clearSessionDraft: !onDraftPage,
  });
  if (!editSubmitting) {
    setEditingUserMessageId(null);
    setEditAttachments([]);
  }
  requestComposerFocus();
}, [editSubmitting, requestComposerFocus, session.sessionId]);

/** Clear immediately, or confirm first when the draft is long (>200 chars). */
const requestClearComposerDraft = useCallback(() => {
  const draft = getDraft();
  const hasBody =
    !isDraftEmpty(parseStoredContent(draft)) ||
    attachments.length > 0 ||
    chatAttachments.length > 0 ||
    quotes.length > 0;
  if (!hasBody) return;
  if (countDraftChars(draft) > 200) {
    setAppDialog({
      kind: "confirm",
      title: tr("composer.clearDraftConfirmTitle"),
      message: tr("composer.clearDraftConfirmMessage"),
      confirmLabel: tr("composer.clearDraftConfirm"),
      danger: true,
      onConfirm: () => applyClearComposerDraft(),
    });
    return;
  }
  applyClearComposerDraft();
}, [applyClearComposerDraft, attachments.length, chatAttachments.length, quotes.length, getDraft, tr]);

/** Enqueue when agent is busy; otherwise send immediately. */
const send = async () => {
  if (!canLiveParticipate(isSecondaryWindowRef.current)) {
    showToastRef.current(tr("session.secondaryLiveBanner"), 4000);
    return;
  }
  // Flush live contenteditable → draft before send so the last Enter / blank
  // lines (and any debounced newline commit) are not dropped from the bubble.
  const editorEl = composerInputRef.current;
  let draft = getDraft();
  if (editorEl) {
    try {
      const live = serializeDom(editorEl);
      if (live !== draft) {
        setDraft(live);
        draft = live;
      }
    } catch {
      /* keep getDraft() */
    }
  }
  const fromDraft = parseChatTokens(draft, (id) =>
    lookupChatTitle(id, sessions, ""),
  );
  let refs = chatAttachments;
  for (const extra of fromDraft) {
    refs = addChatRef(refs, extra, { currentId: session.sessionId }).refs;
  }
  const storedDisplay = prependChatTokens(stripChatTokens(draft), refs);
  const segments = parseStoredContent(storedDisplay);
  const att = attachments;
  const sendQuotes = quotesRef.current;
  if (isDraftEmpty(segments) && !att.length && !sendQuotes.length) return;
  // Lone /workflow(s) — App has no TUI dashboard. Bare command opens Settings.
  // `/workflow <args>` falls through as a normal session turn.
  if (
    !att.length &&
    !segments.some((s) => s.type === "skill" || s.type === "plugin")
  ) {
    const plain = segments
      .map((s) => (s.type === "text" ? s.text : ""))
      .join("");
    const wf = classifyWorkflowSlashLine(plain);
    if (wf?.kind === "dashboard") {
      clearComposerAfterSubmit({
        clearProjectDraft: session.sessionId == null,
        clearSessionDraft: session.sessionId != null,
        sessionDraftId: viewingSessionIdRef.current ?? session.sessionId,
      });
      openWorkflowsSettings();
      return;
    }
  }
  if (session.state === "awaiting_permission") {
    showToastRef.current(tr("composer.queueBlockedPermission"), 2800);
    return;
  }
  // Unassigned chats use workspaces/general as cwd (no sidebar project).
  sendQueueRef.current!.releaseFlushHold();

  // New-chat page → after send, forget the project buffer so restore is empty.
  // Existing-session follow-ups clear the per-session buffer only (not project).
  const fromNewChatPage = session.sessionId == null;
  const clearDraftOpts = {
    clearProjectDraft: fromNewChatPage,
    clearSessionDraft: !fromNewChatPage,
    sessionDraftId: viewingSessionIdRef.current ?? session.sessionId,
    sentText: storedDisplay,
    sentAttachments: att,
    sentQuotes: sendQuotes,
  };

  // Enqueue only when *this viewed chat* FSM is busy (streaming/connecting).
  // Host mid-turn on another session → executeSend demotes + spawns concurrent
  // work. Never park a new-chat / other-session send into a fake local queue
  // (that showed “本会话队列” on empty welcome while the real turn ran elsewhere).
  // Also ignore the process-global `connecting` flag — foreign ensureConnected
  // must not make SuperGrok welcome enqueue (see shouldEnqueueSend).
  if (shouldEnqueueSend(session.state, connecting)) {
    sendQueueRef.current!.enqueue({
      storedDisplay,
      attachments: att,
      quotes: sendQuotes,
      goalMode,
    });
    clearComposerAfterSubmit(clearDraftOpts);
    return;
  }

  // Clear the box with the optimistic user bubble — do not wait for
  // ensureConnected / sessionSend (that left the prompt sitting in the
  // composer for seconds). Persist + fail-restore settle after executeSend.
  const originView = currentViewFocus();
  resetComposerUiAfterSubmit();

  const sent = await executeSend({
    storedDisplay,
    att,
    quotes: sendQuotes,
    goalMode,
  });
  if (sent && refs.length) {
    showToastRef.current(
      tr("attachChat.sentWith", {
        titles: refs
          .map((r) => r.title.trim() || r.sessionId.slice(0, 8))
          .join(" · "),
      }),
      2600,
    );
  }
  const action = nextComposerSubmitSettlement({
    sendSucceeded: sent,
    sentText: storedDisplay,
    sentAttachments: att,
    sentQuotes: sendQuotes,
    currentText: getDraft(),
    currentAttachments: attachmentsRef.current,
    currentQuotes: quotesRef.current,
  });
  const sendTargetId = resolveComposerSendSessionId({
    viewingSessionId: originView.sessionId,
    shellSessionId: session.sessionId,
  });
  const stillHere = isViewingSendTarget(
    originView,
    currentViewFocus(),
    sendTargetId,
  );
  if (stillHere) {
    if (action === "persist-clear") persistComposerSubmitClear(clearDraftOpts);
    else if (action === "restore") {
      setDraft(storedDisplay);
      setAttachments(att);
      setChatAttachments(refs);
      setQuotes(sendQuotes);
    }
    return;
  }
  // Navigated away: leaving already persisted the composer-at-leave
  // (follow-up text stays). Only refill an empty origin buffer on fail.
  // New-chat send adopts the materialized session, so stillHere is false —
  // still wipe the per-project new-session buffer or the next "New session"
  // restores the just-sent prompt (#620).
  if (sent) {
    persistComposerSubmitClear({
      clearProjectDraft: shouldClearProjectDraftAfterNewChatSend({
        fromNewChatPage: clearDraftOpts.clearProjectDraft,
        sendSucceeded: true,
      }),
      sentText: storedDisplay,
      sentAttachments: att,
      sentQuotes: sendQuotes,
    });
    return;
  }
  if (clearDraftOpts.clearSessionDraft && clearDraftOpts.sessionDraftId) {
    if (!loadComposerSessionDraft(clearDraftOpts.sessionDraftId)) {
      saveComposerSessionDraft(clearDraftOpts.sessionDraftId, {
        text: storedDisplay,
        attachments: att,
        chatAttachments: refs,
        quotes: sendQuotes,
        goalMode,
      });
    }
  } else if (
    clearDraftOpts.clearProjectDraft &&
    !loadComposerProjectDraft(projectDraftKey(activeProject?.id ?? null))
  ) {
    saveComposerProjectDraft(projectDraftKey(activeProject?.id ?? null), {
      text: storedDisplay,
      attachments: att,
      chatAttachments: refs,
      quotes: sendQuotes,
      goalMode,
    });
  }
};

  sendRef.current = send;
  executeSendFromQueueRef.current = (opts) => executeSend(opts);
  executeSendLatestRef.current = executeSend;

  return {
    executeSend,
    send,
    persistComposerSubmitClear,
    resetComposerUiAfterSubmit,
    clearComposerAfterSubmit,
    applyClearComposerDraft,
    requestClearComposerDraft,
  };
}
