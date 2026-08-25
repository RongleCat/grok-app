/**
 * Viewport-aware floating menus.
 * Always pair with createPortal(..., document.body) so overflow parents never clip.
 *
 * Default width is content-sized (`fitContent`). Pass `matchTriggerWidth` when the
 * panel should be at least as wide as the trigger (e.g. account sheet).
 *
 * Open flash prevention: style stays `visibility: hidden` until the panel has been
 * mounted and (for fit-content) edge-clamped in useLayoutEffect — so the first
 * painted frame is already final. Avoids empty/jump flashes on first open.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  acquireNativeWebviewCover,
  rectOverlapsNativeWebviewHost,
} from "@/lib/nativeWebviewCover";

export type FloatingPlacement = "up" | "down" | "auto";

/** Horizontal alignment of the panel relative to the trigger. */
export type FloatingAlign = "start" | "end";

export interface FloatingPos {
  left: number;
  top: number;
  /** Fixed width when not fit-content; 0 means content-sized. */
  width: number;
  placeAbove: boolean;
  maxHeight: number;
  /** Viewport clamp for content-sized panels. */
  maxWidth: number;
  fitContent: boolean;
  /** Horizontal align used when computing left. */
  align: FloatingAlign;
}

export interface ComputeFloatingOptions {
  /**
   * Preferred fixed panel width (px). Ignored when `fitContent` is true
   * (unless used as a soft estimate for left clamping).
   */
  width?: number;
  /** Minimum width; if matchTriggerWidth, at least trigger width. */
  minWidth?: number;
  /** Stretch to at least trigger width (still allows content to grow when fitContent). */
  matchTriggerWidth?: boolean;
  /**
   * Size panel to item content + padding (no fixed width). Default true.
   * Set false only when an explicit fixed `width` is required.
   */
  fitContent?: boolean;
  /** Estimated panel height for flip heuristics. */
  estHeight?: number;
  placement?: FloatingPlacement;
  /**
   * Horizontal align: `start` = panel left ↔ trigger left (default);
   * `end` = panel right ↔ trigger right (chrome buttons on the trailing edge).
   */
  align?: FloatingAlign;
  gap?: number;
  margin?: number;
}

export function computeFloatingPos(
  trigger: DOMRect,
  opts: ComputeFloatingOptions = {},
): FloatingPos {
  const gap = opts.gap ?? 6;
  const margin = opts.margin ?? 8;
  const estHeight = opts.estHeight ?? 240;
  const placement = opts.placement ?? "auto";
  const fitContent = opts.fitContent !== false;
  const align: FloatingAlign = opts.align === "end" ? "end" : "start";

  const g = globalThis as { innerWidth?: number; innerHeight?: number };
  const vw = typeof g.innerWidth === "number" ? g.innerWidth : 1024;
  const vh = typeof g.innerHeight === "number" ? g.innerHeight : 768;
  const maxWidth = Math.max(120, vw - margin * 2);

  let width = 0;
  if (!fitContent) {
    width = opts.width ?? 240;
    if (opts.matchTriggerWidth) {
      width = Math.max(width, trigger.width, opts.minWidth ?? 0);
    } else if (opts.minWidth) {
      width = Math.max(width, opts.minWidth);
    }
    width = Math.min(width, maxWidth);
  } else if (opts.matchTriggerWidth) {
    // Soft floor for positioning estimates only (style uses max-content + minWidth).
    width = Math.min(
      Math.max(trigger.width, opts.minWidth ?? 0, opts.width ?? 0),
      maxWidth,
    );
  } else {
    width = Math.min(opts.width ?? opts.minWidth ?? 160, maxWidth);
  }

  const spaceAbove = trigger.top - margin;
  const spaceBelow = vh - trigger.bottom - margin;

  let placeAbove: boolean;
  if (placement === "up") placeAbove = true;
  else if (placement === "down") placeAbove = false;
  else placeAbove = spaceAbove >= estHeight || spaceAbove > spaceBelow;

  const maxHeight = Math.max(
    120,
    Math.min(estHeight + 80, placeAbove ? spaceAbove - gap : spaceBelow - gap),
  );

  // start: panel left ↔ trigger left; end: panel right ↔ trigger right.
  let left =
    align === "end" ? trigger.right - width : trigger.left;
  left = Math.max(margin, Math.min(left, vw - width - margin));

  if (placeAbove) {
    return {
      left,
      top: trigger.top - gap,
      width: fitContent ? 0 : width,
      placeAbove: true,
      maxHeight,
      maxWidth,
      fitContent,
      align,
    };
  }
  return {
    left,
    top: trigger.bottom + gap,
    width: fitContent ? 0 : width,
    placeAbove: false,
    maxHeight,
    maxWidth,
    fitContent,
    align,
  };
}

function posEqual(a: FloatingPos, b: FloatingPos): boolean {
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.placeAbove === b.placeAbove &&
    a.maxHeight === b.maxHeight &&
    a.maxWidth === b.maxWidth &&
    a.fitContent === b.fitContent &&
    a.align === b.align
  );
}

