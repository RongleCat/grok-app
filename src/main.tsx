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
  applyChatDensity,
  loadChatDensity,
} from "./lib/chatDensity";
import {
  applyMessageActionsVisibility,
  loadMessageActionsVisibility,
} from "./lib/messageActionsPref";

// Apply persisted theme preference (default: system) before first React paint.
const bootPref = loadThemePreference(localStorage);
const bootTheme = resolveTheme(bootPref, getSystemTheme());
applyThemeToDocument(bootTheme);
applySkinToDocument(loadSkin(localStorage));
// Chat transcript font scale (Appearance) — html[data-chat-font].
applyChatFontScale(loadChatFontScale(localStorage));
// Chat transcript density (Appearance) — html[data-chat-density].
applyChatDensity(loadChatDensity(localStorage));
// Message action buttons (Appearance) — html[data-msg-actions].
applyMessageActionsVisibility(loadMessageActionsVisibility(localStorage));
// Only the data-wallpaper flag is set synchronously (so the shell flips to
// transparent + scrim instantly). The media layer is rendered by App after
// the IndexedDB blob is loaded — no synchronous access to IDB is possible.
applyWallpaperFlag(loadWallpaperMeta(localStorage) !== null);
applyWallpaperScrimToDocument(loadWallpaperScrim(localStorage));
// Native: null = follow OS (required for live system theme); light/dark locks chrome.
void applyNativeWindowTheme(bootPref === "system" ? null : bootTheme);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UpdaterProvider>
      <App />
    </UpdaterProvider>
  </StrictMode>,
);
