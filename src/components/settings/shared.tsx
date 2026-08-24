/**
 * Shared Settings UI primitives (nav icons, tab strip, checks, marquee helpers).
 */
import { type ReactNode } from "react";
import {
  IconArchive,
  IconAppearance,
  IconChat,
  IconCheck,
  IconDoctor,
  IconHelp,
  IconInfo,
  IconPet,
  IconKeyboard,
  IconMinimize,
  IconPuzzle,
  IconSettings,
  IconUser,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { SettingsNavIcon, SettingsTabId } from "@/lib/settingsCatalog";
import { intlLocale, type MessageKey } from "@/i18n";
import type { MarqueeBox } from "./types";

export type { MarqueeBox } from "./types";

export function NavIcon({
  name,
  size = 18,
}: {
  name: SettingsNavIcon;
  size?: number;
}) {
  if (name === "appearance") return <IconAppearance size={size} />;
  if (name === "user") return <IconUser size={size} />;
  if (name === "archive") return <IconArchive size={size} />;
  if (name === "keyboard") return <IconKeyboard size={size} />;
  if (name === "extensions") return <IconPuzzle size={size} />;
  if (name === "remote_im") return <IconChat size={size} />;
  if (name === "doctor") return <IconDoctor size={size} />;
  if (name === "info") return <IconInfo size={size} />;
  if (name === "pet") return <IconPet size={size} />;
  return <IconSettings size={size} />;
}


export function formatSessionWhen(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(intlLocale(locale), {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** App-styled switch (no native OS control). Reuses `.ext-switch`. */
export function UiSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={"ext-switch" + (checked ? " is-on" : "")}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="ext-switch__thumb" aria-hidden />
    </button>
  );
}

/** App-styled checkbox (no native OS control). */
export function UiCheck({
  checked,
  indeterminate = false,
  disabled = false,
  onChange,
  label,
  ariaLabel,
  className = "",
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  const on = indeterminate || checked;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
      disabled={disabled}
      className={
        "ui-check" +
        (checked && !indeterminate ? " is-on" : "") +
        (indeterminate ? " is-mixed" : "") +
        (className ? ` ${className}` : "")
      }
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!disabled) onChange(!checked);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="ui-check__box" aria-hidden>
        {indeterminate ? (
          <IconMinimize size={12} stroke={2.4} />
        ) : on ? (
          <IconCheck size={12} stroke={2.4} />
        ) : null}
      </span>
      {label != null ? <span className="ui-check__label">{label}</span> : null}
    </button>
  );
}

export function marqueeClientRect(m: MarqueeBox) {
  const left = Math.min(m.x0, m.x1);
  const top = Math.min(m.y0, m.y1);
  const right = Math.max(m.x0, m.x1);
  const bottom = Math.max(m.y0, m.y1);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function rectsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: DOMRect,
): boolean {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
}

/** In-page settings tab strip (reuses account tab chrome). */
export function SettingsTabStrip({
  tabs,
  active,
  onChange,
  ariaLabel,
  t,
}: {
  tabs: readonly { id: SettingsTabId; labelKey: MessageKey }[];
  active: SettingsTabId | null;
  onChange: (id: SettingsTabId) => void;
  ariaLabel: string;
  t: (k: MessageKey) => string;
}) {
  if (tabs.length === 0) return null;
  return (
    <div className="settings-account-tabs settings-page__tabs">
      <SegmentedControl
        value={active}
        role="tablist"
        large
        className="settings-page__tabs-seg"
        ariaLabel={ariaLabel}
        options={tabs.map((tab) => ({
          value: tab.id,
          label: t(tab.labelKey),
        }))}
        onChange={(id, event) => {
          event.preventDefault();
          event.stopPropagation();
          onChange(id);
        }}
      />
    </div>
  );
}

/**
 * Module title + optional "?" help tip (description no longer inline under the label).
 */
export function SettingsLabelWithTip({
  label,
  tip,
  leading,
}: {
  label: ReactNode;
  tip: string;
  leading?: ReactNode;
}) {
  return (
    <div className="settings-row__label">
      {leading}
      <span className="settings-row__label-text">{label}</span>
      {tip ? (
        <Tip label={tip} placement="top" className="ui-tip--wrap" delayMs={280}>
          <button
            type="button"
            className="settings-label-help"
            aria-label={tip}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <IconHelp size={14} stroke={1.75} />
          </button>
        </Tip>
      ) : null}
    </div>
  );
}
