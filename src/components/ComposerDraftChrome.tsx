/**
 * Small draft-subscribing islands for composer chrome (stats, clear, send).
 * Keep these tiny so keystrokes only re-render the islands, not App.
 */

import { memo, useMemo, type ReactNode } from "react";
import {
  IconClose,
  IconQueue,
  IconSend,
  IconStop,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import {
  useComposerDraft,
  useComposerDraftMeta,
} from "@/hooks/useComposerDraft";
import { computeDraftStats } from "@/lib/draftStats";
import type { MessageKey } from "@/i18n";
import type { SessionState } from "@/lib/session";

type Tr = (key: MessageKey, vars?: Record<string, string>) => string;

/** Muted char/word counter; hidden when draft is empty / whitespace-only. */
export const ComposerDraftStats = memo(function ComposerDraftStats({
  show,
  tr,
}: {
  show: boolean;
  tr: Tr;
}) {
  const draft = useComposerDraft();
  const stats = useMemo(() => computeDraftStats(draft), [draft]);
  if (!show || stats.empty) return null;
  return (
    <span
      className="composer__draft-stats"
      aria-label={tr("composer.draftStatsAria", {
        words: String(stats.words),
        chars: String(stats.chars),
      })}
    >
      {tr("composer.draftStats", {
        words: String(stats.words),
        chars: String(stats.chars),
      })}
    </span>
  );
});

/** Clear button; hidden when draft empty and no attachments. */
export const ComposerClearDraftButton = memo(function ComposerClearDraftButton({
  attachmentsLength,
  onClear,
  label,
}: {
  attachmentsLength: number;
  onClear: () => void;
  label: string;
}) {
  const { empty } = useComposerDraftMeta();
  if (empty && attachmentsLength === 0) return null;
  return (
    <Tip label={label}>
      <button
        type="button"
        className="icon-btn composer__clear-draft"
        aria-label={label}
        onClick={onClear}
      >
        <IconClose size={14} />
      </button>
    </Tip>
  );
});

/**
 * Stop / queue / send cluster: draft empty only affects queue visibility and
 * send disabled; other busy/session flags come from App props.
 */
export const ComposerSendCluster = memo(function ComposerSendCluster({
  attachmentsLength,
  effectiveCanStop,
  connecting,
  sessionState,
  effectiveCanSend,
  shouldEnqueue,
  canShowQueueButton,
  onSend,
  onStop,
  tr,
}: {
  attachmentsLength: number;
  effectiveCanStop: boolean;
  connecting: boolean;
  sessionState: SessionState;
  effectiveCanSend: boolean;
  shouldEnqueue: boolean;
  canShowQueueButton: (
    state: SessionState,
    connecting: boolean,
    hasBody: boolean,
  ) => boolean;
  onSend: () => void;
  onStop: () => void;
  tr: Tr;
}) {
  const { empty } = useComposerDraftMeta();
  const hasBody = !empty || attachmentsLength > 0;

  if (effectiveCanStop) {
    return (
      <>
        {canShowQueueButton(sessionState, connecting, hasBody) && (
          <Tip label={tr("composer.queue")}>
            <button
              type="button"
              className="icon-btn icon-btn--primary"
              onClick={onSend}
              aria-label={tr("composer.queue")}
            >
              <IconQueue size={16} />
            </button>
          </Tip>
        )}
        <Tip label={tr("composer.stop")}>
          <button
            type="button"
            className="icon-btn icon-btn--danger"
            onClick={onStop}
            aria-label={tr("composer.stop")}
          >
            <IconStop size={14} />
          </button>
        </Tip>
      </>
    );
  }

  return (
    <Tip label={tr("composer.send")}>
      <button
        type="button"
        className="icon-btn icon-btn--primary"
        disabled={
          (!effectiveCanSend && !shouldEnqueue) ||
          !hasBody ||
          sessionState === "awaiting_permission"
        }
        onClick={onSend}
        aria-label={tr("composer.send")}
      >
        <IconSend size={16} />
      </button>
    </Tip>
  );
});

/** Render-prop gate when a larger subtree needs draft empty/hasBody. */
export function ComposerDraftBodyGate({
  attachmentsLength,
  children,
}: {
  attachmentsLength: number;
  children: (ctx: { empty: boolean; hasBody: boolean }) => ReactNode;
}) {
  const { empty } = useComposerDraftMeta();
  return <>{children({ empty, hasBody: !empty || attachmentsLength > 0 })}</>;
}
