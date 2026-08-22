import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown } from "@/components/icons";
import { quoteCssFontFamily } from "@/lib/cssFontFamily";
import { useFloatingMenu } from "@/lib/floatingMenu";
import {
  fontSelectOptions,
  loadInstalledFontFamilies,
} from "@/lib/systemFonts";

export function FontFamilySelect({
  value,
  onChange,
  "aria-label": ariaLabel,
  defaultLabel,
  searchPlaceholder,
  emptyLabel,
  loadingLabel,
  genericFamily,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
  defaultLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
  loadingLabel: string;
  genericFamily?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [families, setFamilies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadInstalledFontFamilies()
      .then((list) => {
        if (!cancelled) setFamilies(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const id = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const options = useMemo(
    () =>
      fontSelectOptions({
        families,
        query,
        current: value,
        defaultLabel,
        genericFamily,
      }),
    [families, query, value, defaultLabel, genericFamily],
  );

  const selected =
    options.find((o) => o.value === value) ??
    (value
      ? { value, label: value }
      : { value: "", label: defaultLabel });

  const { pos, style } = useFloatingMenu({
    open,
    triggerRef,
    panelRef,
    roots: [rootRef],
    onClose: () => setOpen(false),
    placement: "down",
    fitContent: false,
    matchTriggerWidth: true,
    estHeight: 320,
    deps: [query, options.length, loading],
  });

  const menu =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            className="menu-panel c-select__menu c-select__menu--portal font-select__panel"
            style={style}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              ref={searchRef}
              type="search"
              className="settings-input font-select__search"
              value={query}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                  triggerRef.current?.focus();
                }
              }}
            />
            <ul className="font-select__list" role="listbox" id={listId}>
              {options.map((o) => (
                <li
                  key={o.value || "__default"}
                  role="option"
                  aria-selected={o.value === value}
                >
                  <button
                    type="button"
                    className={
                      "c-select__option" +
                      (o.value === value ? " is-selected" : "")
                    }
                    style={
                      o.value
                        ? { fontFamily: quoteCssFontFamily(o.value) }
                        : undefined
                    }
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                  >
                    {o.label}
                  </button>
                </li>
              ))}
              {loading ? (
                <li className="font-select__status muted" role="presentation">
                  {loadingLabel}
                </li>
              ) : null}
              {!loading && options.length <= 1 && query.trim() ? (
                <li className="font-select__status muted" role="presentation">
                  {emptyLabel}
                </li>
              ) : null}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={rootRef}
      className={`c-select font-select ${open ? "is-open" : ""} ${className}`}
    >
      <button
        ref={triggerRef}
        type="button"
        className="c-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="c-select__value"
          style={
            selected.value
              ? { fontFamily: quoteCssFontFamily(selected.value) }
              : undefined
          }
        >
          {selected.label}
        </span>
        <span className="c-select__chev" aria-hidden>
          <IconChevronDown size={14} />
        </span>
      </button>
      {menu}
    </div>
  );
}