/**
 * Above GlassModal / `.overlay` (z-index 12000) so portaled menus stay
 * visible and clickable inside dialogs. Matches context-menu layer (13000).
 */
export const FLOATING_MENU_Z_INDEX = 13000;

export function floatingStyle(
  pos: FloatingPos | null,
  extras?: {
    minWidth?: number;
    settled?: boolean;
    /** When false, skip placeAbove `translateY(-100%)` so CSS can own transform. */
    anchorTransform?: boolean;
  },
): CSSProperties | undefined {
  if (!pos) return undefined;
  const base: CSSProperties = {
    position: "fixed",
    left: pos.left,
    top: pos.top,
    maxHeight: pos.maxHeight,
    maxWidth: pos.maxWidth,
    zIndex: FLOATING_MENU_Z_INDEX,
  };
  if (pos.fitContent) {
    base.width = "max-content";
    if (extras?.minWidth) base.minWidth = extras.minWidth;
  } else {
    /* Lock both width and maxWidth so content (nowrap labels) cannot expand the panel. */
    base.width = pos.width;
    base.maxWidth = Math.min(pos.width, pos.maxWidth);
    base.minWidth = 0;
    base.overflowX = "hidden";
  }
  if (pos.placeAbove && extras?.anchorTransform !== false) {
    // Keep a compositing layer (matches glass translateZ) while anchoring above.
    base.transform = "translateY(-100%) translateZ(0)";
  }
  // Hide until first layout pass finishes — prevents empty/jump flash on open.
  if (extras?.settled === false) {
    base.visibility = "hidden";
    base.pointerEvents = "none";
  }
  return base;
}

export interface UseFloatingMenuOptions {
  open: boolean;
  /** Trigger element used for positioning. */
  triggerRef: RefObject<HTMLElement | null>;
  /** Panel element (for outside-click + ignore + overflow clamp). */
  panelRef: RefObject<HTMLElement | null>;
  /** Optional extra roots that count as "inside" (e.g. trigger wrapper). */
  roots?: Array<RefObject<HTMLElement | null>>;
  onClose: () => void;
  placement?: FloatingPlacement;
  /** Horizontal align relative to trigger (default start). */
  align?: FloatingAlign;
  width?: number;
  minWidth?: number;
  matchTriggerWidth?: boolean;
  /** Default true — panel width follows content. */
  fitContent?: boolean;
  estHeight?: number;
  gap?: number;
  /**
   * When false, do not apply the placeAbove `translateY(-100%)` positioning
   * transform. Needed when the panel itself animates transform.
   */
  anchorTransform?: boolean;
  /** Extra deps that should recompute position (e.g. nested content). */
  deps?: unknown[];
}

/**
 * Tracks open panel position and wires outside-click / Escape / scroll / resize.
 */
