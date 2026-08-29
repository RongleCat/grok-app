import { describe, expect, it } from "vitest";
import {
  DEFAULT_MESSAGE_ACTIONS_VISIBILITY,
  MESSAGE_ACTIONS_VISIBILITIES,
  MESSAGE_ACTIONS_VISIBILITY_ATTR,
  MESSAGE_ACTIONS_VISIBILITY_STORAGE_KEY,
  applyMessageActionsVisibility,
  isMessageActionsVisibility,
  loadMessageActionsVisibility,
  parseMessageActionsVisibility,
  saveMessageActionsVisibility,
  setMessageActionsVisibility,
  type MessageActionsPrefStorage,
} from "./messageActionsPref";

function memoryStorage(
  initial: Record<string, string> = {},
): MessageActionsPrefStorage & { data: Record<string, string> } {
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

describe("messageActionsPref", () => {
  it("defaults to always and rejects unknown values", () => {
    expect(DEFAULT_MESSAGE_ACTIONS_VISIBILITY).toBe("always");
    expect(parseMessageActionsVisibility(null)).toBe("always");
    expect(parseMessageActionsVisibility("")).toBe("always");
    expect(parseMessageActionsVisibility("visible")).toBe("always");
    expect(isMessageActionsVisibility("hover")).toBe(true);
    expect(isMessageActionsVisibility("always")).toBe(true);
    expect(isMessageActionsVisibility("never")).toBe(false);
    expect(MESSAGE_ACTIONS_VISIBILITIES).toEqual(["always", "hover"]);
  });

  it("persists and reloads after simulated relaunch", () => {
    const storage = memoryStorage();
    expect(loadMessageActionsVisibility(storage)).toBe("always");
    saveMessageActionsVisibility("hover", storage);
    expect(storage.data[MESSAGE_ACTIONS_VISIBILITY_STORAGE_KEY]).toBe(
      "hover",
    );
    expect(loadMessageActionsVisibility(storage)).toBe("hover");
    saveMessageActionsVisibility("always", storage);
    expect(loadMessageActionsVisibility(storage)).toBe("always");
  });

  it("applyMessageActionsVisibility sets data-msg-actions", () => {
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    applyMessageActionsVisibility("always", el);
    expect(attrs.get(MESSAGE_ACTIONS_VISIBILITY_ATTR)).toBe("always");
    applyMessageActionsVisibility("hover", el);
    expect(attrs.get(MESSAGE_ACTIONS_VISIBILITY_ATTR)).toBe("hover");
  });

  it("setMessageActionsVisibility saves and applies", () => {
    const storage = memoryStorage();
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    setMessageActionsVisibility("always", storage, el);
    expect(storage.data[MESSAGE_ACTIONS_VISIBILITY_STORAGE_KEY]).toBe(
      "always",
    );
    expect(attrs.get(MESSAGE_ACTIONS_VISIBILITY_ATTR)).toBe("always");
  });
});
