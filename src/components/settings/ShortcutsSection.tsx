/**
 * Settings → shortcuts section (consumes SettingsModel context).
 */
import { useSettingsModel } from "@/providers/SettingsModelContext";

import { ShortcutsSettingsPanel } from "./ShortcutsSettingsPanel";


export function ShortcutsSection() {
  const s = useSettingsModel();
  const {
    onOpenShortcutsHelp,
    t,
  } = s;

  return (
    <>
<div id="settings-anchor-shortcuts">
            <ShortcutsSettingsPanel
              t={t}
              onOpenHelp={onOpenShortcutsHelp}
            />
          </div>
    </>
  );
}
