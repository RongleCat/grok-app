/**
 * Persistent context usage chip in the composer row.
 * Click opens a compact summary menu + action to run `/compact`.
 *
 * CONTEXT-USAGE-PRO: empty/no-data honesty, labelled breakdown rows,
 * soft-fail "—" when tokens unknown after compact (still opens the menu).
 */

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { IconActivity, IconArrowsMinimize } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { useFloatingMenu } from "@/lib/floatingMenu";
import {
  formatTokenCount,
  hasContextUsageData,
  resolveContextUsageSurface,
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
  /** Context window / percent / cache-hit rows. */
  window: string;
  percentUsed: string;
  cacheHit: string;
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
            ~{formatTokenCount(breakdown.userTokens, locale)}
          </span>
        </span>
      </div>
      <div className="ctx-chip__row">
        <span className="ctx-chip__k">{labels.breakdownAssistant}</span>
        <span className="ctx-chip__v">
          <span className="ctx-chip__tokens">
            ~{formatTokenCount(breakdown.assistantTokens, locale)}
          </span>
        </span>
      </div>
      <div className="ctx-chip__row">
        <span className="ctx-chip__k">{labels.breakdownThought}</span>
        <span className="ctx-chip__v">
          <span className="ctx-chip__tokens">
            ~{formatTokenCount(breakdown.thoughtTokens, locale)}
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
    estHeight: 420,
    gap: 8,
    deps: [
      display.label,
      display.lastCompact?.messageId,
      display.breakdown?.totalTokens,
    ],
  });

  const tip = useMemo(() => tipFor(display, labels), [display, labels]);
  const lastDetail = display.lastCompact
    ? formatLastCompactDetail(display.lastCompact, labels, locale)
    : null;
  const surface = resolveContextUsageSurface(display);
  const softUnknown = surface === "soft_unknown";
  // Append "% of window" to the chip trigger when a percent is known.
  const triggerLabel =
    display.percent != null && display.percent > 0
      ? `${display.label} · ${display.percent}%`
      : display.label;

  // Show the chip once we have either usage data or a known context window
  // (so the window/percent rows are visible even before the first turn).
  if (!hasContextUsageData(display) && display.windowSize == null) return null;

  return (
    <div ref={rootRef} className={`ctx-chip${open ? " is-open" : ""}`}>
      <Tip label={tip} disabled={open || disabled}>
        <button
          ref={triggerRef}
          type="button"
          className={
            "chip chip--context" +
            (open ? " is-open" : "") +
            (display.source === "unknown" || softUnknown
              ? " chip--muted"
              : "")
          }
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${labels.aria}: ${display.label}`}
          data-context-surface={surface}
          onClick={() => setOpen((v) => !v)}
        >
          <IconActivity size={14} />
          <span className="chip__label chip__label--nums">{triggerLabel}</span>
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
              </span>
            </div>
            {display.windowSize != null && display.windowSize > 0 ? (
              <div className="ctx-chip__row">
                <span className="ctx-chip__k">{labels.window}</span>
                <span className="ctx-chip__v">
                  <span className="ctx-chip__tokens">
                    {formatTokenCount(display.windowSize, locale)}
                  </span>
                </span>
              </div>
            ) : null}
            {display.percent != null ? (
              <div className="ctx-chip__row">
                <span className="ctx-chip__k">{labels.percentUsed}</span>
                <span className="ctx-chip__v">
                  <span className="ctx-chip__tokens">{display.percent}%</span>
                </span>
              </div>
            ) : null}
            {display.cacheHitRate != null ? (
              <div className="ctx-chip__row">
                <span className="ctx-chip__k">{labels.cacheHit}</span>
                <span className="ctx-chip__v">
                  <span className="ctx-chip__tokens">
                    {display.cacheHitRate}%
                  </span>
                </span>
              </div>
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
