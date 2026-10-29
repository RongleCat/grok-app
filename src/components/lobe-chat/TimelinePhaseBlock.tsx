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

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Locale, MessageKey } from "@/i18n";
import { createT } from "@/i18n";
import { COLLAPSE_ALL_ACTIVITY_EVENT } from "@/lib/collapseAllActivity";
import { claimEntrance } from "@/lib/entranceLedger";
import { toolSegmentIsRunning } from "./TimelineToolRow";
import { StepMainText } from "./StepMainText";
import type { TimelinePhase } from "@/lib/timelinePhases";
import type { MessageToolSegment } from "@/lib/session";
import {
  loadToolStepsAutoCollapsePref,
  resolveFoldExpanded,
  workPhaseDefaultOpen,
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
  type GrokPhaseItem,
} from "@/lib/grokActivitySteps";
import { collectPhaseErrorExcerpt } from "@/lib/phaseErrorExcerpt";
import {
  resolveToolPrimaryLabel,
  toolExpandBody,
  toolExpandHasBody,
  type ToolDisplayKind,
} from "@/lib/toolDisplay";
import {
  GROK_ACTIVITY_STEP_ROW_PX,
  applyActivityStepExpandPolicy,
  applyActivityStepUserToggle,
  emptyActivityStepExpandState,
  grokActivityVirtualMaxHeightPx,
  activityScrollerScrollToKey,
  scrollChildIntoContainer,
  shouldCapMappedGrokActivitySteps,
  shouldVirtualizeActivityWithExpand,
  type ActivityStepExpandState,
} from "@/lib/grokActivityVirtualize";
import { VirtualList } from "@/components/VirtualList";
import { useThoughtBodyFollow } from "@/hooks/useThoughtBodyFollow";
import { ToolExpandBody } from "./ToolExpandBody";
import { fleetTranscriptChip } from "@/components/FleetTranscriptChip";
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


/** In-phase tool-like steps (thinking and phase speech excluded). */
function isToolActivityStep(step: GrokActivityStep): boolean {
  return (
    step.type === "tool" ||
    step.type === "web-search" ||
    step.type === "browse" ||
    step.type === "explore-group" ||
    step.type === "bash-group" ||
    step.type === "edit-group"
  );
}

