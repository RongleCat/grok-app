/**
 * Compact copy glyph with check feedback. Used on tool stdout, command echo,
 * and unified-diff panes — not the message hover rail.
 */
import { useCallback, useRef, useState, type MouseEvent } from "react";
import { IconCheck, IconCopy } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function CopyIconButton({
  text,
  copyLabel,
  copiedLabel,
  className,
  size = 14,
  disabled,
  testId,
}: {
  text: string;
  copyLabel: string;
  copiedLabel: string;
  className?: string;
  size?: number;
  disabled?: boolean;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  const idle = !text.trim() || disabled;

  const onCopy = useCallback(
    async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (idle) return;
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (timer.current != null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1200);
      } catch {
        /* clipboard unavailable */
      }
    },
    [idle, text],
  );

  return (
    <Tip label={copied ? copiedLabel : copyLabel} disabled={idle}>
      <button
        type="button"
        className={cn("copy-icon-btn", copied && "is-copied", className)}
        aria-label={copyLabel}
        disabled={idle}
        data-testid={testId}
        onClick={(e) => void onCopy(e)}
      >
        {copied ? <IconCheck size={size} /> : <IconCopy size={size} />}
      </button>
    </Tip>
  );
}
