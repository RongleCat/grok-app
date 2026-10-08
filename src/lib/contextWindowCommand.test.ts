import { describe, expect, it } from "vitest";
import {
  classifyContextWindowSlashLine,
  formatWindowLabel,
  leftoverContextWindowArgs,
  modelSupportsContextWindow,
  parseWindowToken,
  resolveContextWindowCommand,
  selectableContextWindows,
  stripContextWindowSlashFromDraft,
} from "./contextWindowCommand";

const OPTIONS = [256_000, 500_000];

describe("parseWindowToken", () => {
  it("accepts short labels and raw counts", () => {
    expect(parseWindowToken("256k")).toBe(256_000);
    expect(parseWindowToken("256K")).toBe(256_000);
    expect(parseWindowToken("1m")).toBe(1_000_000);
    expect(parseWindowToken("1M")).toBe(1_000_000);
    expect(parseWindowToken("500000")).toBe(500_000);
    expect(parseWindowToken(" 500k ")).toBe(500_000);
  });

  it("rejects empty, zero, fractions, and trailing junk", () => {
    expect(parseWindowToken("")).toBeNull();
    expect(parseWindowToken("0")).toBeNull();
    expect(parseWindowToken("0k")).toBeNull();
    expect(parseWindowToken("256.5k")).toBeNull();
    expect(parseWindowToken("500k extra")).toBeNull();
    expect(parseWindowToken("-1")).toBeNull();
    expect(parseWindowToken("k")).toBeNull();
  });
});

describe("formatWindowLabel", () => {
  it("uses k and m only for exact multiples", () => {
    expect(formatWindowLabel(256_000)).toBe("256k");
    expect(formatWindowLabel(1_000_000)).toBe("1m");
    expect(formatWindowLabel(1_048_576)).toBe("1048576");
    expect(formatWindowLabel(500)).toBe("500");
  });
});

describe("resolveContextWindowCommand", () => {
  it("follows the pager error order", () => {
    expect(
      resolveContextWindowCommand({
        args: "500k",
        hasModel: false,
        hasSession: false,
        options: OPTIONS,
        current: null,
      }).kind,
    ).toBe("no-model");
    expect(
      resolveContextWindowCommand({
        args: "",
        hasModel: true,
        hasSession: false,
        options: OPTIONS,
        current: 256_000,
      }).kind,
    ).toBe("no-session");
    expect(
      resolveContextWindowCommand({
        args: "500k",
        hasModel: true,
        hasSession: true,
        options: [256_000],
        current: 256_000,
      }).kind,
    ).toBe("no-options");
  });

  it("prints usage with the current window when the size is omitted", () => {
    expect(
      resolveContextWindowCommand({
        args: "",
        hasModel: true,
        hasSession: true,
        options: OPTIONS,
        current: 256_000,
      }),
    ).toEqual({
      kind: "usage",
      options: "256k|500k",
      current: " (current: 256k)",
    });
  });

  it("resolves a listed size and rejects anything else", () => {
    expect(
      resolveContextWindowCommand({
        args: "500k",
        hasModel: true,
        hasSession: true,
        options: OPTIONS,
        current: 256_000,
      }),
    ).toEqual({ kind: "switch", window: 500_000 });
    expect(
      resolveContextWindowCommand({
        args: "500000",
        hasModel: true,
        hasSession: true,
        options: OPTIONS,
        current: 256_000,
      }),
    ).toEqual({ kind: "switch", window: 500_000 });
    expect(
      resolveContextWindowCommand({
        args: "1m",
        hasModel: true,
        hasSession: true,
        options: OPTIONS,
        current: 256_000,
      }),
    ).toEqual({
      kind: "unknown",
      token: "1m",
      options: "256k, 500k",
    });
  });
});

describe("classifyContextWindowSlashLine", () => {
  it("takes a lone command and leaves other text alone", () => {
    expect(classifyContextWindowSlashLine("/context-window")).toEqual({
      args: "",
    });
    expect(classifyContextWindowSlashLine("  /context-window 500k")).toEqual({
      args: "500k",
    });
    expect(classifyContextWindowSlashLine("/Context-Window 500000")).toEqual({
      args: "500000",
    });
    expect(
      classifyContextWindowSlashLine("/context-window 500k\n\nmore"),
    ).toBeNull();
    expect(classifyContextWindowSlashLine("/compact")).toBeNull();
    expect(classifyContextWindowSlashLine("hello")).toBeNull();
  });

  it("reads and strips same-line args after the slash token", () => {
    const stored = "/context-window 500k\nkeep";
    const end = "/context-window".length;
    expect(leftoverContextWindowArgs(stored, end)).toBe("500k");
    expect(stripContextWindowSlashFromDraft(stored, 0, end)).toBe("keep");
  });
});

describe("selectableContextWindows", () => {
  it("needs more than one advertised window", () => {
    expect(
      selectableContextWindows({
        contextWindow: 256_000,
        contextWindows: [256_000, 500_000],
      }),
    ).toEqual([256_000, 500_000]);
    expect(
      selectableContextWindows({
        contextWindow: 256_000,
        contextWindows: [256_000],
      }),
    ).toEqual([]);
    expect(selectableContextWindows({ contextWindow: 256_000 })).toEqual([]);
  });

  it("treats the catalog default as supported even when the list is absent", () => {
    expect(
      modelSupportsContextWindow({ contextWindow: 256_000 }, 256_000),
    ).toBe(true);
    expect(
      modelSupportsContextWindow(
        { contextWindow: 256_000, contextWindows: [256_000, 500_000] },
        500_000,
      ),
    ).toBe(true);
    expect(
      modelSupportsContextWindow(
        { contextWindow: 256_000, contextWindows: [256_000, 500_000] },
        128_000,
      ),
    ).toBe(false);
  });
});
