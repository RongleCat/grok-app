import { createT, type Locale, type MessageKey } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import type { AppPlatform } from "@/lib/appPlatform";
import type { ComposerSendKeyPref } from "@/lib/composerSendKey";
import type { ShortcutRemapMap } from "@/lib/shortcutRemap";
import { shortcutsForPlatform } from "@/lib/shortcuts";
import { SHORTCUT_KEYS_OFF } from "@/lib/voiceHotkeyPref";

export function ShortcutsHelpModal(props: {
  locale: Locale;
  open: boolean;
  platform: AppPlatform;
  composerSendKeyPref: ComposerSendKeyPref;
  shortcutRemaps: ShortcutRemapMap;
  voiceHotkeyEnabled: boolean;
  onClose: () => void;
}) {
  const tr = createT(props.locale);
  return (
    <GlassModal
      open={props.open}
      onClose={props.onClose}
      title={tr("shortcuts.title")}
      size="md"
      closeLabel={tr("shortcuts.close")}
      footer={
        <button
          type="button"
          className="btn btn--ghost"
          onClick={props.onClose}
        >
          {tr("shortcuts.close")}
        </button>
      }
    >
      <ul className="shortcuts-list">
        {shortcutsForPlatform(
          props.platform === "mac"
            ? "mac"
            : props.platform === "win"
              ? "win"
              : "other",
          props.composerSendKeyPref,
          props.shortcutRemaps,
          props.voiceHotkeyEnabled,
        ).map((row) => (
          <li key={row.id} className="shortcuts-list__row">
            <span className="shortcuts-list__label">
              {tr(row.labelKey as MessageKey)}
            </span>
            <kbd className="shortcuts-list__keys">
              {row.keys === SHORTCUT_KEYS_OFF
                ? tr("shortcuts.off")
                : row.keys}
            </kbd>
          </li>
        ))}
      </ul>
    </GlassModal>
  );
}
