/**
 * Live Voice overlay — command center: full-duplex UI + delegated session
 * chips, tool/permission status, keep-agents honesty.
 *
 * Status (listening / thinking / speaking / Build tool+permission path)
 * comes from host voice:// events + real session://permission for
 * delegated sessions. Transcript text is never invented (no fake STT).
 * Mic / CLI missing soft-fails with clear copy; host tools surface
 * tool_running → completed / soft_fail / error; permission_pending lets
 * the user allow/deny in-overlay (no window.confirm). Stopping voice
 * cancels in-flight host tools; optional cancel of delegated agents.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  sessionResolvePermission,
  voiceInvokeTool,
  voicePushPcm,
  voiceStart,
  voiceState,
  voiceStop,
  type VoiceSessionState,
} from "@/lib/api";
import { playPcm16Base64, startPcmCapture } from "@/lib/voiceAudio";
import {
  buildVoiceSessionChips,
  formatVoiceToolStatus,
  hasRunningVoiceDelegates,
  mergeVoiceSessionsForChips,
  normalizeVoiceChipStatus,
  planVoiceEnd,
  resolveKeepAgentsBanner,
  resolveVoiceCenterEmptyState,
  voiceCenterEmptyMessageKey,
  type VoiceSessionChipInput,
} from "@/lib/voiceCommandCenter";
import {
  canSendTranscriptAsPrompt,
  classifyLiveVoiceError,
  deriveVoiceDelegatePhase,
  formatTranscriptAsPrompt,
  hasDelegatedSessions,
  initialToolLoopState,
  isClassifiedSoftFailNotice,
  isPermissionDenyDecision,
  isPermissionForDelegatedSession,
  isPermissionPending,
  isSoftMicFailure,
  isToolLoopBusy,
  liveVoiceErrorMessageKey,
  mergeTranscriptLine,
  nextAwaitingResponse,
  parseToolLoopEvent,
  parseVoicePermissionPrompt,
  permissionPendingToolLoopState,
  reduceToolLoopState,
  softFailFromPermissionBlocked,
  toolLoopStatusMessageKey,
  transcriptEmptyKind,
  type VoiceDelegatePhase,
  type VoiceLiveErrorClass,
  type VoicePermissionPrompt,
  type VoiceToolLoopState,
  type VoiceTranscriptLine,
} from "@/lib/voiceOverlay";
import { mapPermissionButtons } from "@/lib/permissionOptions";
import type { Locale, MessageKey } from "@/i18n";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export type VoiceOverlayProps = {
  locale: Locale;
  open: boolean;
  projectPath?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  voiceId?: string | null;
  keepAgentsOnEnd?: boolean;
  /** When true, the workbench has an active chat that can accept a prompt. */
  hasActiveSession?: boolean;
  /**
   * Sidebar / live session rows for chip titles + status.
   * Overlay merges with host delegatedSessionIds (never invents STT).
   */
  sessions?: readonly VoiceSessionChipInput[] | null;
  /** Soft auth gate for empty-state honesty (CLI / account). Default true. */
  hasVoiceAuth?: boolean;
  onClose: () => void;
  /** Focus a coding session (chip click). Alias of onOpenSession. */
  onFocusSession?: (sessionId: string) => void;
  onOpenSession?: (sessionId: string) => void;
  /**
   * Optional: send formatted host transcript as a user prompt on the active
   * session. Omit when host/app does not support it — control stays hidden.
   */
  onSendTranscriptAsPrompt?: (prompt: string) => void | Promise<void>;
  /**
   * Optional toast for classified soft-fail notices (mic / auth / network).
   * Overlay still shows inline warn/error; toast is for workbench discoverability.
   */
  onClassifiedNotice?: (message: string) => void;
};

function phaseMessageKey(phase: VoiceDelegatePhase): MessageKey {
  switch (phase) {
    case "connecting":
      return "voice.connecting";
    case "speaking":
      return "voice.speaking";
    case "thinking":
      return "voice.thinking";
    case "listening":
      return "voice.listening";
    case "error":
      return "voice.statusError";
    case "ended":
      return "voice.statusEnded";
    case "idle":
    default:
      return "voice.live";
  }
}

