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
import {
  installDialogFocus,
  type InstallDialogFocusOptions,
} from "@/lib/a11yFocus";
import { acquireNativeWebviewCover } from "@/lib/nativeWebviewCover";

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
  /**
   * Initial focus inside the panel. Default `"first"`.
   * Pass a getter to focus a specific control (e.g. a filter field).
   */
  initialFocus?: InstallDialogFocusOptions["initialFocus"];
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
  initialFocus = "first",
}: GlassModalProps) {
  const autoId = useId();
  const titleId = titleIdProp || autoId;
  const panelRef = useRef<HTMLDivElement>(null);
  // Stable close handler — parent often passes inline onClose; re-running this
  // effect on every parent render steals focus and makes modals flicker.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;

  useEffect(() => {
    if (!open) return;
    // Shared trap: Tab cycle + Escape + restore previous focus.
    return installDialogFocus(() => panelRef.current, {
      onEscape: () => onCloseRef.current(),
      // Bubble phase so nested capture handlers (permission bar, appDialog)
      // can still claim Escape first when stacked.
      capture: false,
      initialFocus: initialFocusRef.current ?? "first",
      restoreFocus: true,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    return acquireNativeWebviewCover();
  }, [open]);

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
