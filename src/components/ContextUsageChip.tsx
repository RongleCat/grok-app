/**
 * Persistent context usage chip in the composer row.
 * Click opens a compact summary menu + action to run `/compact`.
 *
 * CONTEXT-USAGE-PRO: empty/no-data honesty, labelled breakdown rows,
 * soft-fail "—" when tokens unknown after compact (still opens the menu).
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { IconArrowsMinimize } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { useFloatingMenu } from "@/lib/floatingMenu";
import {
  contextShareLabel,
  type ContextBarKind,
  type ContextInfoView,
} from "@/lib/contextInfoSnapshot";
import {
  formatCompactBeforeAfterRange,
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
  systemPrompt: string;
  messages: string;
  overhead: string;
  free: string;
  alreadyCounted: string;
  toolDefinitions: string;
  toolsDetail: string;
  autoCompact: string;
  autoCompactNow: string;
  stats: string;
  summary: string;
};

const BAR_GLYPH: Record<ContextBarKind, string> = {
  system: "◆",
  messages: "◆",
  overhead: "◆",
  free: "◇",
};

type Props = {
  display: ContextUsageDisplay;
  labels: ContextUsageChipLabels;
  disabled?: boolean;
  onCompact: () => void;
  /** Open the TUI-parity usage limit modal. */
  onUsage?: () => void;
  usageAction?: string;
  /** For 万/億 vs 萬/億 on menu breakdown rows. Chip label already resolved. */
  locale?: string;
  /** Reload `x.ai/session/info` when the menu opens. */
  onRefreshContext?: () => void;
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
  // Honest partial range when only before or after is known (no invented pair).
  const range = formatCompactBeforeAfterRange(
    last.tokensBefore,
    last.tokensAfter,
    { locale, template: labels.tokensRange },
  );
  if (range) return range;
  if (last.note?.trim()) return last.note.trim();
  return last.trigger === "manual" ? labels.manual : labels.auto;
}

function sourceLabel(
  source: ContextUsageDisplay["source"],
  labels: ContextUsageChipLabels,
): string {
  if (source === "known") return labels.sourceKnown;
  if (source === "estimated") return labels.sourceEstimated;
  return labels.sourceUnknown;
}

/**
 * Usage ring: percent-of-window arc in an icon-sized circle.
 * Theme-aware via CSS vars. Muted "?" when the share is unknown
 * (no window size / soft-unknown after compact).
 * Arc starts at 12 o'clock (SVG circles default to 3 o'clock).
 */
const MIN_RING_ARC = 2;

function ContextRing({
  percent,
  softUnknown,
}: {
  percent: number | null;
  softUnknown: boolean;
}) {
  const tone =
    softUnknown || percent == null
      ? "muted"
      : percent >= 85
        ? "danger"
        : percent >= 60
          ? "warn"
          : "normal";
  // Real-but-tiny usage (0.0x%) still gets a visible sliver of progress;
  // the popover/tooltip keep the true decimal value.
  const arc =
    softUnknown || percent == null || percent <= 0
      ? 0
      : Math.max(percent, MIN_RING_ARC);
  return (
    <span className={`ctx-ring ctx-ring--${tone}`} aria-hidden="true">
      <svg className="ctx-ring__svg" viewBox="0 0 20 20">
        <circle
          className="ctx-ring__track"
          cx="10"
          cy="10"
          r="8"
          pathLength={100}
        />
        <circle
          className="ctx-ring__arc"
          cx="10"
          cy="10"
          r="8"
          pathLength={100}
          strokeDasharray={`${arc} ${100 - arc}`}
          transform="rotate(-90 10 10)"
        />
      </svg>
      {tone === "muted" ? <span className="ctx-ring__q">?</span> : null}
    </span>
  );
}

/**
 * Percent display: whole numbers stay whole; sub-1% keeps enough decimals
 * to stay honest (0.03%, never a misleading "0%").
 */
function formatPercent(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p >= 10) return String(Math.round(p));
  if (p >= 1) return String(Math.round(p * 10) / 10);
  return String(Math.round(p * 100) / 100);
}


