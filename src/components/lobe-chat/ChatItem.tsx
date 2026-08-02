/**
 * Lobe ChatItem layout shell — 1:1 structure of lobe-chat ChatItem.tsx.
 * Memoized so stream-tail updates do not re-render sibling rows.
 */

import { memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const ChatItem = memo(function ChatItem({
  id,
  placement = "left",
  avatar,
  showAvatar = true,
  showTitle,
  title,
  timeLabel,
  loading,
  aboveMessage,
  belowMessage,
  message,
  messageExtra,
  actions,
  children,
  className,
}: {
  id?: string;
  placement?: "left" | "right";
  avatar?: { title?: string; avatar?: string; text?: string };
  showAvatar?: boolean;
  showTitle?: boolean;
  title?: string;
  timeLabel?: string;
  loading?: boolean;
  aboveMessage?: ReactNode;
  belowMessage?: ReactNode;
  message?: ReactNode;
  messageExtra?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const isUser = placement === "right";
  const initial =
    avatar?.text ||
    (avatar?.title ? avatar.title.slice(0, 1).toUpperCase() : isUser ? "U" : "G");

  return (
    <div
      className={cn(
        "lobe-chat-item",
        isUser ? "lobe-chat-item--user" : "lobe-chat-item--assistant",
        className,
      )}
      data-message-id={id}
    >
      {(showAvatar || showTitle || timeLabel) && (
        <div className="lobe-chat-item__header">
          {showAvatar ? (
            <div className="lobe-chat-item__avatar" aria-hidden>
              {avatar?.avatar ? (
                <img src={avatar.avatar} alt="" />
              ) : (
                initial
              )}
              {loading ? <span className="lobe-chat-item__avatar-loading" /> : null}
            </div>
          ) : null}
          {showTitle && title ? (
            <span className="lobe-chat-item__title">{title}</span>
          ) : null}
          {timeLabel ? (
            <time className="lobe-chat-item__time">{timeLabel}</time>
          ) : null}
        </div>
      )}

      <div className="lobe-chat-item__body">
        {aboveMessage}
        {message}
        {children}
        {messageExtra}
        {belowMessage}
      </div>

      {actions ? <div className="lobe-chat-item__actions">{actions}</div> : null}
    </div>
  );
});
