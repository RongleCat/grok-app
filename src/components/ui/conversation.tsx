/**
 * Conversation surface — full-bleed scroll (far-right OverlayScroll thumb)
 * with stick-to-bottom for streaming. Composer floats over this surface
 * in App (messages scroll underneath).
 */

import * as React from "react";
import {
  StickToBottom,
  useStickToBottomContext,
} from "use-stick-to-bottom";
import { cn } from "@/lib/utils";
import { IconChevronDown } from "@/components/icons";
import { OverlayScroll } from "@/components/OverlayScroll";
import { Tip } from "@/components/ui/tooltip";

export type ConversationProps = React.ComponentProps<typeof StickToBottom>;

export function Conversation({ className, ...props }: ConversationProps) {
  return (
    <StickToBottom
      className={cn(
        "chat-surface relative flex min-h-0 flex-1 flex-col overflow-hidden",
        className,
      )}
      initial="smooth"
      resize="smooth"
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      aria-atomic="false"
      {...props}
    />
  );
}

/**
 * Full-width scroll viewport (scrollbar on the main pane edge) +
 * centered message column. Bottom padding comes from --composer-float-pad
 * so the last messages clear the floating composer.
 */
export function ConversationContent({
  className,
  children,
  viewportClassName,
}: {
  className?: string;
  children: React.ReactNode;
  viewportClassName?: string;
}) {
  const { scrollRef, contentRef } = useStickToBottomContext();

  return (
    <OverlayScroll
      className={cn("messages min-h-0 w-full flex-1", className)}
      viewportClassName={cn("messages__viewport", viewportClassName)}
      viewportRef={scrollRef}
    >
      <div
        ref={contentRef}
        data-slot="conversation-content"
        className="messages__col mx-auto flex w-full max-w-[42rem] flex-col gap-6 px-3 pt-5 sm:px-4"
      >
        {children}
      </div>
    </OverlayScroll>
  );
}

export function ConversationScrollButton({
  className,
  label = "Scroll to bottom",
}: {
  className?: string;
  label?: string;
}) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <Tip label={label}>
      <button
        type="button"
        className={cn(
          "absolute left-1/2 z-10 flex size-8 -translate-x-1/2 items-center justify-center",
          "rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]",
          "text-[var(--text-secondary)] shadow-[var(--shadow-pop)]",
          "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
          "transition-colors",
          // Sit just above the floating composer
          "bottom-[calc(var(--composer-float-pad, 168px)-10px)]",
          className,
        )}
        aria-label={label}
        onClick={() => void scrollToBottom()}
      >
        <IconChevronDown size={16} />
      </button>
    </Tip>
  );
}

export function ConversationEmptyState({
  title,
  description,
  icon,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[40vh] w-full flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="text-[var(--text-tertiary)] opacity-80">{icon}</div>
      ) : null}
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          {title}
        </h3>
        {description ? (
          <p className="max-w-sm text-sm text-[var(--text-tertiary)]">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
