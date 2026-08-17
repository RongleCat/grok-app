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

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Locale, MessageKey } from "@/i18n";
import { createT } from "@/i18n";
import { COLLAPSE_ALL_ACTIVITY_EVENT } from "@/lib/collapseAllActivity";
import type { TimelinePhase } from "@/lib/timelinePhases";
import {
  loadToolStepsAutoCollapsePref,
  toolStepDefaultOpen,
  TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT,
} from "@/lib/toolStepsAutoCollapsePref";
import {
  earliestTimestampMs,
  estimateDurationSecFromTimestamps,
  formatWorkDuration,
  resolveWorkDurationSec,
} from "@/lib/formatWorkDuration";
import { resolveWorkChromeLabel } from "@/lib/workChromeLabel";
import {
  buildGrokActivitySteps,
  type GrokActivityStep,
} from "@/lib/grokActivitySteps";
import {
  resolveToolPrimaryLabel,
  toolExpandBody,
  type ToolDisplayKind,
} from "@/lib/toolDisplay";
import {
  GROK_ACTIVITY_STEP_ROW_PX,
  applyActivityStepExpandPolicy,
  applyActivityStepUserToggle,
  emptyActivityStepExpandState,
  grokActivityVirtualMaxHeightPx,
  shouldCapMappedGrokActivitySteps,
  shouldVirtualizeActivityWithExpand,
  type ActivityStepExpandState,
} from "@/lib/grokActivityVirtualize";
import { VirtualList } from "@/components/VirtualList";
import { ToolExpandBody } from "./ToolExpandBody";
import { MarkdownChat } from "./MarkdownChat";
import { findMatchesBeforeVisible } from "@/lib/chatFind";
import {
  IconBulb,
  IconChevronDown,
  IconChevronRight,
  IconCircle,
  IconEdit,
  IconFileText,
  IconFolder,
  IconGridDots,
  IconRobot,
  IconSearch,
  IconSkills,
  IconTerminal,
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

/** Tool-type icon — one style for live and history (typed, not a bare dot). */
export function ToolBucketIcon({
  bucket,
  toolKind,
  size = 15,
  stroke = 1.5,
}: {
  bucket: ToolDisplayKind;
  toolKind?: string | null;
  size?: number;
  stroke?: number;
}) {
  // Machine tool names give finer icons than buckets (list_dir vs read_file).
  const k = (toolKind || "").toLowerCase();
  if (k.includes("list_dir") || k.includes("list_directory") || k === "ls") {
    return <IconFolder size={size} stroke={stroke} />;
  }
  switch (bucket) {
    case "bash":
      return <IconTerminal size={size} stroke={stroke} />;
    case "read":
      return <IconFileText size={size} stroke={stroke} />;
    case "edit":
      return <IconEdit size={size} stroke={stroke} />;
    case "search":
      return <IconSearch size={size} stroke={stroke} />;
    case "browse":
      return <IconWorld size={size} stroke={stroke} />;
    case "subagent":
      return <IconRobot size={size} stroke={stroke} />;
    default:
      return <IconSkills size={size} stroke={stroke} />;
  }
}

function StepIcon({ step }: { step: GrokActivityStep }) {
  // Official icons are ~15–16px, thin stroke, muted gray
  const size = 15;
  const stroke = 1.5;
  if (step.type === "speech") return null;
  if (step.type === "thought") return <IconBulb size={size} stroke={stroke} />;
  if (step.type === "bash-group")
    return <IconTerminal size={size} stroke={stroke} />;
  if (step.type === "edit-group")
    return <IconEdit size={size} stroke={stroke} />;
  if (step.type === "search-group" || step.type === "explore-group")
    return <IconSearch size={size} stroke={stroke} />;
  if (step.type === "web-search")
    // Official uses globe+search hybrid; World is closest available
    return <IconWorld size={size} stroke={stroke} />;
  if (step.type === "browse") return <IconWorld size={size} stroke={stroke} />;
  if (step.type === "tool")
    return (
      <ToolBucketIcon bucket={step.bucket} toolKind={step.tool.toolKind} />
    );
  return <IconCircle size={size} stroke={stroke} />;
}

function exploreLabel(
  step: Extract<GrokActivityStep, { type: "explore-group" }>,
  tr: ReturnType<typeof createT>,
): string {
  // “探索 · 1 次搜索, 3 个文件” — omit a clause when its count is zero so a
  // pure-read burst reads as “探索 · 3 个文件”.
  const parts: string[] = [];
  if (step.searches > 0) {
    parts.push(
      step.searches === 1
        ? tr("chat.exploreSearchesOne")
        : tr("chat.exploreSearches", { n: String(step.searches) }),
    );
  }
  if (step.reads > 0) {
    parts.push(
      step.reads === 1
        ? tr("chat.exploreFilesOne")
        : tr("chat.exploreFiles", { n: String(step.reads) }),
    );
  }
  const detail = parts.join(", ");
  return detail ? `${tr("chat.explored")} · ${detail}` : tr("chat.explored");
}

function StepMainText({
  step,
  tr,
}: {
  step: GrokActivityStep;
  tr: ReturnType<typeof createT>;
}) {
  switch (step.type) {
    case "speech":
      return null;
    case "thought":
      return (
        <span className="grok-act__label-text">
          {step.summary || tr("chat.thinkingLabel")}
        </span>
      );
    case "bash-group":
      return (
        <span className="grok-act__label-text">
          {step.count === 1
            ? tr("chat.ranCommandsOne")
            : tr("chat.ranCommands", { n: String(step.count) })}
        </span>
      );
    case "edit-group":
      return (
        <span className="grok-act__label-text">
          {step.count === 1
            ? tr("chat.editedFilesOne")
            : tr("chat.editedFiles", { n: String(step.count) })}
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
    case "explore-group":
      return (
        <span className="grok-act__label-text">{exploreLabel(step, tr)}</span>
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
    case "tool": {
      // Same primary-label resolver as bare TimelineToolRow.
      const label = resolveToolPrimaryLabel(step.tool, (key, params) =>
        tr(key as MessageKey, params as Record<string, string> | undefined),
      );
      return <span className="grok-act__label-text">{label}</span>;
    }
  }
}

const GrokActivityStepRow = memo(function GrokActivityStepRow({
  step,
  isLast,
  tr,
  locale,
  expanded,
  onUserToggle,
  onPolicySync,
  lockCollapsed,
  findQuery,
  findActiveOccurrence,
  messageContent,
  onOpenExternalLink,
}: {
  step: GrokActivityStep;
  isLast: boolean;
  tr: ReturnType<typeof createT>;
  locale: Locale;
  /** Parent-owned open state — survives VirtualList → map remount. */
  expanded: boolean;
  /** User click: mark user-toggled + set open (parent). */
  onUserToggle?: (key: string, open: boolean) => void;
  /**
   * Fixed-height VirtualList rows cannot host expand bodies. Hide detail
   * while windowed so stdout / thought text cannot paint over the next row.
   */
  lockCollapsed?: boolean;
  /**
   * Running / auto-collapse policy sync (parent). Applies even when currently
   * expanded so running→finished collapses under default autoCollapse.
   * Never called on unmount.
   */
  onPolicySync?: (
    key: string,
    opts: { hasBody: boolean; running: boolean; autoCollapse: boolean },
  ) => void;
  findQuery?: string;
  findActiveOccurrence?: number | null;
  messageContent?: string;
  onOpenExternalLink?: (url: string) => void;
}) {
  const failed =
    step.type !== "thought" &&
    step.type !== "speech" &&
    "failed" in step
      ? !!step.failed
      : false;
  const running =
    step.type === "thought"
      ? !!step.streaming
      : step.type === "speech"
        ? false
        : "running" in step
          ? !!step.running
          : false;
  const resultCount =
    step.type === "web-search" ? step.resultCount : undefined;
  const domains =
    step.type === "web-search" ? step.resultDomains : undefined;

  const expandTool = step.type === "tool" ? step.tool : null;
  const expand = expandTool
    ? toolExpandBody(expandTool, failed)
    : {
        failHint: "",
        failHintShort: "",
        detailTail: "",
        outputBody: "",
        command: "",
        hasBody: false,
      };
  // An explore-group is always expandable: its body is the child step list.
  // A thought step is expandable when it has body text beyond the one-line
  // summary — otherwise the reasoning is unreadable inside the phase (only the
  // summary showed, with no way to open the full text like tools could).
  const grouped =
    step.type === "explore-group" ||
    step.type === "bash-group" ||
    step.type === "edit-group";
  const hasBody =
    expand.hasBody ||
    (grouped && step.children.length > 0) ||
    (step.type === "thought" && step.text.trim().length > 0);

  const runningRef = useRef(running);
  runningRef.current = running;
  const [autoCollapse, setAutoCollapse] = useState(() =>
    loadToolStepsAutoCollapsePref(),
  );

  useEffect(() => {
    const onPref = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const next =
        typeof detail === "boolean" ? detail : loadToolStepsAutoCollapsePref();
      setAutoCollapse(next);
    };
    window.addEventListener(TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT, onPref);
    return () => {
      window.removeEventListener(TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT, onPref);
    };
  }, []);

  // Policy: running → open; finished → toolStepDefaultOpen (autoCollapse).
  // User-toggled keys are ignored inside parent applyActivityStepExpandPolicy.
  // Do not skip when expanded=true — that blocked running→finished collapse.
  useEffect(() => {
    if (!hasBody || !onPolicySync) return;
    onPolicySync(step.key, {
      hasBody: true,
      running,
      autoCollapse,
    });
  }, [running, autoCollapse, step.key, hasBody, onPolicySync]);

  const open = hasBody && expanded && !lockCollapsed;
  const showBody = open;

  if (step.type === "speech") {
    const speechFindBase = findMatchesBeforeVisible({
      full: messageContent ?? "",
      visible: step.text,
      query: findQuery ?? "",
    });
    return (
      <div
        className={"grok-act__step grok-act__step--speech" + (isLast ? " is-last" : "")}
        role="listitem"
        data-step-type="speech"
        data-testid="timeline-process-speech"
      >
        <div className="grok-act__speech">
          <MarkdownChat
            locale={locale}
            pathCards={false}
            findQuery={findQuery}
            findActiveOccurrence={findActiveOccurrence}
            findOccurrenceBase={speechFindBase}
            onOpenExternalLink={onOpenExternalLink}
          >
            {step.text}
          </MarkdownChat>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        "grok-act__step" +
        (failed ? " is-error" : "") +
        (running ? " is-running" : "") +
        (isLast ? " is-last" : "") +
        (showBody ? " lobe-timeline-tool is-expanded" : "")
      }
      role="listitem"
      data-step-type={step.type}
      data-expanded={hasBody ? (open ? "1" : "0") : undefined}
    >
      <div className="grok-act__icon-col" aria-hidden>
        <span className="grok-act__icon">
          <StepIcon step={step} />
        </span>
        {!isLast ? <span className="grok-act__rail" /> : null}
      </div>
      <div className="grok-act__main">
        <div className="grok-act__label-row">
          {hasBody ? (
            <button
              type="button"
              className="grok-act__step-btn grok-act__step-btn--grow"
              aria-expanded={open}
              onClick={() => {
                onUserToggle?.(step.key, !expanded);
              }}
            >
              <StepMainText step={step} tr={tr} />
              <span
                className={"grok-act__mini-caret" + (open ? " is-open" : "")}
                aria-hidden
              >
                <IconChevronRight size={11} />
              </span>
            </button>
          ) : (
            <StepMainText step={step} tr={tr} />
          )}
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
        {showBody ? (
          step.type === "explore-group" ||
          step.type === "bash-group" ||
          step.type === "edit-group" ? (
            <div className="grok-act__explore-children">
              <GrokActivitySteps
                steps={step.children}
                tr={tr}
                locale={locale}
                findQuery={findQuery}
                findActiveOccurrence={findActiveOccurrence}
                messageContent={messageContent}
                onOpenExternalLink={onOpenExternalLink}
              />
            </div>
          ) : step.type === "thought" ? (
            <div className="grok-act__thought-body">
              <MarkdownChat locale={locale} muted pathCards={false}>
                {step.text}
              </MarkdownChat>
            </div>
          ) : (
            <ToolExpandBody
              body={expand}
              className="lobe-timeline-tool__body grok-act__expand-body"
            />
          )
        ) : null}
      </div>
    </div>
  );
});

/**
 * Grok activity step list. Short lists map fully; long lists window via
 * VirtualList so multi-turn phases with 20–100+ steps stay light.
 * Live phases pin the scroller to the tail (last step key).
 * When any step is expanded, leave VirtualList so fixed row height is not
 * broken — expanded body uses max-height + internal scroll instead.
 * Expand + userToggled keys live on the parent so remount keeps open state
 * and running→finished still auto-collapses when the user did not toggle.
 */
export function GrokActivitySteps({
  steps,
  tr,
  locale,
  live = false,
  findQuery,
  findActiveOccurrence,
  messageContent,
  onOpenExternalLink,
}: {
  steps: GrokActivityStep[];
  tr: ReturnType<typeof createT>;
  locale: Locale;
  /** When true, prefer showing the tail of a virtualized list. */
  live?: boolean;
  findQuery?: string;
  findActiveOccurrence?: number | null;
  messageContent?: string;
  onOpenExternalLink?: (url: string) => void;
}) {
  const total = steps.length;
  const [expandState, setExpandState] = useState<ActivityStepExpandState>(() =>
    emptyActivityStepExpandState(),
  );
  // Parent owns open + user-toggled sets — never clear on row unmount.
  const onUserToggle = useCallback((key: string, open: boolean) => {
    setExpandState((prev) => applyActivityStepUserToggle(prev, key, open));
  }, []);
  const onPolicySync = useCallback(
    (
      key: string,
      opts: { hasBody: boolean; running: boolean; autoCollapse: boolean },
    ) => {
      setExpandState((prev) => applyActivityStepExpandPolicy(prev, key, opts));
    },
    [],
  );
  const liveBodyCount = steps.reduce((n, s) => {
    if (s.type === "speech") return n;
    if (s.type === "thought") return n + (s.streaming && s.text.trim() ? 1 : 0);
    return n + ("running" in s && s.running ? 1 : 0);
  }, 0);
  const virtualize =
    !steps.some((s) => s.type === "speech") &&
    shouldVirtualizeActivityWithExpand(
      total,
      expandState.expandedKeys.size,
      liveBodyCount,
    );
  const lastKey = total > 0 ? steps[total - 1]!.key : null;

  const getKey = useCallback((step: GrokActivityStep) => step.key, []);
  const renderItem = useCallback(
    (step: GrokActivityStep, idx: number) => (
      <GrokActivityStepRow
        step={step}
        isLast={idx === total - 1}
        tr={tr}
        locale={locale}
        expanded={expandState.expandedKeys.has(step.key)}
        onUserToggle={onUserToggle}
        onPolicySync={onPolicySync}
        lockCollapsed={virtualize}
        findQuery={findQuery}
        findActiveOccurrence={findActiveOccurrence}
        messageContent={messageContent}
        onOpenExternalLink={onOpenExternalLink}
      />
    ),
    [
      total,
      tr,
      locale,
      expandState.expandedKeys,
      onUserToggle,
      onPolicySync,
      virtualize,
      findQuery,
      findActiveOccurrence,
      messageContent,
      onOpenExternalLink,
    ],
  );

  if (!total) return null;

  if (!virtualize) {
    // Long mapped lists (speech / expanded detail) keep a tall CSS cap so
    // they do not dump 20–200 rows into the transcript. Do not set an
    // inline N×rowHeight — that 360px box used to flex-shrink every row
    // and paint expand bodies over the next tools.
    const cap = shouldCapMappedGrokActivitySteps(total);
    return (
      <div
        className={
          "grok-act__steps" + (cap ? " grok-act__steps--capped" : "")
        }
        role="list"
      >
        {steps.map((step, idx) => (
          <GrokActivityStepRow
            key={step.key}
            step={step}
            isLast={idx === total - 1}
            tr={tr}
            locale={locale}
            findQuery={findQuery}
            findActiveOccurrence={findActiveOccurrence}
            messageContent={messageContent}
            onOpenExternalLink={onOpenExternalLink}
            expanded={expandState.expandedKeys.has(step.key)}
            onUserToggle={onUserToggle}
            onPolicySync={onPolicySync}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className="grok-act__steps grok-act__steps--virtual"
      role="list"
      style={{ maxHeight: grokActivityVirtualMaxHeightPx(total) }}
    >
      <VirtualList
        items={steps}
        getKey={getKey}
        renderItem={renderItem}
        rowHeight={GROK_ACTIVITY_STEP_ROW_PX}
        gap={0}
        threshold={0}
        scrollToKey={live ? lastKey : null}
      />
    </div>
  );
}

export const TimelinePhaseBlock = memo(function TimelinePhaseBlock({
  phase,
  locale,
  messageStreaming,
  autoCollapse: autoCollapseProp,
  durationSec: durationSecProp,
  historyTimestamps,
  findQuery,
  findActiveOccurrence,
  messageContent,
  onOpenExternalLink,
}: {
  phase: TimelinePhase;
  locale: Locale;
  messageStreaming?: boolean;
  autoCollapse?: boolean;
  durationSec?: number | null;
  historyTimestamps?: Array<string | undefined | null>;
  findQuery?: string;
  findActiveOccurrence?: number | null;
  messageContent?: string;
  onOpenExternalLink?: (url: string) => void;
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

  // Live chrome only while the assistant turn is still open. Wire statuses
  // can stick on "running" after tools finish without a final update — those
  // must not keep "Working for …" forever once the turn is done.
  const phaseRunning =
    !!messageStreaming && (phase.live || phase.runningCount > 0);
  const wantOpen = toolStepDefaultOpen(phaseRunning, autoCollapse);
  const [open, setOpen] = useState(() =>
    // Live + autoCollapse starts collapsed — same as the effect. Using
    // wantOpen here flashed the full step list for one paint.
    phaseRunning ? !autoCollapse : wantOpen,
  );
  const userToggled = useRef(false);

  useEffect(() => {
    if (userToggled.current) return;
    if (phaseRunning) {
      // Respect auto-collapse while live. Auto-opening the full step list
      // on every streaming=true flicker was the mid-steer transcript flash
      // (collapsed “工作了” ↔ hundreds of tool rows).
      setOpen(!autoCollapse);
      return;
    }
    setOpen(wantOpen);
  }, [phaseRunning, wantOpen, autoCollapse, phase.id]);

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

  const stampPool = useMemo(
    () => [
      ...(historyTimestamps ?? []),
      ...phase.tools.map((t) => t.createdAt),
    ],
    [historyTimestamps, phase.tools],
  );

  const historySec = useMemo(() => {
    if (durationSecProp != null && durationSecProp > 0) return durationSecProp;
    return estimateDurationSecFromTimestamps(stampPool);
  }, [durationSecProp, stampPool]);

  useEffect(() => {
    // Seed / rewind the live timer from the earliest known work timestamp so a
    // remounted or trailing phase (after content split / segment reorder) does
    // not restart at "1s" and freeze a bogus short "Worked for …".
    const earliest = earliestTimestampMs(stampPool);
    if (phaseRunning) {
      if (startRef.current == null) {
        startRef.current = earliest ?? Date.now();
      } else if (earliest != null && earliest < startRef.current) {
        startRef.current = earliest;
      }
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
  }, [phaseRunning, phase.id, stampPool]);

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

  // Prefer the larger of wall-clock and timestamp span (see resolveWorkDurationSec).
  const durationSec = resolveWorkDurationSec({ liveSec, historySec });
  // Unified with thinking chrome: live always “工作中 + 计时”; done “工作了 + 时长”.
  const phaseChromeLabel = resolveWorkChromeLabel({
    live: phaseRunning,
    durationSec: phaseRunning ? (durationSec ?? liveSec ?? 0) : durationSec,
    workingFor: (duration) => tr("chat.workingFor", { duration }),
    workedFor: (duration) => tr("chat.workedFor", { duration }),
    doneLabel: tr("chat.worked"),
    formatDuration: (sec) => formatWorkDuration(sec, locale),
  });

  return (
    <div
      className={
        "grok-act" +
        (phaseRunning ? " is-live" : open ? " is-open" : " is-collapsed")
      }
      data-testid="timeline-phase"
      data-phase-id={phase.id}
      data-live={phaseRunning ? "1" : "0"}
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
        <span className="grok-act__header-icon" aria-hidden>
          <IconGridDots size={15} stroke={1.5} />
        </span>
        <span className="grok-act__header-text">{phaseChromeLabel}</span>
        <span className="grok-act__header-caret" aria-hidden>
          {open ? (
            <IconChevronDown size={12} stroke={2} />
          ) : (
            <IconChevronRight size={12} stroke={2} />
          )}
        </span>
      </button>
      {open ? (
        <GrokActivitySteps
          steps={stepsResolved}
          tr={tr}
          locale={locale}
          live={phaseRunning}
          findQuery={findQuery}
          findActiveOccurrence={findActiveOccurrence}
          messageContent={messageContent}
          onOpenExternalLink={onOpenExternalLink}
        />
      ) : null}
    </div>
  );
});
