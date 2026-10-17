/** API domain: pet quick bar (floating prompt window next to the desktop pet). */

import { invoke, isDesktopHost } from "./host";

export type PetQuickRecent = {
  id: string;
  title: string;
  project: string;
  pinned: boolean;
  updatedAt: number;
};

/** Payload the workbench receives on `pet://quick-prompt`. */
export type PetQuickPrompt = {
  /** null → start a new chat. */
  sessionId: string | null;
  text: string;
};

export const PET_QUICK_DEFAULT_HOTKEY = "Alt+Super+P";

export async function petQuickRecent(): Promise<PetQuickRecent[]> {
  if (!isDesktopHost()) return [];
  const rows = await invoke<PetQuickRecent[]>("pet_quick_recent");
  return Array.isArray(rows) ? rows : [];
}

export async function petQuickShow(): Promise<void> {
  if (!isDesktopHost()) return;
  await invoke("pet_quick_show");
}

export async function petQuickHide(): Promise<void> {
  if (!isDesktopHost()) return;
  await invoke("pet_quick_hide");
}

export async function petQuickSend(opts: {
  sessionId: string | null;
  text: string;
  openMain: boolean;
}): Promise<void> {
  if (!isDesktopHost()) return;
  await invoke("pet_quick_send", {
    sessionId: opts.sessionId,
    text: opts.text,
    openMain: opts.openMain,
  });
}

/** Pet menu "New chat": raise the workbench on a fresh chat. */
export async function petQuickNewChat(): Promise<void> {
  if (!isDesktopHost()) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await invoke("pet_show_main");
  await emitTo("main", "tray://new-chat");
}

export async function petQuickHotkeyGet(): Promise<string> {
  if (!isDesktopHost()) return PET_QUICK_DEFAULT_HOTKEY;
  return invoke<string>("pet_quick_hotkey_get");
}

/** Saves + re-registers; rejects (keeping the old key) when the OS refuses it. */
export async function petQuickHotkeySet(hotkey: string): Promise<string> {
  if (!isDesktopHost()) return hotkey;
  return invoke<string>("pet_quick_hotkey_set", { hotkey });
}

/** Pure: normalize a typed accelerator ("alt + win + p" → "Alt+Super+P"). */
export function normalizePetHotkey(raw: string): string {
  const alias: Record<string, string> = {
    win: "Super",
    windows: "Super",
    meta: "Super",
    cmd: "Super",
    command: "Super",
    super: "Super",
    ctrl: "Control",
    control: "Control",
    alt: "Alt",
    option: "Alt",
    shift: "Shift",
  };
  return raw
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => alias[p.toLowerCase()] ?? (p.length === 1 ? p.toUpperCase() : p))
    .join("+");
}

/** Pure: sanitize a `pet://quick-prompt` payload; null when unusable. */
export function parsePetQuickPrompt(raw: unknown): PetQuickPrompt | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { sessionId?: unknown; text?: unknown };
  const text = typeof r.text === "string" ? r.text.trim() : "";
  if (!text) return null;
  const sid =
    typeof r.sessionId === "string" && r.sessionId.trim() ? r.sessionId.trim() : null;
  return { sessionId: sid, text };
}
