import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

export type SegmentedControlValue = string | number;

export type SegmentedControlOption<T extends SegmentedControlValue> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
  testId?: string;
  className?: string;
};

export function SegmentedControl<T extends SegmentedControlValue>({
  value,
  options,
  onChange,
  role = "radiogroup",
  ariaLabel,
  className = "",
  large = false,
  disabled = false,
  testId,
}: {
  value: T | null | undefined;
  options: readonly SegmentedControlOption<T>[];
  onChange: (value: T, event: MouseEvent<HTMLButtonElement>) => void;
  role?: "radiogroup" | "tablist";
  ariaLabel?: string;
  className?: string;
  large?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const measure = () => {
      const active = activeRef.current;
      if (!active) {
        delete root.dataset.segmentedReady;
        return;
      }
      root.style.setProperty("--seg-x", `${active.offsetLeft}px`);
      root.style.setProperty("--seg-y", `${active.offsetTop}px`);
      root.style.setProperty("--seg-width", `${active.offsetWidth}px`);
      root.style.setProperty("--seg-height", `${active.offsetHeight}px`);
      root.dataset.segmentedReady = "1";
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root
      .querySelectorAll<HTMLElement>(".settings-seg__btn")
      .forEach((button) => observer.observe(button));
    return () => observer.disconnect();
  }, [options, value]);

  const buttonRole = role === "tablist" ? "tab" : "radio";
  const focusableValue = disabled
    ? undefined
    : options.find(
        (option) => option.value === value && !option.disabled,
      )?.value ?? options.find((option) => !option.disabled)?.value;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
        event.key,
      )
    ) {
      return;
    }

    const buttons = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(
        ".settings-seg__btn:not(:disabled)",
      ) ?? [],
    );
    const currentIndex = buttons.indexOf(event.currentTarget);
    if (currentIndex < 0 || buttons.length === 0) return;

    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : event.key === "ArrowLeft" || event.key === "ArrowUp"
            ? (currentIndex - 1 + buttons.length) % buttons.length
            : (currentIndex + 1) % buttons.length;
    const next = buttons[nextIndex];
    next?.focus();
    if (next && next !== event.currentTarget) next.click();
  };

  return (
    <div
      ref={rootRef}
      role={role}
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      data-testid={testId}
      className={
        "settings-seg settings-seg--sliding" +
        (large ? " settings-seg--lg" : "") +
        (className ? ` ${className}` : "")
      }
    >
      <span className="settings-seg__indicator" aria-hidden />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={`${typeof option.value}:${option.value}`}
            ref={selected ? activeRef : undefined}
            type="button"
            role={buttonRole}
            aria-checked={role === "radiogroup" ? selected : undefined}
            aria-selected={role === "tablist" ? selected : undefined}
            disabled={disabled || option.disabled}
            tabIndex={option.value === focusableValue ? 0 : -1}
            title={option.title}
            data-testid={option.testId}
            className={
              "settings-seg__btn" +
              (selected ? " is-on" : "") +
              (option.className ? ` ${option.className}` : "")
            }
            onClick={(event) => onChange(option.value, event)}
            onKeyDown={handleKeyDown}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
