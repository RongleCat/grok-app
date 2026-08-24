/**
 * Remote IM controls — reuse app chrome tokens (no native checkbox/radio/select).
 * Switch = ext-switch · Check = ui-check · Select = @/components/Select · Seg = settings-seg
 */

import type { ReactNode } from "react";

export {
  UiCheck as RimCheck,
  UiSwitch as RimSwitch,
} from "@/components/settings/shared";

/** Radio-as-seg or radio-as-row of chips for multi-option exclusive choice */
export function RimChoiceRow({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rim-choice-row" role="radiogroup">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            className={"rim-choice" + (on ? " is-on" : "")}
            onClick={() => onChange(o.value)}
          >
            <span className="rim-choice__dot" aria-hidden />
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function RimStatusDot({
  tone,
  title,
}: {
  tone: "connected" | "configured" | "unconfigured" | "error";
  title?: string;
}) {
  return (
    <span
      className={`rim-status rim-status--${tone}`}
      title={title}
      aria-hidden
    />
  );
}

export function RimBadge({
  tone,
  children,
}: {
  tone?: "ok" | "warn" | "err" | "neutral";
  children: ReactNode;
}) {
  const t = tone && tone !== "neutral" ? ` rim-badge--${tone}` : "";
  return <span className={"rim-badge" + t}>{children}</span>;
}

/**
 * Secret input — masked by default with show/hide.
 * Never hydrates vault plaintext; empty value + placeholder when saved.
 */
export function RimSecretField({
  value,
  onChange,
  revealed,
  onToggleReveal,
  placeholder,
  ariaLabel,
  showLabel,
  hideLabel,
  disabled,
  autoComplete = "off",
}: {
  value: string;
  onChange: (next: string) => void;
  revealed: boolean;
  onToggleReveal: () => void;
  placeholder?: string;
  ariaLabel?: string;
  showLabel: string;
  hideLabel: string;
  disabled?: boolean;
  autoComplete?: string;
}) {
  return (
    <div className="rim-secret-row">
      <input
        className="settings-input"
        type={revealed ? "text" : "password"}
        autoComplete={autoComplete}
        spellCheck={false}
        data-secret="1"
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={disabled}
        aria-pressed={revealed}
        onClick={onToggleReveal}
      >
        {revealed ? hideLabel : showLabel}
      </button>
    </div>
  );
}
