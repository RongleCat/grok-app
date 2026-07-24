/**
 * Persistent context usage chip in the composer row.
 * Click opens a compact summary menu + action to run `/compact`.
 */

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { IconActivity, IconArrowsMinimize } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { useFloatingMenu } from "@/lib/floatingMenu";
import {
  formatTokenCount,
  type ContextUsageDisplay,
  type LastCompactSummary,
} from "@/lib/contextUsage";

export type ContextUsageChipLabels = {
  aria: string;
  tipUnknown: string;
  tipEstimated: string;
  tipKnown: string;
  menuTitle: string;
  current: string;
  sourceKnown: string;
  sourceEstimated: string;
  sourceUnknown: string;
  lastCompact: string;
  lastCompactNone: string;
  tokensRange: string;
  compactAction: string;
  heuristicNote: string;
  auto: string;
  manual: string;
};

type Props = {
  display: ContextUsageDisplay;
  labels: ContextUsageChipLabels;
  disabled?: boolean;
  onCompact: () => void;
};

function tipFor(
  display: ContextUsageDisplay,
  labels: ContextUsageChipLabels,
): string {
  if (display.source === "known") return labels.tipKnown;
  if (display.source === "estimated") return labels.tipEstimated;
  return labels.tipUnknown;
}

function sourceLabel(
  source: ContextUsageDisplay["source"],
  labels: ContextUsageChipLabels,
): string {
  if (source === "known") return labels.sourceKnown;
  if (source === "estimated") return labels.sourceEstimated;
  return labels.sourceUnknown;
}

function formatLastCompactDetail(
  last: LastCompactSummary,
  labels: ContextUsageChipLabels,
): string {
  if (
    last.tokensBefore != null &&
    last.tokensAfter != null &&
    Number.isFinite(last.tokensBefore) &&
    Number.isFinite(last.tokensAfter)
  ) {
    return labels.tokensRange
      .replace("{before}", formatTokenCount(last.tokensBefore))
      .replace("{after}", formatTokenCount(last.tokensAfter));
  }
  if (last.note?.trim()) return last.note.trim();
  return last.trigger === "manual" ? labels.manual : labels.auto;
}

export function ContextUsageChip({
  display,
  labels,
  disabled,
  onCompact,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const { pos, style: popStyle } = useFloatingMenu({
    open,
    triggerRef,
    panelRef: popRef,
    roots: [rootRef],
    onClose: () => setOpen(false),
    placement: "up",
    fitContent: true,
    minWidth: 220,
    estHeight: 220,
    gap: 8,
    deps: [display.label, display.lastCompact?.messageId],
  });

  const tip = useMemo(() => tipFor(display, labels), [display, labels]);
  const source = sourceLabel(display.source, labels);
  const lastDetail = display.lastCompact
    ? formatLastCompactDetail(display.lastCompact, labels)
    : null;

  return (
    <div ref={rootRef} className={`ctx-chip${open ? " is-open" : ""}`}>
      <Tip label={tip} disabled={open || disabled}>
        <button
          ref={triggerRef}
          type="button"
          className={
            "chip chip--context" +
            (open ? " is-open" : "") +
            (display.source === "unknown" ? " chip--muted" : "")
          }
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${labels.aria}: ${display.label}`}
          onClick={() => setOpen((v) => !v)}
        >
          <IconActivity size={14} />
          <span className="chip__label chip__label--nums">{display.label}</span>
        </button>
      </Tip>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            className="cmm__pop cmm__pop--portal ctx-chip__pop"
            role="menu"
            aria-label={labels.menuTitle}
            style={popStyle as CSSProperties}
          >
            <div className="ctx-chip__head">{labels.menuTitle}</div>
            <div className="ctx-chip__row">
              <span className="ctx-chip__k">{labels.current}</span>
              <span className="ctx-chip__v">
                <span className="ctx-chip__tokens">{display.label}</span>
                <span className="ctx-chip__src">{source}</span>
              </span>
            </div>
            <div className="ctx-chip__row">
              <span className="ctx-chip__k">{labels.lastCompact}</span>
              <span className="ctx-chip__v">
                {lastDetail ?? labels.lastCompactNone}
              </span>
            </div>
            {display.lastCompact?.summaryPreview?.trim() ? (
              <p className="ctx-chip__summary">
                {display.lastCompact.summaryPreview.trim()}
              </p>
            ) : null}
            <p className="ctx-chip__note">{labels.heuristicNote}</p>
            <button
              type="button"
              role="menuitem"
              className="ctx-chip__action"
              onClick={() => {
                setOpen(false);
                onCompact();
              }}
            >
              <IconArrowsMinimize size={14} aria-hidden />
              <span>{labels.compactAction}</span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
