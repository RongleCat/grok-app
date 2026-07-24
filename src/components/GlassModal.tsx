/**
 * Shared frosted-glass dialog shell.
 *
 * Material: tokens `--glass-*` (see tokens.css).
 * Layout: `--modal-*` radius / padding / gap (dropdown + dialog refs).
 *
 * Prefer this over ad-hoc overlay markup so all dialogs share one chrome.
 * Business content goes in `children` / `footer`.
 *
 * Structure:
 *   .overlay > .modal.glass-modal[--sm|--md|--lg]
 *     header.modal-head  (title + close)
 *     .modal-body        (optional wrapper when bodyClassName set)
 *     .modal-actions     (footer)
 */

import {
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { IconClose } from "@/components/icons";
import { focusFirst, trapTabKey } from "@/lib/a11yFocus";

export type GlassModalSize = "sm" | "md" | "lg";

export type GlassModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Right-aligned footer actions (Cancel / Save / Close, etc.) */
  footer?: ReactNode;
  /** sm=420 · md=480 · lg=560 */
  size?: GlassModalSize;
  className?: string;
  overlayClassName?: string;
  bodyClassName?: string;
  /** When true, wrap children in `.modal-body` for scroll + gap */
  wrapBody?: boolean;
  titleId?: string;
  closeLabel?: string;
  closeOnOverlay?: boolean;
  /** Show header close button (default true) */
  showClose?: boolean;
  /** Stop mousedown bubbling on panel (default true) */
  stopPanelPropagation?: boolean;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function GlassModal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  className,
  overlayClassName,
  bodyClassName,
  wrapBody = false,
  titleId: titleIdProp,
  closeLabel = "Close",
  closeOnOverlay = true,
  showClose = true,
  stopPanelPropagation = true,
}: GlassModalProps) {
  const autoId = useId();
  const titleId = titleIdProp || autoId;
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    prevFocusRef.current =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;
    // After paint so options/inputs exist.
    const t = window.setTimeout(() => {
      focusFirst(panelRef.current);
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      trapTabKey(e, panelRef.current);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      const prev = prevFocusRef.current;
      if (prev && typeof prev.focus === "function") {
        try {
          prev.focus();
        } catch {
          /* ignore */
        }
      }
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const onOverlayMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (!closeOnOverlay) return;
    if (e.target === e.currentTarget) onClose();
  };

  const onPanelMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (stopPanelPropagation) e.stopPropagation();
  };

  const sizeClass =
    size === "sm"
      ? "glass-modal--sm"
      : size === "lg"
        ? "glass-modal--lg"
        : "glass-modal--md";

  return createPortal(
    <div
      className={cx("overlay", overlayClassName)}
      role="presentation"
      onMouseDown={onOverlayMouseDown}
    >
      <div
        ref={panelRef}
        className={cx("modal glass-modal", sizeClass, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={onPanelMouseDown}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          {showClose ? (
            <button
              type="button"
              className="icon-btn modal-close"
              onClick={onClose}
              aria-label={closeLabel}
            >
              <IconClose size={16} />
            </button>
          ) : null}
        </header>

        {wrapBody || bodyClassName ? (
          <div className={cx("modal-body", bodyClassName)}>{children}</div>
        ) : (
          children
        )}

        {footer ? <div className="modal-actions">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
