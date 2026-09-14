/**
 * Shared expanded body for a tool step — one implementation for the bare
 * TimelineToolRow and the in-phase GrokActivityStepRow so live and history
 * look identical.
 *
 * Layout (terminal transcript order):
 *   [fail hint]
 *   $ command          ← shell tools, even when stdout is still empty
 *   <tool output>      ← ACP content[]; scrolls internally, elided in the middle
 *   <legacy detail>    ← only when no real output was captured
 *
 * Copy uses the full captured stdout, not the elided DOM view.
 */

import { useMemo } from "react";
import { CopyIconButton } from "@/components/CopyIconButton";
import { createT, type Locale } from "@/i18n";
import type { toolExpandBody } from "@/lib/toolDisplay";

export type ToolExpandBodyModel = ReturnType<typeof toolExpandBody>;

export function ToolExpandBody({
  body,
  className = "lobe-timeline-tool__body",
  locale = "en",
}: {
  body: ToolExpandBodyModel;
  className?: string;
  locale?: Locale;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const { failHint, failHintShort, detailTail, outputBody, outputFull, command } =
    body;
  const showDetail =
    !!detailTail && detailTail !== failHint && detailTail !== failHintShort;
  const copyOutput = outputFull || (showDetail ? detailTail : "");
  const copiedLabel = tr("message.copied");
  return (
    <div className={className}>
      {failHintShort ? (
        <div className="lobe-timeline-tool__fail-hint" title={failHint}>
          {failHintShort}
        </div>
      ) : null}
      {command ? (
        <div className="lobe-timeline-tool__pane">
          <pre className="lobe-timeline-tool__cmd">
            <span className="lobe-timeline-tool__cmd-sigil" aria-hidden>
              ${" "}
            </span>
            {command}
          </pre>
          <CopyIconButton
            text={command}
            copyLabel={tr("chat.tool.copyCommand")}
            copiedLabel={copiedLabel}
            className="lobe-timeline-tool__copy"
            testId="tool-copy-command"
          />
        </div>
      ) : null}
      {outputBody ? (
        <div className="lobe-timeline-tool__pane">
          <pre className="lobe-timeline-tool__output" data-testid="tool-output">
            {outputBody}
          </pre>
          <CopyIconButton
            text={copyOutput}
            copyLabel={tr("chat.tool.copyOutput")}
            copiedLabel={copiedLabel}
            className="lobe-timeline-tool__copy"
            testId="tool-copy-output"
          />
        </div>
      ) : null}
      {showDetail ? (
        <div className="lobe-timeline-tool__pane">
          <pre className="lobe-timeline-tool__detail">{detailTail}</pre>
          <CopyIconButton
            text={detailTail}
            copyLabel={tr("chat.tool.copyOutput")}
            copiedLabel={copiedLabel}
            className="lobe-timeline-tool__copy"
            testId="tool-copy-detail"
          />
        </div>
      ) : null}
    </div>
  );
}
