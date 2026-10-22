/**
 * Cross-window appearance sync (theme editor OS window ↔ main workbench).
 * Same-window CustomEvents still fire; other webviews get Tauri emit + storage.
 */
import {
  applyChatDensity,
  loadChatDensity,
} from "@/lib/chatDensity";
import {
  applyChatFontScale,
  loadChatFontScale,
} from "@/lib/chatFontScale";
import {
  applyChatWidth,
  loadChatWidth,
} from "@/lib/chatWidthPref";
import {
  applyCodeFontScale,
  loadCodeFontScale,
} from "@/lib/codeFontScalePref";
import {
  applyMessageActionsVisibility,
  loadMessageActionsVisibility,
} from "@/lib/messageActionsPref";
import {
  applySidebarDensity,
  loadSidebarDensity,
} from "@/lib/sidebarDensity";
import { applyUiFontFamily, loadUiFontFamily } from "@/lib/uiFontPref";
import {
  loadMessageTimestampsPref,
  MESSAGE_TIMESTAMPS_CHANGE_EVENT,
} from "@/lib/messageTimestampsPref";
import {
  loadShowReplyLengthPref,
  SHOW_REPLY_LENGTH_CHANGE_EVENT,
} from "@/lib/messageLength";
import {
  loadReplaceProviderBrandLogoPref,
  REPLACE_PROVIDER_BRAND_LOGO_CHANGE_EVENT,
} from "@/lib/replaceProviderBrandLogoPref";
import {
  loadWelcomeMotionPref,
  WELCOME_MOTION_CHANGE_EVENT,
} from "@/lib/welcomeMotionPref";
import {
  applyOutputMotionToDocument,
  loadOutputMotionPref,
  OUTPUT_MOTION_CHANGE_EVENT,
} from "@/lib/outputMotionPref";
import {
  loadGoalOrchUiEnabled,
  GOAL_ORCH_UI_CHANGE_EVENT,
} from "@/lib/goalOrch";
import {
  loadMessageTimeFormatPref,
  MESSAGE_TIME_FORMAT_CHANGE_EVENT,
} from "@/lib/messageTimeFormatPref";
import {
  loadSidebarShowRelativeTimePref,
  SIDEBAR_SHOW_RELATIVE_TIME_CHANGE_EVENT,
} from "@/lib/sidebarShowRelativeTimePref";
import { loadZenMode, ZEN_MODE_CHANGE_EVENT } from "@/lib/zenMode";

export const APPEARANCE_CHANGED_EVENT = "grok://appearance-changed";

export type AppearanceChangedPayload = {
  origin: string;
};

let originCache: string | null = null;

export async function appearanceWindowOrigin(): Promise<string> {
  if (originCache) return originCache;
  try {
    if (
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
    ) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      originCache = getCurrentWindow().label;
      return originCache;
    }
  } catch {
    /* browser */
  }
  originCache = "web";
  return originCache;
}

export function notifyAppearanceChanged(): void {
  void (async () => {
    const origin = await appearanceWindowOrigin();
    const payload: AppearanceChangedPayload = { origin };
    try {
      window.dispatchEvent(
        new CustomEvent(APPEARANCE_CHANGED_EVENT, { detail: payload }),
      );
    } catch {
      /* ignore */
    }
    try {
      if (
        typeof window !== "undefined" &&
        ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
      ) {
        const { emit } = await import("@tauri-apps/api/event");
        await emit(APPEARANCE_CHANGED_EVENT, payload);
      }
    } catch {
      /* ignore */
    }
  })();
}

function dispatchBool(name: string, value: boolean): void {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail: value }));
  } catch {
    /* ignore */
  }
}

/** Re-apply document CSS + ping workbench pref listeners from storage. */
export function hydrateDocumentAppearancePrefs(): void {
  applyChatFontScale(loadChatFontScale());
  applyCodeFontScale(loadCodeFontScale());
  applyUiFontFamily(loadUiFontFamily());
  applyChatDensity(loadChatDensity());
  applyChatWidth(loadChatWidth());
  applySidebarDensity(loadSidebarDensity());
  applyMessageActionsVisibility(loadMessageActionsVisibility());
  dispatchBool(MESSAGE_TIMESTAMPS_CHANGE_EVENT, loadMessageTimestampsPref());
  dispatchBool(SHOW_REPLY_LENGTH_CHANGE_EVENT, loadShowReplyLengthPref());
  dispatchBool(
    REPLACE_PROVIDER_BRAND_LOGO_CHANGE_EVENT,
    loadReplaceProviderBrandLogoPref(),
  );
  dispatchBool(WELCOME_MOTION_CHANGE_EVENT, loadWelcomeMotionPref());
  const outputMotionEnabled = loadOutputMotionPref();
  applyOutputMotionToDocument(outputMotionEnabled);
  dispatchBool(OUTPUT_MOTION_CHANGE_EVENT, outputMotionEnabled);
  dispatchBool(GOAL_ORCH_UI_CHANGE_EVENT, loadGoalOrchUiEnabled());
  dispatchBool(
    SIDEBAR_SHOW_RELATIVE_TIME_CHANGE_EVENT,
    loadSidebarShowRelativeTimePref(),
  );
  dispatchBool(ZEN_MODE_CHANGE_EVENT, loadZenMode());
  try {
    window.dispatchEvent(
      new CustomEvent(MESSAGE_TIME_FORMAT_CHANGE_EVENT, {
        detail: loadMessageTimeFormatPref(),
      }),
    );
  } catch {
    /* ignore */
  }
}

export function subscribeAppearanceChanged(
  handler: (payload: AppearanceChangedPayload) => void,
): () => void {
  const onCustom = (ev: Event) => {
    const detail = (ev as CustomEvent<AppearanceChangedPayload>).detail;
    handler(detail ?? { origin: "web" });
  };
  const onStorage = () => handler({ origin: "storage" });
  window.addEventListener(APPEARANCE_CHANGED_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  let unlistenTauri: (() => void) | undefined;
  void (async () => {
    try {
      if (
        typeof window !== "undefined" &&
        ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
      ) {
        const { listen } = await import("@tauri-apps/api/event");
        const un = await listen<AppearanceChangedPayload>(
          APPEARANCE_CHANGED_EVENT,
          (e) => handler(e.payload ?? { origin: "tauri" }),
        );
        unlistenTauri = un;
      }
    } catch {
      /* ignore */
    }
  })();
  return () => {
    window.removeEventListener(APPEARANCE_CHANGED_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
    unlistenTauri?.();
  };
}
