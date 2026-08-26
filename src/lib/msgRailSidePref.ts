/**
 * Conversation progress rail side (Appearance → Interface).
 * localStorage-only — no Rust AppSettings.
 * Applied via `data-msg-rail-side` on `document.documentElement`.
 */

export type MsgRailSide = "left" | "right";

export const MSG_RAIL_SIDE_STORAGE_KEY = "grok.msgRailSide";
export const DEFAULT_MSG_RAIL_SIDE: MsgRailSide = "left";
export const MSG_RAIL_SIDE_ATTR = "data-msg-rail-side";
export const MSG_RAIL_SIDE_CHANGE_EVENT = "grok-msg-rail-side";

export const MSG_RAIL_SIDES: readonly MsgRailSide[] = ["left", "right"] as const;

export interface MsgRailSidePrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isMsgRailSide(value: unknown): value is MsgRailSide {
  return value === "left" || value === "right";
}

export function parseMsgRailSide(raw: unknown): MsgRailSide {
  if (typeof raw === "string" && isMsgRailSide(raw)) return raw;
  return DEFAULT_MSG_RAIL_SIDE;
}

export function loadMsgRailSide(
  storage: MsgRailSidePrefStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): MsgRailSide {
  try {
    return parseMsgRailSide(storage.getItem(MSG_RAIL_SIDE_STORAGE_KEY));
  } catch {
    return DEFAULT_MSG_RAIL_SIDE;
  }
}

export function saveMsgRailSide(
  side: MsgRailSide,
  storage: MsgRailSidePrefStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): void {
  try {
    storage.setItem(MSG_RAIL_SIDE_STORAGE_KEY, side);
  } catch {
    /* private mode / quota */
  }
}

export interface MsgRailSidePrefRoot {
  setAttribute(name: string, value: string): void;
}

export function applyMsgRailSide(
  side: MsgRailSide,
  root: MsgRailSidePrefRoot = typeof document !== "undefined"
    ? document.documentElement
    : { setAttribute: () => {} },
): void {
  root.setAttribute(MSG_RAIL_SIDE_ATTR, side);
}

export function dispatchMsgRailSideChange(side: MsgRailSide): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(MSG_RAIL_SIDE_CHANGE_EVENT, { detail: side }),
    );
  } catch {
    /* ignore */
  }
}

export function setMsgRailSide(
  side: MsgRailSide,
  storage?: MsgRailSidePrefStorage,
  root?: MsgRailSidePrefRoot,
): void {
  saveMsgRailSide(side, storage);
  applyMsgRailSide(side, root);
  dispatchMsgRailSideChange(side);
}

export function readMsgRailSideFromDocument(
  root: { getAttribute(name: string): string | null } | null = typeof document !==
  "undefined"
    ? document.documentElement
    : null,
): MsgRailSide {
  return parseMsgRailSide(root?.getAttribute(MSG_RAIL_SIDE_ATTR));
}
