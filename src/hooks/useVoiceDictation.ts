/**
 * Composer dictation FSM + live-voice overlay open state.
 * Host still owns settings (voiceId / STT / auto-send) and send();
 * this hook owns capture, STT, draft insert, and gate refresh.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import { getComposerCaretOffset } from "@/components/ComposerEditor";
import type { ExecuteSendOpts } from "@/hooks/useComposerSend";
import { createT, type MessageKey } from "@/i18n";
import * as api from "@/lib/api";
import {
  clearComposerSessionDraft,
  loadComposerSessionDraft,
} from "@/lib/composerSessionDraft";
import { isMirrorClient } from "@/lib/mirrorTransport";
import {
  blobToBase64,
  extensionForMime,
  startVoiceCapture,
  type CaptureHandle,
} from "@/lib/voiceCapture";
import {
  classifyVoiceError,
  initialVoiceState,
  planTranscriptInsert,
  reduceVoice,
  resolveDictationCommit,
  resolveVoiceErrorClass,
  voiceAvailabilityFromAuth,
  voiceIsActive,
  voiceResultStillCurrent,
  voiceSoftFailResetsIdle,
  voiceStealsEscape,
  VOICE_MAX_RECORD_MS,
  type VoiceErrorClass,
  type VoiceFsmState,
} from "@/lib/voiceDictation";
import {
  parkDictationTranscript,
  sameDictationTarget,
  type DictationTarget,
} from "@/lib/voiceDictationDelivery";

type TFn = ReturnType<typeof createT>;

export type VoiceGate = {
  available: boolean;
  reason: VoiceErrorClass | null;
};

export function useVoiceDictation(opts: {
  tr: TFn;
  localeRef: MutableRefObject<string>;
  composerInputRef: RefObject<HTMLElement | null>;
  sendRef: MutableRefObject<(() => Promise<void>) | null>;
  /** Targeted background send (same engine as `send`, explicit session). */
  sendToSessionRef: MutableRefObject<
    (opts: ExecuteSendOpts) => Promise<boolean>
  >;
  voiceDictationAutoSendRef: MutableRefObject<boolean>;
  setDraft: Dispatch<SetStateAction<string>>;
  sessionState: string;
  /** Composer buffer in view right now (synced to a ref inside). */
  dictationTarget: DictationTarget;
  refreshSessions: () => void | Promise<void>;
  sttEngine: string;
  sttCustomBaseUrl: string;
  signedInRef: MutableRefObject<boolean>;
  notifyRef: MutableRefObject<(msg: string, ms?: number) => void>;
}) {
  const {
    tr,
    localeRef,
    composerInputRef,
    sendRef,
    sendToSessionRef,
    voiceDictationAutoSendRef,
    setDraft,
    refreshSessions,
    sttEngine,
    sttCustomBaseUrl,
    signedInRef,
    notifyRef,
  } = opts;
  const sessionStateRef = useRef(opts.sessionState);
  sessionStateRef.current = opts.sessionState;
  const dictationTargetRef = useRef(opts.dictationTarget);
  dictationTargetRef.current = opts.dictationTarget;

  const [voice, setVoice] = useState<VoiceFsmState>(() => initialVoiceState());
  const [liveVoiceOpen, setLiveVoiceOpen] = useState(false);
  const [voiceGate, setVoiceGate] = useState<VoiceGate>({
    available: false,
    reason: "not_available",
  });
  const voiceCaptureRef = useRef<CaptureHandle | null>(null);
  const voiceTimersRef = useRef<{ max?: number; noSpeech?: number }>({});
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const voiceGenRef = useRef(0);
  const voiceCaretRef = useRef<number | null>(null);
  /** Composer buffer that owned the mic when the user stopped recording. */
  const voiceTargetRef = useRef<DictationTarget | null>(null);

  const voiceErrorMessage = useCallback(
    (cls: VoiceErrorClass | null | undefined) => {
      const key = (`composer.voiceErr.${cls ?? "unknown"}`) as MessageKey;
      try {
        return tr(key);
      } catch {
        return tr("composer.voiceErr.unknown");
      }
    },
    [tr],
  );

  const clearVoiceTimers = useCallback(() => {
    const t = voiceTimersRef.current;
    if (t.max != null) window.clearTimeout(t.max);
    if (t.noSpeech != null) window.clearTimeout(t.noSpeech);
    voiceTimersRef.current = {};
  }, []);

  const refreshVoiceGate = useCallback(async () => {
    let customActive = false;
    if (api.isTauri()) {
      try {
        const list = await api.providersList();
        customActive = list.activeSource === "custom";
      } catch {
        /* ignore */
      }
    }
    try {
      if (api.isTauri() || isMirrorClient()) {
        if (customActive && sttEngine !== "custom") {
          setVoiceGate({ available: false, reason: "not_available" });
          return;
        }
        const st = await api.voiceStatus();
        setVoiceGate({
          available: !!st.available,
          reason: (st.reason as VoiceErrorClass | null) ?? "not_available",
        });
        return;
      }
    } catch {
      /* fall through to local estimate */
    }
    const signedIn = signedInRef.current;
    let hasOfficial = false;
    let hasRelay = false;
    try {
      const masked = await api.secretsGetMasked();
      hasOfficial = !!masked.hasOfficialKey;
      hasRelay = !!masked.hasRelayKey;
    } catch {
      /* ignore */
    }
    const gate = voiceAvailabilityFromAuth({
      signedInOfficial: signedIn,
      hasOfficialApiKey: hasOfficial,
      hasRelayOnly: hasRelay && !hasOfficial && !signedIn,
      sttCustomConfigured:
        sttEngine === "custom" && sttCustomBaseUrl.trim().length > 0,
      activeProviderIsCustom: customActive,
    });
    setVoiceGate({
      available: gate.available,
      reason: gate.reason,
    });
  }, [signedInRef, sttCustomBaseUrl, sttEngine]);

  useEffect(() => {
    void refreshVoiceGate();
  }, [refreshVoiceGate]);

  const cancelVoice = useCallback(() => {
    voiceGenRef.current += 1;
    clearVoiceTimers();
    try {
      voiceCaptureRef.current?.cancel();
    } catch {
      /* ignore */
    }
    voiceCaptureRef.current = null;
    voiceCaretRef.current = null;
    voiceTargetRef.current = null;
    setVoice(reduceVoice(voiceRef.current, { type: "cancel" }));
  }, [clearVoiceTimers]);

  useEffect(() => {
    if (voiceGate.available) return;
    if (voiceIsActive(voiceRef.current.phase)) {
      cancelVoice();
    }
    if (liveVoiceOpen) {
      setLiveVoiceOpen(false);
    }
  }, [cancelVoice, liveVoiceOpen, voiceGate.available]);

  useEffect(() => {
    const onVoiceSession = () => {
      void refreshSessions();
    };
    window.addEventListener("grok-app:voice-session-changed", onVoiceSession);
    return () =>
      window.removeEventListener(
        "grok-app:voice-session-changed",
        onVoiceSession,
      );
    // refreshSessions is stable enough for mount-scoped listen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyVoiceFail = useCallback(
    (cls: VoiceErrorClass, toastMs = 4800) => {
      notifyRef.current(voiceErrorMessage(cls), toastMs);
      if (voiceSoftFailResetsIdle(cls)) {
        setVoice(initialVoiceState());
      } else {
        setVoice((s) =>
          reduceVoice(s, { type: "transcribe_fail", error: cls }),
        );
      }
    },
    [notifyRef, voiceErrorMessage],
  );

  const finishVoiceTranscribe = useCallback(
    async (blob: Blob, gen: number) => {
      if (!voiceResultStillCurrent(gen, voiceGenRef.current)) return;
      setVoice((s) => reduceVoice(s, { type: "stop" }));
      try {
        if (blob.size < 256) {
          if (!voiceResultStillCurrent(gen, voiceGenRef.current)) return;
          applyVoiceFail("no_speech", 4200);
          return;
        }
        const b64 = await blobToBase64(blob);
        if (!voiceResultStillCurrent(gen, voiceGenRef.current)) return;
        const mime = blob.type || "audio/webm";
        const ext = extensionForMime(mime);
        const res = await api.voiceTranscribe({
          audioBase64: b64,
          filename: `dictation.${ext}`,
          mime,
          locale: localeRef.current,
        });
        if (!voiceResultStillCurrent(gen, voiceGenRef.current)) return;
        if (!res.ok || !res.text?.trim()) {
          const cls = resolveVoiceErrorClass(res.errorClass, res.error);
          applyVoiceFail(cls, 4800);
          return;
        }
        if (!voiceResultStillCurrent(gen, voiceGenRef.current)) return;
        const caret = voiceCaretRef.current;
        const commit = resolveDictationCommit({
          transcript: res.text!,
          autoSend: voiceDictationAutoSendRef.current,
          canAutoSend: sessionStateRef.current !== "awaiting_permission",
        });
        if (commit.kind === "empty") {
          applyVoiceFail("no_speech", 4200);
          return;
        }
        const origin = voiceTargetRef.current;
        const now = dictationTargetRef.current;
        if (origin && !sameDictationTarget(origin, now)) {
          // Chat switched while STT ran — the transcript belongs to the
          // buffer that owned the mic at stop, never the chat now in view.
          const parked = parkDictationTranscript({
            target: origin,
            transcript: commit.text,
            caret,
          });
          setVoice((s) => reduceVoice(s, { type: "transcribe_ok" }));
          if (parked && commit.kind === "send" && origin.sessionId) {
            const sid = origin.sessionId;
            const sentText = parked.text;
            void sendToSessionRef
              .current({
                storedDisplay: sentText,
                att: [],
                goalMode: parked.goalMode,
                targetSessionId: sid,
              })
              .then((sent) => {
                if (!sent) return;
                // Drop the parked copy only while nothing else was typed.
                if (loadComposerSessionDraft(sid)?.text === sentText) {
                  clearComposerSessionDraft(sid);
                }
              });
          }
          notifyRef.current(tr("composer.voiceDelivered"), 4800);
          return;
        }
        setDraft((d) => {
          const at =
            caret == null ? d.length : Math.max(0, Math.min(caret, d.length));
          const plan = planTranscriptInsert(d, commit.text, at);
          if (!plan) return d;
          return plan.text;
        });
        setVoice((s) => reduceVoice(s, { type: "transcribe_ok" }));
        if (commit.kind === "send") {
          window.setTimeout(() => {
            void sendRef.current?.();
          }, 0);
        } else if (commit.kind === "send_blocked") {
          notifyRef.current(tr("composer.voiceErr.sendBlocked"), 4800);
        }
      } catch (e) {
        if (!voiceResultStillCurrent(gen, voiceGenRef.current)) return;
        applyVoiceFail(classifyVoiceError(String(e)), 4800);
      } finally {
        if (voiceResultStillCurrent(gen, voiceGenRef.current)) {
          voiceCaptureRef.current = null;
          voiceCaretRef.current = null;
          voiceTargetRef.current = null;
          clearVoiceTimers();
        }
      }
    },
    [
      applyVoiceFail,
      clearVoiceTimers,
      localeRef,
      notifyRef,
      sendRef,
      sendToSessionRef,
      setDraft,
      tr,
      voiceDictationAutoSendRef,
    ],
  );

  const startVoice = useCallback(async () => {
    if (!voiceGate.available) {
      notifyRef.current(
        voiceErrorMessage(voiceGate.reason ?? "not_available"),
        4800,
      );
      return;
    }
    if (voiceIsActive(voiceRef.current.phase)) return;
    voiceGenRef.current += 1;
    const gen = voiceGenRef.current;
    setVoice((s) => reduceVoice(s, { type: "start" }));
    try {
      const handle = await startVoiceCapture();
      if (gen !== voiceGenRef.current) {
        handle.cancel();
        return;
      }
      voiceCaptureRef.current = handle;
      setVoice((s) => reduceVoice(s, { type: "mic_granted" }, Date.now()));
      clearVoiceTimers();
      const autoStopAndTranscribe = () => {
        void (async () => {
          if (!voiceResultStillCurrent(gen, voiceGenRef.current)) return;
          if (voiceRef.current.phase !== "recording") return;
          const cap = voiceCaptureRef.current;
          if (!cap) return;
          clearVoiceTimers();
          try {
            voiceCaretRef.current = getComposerCaretOffset(
              composerInputRef.current,
            );
            voiceTargetRef.current = dictationTargetRef.current;
            const blob = await cap.stop();
            await finishVoiceTranscribe(blob, gen);
          } catch (e) {
            if (!voiceResultStillCurrent(gen, voiceGenRef.current)) return;
            applyVoiceFail(classifyVoiceError(String(e)), 4200);
          }
        })();
      };
      voiceTimersRef.current.max = window.setTimeout(
        autoStopAndTranscribe,
        VOICE_MAX_RECORD_MS,
      );
    } catch (e) {
      if (gen !== voiceGenRef.current) return;
      const code =
        e && typeof e === "object" && "code" in e
          ? String((e as { code?: string }).code)
          : "";
      if (code === "mic_denied") {
        applyVoiceFail("mic_denied", 5200);
      } else if (code === "mic_missing") {
        applyVoiceFail("mic_missing", 4200);
      } else {
        applyVoiceFail(classifyVoiceError(String(e)), 4200);
      }
      voiceCaptureRef.current = null;
    }
  }, [
    applyVoiceFail,
    clearVoiceTimers,
    composerInputRef,
    finishVoiceTranscribe,
    notifyRef,
    voiceErrorMessage,
    voiceGate.available,
    voiceGate.reason,
  ]);

  const stopVoice = useCallback(async () => {
    if (voiceRef.current.phase !== "recording") return;
    const gen = voiceGenRef.current;
    voiceCaretRef.current = getComposerCaretOffset(composerInputRef.current);
    voiceTargetRef.current = dictationTargetRef.current;
    clearVoiceTimers();
    const cap = voiceCaptureRef.current;
    if (!cap) {
      setVoice(initialVoiceState());
      return;
    }
    try {
      const blob = await cap.stop();
      await finishVoiceTranscribe(blob, gen);
    } catch (e) {
      if (gen !== voiceGenRef.current) return;
      applyVoiceFail(classifyVoiceError(String(e)), 4200);
      voiceCaptureRef.current = null;
    }
  }, [
    applyVoiceFail,
    clearVoiceTimers,
    composerInputRef,
    finishVoiceTranscribe,
  ]);

  const toggleVoice = useCallback(() => {
    const phase = voiceRef.current.phase;
    if (phase === "recording") {
      void stopVoice();
      return;
    }
    if (phase === "requesting_mic" || phase === "transcribing") {
      cancelVoice();
      return;
    }
    if (phase === "error") {
      setVoice(initialVoiceState());
    }
    void startVoice();
  }, [cancelVoice, startVoice, stopVoice]);

  const startLiveVoice = useCallback(() => {
    if (!voiceGate.available) {
      notifyRef.current(
        voiceErrorMessage(voiceGate.reason ?? "not_available"),
        4200,
      );
      return;
    }
    if (voiceIsActive(voiceRef.current.phase)) {
      cancelVoice();
    }
    setLiveVoiceOpen(true);
  }, [
    cancelVoice,
    notifyRef,
    voiceErrorMessage,
    voiceGate.available,
    voiceGate.reason,
  ]);

  return {
    voice,
    voiceRef,
    liveVoiceOpen,
    setLiveVoiceOpen,
    voiceGate,
    voiceErrorMessage,
    voiceStealsEscape: voiceStealsEscape(voice.phase),
    cancelVoice,
    startVoice,
    stopVoice,
    toggleVoice,
    startLiveVoice,
    refreshVoiceGate,
  };
}
