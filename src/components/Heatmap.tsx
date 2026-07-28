/**
 * Contribution-style activity heatmap — adapted from sister project grok-go.
 * Levels use GitHub-green palette; layout stretches cells to fill width.
 *
 * Granularity: day (7×N grid) or week (1×N row of aggregated weeks).
 * Hover: instant portaled tip (token usage) — no Tip delay.
 * Click: select a day or week range for parent (call-log filter).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HeatmapDay } from "@/lib/api";
import { formatCompactNumber } from "@/lib/accountUi";

export type HeatGranularity = "day" | "week";

/** Inclusive local calendar range (YYYY-MM-DD). Day mode: start === end. */
export type HeatRange = {
  start: string;
  end: string;
};

type Metric = "requests" | "tokens";

type DayCell = {
  kind: "day";
  date: string | null;
  day: HeatmapDay | null;
  tokens: number;
  requests: number;
  value: number;
  level: 0 | 1 | 2 | 3 | 4;
  empty: boolean;
  range: HeatRange | null;
};

type WeekCell = {
  kind: "week";
  /** First in-range day of the week column (or padded start). */
  start: string;
  end: string;
  tokens: number;
  requests: number;
  value: number;
  level: 0 | 1 | 2 | 3 | 4;
  empty: boolean;
  range: HeatRange;
};

const GAP = 3;
const LABEL_COL = 22;
const MONTH_ROW = 16;
const MIN_CELL = 10;
const MAX_CELL = 14;
/** Week mode: taller bars for a single row. */
const WEEK_CELL_H = 28;

const LEVEL_COLORS = [
  "var(--heatmap-0, #ebedf0)",
  "var(--heatmap-1, #9be9a8)",
  "var(--heatmap-2, #40c463)",
  "var(--heatmap-3, #30a14e)",
  "var(--heatmap-4, #216e39)",
] as const;

export function heatRangesEqual(
  a: HeatRange | null | undefined,
  b: HeatRange | null | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.start === b.start && a.end === b.end;
}

export function dateInHeatRange(ymd: string, range: HeatRange): boolean {
  return ymd >= range.start && ymd <= range.end;
}

export function sumHeatInRange(
  days: HeatmapDay[],
  range: HeatRange,
): { requests: number; tokens: number } {
  let requests = 0;
  let tokens = 0;
  for (const d of days) {
    if (dateInHeatRange(d.date, range)) {
      requests += d.requests;
      tokens += d.tokens;
    }
  }
  return { requests, tokens };
}

function metricValue(day: HeatmapDay, metric: Metric): number {
  if (metric === "tokens") return day.tokens;
  return day.requests;
}

function computeLevel(value: number, thresholds: number[]): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0) return 0;
  if (value <= thresholds[0]!) return 1;
  if (value <= thresholds[1]!) return 2;
  if (value <= thresholds[2]!) return 3;
  return 4;
}

function levelThresholds(values: number[]): number[] {
  const positive = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (positive.length === 0) return [1, 2, 3];
  const at = (p: number) => {
    const i = Math.min(
      positive.length - 1,
      Math.floor(p * (positive.length - 1)),
    );
    return positive[i]!;
  };
  const t1 = Math.max(at(0.25), Number.EPSILON);
  const t2 = Math.max(at(0.5), t1);
  const t3 = Math.max(at(0.75), t2);
  return [t1, t2, t3];
}

function parseYmd(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d);
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekdaySun0(d: Date): number {
  return d.getDay();
}

function tipPosFromRect(rect: DOMRect): {
  left: number;
  top: number;
  placeAbove: boolean;
} {
  const tipW = 188;
  const tipH = 56;
  const gap = 6;
  const pad = 8;
  const placeAbove = rect.top - tipH - gap >= pad;
  let left = rect.left + rect.width / 2 - tipW / 2;
  left = Math.min(
    Math.max(pad, left),
    Math.max(pad, window.innerWidth - tipW - pad),
  );
  const top = placeAbove ? rect.top - gap : rect.bottom + gap;
  return { left, top, placeAbove };
}

