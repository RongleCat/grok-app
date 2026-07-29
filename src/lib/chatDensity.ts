/**
 * Chat transcript density (Appearance).
 * localStorage-only — no Rust AppSettings (avoids prefs schema conflicts).
 * Applied via `data-chat-density` on `document.documentElement`.
 *
 * - `comfortable` (default): current spacing
 * - `compact`: tighter item / bubble / list gaps
 */

export type ChatDensity = "comfortable" | "compact";

export const CHAT_DENSITY_STORAGE_KEY = "grok.chatDensity";
export const DEFAULT_CHAT_DENSITY: ChatDensity = "comfortable";
export const CHAT_DENSITY_ATTR = "data-chat-density";

export const CHAT_DENSITIES: readonly ChatDensity[] = [
  "comfortable",
  "compact",
] as const;

export interface ChatDensityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isChatDensity(value: unknown): value is ChatDensity {
  return value === "comfortable" || value === "compact";
}

export function parseChatDensity(raw: unknown): ChatDensity {
  if (typeof raw === "string" && isChatDensity(raw)) return raw;
  return DEFAULT_CHAT_DENSITY;
}

export function loadChatDensity(
  storage: ChatDensityStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): ChatDensity {
  try {
    return parseChatDensity(storage.getItem(CHAT_DENSITY_STORAGE_KEY));
  } catch {
    return DEFAULT_CHAT_DENSITY;
  }
}

export function saveChatDensity(
  density: ChatDensity,
  storage: ChatDensityStorage = typeof localStorage !== "undefined"
    ? localStorage
    : { getItem: () => null, setItem: () => {} },
): void {
  try {
    storage.setItem(CHAT_DENSITY_STORAGE_KEY, density);
  } catch {
    /* private mode / quota */
  }
}

/** Minimal DOM surface so unit tests need no jsdom. */
export interface ChatDensityRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute?(name: string): void;
}

/**
 * Apply density to document via `data-chat-density`
 * (`html[data-chat-density="compact|comfortable"] .lobe-chat`).
 * Always sets the attribute so CSS overrides apply explicitly.
 */
export function applyChatDensity(
  density: ChatDensity,
  root: ChatDensityRoot = typeof document !== "undefined"
    ? document.documentElement
    : { setAttribute: () => {} },
): void {
  root.setAttribute(CHAT_DENSITY_ATTR, density);
}

/** Persist + apply in one step (Settings onChange). */
export function setChatDensity(
  density: ChatDensity,
  storage?: ChatDensityStorage,
  root?: ChatDensityRoot,
): void {
  saveChatDensity(density, storage);
  applyChatDensity(density, root);
}