function ContextSnapshot({
  view,
  labels,
  locale,
}: {
  view: ContextInfoView;
  labels: ContextUsageChipLabels;
  locale: string;
}) {
  const legend = [
    { kind: "system" as const, label: labels.systemPrompt, tokens: view.systemTokens },
    { kind: "messages" as const, label: labels.messages, tokens: view.messageTokens },
    ...(view.overheadTokens > 0
      ? [{ kind: "overhead" as const, label: labels.overhead, tokens: view.overheadTokens }]
      : []),
    { kind: "free" as const, label: labels.free, tokens: view.freeTokens },
  ];
  const info = [
    {
      label: labels.toolDefinitions,
      tokens: view.toolDefinitionsTokens,
      detail: labels.toolsDetail.replace("{count}", String(view.toolDefinitionsCount)),
    },
    ...view.categories.map((row) => ({
      label: row.label,
      tokens: row.tokens,
      detail: row.detail,
    })),
  ];
  const fill = (template: string, vars: Record<string, string>) =>
    Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template);
  const tok = (n: number) => formatTokenCount(n, locale);
  return (
    <>
      <p className="ctx-chip__summary-line">
        {fill(labels.summary, {
          used: tok(view.used),
          total: tok(view.total),
          percent: `${view.percent.toFixed(2)}%`,
        })}
      </p>
      {view.model ? <p className="ctx-chip__model">{view.model}</p> : null}
      <div className="ctx-bar" aria-hidden>
        {Array.from({ length: 5 }, (_, row) => (
          <div className="ctx-bar__row" key={row}>
            {view.bar.slice(row * 20, row * 20 + 20).map((kind, i) => (
              <span key={i} className={`ctx-bar__c ctx-bar__c--${kind}`}>
                {BAR_GLYPH[kind]}
              </span>
            ))}
          </div>
        ))}
      </div>
      {legend.map((row) => (
        <div className="ctx-chip__row" key={row.kind}>
          <span className={`ctx-chip__k ctx-bar__c--${row.kind}`}>
            {BAR_GLYPH[row.kind]} {row.label}
          </span>
          <span className="ctx-chip__v">
            <span className="ctx-chip__tokens">{tok(row.tokens)}</span>
            <span className="ctx-chip__src">
              {contextShareLabel(row.tokens, view.total)}
            </span>
          </span>
        </div>
      ))}
      <p className="ctx-chip__note">{labels.alreadyCounted}</p>
      {info.map((row) => (
        <div className="ctx-chip__row" key={row.label}>
          <span className="ctx-chip__k ctx-bar__c--info">◈ {row.label}</span>
          <span className="ctx-chip__v">
            <span className="ctx-chip__tokens">{tok(row.tokens)}</span>
            <span className="ctx-chip__src">
              {contextShareLabel(row.tokens, view.total)}
              {row.detail ? ` · ${row.detail}` : ""}
            </span>
          </span>
        </div>
      ))}
      {view.autoCompactRemaining == null ? null : (
        <p className="ctx-chip__note">
          {view.autoCompactNow
            ? fill(labels.autoCompactNow, { percent: String(view.autoCompactPercent) })
            : fill(labels.autoCompact, {
                percent: String(view.autoCompactPercent),
                remaining: tok(view.autoCompactRemaining),
              })}
        </p>
      )}
      <p className="ctx-chip__note">
        {fill(labels.stats, {
          turns: String(view.turnCount),
          calls: String(view.toolCallCount),
          compactions: String(view.compactionCount),
        })}
      </p>
    </>
  );
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
  onUsage,
  usageAction,
  locale = "zh",
  onRefreshContext,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const snapshot = display.contextInfo ?? null;
  const nonce = display.contextInfoNonce ?? 0;
  const seenNonce = useRef(0);
  const { pos, style: popStyle } = useFloatingMenu({
    open,
    triggerRef,
    panelRef: popRef,
    roots: [rootRef],
    onClose: () => setOpen(false),
    placement: "up",
    fitContent: true,
    minWidth: snapshot ? 360 : 220,
    estHeight: snapshot ? 520 : 420,
    gap: 8,
    deps: [
      display.label,
      display.lastCompact?.messageId,
      display.breakdown?.totalTokens,
      snapshot?.used,
      snapshot?.total,
    ],
  });

  const tip = useMemo(() => tipFor(display, labels), [display, labels]);
  useEffect(() => {
    if (nonce > seenNonce.current) {
      seenNonce.current = nonce;
      setOpen(true);
    }
  }, [nonce]);
  const lastDetail = display.lastCompact
    ? formatLastCompactDetail(display.lastCompact, labels, locale)
    : null;
  const surface = resolveContextUsageSurface(display);
  const softUnknown = surface === "soft_unknown";

  // New / empty sessions stay hidden — do not flash a "?" ring just because
  // the model catalog knows a context window size. Soft-fail after compact
  // and real known/estimated totals still surface via hasContextUsageData.
  if (!hasContextUsageData(display) && !snapshot) return null;

  return (
    <div ref={rootRef} className={`ctx-chip${open ? " is-open" : ""}`}>
      <Tip label={tip} disabled={open || disabled}>
        <button
          ref={triggerRef}
          type="button"
          className={"ctx-ring-btn" + (open ? " is-open" : "")}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${labels.aria}: ${display.label}`}
          data-context-surface={surface}
          onClick={() =>
            setOpen((v) => {
              const next = !v;
              if (next) onRefreshContext?.();
              return next;
            })
          }
        >
          <ContextRing percent={display.percent} softUnknown={softUnknown} />
        </button>
      </Tip>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            className={
              "cmm__pop cmm__pop--portal ctx-chip__pop" +
              (snapshot ? " ctx-chip__pop--snapshot" : "")
            }
            role="menu"
            aria-label={labels.menuTitle}
            style={popStyle as CSSProperties}
          >
            <div className="ctx-chip__head">{labels.menuTitle}</div>
            {snapshot ? (
              <ContextSnapshot view={snapshot} labels={labels} locale={locale} />
            ) : null}
            {snapshot ? null : (
              <>
            <div className="ctx-chip__row">
              <span className="ctx-chip__k">{labels.current}</span>
              <span className="ctx-chip__v">
                <span className="ctx-chip__tokens">{display.label}</span>
                <span className="ctx-chip__src">
                  {sourceLabel(display.source, labels)}
                </span>
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
                  <span className="ctx-chip__tokens">
                    {formatPercent(display.percent)}%
                  </span>
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
            <p className="ctx-chip__note">{labels.heuristicNote}</p>
              </>
            )}
            {snapshot ? null : (
              <>
            <div className="ctx-chip__row ctx-chip__row--wrap">
              <span className="ctx-chip__k">{labels.lastCompact}</span>
              <span className="ctx-chip__v ctx-chip__v--wrap">
                {lastDetail ?? labels.lastCompactNone}
              </span>
            </div>
            {display.lastCompact?.summaryPreview?.trim() ? (
              <p className="ctx-chip__summary">
                {display.lastCompact.summaryPreview.trim()}
              </p>
            ) : null}
              </>
            )}
            {onUsage && usageAction ? (
              <button
                type="button"
                role="menuitem"
                className="ctx-chip__action"
                onClick={() => {
                  setOpen(false);
                  onUsage();
                }}
              >
                <span>{usageAction}</span>
              </button>
            ) : null}
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
