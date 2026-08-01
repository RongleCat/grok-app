import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { UpdaterProvider } from "./hooks/UpdaterProvider";
import "./styles/tokens.css";
import "./styles/skins.css";
import "./styles/tailwind.css";
import "streamdown/styles.css";
import "./styles/app.css";
import "./styles/setup-wizard.css";
import {
  applyNativeWindowTheme,
  applyThemeToDocument,
  getSystemTheme,
  loadThemePreference,
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
// Native: null = follow OS (required for live system theme); light/dark or
// schedule-resolved theme locks chrome so WebView matchMedia cannot fight us.
void applyNativeWindowTheme(
  bootPref === "system" && !bootSchedule.enabled ? null : bootTheme,
);
// Desktop always-on-top (localStorage; fail-closed outside Tauri).
void applyWindowAlwaysOnTop(loadWindowAlwaysOnTopPref(localStorage));

// The app has document-level capture handlers. Install the zoom handler on
// window capture so Command +/- is handled before those shortcuts.
if (
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
) {
  installZoomHotkeys(window);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UpdaterProvider>
      <App />
    </UpdaterProvider>
  </StrictMode>,
);