function buildDayGrid(
  days: HeatmapDay[],
  metric: Metric,
): { weeks: DayCell[][]; monthLabels: { week: number; label: string }[] } {
  if (days.length === 0) return { weeks: [], monthLabels: [] };

  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = parseYmd(days[0]!.date);
  const last = parseYmd(days[days.length - 1]!.date);

  const start = new Date(first);
  start.setDate(start.getDate() - weekdaySun0(start));

  const end = new Date(last);
  end.setDate(end.getDate() + (6 - weekdaySun0(end)));

  const raw: Omit<DayCell, "level">[] = [];
  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const key = formatYmd(cur);
    const inRange = cur >= first && cur <= last;
    const day = byDate.get(key) ?? null;
    const tokens = day?.tokens ?? 0;
    const requests = day?.requests ?? 0;
    raw.push({
      kind: "day",
      date: inRange ? key : null,
      day: inRange ? day : null,
      tokens,
      requests,
      value: day ? metricValue(day, metric) : 0,
      empty: !inRange,
      range: inRange ? { start: key, end: key } : null,
    });
  }

  const thresholds = levelThresholds(
    raw.filter((c) => !c.empty).map((c) => c.value),
  );
  const cells: DayCell[] = raw.map((c) => ({
    ...c,
    level: c.empty ? 0 : computeLevel(c.value, thresholds),
  }));

  const weeks: DayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  const monthLabels: { week: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const sample = week.find((c) => c.date)?.date;
    if (!sample) return;
    const m = parseYmd(sample).getMonth();
    if (m !== lastMonth) {
      lastMonth = m;
      monthLabels.push({ week: wi, label: sample.slice(5, 7) });
    }
  });

  return { weeks, monthLabels };
}

function buildWeekRow(
  days: HeatmapDay[],
  metric: Metric,
): {
  weekCells: WeekCell[];
  monthLabels: { week: number; label: string }[];
} {
  const { weeks, monthLabels } = buildDayGrid(days, metric);
  if (weeks.length === 0) return { weekCells: [], monthLabels: [] };

  const raw: Omit<WeekCell, "level">[] = weeks.map((week) => {
    const inRange = week.filter((c) => !c.empty && c.date);
    if (inRange.length === 0) {
      // Padded-only column (should be rare)
      const padStart = week[0]?.date ?? formatYmd(new Date());
      const padEnd = week[6]?.date ?? padStart;
      return {
        kind: "week" as const,
        start: padStart,
        end: padEnd,
        tokens: 0,
        requests: 0,
        value: 0,
        empty: true,
        range: { start: padStart, end: padEnd },
      };
    }
    const start = inRange[0]!.date!;
    const end = inRange[inRange.length - 1]!.date!;
    let tokens = 0;
    let requests = 0;
    for (const c of inRange) {
      tokens += c.tokens;
      requests += c.requests;
    }
    const value = metric === "tokens" ? tokens : requests;
    return {
      kind: "week" as const,
      start,
      end,
      tokens,
      requests,
      value,
      empty: false,
      range: { start, end },
    };
  });

  const thresholds = levelThresholds(
    raw.filter((c) => !c.empty).map((c) => c.value),
  );
  const weekCells: WeekCell[] = raw.map((c) => ({
    ...c,
    level: c.empty ? 0 : computeLevel(c.value, thresholds),
  }));

  return { weekCells, monthLabels };
}

function formatRangeLabel(range: HeatRange): string {
  if (range.start === range.end) return range.start;
  // Compact same-year: 2026-04-06 – 04-12
  if (range.start.slice(0, 4) === range.end.slice(0, 4)) {
    return `${range.start} – ${range.end.slice(5)}`;
  }
  return `${range.start} – ${range.end}`;
}