export function useFloatingMenu({
  open,
  triggerRef,
  panelRef,
  roots = [],
  onClose,
  placement = "auto",
  align = "start",
  width,
  minWidth,
  matchTriggerWidth,
  fitContent = true,
  estHeight = 240,
  gap = 6,
  anchorTransform = true,
  deps = [],
}: UseFloatingMenuOptions): {
  pos: FloatingPos | null;
  style: CSSProperties | undefined;
  /** True after panel has been measured/clamped; style is visible only then. */
  settled: boolean;
} {
  const [pos, setPos] = useState<FloatingPos | null>(null);
  const [triggerW, setTriggerW] = useState(0);
  const [settled, setSettled] = useState(false);
  const settledRef = useRef(false);
  const optsRef = useRef({
    width,
    minWidth,
    matchTriggerWidth,
    fitContent,
    estHeight,
    placement,
    align,
    gap,
  });
  optsRef.current = {
    width,
    minWidth,
    matchTriggerWidth,
    fitContent,
    estHeight,
    placement,
    align,
    gap,
  };

  const applyPos = (next: FloatingPos) => {
    setPos((prev) => (prev && posEqual(prev, next) ? prev : next));
  };

  const update = (markSettled: boolean) => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTriggerW(r.width);
    const o = optsRef.current;
    const gap = o.gap ?? 6;
    const margin = 8;
    let next = computeFloatingPos(r, {
      width: o.width,
      minWidth: o.minWidth,
      matchTriggerWidth: o.matchTriggerWidth,
      fitContent: o.fitContent,
      estHeight: o.estHeight,
      placement: o.placement,
      align: o.align,
      gap,
    });

    // Refine with real panel box once mounted (absolute top when above; clamp left).
    const panel = panelRef.current;
    if (panel) {
      const vw =
        typeof globalThis.innerWidth === "number"
          ? globalThis.innerWidth
          : 1024;
      // Rendered box height (after max-height). Prefer this so short lists
      // re-anchor flush above the input when they shrink.
      const ph = panel.offsetHeight || panel.getBoundingClientRect().height;
      const pw = panel.offsetWidth || panel.getBoundingClientRect().width;

      if (next.placeAbove || o.placement === "up") {
        /**
         * Prefer flush above the trigger:
         *   top = trigger.top - gap - panelHeight
         * Only pin to the viewport top when the panel is taller than the space
         * above the trigger. Short filtered lists must drop back down after a
         * previous tall layout — not stay stuck at y=margin.
         */
        const idealTop = r.top - gap - ph;
        if (idealTop >= margin) {
          next = {
            ...next,
            top: idealTop,
            placeAbove: false,
          };
        } else {
          const maxH = Math.max(120, r.top - gap - margin);
          next = {
            ...next,
            top: margin,
            placeAbove: false,
            maxHeight: maxH,
          };
        }
      }

      if (o.align === "end") {
        // Keep panel right edge flush with trigger right (then clamp to viewport).
        next = {
          ...next,
          left: Math.max(margin, Math.min(r.right - pw, vw - margin - pw)),
        };
      } else if (next.left + pw > vw - margin) {
        next = {
          ...next,
          left: Math.max(margin, vw - margin - pw),
        };
      }
    }

    applyPos(next);

    if (markSettled && panel && !settledRef.current) {
      settledRef.current = true;
      setSettled(true);
    }
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      setSettled(false);
      settledRef.current = false;
      return;
    }
    // First pass: position estimate (panel may not exist yet).
    update(false);
    // Ignore scrolls that originate inside the panel (list keyboard/filter
    // scrolling). Those used to re-anchor the menu every frame → flicker.
    const onScroll = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && panelRef.current?.contains(t)) return;
      update(true);
    };
    const onResize = () => update(true);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);

    // Re-anchor when either anchor or content changes size. Pane dragging can
    // resize the trigger without resizing the window.
    let ro: ResizeObserver | null = null;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (typeof ResizeObserver !== "undefined" && (trigger || panel)) {
      ro = new ResizeObserver(() => update(true));
      if (trigger) ro.observe(trigger);
      if (panel) ro.observe(panel);
    }

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    placement,
    align,
    width,
    minWidth,
    matchTriggerWidth,
    fitContent,
    estHeight,
    gap,
    ...deps,
  ]);

  // Second pass: panel mounted — measure real size + settle.
  useLayoutEffect(() => {
    if (!open || !pos) return;
    if (!panelRef.current) return;
    update(true);
    if (!settledRef.current && panelRef.current) {
      settledRef.current = true;
      setSettled(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, !!pos, panelRef]);

  // Re-anchor when host reports content change (filter query / entry count).
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    update(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...deps]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      for (const r of roots) {
        if (r.current?.contains(t)) return;
      }
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, triggerRef, panelRef, roots]);

  /**
   * Tauri native Webviews paint above HTML. If this panel overlaps a browser
   * host, temporarily hide those webviews so the menu stays clickable/visible.
   * Does not destroy webview instances — only hide/show.
   *
   * Runs as soon as `pos` exists (before settle visibility flip) so the first
   * painted menu frame is not covered by a native child webview.
   */
  useEffect(() => {
    if (!open || !pos) return;

    let release: (() => void) | null = null;
    const syncCover = () => {
      const panel = panelRef.current;
      // Prefer real panel box; fall back to estimated floating pos.
      const r = panel
        ? panel.getBoundingClientRect()
        : {
            left: pos.left,
            top: pos.placeAbove ? pos.top - pos.maxHeight : pos.top,
            width: pos.fitContent ? Math.min(pos.maxWidth, 260) : pos.width,
            height: Math.min(pos.maxHeight, estHeight),
            right: 0,
            bottom: 0,
          };
      if (!panel) {
        (r as { right: number }).right = r.left + r.width;
        (r as { bottom: number }).bottom = r.top + r.height;
      }
      const overlaps = rectOverlapsNativeWebviewHost({
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      });
      if (overlaps && !release) {
        release = acquireNativeWebviewCover();
      } else if (!overlaps && release) {
        release();
        release = null;
      }
    };

    syncCover();
    // Panel mounts one tick after open — recheck once settled / on size change.
    const t = window.setTimeout(syncCover, 0);
    let ro: ResizeObserver | null = null;
    const panel = panelRef.current;
    if (typeof ResizeObserver !== "undefined" && panel) {
      ro = new ResizeObserver(() => syncCover());
      ro.observe(panel);
    }
    return () => {
      window.clearTimeout(t);
      ro?.disconnect();
      release?.();
      release = null;
    };
  }, [open, settled, pos, panelRef, estHeight]);

  const styleMin =
    matchTriggerWidth && triggerW > 0
      ? Math.max(triggerW, minWidth ?? 0)
      : minWidth;

  return {
    pos,
    settled,
    style: floatingStyle(pos, {
      minWidth: styleMin,
      settled: open ? settled : true,
      anchorTransform,
    }),
  };
}
