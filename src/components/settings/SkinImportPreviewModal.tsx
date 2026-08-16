/**
 * Shared confirm preview for every Apply path. Never auto-applies.
 */

import { useMemo, useState } from "react";
import { GlassModal } from "@/components/GlassModal";
import { createT, resolveLocale } from "@/i18n";
import { THEME_SKINS } from "@/lib/themeSkin";
import { keepWallpaperAllowed, type SkinPackPreview } from "@/lib/skinPack";
import { UiCheck } from "./shared";

export function SkinImportPreviewModal({
  open,
  preview,
  undoMode,
  busy,
  progress,
  onCancel,
  onApply,
  onSaveLibraryOnly,
}: {
  open: boolean;
  preview: SkinPackPreview | null;
  undoMode: boolean;
  busy: boolean;
  progress: { sent: number; total: number } | null;
  onCancel: () => void;
  onApply: (opts: { keepWallpaper: boolean; saveToLibrary: boolean }) => void;
  onSaveLibraryOnly?: () => void;
}) {
  const t = useMemo(
    () =>
      createT(
        resolveLocale(
          typeof document !== "undefined" ? document.documentElement.lang : "en",
        ),
      ),
    [],
  );
  const [keepWallpaper, setKeepWallpaper] = useState(false);
  const [saveToLibrary, setSaveToLibrary] = useState(
    () => preview?.source === "catalog",
  );

  const pack = preview;
  const skinMeta = THEME_SKINS.find((s) => s.id === (pack?.skin ?? "default"));
  const canKeep = pack ? keepWallpaperAllowed(pack.source, pack.wallpaper) : false;

  return (
    <GlassModal
      open={open && !!pack}
      onClose={() => {
        if (!busy) onCancel();
      }}
      title={
        undoMode ? t("settings.skinPresets.undoTitle") : t("settings.skinPresets.previewTitle")
      }
      size="md"
      wrapBody
      closeLabel={t("common.close")}
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={onCancel}
          >
            {t("common.cancel")}
          </button>
          {onSaveLibraryOnly && !undoMode ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy || !pack}
              onClick={onSaveLibraryOnly}
            >
              {t("settings.skinPresets.saveLibraryOnly")}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--solid"
            disabled={busy || !pack}
            onClick={() =>
              onApply({
                keepWallpaper: canKeep && keepWallpaper,
                saveToLibrary:
                  pack?.source === "catalog"
                    ? saveToLibrary
                    : saveToLibrary && pack?.source === "file",
              })
            }
          >
            {busy ? t("settings.skinPresets.applying") : t("settings.skinPresets.apply")}
          </button>
        </>
      }
    >
      {pack ? (
        <div className="skin-preview">
          <div className="skin-preview__hero">
            <span
              className="skin-preview__swatch"
              style={{
                background: `linear-gradient(135deg, ${skinMeta?.swatch ?? "#888"} 0%, ${skinMeta?.swatchAlt ?? "#444"} 100%)`,
              }}
              aria-hidden
            />
            <div>
              <div className="skin-preview__name">{pack.name}</div>
              <div className="skin-preview__meta">
                {t(`settings.skin.${pack.skin}` as "settings.skin.default")}
                {" · "}
                {t("settings.skinPresets.scrimPct", { n: pack.scrim })}
              </div>
            </div>
          </div>
          {pack.description ? <p className="skin-preview__desc">{pack.description}</p> : null}
          {pack.wallpaper?.kind === "video" ? (
            <p className="skin-preview__badge">{t("settings.skinPresets.containsVideo")}</p>
          ) : null}
          {pack.warnings.includes("unknown_skin") ? (
            <p className="skin-preview__warn" role="status">
              {t("settings.skinPack.warn.unknown_skin")}
            </p>
          ) : null}
          {pack.warnings.includes("will_clear_wallpaper") ? (
            <p className="skin-preview__warn" role="status">
              {t("settings.skinPack.warn.will_clear_wallpaper")}
            </p>
          ) : null}
          {canKeep ? (
            <UiCheck
              checked={keepWallpaper}
              onChange={() => {
                if (!busy) setKeepWallpaper((v) => !v);
              }}
              label={t("settings.skinPresets.keepWallpaper")}
            />
          ) : null}
          {pack.source === "catalog" || pack.source === "file" ? (
            <UiCheck
              checked={saveToLibrary}
              onChange={() => {
                if (!busy) setSaveToLibrary((v) => !v);
              }}
              label={t("settings.skinPresets.saveToLibrary")}
            />
          ) : null}
          {progress ? (
            <div className="skin-preview__progress">
              <p>{t("settings.skinPresets.undoProgress")}</p>
              <progress value={progress.sent} max={Math.max(1, progress.total)} />
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={onCancel}
              >
                {t("common.cancel")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </GlassModal>
  );
}
