import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { PetApp } from "./components/pet/PetApp";
import { isPetShellHash } from "@/lib/pet/petShell";
import { UpdaterProvider } from "./hooks/UpdaterProvider";
import "./styles/tokens.css";
import "./styles/skins.css";
import "./styles/tailwind.css";
import "streamdown/styles.css";
import "./styles/app.css";
import "./styles/setup-wizard.css";
import { detectAppPlatform } from "./lib/appPlatform";
import {
  applyNativeWindowTheme,
  applyThemeToDocument,
  getSystemTheme,
  loadThemePreference,
  nativeWindowThemeArg,
  resolveTheme,
} from "./lib/theme";
import {
  isThemeScheduleActive,
  loadThemeSchedule,
  resolveThemeFromSchedule,
} from "./lib/themeSchedule";
import {
  applySkinToDocument,
  applyWallpaperFlag,
  applyWallpaperScrimToDocument,
  loadSkin,
  loadWallpaperMeta,
  loadWallpaperScrim,
} from "./lib/themeSkin";
import {
  applyChatFontScale,
  loadChatFontScale,
} from "./lib/chatFontScale";
import {
  applyCodeFontScale,
  loadCodeFontScale,
} from "./lib/codeFontScalePref";
import { applyUiFontFamily, loadUiFontFamily } from "./lib/uiFontPref";
import {
  applyChatDensity,
  loadChatDensity,
} from "./lib/chatDensity";
import {
  applyChatWidth,
  loadChatWidth,
} from "./lib/chatWidthPref";
import {
  applySidebarDensity,
  loadSidebarDensity,
} from "./lib/sidebarDensity";
import {
  applyMessageActionsVisibility,
  loadMessageActionsVisibility,
} from "./lib/messageActionsPref";
import {
  applyComposerMinRows,
  loadComposerMinRows,
} from "./lib/composerMinRows";
import {
  applyWindowAlwaysOnTop,
  loadWindowAlwaysOnTopPref,
} from "./lib/windowAlwaysOnTop";
import { installZoomHotkeys } from "./lib/zoomHotkeys";

// Apply persisted theme preference (default: system) before first React paint.
// Optional clock schedule (under System) wins over OS scheme when enabled.
const bootPref = loadThemePreference(localStorage);
const bootSchedule = loadThemeSchedule(localStorage);
const bootTheme = isThemeScheduleActive(bootPref, bootSchedule)
  ? resolveThemeFromSchedule(new Date(), bootSchedule)
  : resolveTheme(bootPref, getSystemTheme());
applyThemeToDocument(bootTheme);
applySkinToDocument(loadSkin(localStorage));
// Chat transcript font scale (Appearance) — html[data-chat-font].
applyChatFontScale(loadChatFontScale(localStorage));
// Chat code block font scale (Appearance) — html[data-code-font].
applyCodeFontScale(loadCodeFontScale(localStorage));
// UI sans font family (Appearance) — --font-sans override.
applyUiFontFamily(loadUiFontFamily(localStorage));
// Chat transcript density (Appearance) — html[data-chat-density].
applyChatDensity(loadChatDensity(localStorage));
// Chat transcript reading width (Appearance) — html[data-chat-width].
applyChatWidth(loadChatWidth(localStorage));
// Sidebar session list density (Appearance) — html[data-sidebar-density].
// Boot: skip notify (no listeners yet); App will load metrics from localStorage.
applySidebarDensity(loadSidebarDensity(localStorage), undefined, false);
// Message action buttons (Appearance) — html[data-msg-actions].
applyMessageActionsVisibility(loadMessageActionsVisibility(localStorage));
// Composer empty min-height (General → Composer) — html[data-composer-min-rows].
applyComposerMinRows(loadComposerMinRows(localStorage));
// Only the data-wallpaper flag is set synchronously (so the shell flips to
// transparent + scrim instantly). The media layer is rendered by App after
// the IndexedDB blob is loaded — no synchronous access to IDB is possible.
applyWallpaperFlag(loadWallpaperMeta(localStorage) !== null);
applyWallpaperScrimToDocument(loadWallpaperScrim(localStorage));
// macOS: null = follow OS (live matchMedia). Windows: lock to the resolved
// theme — WebView2 matchMedia does not track Personalization flips.
void applyNativeWindowTheme(
  nativeWindowThemeArg(
    bootPref,
    bootSchedule.enabled,
    bootTheme,
    detectAppPlatform(),
  ),
);
const petShell =
  typeof window !== "undefined" && isPetShellHash(window.location.hash);

