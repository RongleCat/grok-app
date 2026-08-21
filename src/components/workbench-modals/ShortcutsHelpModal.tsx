import { useEffect, useMemo, useRef, useState } from "react";
import { createT, type Locale, type MessageKey } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { IconSearch } from "@/components/icons";
import type { AppPlatform } from "@/lib/appPlatform";
import type { ComposerSendKeyPref } from "@/lib/composerSendKey";
import type { ShortcutRemapMap } from "@/lib/shortcutRemap";
import {
  filterShortcutGroups,
  shortcutsByGroup,
  type ShortcutGroup,
} from "@/lib/shortcuts";
import { SHORTCUT_KEYS_OFF } from "@/lib/voiceHotkeyPref";

function groupLabelKey(group: ShortcutGroup): MessageKey {
  return `settings.shortcuts.group.${group}` as MessageKey;
}

export function ShortcutsHelpModal(props: {
  locale: Locale;
  open: boolean;
  platform: AppPlatform;
  composerSendKeyPref: ComposerSendKeyPref;
  shortcutRemaps: ShortcutRemapMap;
  voiceHotkeyEnabled: boolean;
  onClose: () => void;
}) {
  const tr = useMemo(() => createT(props.locale), [props.locale]);
  const [query, setQuery] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const plat = props.platform === "mac" ? "mac" : "win";

  useEffect(() => {
    if (!props.open) setQuery("");
  }, [props.open]);

  const groups = useMemo(
    () =>
      shortcutsByGroup(
        props.composerSendKeyPref,
        props.shortcutRemaps,
        props.voiceHotkeyEnabled,
      ),
    [
      props.composerSendKeyPref,
      props.shortcutRemaps,
      props.voiceHotkeyEnabled,
    ],
  );
  const filtered = useMemo(
    () => filterShortcutGroups(query, groups, (key) => tr(key as MessageKey)),
    [query, groups, tr],
  );

  return (
    <GlassModal
      open={props.open}
      onClose={props.onClose}
      title={tr("shortcuts.title")}
      size="lg"
      className="shortcuts-help-modal"
      bodyClassName="shortcuts-help"
      closeLabel={tr("shortcuts.close")}
      initialFocus={() => filterRef.current}
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
      <div className="shortcuts-help__filter">
        <IconSearch size={14} />
        <input
          ref={filterRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr("settings.shortcuts.filterPlaceholder")}
          aria-label={tr("settings.shortcuts.filterPlaceholder")}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {filtered.length === 0 ? (
        <p className="shortcuts-help__empty">
          {tr("settings.shortcuts.filterEmpty")}
        </p>
      ) : (
        <div className="shortcuts-help__scroller">
          {filtered.map(({ group, rows }) => (
            <section key={group} className="shortcuts-list__group">
              <h3 className="shortcuts-list__group-title">
                {tr(groupLabelKey(group))}
              </h3>
              <ul className="shortcuts-list">
                {rows.map((row) => {
                  const keys = plat === "mac" ? row.mac : row.win;
                  return (
                    <li key={row.id} className="shortcuts-list__row">
                      <span className="shortcuts-list__label">
                        {tr(row.labelKey as MessageKey)}
                      </span>
                      <kbd className="shortcuts-list__keys">
                        {keys === SHORTCUT_KEYS_OFF
                          ? tr("shortcuts.off")
                          : keys}
                      </kbd>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </GlassModal>
  );
}
