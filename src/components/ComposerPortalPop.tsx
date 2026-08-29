/**
 * Shared portal layer for composer-row chip menus (model / access / project /
 * worktree / context-usage). Owns the open state, trigger/panel refs and
 * viewport positioning (useComposerPortalMenu), and renders the portaled
 * `.cmm__pop.cmm__pop--portal` panel into document.body (ComposerPortalPop)
 * so overflow parents never clip it — see docs/llm-wiki/dialogs.md.
 *
 * Menu business/content stays in each caller; only the portal plumbing that
 * used to be copied per chip lives here.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import {
  useFloatingMenu,
  type FloatingPos,
  type UseFloatingMenuOptions,
} from "@/lib/floatingMenu";

/** Positioning knobs a chip menu tunes; open/refs/onClose are owned here. */
type ComposerPortalMenuOptions = Omit<
  UseFloatingMenuOptions,
  "open" | "triggerRef" | "panelRef" | "roots" | "onClose"
>;

export interface ComposerPortalMenu {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  requestClose: () => void;
  exiting: boolean;
  pos: FloatingPos | null;
  popStyle: CSSProperties | undefined;
  settled: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** Visual box to pin against (chip shell). Falls back to the click trigger. */
  positionRef: RefObject<HTMLElement | null>;
  popRef: RefObject<HTMLDivElement | null>;
  popId: string;
}

export function useComposerPortalMenu(
  options: ComposerPortalMenuOptions & {
    exitMs?: number;
    extraRoots?: Array<RefObject<HTMLElement | null>>;
  } = {},
): ComposerPortalMenu {
  const { exitMs = 0, extraRoots = [], ...floatingOpts } = options;
  const [open, setOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const positionRef = useRef<HTMLElement | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popId = useId();
  const closeTimer = useRef<number>(0);

  const requestClose = useCallback(() => {
    if (!open || exiting) return;
    if (!exitMs) {
      setOpen(false);
      return;
    }
    setExiting(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setExiting(false);
    }, exitMs);
  }, [open, exiting, exitMs]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const { pos, style, settled } = useFloatingMenu({
    open: open || exiting,
    triggerRef,
    positionRef,
    panelRef: popRef,
    roots: [rootRef, ...extraRoots],
    onClose: requestClose,
    // Composer chips sit 8px off the trigger (floatingMenu default is 6).
    gap: 8,
    ...floatingOpts,
  });

  return {
    open,
    setOpen,
    requestClose,
    exiting,
    pos,
    popStyle: style,
    settled,
    rootRef,
    triggerRef,
    positionRef,
    popRef,
    popId,
  };
}

/**
 * Portaled chip panel. Mounts only once a floating position exists so the
 * first painted frame is already anchored (no unstyled flash). The material
 * classes `cmm__pop cmm__pop--portal` are fixed — dropping them would render
 * a transparent panel (forbidden, dialogs.md).
 */
export function ComposerPortalPop({
  menu,
  className,
  id,
  role = "menu",
  ariaLabel,
  children,
}: {
  menu: ComposerPortalMenu;
  /** Chip-specific pop class (e.g. `cpm__pop`). */
  className?: string;
  /** Set to menu.popId when the trigger wires aria-controls. */
  id?: string;
  /** Chip menus are `menu`; the model/access sheets are `dialog`. */
  role?: "menu" | "dialog";
  ariaLabel: string;
  children: ReactNode;
}) {
  if ((!menu.open && !menu.exiting) || !menu.pos || typeof document === "undefined") {
    return null;
  }
  const modelPop = className?.includes("cmm__pop--model");
  return createPortal(
    <div
      ref={menu.popRef}
      className={[
        "cmm__pop",
        "cmm__pop--portal",
        className,
        modelPop && menu.exiting ? "is-out" : "",
        modelPop && menu.settled && !menu.exiting ? "is-in" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      id={id}
      role={role}
      aria-label={ariaLabel}
      style={menu.popStyle}
    >
      {children}
    </div>,
    document.body,
  );
}
