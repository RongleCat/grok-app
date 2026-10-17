/**
 * Mic dictation for the pet panel. Reuses the Composer's capture + Host STT
 * path (`startVoiceCapture` → `voice_transcribe`); when the webview exposes
 * Web Speech, it also shows a live (interim) transcript while recording.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { voiceTranscribe } from "@/lib/api/voice";
import { blobToBase64, extensionForMime, startVoiceCapture, type CaptureHandle } from "@/lib/voiceCapture";

export type PetVoicePhase = "idle" | "recording" | "transcribing" | "error";

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function makeRecognizer(lang: string): Rec | null {
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  try {
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = true;
    return r;
  } catch {
    return null;
  }
}

export function usePetQuickVoice(locale: string, onText: (text: string) => void) {
  const [phase, setPhase] = useState<PetVoicePhase>("idle");
  const [live, setLive] = useState("");
  const capRef = useRef<CaptureHandle | null>(null);
  const recRef = useRef<Rec | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stopLive = () => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
  };

  const cancel = useCallback(() => {
    capRef.current?.cancel();
    capRef.current = null;
    stopLive();
    setLive("");
    setPhase("idle");
  }, []);

  useEffect(() => cancel, [cancel]);

  const start = useCallback(async () => {
    if (capRef.current) return;
    try {
      capRef.current = await startVoiceCapture();
      setPhase("recording");
      setLive("");
      const rec = makeRecognizer(locale === "tr" ? "tr-TR" : locale);
      if (rec) {
        rec.onresult = (e) => {
          let s = "";
          for (let i = 0; i < e.results.length; i++) s += e.results[i][0]?.transcript ?? "";
          setLive(s);
        };
        rec.onerror = () => stopLive();
        try {
          rec.start();
          recRef.current = rec;
        } catch {
          /* live transcript is optional */
        }
      }
    } catch {
      capRef.current = null;
      setPhase("error");
    }
  }, [locale]);

  const finish = useCallback(async () => {
    const cap = capRef.current;
    if (!cap) return;
    capRef.current = null;
    stopLive();
    setPhase("transcribing");
    try {
      const blob = await cap.stop();
      const mime = blob.type || "audio/wav";
      const res = await voiceTranscribe({
        audioBase64: await blobToBase64(blob),
        filename: `pet-dictation.${extensionForMime(mime)}`,
        mime,
        locale,
      });
      const text = (res.ok ? res.text : null)?.trim() || live.trim();
      if (text) {
        onTextRef.current(text);
        setPhase("idle");
      } else setPhase("error");
    } catch {
      setPhase("error");
    } finally {
      setLive("");
    }
  }, [live, locale]);

  const toggle = useCallback(() => {
    if (phase === "recording") void finish();
    else if (phase !== "transcribing") void start();
  }, [finish, phase, start]);

  return { phase, live, toggle, cancel };
}
