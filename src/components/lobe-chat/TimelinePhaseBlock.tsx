/**
 * Collapsible work phase (CodePilot ToolActionsGroup–style).
 * Header: count badge + summary · caret right.
 * Body: single left rail with thinking + tool rows (flat, even spacing).
 */

import { useEffect, useMemo, useState } from "react";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import { COLLAPSE_ALL_ACTIVITY_EVENT } from "@/lib/collapseAllActivity";
import type { TimelinePhase } from "@/lib/timelinePhases";
import { phaseTitleModel } from "@/lib/timelinePhases";
import { IconChevronRight } from "@/components/icons";
import { Thinking } from "./Thinking";
import {
  buildTimelineDisplayItems,
  TimelineContextGroup,
  TimelineToolRow,
} from "./TimelineToolRow";
import type { MessageSegment } from "@/lib/session";

function buildPhaseTitle(
  phase: TimelinePhase,
  tr: ReturnType<typeof createT>,
): string {
  const m = phaseTitleModel(phase);
  const n = m.stepCount;
  const e = m.errorCount;
  const gist = m.gist;

  if (m.running || (m.live && n > 0 && !gist)) {
    if (gist) return tr("timelinePhase.gistRunning", { gist, n });
    if (n > 0) return tr("timelinePhase.running", { n });
    return tr("timelinePhase.working");
  }
  if (gist && n > 0 && e > 0) {
    return tr("timelinePhase.gistStepsWithErrors", { gist, n, e });
  }
  if (gist && n > 0) {
    return tr("timelinePhase.gistSteps", { gist, n });
  }
  if (n > 0 && e > 0) {
    return tr("timelinePhase.stepsWithErrors", { n, e });
  }
  if (n > 0) return tr("timelinePhase.steps", { n });
  if (gist) return gist;
  return tr("timelinePhase.working");
}

export function TimelinePhaseBlock({
  phase,
  locale,
  messageStreaming,
}: {
  phase: TimelinePhase;
  locale: Locale;
  messageStreaming?: boolean;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const title = useMemo(() => buildPhaseTitle(phase, tr), [phase, tr]);
  // Expand while the phase is live or any tool failed (review errors).
  // Do not keep open for runningCount after the phase closed — segment end
  // (content / next thought / turn idle) must auto-collapse.
  const shouldExpand = phase.live || phase.errorCount > 0;
  const [open, setOpen] = useState(shouldExpand);

  useEffect(() => {
    if (shouldExpand) {
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [shouldExpand, phase.id]);

  // One-click collapse all tool phases in the current chat.
  useEffect(() => {
    const onCollapseAll = () => setOpen(false);
    window.addEventListener(COLLAPSE_ALL_ACTIVITY_EVENT, onCollapseAll);
    return () => {
      window.removeEventListener(COLLAPSE_ALL_ACTIVITY_EVENT, onCollapseAll);
    };
  }, []);

  const toolDisplay = useMemo(() => {
    const segs: MessageSegment[] = phase.tools.map((t) => t);
    return buildTimelineDisplayItems(segs);
  }, [phase.tools]);

  const badgeCount =
    phase.tools.length + (phase.thoughts.some((t) => t.trim()) ? 1 : 0);

  return (
    <div
      className={
        "lobe-timeline-phase" +
        (phase.live ? " is-live" : "") +
        (phase.errorCount > 0 ? " is-error" : "") +
        (open ? " is-open" : "")
      }
      data-testid="timeline-phase"
      data-phase-id={phase.id}
      data-live={phase.live ? "1" : "0"}
    >
      <button
        type="button"
        className="lobe-timeline-phase__trigger"
        aria-expanded={open}
        onClick={() => {
          // While tools are running, block click-to-collapse (auto-expand stays
          // the default). Still allow expand if collapse-all forced us closed.
          if (open && phase.live && phase.runningCount > 0) return;
          setOpen((v) => !v);
        }}
      >
        <span className="lobe-timeline-phase__badge" aria-hidden>
          {badgeCount}
        </span>
        <span
          className={
            "lobe-timeline-phase__title" +
            (phase.errorCount > 0 ? " is-error" : "") +
            (phase.live || phase.runningCount > 0 ? " is-running" : "")
          }
        >
          {title}
        </span>
        <span
          className={
            "lobe-timeline-phase__caret" + (open ? " is-open" : "")
          }
          aria-hidden
        >
          <IconChevronRight size={12} />
        </span>
      </button>
      {open ? (
        <div className="lobe-timeline-rail">
          {phase.thoughts.map((text, i) => (
            <Thinking
              key={`${phase.id}-th-${i}`}
              locale={locale}
              thinking={
                !!(
                  phase.live &&
                  messageStreaming &&
                  i === phase.thoughts.length - 1 &&
                  phase.tools.length === 0
                )
              }
              content={text}
              streamingLabel={tr("chat.thinking")}
              doneLabel={tr("chat.thoughtDone")}
              thoughtForLabel={(n) => tr("chat.thoughtFor", { n })}
            />
          ))}
          {toolDisplay.map((item) => {
            if (item.type === "tool-group") {
              return (
                <TimelineContextGroup
                  key={`${phase.id}-ctx-${item.startSi}`}
                  tools={item.tools}
                  locale={locale}
                />
              );
            }
            if (item.seg.kind === "tool") {
              return (
                <TimelineToolRow
                  key={`${phase.id}-tool-${item.seg.toolCallId || item.si}`}
                  tool={item.seg}
                />
              );
            }
            return null;
          })}
        </div>
      ) : null}
    </div>
  );
}
