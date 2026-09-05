/**
 * Bare tool row (outside a Worked-for phase) — Grok icon + one-line label.
 * Phase interior uses GrokActivitySteps inside TimelinePhaseBlock.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Locale, MessageKey } from "@/i18n";
import { createT } from "@/i18n";
import type { ChatMessage, MessageSegment, MessageToolSegment } from "@/lib/session";
import {
  isToolStepMessage,
  parseToolStepContent,
  toolStepDisplayTitle,
} from "@/lib/session";
import {
  isBrowseToolKind,
  isContextToolKind,
  isSearchToolKind,
  classifyToolKind,
  resolveToolPrimaryLabel,
  toolExpandBody,
  toolExpandHasBody,
} from "@/lib/toolDisplay";
import { normalizeTaskStatus } from "@/lib/sessionTasks";
import {
  loadToolStepsAutoCollapsePref,
  resolveFoldExpanded,
  toolStepDefaultOpen,
  TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT,
} from "@/lib/toolStepsAutoCollapsePref";
import {
  IconChevronRight,
  IconSearch,
  IconWorld,
} from "@/components/icons";
import { ToolBucketIcon } from "./TimelinePhaseBlock";
import { ToolExpandBody } from "./ToolExpandBody";

export function toolSegmentIsRunning(seg: MessageToolSegment): boolean {
  if (seg.streaming) return true;
  const s = (seg.status || "").toLowerCase().trim();
  if (!s) return false;
  return s === "in_progress" || s === "pending" || s === "running";
}

export function toolSegmentFailed(seg: MessageToolSegment): boolean {
  if (seg.isError) return true;
  const s = (seg.status || "").toLowerCase();
  return s === "failed" || s === "error" || s === "rejected" || s === "denied";
}

function ToolKindIcon({ tool }: { tool: MessageToolSegment }) {
  // Match TimelinePhaseBlock / Thought chrome (15px glyph in 16px box).
  const size = 15;
  if (isBrowseToolKind(tool.toolKind, tool.title)) {
    return <IconWorld size={size} stroke={1.5} />;
  }
  if (isSearchToolKind(tool.toolKind, tool.title)) {
    return <IconSearch size={size} stroke={1.5} />;
  }
  return (
    <ToolBucketIcon
      bucket={classifyToolKind(tool.toolKind, tool.title, tool.toolCallId)}
      toolKind={tool.toolKind}
    />
  );
}

export const TimelineToolRow = memo(function TimelineToolRow({
  tool,
  autoCollapse: autoCollapseProp,
  defaultExpanded,
  locale,
}: {
  tool: MessageToolSegment;
  autoCollapse?: boolean;
  defaultExpanded?: boolean;
  locale?: Locale;
}) {
  const tr = useMemo(() => createT(locale ?? "en"), [locale]);
  const failed = toolSegmentFailed(tool);
  const running = toolSegmentIsRunning(tool);

  // Shared with phase GrokActivityStepRow — type + call args, never stdout.
  const summary = resolveToolPrimaryLabel(tool, (key, params) =>
    tr(key as MessageKey, params as Record<string, string> | undefined),
  );

  // Cheap caret predicate only. Do not strip/split stdout unless the row is
  // actually open — collapsed rows used to allocate the full expand body
  // (and put `tool.detail` on the native title) even when hidden.
  const hasBody = toolExpandHasBody(tool, failed);

  const [autoCollapse, setAutoCollapse] = useState(
    () => (autoCollapseProp !== undefined ? autoCollapseProp : loadToolStepsAutoCollapsePref()),
  );
  const userToggled = useRef(false);
  const runningRef = useRef(running);
  runningRef.current = running;

  useEffect(() => {
    if (autoCollapseProp != null) setAutoCollapse(autoCollapseProp);
  }, [autoCollapseProp]);

  useEffect(() => {
    if (autoCollapseProp != null) return;
    const apply = (next: boolean) => {
      setAutoCollapse(next);
      if (!userToggled.current) {
        setOpen(toolStepDefaultOpen(runningRef.current, next));
      }
    };
    const onPref = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      apply(
        typeof detail === "boolean" ? detail : loadToolStepsAutoCollapsePref(),
      );
    };
    window.addEventListener(TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT, onPref);
    return () => {
      window.removeEventListener(TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT, onPref);
    };
  }, [autoCollapseProp]);

  const prefOpen =
    defaultExpanded != null
      ? defaultExpanded
      : toolStepDefaultOpen(running, autoCollapse);

  const [open, setOpen] = useState(() => prefOpen);
  const expanded = resolveFoldExpanded({
    userToggled: userToggled.current,
    storedOpen: open,
    defaultOpen: prefOpen,
  });

  useEffect(() => {
    if (userToggled.current) return;
    setOpen(
      defaultExpanded != null
        ? defaultExpanded
        : toolStepDefaultOpen(running, autoCollapse),
    );
  }, [running, autoCollapse, defaultExpanded, tool.toolCallId]);

  const showBody = hasBody && expanded;
  const expand = useMemo(
    () => (showBody ? toolExpandBody(tool, failed) : null),
    [showBody, tool, failed],
  );

  return (
    <div
      className={
        "grok-act__step lobe-timeline-tool" +
        (failed ? " is-error" : "") +
        (running ? " is-running" : "") +
        (showBody ? " is-expanded" : "") +
        " is-last"
      }
      role="status"
      data-tool-id={tool.toolCallId}
      data-testid="timeline-tool"
      data-expanded={hasBody ? (expanded ? "1" : "0") : undefined}
      title={tool.input || tool.path || summary}
    >
      <div className="grok-act__icon-col" aria-hidden>
        <span className="grok-act__icon">
          <ToolKindIcon tool={tool} />
        </span>
      </div>
      {hasBody ? (
        <button
          type="button"
          className="grok-act__step-btn grok-act__step-btn--grow"
          aria-expanded={expanded}
          onClick={() => {
            userToggled.current = true;
            setOpen(!expanded);
          }}
        >
          <span className="grok-act__label">{summary}</span>
          <span
            className={"grok-act__mini-caret" + (expanded ? " is-open" : "")}
            aria-hidden
          >
            <IconChevronRight size={11} />
          </span>
        </button>
      ) : (
        <span className="grok-act__label">{summary}</span>
      )}
      {showBody && expand ? <ToolExpandBody body={expand} /> : null}
    </div>
  );
});

/** ≥2 consecutive tools → collapsible group (any kind). */
export function TimelineToolGroup({
  tools,
  locale,
  autoCollapse: autoCollapseProp,
}: {
  tools: MessageToolSegment[];
  locale: Locale;
  autoCollapse?: boolean;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [autoCollapse, setAutoCollapse] = useState(
    () => (autoCollapseProp !== undefined ? autoCollapseProp : loadToolStepsAutoCollapsePref()),
  );
  const running = tools.some(toolSegmentIsRunning);
  const hasErr = tools.some(toolSegmentFailed);
  const userToggled = useRef(false);
  const runningRef = useRef(running);
  runningRef.current = running;

  useEffect(() => {
    if (autoCollapseProp != null) setAutoCollapse(autoCollapseProp);
  }, [autoCollapseProp]);

  useEffect(() => {
    if (autoCollapseProp != null) return;
    const apply = (next: boolean) => {
      setAutoCollapse(next);
      if (!userToggled.current) {
        setOpen(toolStepDefaultOpen(runningRef.current, next));
      }
    };
    const onPref = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      apply(
        typeof detail === "boolean" ? detail : loadToolStepsAutoCollapsePref(),
      );
    };
    window.addEventListener(TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT, onPref);
    return () => {
      window.removeEventListener(TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT, onPref);
    };
  }, [autoCollapseProp]);

  const [open, setOpen] = useState(() =>
    toolStepDefaultOpen(running, autoCollapse),
  );
  const groupDefaultOpen = toolStepDefaultOpen(running, autoCollapse);
  const expanded = resolveFoldExpanded({
    userToggled: userToggled.current,
    storedOpen: open,
    defaultOpen: groupDefaultOpen,
  });

  useEffect(() => {
    if (userToggled.current) return;
    setOpen(toolStepDefaultOpen(running, autoCollapse));
  }, [running, autoCollapse]);

  // Host vision/X are normal tool steps inside the group — do not collapse
  // the group header into a second label.
  const allSearch = tools.every((t) => {
    const id = (t.toolCallId || "").toLowerCase();
    if (
      id.startsWith("host-vision") ||
      id.startsWith("host-x") ||
      (t.toolKind || "").toLowerCase() === "vision"
    ) {
      return false;
    }
    return isSearchToolKind(t.toolKind, t.title, t.toolCallId);
  });
  // Dominant bucket drives the group icon (bash/read/edit/…), not a bare dot.
  const dominantBucket = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tools) {
      const b = classifyToolKind(t.toolKind, t.title, t.toolCallId);
      counts.set(b, (counts.get(b) || 0) + 1);
    }
    let best: string = "fallback";
    let n = -1;
    for (const [b, c] of counts) {
      if (c > n) {
        best = b;
        n = c;
      }
    }
    return best as Parameters<typeof ToolBucketIcon>[0]["bucket"];
  }, [tools]);
  const groupKind = useMemo(
    () => (tools[0] ? tools[0].toolKind : null),
    [tools],
  );
  const groupLabel = allSearch
    ? tools.length === 1
      ? tr("chat.ranSearch")
      : tr("chat.ranSearches", { n: String(tools.length) })
    : running
      ? tr("chat.runningTools", { n: tools.length })
      : tr("chat.ranTools", { n: tools.length });

  return (
    <div
      className={
        "lobe-timeline-tool-group" +
        (hasErr ? " is-error" : "") +
        (running ? " is-running" : "")
      }
      data-testid="timeline-tool-group"
      data-tool-count={tools.length}
    >
      <button
        type="button"
        className="grok-act__step is-last grok-act__step-btn"
        aria-expanded={expanded}
        onClick={() => {
          userToggled.current = true;
          setOpen(!expanded);
        }}
      >
        <div className="grok-act__icon-col" aria-hidden>
          <span className="grok-act__icon">
            {allSearch ? (
              <IconSearch size={16} stroke={1.5} />
            ) : (
              <ToolBucketIcon bucket={dominantBucket} toolKind={groupKind} />
            )}
          </span>
        </div>
        <span className="grok-act__label">{groupLabel}</span>
        <span
          className={"grok-act__mini-caret" + (expanded ? " is-open" : "")}
          aria-hidden
        >
          <IconChevronRight size={11} />
        </span>
      </button>
      {expanded ? (
        <div className="lobe-timeline-tool-group__list">
          {tools.map((t) => (
            <TimelineToolRow
              key={t.toolCallId}
              tool={t}
              autoCollapse={autoCollapse}
              locale={locale}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type TimelineDisplayItem =
  | { type: "segment"; seg: MessageSegment; si: number }
  | { type: "tool-group"; tools: MessageToolSegment[]; startSi: number };

const CONTEXT_GROUP_MIN = 3;

export function buildTimelineDisplayItems(
  segs: MessageSegment[],
  minContext = CONTEXT_GROUP_MIN,
): TimelineDisplayItem[] {
  const items: TimelineDisplayItem[] = [];
  let i = 0;
  while (i < segs.length) {
    const seg = segs[i]!;
    if (seg.kind !== "tool") {
      items.push({ type: "segment", seg, si: i });
      i += 1;
      continue;
    }
    if (isContextToolKind(seg.toolKind, seg.title)) {
      const buf: MessageToolSegment[] = [seg];
      let j = i + 1;
      while (j < segs.length) {
        const n = segs[j]!;
        if (n.kind !== "tool") break;
        if (!isContextToolKind(n.toolKind, n.title)) break;
        buf.push(n);
        j += 1;
      }
      if (buf.length >= minContext) {
        items.push({ type: "tool-group", tools: buf, startSi: i });
        i = j;
        continue;
      }
    }
    items.push({ type: "segment", seg, si: i });
    i += 1;
  }
  return items;
}

export function toolSegmentFromMessage(
  m: ChatMessage,
): MessageToolSegment | null {
  if (!isToolStepMessage(m)) return null;
  const tcid =
    (m.toolCallId || "").trim() ||
    (m.id.startsWith("tool-") ? m.id.slice(5) : m.id);
  if (!tcid) return null;
  const status = normalizeTaskStatus(
    m.toolStatus ||
      (m.content?.startsWith("tool_step|")
        ? parseToolStepContent(m.content)?.status
        : "") ||
      "",
    m.streaming,
  );
  return {
    kind: "tool",
    toolCallId: tcid,
    title: toolStepDisplayTitle(m) || tcid,
    toolKind: m.toolKind,
    status,
    detail: m.toolDetail,
    path: m.toolPath,
    input: m.toolInput,
    // Recover real output captured behind the journal sentinel — standalone
    // (unwoven) tool rows must expand the same way woven/live rows do.
    output:
      m.toolOutput ||
      (m.content?.startsWith("tool_step|")
        ? parseToolStepContent(m.content)?.output
        : undefined),
    streaming: !!m.streaming || status === "running",
    isError: !!m.isError || status === "failed",
    createdAt: m.createdAt,
  };
}