export function Heatmap({
  days,
  metric = "tokens",
  granularity = "day",
  locale = "en",
  labels,
  selectedRange = null,
  onSelectRange,
}: {
  days: HeatmapDay[];
  metric?: Metric;
  granularity?: HeatGranularity;
  locale?: string;
  labels: {
    less: string;
    more: string;
    noData: string;
    aria: string;
    requests: string;
    tokens: string;
  };
  selectedRange?: HeatRange | null;
  onSelectRange?: (range: HeatRange | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [hover, setHover] = useState<{
    label: string;
    tokens: number;
    left: number;
    top: number;
    placeAbove: boolean;
  } | null>(null);

  const dayGrid = useMemo(
    () => (granularity === "day" ? buildDayGrid(days, metric) : null),
    [days, metric, granularity],
  );
  const weekRow = useMemo(
    () => (granularity === "week" ? buildWeekRow(days, metric) : null),
    [days, metric, granularity],
  );

  const weekCount =
    granularity === "day"
      ? (dayGrid?.weeks.length ?? 0)
      : (weekRow?.weekCells.length ?? 0);
  const monthLabels =
    granularity === "day"
      ? (dayGrid?.monthLabels ?? [])
      : (weekRow?.monthLabels ?? []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(w);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Leaving day/week mode clears hover; parent clears selection separately.
  useEffect(() => {
    setHover(null);
  }, [granularity]);

  useEffect(() => {
    if (!hover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHover(null);
    };
    const onScroll = () => setHover(null);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [hover]);

  const cell = useMemo(() => {
    if (weekCount === 0) return MIN_CELL;
    const rightPad = 12;
    const labelW = granularity === "day" ? LABEL_COL : 0;
    if (containerWidth <= 0) return MIN_CELL;
    const available = Math.max(0, containerWidth - labelW - rightPad);
    const size = Math.floor(
      (available - (weekCount - 1) * GAP) / weekCount,
    );
    return Math.max(MIN_CELL, Math.min(MAX_CELL, size));
  }, [containerWidth, weekCount, granularity]);

  const dayLabels = useMemo(() => {
    if (locale === "zh" || locale === "zh-TW")
      return ["日", "一", "二", "三", "四", "五", "六"];
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  }, [locale]);

  const monthName = (mm: string) => {
    const idx = Number(mm) - 1;
    if (locale === "zh" || locale === "zh-TW") return `${idx + 1}月`;
    return (
      ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
        idx
      ] ?? mm
    );
  };

  if (weekCount === 0) {
    return <div className="account-heatmap__empty">{labels.noData}</div>;
  }

  const graphWidth = weekCount * (cell + GAP) - GAP;
  const graphHeight =
    granularity === "day" ? 7 * (cell + GAP) - GAP : WEEK_CELL_H;
  const monthTrail = 16;
  const labelCol = granularity === "day" ? LABEL_COL : 0;
  const totalWidth = labelCol + graphWidth + monthTrail;

  const selectRange = (range: HeatRange | null) => {
    if (!onSelectRange) return;
    if (range && heatRangesEqual(selectedRange, range)) {
      onSelectRange(null);
    } else {
      onSelectRange(range);
    }
  };

  return (
    <div ref={containerRef} className="gh-heatmap">
      <div className="gh-heatmap__inner" style={{ width: totalWidth }}>
        <div
          className="gh-heatmap__months"
          style={{ height: MONTH_ROW, marginLeft: labelCol }}
        >
          {monthLabels.map(({ week, label }) => (
            <span
              key={`${week}-${label}`}
              className="gh-heatmap__month"
              style={{ left: week * (cell + GAP) }}
            >
              {monthName(label)}
            </span>
          ))}
        </div>

        <div className="gh-heatmap__body">
          {granularity === "day" ? (
            <div
              className="gh-heatmap__dow"
              style={{ width: LABEL_COL, height: graphHeight, gap: GAP }}
            >
              {dayLabels.map((label, i) => (
                <div
                  key={label + i}
                  className="gh-heatmap__dow-label"
                  style={{
                    height: cell,
                    visibility: i % 2 === 1 ? "visible" : "hidden",
                  }}
                >
                  {label}
                </div>
              ))}
            </div>
          ) : null}

          {granularity === "day" && dayGrid ? (
            <div
              className="gh-heatmap__grid"
              role="grid"
              aria-label={labels.aria}
              style={{
                gridTemplateColumns: `repeat(${weekCount}, ${cell}px)`,
                gridTemplateRows: `repeat(7, ${cell}px)`,
                columnGap: GAP,
                rowGap: GAP,
                width: graphWidth,
                height: graphHeight,
              }}
              onPointerLeave={() => setHover(null)}
            >
              {dayGrid.weeks.map((week, wi) =>
                week.map((cellItem, di) => (
                  <button
                    key={`${wi}-${di}`}
                    type="button"
                    role="gridcell"
                    disabled={cellItem.empty || !cellItem.range}
                    aria-label={
                      cellItem.date
                        ? `${cellItem.date}, ${labels.tokens} ${formatCompactNumber(cellItem.tokens)}`
                        : undefined
                    }
                    aria-pressed={
                      !!cellItem.range &&
                      heatRangesEqual(selectedRange, cellItem.range)
                    }
                    className={
                      "gh-heatmap__cell" +
                      (cellItem.empty ? " is-empty" : "") +
                      (cellItem.range &&
                      heatRangesEqual(selectedRange, cellItem.range)
                        ? " is-selected"
                        : "")
                    }
                    style={{
                      gridColumn: wi + 1,
                      gridRow: di + 1,
                      width: cell,
                      height: cell,
                      backgroundColor: cellItem.empty
                        ? "transparent"
                        : LEVEL_COLORS[cellItem.level],
                    }}
                    onPointerEnter={(e) => {
                      if (!cellItem.date || cellItem.empty) return;
                      const rect = (
                        e.currentTarget as HTMLElement
                      ).getBoundingClientRect();
                      setHover({
                        label: cellItem.date,
                        tokens: cellItem.tokens,
                        ...tipPosFromRect(rect),
                      });
                    }}
                    onClick={() => {
                      if (!cellItem.range || cellItem.empty) return;
                      selectRange(cellItem.range);
                    }}
                  />
                )),
              )}
            </div>
          ) : weekRow ? (
            <div
              className="gh-heatmap__grid gh-heatmap__grid--weeks"
              role="grid"
              aria-label={labels.aria}
              style={{
                gridTemplateColumns: `repeat(${weekCount}, ${cell}px)`,
                gridTemplateRows: `${WEEK_CELL_H}px`,
                columnGap: GAP,
                rowGap: GAP,
                width: graphWidth,
                height: graphHeight,
              }}
              onPointerLeave={() => setHover(null)}
            >
              {weekRow.weekCells.map((w, wi) => (
                <button
                  key={`w-${wi}-${w.start}`}
                  type="button"
                  role="gridcell"
                  disabled={w.empty}
                  aria-label={`${formatRangeLabel(w.range)}, ${labels.tokens} ${formatCompactNumber(w.tokens)}`}
                  aria-pressed={heatRangesEqual(selectedRange, w.range)}
                  className={
                    "gh-heatmap__cell gh-heatmap__cell--week" +
                    (w.empty ? " is-empty" : "") +
                    (heatRangesEqual(selectedRange, w.range)
                      ? " is-selected"
                      : "")
                  }
                  style={{
                    gridColumn: wi + 1,
                    gridRow: 1,
                    width: cell,
                    height: WEEK_CELL_H,
                    backgroundColor: w.empty
                      ? "transparent"
                      : LEVEL_COLORS[w.level],
                  }}
                  onPointerEnter={(e) => {
                    if (w.empty) return;
                    const rect = (
                      e.currentTarget as HTMLElement
                    ).getBoundingClientRect();
                    setHover({
                      label: formatRangeLabel(w.range),
                      tokens: w.tokens,
                      ...tipPosFromRect(rect),
                    });
                  }}
                  onClick={() => {
                    if (w.empty) return;
                    selectRange(w.range);
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="gh-heatmap__legend">
          <span>{labels.less}</span>
          {LEVEL_COLORS.map((color, level) => (
            <span
              key={level}
              className="gh-heatmap__cell"
              style={{
                width: cell,
                height: cell,
                backgroundColor: color,
              }}
            />
          ))}
          <span>{labels.more}</span>
        </div>
      </div>

      {hover &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-heatmap-tip
            className={
              "gh-heatmap__tip gh-heatmap__tip--hover" +
              (hover.placeAbove
                ? " gh-heatmap__tip--above"
                : " gh-heatmap__tip--below")
            }
            role="tooltip"
            style={{
              left: hover.left,
              top: hover.top,
              width: 188,
            }}
          >
            <div className="gh-heatmap__tip-date">{hover.label}</div>
            <div className="gh-heatmap__tip-row">
              <span>{labels.tokens}</span>
              <span>{formatCompactNumber(hover.tokens)}</span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
