import { describe, expect, it } from "vitest";
import {
  DEFAULT_MSG_RAIL_SIDE,
  MSG_RAIL_SIDES,
  MSG_RAIL_SIDE_ATTR,
  MSG_RAIL_SIDE_STORAGE_KEY,
  applyMsgRailSide,
  isMsgRailSide,
  loadMsgRailSide,
  parseMsgRailSide,
  saveMsgRailSide,
  setMsgRailSide,
  type MsgRailSidePrefStorage,
} from "./msgRailSidePref";

function memoryStorage(
  initial: Record<string, string> = {},
): MsgRailSidePrefStorage & { data: Record<string, string> } {
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

describe("msgRailSidePref", () => {
  it("defaults to left and rejects unknown values", () => {
    expect(DEFAULT_MSG_RAIL_SIDE).toBe("left");
    expect(parseMsgRailSide(null)).toBe("left");
    expect(parseMsgRailSide("")).toBe("left");
    expect(parseMsgRailSide("top")).toBe("left");
    expect(isMsgRailSide("left")).toBe(true);
    expect(isMsgRailSide("right")).toBe(true);
    expect(isMsgRailSide("top")).toBe(false);
    expect(MSG_RAIL_SIDES).toEqual(["left", "right"]);
  });

  it("persists and reloads", () => {
    const storage = memoryStorage();
    expect(loadMsgRailSide(storage)).toBe("left");
    saveMsgRailSide("right", storage);
    expect(storage.data[MSG_RAIL_SIDE_STORAGE_KEY]).toBe("right");
    expect(loadMsgRailSide(storage)).toBe("right");
  });

  it("applyMsgRailSide sets data-msg-rail-side", () => {
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    applyMsgRailSide("right", el);
    expect(attrs.get(MSG_RAIL_SIDE_ATTR)).toBe("right");
    applyMsgRailSide("left", el);
    expect(attrs.get(MSG_RAIL_SIDE_ATTR)).toBe("left");
  });

  it("setMsgRailSide saves and applies", () => {
    const storage = memoryStorage();
    const attrs = new Map<string, string>();
    const el = {
      setAttribute(name: string, value: string) {
        attrs.set(name, value);
      },
    };
    setMsgRailSide("right", storage, el);
    expect(storage.data[MSG_RAIL_SIDE_STORAGE_KEY]).toBe("right");
    expect(attrs.get(MSG_RAIL_SIDE_ATTR)).toBe("right");
  });
});
