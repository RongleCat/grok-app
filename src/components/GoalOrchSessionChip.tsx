/**
 * Chat session chrome for Goal orchestration.
 *
 * Visible only when a resolved indicator exists:
 * - `active` — latest real `goal_updated` for this session
 * - `waiting` — composer `/goal` on, harness has not emitted yet
 *
 * Never invents progress. Menu actions are supplied by the parent
 * (open Reliability · copy summary · clear local ring).
 */

import { useEffect, useState } from "react";
import {
  formatGoalOrchChipDetail,
  type GoalOrchSessionIndicator,
} from "@/lib/goalOrch";

export type GoalOrchSessionChipLabels = {
  /** Pre-resolved chip label (waiting or "Goal · {phase}"). */
  chipLabel: string;
  aria: string;
  title: string;
  menuAria: string;
  openReliability: string;
  copySummary: string;
  clearTimeline: string;
};

export type GoalOrchSessionChipProps = {
  indicator: GoalOrchSessionIndicator;
  /** Translated phase name (active chip title). */
  phaseLabel: string;
  labels: GoalOrchSessionChipLabels;
  /** Disable clear when the local ring is empty. */
  canClear: boolean;
  onOpenReliability: () => void;
  onCopySummary: () => void;
  onClearTimeline: () => void;
};

export function GoalOrchSessionChip({
  indicator,
  phaseLabel,
  labels,
  canClear,
  onOpenReliability,
  onCopySummary,
  onClearTimeline,
}: GoalOrchSessionChipProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest(".goal-orch-session-chip-wrap")) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const detailPreview =
    indicator.kind === "active"
      ? formatGoalOrchChipDetail(indicator.detail)
      : null;

  const titleParts = [
    labels.title,
    indicator.kind === "active" ? phaseLabel : null,
    indicator.label,
    indicator.progress,
    indicator.detail,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="goal-orch-session-chip-wrap">
      <button
        type="button"
        className={
          "goal-orch-session-chip" +
          (indicator.kind === "waiting"
            ? " goal-orch-session-chip--waiting"
            : "")
        }
        data-testid="goal-orch-session-chip"
        data-kind={indicator.kind}
        title={titleParts}
        aria-label={labels.aria}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        <span className="goal-orch-session-chip__dot" aria-hidden />
        <span className="goal-orch-session-chip__label">
          {labels.chipLabel}
          {detailPreview ? ` · ${detailPreview}` : ""}
        </span>
        {indicator.kind === "active" && indicator.progress ? (
          <span className="goal-orch-session-chip__meta">
            {indicator.progress}
          </span>
        ) : null}
      </button>
      {menuOpen ? (
        <div
          className="menu-panel goal-orch-session-chip__menu"
          role="menu"
          aria-label={labels.menuAria}
          data-testid="goal-orch-session-chip-menu"
        >
          <button
            type="button"
            role="menuitem"
            className="goal-orch-session-chip__menu-item"
            data-testid="goal-orch-chip-open-reliability"
            onClick={() => {
              setMenuOpen(false);
              onOpenReliability();
            }}
          >
            {labels.openReliability}
          </button>
          <button
            type="button"
            role="menuitem"
            className="goal-orch-session-chip__menu-item"
            data-testid="goal-orch-chip-copy-summary"
            onClick={() => {
              setMenuOpen(false);
              onCopySummary();
            }}
          >
            {labels.copySummary}
          </button>
          <button
            type="button"
            role="menuitem"
            className="goal-orch-session-chip__menu-item"
            data-testid="goal-orch-chip-clear-timeline"
            disabled={!canClear}
            onClick={() => {
              setMenuOpen(false);
              onClearTimeline();
            }}
          >
            {labels.clearTimeline}
          </button>
        </div>
      ) : null}
    </div>
  );
}
