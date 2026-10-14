/**
 * Compact chat hover action — Codex tip + optional copy→check feedback.
 * MessageRegenerateButton: one-click same-model regenerate + optional model menu.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconRefresh,
} from "@/components/icons";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@/components/ContextMenu";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function MessageActionButton({
  label,
  ariaLabel,
  onClick,
  disabled,
  children,
  className,
  onContextMenu,
}: {
  label: string;
  ariaLabel?: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  onContextMenu?: (e: ReactMouseEvent) => void;
}) {
  return (
    <Tip label={label} disabled={disabled || !label}>
      <button
        type="button"
        className={cn("lobe-chat-action", className)}
        aria-label={ariaLabel ?? label}
        disabled={disabled}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        {children}
      </button>
    </Tip>
  );
}

export function MessageCopyButton({
  text,
  copyLabel,
  copiedLabel = "OK",
  /** Optional idle icon (default copy glyph). Use for “copy link”. */
  idleIcon,
}: {
  text: string;
  copyLabel: string;
  copiedLabel?: string;
  idleIcon?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current != null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }, [text]);

  return (
    <MessageActionButton
      label={copied ? copiedLabel : copyLabel}
      ariaLabel={copyLabel}
      onClick={() => void onCopy()}
      className={copied ? "is-copied" : undefined}
    >
      {copied ? (
        <IconCheck size={15} />
      ) : (
        (idleIcon ?? <IconCopy size={15} />)
      )}
    </MessageActionButton>
  );
}

export type RegenModelOption = {
  id: string;
  label: string;
};

/**
 * One-click regenerate (same model) + optional model pick via chevron / right-click.
 * Picking the current model is treated as “same model”.
 */
export function MessageRegenerateButton({
  label,
  sameModelLabel,
  pickModelLabel,
  disabled,
  models,
  currentModelId,
  onRegenerate,
  onPrimary,
  iconSize = 15,
}: {
  /** Primary action tip (one-click regenerate). */
  label: string;
  /** Menu row for keeping the current model. */
  sameModelLabel: string;
  /** Chevron / secondary tip explaining model pick. */
  pickModelLabel: string;
  disabled?: boolean;
  models: RegenModelOption[];
  currentModelId: string;
  /** `modelId` omitted / same as current → keep session model. */
  onRegenerate: (modelId?: string) => void;
  /**
   * Icon click only. The model menu still calls `onRegenerate`.
   * Used when a dropped-connection error should continue, not rewind.
   */
  onPrimary?: () => void;
  iconSize?: number;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const longPressTimer = useRef<number | null>(null);
  /** When long-press opens the menu, suppress the synthetic click that follows. */
  const suppressClickRef = useRef(false);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  useEffect(() => () => clearLongPress(), [clearLongPress]);

  const openMenuAt = useCallback(
    (x: number, y: number) => {
      if (disabled) return;
      setMenu({ x, y });
    },
    [disabled],
  );

  const openMenuFromTrigger = useCallback(() => {
    if (disabled) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      openMenuAt(rect.left, rect.bottom + 4);
    } else {
      openMenuAt(8, 8);
    }
  }, [disabled, openMenuAt]);

  const runSame = useCallback(() => {
    if (disabled) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (onPrimary) {
      onPrimary();
      return;
    }
    onRegenerate(undefined);
  }, [disabled, onPrimary, onRegenerate]);

  const runWithModel = useCallback(
    (id: string | undefined) => {
      if (disabled) return;
      const next = id?.trim();
      if (!next || next === currentModelId) {
        onRegenerate(undefined);
        return;
      }
      onRegenerate(next);
    },
    [currentModelId, disabled, onRegenerate],
  );

  const onPrimaryContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      openMenuAt(e.clientX, e.clientY);
    },
    [disabled, openMenuAt],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (disabled || e.button !== 0) return;
      // Touch / pen long-press opens model menu (desktop click stays one-shot).
      if (e.pointerType === "mouse") return;
      clearLongPress();
      longPressTimer.current = window.setTimeout(() => {
        longPressTimer.current = null;
        suppressClickRef.current = true;
        openMenuAt(e.clientX, e.clientY);
      }, 480);
    },
    [clearLongPress, disabled, openMenuAt],
  );

  const onPointerUp = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  const showModelMenu = models.length > 0;
  const items: ContextMenuItem[] = [
    {
      id: "same",
      label: sameModelLabel,
      icon: <IconCheck size={14} />,
      onClick: () => runWithModel(undefined),
    },
    ...models.map((m) => ({
      id: m.id,
      label: m.label || m.id,
      icon:
        m.id === currentModelId ? (
          <IconCheck size={14} />
        ) : (
          <span style={{ width: 14, display: "inline-block" }} />
        ),
      onClick: () => runWithModel(m.id),
    })),
  ];

  return (
    <span
      ref={rootRef}
      className="lobe-chat-regen"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <MessageActionButton
        label={label}
        disabled={disabled}
        onClick={runSame}
        onContextMenu={showModelMenu ? onPrimaryContextMenu : undefined}
      >
        <IconRefresh size={iconSize} />
      </MessageActionButton>
      {showModelMenu ? (
        <MessageActionButton
          label={pickModelLabel}
          ariaLabel={pickModelLabel}
          disabled={disabled}
          className="lobe-chat-regen__chevron"
          onClick={openMenuFromTrigger}
          onContextMenu={onPrimaryContextMenu}
        >
          <IconChevronDown size={12} />
        </MessageActionButton>
      ) : null}
      {showModelMenu ? (
        <ContextMenu
          open={!!menu}
          x={menu?.x ?? 0}
          y={menu?.y ?? 0}
          items={items}
          onClose={() => setMenu(null)}
          estimatedWidth={220}
          estimatedHeight={Math.min(360, 48 + models.length * 34)}
        />
      ) : null}
    </span>
  );
}
