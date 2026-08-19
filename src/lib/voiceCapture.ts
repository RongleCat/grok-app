/**
 * Microphone capture for voice dictation (Web Audio PCM → WAV).
 *
 * MediaRecorder is unreliable in WKWebView (audio-only recordings can come
 * back empty), so we capture raw PCM via AudioContext + ScriptProcessor and
 * encode a standard 16-bit mono WAV. WAV is accepted by the official xAI STT
 * and by OpenAI-compatible /audio/transcriptions endpoints alike.
 *
 * Host performs STT; this module only produces a WAV blob.
 */

export type CaptureHandle = {
  stop: () => Promise<Blob>;
  cancel: () => void;
};

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/** Encode mono Float32 PCM ([-1, 1]) as a 16-bit PCM WAV blob. */
export function encodeWavToBlob(
  samples: Float32Array,
  sampleRate: number,
): Blob {
  const byteLength = 44 + samples.length * 2;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const int16 =
      s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    view.setInt16(offset, Math.max(-0x8000, Math.min(0x7fff, int16)), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * True for aggregate / virtual input devices that capture system audio
 * (e.g. a screen-capture "microphone") instead of a real microphone.
 */
export function isVirtualInputDevice(label: string): boolean {
  const l = label.toLowerCase();
  return (
    /aggregate|聚合|blackhole|soundflower|loopback|virtual|虚拟|多输出|多輸入|null audio|no audio/i.test(
      l,
    )
  );
}

function inputDeviceScore(label: string): number {
  if (isVirtualInputDevice(label)) return -1;
  let score = 0;
  if (/外置|external|usb|蓝牙|bluetooth|airpods/i.test(label)) score += 2;
  if (/mic|microphone|麦克风|麥克風/i.test(label)) score += 1;
  return score;
}

/**
 * Pick the best physical microphone from the enumerated input devices.
 * Skips aggregate/virtual devices (they capture system audio, not the user).
 * Returns null when every device is virtual — callers keep the default stream.
 */
export function chooseAudioInputDevice(
  devices: Pick<MediaDeviceInfo, "deviceId" | "kind" | "label">[],
): Pick<MediaDeviceInfo, "deviceId" | "kind" | "label"> | null {
  const inputs = devices.filter((d) => d.kind === "audioinput");
  if (inputs.length === 0) return null;
  let best: (typeof inputs)[number] | null = null;
  let bestScore = -1;
  for (const d of inputs) {
    const score = inputDeviceScore(d.label);
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return bestScore >= 0 ? best : null;
}

/**
 * Trim leading/trailing near-silence from a recording.
 *
 * Whisper models hallucinate (e.g. repeating YouTube ad phrases) when they hit
 * silence or soft-music regions — see openai/whisper#1783. Dictation clips
 * naturally start with mic-settling silence, so cut it before STT. Small pads
 * are kept around speech so soft onsets are never clipped.
 */
export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  threshold = 0.004,
  padMs = 120,
): Float32Array {
  if (samples.length === 0) return samples;
  const windowSize = Math.max(1, Math.round(sampleRate * 0.02));
  const pad = Math.round((sampleRate * padMs) / 1000);

  const isLoud = (from: number): boolean => {
    const end = Math.min(samples.length, from + windowSize);
    let sum = 0;
    for (let i = from; i < end; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / (end - from)) > threshold;
  };

  let first = -1;
  for (let start = 0; start < samples.length; start += windowSize) {
    if (isLoud(start)) {
      first = start;
      break;
    }
  }
  if (first === -1) return new Float32Array(0); // all silence

  let last = samples.length;
  for (let start = samples.length - windowSize; start >= 0; start -= windowSize) {
    if (isLoud(start)) {
      last = start;
      break;
    }
  }

  const from = Math.max(0, first - pad);
  const to = Math.min(samples.length, last + windowSize + pad);
  return samples.slice(from, to);
}

/**
 * Re-acquire the microphone stream from a physical input when the current
 * stream is an aggregate/virtual device. Returns the new stream, or null to
 * keep the fallback (no better device, or re-acquire failed).
 */
async function pickPhysicalMic(
  fallback: MediaStream,
  constraints: MediaTrackConstraints,
): Promise<MediaStream | null> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const chosen = chooseAudioInputDevice(devices);
    if (!chosen) return null;
    const current = fallback.getAudioTracks()[0]?.getSettings().deviceId;
    if (chosen.deviceId && chosen.deviceId !== current) {
      console.info("[voice] mic input:", chosen.label || chosen.deviceId);
      const next = await navigator.mediaDevices.getUserMedia({
        audio: { ...constraints, deviceId: { exact: chosen.deviceId } },
        video: false,
      });
      for (const t of fallback.getTracks()) t.stop();
      return next;
    }
  } catch {
    // Keep the fallback stream; device selection is best-effort.
  }
  return null;
}

