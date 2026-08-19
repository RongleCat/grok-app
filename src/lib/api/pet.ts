/** API domain: desktop pet overlay */

import { invoke, isDesktopHost } from "./host";
import {
  PET_BUBBLE_WIDTH,
  petBubbleOffsetX,
  type PetFocus,
  type PetKind,
  type PetTask,
  type PetTaskPhase,
} from "@/lib/pet";

export type PetPrefs = {
  enabled: boolean;
  visible: boolean;
  shape: string;
  color: string;
  eyeColor?: string;
  bubblesEnabled?: boolean;
  sizePx: number;
  x?: number | null;
  y?: number | null;
};

/** Host overlay policy — compact idle + no cursor-poll click-through on Wayland. */
export type PetOverlayPolicy = {
  compactIdle: boolean;
  cursorClickThrough: boolean;
};

export const PET_OVERLAY_POLICY_FULL: PetOverlayPolicy = {
  compactIdle: false,
  cursorClickThrough: true,
};

export async function petPrefsGet(): Promise<PetPrefs> {
  if (!isDesktopHost()) {
    return {
      enabled: false,
      visible: false,
      shape: "hex",
      color: "green",
      eyeColor: "auto",
      bubblesEnabled: true,
      sizePx: 128,
    };
  }
  return invoke<PetPrefs>("pet_prefs_get");
}

export async function petPrefsSet(prefs: PetPrefs): Promise<PetPrefs> {
  if (!isDesktopHost()) return prefs;
  return invoke<PetPrefs>("pet_prefs_set", { prefs });
}

export async function petShow(): Promise<PetPrefs> {
  if (!isDesktopHost()) {
    return petPrefsGet();
  }
  return invoke<PetPrefs>("pet_show");
}

export async function petHide(): Promise<PetPrefs> {
  if (!isDesktopHost()) {
    return petPrefsGet();
  }
  return invoke<PetPrefs>("pet_hide");
}

export async function petToggle(): Promise<PetPrefs> {
  if (!isDesktopHost()) {
    return petPrefsGet();
  }
  return invoke<PetPrefs>("pet_toggle");
}

export async function petIsVisible(): Promise<boolean> {
  if (!isDesktopHost()) return false;
  return invoke<boolean>("pet_is_visible");
}

export async function petPushFocus(focus: PetFocus): Promise<void> {
  if (!isDesktopHost()) return;
  await invoke("pet_push_focus", {
    focus: {
      kind: focus.kind,
      sessionId: focus.sessionId,
      title: focus.title,
      toolTitle: focus.toolTitle,
      rank: focus.rank,
      updatedAt: focus.updatedAt,
    },
  });
}

export async function petPushTasks(tasks: readonly PetTask[]): Promise<void> {
  if (!isDesktopHost()) return;
  await invoke("pet_push_tasks", {
    tasks: tasks.map((task) => ({
      sessionId: task.sessionId,
      title: task.title,
      toolTitle: task.toolTitle,
      kind: task.kind,
      phase: task.phase,
      progress: task.progress,
      updatedAt: task.updatedAt,
    })),
  });
}

export async function petGetTasks(): Promise<PetTask[]> {
  if (!isDesktopHost()) return [];
  const raw = await invoke<
    Array<{
      sessionId?: string;
      title?: string | null;
      toolTitle?: string | null;
      kind?: PetKind;
      phase?: PetTaskPhase;
      progress?: number;
      updatedAt?: number;
    }>
  >("pet_get_tasks");
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row) => typeof row.sessionId === "string" && row.sessionId)
    .map((row) => ({
      sessionId: row.sessionId as string,
      title: row.title ?? null,
      toolTitle: row.toolTitle ?? null,
      kind: row.kind ?? "working",
      phase: row.phase === "done" ? "done" : "active",
      progress: typeof row.progress === "number" ? row.progress : 0,
      updatedAt: row.updatedAt ?? 0,
    }));
}

export async function petGetFocus(): Promise<PetFocus | null> {
  if (!isDesktopHost()) return null;
  const raw = await invoke<{
    kind: PetFocus["kind"];
    sessionId?: string | null;
    title?: string | null;
    toolTitle?: string | null;
    rank?: number;
    updatedAt?: number;
  } | null>("pet_get_focus");
  if (!raw) return null;
  return {
    kind: raw.kind,
    sessionId: raw.sessionId ?? null,
    title: raw.title ?? null,
    toolTitle: raw.toolTitle ?? null,
    rank: raw.rank ?? 5,
    updatedAt: raw.updatedAt ?? 0,
  };
}

export async function petOpenSettings(): Promise<void> {
  if (!isDesktopHost()) {
    window.location.hash = "#/settings/pet";
    return;
  }
  await invoke("pet_open_settings");
}

export async function petFocusSession(sessionId: string): Promise<void> {
  if (!isDesktopHost()) return;
  await invoke("pet_focus_session", { sessionId });
}

export async function petShowMain(): Promise<void> {
  if (!isDesktopHost()) return;
  await invoke("pet_show_main");
}

