/**
 * Bare tool row (outside a Worked-for phase) — Grok icon + one-line label.
 * Phase interior uses GrokActivitySteps inside TimelinePhaseBlock.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "@/i18n";
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
  summarizeToolDisplay,
  toolDetailTail,
} from "@/lib/toolDisplay";
import { normalizeTaskStatus } from "@/lib/sessionTasks";
import {
  loadToolStepsAutoCollapsePref,
  toolStepDefaultOpen,
  TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT,
} from "@/lib/toolStepsAutoCollapsePref";
import { extractBrowseUrl } from "@/lib/grokActivitySteps";
import {
  IconChevronRight,
  IconCircle,
  IconSearch,
  IconWorld,
} from "@/components/icons";

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

function toolSummary(seg: MessageToolSegment): string {
  const display = summarizeToolDisplay({
    kind: seg.toolKind,
    title: seg.title,
    detail: seg.detail,
    path: seg.path,
  });
  return display.summary || seg.title || seg.toolKind || seg.toolCallId;
}

function toolExpandBody(seg: MessageToolSegment, failed: boolean): {
  failHint: string;
  failHintShort: string;
  detailTail: string;
  hasBody: boolean;
} {
  const failHint = failed
    ? (seg.path || seg.detail || "").trim().split("\n")[0] || ""
    : "";
  const failHintShort =
    failHint.length > 72 ? `${failHint.slice(0, 71)}…` : failHint;
  // Host vision/X stream bodies can be long — show more lines when expanded
  // (same rail as native tools, not a 2-line scroller).
  const hostSide = /^(host-vision|host-x)/i.test(seg.toolCallId || "");
  const detailTail = toolDetailTail(seg.detail, hostSide ? 24 : 8);
  const hasBody =
    !!failHintShort ||
    (!!detailTail && detailTail !== failHint && detailTail !== failHintShort);
  return { failHint, failHintShort, detailTail, hasBody };
}

function ToolKindIcon({ tool }: { tool: MessageToolSegment }) {
  const size = 16;
  if (isBrowseToolKind(tool.toolKind, tool.title)) {
    return <IconWorld size={size} stroke={1.5} />;
  }
  if (isSearchToolKind(tool.toolKind, tool.title)) {
    return <IconSearch size={size} stroke={1.5} />;
  }
  return <IconCircle size={size} stroke={1.5} />;
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

  let summary: string;
  const hostVision =
    (tool.toolCallId || "").toLowerCase().startsWith("host-vision") ||
    (tool.toolKind || "").toLowerCase() === "vision";
  const hostX = (tool.toolCallId || "").toLowerCase().startsWith("host-x");
  if (hostVision || hostX) {
    // Prefer Host title ("识别图片内容" / "搜索 X 信息"); never "执行了1次搜索".
    summary = (tool.title || "").trim() || toolSummary(tool);
  } else if (isBrowseToolKind(tool.toolKind, tool.title)) {
    summary = tr("chat.browsed", { url: extractBrowseUrl(tool) });
  } else if (isSearchToolKind(tool.toolKind, tool.title)) {
    summary = tr("chat.ranSearch");
  } else {
    summary = toolSummary(tool);
  }

  // Host tools use the same expand body as native tools (full detail / stream
  // dump), not a special 2-line scroller under a second title.
  const { failHint, failHintShort, detailTail, hasBody } = toolExpandBody(
    tool,
    failed,
  );

  const [autoCollapse, setAutoCollapse] = useState(
    () => autoCollapseProp ?? loadToolStepsAutoCollapsePref(),
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
      if (!runningRef.current && !userToggled.current) {
        setOpen(toolStepDefaultOpen(false, next));
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

  useEffect(() => {
    if (running) {
      setOpen(true);
      userToggled.current = false;
      return;
    }
    if (!userToggled.current) {
      setOpen(
        defaultExpanded != null
          ? defaultExpanded
          : toolStepDefaultOpen(false, autoCollapse),
      );
    }
  }, [running, autoCollapse, defaultExpanded, tool.toolCallId]);

  const showBody = hasBody && open;

  return (
    <div
      className={
        "grok-act__step lobe-timeline-tool" +
        (failed ? " is-error" : "") +
        (running ? " is-running" : "") +
        " is-last"
      }
      role="status"
      data-tool-id={tool.toolCallId}
      data-testid="timeline-tool"
      data-expanded={hasBody ? (open ? "1" : "0") : undefined}
      title={tool.detail || tool.path || summary}
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
          aria-expanded={open}
          onClick={() => {
            userToggled.current = true;
            setOpen((v) => !v);
          }}
        >
          <span className="grok-act__label">{summary}</span>
          <span
            className={"grok-act__mini-caret" + (open ? " is-open" : "")}
            aria-hidden
          >
            <IconChevronRight size={11} />
          </span>
        </button>
      ) : (
        <span className="grok-act__label">{summary}</span>
      )}
      {showBody ? (
        <div className="lobe-timeline-tool__body">
          {failHintShort ? (
            <div className="lobe-timeline-tool__fail-hint" title={failHint}>
              {failHintShort}
            </div>
          ) : null}
          {detailTail &&
          detailTail !== failHint &&
          detailTail !== failHintShort ? (
            <pre className="lobe-timeline-tool__detail">{detailTail}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

/** ≥3 consecutive context tools → collapsible group. */
export const TimelineContextGroup = memo(function TimelineContextGroup({
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
    () => autoCollapseProp ?? loadToolStepsAutoCollapsePref(),
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
      if (!runningRef.current && !userToggled.current) {
        setOpen(toolStepDefaultOpen(false, next));
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

  useEffect(() => {
    if (running) {
      setOpen(true);
      userToggled.current = false;
      return;
    }
    if (!userToggled.current) {
      setOpen(toolStepDefaultOpen(false, autoCollapse));
    }
  }, [running, autoCollapse]);

  // Host vision/X are normal tool steps inside the phase — do not collapse
  // the group header into a second "识别图片内容" label.
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
  const groupLabel = allSearch
    ? tools.length === 1
      ? tr("chat.ranSearch")
      : tr("chat.ranSearches", { n: String(tools.length) })
    : running
      ? tr("turnActivity.gathering", { n: tools.length })
      : tr("turnActivity.gathered", { n: tools.length });

  return (
    <div
      className={
        "lobe-timeline-tool-group" +
        (hasErr ? " is-error" : "") +
        (running ? " is-running" : "")
      }
      data-testid="timeline-tool-group"
    >
      <button
        type="button"
        className="grok-act__step is-last grok-act__step-btn"
        aria-expanded={open}
        onClick={() => {
          userToggled.current = true;
          setOpen((v) => !v);
        }}
      >
        <div className="grok-act__icon-col" aria-hidden>
          <span className="grok-act__icon">
            {allSearch ? (
              <IconSearch size={16} stroke={1.5} />
            ) : (
              <IconCircle size={16} stroke={1.5} />
            )}
          </span>
        </div>
        <span className="grok-act__label">{groupLabel}</span>
      </button>
      {open ? (
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
});

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
    streaming: !!m.streaming || status === "running",
    isError: !!m.isError || status === "failed",
    createdAt: m.createdAt,
  };
}
