import { IconClock, IconClose } from "@/components/icons";
import type { Vars } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { queuePreviewText, type QueuedSend } from "@/lib/sendQueue";

export interface ComposerQueueProps {
  items: QueuedSend[];
  flushHold: boolean;
  guidingItemId: string | null;
  canGuide: boolean;
  tr: (key: MessageKey, vars?: Vars) => string;
  onClear: () => void;
  onRemove: (id: string) => void;
  onGuide: (item: QueuedSend) => void | Promise<void>;
  onRetry: () => void;
}

export function ComposerQueue({
  items,
  flushHold,
  guidingItemId,
  canGuide,
  tr,
  onClear,
  onRemove,
  onGuide,
  onRetry,
}: ComposerQueueProps) {
  if (!items.length) return null;

  const previewLabels = {
    filesCount: (n: number) =>
      tr("composer.queueFilesCount", { n: String(n) }),
    empty: tr("composer.queueEmptyPreview"),
  };

  return (
    <div
      className="composer__queue"
      data-testid="composer-queue"
      aria-label={tr("composer.queueCount", { n: String(items.length) })}
    >
      <div className="composer__queue-head">
        <IconClock size={14} aria-hidden />
        <span className="composer__queue-title">
          {tr("composer.queueCount", { n: String(items.length) })}
        </span>
        <button
          type="button"
          className="composer__queue-clear"
          onClick={onClear}
        >
          {tr("composer.queueClear")}
        </button>
      </div>
      {flushHold ? (
        <div className="composer__queue-hold" role="status">
          <span className="composer__queue-hold-text">
            {tr("composer.queueHold")}
          </span>
          <button
            type="button"
            className="composer__queue-hold-retry"
            onClick={onRetry}
          >
            {tr("composer.queueHoldRetry")}
          </button>
        </div>
      ) : null}
      <ul className="composer__queue-list">
        {items.map((item, index) => {
          const guiding = guidingItemId === item.id;
          const preview = queuePreviewText(
            item.storedDisplay,
            item.attachments,
            72,
            previewLabels,
          );
          return (
            <li key={item.id} className="composer__queue-item">
              <span className="composer__queue-idx" aria-hidden>
                {index + 1}
              </span>
              <span
                className="composer__queue-text"
                title={queuePreviewText(
                  item.storedDisplay,
                  item.attachments,
                  200,
                  previewLabels,
                )}
              >
                {preview}
              </span>
              <button
                type="button"
                className="composer__queue-guide"
                data-testid="queue-guide"
                aria-label={
                  guiding || guidingItemId !== null
                    ? tr("composer.queueGuiding")
                    : canGuide
                      ? tr("composer.queueGuide")
                      : tr("composer.queueGuideUnavailable")
                }
                title={
                  guiding || guidingItemId !== null
                    ? tr("composer.queueGuiding")
                    : canGuide
                      ? tr("composer.queueGuide")
                      : tr("composer.queueGuideUnavailable")
                }
                disabled={!canGuide || guidingItemId !== null}
                onClick={() =>
                  void Promise.resolve(onGuide(item)).catch((e) => {
                    console.error("[ComposerQueue] onGuide failed", e);
                  })
                }
              >
                {guiding
                  ? tr("composer.queueGuiding")
                  : tr("composer.queueGuide")}
              </button>
              <button
                type="button"
                className="composer__queue-remove"
                aria-label={tr("composer.queueRemove")}
                title={tr("composer.queueRemove")}
                disabled={guiding}
                onClick={() => onRemove(item.id)}
              >
                <IconClose size={12} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
