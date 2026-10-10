/**
 * Live subagent runs in the Tasks panel.
 *
 * Kept out of `AgentTasksPanel.tsx`, which sits at the repository's 1000-line
 * file budget: the rows and their counters are self-contained, so the panel only
 * asks for the runs and renders this section.
 */

import { useState } from "react";
import type { Locale, MessageKey } from "@/i18n";
import {
  formatSubagentCount,
  formatSubagentDuration,
  formatSubagentTokens,
  subagentContextOccupancy,
  subagentDisplayLabel,
  subagentDisplayStatus,
  type SubagentDisplayStatus,
  type SubagentRun,
} from "@/lib/session/subagents";
import { IconChevronDown, IconChevronRight } from "@/components/icons";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

function subagentStatusLabelKey(status: SubagentDisplayStatus): MessageKey {
  switch (status) {
    case "completed":
      return "tasks.subagentCompleted";
    case "failed":
      return "tasks.subagentFailed";
    case "cancelled":
      return "tasks.subagentCancelled";
    case "finished":
      return "tasks.subagentFinished";
    default:
      return "tasks.subagentRunning";
  }
}

/**
 * One subagent telemetry row. Shows description / type / status and the
 * progress counters the CLI reported; a finished run with output expands to
 * reveal it. Never draws a counter the payload did not carry.
 */
function SubagentRow({
  run,
  t,
  locale,
}: {
  run: SubagentRun;
  t: TFn;
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  const status = subagentDisplayStatus(run);
  const label = subagentDisplayLabel(run);
  const hasOutput = run.finished && !!run.output;
  const hasMeta =
    subagentContextOccupancy(run) !== null ||
    run.tokensUsed !== undefined ||
    run.turnCount !== undefined ||
    run.toolCallCount !== undefined ||
    run.durationMs !== undefined;

  return (
    <li
      className={
        "agent-tasks__row" + (status === "running" ? " is-running" : "")
      }
    >
      <div className="agent-tasks__row-line">
        <div className="agent-tasks__row-main agent-tasks__row-main--flat">
          {hasOutput ? (
            <button
              type="button"
              className="agent-tasks__row-toggle"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? t("tasks.collapse") : t("tasks.expand")}
            >
              <span
                className={`agent-tasks__dot agent-tasks__dot--${status}`}
                aria-hidden
              />
              <span className="agent-tasks__name" title={label}>
                {label}
              </span>
            </button>
          ) : (
            // No answer to reveal — keep it a static row rather than a toggle
            // that expands to nothing.
            <span className="agent-tasks__row-toggle is-static">
              <span
                className={`agent-tasks__dot agent-tasks__dot--${status}`}
                aria-hidden
              />
              <span className="agent-tasks__name" title={label}>
                {label}
              </span>
            </span>
          )}
          {run.subagentType ? (
            <span className="agent-tasks__status">{run.subagentType}</span>
          ) : null}
          <span className="agent-tasks__status">
            {t(subagentStatusLabelKey(status))}
          </span>
          {hasOutput ? (
            <span className="agent-tasks__row-chev" aria-hidden>
              {open ? (
                <IconChevronDown size={14} />
              ) : (
                <IconChevronRight size={14} />
              )}
            </span>
          ) : null}
        </div>
      </div>
      {hasMeta ? (
        <p className="agent-tasks__subagent-meta">
          {t("tasks.subagentMeta", {
            turns: formatSubagentCount(run.turnCount),
            tools: formatSubagentCount(run.toolCallCount),
            tokens: formatSubagentTokens(run, locale),
            duration: formatSubagentDuration(run.durationMs),
          })}
        </p>
      ) : null}
      {open && hasOutput ? (
        <div className="agent-tasks__detail">
          <div className="agent-tasks__meta">
            <span className="agent-tasks__meta-k">
              {t("tasks.subagentOutput")}
            </span>
          </div>
          <pre className="agent-tasks__subagent-output">{run.output}</pre>
        </div>
      ) : null}
    </li>
  );
}

/** The panel's subagent section; renders nothing when there are no runs. */
export function SubagentSection({
  runs,
  t,
  locale,
}: {
  runs: readonly SubagentRun[];
  t: TFn;
  locale: Locale;
}) {
  if (runs.length === 0) return null;
  return (
    <div className="agent-tasks__section">
      <h3 className="agent-tasks__section-title">
        {t("tasks.subagentsTitle")}
      </h3>
      <ul className="agent-tasks__list">
        {runs.map((run) => (
          <SubagentRow key={run.subagentId} run={run} t={t} locale={locale} />
        ))}
      </ul>
    </div>
  );
}
