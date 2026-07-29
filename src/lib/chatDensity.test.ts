import { describe, expect, it } from "vitest";
import {
  CHAT_DENSITIES,
  CHAT_DENSITY_ATTR,
  CHAT_DENSITY_STORAGE_KEY,
  DEFAULT_CHAT_DENSITY,
  applyChatDensity,
  isChatDensity,
  loadChatDensity,
  parseChatDensity,
  saveChatDensity,
  setChatDensity,
  type ChatDensityStorage,
} from "./chatDensity";

function memoryStorage(
  initial: Record<string, string> = {},
): ChatDensityStorage & { data: Record<string, string> } {
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

describe("chatDensity", () => {
  it("defaults to comfortable and rejects unknown values", () => {
    expect(DEFAULT_CHAT_DENSITY).toBe("comfortable");
    expect(parseChatDensity(null)).toBe("comfortable");
    expect(parseChatDensity("")).toBe("comfortable");
    expect(parseChatDensity("dense")).toBe("comfortable");
    expect(isChatDensity("comfortable")).toBe(true);
    expect(isChatDensity("compact")).toBe(true);
    expect(isChatDensity("dense")).toBe(false);
    expect(CHAT_DENSITIES).toEqual(["comfortable", "compact"]);
  });

  it("persists and reloads after simulated relaunch", () => {
    const storage = memoryStorage();
    expect(loadChatDensity(storage)).toBe("comfortable");
    saveChatDensity("compact", storage);
    expect(storage.data[CHAT_DENSITY_STORAGE_KEY]).toBe("compact");
    expect(loadChatDensity(storage)).toBe("compact");
    saveChatDensity("comfortable", storage);
    expect(loadChatDensity(storage)).toBe("comfortable");
  });

  it("applyChatDensity sets data-chat-density", () => {
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    applyChatDensity("compact", el);
    expect(attrs.get(CHAT_DENSITY_ATTR)).toBe("compact");
    applyChatDensity("comfortable", el);
    expect(attrs.get(CHAT_DENSITY_ATTR)).toBe("comfortable");
  });

  it("setChatDensity saves and applies", () => {
    const storage = memoryStorage();
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    setChatDensity("compact", storage, el);
    expect(storage.data[CHAT_DENSITY_STORAGE_KEY]).toBe("compact");
    expect(attrs.get(CHAT_DENSITY_ATTR)).toBe("compact");
  });
});
