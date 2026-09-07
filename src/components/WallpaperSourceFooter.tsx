import type { WallpaperSourceModalProps } from "./WallpaperSourceModal";

type Props = {
  t: WallpaperSourceModalProps["t"];
  selected: boolean;
  locked: boolean;
  applying: boolean;
  onClose: () => void;
  applySelected: () => Promise<void>;
};

export function WallpaperSourceFooter({
  t, selected, locked, applying, onClose, applySelected,
}: Props) {
  return (
        <>
          <span className="wallpaper-source-footer-hint">
            {selected
              ? t("settings.wallpaperSource.previewThenApply")
              : t("settings.wallpaperSource.clickToPreview")}
          </span>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            disabled={applying}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            disabled={!selected || locked}
            onClick={() => void applySelected()}
          >
            {applying
              ? t("settings.wallpaperSource.applying")
              : t("settings.wallpaperSource.apply")}
          </button>
        </>
  );
}
