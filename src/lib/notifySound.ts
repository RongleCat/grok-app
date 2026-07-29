/**
 * Optional short beep when a desktop notification is shown.
 * localStorage-only — does not touch Host AppSettings.
 * Default: off.
 */

export const NOTIFY_SOUND_STORAGE_KEY = "grok.notifySound";

/** Fired on `window` after a successful save (detail = boolean enabled). */
export const NOTIFY_SOUND_CHANGE_EVENT = "grok-notify-sound-change";

export const DEFAULT_NOTIFY_SOUND = false;

/** Soft sine beep duration (seconds). */
const BEEP_DURATION_S = 0.12;
/** Peak gain — keep quiet so it is not startling. */
const BEEP_GAIN = 0.07;
/** Frequency in Hz (A5). */
const BEEP_FREQ_HZ = 880;

/** Minimal storage surface so unit tests need no jsdom. */
export interface NotifySoundStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): NotifySoundStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

/** Parse stored value; invalid / empty → default false. */
export function parseNotifySoundPref(raw: unknown): boolean {
  if (raw === "1" || raw === "true" || raw === true) return true;
  if (raw === "0" || raw === "false" || raw === false) return false;
  return DEFAULT_NOTIFY_SOUND;
}

export function loadNotifySoundPref(
  storage: NotifySoundStorage = defaultStorage(),
): boolean {
  try {
    return parseNotifySoundPref(storage.getItem(NOTIFY_SOUND_STORAGE_KEY));
  } catch {
    /* private mode */
    return DEFAULT_NOTIFY_SOUND;
  }
}

export function saveNotifySoundPref(
  enabled: boolean,
  storage: NotifySoundStorage = defaultStorage(),
): void {
  try {
    storage.setItem(NOTIFY_SOUND_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(NOTIFY_SOUND_CHANGE_EVENT, { detail: enabled }),
      );
    } catch {
      /* ignore */
    }
  }
}

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof globalThis === "undefined") return null;
  const g = globalThis as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  const C = g.AudioContext ?? g.webkitAudioContext;
  return typeof C === "function" ? C : null;
}

/**
 * Play a short soft beep via Web Audio oscillator.
 * Fail-closed: never throws; returns false when audio is unavailable.
 */
export function playNotifySound(): boolean {
  try {
    const Ctor = audioContextCtor();
    if (!Ctor) return false;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = BEEP_FREQ_HZ;
    const now = ctx.currentTime;
    // Soft attack + decay over ~0.12s.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(BEEP_GAIN, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + BEEP_DURATION_S);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + BEEP_DURATION_S + 0.02);
    const close = () => {
      try {
        void ctx.close();
      } catch {
        /* ignore */
      }
    };
    try {
      osc.onended = close;
    } catch {
      /* ignore */
    }
    // Fallback close if onended never fires.
    if (typeof setTimeout === "function") {
      setTimeout(close, Math.ceil((BEEP_DURATION_S + 0.1) * 1000));
    }
    return true;
  } catch {
    return false;
  }
}
