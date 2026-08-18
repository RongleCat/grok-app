/**
 * Attached-chat chip: composer bar + user-bubble token.
 * Click opens the source chat when `onOpen` is set.
 */

import { IconChat, IconClose, IconRefresh } from "@/components/icons";
import { cn } from "@/lib/utils";

export function ChatRefChip({
  title,
  size = "md",
  className,
  stale = false,
  onOpen,
  onRemove,
  onRefresh,
  removeLabel,
  refreshLabel,
  staleLabel,
}: {
  title: string;
  size?: "sm" | "md";
  className?: string;
  stale?: boolean;
  onOpen?: () => void;
  onRemove?: () => void;
  onRefresh?: () => void;
  removeLabel?: string;
  refreshLabel?: string;
  staleLabel?: string;
}) {
  const iconSize = size === "sm" ? 12 : 14;
  const label = title.trim() || "…";
  const clickable = typeof onOpen === "function";
  const Tag = clickable ? "button" : "span";
  const tip = stale && staleLabel ? `${label} · ${staleLabel}` : label;
  return (
    <span
      className={cn(
        "skill-chip skill-chip--chat",
        size === "sm" && "skill-chip--sm",
        stale && "is-stale",
        className,
      )}
      data-chat-chip=""
    >
      <Tag
        type={clickable ? "button" : undefined}
        className={cn(
          "skill-chip__chat-main",
          clickable && "skill-chip__chat-main--btn",
        )}
        onClick={clickable ? onOpen : undefined}
        title={tip}
      >
        <IconChat size={iconSize} className="skill-chip__icon" />
        <span className="skill-chip__name">{label}</span>
      </Tag>
      {stale && onRefresh ? (
        <button
          type="button"
          className="skill-chip__refresh"
          aria-label={refreshLabel || label}
          title={refreshLabel}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRefresh();
          }}
        >
          <IconRefresh size={11} />
        </button>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          className="skill-chip__remove"
          aria-label={removeLabel || label}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
        >
          <IconClose size={11} />
        </button>
      ) : null}
    </span>
  );
}