export type PetHitChrome = {
  markCx: number;
  markCy: number;
  markR: number;
  bubbleX: number;
  bubbleY: number;
  bubbleW: number;
  bubbleH: number;
  windowW: number;
  windowH: number;
};

export async function petSetHitChrome(chrome: PetHitChrome): Promise<void> {
  if (!isDesktopHost()) return;
  await invoke("pet_set_hit_chrome", { chrome });
}

type WorkRect = { x: number; y: number; w: number; h: number };

async function readPetMonitor() {
  const { currentMonitor, primaryMonitor } = await import(
    "@tauri-apps/api/window"
  );
  return (await currentMonitor()) ?? (await primaryMonitor());
}

function workRectFromMonitor(
  mon: {
    position: { x: number; y: number };
    size: { width: number; height: number };
    workArea?: {
      position: { x: number; y: number };
      size: { width: number; height: number };
    };
  },
  scale: number,
): WorkRect {
  const src = mon.workArea ?? { position: mon.position, size: mon.size };
  return {
    x: src.position.x / scale,
    y: src.position.y / scale,
    w: src.size.width / scale,
    h: src.size.height / scale,
  };
}

/**
 * Resize the overlay. When height changes, keep the bottom edge (the mark)
 * on screen so reserved bubble space grows upward instead of shoving the pet.
 * Open still restores the last drag origin — this is not an edge snap.
 */
export async function petSyncOverlaySize(w: number, h: number): Promise<void> {
  if (!isDesktopHost()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();
    const scale = await win.scaleFactor();
    const [inner, pos] = await Promise.all([win.innerSize(), win.outerPosition()]);
    const curW = inner.width / scale;
    const curH = inner.height / scale;
    if (Math.abs(curW - w) < 1 && Math.abs(curH - h) < 1) return;
    const nextY = Math.abs(curH - h) >= 1 ? pos.y / scale - (h - curH) : null;
    await win.setSize(new LogicalSize(w, h));
    if (nextY != null) {
      await win.setPosition(new LogicalPosition(pos.x / scale, nextY));
    }
  } catch {
    /* best-effort */
  }
}

export type PetOverlayFrame = {
  winX: number;
  winY: number;
  overlayW: number;
  overlayH: number;
  work: WorkRect;
};

/** Overlay position + monitor work area, in logical CSS pixels. */
export async function petReadOverlayFrame(): Promise<PetOverlayFrame | null> {
  if (!isDesktopHost()) return null;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const [scale, pos, size, mon] = await Promise.all([
      win.scaleFactor(),
      win.outerPosition(),
      win.innerSize(),
      readPetMonitor(),
    ]);
    if (!(scale > 0) || !mon) return null;
    return {
      winX: pos.x / scale,
      winY: pos.y / scale,
      overlayW: size.width / scale,
      overlayH: size.height / scale,
      work: workRectFromMonitor(mon, scale),
    };
  } catch {
    return null;
  }
}

export async function petReadBubbleOffset(maxOffset: number): Promise<number> {
  if (!isDesktopHost()) return 0;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const [scale, pos, size, mon] = await Promise.all([
      win.scaleFactor(),
      win.outerPosition(),
      win.outerSize(),
      readPetMonitor(),
    ]);
    if (!(scale > 0) || !mon) return 0;
    const work = workRectFromMonitor(mon, scale);
    const markX = pos.x / scale + size.width / scale / 2;
    return petBubbleOffsetX({
      leftGap: markX - work.x,
      rightGap: work.x + work.w - markX,
      bubbleWidth: PET_BUBBLE_WIDTH,
      maxOffset,
    });
  } catch {
    return 0;
  }
}

export async function petSetDragging(dragging: boolean): Promise<void> {
  if (!isDesktopHost()) return;
  await invoke("pet_set_dragging", { dragging });
}

export async function petSetMenuOpen(open: boolean): Promise<void> {
  if (!isDesktopHost()) return;
  await invoke("pet_set_menu_open", { open });
}

export async function petSetIgnoreCursor(ignore: boolean): Promise<void> {
  if (!isDesktopHost()) return;
  // Host refuses click-through on Wayland (global cursor is stubbed at 0,0).
  await invoke("pet_set_ignore_cursor", { ignore });
}

export async function petStartDragging(): Promise<void> {
  if (!isDesktopHost()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}

/** Wayland: move the overlay by logical CSS pixels (no compositor grab). */
export async function petNudge(dx: number, dy: number): Promise<void> {
  if (!isDesktopHost()) return;
  if (!dx && !dy) return;
  await invoke("pet_nudge", { dx, dy });
}

export async function petWebviewReady(): Promise<PetOverlayPolicy> {
  if (!isDesktopHost()) return PET_OVERLAY_POLICY_FULL;
  return invoke<PetOverlayPolicy>("pet_webview_ready");
}

export async function petOverlayPolicy(): Promise<PetOverlayPolicy> {
  if (!isDesktopHost()) return PET_OVERLAY_POLICY_FULL;
  return invoke<PetOverlayPolicy>("pet_overlay_policy");
}