function getAudioContextClass(): typeof AudioContext | null {
  if (typeof AudioContext !== "undefined") return AudioContext;
  const w = window as unknown as { webkitAudioContext?: typeof AudioContext };
  return w.webkitAudioContext ?? null;
}

/**
 * Start microphone capture. Resolves when recording has actually started.
 * `stop()` returns a WAV blob; `cancel()` aborts without producing audio.
 */
export async function startVoiceCapture(): Promise<CaptureHandle> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("mic_missing"), { code: "mic_missing" });
  }
  const Ctx = getAudioContextClass();
  if (!Ctx) {
    throw Object.assign(new Error("mic_missing"), { code: "mic_missing" });
  }

  let stream: MediaStream;
  try {
    // First call grants mic permission; device labels become visible after.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    // Prefer a real physical microphone over aggregate/virtual inputs that
    // capture system audio (that would transcribe videos instead of the user).
    const preferred = await pickPhysicalMic(stream, {
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: 1,
    });
    if (preferred) {
      stream = preferred;
    }
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      throw Object.assign(new Error("mic_denied"), { code: "mic_denied" });
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      throw Object.assign(new Error("mic_missing"), { code: "mic_missing" });
    }
    throw e;
  }

  const context = new Ctx();
  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch {
      for (const t of stream.getTracks()) t.stop();
      void context.close();
      throw Object.assign(new Error("mic_missing"), { code: "mic_missing" });
    }
  }

  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silence = context.createGain();
  silence.gain.value = 0; // keep the graph running without audible feedback

  const chunks: Float32Array[] = [];
  let settled = false;

  processor.onaudioprocess = (e) => {
    if (settled) return;
    const input = e.inputBuffer.getChannelData(0);
    // Input buffer is reused by the engine — copy before pushing.
    chunks.push(new Float32Array(input));
  };

  source.connect(processor);
  processor.connect(silence);
  silence.connect(context.destination);

  const cleanup = () => {
    settled = true;
    try {
      processor.disconnect();
      source.disconnect();
      silence.disconnect();
    } catch {
      /* already disconnected */
    }
    for (const t of stream.getTracks()) t.stop();
    void context.close().catch(() => undefined);
  };

  return {
    stop: async () => {
      if (settled) {
        cleanup();
        return encodeWavToBlob(new Float32Array(0), context.sampleRate);
      }
      const sampleRate = context.sampleRate;
      cleanup();
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const samples = new Float32Array(total);
      let offset = 0;
      for (const c of chunks) {
        samples.set(c, offset);
        offset += c.length;
      }
      // Cut leading/trailing silence so Whisper does not hallucinate over it.
      const trimmed = trimSilence(samples, sampleRate);
      return encodeWavToBlob(trimmed, sampleRate);
    },
    cancel: () => {
      cleanup();
    },
  };
}

/** Blob → base64 (no data: prefix) for Host invoke. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function extensionForMime(mime: string): string {
  if (mime.includes("mp4") || mime.includes("m4a")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  return "webm";
}
