/**
 * Remote IM controls — reuse app chrome tokens (no native checkbox/radio/select).
 * Switch = ext-switch · Check = ui-check · Select = @/components/Select · Seg = settings-seg
 */

import type { ReactNode } from "react";
import { IconCheck } from "@/components/icons";
import { Select, type SelectOption } from "@/components/Select";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

export function RimSwitch({
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
      onClick={() => onChange(!checked)}
    >
      <span className="ext-switch__thumb" aria-hidden />
    </button>
  );
}

export function RimCheck({
  checked,
  disabled,
  label,
  ariaLabel,
  onChange,
  className = "",
}: {
  checked: boolean;
  disabled?: boolean;
  label?: ReactNode;
  ariaLabel?: string;
  onChange: (next: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
      disabled={disabled}
      className={
        "ui-check" +
        (checked ? " is-on" : "") +
        (className ? ` ${className}` : "")
      }
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="ui-check__box" aria-hidden>
        {checked ? <IconCheck size={12} stroke={2.4} /> : null}
      </span>
      {label != null ? <span className="ui-check__label">{label}</span> : null}
    </button>
  );
}

export function RimSelect({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  className = "",
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <Select
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={"rim-select" + (className ? ` ${className}` : "")}
    />
  );
}

/** Segmented control — same chrome as Settings theme / account tabs */
export function RimSeg({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  return (
    <SegmentedControl
      value={value}
      role="tablist"
      large
      ariaLabel={ariaLabel}
      options={options}
      onChange={onChange}
    />
  );
}

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