const GrokActivityStepRow = memo(function GrokActivityStepRow({
  step,
  isLast,
  isFirst,
  tr,
  locale,
  live = false,
  expanded,
  onUserToggle,
  onPolicySync,
  lockCollapsed,
  findQuery,
  findActiveOccurrence,
  messageContent,
  onOpenExternalLink,
  sessionId,
}: {
  step: GrokActivityStep;
  isLast: boolean;
  /** The first row draws no top rail; every other row draws half a segment so
   * two adjacent rows form one centred short line. */
  isFirst?: boolean;
  tr: ReturnType<typeof createT>;
  locale: Locale;
  /** Whether the phase was still generating when mounted; turning live later
   * does not replay entrance. */
  live?: boolean;
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
   * expanded so streaming-thought→finished collapses under default autoCollapse.
   * Tools never pass openWhileRunning (stay collapsed while running — #1018).
   * Never called on unmount.
   */
  onPolicySync?: (
    key: string,
    opts: {
      hasBody: boolean;
      running: boolean;
      autoCollapse: boolean;
      openWhileRunning?: boolean;
    },
  ) => void;
  findQuery?: string;
  findActiveOccurrence?: number | null;
  messageContent?: string;
  onOpenExternalLink?: (url: string) => void;
  sessionId?: string | null;
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
  // Same rule as the phase block: only tool rows mounted while the phase is
  // already live animate. Each step enters once — collapsing / expanding or
  // the stream-end remount never replays it.
  const [entered] = useState(
    () => live && isToolActivityStep(step) && claimEntrance(`step:${step.key}`),
  );
  const resultCount =
    step.type === "web-search" ? step.resultCount : undefined;
  const domains =
    step.type === "web-search" ? step.resultDomains : undefined;

  const expandTool = step.type === "tool" ? step.tool : null;
  // An explore-group is always expandable: its body is the child step list.
  // A thought step is expandable when it has body text beyond the one-line
  // summary — otherwise the reasoning is unreadable inside the phase (only the
  // summary showed, with no way to open the full text like tools could).
  const grouped =
    step.type === "explore-group" ||
    step.type === "bash-group" ||
    step.type === "edit-group";
  const hasBody =
    (expandTool ? toolExpandHasBody(expandTool, failed) : false) ||
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

  // Policy: streaming thoughts → openWhileRunning; tools stay collapsed by
  // default (including while running — #1018). Finished → autoCollapse pref.
  // User-toggled keys are ignored inside parent applyActivityStepExpandPolicy.
  useEffect(() => {
    if (!hasBody || !onPolicySync) return;
    onPolicySync(step.key, {
      hasBody: true,
      running,
      autoCollapse,
      openWhileRunning: step.type === "thought",
    });
  }, [running, autoCollapse, step.key, step.type, hasBody, onPolicySync]);

  const open = hasBody && expanded && !lockCollapsed;
  const showBody = open;
  // Body strings (ANSI-stripped, line-elided output) are built only for open
  // rows — collapsed rows in a big phase used to pay this on every mid-scroll
  // mount (see toolExpandHasBody).
  const expand = useMemo(
    () => (expandTool && open ? toolExpandBody(expandTool, failed) : null),
    [expandTool, open, failed],
  );
  const thoughtLive = step.type === "thought" && step.streaming;
  const thoughtFollowKey = step.type === "thought" ? step.text : "";
  const thoughtBodyRef = useThoughtBodyFollow({
    live: thoughtLive,
    expanded: showBody,
    followKey: thoughtFollowKey,
  });

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
        data-step-key={step.key}
        data-testid="timeline-process-speech"
      >
        <div className="grok-act__speech">
          <MarkdownChat
            locale={locale}
            pathCards={false}
            // Phase speech reveals only while the phase is live; a finished
            // phase stays static.
            streaming={step.streaming}
            chunkEnds={step.streaming ? step.chunkEnds : undefined}
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

  if (step.type === "tool") {
    const chip = fleetTranscriptChip({
      sessionId,
      name: step.tool.toolKind,
      title: step.tool.title,
      hint: step.tool.fleetHint,
      toolCallId: step.tool.toolCallId,
      label: () =>
        resolveToolPrimaryLabel(step.tool, (key, params) =>
          tr(key as MessageKey, params as Record<string, string> | undefined),
        ),
      running,
      locale,
    });
    if (chip) return chip;
  }

  return (
    <div
      className={
        "grok-act__step" +
        (failed ? " is-error" : "") +
        (running ? " is-running" : "") +
        (isLast ? " is-last" : "") +
        (entered ? " chat-block-enter" : "") +
        (showBody ? " lobe-timeline-tool is-expanded" : "")
      }
      role="listitem"
      data-step-type={step.type}
      data-step-key={step.key}
      data-expanded={hasBody ? (open ? "1" : "0") : undefined}
    >
      <div className="grok-act__icon-col" aria-hidden>
        {!isFirst ? (
          <span className="grok-act__rail grok-act__rail--top" />
        ) : null}
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
                live={live}
                findQuery={findQuery}
                findActiveOccurrence={findActiveOccurrence}
                messageContent={messageContent}
                onOpenExternalLink={onOpenExternalLink}
                sessionId={sessionId}
              />
            </div>
          ) : step.type === "thought" ? (
            <div ref={thoughtBodyRef} className="grok-act__thought-body">
              <MarkdownChat
                locale={locale}
                muted
                pathCards={false}
                // Same reveal as the standalone thinking block; enabled only
                // while this thought is still streaming.
                streaming={step.streaming}
                chunkEnds={step.streaming ? step.chunkEnds : undefined}
              >
                {step.text}
              </MarkdownChat>
            </div>
          ) : expand ? (
            <ToolExpandBody
              body={expand}
              className="lobe-timeline-tool__body grok-act__expand-body"
              locale={locale}
            />
          ) : null
        ) : null}
      </div>
    </div>
  );
});

