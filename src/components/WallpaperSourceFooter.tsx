import type { WallpaperSourceModalProps } from "./WallpaperSourceModal";

type Props = {
  t: WallpaperSourceModalProps["t"];
  applying: boolean;
  applyDisabled: boolean;
  onClose: () => void;
  onApply: () => void;
};

export function WallpaperSourceFooter({
  t,
  applying,
  applyDisabled,
  onClose,
  onApply,
}: Props) {
  return (
    <>
      <button
        type="button"
        className="btn btn--ghost"
        onClick={onClose}
        disabled={applying}
      >
        {t("common.close")}
      </button>
      <button
        type="button"
        className="btn btn--solid"
        disabled={applyDisabled}
        onClick={onApply}
      >
        {applying
          ? t("settings.wallpaperSource.applying")
          : t("settings.wallpaperSource.apply")}
      </button>
    </>
  );
}
