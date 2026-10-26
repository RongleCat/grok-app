/**
 * One-line parent transcript stand-in for a fleet tool.
 * Click focuses the matching row in the background-tasks drawer.
 */
import { memo, useMemo, type ReactNode } from "react";
import { createT, type Locale } from "@/i18n";
import { fleetChipKind } from "@/lib/backgroundFleet";
import { focusFleetRow } from "@/lib/backgroundTasksStore";
import type { FleetToolHint } from "@/lib/session";

/** Parent-transcript stand-in, or null when this tool is ordinary chat work. */
export function fleetTranscriptChip(input: {
  sessionId?: string | null;
  name?: string;
  title?: string;
  hint?: FleetToolHint;
  toolCallId: string;
  label: string | (() => string);
  running: boolean;
  locale?: Locale;
}): ReactNode | null {
  if (!input.sessionId) return null;
  if (
    !fleetChipKind({
      name: input.name,
      title: input.title,
      hint: input.hint,
    })
  ) {
    return null;
  }
  const label = typeof input.label === "function" ? input.label() : input.label;
  return (
    <FleetTranscriptChip
      sessionId={input.sessionId}
      toolCallId={input.toolCallId}
      label={label}
      running={input.running}
      locale={input.locale}
    />
  );
}

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
