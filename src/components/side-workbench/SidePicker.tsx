/**
 * Empty-state / `+` picker — vertical list (Codex image-1).
 *
 * Two presentations share item markup only; width CSS is intentionally separate:
 * - empty (default): wider card in the side pane (`.sw-picker--empty`)
 * - compact: content-width dropdown inside `.sw-plus-menu` (global menu rule)
 *
 * Shortcut glyphs come from the global shortcut catalog (defaults + remaps),
 * not hard-coded i18n, so Settings remaps stay honest in the picker.
 */

import { useMemo } from "react";
import { createT, type Locale } from "@/i18n";
import {
  IconFileDiff,
  IconFolder,
  IconSkills,
  IconTerminal,
  IconWorld,
} from "@/components/icons";
import {
  SIDE_PICKER_SHORTCUT_IDS,
  sidePickerOptions,
  type SidePickerKind,
} from "@/lib/sideWorkbench";
import {
  detectShortcutPlatform,
  type ShortcutId,
} from "@/lib/shortcuts";
import {
  effectiveShortcutChord,
  formatChordDisplay,
  loadShortcutRemaps,
} from "@/lib/shortcutRemap";

export type SidePickerProps = {
  locale: Locale | string;
  isGitProject: boolean;
  onPick: (kind: SidePickerKind) => void;
  compact?: boolean;
  className?: string;
};

function kindIcon(kind: SidePickerKind) {
  switch (kind) {
    case "file":
      return <IconFolder size={16} />;
    case "browser":
      return <IconWorld size={16} />;
    case "terminal":
      return <IconTerminal size={16} />;
    case "skills":
      return <IconSkills size={16} />;
    case "review":
      return <IconFileDiff size={16} />;
  }
}

function shortcutIdForKind(kind: SidePickerKind): ShortcutId | null {
  const id = SIDE_PICKER_SHORTCUT_IDS[kind as keyof typeof SIDE_PICKER_SHORTCUT_IDS];
  return id ?? null;
}

export function SidePicker({
  locale,
  isGitProject,
  onPick,
  compact = false,
  className = "",
}: SidePickerProps) {
  const tr = useMemo(() => createT(locale as Locale), [locale]);
  const options = useMemo(
    () => sidePickerOptions({ isGitProject }),
    [isGitProject],
  );
  const platform = useMemo(() => {
    const p = detectShortcutPlatform();
    return p === "mac" ? "mac" : "win";
  }, []);
  const remaps = useMemo(
    () => (typeof localStorage !== "undefined" ? loadShortcutRemaps() : {}),
    // Re-read when options list remounts; live Settings remaps fire
    // SHORTCUT_REMAP_CHANGED_EVENT which remounts rare — acceptable for picker.
    [],
  );

  return (
    <div
      className={
        "sw-picker" +
        (compact ? " sw-picker--compact" : " sw-picker--empty") +
        (className ? ` ${className}` : "")
      }
      role="menu"
      aria-label={tr("side.picker.aria")}
      data-testid="side-picker"
    >
      {options.map((opt) => {
        const sid = shortcutIdForKind(opt.kind);
        const shortcut = sid
          ? formatChordDisplay(effectiveShortcutChord(sid, remaps), platform)
              // Compact picker: drop spaces between glyphs (⌘P not ⌘ P).
              .replace(/\s+/g, "")
          : opt.shortcutKey
            ? tr(opt.shortcutKey as never)
            : "";
        return (
          <button
            key={opt.kind}
            type="button"
            role="menuitem"
            className="sw-picker__item"
            data-testid={`side-picker-${opt.kind}`}
            title={
              opt.kind === "terminal"
                ? tr("side.picker.terminalHint")
                : undefined
            }
            onClick={() => onPick(opt.kind)}
          >
            <span className="sw-picker__ico" aria-hidden>
              {kindIcon(opt.kind)}
            </span>
            <span className="sw-picker__label">
              {tr(opt.labelKey as never)}
            </span>
            {shortcut ? (
              <span className="sw-picker__shortcut" aria-hidden>
                {shortcut}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
