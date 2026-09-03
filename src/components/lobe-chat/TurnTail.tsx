/**
 * Turn tail — DSH-inspired `turn-tail` footer for finished assistant turns.
 *
 * Shows `Worked for Xs · Ran N tools` (existing `chat.*` keys only, no new
 * catalog entries). Pure summary line; the full Worked-for rail stays as the
 * expandable activity source. Renders nothing while streaming or for turns
 * without real work.
 */

import { memo, useMemo } from "react";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import { formatWorkDuration } from "@/lib/formatWorkDuration";
import type { TimelineUnit } from "@/lib/timelinePhases";
import {
  buildTurnProcessSummary,
  shouldCompactTurnProcess,
} from "@/lib/turnProcess";

export const TurnTail = memo(function TurnTail({
  units,
  locale,
  streaming,
  durationSec,
}: {
  units: TimelineUnit[];
  locale: Locale;
  streaming?: boolean;
  /** History duration seconds (phase rail already computes this). */
  durationSec?: number | null;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const summary = useMemo(() => buildTurnProcessSummary(units), [units]);
  if (streaming) return null;
  if (!shouldCompactTurnProcess(summary)) return null;
  const parts: string[] = [];
  if (durationSec != null && Number.isFinite(durationSec) && durationSec > 0) {
    parts.push(
      tr("chat.workedFor", {
        duration: formatWorkDuration(durationSec, locale),
      }),
    );
  }
  if (summary.toolCount > 0) {
    parts.push(
      tr("chat.ranTools", {
        n: summary.toolCount,
      }),
    );
  }
  if (!parts.length) return null;
  return (
    <div
      className="lobe-chat-reply-length"
      data-testid="turn-tail"
      aria-label={parts.join(" · ")}
    >
      {parts.join(" · ")}
    </div>
  );
});
