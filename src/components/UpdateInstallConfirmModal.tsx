/**
 * In-app confirm before signed install+relaunch.
 * No window.confirm — GlassModal only.
 */
import { GlassModal } from "@/components/GlassModal";
import { updateInstallConfirmCopyKeys } from "@/lib/appUpdateHonesty";
import type { MessageKey } from "@/i18n";

export function UpdateInstallConfirmModal({
  open,
  version,
  busy = false,
  t,
  onClose,
  onConfirm,
}: {
  open: boolean;
  version?: string | null;
  busy?: boolean;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const keys = updateInstallConfirmCopyKeys();
  const versionLabel =
    typeof version === "string" && version.trim() ? version.trim() : "—";
  const close = () => {
    if (busy) return;
    onClose();
  };

  return (
    <GlassModal
      open={open}
      onClose={close}
      title={t(keys.titleKey)}
      size="sm"
      closeLabel={t("common.close")}
      closeOnOverlay={!busy}
      showClose={!busy}
      wrapBody
      className="update-install-confirm-modal"
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={onClose}
          >
            {t(keys.cancelKey)}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            disabled={busy}
            onClick={onConfirm}
          >
            {t(keys.confirmKey)}
          </button>
        </>
      }
    >
      <p className="settings-row__desc" style={{ margin: 0 }}>
        {t(keys.messageKey, { version: versionLabel })}
      </p>
    </GlassModal>
  );
}
