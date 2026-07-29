import { describe, expect, it } from "vitest";
import {
  DEFAULT_MESSAGE_TIME_FORMAT,
  MESSAGE_TIME_FORMAT_STORAGE_KEY,
  isMessageTimeFormat,
  loadMessageTimeFormatPref,
  parseMessageTimeFormat,
  saveMessageTimeFormatPref,
  type MessageTimeFormatStorage,
} from "./messageTimeFormatPref";

function memoryStorage(
  initial: Record<string, string> = {},
): MessageTimeFormatStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

describe("messageTimeFormatPref", () => {
  it("defaults to absolute", () => {
    expect(DEFAULT_MESSAGE_TIME_FORMAT).toBe("absolute");
    expect(parseMessageTimeFormat(null)).toBe("absolute");
    expect(parseMessageTimeFormat("")).toBe("absolute");
    expect(parseMessageTimeFormat("maybe")).toBe("absolute");
    expect(loadMessageTimeFormatPref(memoryStorage())).toBe("absolute");
  });

  it("parses absolute/relative", () => {
    expect(isMessageTimeFormat("absolute")).toBe(true);
    expect(isMessageTimeFormat("relative")).toBe(true);
    expect(isMessageTimeFormat("iso")).toBe(false);
    expect(parseMessageTimeFormat("absolute")).toBe("absolute");
    expect(parseMessageTimeFormat("relative")).toBe("relative");
  });

  it("round-trips preference", () => {
    const s = memoryStorage();
    saveMessageTimeFormatPref("relative", s);
    expect(s.data[MESSAGE_TIME_FORMAT_STORAGE_KEY]).toBe("relative");
    expect(loadMessageTimeFormatPref(s)).toBe("relative");
    saveMessageTimeFormatPref("absolute", s);
    expect(s.data[MESSAGE_TIME_FORMAT_STORAGE_KEY]).toBe("absolute");
    expect(loadMessageTimeFormatPref(s)).toBe("absolute");
  });
});
