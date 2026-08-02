/**
 * Bottom chrome under the virtualized message list: standalone live tool
 * (before any assistant bubble) + quiet thinking.
 * Isolated so list row memo islands are not invalidated by sticky-only updates
 * when structured carefully from the parent.
 */

import { memo } from "react";
import type { Locale } from "@/i18n";
import type { ChatMessage } from "@/lib/session";
import { IconBulb } from "@/components/icons";
import { LiveToolText } from "./AgentActivity";

export type ConversationStickyTailProps = {
  locale: Locale;
  /** Precomputed: show live tool when no active assistant row owns it. */
  showStandaloneLiveTool: boolean;
  liveTool: ChatMessage | null;
  showQuietThinking: boolean;
  thinkingLabel: string;
};

function liveToolEqual(
  a: ChatMessage | null,
  b: ChatMessage | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.toolCallId === b.toolCallId &&
    a.content === b.content &&
    a.toolKind === b.toolKind &&
    a.toolDetail === b.toolDetail &&
    a.toolPath === b.toolPath &&
    a.toolStatus === b.toolStatus
  );
}

function stickyTailPropsEqual(
  prev: ConversationStickyTailProps,
  next: ConversationStickyTailProps,
): boolean {
  return (
    prev.locale === next.locale &&
    prev.showStandaloneLiveTool === next.showStandaloneLiveTool &&
    prev.showQuietThinking === next.showQuietThinking &&
    prev.thinkingLabel === next.thinkingLabel &&
    liveToolEqual(prev.liveTool, next.liveTool)
  );
}

function ConversationStickyTailInner({
  locale,
  showStandaloneLiveTool,
  liveTool,
  showQuietThinking,
  thinkingLabel,
}: ConversationStickyTailProps) {
  if (!showStandaloneLiveTool && !showQuietThinking) return null;

  return (
    <>
      {showStandaloneLiveTool && liveTool ? (
        <LiveToolText message={liveTool} locale={locale} />
      ) : null}

      {showQuietThinking ? (
        <div
          className="grok-act__step is-running is-last"
          role="status"
          data-testid="quiet-thinking"
        >
          <div className="grok-act__icon-col" aria-hidden>
            <span className="grok-act__icon">
              <IconBulb size={16} stroke={1.5} />
            </span>
          </div>
          <span className="grok-act__label grok-act__label--live">
            {thinkingLabel}
          </span>
        </div>
      ) : null}
    </>
  );
}

export const ConversationStickyTail = memo(
  ConversationStickyTailInner,
  stickyTailPropsEqual,
);
