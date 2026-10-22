import type { MessageKey } from "@/i18n";
import { createT } from "@/i18n";
import type { GrokActivityStep } from "@/lib/grokActivitySteps";
import { resolveToolPrimaryLabel } from "@/lib/toolDisplay";

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

export function StepMainText({
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

