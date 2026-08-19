/**
 * Unit tests for WAV encoding used by voice dictation capture.
 */
import { describe, expect, it } from "vitest";
import {
  chooseAudioInputDevice,
  encodeWavToBlob,
  isVirtualInputDevice,
  trimSilence,
} from "./voiceCapture";

async function readWavAsync(blob: Blob): Promise<{
  view: DataView;
  dataOffset: number;
}> {
  const buf = await blob.arrayBuffer();
  const view = new DataView(buf);
  return { view, dataOffset: 44 };
}

function ascii(view: DataView, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe("encodeWavToBlob", () => {
  it("produces a standard 16-bit mono PCM header", async () => {
    const blob = encodeWavToBlob(new Float32Array([0, 0.5, -0.5]), 16000);
    expect(blob.type).toBe("audio/wav");
    const { view } = await readWavAsync(blob);

    expect(ascii(view, 0, 4)).toBe("RIFF");
    // 36 + data bytes (3 samples × 2)
    expect(view.getUint32(4, true)).toBe(36 + 6);
    expect(ascii(view, 8, 4)).toBe("WAVE");
    expect(ascii(view, 12, 4)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16); // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint32(28, true)).toBe(32000); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(6); // data chunk size
  });

  it("round-trips float samples to 16-bit PCM", async () => {
    const blob = encodeWavToBlob(new Float32Array([0, 1, -1, 0.25]), 48000);
    const { view } = await readWavAsync(blob);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32767); // +1.0 clamped
    expect(view.getInt16(48, true)).toBe(-32768); // -1.0 clamped
    expect(view.getInt16(50, true)).toBe(Math.round(0.25 * 32767));
  });

  it("clamps out-of-range samples", async () => {
    const blob = encodeWavToBlob(new Float32Array([2, -2]), 8000);
    const { view } = await readWavAsync(blob);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  it("empty input still yields a valid 44-byte WAV", async () => {
    const blob = encodeWavToBlob(new Float32Array(0), 16000);
    const { view } = await readWavAsync(blob);
    expect(view.byteLength).toBe(44);
    expect(view.getUint32(4, true)).toBe(36);
    expect(view.getUint32(40, true)).toBe(0);
  });
});

describe("isVirtualInputDevice", () => {
  it("flags aggregate and virtual capture devices", () => {
    expect(isVirtualInputDevice("聚合设备")).toBe(true);
    expect(isVirtualInputDevice("Aggregate Device")).toBe(true);
    expect(isVirtualInputDevice("BlackHole 2ch")).toBe(true);
    expect(isVirtualInputDevice("Soundflower (2ch)")).toBe(true);
  });

  it("keeps physical microphones", () => {
    expect(isVirtualInputDevice("MacBook Pro麦克风")).toBe(false);
    expect(isVirtualInputDevice("外置麦克风")).toBe(false);
    expect(isVirtualInputDevice("USB Audio Device")).toBe(false);
    expect(isVirtualInputDevice("")).toBe(false);
  });
});

describe("chooseAudioInputDevice", () => {
  const dev = (
    label: string,
    deviceId = label,
  ): Pick<MediaDeviceInfo, "deviceId" | "kind" | "label"> => ({
    deviceId,
    kind: "audioinput",
    label,
  });

  it("skips the aggregate default and picks a real mic", () => {
    const picked = chooseAudioInputDevice([
      dev("聚合设备"),
      dev("MacBook Pro麦克风"),
    ]);
    expect(picked?.label).toBe("MacBook Pro麦克风");
  });

  it("prefers an external mic over the built-in one", () => {
    const picked = chooseAudioInputDevice([
      dev("MacBook Pro麦克风"),
      dev("外置麦克风"),
    ]);
    expect(picked?.label).toBe("外置麦克风");
  });

  it("returns null when every input is virtual (keep default)", () => {
    expect(chooseAudioInputDevice([dev("聚合设备")])).toBeNull();
  });

  it("returns null on empty input list", () => {
    expect(chooseAudioInputDevice([])).toBeNull();
  });

  it("ignores non-input devices", () => {
    const picked = chooseAudioInputDevice([
      { deviceId: "out1", kind: "audiooutput", label: "外置耳机" },
      dev("MacBook Pro麦克风"),
    ]);
    expect(picked?.label).toBe("MacBook Pro麦克风");
  });
});

describe("trimSilence", () => {
  // 48 kHz, 20 ms windows (960 samples), 120 ms pad (5760 samples).
  const SR = 48000;
  const silence = new Float32Array(SR * 2); // 2 s of silence
  const tone = new Float32Array(SR); // 1 s of loud signal
  tone.fill(0.2);

  it("drops leading and trailing silence around speech", () => {
    const samples = new Float32Array([
      ...silence,
      ...tone,
      ...silence,
    ]);
    const out = trimSilence(samples, SR);
    expect(out.length).toBeLessThan(tone.length + 2 * 5760 + 960);
    expect(out.length).toBeGreaterThan(tone.length);
    // Trimmed region must contain the loud signal.
    let max = 0;
    for (const s of out) max = Math.max(max, Math.abs(s));
    // Float32 rounding makes the exact value 0.20000000298…; compare with tolerance.
    expect(max).toBeCloseTo(0.2, 5);
  });

  it("keeps a constant-signal recording intact", () => {
    const samples = new Float32Array(SR);
    samples.fill(0.05);
    const out = trimSilence(samples, SR);
    expect(out.length).toBe(SR);
  });

  it("returns empty for all-silence input", () => {
    const out = trimSilence(new Float32Array(SR), SR);
    expect(out.length).toBe(0);
  });

  it("returns input unchanged when empty", () => {
    const out = trimSilence(new Float32Array(0), SR);
    expect(out.length).toBe(0);
  });
});