/** Humanize a classified Live Voice error (i18n). Falls back to generic. */
function formatLiveError(
  tt: (key: MessageKey, vars?: Record<string, string | number>) => string,
  raw: string | null | undefined,
  errorClass?: string | null,
): string {
  const cls = classifyLiveVoiceError(raw, errorClass);
  const key = liveVoiceErrorMessageKey(cls) as MessageKey;
  const localized = tt(key);
  // If catalog missing for some reason, still surface something honest.
  if (localized && localized !== key) return localized;
  if (raw?.trim()) return tt("voice.error", { message: raw.trim() });
  return tt("voice.err.unknown");
}

export function VoiceOverlay({
  locale,
  open,
  projectPath,
  projectId,
  projectName,
  voiceId,
  keepAgentsOnEnd = true,
  hasActiveSession = false,
  sessions: sessionSummaries = null,
  hasVoiceAuth = true,
  onClose,
  onFocusSession,
  onOpenSession,
  onSendTranscriptAsPrompt,
  onClassifiedNotice,
}: VoiceOverlayProps) {
  const focusSession = onFocusSession ?? onOpenSession;
  const tt = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => t(locale, key, vars),
    [locale],
  );
  /** Toast mic/auth/network/cli soft-fail classes (inline UI still primary). */
  const noticeClassified = useCallback(
    (raw: string | null | undefined, errorClass?: string | null) => {
      if (!onClassifiedNotice) return;
      const cls = classifyLiveVoiceError(raw, errorClass);
      if (!isClassifiedSoftFailNotice(cls)) return;
      onClassifiedNotice(formatLiveError(tt, raw, errorClass));
    },
    [onClassifiedNotice, tt],
  );
  const [state, setState] = useState<VoiceSessionState | null>(null);
  const [lines, setLines] = useState<VoiceTranscriptLine[]>([]);
  /** Fatal UI/host error (forces error phase). */
  const [error, setError] = useState<string | null>(null);
  /** Soft mic warning — host may still be active (playback / tools). */
  const [softMicWarning, setSoftMicWarning] =
    useState<VoiceLiveErrorClass | null>(null);
  const [busy, setBusy] = useState(false);
  const [awaitingResponse, setAwaitingResponse] = useState(false);
  const [sendingPrompt, setSendingPrompt] = useState(false);
  const [toolLoop, setToolLoop] = useState<VoiceToolLoopState>(
    initialToolLoopState,
  );
  /** Real ACP permission for a voice-delegated session (allow/deny in overlay). */
  const [pendingPermission, setPendingPermission] =
    useState<VoicePermissionPrompt | null>(null);
  const [resolvingPermission, setResolvingPermission] = useState(false);
  const stopCapture = useRef<(() => void) | null>(null);
  const started = useRef(false);
  /** Latest delegated ids for permission listener (avoid stale closure). */
  const delegatedIdsRef = useRef<string[]>([]);

  const appendLine = useCallback(
    (role: string, text: string, final?: boolean) => {
      setLines((prev) => mergeTranscriptLine(prev, role, text, final));
      setAwaitingResponse((prev) =>
        nextAwaitingResponse({ prev, role, final }),
      );
    },
    [],
  );

  const applyToolEvent = useCallback(
    (payload: {
      name?: string | null;
      status?: string | null;
      reason?: string | null;
      message?: string | null;
      sessionId?: string | null;
      session_id?: string | null;
      result?: unknown;
      errorClass?: string | null;
      permissionTitle?: string | null;
      title?: string | null;
    }) => {
      const parsed = parseToolLoopEvent(payload);
      if (!parsed) return;
      setToolLoop((prev) => reduceToolLoopState(prev, parsed));
      // Clear overlay permission bar when tool leaves permission_pending.
      if (parsed.status !== "permission_pending") {
        // Keep bar if soft-fail reason is not permission-related cancel of same.
      }
      const key = toolLoopStatusMessageKey(parsed);
      if (key) {
        const vars: Record<string, string | number> = {
          name: parsed.name ?? "tool",
          reason: parsed.reason ?? "",
          title: parsed.permissionTitle ?? parsed.name ?? "",
        };
        appendLine("system", tt(key, vars), true);
      }
      if (
        parsed.name === "create_agent_session" ||
        parsed.name === "prompt_agent"
      ) {
        window.dispatchEvent(
          new CustomEvent("grok-app:voice-session-changed"),
        );
      }
      // Refresh delegated chips after host tool updates.
      void voiceState()
        .then((st) => {
          setState(st);
          delegatedIdsRef.current = st.delegatedSessionIds ?? [];
        })
        .catch(() => {});
    },
    [appendLine, tt],
  );

  const resolveVoicePermission = useCallback(
    async (
      prompt: VoicePermissionPrompt,
      decision: "allow_once" | "allow_session" | "deny",
      optionId: string,
    ) => {
      setResolvingPermission(true);
      try {
        await sessionResolvePermission({
          rpcId: prompt.rpcId,
          decision,
          optionId,
          scopeKey: prompt.scopeKey || undefined,
          sessionId: prompt.sessionId,
          options: prompt.options,
          toolName: prompt.toolName,
        });
        setPendingPermission(null);
        if (isPermissionDenyDecision(decision)) {
          const soft = softFailFromPermissionBlocked({
            toolName: prompt.toolName,
            sessionId: prompt.sessionId,
          });
          setToolLoop((prev) => reduceToolLoopState(prev, soft));
          appendLine(
            "system",
            tt("voice.toolSoftFail", {
              name: soft.name ?? "permission",
              reason: soft.reason ?? "permission_denied",
            }),
            true,
          );
        } else {
          // Allowed — tool continues on agent; clear pending chrome.
          setToolLoop((prev) =>
            prev.status === "permission_pending"
              ? {
                  ...prev,
                  status: "tool_running",
                  permissionTitle: null,
                }
              : prev,
          );
          appendLine(
            "system",
            tt("voice.permissionAllowed", {
              name: prompt.toolName || prompt.title || "tool",
            }),
            true,
          );
        }
        window.dispatchEvent(
          new CustomEvent("grok-app:voice-permission-resolved", {
            detail: {
              sessionId: prompt.sessionId,
              decision,
              rpcId: prompt.rpcId,
            },
          }),
        );
      } catch (e) {
        // Soft-fail resolve errors — voice stays open.
        const soft = softFailFromPermissionBlocked({
          toolName: prompt.toolName,
          sessionId: prompt.sessionId,
          reason: "permission_denied",
        });
        setToolLoop((prev) => reduceToolLoopState(prev, soft));
        appendLine(
          "system",
          tt("voice.toolSoftFail", {
            name: soft.name ?? "permission",
            reason: String(e),
          }),
          true,
        );
      } finally {
        setResolvingPermission(false);
      }
    },
    [appendLine, tt],
  );

  useEffect(() => {
    if (!open) {
      started.current = false;
      stopCapture.current?.();
      stopCapture.current = null;
      setAwaitingResponse(false);
      setToolLoop(initialToolLoopState());
      setSoftMicWarning(null);
      setPendingPermission(null);
      delegatedIdsRef.current = [];
      return;
    }
    if (started.current) return;
    started.current = true;
    setBusy(true);
    setError(null);
    setSoftMicWarning(null);
    setLines([]);
    setAwaitingResponse(false);
    setToolLoop(initialToolLoopState());
    setPendingPermission(null);

    let unsubs: Array<() => void> = [];

    (async () => {
      try {
        const st = await voiceStart({
          projectPath,
          projectId,
          projectName,
          voiceId: voiceId ?? null,
          keepAgentsOnEnd,
        });
        setState(st);
        delegatedIdsRef.current = st.delegatedSessionIds ?? [];
        appendLine(
          "system",
          st.mock ? tt("voice.mockReady") : tt("voice.ready"),
          true,
        );

        // Mic → host. Soft-fail when missing/denied: session stays up for
        // playback + Build tools; only warn (do not hard-kill the overlay).
        try {
          const cap = await startPcmCapture((b64) => {
            void voicePushPcm(b64).catch(() => {});
          });
          stopCapture.current = cap.stop;
        } catch (micErr) {
          const cls = classifyLiveVoiceError(String(micErr));
          if (isSoftMicFailure(cls)) {
            setSoftMicWarning(cls);
            appendLine("system", tt(liveVoiceErrorMessageKey(cls) as MessageKey), true);
            noticeClassified(String(micErr), cls);
          } else {
            setError(formatLiveError(tt, String(micErr)));
            noticeClassified(String(micErr), cls);
          }
        }

        const u1 = await listen<VoiceSessionState>("voice://state", (e) => {
          setState(e.payload);
          delegatedIdsRef.current = e.payload.delegatedSessionIds ?? [];
          if (e.payload.speaking) {
            setAwaitingResponse(false);
          }
          // Host activeTool / toolStatus mirror tool-loop busy when present.
          const active = e.payload.activeTool?.trim();
          const hostStatus = (e.payload.toolStatus ?? "").trim().toLowerCase();
          if (active) {
            const status =
              hostStatus === "permission_pending"
                ? "permission_pending"
                : "tool_running";
            setToolLoop((prev) =>
              prev.status === status && prev.name === active
                ? prev
                : {
                    status,
                    name: active,
                    reason: null,
                    sessionId: prev.sessionId,
                    permissionTitle: prev.permissionTitle,
                  },
            );
          }
        });
        unsubs.push(u1);

        const u2 = await listen<{ role?: string; text?: string; final?: boolean }>(
          "voice://transcript",
          (e) => {
            const role = e.payload.role ?? "assistant";
            const text = e.payload.text ?? "";
            // Host text only — never invent STT when payload is empty.
            if (text) appendLine(role, text, e.payload.final);
          },
        );
        unsubs.push(u2);

        const u3 = await listen<{ delta?: string }>("voice://audio", (e) => {
          if (e.payload.delta) {
            setAwaitingResponse(false);
            void playPcm16Base64(e.payload.delta).catch(() => {});
          }
        });
        unsubs.push(u3);

        const u4 = await listen<{
          message?: string;
          errorClass?: string;
        }>("voice://error", (e) => {
          const cls = classifyLiveVoiceError(
            e.payload.message,
            e.payload.errorClass,
          );
          if (isSoftMicFailure(cls)) {
            setSoftMicWarning(cls);
            appendLine(
              "system",
              tt(liveVoiceErrorMessageKey(cls) as MessageKey),
              true,
            );
            noticeClassified(e.payload.message, e.payload.errorClass);
            return;
          }
          setError(formatLiveError(tt, e.payload.message, e.payload.errorClass));
          noticeClassified(e.payload.message, e.payload.errorClass);
        });
        unsubs.push(u4);

        const u5 = await listen<Record<string, unknown>>("voice://tool", (e) => {
          applyToolEvent(e.payload as Parameters<typeof applyToolEvent>[0]);
        });
        unsubs.push(u5);

        const u6 = await listen("voice://tool_result", () => {
          // Lifecycle lines come from voice://tool.
          // tool_result only refreshes delegated chips — avoid double-append.
          void voiceState()
            .then((st) => {
              setState(st);
              delegatedIdsRef.current = st.delegatedSessionIds ?? [];
            })
            .catch(() => {});
        });
        unsubs.push(u6);

        // Permission prompts for voice-delegated Build sessions only.
        // Same path as the main workbench bar (sessionResolvePermission);
        // never window.confirm. Soft-fail if user denies.
        const u7 = await listen<Record<string, unknown>>(
          "session://permission",
          (e) => {
            const prompt = parseVoicePermissionPrompt(e.payload);
            if (!prompt) return;
            if (
              !isPermissionForDelegatedSession(
                prompt.sessionId,
                delegatedIdsRef.current,
              )
            ) {
              return;
            }
            setPendingPermission(prompt);
            setToolLoop((prev) =>
              reduceToolLoopState(prev, permissionPendingToolLoopState(prompt)),
            );
            appendLine(
              "system",
              tt("voice.permissionPending", {
                name: prompt.toolName || "tool",
                title: prompt.title || prompt.toolName || "tool",
              }),
              true,
            );
          },
        );
        unsubs.push(u7);
      } catch (e) {
        setError(formatLiveError(tt, String(e)));
        noticeClassified(String(e));
      } finally {
        setBusy(false);
      }
    })();

    return () => {
      unsubs.forEach((u) => {
        try {
          u();
        } catch {
          /* ignore */
        }
      });
    };
  }, [
    open,
    projectPath,
    projectId,
    projectName,
    voiceId,
    keepAgentsOnEnd,
    appendLine,
    applyToolEvent,
    noticeClassified,
    tt,
  ]);

  const handleEnd = async () => {
    stopCapture.current?.();
    stopCapture.current = null;
    setPendingPermission(null);
    try {
      // Host cancels in-flight tools; cancels agents when keepAgentsOnEnd=false.
      await voiceStop();
    } catch {
      /* ignore */
    }
    onClose();
  };

  /** Dev/demo: simulate “start agent task” without S2S tool frames. */
  const demoDelegate = async () => {
    try {
      await voiceInvokeTool(
        "create_agent_session",
        JSON.stringify({
          title: "Voice task",
          prompt:
            "Summarize the project status and list the next three safe coding tasks.",
        }),
      );
      const st = await voiceState();
      setState(st);
    } catch (e) {
      setError(formatLiveError(tt, String(e)));
    }
  };

  const transcriptPrompt = useMemo(
    () => formatTranscriptAsPrompt(lines),
    [lines],
  );
  const supportsSend = typeof onSendTranscriptAsPrompt === "function";
  const showSend = canSendTranscriptAsPrompt({
    supportsSend,
    hasActiveSession,
    transcriptText: transcriptPrompt,
  });
  const emptyKind = transcriptEmptyKind(lines);
  const toolBusy = isToolLoopBusy(toolLoop);
  const permPending = isPermissionPending(toolLoop) || !!pendingPermission;
  const phase = deriveVoiceDelegatePhase({
    connecting: busy,
    uiError: error,
    softMicWarning,
    state,
    toolBusy: toolBusy || permPending,
    awaitingResponse,
  });
  const statusLabel = tt(phaseMessageKey(phase));
  const toolStatusKey = toolLoopStatusMessageKey(toolLoop);
  const formattedTool = useMemo(
    () =>
      formatVoiceToolStatus({
        name: toolLoop.name,
        status: toolLoop.status,
      }),
    [toolLoop.name, toolLoop.status],
  );
  const softMicLabel = softMicWarning
    ? tt(liveVoiceErrorMessageKey(softMicWarning) as MessageKey)
    : null;
  const permButtons = pendingPermission
    ? mapPermissionButtons(
        pendingPermission.options,
        {
          allowOnce: tt("perm.allowOnce"),
          allowSession: tt("perm.allowSession"),
          deny: tt("perm.deny"),
        },
        pendingPermission.toolName,
      )
    : [];

  const sessionChips = useMemo(() => {
    const merged = mergeVoiceSessionsForChips({
      delegatedIds: state?.delegatedSessionIds ?? [],
      // Only pass busy/permission rows as non-delegated candidates;
      // idle sidebar chats stay out of the command-center strip.
      sessions: (sessionSummaries ?? []).filter((s) => {
        const st = normalizeVoiceChipStatus(s.status);
        return st === "running" || st === "permission" || Boolean(s.isDelegated);
      }),
    });
    // Prefer host-delegated chips; fall back to active Build sessions only.
    const delegatedOnly = buildVoiceSessionChips(merged, {
      preferDelegatedOnly: true,
    });
    if (delegatedOnly.length > 0) return delegatedOnly;
    return buildVoiceSessionChips(merged, { preferDelegatedOnly: false }).filter(
      (c) => c.status === "running" || c.status === "permission",
    );
  }, [state?.delegatedSessionIds, sessionSummaries]);

  const keepBanner = useMemo(
    () => resolveKeepAgentsBanner(keepAgentsOnEnd),
    [keepAgentsOnEnd],
  );
  const endPlan = useMemo(
    () =>
      planVoiceEnd({
        keepAgents: keepAgentsOnEnd,
        hasRunningDelegates: hasRunningVoiceDelegates(sessionChips),
      }),
    [keepAgentsOnEnd, sessionChips],
  );

  const hasMic = !softMicWarning || !isSoftMicFailure(softMicWarning);
  const centerEmptyKind = resolveVoiceCenterEmptyState({
    hasMic,
    hasAuth: hasVoiceAuth,
    hasDelegates: hasDelegatedSessions(state) || sessionChips.length > 0,
    transcriptEmpty:
      emptyKind === "none" || emptyKind === "system_only",
  });
  const centerEmptyKey = voiceCenterEmptyMessageKey(centerEmptyKind);

  const handleSendTranscript = async () => {
    if (!showSend || !onSendTranscriptAsPrompt || !transcriptPrompt.trim()) {
      return;
    }
    setSendingPrompt(true);
    try {
      await onSendTranscriptAsPrompt(transcriptPrompt);
    } catch (e) {
      setError(formatLiveError(tt, String(e)));
    } finally {
      setSendingPrompt(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="voice-overlay"
      role="dialog"
      aria-label={tt("voice.live")}
    >
      <div className="voice-overlay__panel">
        <header className="voice-overlay__header">
          <div>
            <div className="voice-overlay__title">{tt("voice.live")}</div>
            <div
              className={cn(
                "voice-overlay__status",
                `voice-overlay__status--${phase}`,
              )}
              data-phase={phase}
              data-tool-status={toolLoop.status}
              data-tool-name={toolLoop.name ?? undefined}
              data-permission-pending={permPending ? "true" : undefined}
            >
              <span
                className={cn(
                  "voice-overlay__phase-dot",
                  `is-${phase}`,
                  permPending && "is-permission",
                )}
                aria-hidden
              />
              {statusLabel}
            </div>
          </div>
          <button
            type="button"
            className="voice-overlay__end"
            title={tt(endPlan.noteMessageKey as MessageKey)}
            onClick={() => void handleEnd()}
          >
            {tt("voice.stop")}
          </button>
        </header>

        {/* Tool + permission status region (host events only). */}
        <div
          className="voice-overlay__tool-status"
          role="status"
          data-tool-status={formattedTool.status}
          data-tool-name={formattedTool.name ?? undefined}
          data-permission-pending={permPending ? "true" : undefined}
        >
          {toolStatusKey &&
          (toolBusy ||
            toolLoop.status === "completed" ||
            toolLoop.status === "ok" ||
            toolLoop.status === "soft_fail" ||
            toolLoop.status === "error" ||
            permPending) ? (
            <span
              className={cn(
                "voice-overlay__tool-chip",
                `is-${
                  toolLoop.status === "running"
                    ? "tool_running"
                    : toolLoop.status === "ok"
                      ? "completed"
                      : toolLoop.status
                }`,
              )}
            >
              {tt(toolStatusKey, {
                name: toolLoop.name ?? "tool",
                reason: toolLoop.reason ?? "",
                title:
                  toolLoop.permissionTitle ?? toolLoop.name ?? "",
              })}
            </span>
          ) : (
            <span className="voice-overlay__tool-idle">
              {tt("voice.center.toolIdle")}
            </span>
          )}
        </div>

        {error ? <div className="voice-overlay__error">{error}</div> : null}
        {!error && softMicLabel ? (
          <div className="voice-overlay__warn" role="status">
            {softMicLabel}
          </div>
        ) : null}

        {pendingPermission ? (
          <div
            className="voice-overlay__perm"
            role="region"
            aria-label={tt("voice.permissionPending", {
              name: pendingPermission.toolName || "tool",
              title: pendingPermission.title || pendingPermission.toolName || "tool",
            })}
          >
            <div className="voice-overlay__perm-title">
              {tt("voice.permissionPending", {
                name: pendingPermission.toolName || "tool",
                title:
                  pendingPermission.title ||
                  pendingPermission.toolName ||
                  "tool",
              })}
            </div>
            {pendingPermission.preview ? (
              <div className="voice-overlay__perm-preview">
                {pendingPermission.preview.length > 280
                  ? `${pendingPermission.preview.slice(0, 280)}…`
                  : pendingPermission.preview}
              </div>
            ) : null}
            <div className="voice-overlay__perm-actions">
              {permButtons.map((btn) => (
                <button
                  key={`${btn.decision}-${btn.optionId}`}
                  type="button"
                  className={cn(
                    "voice-overlay__perm-btn",
                    btn.decision === "deny" && "is-deny",
                    btn.decision === "allow_once" && "is-allow",
                    btn.decision === "allow_session" && "is-session",
                  )}
                  disabled={resolvingPermission}
                  onClick={() =>
                    void resolveVoicePermission(
                      pendingPermission,
                      btn.decision,
                      btn.optionId,
                    )
                  }
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Session chips strip — delegated / active Build sessions. */}
        <section
          className="voice-overlay__chips-strip"
          aria-label={tt("voice.delegated")}
        >
          <div className="voice-overlay__delegated-title">
            {tt("voice.delegated")}
          </div>
          {sessionChips.length === 0 ? (
            <div className="voice-overlay__muted">{tt("voice.noDelegated")}</div>
          ) : (
            <ul className="voice-overlay__chips">
              {sessionChips.map((chip) => (
                <li key={chip.id}>
                  <button
                    type="button"
                    className={cn(
                      "voice-overlay__chip",
                      `is-${chip.tone}`,
                      chip.isDelegated && "is-delegated",
                    )}
                    data-session-id={chip.id}
                    data-status={chip.status}
                    title={chip.id}
                    onClick={() => focusSession?.(chip.id)}
                  >
                    <span
                      className={cn(
                        "voice-overlay__chip-dot",
                        `is-${chip.tone}`,
                      )}
                      aria-hidden
                    />
                    <span className="voice-overlay__chip-label">
                      {chip.label}
                    </span>
                    {chip.isDelegated ? (
                      <span className="voice-overlay__chip-tag">
                        {tt("voice.center.chipDelegated")}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="voice-overlay__wave" aria-hidden>
          <span
            className={cn(
              "voice-overlay__bar",
              (phase === "listening" || phase === "thinking") && "is-on",
            )}
          />
          <span
            className={cn(
              "voice-overlay__bar",
              (phase === "speaking" || phase === "thinking") && "is-on",
            )}
          />
          <span
            className={cn(
              "voice-overlay__bar",
              phase === "listening" && "is-on",
            )}
          />
          <span
            className={cn(
              "voice-overlay__bar",
              phase === "speaking" && "is-on",
            )}
          />
          <span
            className={cn(
              "voice-overlay__bar",
              (phase === "listening" || phase === "thinking") && "is-on",
            )}
          />
        </div>

        <div className="voice-overlay__transcript">
          {emptyKind === "none" || emptyKind === "system_only" ? (
            <div className="voice-overlay__muted">
              {centerEmptyKey
                ? tt(centerEmptyKey as MessageKey)
                : emptyKind === "system_only"
                  ? tt("voice.transcriptSystemOnly")
                  : tt("voice.transcriptEmpty")}
            </div>
          ) : null}
          {lines.map((l) => (
            <div
              key={l.id}
              className={cn(
                "voice-overlay__line",
                l.role === "user" && "is-user",
                l.role === "assistant" && "is-assistant",
                l.role === "system" && "is-system",
              )}
            >
              <span className="voice-overlay__role">{l.role}</span>
              <span>{l.text}</span>
            </div>
          ))}
        </div>

        <div className="voice-overlay__actions">
          {supportsSend ? (
            showSend ? (
              <button
                type="button"
                className="voice-overlay__send"
                disabled={sendingPrompt}
                onClick={() => void handleSendTranscript()}
              >
                {sendingPrompt
                  ? tt("voice.sendingTranscript")
                  : tt("voice.sendTranscript")}
              </button>
            ) : (
              <div className="voice-overlay__muted">
                {hasActiveSession
                  ? tt("voice.sendTranscriptNeedSpeech")
                  : tt("voice.sendTranscriptNeedSession")}
              </div>
            )
          ) : null}
          {state?.mock ? (
            <button
              type="button"
              className="voice-overlay__demo"
              onClick={() => void demoDelegate()}
            >
              {tt("voice.demoDelegate")}
            </button>
          ) : null}
        </div>

        {/* Footer honesty: keep coding sessions pref + end-session note. */}
        <footer className="voice-overlay__footer">
          <div
            className={cn(
              "voice-overlay__keep-banner",
              keepBanner.keep ? "is-keep" : "is-cancel",
            )}
            data-keep-agents={keepBanner.keep ? "true" : "false"}
          >
            {tt(keepBanner.messageKey as MessageKey)}
          </div>
          <div className="voice-overlay__end-note">
            {tt(endPlan.noteMessageKey as MessageKey)}
          </div>
        </footer>
      </div>
    </div>
  );
}
