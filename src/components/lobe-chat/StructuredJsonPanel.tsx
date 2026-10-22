/**
 * Structured JSON panel under an assistant reply when the session has an
 * optional JSON Schema (structured output mode).
 *
 * Progressive: while streaming, shows partial JSON + validation timeline;
 * when complete, pretty view + schema check + copy/export; optional known
 * usage from agent events. Honest failure when finished content is not JSON.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { IconAlertTriangle, IconCheck, IconCopy, IconFileText } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import {
  appendValidationTimeline,
  assessStreamStructured,
  buildStructuredExport,
  formatValidationTimelinePath,
  hasKnownStructuredUsage,
  pickKnownStructuredUsage,
  streamPhaseTone,
  type StreamJsonPhase,
  type StructuredUsageKnown,
  type ValidationTimelineEntry,
} from "@/lib/streamJsonPipe";
import { cn } from "@/lib/utils";

export type StructuredJsonPanelLabels = {
  title: string;
  badge: string;
  copy: string;
  copied: string;
  export: string;
  /** Shown when the reply is not parseable JSON. */
  invalidJson: string;
  /** Shown when reply is empty (finished). */
  empty: string;
  /** Schema checks pass. */
  valid: string;
  /** Generic schema mismatch (e.g. wrong root type). */
  schemaMismatch: string;
  /** Missing required fields; `{fields}` = comma-separated names. */
  missingRequired: string;
  /** While streaming before complete JSON. */
  streaming?: string;
  /** Partial JSON mid-stream. */
  partial?: string;
  /** Seen keys hint; `{keys}` = comma-separated. */
  partialKeys?: string;
  /** Validation path label. */
  timeline?: string;
  /** Usage line; `{detail}` filled by panel. */
  usage?: string;
  /** `{input}` / `{output}` token counts. */
  usageIo?: string;
  /** `{total}` token count. */
  usageTotal?: string;
};

