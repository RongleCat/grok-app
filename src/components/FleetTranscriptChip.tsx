/**
 * One-line parent transcript stand-in for a fleet tool.
 * Click focuses the matching row in the background-tasks drawer.
 */
import { memo, useMemo } from "react";
import { createT, type Locale } from "@/i18n";
import { focusFleetRow } from "@/lib/backgroundTasksStore";

export const FleetTranscriptChip = memo(function FleetTranscriptChip({
  sessionId,
  toolCallId,
  label,
  running,
  locale,
}: {
  sessionId: string;
  toolCallId: string;
  label: string;
  running: boolean;
  locale?: Locale;
}) {
  const tr = useMemo(() => createT(locale ?? "en"), [locale]);
  return (
    <button
      type="button"
      className={
        "grok-act__step grok-act__step-btn grok-act__step-btn--grow fleet-chip" +
        (running ? " is-running" : "")
      }
      data-testid="fleet-transcript-chip"
      data-tool-id={toolCallId}
      title={tr("fleet.chipOpen")}
      onClick={() => focusFleetRow(sessionId, toolCallId)}
    >
      <span className="grok-act__label">{label}</span>
      <span className="fleet-chip__state">
        {running ? tr("fleet.chipRunning") : tr("fleet.chipFinished")}
      </span>
    </button>
  );
});
