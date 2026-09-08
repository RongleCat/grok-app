/**
 * Standalone OS window for appearance — same chrome as the main workbench.
 * macOS Overlay traffic lights; Windows/Linux self-drawn caption buttons.
 */
import { useEffect, useState } from "react";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { ImageViewerProvider } from "@/components/ImageViewer";
import {
  WindowControls,
  tauriDragRegion,
  titlebarMaximizeHandlers,
} from "@/components/WindowControls";
import { SettingsModelProvider } from "@/providers/SettingsModelContext";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { SkinShareProvider } from "@/providers/SkinShareProvider";
import { useAppearanceEditorModel } from "@/hooks/useAppearanceEditorModel";
import {
  detectAppPlatform,
  usesCustomWindowChrome,
} from "@/lib/appPlatform";
import { isDesktopHost } from "@/lib/api";
import { focusMainWindow } from "@/lib/api/system";
import {
  applyThemeEditorHtmlLang,
  OPEN_SETTINGS_FROM_EDITOR_EVENT,
  readThemeEditorBootLocale,
  type OpenSettingsFromEditorPayload,
} from "@/lib/themeEditorShell";
import {
  parseLocalePreference,
  resolveLocalePreference,
  type Locale,
} from "@/i18n";

function ThemeEditorBody() {
  const platform = detectAppPlatform();
  const customChrome = usesCustomWindowChrome(platform) && isDesktopHost();
  const [locale, setLocale] = useState<Locale>(() => readThemeEditorBootLocale());
  const dragRegion = tauriDragRegion(platform);
  const titlebarMax = titlebarMaximizeHandlers();

  useEffect(() => {
    applyThemeEditorHtmlLang(locale);
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { settingsGet } = await import("@/lib/api/settings");
        const s = await settingsGet();
        if (cancelled) return;
        const pref = parseLocalePreference(s.locale);
        setLocale(resolveLocalePreference(pref));
      } catch {
        /* browser / host busy — boot locale already applied */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cache main-workbench aspect so wallpaper focus / export bake match the
  // main window — not this editor window's own size.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let disposed = false;
    void import("@/lib/wallpaperExportBake").then(({ watchWallpaperViewportAspect }) =>
      watchWallpaperViewportAspect(() => {
        /* cache side-effect only */
      }).then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      }),
    );
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove(
      "platform-mac",
      "platform-win",
      "platform-linux",
      "platform-other",
    );
    if (platform === "mac") root.classList.add("platform-mac");
    if (platform === "win") root.classList.add("platform-win");
    if (platform === "linux") root.classList.add("platform-linux");
    if (platform === "other") root.classList.add("platform-other");
    document.querySelector(".boot-gate")?.setAttribute("hidden", "");
  }, [platform]);

  const closeWindow = () => {
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().close();
      } catch {
        /* browser */
      }
    })();
  };

  const { model, toast } = useAppearanceEditorModel({
    open: true,
    locale,
    onClose: closeWindow,
    onNavigateSettings: (section, tab) => {
      void (async () => {
        try {
          const { emit } = await import("@tauri-apps/api/event");
          const payload: OpenSettingsFromEditorPayload = { section, tab };
          await emit(OPEN_SETTINGS_FROM_EDITOR_EVENT, payload);
        } catch {
          /* ignore */
        }
        try {
          await focusMainWindow();
        } catch {
          /* ignore */
        }
      })();
    },
  });

  return (
    <div
      className={
        "theme-editor-shell app-shell" +
        ` platform-${platform}` +
        (customChrome ? " has-custom-chrome" : "")
      }
      data-testid="theme-editor-shell"
    >
      <WindowControls
        visible={customChrome}
        labels={{
          minimize: model.t("window.minimize"),
          maximize: model.t("window.maximize"),
          restore: model.t("window.restore"),
          close: model.t("window.close"),
        }}
      />
      <div
        className="theme-editor-shell__chrome"
        data-tauri-drag-region={dragRegion}
        aria-hidden
        {...titlebarMax}
      />
      <div className="theme-editor-shell__body">
        <h1 className="theme-editor-shell__title sr-only">
          {model.t("user.themeEditor")}
        </h1>
        <ImageViewerProvider locale={locale}>
          <SettingsModelProvider value={model}>
            <AppearanceSection />
          </SettingsModelProvider>
        </ImageViewerProvider>
      </div>
      {toast ? (
        <div className="app-toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

export function ThemeEditorApp() {
  return (
    <ThemeProvider>
      <SkinShareProvider>
        <ThemeEditorBody />
      </SkinShareProvider>
    </ThemeProvider>
  );
}
