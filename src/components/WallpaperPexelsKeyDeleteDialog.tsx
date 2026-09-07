import { GlassModal } from "@/components/GlassModal";
import type { MessageKey } from "@/i18n";

type Translate = (key: MessageKey) => string;

export type WallpaperPexelsKeyDeleteDialogProps = {
  t: Translate;
  open: boolean;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

/** Confirm removal before clearing the Host-owned Pexels credential. */
export function WallpaperPexelsKeyDeleteDialog({
  t,
  open,
  deleting,
  onClose,
  onConfirm,
}: WallpaperPexelsKeyDeleteDialogProps) {
  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={t("settings.wallpaperSource.pexels.keyDeleteTitle")}
      size="sm"
      closeLabel={t("common.close")}
      closeOnOverlay={!deleting}
      showClose={!deleting}
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={deleting}
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--solid btn--danger"
            disabled={deleting}
            onClick={onConfirm}
          >
            {t(
              deleting
                ? "settings.wallpaperSource.pexels.keyDeleting"
                : "settings.wallpaperSource.pexels.keyDeleteConfirm",
            )}
          </button>
        </>
      }
    >
      <p className="rp-modal-copy">
        {t("settings.wallpaperSource.pexels.keyDeleteBody")}
      </p>
    </GlassModal>
  );
}