/**
 * Grok activity step list. Short lists map fully; long lists window via
 * VirtualList so multi-turn phases with 20–100+ steps stay light.
 * Live phases pin the scroller to the tail (last step key). After live
 * ends, keep that last key so mapped→VirtualList remount does not jump
 * to the first reads.
 * When any step is expanded, leave VirtualList so fixed row height is not
 * broken — expanded body uses max-height + internal scroll instead.
 * Expand + userToggled keys live on the parent so remount keeps open state
 * and streaming-thought→finished still auto-collapses when the user did not
 * toggle. Running tools stay collapsed unless the user expands them (#1018).
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
  sessionId,
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
  sessionId?: string | null;
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
      opts: {
        hasBody: boolean;
        running: boolean;
        autoCollapse: boolean;
        openWhileRunning?: boolean;
      },
    ) => {
      setExpandState((prev) => applyActivityStepExpandPolicy(prev, key, opts));
    },
    [],
  );
  const liveThoughtCount = steps.reduce((n, s) => {
    if (s.type !== "thought") return n;
    return n + (s.streaming && s.text.trim() ? 1 : 0);
  }, 0);
  const virtualize =
    !steps.some((s) => s.type === "speech") &&
    shouldVirtualizeActivityWithExpand(
      total,
      expandState.expandedKeys.size,
      liveThoughtCount,
    );
  const followKey = activityScrollerScrollToKey(live, steps);
  const scrollerRef = useRef<HTMLDivElement>(null);
  /** True while the nested scroller should stay on the live/settle tail. */
  const stickToLiveRef = useRef(live);
  const wasLiveRef = useRef(live);
  if (live && !wasLiveRef.current) stickToLiveRef.current = true;
  wasLiveRef.current = live;
  const scrollToKey =
    live || stickToLiveRef.current ? followKey : null;

  useLayoutEffect(() => {
    if (!followKey) return;
    const root = scrollerRef.current;
    if (!root) return;
    if (!stickToLiveRef.current) return;
    const el = root.querySelector(
      `[data-step-key="${CSS.escape(followKey)}"]`,
    );
    if (el instanceof HTMLElement) {
      // Nested scroller only. scrollIntoView walks the chat ancestor and
      // unpins stick-to-bottom when the next thinking / tool / body round
      // starts below a still-visible live step.
      scrollChildIntoContainer(root, el);
      return;
    }
    root.scrollTop = root.scrollHeight;
  }, [live, followKey, total]);

  const getKey = useCallback((step: GrokActivityStep) => step.key, []);
  const renderItem = useCallback(
    (step: GrokActivityStep, idx: number) => (
      <GrokActivityStepRow
        step={step}
        isLast={idx === total - 1}
        isFirst={idx === 0}
        tr={tr}
        locale={locale}
        live={live}
        expanded={expandState.expandedKeys.has(step.key)}
        onUserToggle={onUserToggle}
        onPolicySync={onPolicySync}
        lockCollapsed={virtualize}
        findQuery={findQuery}
        findActiveOccurrence={findActiveOccurrence}
        messageContent={messageContent}
        onOpenExternalLink={onOpenExternalLink}
        sessionId={sessionId}
      />
    ),
    [
      total,
      tr,
      locale,
      live,
      expandState.expandedKeys,
      onUserToggle,
      onPolicySync,
      virtualize,
      findQuery,
      findActiveOccurrence,
      messageContent,
      onOpenExternalLink,
      sessionId,
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
        ref={scrollerRef}
        className={
          "grok-act__steps" + (cap ? " grok-act__steps--capped" : "")
        }
        role="list"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToLiveRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 64;
        }}
      >
        {steps.map((step, idx) => (
          <GrokActivityStepRow
            key={step.key}
            step={step}
            isLast={idx === total - 1}
            isFirst={idx === 0}
            tr={tr}
            locale={locale}
            live={live}
            findQuery={findQuery}
            findActiveOccurrence={findActiveOccurrence}
            messageContent={messageContent}
            onOpenExternalLink={onOpenExternalLink}
            sessionId={sessionId}
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
      ref={scrollerRef}
      className="grok-act__steps grok-act__steps--virtual"
      role="list"
      style={{ maxHeight: grokActivityVirtualMaxHeightPx(total) }}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToLiveRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 64;
      }}
    >
      <VirtualList
        items={steps}
        getKey={getKey}
        renderItem={renderItem}
        rowHeight={GROK_ACTIVITY_STEP_ROW_PX}
        gap={0}
        threshold={0}
        scrollToKey={scrollToKey}
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
  sessionId,
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
  sessionId?: string | null;
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
  // The collapsed header shows what the agent is doing right now: the tool
  // row's primary label, or "Thinking" during a thought. Switching in-phase
  // activity remounts the label node, which fades it in.
  const liveActivity = useMemo(() => {
    if (!phaseRunning) return null;
    const labelFor = (tool: MessageToolSegment) =>
      resolveToolPrimaryLabel(tool, (key, params) =>
        tr(key as MessageKey, params as Record<string, string> | undefined),
      );
    // Prefer a tool that is still running (the last one for parallel calls).
    for (let i = phase.items.length - 1; i >= 0; i--) {
      const item = phase.items[i]!;
      if (item.kind === "tool" && toolSegmentIsRunning(item.tool)) {
        return {
          key: `tool:${item.tool.toolCallId || i}`,
          label: labelFor(item.tool),
        };
      }
    }
    // Otherwise fall back to the newest work item: thinking, or the tool that
    // just finished.
    for (let i = phase.items.length - 1; i >= 0; i--) {
      const item = phase.items[i]!;
      if (item.kind === "thought") {
        return { key: `thought:${i}`, label: tr("chat.thinking") };
      }
      if (item.kind === "tool") {
        return {
          key: `tool:${item.tool.toolCallId || i}`,
          label: labelFor(item.tool),
        };
      }
    }
    return null;
  }, [phase.items, phaseRunning, tr]);
  // Only phases that are already live when mounted animate; turning running
  // later does not replay entrance. Each phase enters once — history phases
  // claim no key at mount.
  const [entered] = useState(
    () => phaseRunning && claimEntrance(`phase:${phase.id}`),
  );
  const wantOpen = workPhaseDefaultOpen({
    running: phaseRunning,
    errorCount: phase.errorCount,
    autoCollapse,
  });
  const [open, setOpen] = useState(() => wantOpen);
  const userToggled = useRef(false);
  const expanded = resolveFoldExpanded({
    userToggled: userToggled.current,
    storedOpen: open,
    defaultOpen: wantOpen,
  });

  useEffect(() => {
    if (userToggled.current) return;
    setOpen(wantOpen);
  }, [wantOpen, phase.id]);

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

  const phaseItems = useMemo((): GrokPhaseItem[] => {
    if (phase.items?.length) return phase.items;
    return [
      ...phase.thoughts
        .filter((t) => t.trim())
        .map((text) => ({ kind: "thought" as const, text })),
      ...phase.tools.map((tool) => ({ kind: "tool" as const, tool })),
    ];
  }, [phase.items, phase.thoughts, phase.tools]);

  const stepsResolved = useMemo(() => {
    if (!expanded) return [];
    return buildGrokActivitySteps(phaseItems, {
      live: phase.live,
      messageStreaming: !!messageStreaming,
    });
  }, [expanded, phaseItems, phase.live, messageStreaming]);

  const errorExcerpt = useMemo(
    () =>
      expanded || phaseRunning
        ? { rows: [], overflow: 0 }
        : collectPhaseErrorExcerpt(phaseItems),
    [expanded, phaseRunning, phaseItems],
  );

  const openPhase = useCallback(() => {
    userToggled.current = true;
    setOpen(true);
  }, []);

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
        (phaseRunning ? " is-live" : expanded ? " is-open" : " is-collapsed") +
        // Block entrance is only for phases that first appear in the live
        // tail; history rows never get this class.
        (entered ? " chat-block-enter" : "")
      }
      data-testid="timeline-phase"
      data-phase-id={phase.id}
      data-live={phaseRunning ? "1" : "0"}
      data-expanded={expanded ? "1" : "0"}
      data-error-excerpt={
        !expanded && errorExcerpt.rows.length > 0 ? "1" : undefined
      }
    >
      <button
        type="button"
        className="grok-act__header"
        aria-expanded={expanded}
        onClick={() => {
          userToggled.current = true;
          setOpen(!expanded);
        }}
      >
        <span className="grok-act__header-icon" aria-hidden>
          <IconGridDots size={15} stroke={1.5} />
        </span>
        <span className="grok-act__header-text">
          {phaseChromeLabel}
          {liveActivity ? (
            <span
              key={liveActivity.key}
              className="grok-act__now"
              title={liveActivity.label}
            >
              {" · "}
              {liveActivity.label}
            </span>
          ) : null}
        </span>
        <span className="grok-act__header-caret" aria-hidden>
          {expanded ? (
            <IconChevronDown size={12} stroke={2} />
          ) : (
            <IconChevronRight size={12} stroke={2} />
          )}
        </span>
      </button>
      {expanded ? (
        <GrokActivitySteps
          steps={stepsResolved}
          tr={tr}
          locale={locale}
          live={phaseRunning}
          findQuery={findQuery}
          findActiveOccurrence={findActiveOccurrence}
          messageContent={messageContent}
          onOpenExternalLink={onOpenExternalLink}
          sessionId={sessionId}
        />
      ) : errorExcerpt.rows.length > 0 ? (
        <div
          className="grok-act__excerpt"
          data-testid="timeline-phase-excerpt"
        >
          <GrokActivitySteps
            steps={errorExcerpt.rows}
            tr={tr}
            locale={locale}
            live={false}
            findQuery={findQuery}
            findActiveOccurrence={findActiveOccurrence}
            messageContent={messageContent}
            onOpenExternalLink={onOpenExternalLink}
            sessionId={sessionId}
          />
          {errorExcerpt.overflow > 0 ? (
            <button
              type="button"
              className="grok-act__excerpt-more"
              data-testid="timeline-phase-excerpt-more"
              onClick={openPhase}
            >
              {tr("chat.phaseErrorsMore", {
                n: String(errorExcerpt.overflow),
              })}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
