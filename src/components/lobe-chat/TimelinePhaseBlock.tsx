/**
 * Grok.com activity phase — visual 1:1 with official web reference.
 *
 * Expanded reference:
 *   Worked for 1m 2s ∨
 *   💡 thought title
 *   │
 *   🔍 Ran 4 searches
 *   │
 *   🌐 Browsed host/path/
 *   │
 *   🌐 Searched web for {query}          10 results  [◉◉]
 *   │
 *   ○  Compiling …
 *
 * Collapsed: only “Worked for … >”
 * Live: steps + “Working for …s” footer
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import { COLLAPSE_ALL_ACTIVITY_EVENT } from "@/lib/collapseAllActivity";
import type { TimelinePhase } from "@/lib/timelinePhases";
import {
  loadToolStepsAutoCollapsePref,
  toolStepDefaultOpen,
  TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT,
} from "@/lib/toolStepsAutoCollapsePref";
import {
  estimateDurationSecFromTimestamps,
  formatWorkDuration,
} from "@/lib/formatWorkDuration";
import {
  buildGrokActivitySteps,
  type GrokActivityStep,
} from "@/lib/grokActivitySteps";
import {
  IconBulb,
  IconChevronDown,
  IconChevronRight,
  IconCircle,
  IconGridDots,
  IconSearch,
  IconWorld,
} from "@/components/icons";

function FaviconChip({ domain }: { domain: string }) {
  // Google s2 favicon — lightweight, no auth
  const src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
  return (
    <img
      className="grok-act__favicon"
      src={src}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}

function StepIcon({ step }: { step: GrokActivityStep }) {
  // Official icons are ~15–16px, thin stroke, muted gray
  const size = 15;
  const stroke = 1.5;
  if (step.type === "thought") return <IconBulb size={size} stroke={stroke} />;
  if (step.type === "search-group")
    return <IconSearch size={size} stroke={stroke} />;
  if (step.type === "web-search")
    // Official uses globe+search hybrid; World is closest available
    return <IconWorld size={size} stroke={stroke} />;
  if (step.type === "browse") return <IconWorld size={size} stroke={stroke} />;
  return <IconCircle size={size} stroke={stroke} />;
}

function StepMainText({
  step,
  tr,
}: {
  step: GrokActivityStep;
  tr: ReturnType<typeof createT>;
}) {
  switch (step.type) {
    case "thought":
      return (
        <span className="grok-act__label-text">
          {step.summary || tr("chat.thinkingLabel")}
        </span>
      );
    case "search-group":
      return (
        <span className="grok-act__label-text">
          {step.count === 1
            ? tr("chat.ranSearch")
            : tr("chat.ranSearches", { n: String(step.count) })}
        </span>
      );
    case "web-search":
      return (
        <span className="grok-act__label-text">
          <span className="grok-act__label-prefix">
            {tr("chat.searchedWebForPrefix")}
          </span>
          <span className="grok-act__label-query"> {step.query}</span>
        </span>
      );
    case "browse":
      return (
        <span className="grok-act__label-text">
          <span className="grok-act__label-prefix">{tr("chat.browsedPrefix")}</span>
          <span className="grok-act__label-url"> {step.url}</span>
        </span>
      );
    case "tool":
      return <span className="grok-act__label-text">{step.summary}</span>;
  }
}

export const GrokActivitySteps = memo(function GrokActivitySteps({
  steps,
  tr,
}: {
  steps: GrokActivityStep[];
  tr: ReturnType<typeof createT>;
}) {
  if (!steps.length) return null;
  return (
    <div className="grok-act__steps" role="list">
      {steps.map((step, idx) => {
        const failed =
          step.type !== "thought" && "failed" in step ? !!step.failed : false;
        const running =
          step.type === "thought"
            ? !!step.streaming
            : "running" in step
              ? !!step.running
              : false;
        const isLast = idx === steps.length - 1;
        const resultCount =
          step.type === "web-search" ? step.resultCount : undefined;
        const domains =
          step.type === "web-search" ? step.resultDomains : undefined;

        return (
          <div
            key={step.key}
            className={
              "grok-act__step" +
              (failed ? " is-error" : "") +
              (running ? " is-running" : "") +
              (isLast ? " is-last" : "")
            }
            role="listitem"
            data-step-type={step.type}
          >
            <div className="grok-act__icon-col" aria-hidden>
              <span className="grok-act__icon">
                <StepIcon step={step} />
              </span>
              {!isLast ? <span className="grok-act__rail" /> : null}
            </div>
            <div className="grok-act__main">
              <div className="grok-act__label-row">
                <StepMainText step={step} tr={tr} />
                {resultCount != null || (domains && domains.length > 0) ? (
                  <span className="grok-act__meta">
                    {resultCount != null ? (
                      <span className="grok-act__meta-count">
                        {tr("chat.searchResults", { n: String(resultCount) })}
                      </span>
                    ) : null}
                    {domains && domains.length > 0 ? (
                      <span className="grok-act__favicons">
                        {domains.slice(0, 3).map((d) => (
                          <FaviconChip key={d} domain={d} />
                        ))}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

export const TimelinePhaseBlock = memo(function TimelinePhaseBlock({
  phase,
  locale,
  messageStreaming,
  autoCollapse: autoCollapseProp,
  durationSec: durationSecProp,
  historyTimestamps,
}: {
  phase: TimelinePhase;
  locale: Locale;
  messageStreaming?: boolean;
  autoCollapse?: boolean;
  durationSec?: number | null;
  historyTimestamps?: Array<string | undefined | null>;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [autoCollapse, setAutoCollapse] = useState(
    () => autoCollapseProp ?? loadToolStepsAutoCollapsePref(),
  );

  useEffect(() => {
    if (autoCollapseProp != null) setAutoCollapse(autoCollapseProp);
  }, [autoCollapseProp]);

  useEffect(() => {
    if (autoCollapseProp != null) return;
    const onPref = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setAutoCollapse(
        typeof detail === "boolean"
          ? detail
          : loadToolStepsAutoCollapsePref(),
      );
    };
    window.addEventListener(TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT, onPref);
    return () => {
      window.removeEventListener(TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT, onPref);
    };
  }, [autoCollapseProp]);

  const phaseRunning = phase.live || phase.runningCount > 0;
  const wantOpen = toolStepDefaultOpen(phaseRunning, autoCollapse);
  const [open, setOpen] = useState(wantOpen);
  const userToggled = useRef(false);

  useEffect(() => {
    if (phaseRunning) {
      setOpen(true);
      userToggled.current = false;
      return;
    }
    if (!userToggled.current) setOpen(wantOpen);
  }, [phaseRunning, wantOpen, phase.id]);

  useEffect(() => {
    const onCollapseAll = () => {
      if (phaseRunning) return;
      userToggled.current = true;
      setOpen(false);
    };
    window.addEventListener(COLLAPSE_ALL_ACTIVITY_EVENT, onCollapseAll);
    return () => {
      window.removeEventListener(COLLAPSE_ALL_ACTIVITY_EVENT, onCollapseAll);
    };
  }, [phaseRunning]);

  const startRef = useRef<number | null>(null);
  const [liveSec, setLiveSec] = useState<number | null>(null);

  const historySec = useMemo(() => {
    if (durationSecProp != null && durationSecProp > 0) return durationSecProp;
    return estimateDurationSecFromTimestamps([
      ...(historyTimestamps ?? []),
      ...phase.tools.map((t) => t.createdAt),
    ]);
  }, [durationSecProp, historyTimestamps, phase.tools]);

  useEffect(() => {
    if (phaseRunning) {
      if (startRef.current == null) startRef.current = Date.now();
      const tick = () => {
        if (startRef.current != null) {
          setLiveSec(
            Math.max(1, Math.floor((Date.now() - startRef.current) / 1000)),
          );
        }
      };
      tick();
      const id = window.setInterval(tick, 1000);
      return () => window.clearInterval(id);
    }
    if (startRef.current != null) {
      setLiveSec(
        Math.max(1, Math.floor((Date.now() - startRef.current) / 1000)),
      );
      startRef.current = null;
    }
  }, [phaseRunning, phase.id]);

  const stepsResolved = useMemo(() => {
    const items =
      phase.items?.length
        ? phase.items
        : [
            ...phase.thoughts
              .filter((t) => t.trim())
              .map((text) => ({ kind: "thought" as const, text })),
            ...phase.tools.map((tool) => ({ kind: "tool" as const, tool })),
          ];
    return buildGrokActivitySteps(items, {
      live: phase.live,
      messageStreaming: !!messageStreaming,
    });
  }, [phase.items, phase.thoughts, phase.tools, phase.live, messageStreaming]);

  const durationSec = liveSec ?? historySec;
  const durationText =
    durationSec != null ? formatWorkDuration(durationSec) : null;
  const workedLabel =
    durationText != null
      ? tr("chat.workedFor", { duration: durationText })
      : tr("chat.worked");
  const workingLabel =
    durationText != null
      ? tr("chat.workingFor", { duration: durationText })
      : tr("chat.working");

  if (phaseRunning) {
    return (
      <div
        className="grok-act is-live"
        data-testid="timeline-phase"
        data-phase-id={phase.id}
        data-live="1"
      >
        <GrokActivitySteps steps={stepsResolved} tr={tr} />
        <div className="grok-act__working" role="status" aria-live="polite">
          <span className="grok-act__working-icon" aria-hidden>
            <IconGridDots size={14} stroke={1.5} />
          </span>
          <span className="grok-act__working-label">{workingLabel}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={"grok-act" + (open ? " is-open" : " is-collapsed")}
      data-testid="timeline-phase"
      data-phase-id={phase.id}
      data-live="0"
      data-expanded={open ? "1" : "0"}
    >
      <button
        type="button"
        className="grok-act__header"
        aria-expanded={open}
        onClick={() => {
          userToggled.current = true;
          setOpen((v) => !v);
        }}
      >
        <span className="grok-act__header-text">{workedLabel}</span>
        <span className="grok-act__header-caret" aria-hidden>
          {open ? (
            <IconChevronDown size={13} stroke={2} />
          ) : (
            <IconChevronRight size={13} stroke={2} />
          )}
        </span>
      </button>
      {open ? <GrokActivitySteps steps={stepsResolved} tr={tr} /> : null}
    </div>
  );
});