if (petShell) {
  document.documentElement.setAttribute("data-pet-shell", "1");
  document.querySelector(".boot-gate")?.setAttribute("hidden", "");
} else {
  // Desktop always-on-top (localStorage; fail-closed outside Tauri).
  // Never run this on the pet overlay — it would clear Rust always_on_top.
  void applyWindowAlwaysOnTop(loadWindowAlwaysOnTopPref(localStorage));

  // The app has document-level capture handlers. Install the zoom handler on
  // window capture so Command +/- is handled before those shortcuts.
  if (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  ) {
    installZoomHotkeys(window);
  }
}

// Kill the native WebView right-click menu app-wide (copy/paste/reload/etc.).
// Product menus are custom React `onContextMenu` handlers (session rows, chat
// cards, side tabs, project list, image/video viewers, resource viewer, …)
// that render the app's ContextMenu and call preventDefault themselves — they
// still fire because this listener only prevents the default action and never
// stops propagation. Runs on every document built from this bundle (incl.
// additional webviews).
document.addEventListener(
  "contextmenu",
  (e) => {
    e.preventDefault();
  },
  true,
);

// macOS WKWebView quirk: right-clicking inside a `contenteditable` shows the
// native editing menu (Cut/Copy/Paste) even when `contextmenu` is
// preventDefault'd — the editing menu is attached by the system text-input
// machinery (based on the element's editability at the right-click), not by
// the DOM event default. Temporarily mark the editor non-editable from the
// right-button mousedown (before the hit-test that decides the menu), then
// restore editability + the user's selection right after the right-click has
// settled. Plain `<input>`/`<textarea>` keep the native editing menu (useful
// and expected there).
let ctxSuppressEl: HTMLElement | null = null;
let ctxSuppressPrev = "";
let ctxSuppressRange: Range | null = null;
let ctxSuppressTimer: number | null = null;

function clearCtxSuppress() {
  if (ctxSuppressTimer != null) {
    window.clearTimeout(ctxSuppressTimer);
    ctxSuppressTimer = null;
  }
  if (ctxSuppressEl) {
    try {
      ctxSuppressEl.contentEditable = ctxSuppressPrev || "true";
    } catch {
      /* element detached — ignore */
    }
    ctxSuppressEl = null;
  }
  if (ctxSuppressRange) {
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(ctxSuppressRange);
    }
    ctxSuppressRange = null;
  }
  ctxSuppressPrev = "";
}

function editableAncestorOf(
  target: EventTarget | null,
): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest(
    '[contenteditable="true"], [contenteditable="plaintext-only"]',
  ) as HTMLElement | null;
}

// Flip before the contextmenu event so the native menu builder sees a
// non-editable element. Only right-button; never touches left-click editing.
document.addEventListener(
  "mousedown",
  (e) => {
    if (e.button !== 2) return;
    const el = editableAncestorOf(e.target);
    if (!el) return;
    clearCtxSuppress();
    const sel = window.getSelection();
    if (
      sel &&
      sel.rangeCount > 0 &&
      sel.anchorNode &&
      el.contains(sel.anchorNode)
    ) {
      ctxSuppressRange = sel.getRangeAt(0).cloneRange();
    }
    ctxSuppressEl = el;
    ctxSuppressPrev = el.contentEditable;
    el.contentEditable = "false";
    ctxSuppressTimer = window.setTimeout(clearCtxSuppress, 700);
  },
  true,
);

// Keep the editor non-editable through the contextmenu default action, then
// restore once the right-click has settled (our custom menu owns the rest).
document.addEventListener(
  "contextmenu",
  (e) => {
    e.preventDefault();
    if (ctxSuppressTimer != null) {
      window.clearTimeout(ctxSuppressTimer);
    }
    ctxSuppressTimer = window.setTimeout(clearCtxSuppress, 350);
  },
  true,
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {petShell ? (
      <PetApp />
    ) : (
      <UpdaterProvider>
        <App />
      </UpdaterProvider>
    )}
  </StrictMode>,
);
