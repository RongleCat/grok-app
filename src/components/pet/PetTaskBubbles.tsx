/**
 * Codex-style task chips stacked above the living mark.
 * Each chip is one session's latest stage reply. Click opens that chat.
 */
import type { Ref } from "react";
import { IconAlertTriangle, IconCheck } from "@/components/icons";
import { createT } from "@/i18n";
import type { PetBubbleShape, PetBubbleStyle, PetTask } from "@/lib/pet";
import {
  PET_BUBBLE_SHADOW_PAD,
  PET_BUBBLE_WIDTH,
  petBubbleViewportHeight,
} from "@/lib/pet";

export function PetTaskBubbles({
  tasks,
  t,
  onOpen,
  listRef,
  bubbleShape = "round",
  bubbleStyle = "ink",
  progressBar = false,
}: {
  tasks: readonly PetTask[];
  t: ReturnType<typeof createT>;
  onOpen: (sessionId: string) => void;
  listRef?: Ref<HTMLDivElement>;
  bubbleShape?: PetBubbleShape;
  bubbleStyle?: PetBubbleStyle;
  progressBar?: boolean;
}) {
  if (tasks.length === 0) return null;
  return (
    <div
      ref={listRef}
      className="pet-bubbles"
      role="list"
      aria-label={t("pet.bubble.list")}
      style={{
        width: PET_BUBBLE_WIDTH + PET_BUBBLE_SHADOW_PAD * 2,
        maxHeight: petBubbleViewportHeight(),
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      {tasks.map((task) => {
        const title = task.title?.trim() || t("pet.bubble.untitled");
        const snippet = task.snippet?.trim() || "";
        const headline = snippet || title;
        const phaseLabel =
          task.phase === "done"
            ? t("pet.bubble.progressDone")
            : t("pet.bubble.progressActive");
        const showSub = Boolean(snippet && title && title !== snippet);
        const pct = Math.round(Math.max(0, Math.min(1, task.progress)) * 100);
        return (
          <button
            key={task.sessionId}
            type="button"
            role="listitem"
            className={
              "pet-bubble" +
              ` pet-bubble--${bubbleShape}` +
              ` pet-bubble--${bubbleStyle}` +
              (task.phase === "done" ? " is-done" : " is-active") +
              (task.kind === "error" ? " is-error" : "") +
              (task.kind === "needs_you" ? " is-wait" : "") +
              (progressBar ? " has-track" : "")
            }
            aria-label={t("pet.bubble.open", { title: headline })}
            title={`${phaseLabel} · ${headline}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpen(task.sessionId);
            }}
          >
            <span className="pet-bubble__row">
              <span className="pet-bubble__glyph" aria-hidden>
                {task.kind === "error" ? (
                  <IconAlertTriangle size={13} stroke={2.2} />
                ) : task.phase === "done" ? (
                  <IconCheck size={13} stroke={2.4} />
                ) : (
                  <span className="pet-bubble__spin" />
                )}
              </span>
              <span className="pet-bubble__text">
                <span
                  className={
                    "pet-bubble__title" + (showSub ? " is-2" : " is-3")
                  }
                >
                  {headline}
                </span>
                {showSub ? (
                  <span className="pet-bubble__sub">{title}</span>
                ) : null}
              </span>
            </span>
            {progressBar ? (
              <span className="pet-bubble__track" aria-hidden>
                <span
                  className="pet-bubble__fill"
                  style={
                    task.phase === "active"
                      ? undefined
                      : { width: `${pct}%` }
                  }
                />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
