/**
 * Message action-row time label.
 * Owns its own 60s tick subscription in relative mode so ConversationThread
 * stream re-renders do not force every row through a shared relativeTick state.
 */

import { memo, useSyncExternalStore } from "react";
import { formatMessageTime, formatRelativeTime } from "@/lib/accountUi";
import type { Locale } from "@/i18n";
import {
  getRelativeTimeTick,
  getRelativeTimeTickServerSnapshot,
  subscribeRelativeTimeTick,
  subscribeRelativeTimeTickNoop,
} from "@/lib/relativeTimeTickStore";

export type ChatMessageTimeFormat = "absolute" | "relative" | "off";

export type ChatMessageTimeProps = {
  createdAt: string | null | undefined;
  locale: Locale;
  /** `off` hides the label (timestamps disabled). */
  format: ChatMessageTimeFormat;
  className?: string;
};

function ChatMessageTimeInner({
  createdAt,
  locale,
  format,
  className = "lobe-chat-action-time",
}: ChatMessageTimeProps) {
  const needsTick = format === "relative" && !!createdAt;
  // Always call the hook; only subscribe when relative labels are shown.
  useSyncExternalStore(
    needsTick ? subscribeRelativeTimeTick : subscribeRelativeTimeTickNoop,
    getRelativeTimeTick,
    getRelativeTimeTickServerSnapshot,
  );

  if (format === "off" || !createdAt) return null;

  const label =
    format === "relative"
      ? formatRelativeTime(createdAt, locale)
      : formatMessageTime(createdAt, locale);

  if (!label || label === "—") return null;

  const absolute =
    format === "relative" ? formatMessageTime(createdAt, locale) : "";

  return (
    <span className={className} title={absolute || undefined}>
      {label}
    </span>
  );
}

export const ChatMessageTime = memo(ChatMessageTimeInner);
