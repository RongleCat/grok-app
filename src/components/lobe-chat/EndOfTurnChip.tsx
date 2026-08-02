/**
 * Unified end-of-turn marker (stop / stall / error / permission).
 */

import { memo, useMemo } from "react";
import type { Locale } from "@/i18n";
import { createT, type MessageKey } from "@/i18n";
import {
  mapEndOfTurnReason,
  parseEndOfTurnContent,
  type EndOfTurnReason,
} from "@/lib/endOfTurn";
import { IconStop } from "@/components/icons";
import type { ChatMessage } from "@/lib/session";

export const EndOfTurnChip = memo(function EndOfTurnChip({
  message,
  locale,
  reasonOverride,
}: {
  message?: ChatMessage;
  locale: Locale;
  reasonOverride?: EndOfTurnReason | string | null;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const raw =
    reasonOverride ||
    message?.toolStatus ||
    parseEndOfTurnContent(message?.content) ||
    "cancelled";
  const model = mapEndOfTurnReason(String(raw));
  const label = tr(model.messageKey as MessageKey);

  return (
    <div
      className={`lobe-end-turn lobe-end-turn--${model.tone}`}
      role="status"
      data-reason={model.reason}
      data-testid="end-of-turn"
    >
      <span className="lobe-end-turn__mark" aria-hidden>
        <IconStop size={13} />
      </span>
      <span className="lobe-end-turn__title">{label}</span>
    </div>
  );
});
