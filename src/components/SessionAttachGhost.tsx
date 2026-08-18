/**
 * Follow-cursor chip while attaching a sidebar chat.
 */

import { createPortal } from "react-dom";
import { ChatRefChip } from "@/components/ChatRefChip";

export function SessionAttachGhost({
  x,
  y,
  title,
  ready,
}: {
  x: number;
  y: number;
  title: string;
  ready: boolean;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={"session-attach-ghost" + (ready ? " is-ready" : "")}
      style={{ left: x, top: y }}
      aria-hidden
    >
      <ChatRefChip title={title} size="sm" />
    </div>,
    document.body,
  );
}
