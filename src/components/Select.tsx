import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { useFloatingMenu, type FloatingPlacement } from "@/lib/floatingMenu";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Pre-lowercased search text; defaults to the lowercased label. */
  keywords?: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** compact chip-style in composer */
  variant?: "default" | "chip";
  /** Menu open direction. chip defaults to auto (prefer up near composer). */
  placement?: FloatingPlacement;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  title?: string;
  /** Type-to-filter inside the open menu (one searchable picker). */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Shown when the query matches no option. */
  emptyLabel?: string;
}

/** Custom dropdown — menu portaled to body (never clipped by overflow parents). */
export function Select({
  value,
  options,
  onChange,
  variant = "default",
  placement,
  className = "",
  disabled,
  "aria-label": ariaLabel,
  title,
  searchable = false,
  searchPlaceholder,
  emptyLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value) ?? options[0];
  const menuPlacement: FloatingPlacement =
    placement ?? (variant === "chip" ? "auto" : "down");

  const closeMenu = () => {
    setOpen(false);
    setQuery("");
    setActiveValue(null);
  };

  const { pos, style } = useFloatingMenu({
    open,
    triggerRef,
    panelRef,
    roots: [rootRef],
    onClose: closeMenu,
    placement: menuPlacement,
    fitContent: true,
    // At least as wide as the trigger; grow when option labels are longer.
    matchTriggerWidth: true,
    estHeight: Math.min(
      320,
      (searchable ? 44 : 0) + 40 + options.length * 36,
    ),
  });

  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions =
    searchable && normalizedQuery
      ? options.filter((o) =>
          (o.keywords ?? o.label.toLowerCase()).includes(normalizedQuery),
        )
      : options;
  const selectable = filteredOptions.filter((o) => !o.disabled);
  // Keyboard highlight is a searchable-menu affordance; plain menus keep
  // their original look until the pointer hovers an option.
  const active = searchable
    ? (selectable.find((o) => o.value === activeValue) ?? selectable[0] ?? null)
    : null;

  const toggleMenu = () => {
    if (disabled) return;
    if (open) {
      closeMenu();
      return;
    }
    setQuery("");
    setActiveValue(value || null);
    setOpen(true);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === "Enter") {
      if (!active) return;
      event.preventDefault();
      onChange(active.value);
      closeMenu();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!selectable.length) return;
    const current = Math.max(
      0,
      selectable.findIndex((o) => o.value === active?.value),
    );
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next = (current + delta + selectable.length) % selectable.length;
    setActiveValue(selectable[next]!.value);
  };

  const menu =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <ul
            ref={panelRef}
            className={
              "menu-panel c-select__menu c-select__menu--portal" +
              (searchable ? " is-searchable" : "")
            }
            role="listbox"
            id={listId}
            style={style}
            /* Keep modal from treating option clicks as outside / drag */
            onMouseDown={(e) => e.stopPropagation()}
          >
            {searchable && (
              <li className="c-select__search" role="none">
                <input
                  autoFocus
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveValue(null);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder ?? ariaLabel}
                />
              </li>
            )}
            {filteredOptions.map((o) => {
              const isActive = searchable && o.value === active?.value;
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                >
                  <button
                    type="button"
                    className={
                      "c-select__option" +
                      (o.value === value ? " is-selected" : "") +
                      (isActive ? " is-active" : "") +
                      (o.disabled ? " is-disabled" : "")
                    }
                    disabled={o.disabled}
                    onMouseEnter={() => {
                      if (!o.disabled) setActiveValue(o.value);
                    }}
                    onClick={() => {
                      if (o.disabled) return;
                      onChange(o.value);
                      closeMenu();
                    }}
                  >
                    {o.label}
                  </button>
                </li>
              );
            })}
            {filteredOptions.length === 0 && (
              <li className="c-select__empty" role="presentation">
                {emptyLabel ?? "—"}
              </li>
            )}
          </ul>,
          document.body,
        )
      : null;

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="c-select__trigger"
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      aria-label={ariaLabel}
      onClick={toggleMenu}
    >
      <span className="c-select__value">{selected?.label ?? value}</span>
      <span className="c-select__chev" aria-hidden>
        <IconChevronDown size={14} />
      </span>
    </button>
  );

  return (
    <div
      ref={rootRef}
      className={`c-select c-select--${variant} ${open ? "is-open" : ""} ${className}`}
    >
      {title ? <Tip label={title}>{trigger}</Tip> : trigger}
      {menu}
    </div>
  );
}
