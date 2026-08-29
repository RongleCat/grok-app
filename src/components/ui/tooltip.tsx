/**
 * Codex-style tip — frosted dark pill, delayed show, portal (not native title).
 * Position is clamped so the tip never leaves the viewport.
 * Use instead of `title=` for icon buttons and compact controls.
 */

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type TipPlacement = "top" | "bottom";

type TipChildProps = {
  ref?: Ref<HTMLElement>;
  onMouseEnter?: (e: MouseEvent) => void;
  onMouseLeave?: (e: MouseEvent) => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
  "aria-describedby"?: string;
};

type TipPos = {
  top: number;
  left: number;
  place: TipPlacement;
  maxWidth: number;
};

const GAP = 6;
const MARGIN = 8;
const MAX_TIP_W = 280;
/** Fallback box when tip not measured yet (first layout pass). */
const EST_W = 160;
const EST_H = 28;

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const r of refs) {
      if (!r) continue;
      if (typeof r === "function") r(node);
      else (r as { current: T | null }).current = node;
    }
  };
}

/**
 * Anchor tip to a rect, flip top/bottom when needed, clamp X/Y into the viewport.
 * Uses top-left of the tip box (no translate) so clamp is exact after measure.
 */
export function computeTipPos(
  anchor: DOMRect,
  tipW: number,
  tipH: number,
  preferred: TipPlacement,
  vw: number,
  vh: number,
): TipPos {
  const maxWidth = Math.min(MAX_TIP_W, Math.max(80, vw - MARGIN * 2));
  const w = Math.min(Math.max(tipW, 1), maxWidth);
  const h = Math.max(tipH, 1);

  const spaceAbove = anchor.top - MARGIN;
  const spaceBelow = vh - anchor.bottom - MARGIN;

  let place = preferred;
  if (place === "top" && h + GAP > spaceAbove && spaceBelow > spaceAbove) {
    place = "bottom";
  } else if (
    place === "bottom" &&
    h + GAP > spaceBelow &&
    spaceAbove >= spaceBelow
  ) {
    place = "top";
  }

  let top =
    place === "top" ? anchor.top - GAP - h : anchor.bottom + GAP;
  top = Math.max(MARGIN, Math.min(top, vh - MARGIN - h));

  // Prefer horizontal center on the trigger, then clamp into the viewport.
  let left = anchor.left + anchor.width / 2 - w / 2;
  left = Math.max(MARGIN, Math.min(left, vw - MARGIN - w));

  return { top, left, place, maxWidth };
}

export function Tip({
  label,
  children,
  placement = "top",
  delayMs = 420,
  disabled,
  className,
}: {
  label: ReactNode;
  children: ReactElement<TipChildProps>;
  placement?: TipPlacement;
  /** Hover delay before show (Codex ~400ms). */
  delayMs?: number;
  disabled?: boolean;
  className?: string;
}) {
  const tipId = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<TipPos | null>(null);
  const [settled, setSettled] = useState(false);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (showTimer.current != null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const measure = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const tip = tipRef.current;
    const vw =
      typeof window.innerWidth === "number" ? window.innerWidth : 1024;
    const vh =
      typeof window.innerHeight === "number" ? window.innerHeight : 768;
    const tipW = tip?.offsetWidth || EST_W;
    const tipH = tip?.offsetHeight || EST_H;
    setPos(computeTipPos(r, tipW, tipH, placement, vw, vh));
  }, [placement]);

  const scheduleShow = useCallback(() => {
    if (disabled || label == null || label === "") return;
    clearTimers();
    showTimer.current = window.setTimeout(() => {
      setSettled(false);
      // Seed a rough position so the tip mounts; layout effect refines + clamps.
      const el = anchorRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const vw =
          typeof window.innerWidth === "number" ? window.innerWidth : 1024;
        const vh =
          typeof window.innerHeight === "number" ? window.innerHeight : 768;
        setPos(computeTipPos(r, EST_W, EST_H, placement, vw, vh));
      }
      setOpen(true);
    }, delayMs);
  }, [clearTimers, delayMs, disabled, label, placement]);

  const scheduleHide = useCallback(() => {
    clearTimers();
    hideTimer.current = window.setTimeout(() => {
      setOpen(false);
      setSettled(false);
    }, 40);
  }, [clearTimers]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (!disabled) return;
    clearTimers();
    setOpen(false);
    setSettled(false);
  }, [disabled, clearTimers]);

  // After mount / content change: measure real tip size and clamp into viewport.
  useLayoutEffect(() => {
    if (!open) {
      setSettled(false);
      return;
    }
    measure();
    setSettled(true);
  }, [open, label, measure]);

  useEffect(() => {
    if (!open) return;
    const onMove = () => {
      measure();
      setSettled(true);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, measure]);

  if (!isValidElement(children)) {
    return children;
  }

  const child = children;
  const cloned = cloneElement(child, {
    ref: mergeRefs(anchorRef, child.props.ref),
    "aria-describedby": open ? tipId : child.props["aria-describedby"],
    onMouseEnter: (e: MouseEvent) => {
      child.props.onMouseEnter?.(e);
      scheduleShow();
    },
    onMouseLeave: (e: MouseEvent) => {
      child.props.onMouseLeave?.(e);
      scheduleHide();
    },
    onFocus: (e: FocusEvent) => {
      child.props.onFocus?.(e);
      scheduleShow();
    },
    onBlur: (e: FocusEvent) => {
      child.props.onBlur?.(e);
      scheduleHide();
    },
  } as TipChildProps);

  const tipStyle: CSSProperties | undefined = pos
    ? {
        top: pos.top,
        // Park off-screen until measured. WKWebView still rasters
        // visibility:hidden rounded tiles; on light wallpaper that first
        // EST_W paint is a leftover white square over the composer.
        left: settled ? pos.left : -10000,
        maxWidth: pos.maxWidth,
        // No translate: top/left are already the tip box origin after clamp.
        transform: "none",
        visibility: settled ? "visible" : "hidden",
        pointerEvents: "none",
      }
    : undefined;

  return (
    <>
      {cloned}
      {open &&
      pos &&
      label != null &&
      label !== "" &&
      !disabled &&
      typeof document !== "undefined"
        ? createPortal(
            <div
              ref={tipRef}
              id={tipId}
              role="tooltip"
              className={cn(
                "ui-tip",
                `ui-tip--${pos.place}`,
                className,
              )}
              style={tipStyle}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
