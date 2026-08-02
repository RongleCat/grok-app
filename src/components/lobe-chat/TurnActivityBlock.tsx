/**
 * Collapsible per-turn activity summary (CodePilot-style tool group lite).
 * Default collapsed; expands when any tool failed.
 */

import { memo, useEffect, useMemo, useState } from "react";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import type { TurnActivity, TurnActivitySegment } from "@/lib/turnActivity";
import { IconChevronDown, IconChevronRight } from "@/components/icons";

export const TurnActivityBlock = memo(function TurnActivityBlock({
  activity,
  locale,
  onOpenChanges,
  onOpenModifiedPath,
}: {
  activity: TurnActivity;
  locale: Locale;
  onOpenChanges?: () => void;
  onOpenModifiedPath?: (path: string) => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [open, setOpen] = useState(() => activity.shouldExpand);
  const [ctxOpen, setCtxOpen] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (activity.shouldExpand) setOpen(true);
  }, [activity.shouldExpand, activity.errorCount]);

  if (activity.stepCount === 0) return null;

  const title =
    activity.errorCount > 0
      ? tr("turnActivity.titleWithErrors", {
          n: activity.stepCount,
          e: activity.errorCount,
        })
      : activity.runningCount > 0
        ? tr("turnActivity.titleRunning", { n: activity.stepCount })
        : tr("turnActivity.title", { n: activity.stepCount });

  return (
    <div
      className={
        "lobe-turn-activity" +
        (activity.errorCount > 0 ? " lobe-turn-activity--error" : "") +
        (activity.runningCount > 0 ? " lobe-turn-activity--live" : "")
      }
      data-testid="turn-activity"
    >
      <button
        type="button"
        className="lobe-turn-activity__trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="lobe-turn-activity__chev" aria-hidden>
          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        </span>
        <span className="lobe-turn-activity__title">{title}</span>
      </button>
      {open ? (
        <ul className="lobe-turn-activity__list">
          {activity.segments.map((seg, i) => (
            <SegmentRow
              key={seg.kind === "context" ? `ctx-${i}` : seg.tool.id}
              seg={seg}
              locale={locale}
              ctxOpen={!!ctxOpen[i]}
              onToggleCtx={() =>
                setCtxOpen((prev) => ({ ...prev, [i]: !prev[i] }))
              }
            />
          ))}
        </ul>
      ) : null}
      {activity.modifiedPaths.length > 0 ? (
        <div className="lobe-turn-activity__files">
          <button
            type="button"
            className="lobe-turn-activity__files-btn"
            onClick={() => onOpenChanges?.()}
          >
            {tr("turnActivity.modifiedFiles", {
              n: activity.modifiedPaths.length,
            })}
          </button>
          {open
            ? activity.modifiedPaths.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="lobe-turn-activity__file"
                  title={p}
                  onClick={() => onOpenModifiedPath?.(p)}
                >
                  {p.split(/[/\\]/).pop() || p}
                </button>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
});

function SegmentRow({
  seg,
  locale,
  ctxOpen,
  onToggleCtx,
}: {
  seg: TurnActivitySegment;
  locale: Locale;
  ctxOpen: boolean;
  onToggleCtx: () => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  if (seg.kind === "context") {
    const hasErr = seg.tools.some((t) => t.isError || t.status === "failed");
    const running = seg.tools.some((t) => t.status === "running");
    return (
      <li
        className={
          "lobe-turn-activity__seg lobe-turn-activity__seg--context" +
          (hasErr ? " is-error" : "") +
          (running ? " is-running" : "")
        }
      >
        <button
          type="button"
          className="lobe-turn-activity__ctx-trigger"
          aria-expanded={ctxOpen}
          onClick={onToggleCtx}
        >
          <span className="lobe-turn-activity__dot" aria-hidden />
          <span>
            {running
              ? tr("turnActivity.gathering", { n: seg.tools.length })
              : tr("turnActivity.gathered", { n: seg.tools.length })}
          </span>
        </button>
        {ctxOpen ? (
          <ul className="lobe-turn-activity__sub">
            {seg.tools.map((t) => (
              <ToolLine key={t.id} tool={t} />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }
  return (
    <li
      className={
        "lobe-turn-activity__seg" +
        (seg.tool.isError || seg.tool.status === "failed" ? " is-error" : "") +
        (seg.tool.status === "running" ? " is-running" : "")
      }
    >
      {/* Detail tails only for failures (compact); successes = one-line title. */}
      <ToolLine tool={seg.tool} showTailFailedOnly />
    </li>
  );
}

function ToolLine({
  tool,
  showTailFailedOnly,
}: {
  tool: import("@/lib/turnActivity").TurnActivityTool;
  /** When true, only failed tools may show a short detail line (not big code blocks). */
  showTailFailedOnly?: boolean;
}) {
  const failed = tool.isError || tool.status === "failed";
  // One short failure hint — never dump full shell output in the activity list.
  const failHint =
    showTailFailedOnly && failed
      ? (tool.path || tool.detail || "").trim().split("\n")[0] || ""
      : "";
  const failHintShort =
    failHint.length > 72 ? `${failHint.slice(0, 71)}…` : failHint;

  return (
    <div className="lobe-turn-activity__tool">
      <span
        className={
          "lobe-turn-activity__dot" +
          (failed ? " is-error" : "") +
          (tool.status === "running" ? " is-running" : "")
        }
        aria-hidden
      />
      <span
        className={
          "lobe-turn-activity__tool-name" +
          (failed ? " is-error" : "")
        }
        title={tool.detail || tool.path || tool.name}
      >
        {tool.summary || tool.name}
      </span>
      {failHintShort ? (
        <span className="lobe-turn-activity__fail-hint" title={failHint}>
          {failHintShort}
        </span>
      ) : null}
    </div>
  );
}
