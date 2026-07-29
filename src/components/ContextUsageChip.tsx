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
  type ContextUsageBreakdown,
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
  breakdownUser: string;
  breakdownAssistant: string;
  breakdownThought: string;
  /** Shown under role rows when breakdown is estimated-only. */
  breakdownEstimatedNote: string;
  /** Agent-reported input / output rows. */
  knownInput: string;
  knownOutput: string;
  knownTotal: string;
  knownFromAgent: string;
};

type Props = {
  display: ContextUsageDisplay;
  labels: ContextUsageChipLabels;
  disabled?: boolean;
  onCompact: () => void;
  /** For 万/億 vs 萬/億 on menu breakdown rows. Chip label already resolved. */
  locale?: string;
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
  locale: string,
): string {
  if (
    last.tokensBefore != null &&
    last.tokensAfter != null &&
    Number.isFinite(last.tokensBefore) &&
    Number.isFinite(last.tokensAfter)
  ) {
    return labels.tokensRange
      .replace("{before}", formatTokenCount(last.tokensBefore, locale))
      .replace("{after}", formatTokenCount(last.tokensAfter, locale));
  }
  if (last.note?.trim()) return last.note.trim();
  return last.trigger === "manual" ? labels.manual : labels.auto;
}

/** Breakdown values are always heuristic — show with ~ prefix. */
function formatBreakdownValue(n: number, locale: string): string {
  return `~${formatTokenCount(n, locale)}`;
}

function BreakdownRows({
  breakdown,
  labels,
  locale,
}: {
  breakdown: ContextUsageBreakdown;
  labels: ContextUsageChipLabels;
  locale: string;
}) {
  return (
    <>
      <div className="ctx-chip__row">
        <span className="ctx-chip__k">{labels.breakdownUser}</span>
        <span className="ctx-chip__v">
          <span className="ctx-chip__tokens">
            {formatBreakdownValue(breakdown.userTokens, locale)}
          </span>
        </span>
      </div>
      <div className="ctx-chip__row">
        <span className="ctx-chip__k">{labels.breakdownAssistant}</span>
        <span className="ctx-chip__v">
          <span className="ctx-chip__tokens">
            {formatBreakdownValue(breakdown.assistantTokens, locale)}
          </span>
        </span>
      </div>
      <div className="ctx-chip__row">
        <span className="ctx-chip__k">{labels.breakdownThought}</span>
        <span className="ctx-chip__v">
          <span className="ctx-chip__tokens">
            {formatBreakdownValue(breakdown.thoughtTokens, locale)}
          </span>
        </span>
      </div>
      {breakdown.estimated ? (
        <p className="ctx-chip__note">{labels.breakdownEstimatedNote}</p>
      ) : null}
    </>
  );
}

export function ContextUsageChip({
  display,
  labels,
  disabled,
  onCompact,
  locale = "zh",
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
    estHeight: 280,
    gap: 8,
    deps: [
      display.label,
      display.lastCompact?.messageId,
      display.breakdown?.totalTokens,
    ],
  });

  const tip = useMemo(() => tipFor(display, labels), [display, labels]);
  const source = sourceLabel(display.source, labels);
  const lastDetail = display.lastCompact
    ? formatLastCompactDetail(display.lastCompact, labels, locale)
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
            {display.knownUsage &&
            (display.knownUsage.inputTokens != null ||
              display.knownUsage.outputTokens != null ||
              display.knownUsage.totalTokens != null) ? (
              <>
                <div className="ctx-chip__head ctx-chip__head--sub">
                  {labels.knownFromAgent}
                </div>
                {display.knownUsage.inputTokens != null ? (
                  <div className="ctx-chip__row">
                    <span className="ctx-chip__k">{labels.knownInput}</span>
                    <span className="ctx-chip__v">
                      <span className="ctx-chip__tokens">
                        {formatTokenCount(
                          display.knownUsage.inputTokens,
                          locale,
                        )}
                      </span>
                    </span>
                  </div>
                ) : null}
                {display.knownUsage.outputTokens != null ? (
                  <div className="ctx-chip__row">
                    <span className="ctx-chip__k">{labels.knownOutput}</span>
                    <span className="ctx-chip__v">
                      <span className="ctx-chip__tokens">
                        {formatTokenCount(
                          display.knownUsage.outputTokens,
                          locale,
                        )}
                      </span>
                    </span>
                  </div>
                ) : null}
                {display.knownUsage.totalTokens != null ? (
                  <div className="ctx-chip__row">
                    <span className="ctx-chip__k">{labels.knownTotal}</span>
                    <span className="ctx-chip__v">
                      <span className="ctx-chip__tokens">
                        {formatTokenCount(
                          display.knownUsage.totalTokens,
                          locale,
                        )}
                      </span>
                    </span>
                  </div>
                ) : null}
              </>
            ) : null}
            {display.breakdown ? (
              <BreakdownRows
                breakdown={display.breakdown}
                labels={labels}
                locale={locale}
              />
            ) : null}
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
