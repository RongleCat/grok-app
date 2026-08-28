/**
 * Bare thinking row (no tools in this burst) — unified chrome with work phases.
 *
 * Official rhythm:
 * - Streaming: 💡 思考中 / Thinking for {duration}  (live timer, always)
 * - Done collapsed (default): 💡 思考了 / Thought for {duration}  >
 * - Done expanded: same header + muted body
 *
 * Never use gist / first-line body as the chrome label.
 * Tool bursts use TimelinePhaseBlock (“工作了 / Worked for …”) instead.
 */

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconBulb, IconChevronDown, IconChevronRight } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useThoughtBodyFollow } from "@/hooks/useThoughtBodyFollow";
import { MarkdownChat } from "./MarkdownChat";
import { createT, type Locale } from "@/i18n";
import { COLLAPSE_ALL_ACTIVITY_EVENT } from "@/lib/collapseAllActivity";
import { formatWorkDuration } from "@/lib/formatWorkDuration";
import { resolveThinkingChromeLabel } from "@/lib/thinkingChromeLabel";
import { resolveFoldExpanded } from "@/lib/toolStepsAutoCollapsePref";
import {
  freezeThinkingDurationMs,
  nextThinkingStartAnchor,
} from "@/lib/thinkingStartAnchor";

export const Thinking = memo(function Thinking({
  content,
  thinking,
  durationMs,
  startedAt,
  locale = "en",
  onOpenExternalLink,
}: {
  content?: string | ReactNode;
  thinking?: boolean;
  /** Duration in ms when known (live timer or history). */
  durationMs?: number;
  /**
   * Epoch ms when this thinking episode began (e.g. turn / post-steer clock).
   * Survives remounts so placeholder → real thought does not reset to “1s”.
   */
  startedAt?: number | null;
  locale?: Locale;
  onOpenExternalLink?: (url: string) => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  // Open while live, collapsed when done — same model as the work/phase block.
  // The keep-open pref no longer auto-opens finished blocks; finished thoughts
  // collapse on episode end and can be re-opened with a click.
  const [open, setOpen] = useState(() => !!thinking);
  const startRef = useRef<number | null>(null);
  const [localDuration, setLocalDuration] = useState<number | undefined>(
    durationMs,
  );
  const userToggled = useRef(false);
  const thinkingRef = useRef(!!thinking);
  thinkingRef.current = !!thinking;
  const expanded = resolveFoldExpanded({
    userToggled: userToggled.current,
    storedOpen: open,
    defaultOpen: !!thinking,
  });

  useEffect(() => {
    const onCollapseAll = () => {
      if (thinkingRef.current) return;
      userToggled.current = true;
      setOpen(false);
    };
    window.addEventListener(COLLAPSE_ALL_ACTIVITY_EVENT, onCollapseAll);
    return () => {
      window.removeEventListener(COLLAPSE_ALL_ACTIVITY_EVENT, onCollapseAll);
    };
  }, []);

  // Live wall-clock while streaming; freeze when done.
  // Prefer `startedAt` (turn / post-steer clock) so remounts after steer /
  // session switch do not collapse a long wait into “Thought for 1s”.
  // Also adopt a *later* startedAt: a leftover previous-session clock must
  // not pin “思考中 51分” after this turn’s real start arrives.
  const frozenRef = useRef(false);
  useEffect(() => {
    if (thinking) {
      frozenRef.current = false;
      setOpen(true);
      userToggled.current = false;
      startRef.current = nextThinkingStartAnchor({
        prevAnchor: startRef.current,
        startedAt,
        nowMs: Date.now(),
      });
      const tick = () => {
        const origin = startRef.current;
        if (origin != null) {
          setLocalDuration(Math.max(0, Date.now() - origin));
        }
      };
      tick();
      const id = window.setInterval(tick, 1000);
      const onVis = () => {
        if (document.visibilityState === "visible") tick();
      };
      document.addEventListener("visibilitychange", onVis);
      return () => {
        window.clearInterval(id);
        document.removeEventListener("visibilitychange", onVis);
      };
    }
    // Episode ended — freeze once from this row’s origin. Do not invent a
    // duration from a leftover turn `startedAt` (that showed “思考了 51分”).
    if (!frozenRef.current) {
      const frozen = freezeThinkingDurationMs({
        originMs: startRef.current,
        nowMs: Date.now(),
      });
      if (frozen != null) setLocalDuration(frozen);
      startRef.current = null;
      frozenRef.current = true;
    }
    // Collapse when not live — mirrors the work/phase block. The keep-open pref
    // no longer auto-opens finished blocks (it was the reason they stayed
    // expanded after the answer began). The user can still click to expand.
    if (!userToggled.current) {
      setOpen(false);
    }
  }, [thinking, startedAt, durationMs]);

  useEffect(() => {
    // History duration only applies to finished blocks. A live timer must
    // not be overwritten by a stale journal ms (that froze “思考了 N”).
    if (thinking) return;
    if (durationMs != null) setLocalDuration(durationMs);
  }, [durationMs, thinking]);

  /**
   * Chrome label:
   * - live: “思考中 {duration}” / “Thinking for {duration}”
   * - done: “思考了 {duration}” / “Thought for {duration}”
   * Never gist / body first line.
   */
  const chromeLabel = useMemo(
    () =>
      resolveThinkingChromeLabel({
        live: !!thinking,
        durationMs: localDuration,
        thinkingFor: (duration) => tr("chat.thinkingFor", { duration }),
        thoughtFor: (duration) => tr("chat.thoughtFor", { duration }),
        doneLabel: tr("chat.thoughtDone"),
        formatDuration: (sec) => formatWorkDuration(sec, locale),
      }),
    [thinking, localDuration, tr, locale],
  );

  const hasBody =
    (typeof content === "string" && content.trim().length > 0) ||
    (content != null && typeof content !== "string");
  const thoughtFollowKey = typeof content === "string" ? content : "";
  const thoughtBodyRef = useThoughtBodyFollow({
    live: !!thinking,
    expanded: expanded && hasBody,
    followKey: thoughtFollowKey,
  });

  const toggle = () => {
    if (!hasBody) return;
    // Per-block local state only — toggling one finished thought must NOT flip
    // the global default (that retroactively opened/collapsed every other
    // block via THINKING_PREF_EVENT). The global pref is Settings-only and
    // applies to blocks the user has not toggled.
    userToggled.current = true;
    setOpen(!expanded);
  };

  return (
    <div
      className={
        "grok-thought" +
        (thinking ? " is-live" : "") +
        (expanded && hasBody ? " is-open" : " is-collapsed")
      }
      data-testid="thinking-block"
      data-expanded={expanded && hasBody ? "1" : "0"}
    >
      <button
        type="button"
        className="grok-thought__header"
        aria-expanded={hasBody ? expanded : undefined}
        onClick={toggle}
        disabled={!hasBody}
      >
        <span className="grok-thought__icon" aria-hidden>
          <IconBulb size={15} stroke={1.5} />
        </span>
        <span
          className={cn(
            "grok-thought__label",
            thinking && "grok-thought__label--live",
          )}
        >
          {chromeLabel}
        </span>
        {hasBody ? (
          <span className="grok-thought__caret" aria-hidden>
            {expanded ? (
              <IconChevronDown size={12} stroke={2} />
            ) : (
              <IconChevronRight size={12} stroke={2} />
            )}
          </span>
        ) : null}
      </button>

      {/* Collapsed: header only. Expanded: muted dig-in body. */}
      {expanded && hasBody ? (
        <div ref={thoughtBodyRef} className="grok-thought__body">
          {typeof content === "string" ? (
            <MarkdownChat
              locale={locale}
              muted
              pathCards={false}
              onOpenExternalLink={onOpenExternalLink}
            >
              {content}
            </MarkdownChat>
          ) : (
            content
          )}
        </div>
      ) : null}
    </div>
  );
});