export function StructuredJsonPanel({
  content,
  schemaText,
  labels,
  streaming = false,
  usage = null,
  className,
}: {
  content: string;
  /** Active session JSON Schema text (optional; enables required-field checks). */
  schemaText?: string | null;
  labels: StructuredJsonPanelLabels;
  /** When true, incomplete JSON is progressive (not hard failure). */
  streaming?: boolean;
  /** Optional known usage from agent events (never invent). */
  usage?: StructuredUsageKnown | null;
  className?: string;
}) {
  const assessment = useMemo(
    () => assessStreamStructured(content, schemaText, { streaming }),
    [content, schemaText, streaming],
  );

  const [timeline, setTimeline] = useState<ValidationTimelineEntry[]>([]);
  const contentLen = (content ?? "").length;
  const phaseKey = `${assessment.phase}:${assessment.missingRequired.join(",")}`;

  // Progressive validation timeline for this mount (stream + finished).
  useEffect(() => {
    setTimeline((prev) =>
      appendValidationTimeline(prev, assessment, {
        contentLength: contentLen,
        atMs: Date.now(),
      }),
    );
    // phaseKey captures phase + missing fields; contentLen for length updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- assessment object is recreated; phaseKey is the signal
  }, [phaseKey, contentLen, assessment]);

  // Reset timeline when the turn content is replaced (new message content start).
  const prevStreamingRef = useRef(streaming);
  useEffect(() => {
    if (streaming && !prevStreamingRef.current) {
      setTimeline([]);
    }
    prevStreamingRef.current = streaming;
  }, [streaming]);

  const [copied, setCopied] = useState(false);
  const knownUsage = useMemo(() => pickKnownStructuredUsage(usage), [usage]);
  const statusLabel = statusText(assessment.phase, assessment.missingRequired, labels);
  const exportPayload = buildStructuredExport(assessment.pretty);
  const canExport = !!exportPayload;
  const tone = streamPhaseTone(assessment.phase);
  const timelinePath = formatValidationTimelinePath(timeline);
  const showTimeline = timeline.length > 1 && !!timelinePath;

  const onCopy = async () => {
    const text = exportPayload?.json;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  const onExport = () => {
    if (!exportPayload) return;
    try {
      const blob = new Blob([exportPayload.json], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportPayload.filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch {
      /* ignore */
    }
  };

  const partialKeys = assessment.frame.partialKeys;
  const bodyPreview =
    assessment.pretty ??
    (assessment.phase === "partial" && assessment.frame.raw
      ? assessment.frame.raw
      : null);

  return (
    <div
      className={cn(
        "struct-json chat-md-enter",
        `struct-json--${tone}`,
        streaming && "struct-json--live",
        className,
      )}
      data-testid="struct-json-panel"
      data-status={assessment.phase}
      data-streaming={streaming ? "1" : "0"}
    >
      <div className="struct-json__bar">
        <div className="struct-json__bar-left">
          <span className="struct-json__badge" data-testid="struct-json-badge">
            {labels.badge}
          </span>
          <span className="struct-json__title">{labels.title}</span>
          <span
            className={cn("struct-json__status", `struct-json__status--${tone}`)}
            data-testid="struct-json-status"
          >
            {tone === "ok" ? (
              <IconCheck size={12} />
            ) : tone === "stream" ? (
              <span className="struct-json__pulse" aria-hidden />
            ) : (
              <IconAlertTriangle size={12} />
            )}
            <span>{statusLabel}</span>
          </span>
          {assessment.phase === "partial" &&
          partialKeys.length > 0 &&
          labels.partialKeys ? (
            <span
              className="struct-json__keys"
              data-testid="struct-json-partial-keys"
            >
              {labels.partialKeys.replace("{keys}", partialKeys.join(", "))}
            </span>
          ) : null}
        </div>
        <div className="struct-json__actions">
          {canExport ? (
            <>
              <Tip label={copied ? labels.copied : labels.copy}>
                <button
                  type="button"
                  className={cn("struct-json__btn", copied && "is-copied")}
                  aria-label={labels.copy}
                  onClick={() => void onCopy()}
                >
                  {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  <span>{copied ? labels.copied : labels.copy}</span>
                </button>
              </Tip>
              <Tip label={labels.export}>
                <button
                  type="button"
                  className="struct-json__btn"
                  aria-label={labels.export}
                  onClick={onExport}
                >
                  <IconFileText size={14} />
                  <span>{labels.export}</span>
                </button>
              </Tip>
            </>
          ) : null}
        </div>
      </div>

      {showTimeline ? (
        <div
          className="struct-json__timeline"
          data-testid="struct-json-timeline"
          title={timelinePath}
        >
          {labels.timeline ? (
            <span className="struct-json__timeline-label">{labels.timeline}</span>
          ) : null}
          <ol className="struct-json__timeline-list">
            {timeline.map((e, i) => (
              <li
                key={`${e.phase}-${i}-${e.contentLength}`}
                className={cn(
                  "struct-json__timeline-step",
                  `struct-json__timeline-step--${streamPhaseTone(e.phase)}`,
                  i === timeline.length - 1 && "is-current",
                )}
                data-phase={e.phase}
              >
                {phaseShortLabel(e.phase, labels)}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {bodyPreview ? (
        <pre
          className={cn(
            "struct-json__pre",
            assessment.phase === "partial" && "struct-json__pre--partial",
          )}
        >
          <code>{bodyPreview}</code>
        </pre>
      ) : (
        <div
          className="struct-json__fail"
          role="status"
          data-testid="struct-json-fail"
        >
          {failText(assessment.phase, streaming, labels)}
        </div>
      )}

      {knownUsage && labels.usage && hasKnownStructuredUsage(knownUsage) ? (
        <div className="struct-json__usage" data-testid="struct-json-usage">
          {labels.usage.replace(
            "{detail}",
            formatUsageDetail(knownUsage, labels),
          )}
        </div>
      ) : null}
    </div>
  );
}

function statusText(
  phase: StreamJsonPhase,
  missingRequired: string[],
  labels: StructuredJsonPanelLabels,
): string {
  switch (phase) {
    case "valid":
      return labels.valid;
    case "empty":
      return streamingEmptyLabel(labels);
    case "partial":
      return labels.partial ?? labels.streaming ?? labels.invalidJson;
    case "invalid_json":
      return labels.invalidJson;
    case "schema_mismatch": {
      if (missingRequired.length > 0) {
        return labels.missingRequired.replace(
          "{fields}",
          missingRequired.join(", "),
        );
      }
      return labels.schemaMismatch;
    }
    default:
      return labels.invalidJson;
  }
}

function streamingEmptyLabel(labels: StructuredJsonPanelLabels): string {
  return labels.streaming ?? labels.empty;
}

function failText(
  phase: StreamJsonPhase,
  streaming: boolean,
  labels: StructuredJsonPanelLabels,
): string {
  if (phase === "empty") {
    return streaming ? streamingEmptyLabel(labels) : labels.empty;
  }
  if (phase === "partial") {
    return labels.partial ?? labels.streaming ?? labels.invalidJson;
  }
  return labels.invalidJson;
}

function phaseShortLabel(
  phase: StreamJsonPhase,
  labels: StructuredJsonPanelLabels,
): string {
  switch (phase) {
    case "valid":
      return labels.valid;
    case "empty":
      return labels.streaming ?? labels.empty;
    case "partial":
      return labels.partial ?? labels.streaming ?? "…";
    case "schema_mismatch":
      return labels.schemaMismatch;
    case "invalid_json":
      return labels.invalidJson;
    default:
      return phase;
  }
}

function formatUsageDetail(
  u: NonNullable<ReturnType<typeof pickKnownStructuredUsage>>,
  labels: StructuredJsonPanelLabels,
): string {
  if (
    u.inputTokens != null &&
    u.outputTokens != null &&
    labels.usageIo
  ) {
    return labels.usageIo
      .replace("{input}", String(u.inputTokens))
      .replace("{output}", String(u.outputTokens));
  }
  if (u.totalTokens != null && labels.usageTotal) {
    return labels.usageTotal.replace("{total}", String(u.totalTokens));
  }
  if (u.inputTokens != null && labels.usageTotal) {
    return labels.usageTotal.replace("{total}", String(u.inputTokens));
  }
  if (u.outputTokens != null && labels.usageTotal) {
    return labels.usageTotal.replace("{total}", String(u.outputTokens));
  }
  if (u.totalTokens != null) return String(u.totalTokens);
  return "";
}
