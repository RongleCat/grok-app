/**
 * User-message attachment strip: 36px cards, horizontal first (≤ ~70% chat
 * width), collapse past 3 into a +N chip; click expands to multi-row wrap.
 */

import { useMemo, useState } from "react";
import type { Attachment } from "@/lib/attachments";
import { isImagePath } from "@/lib/attachments";
import {
  formatUserAttachOverflowLabel,
  partitionUserAttachments,
} from "@/lib/userAttachments";
import {
  AttachmentCard,
  type AttachmentCardLabels,
} from "@/components/AttachmentCard";

export function UserAttachments({
  attachments,
  labels,
  onAddToComposer,
  moreLabel,
  lessLabel,
}: {
  attachments: Attachment[];
  labels: AttachmentCardLabels;
  onAddToComposer?: (a: Attachment) => void;
  /** Accessible name for the +N chip (e.g. "Show 2 more"). */
  moreLabel: (n: number) => string;
  /** Accessible name for collapse control when expanded. */
  lessLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { visible, overflow } = useMemo(
    () => partitionUserAttachments(attachments, expanded),
    [attachments, expanded],
  );

  const galleryPaths = useMemo(
    () =>
      attachments
        .filter((x) => !x.isDir && (x.kind === "image" || isImagePath(x.path)))
        .map((x) => x.path)
        .filter(Boolean),
    [attachments],
  );

  if (!attachments.length) return null;

  const canCollapse = expanded && attachments.length > 3;

  return (
    <div
      className={
        "lobe-chat-atts lobe-chat-atts--user" +
        (expanded ? " lobe-chat-atts--user-expanded" : "")
      }
      data-expanded={expanded ? "1" : "0"}
    >
      {visible.map((a) => (
        <AttachmentCard
          key={a.id || a.path}
          attachment={a}
          variant="card"
          labels={labels}
          galleryPaths={galleryPaths}
          onAddToComposer={onAddToComposer}
        />
      ))}
      {overflow > 0 ? (
        <button
          type="button"
          className="att-card att-card--more"
          onClick={() => setExpanded(true)}
          aria-label={moreLabel(overflow)}
          title={moreLabel(overflow)}
        >
          <span className="att-card__more-label" aria-hidden>
            {formatUserAttachOverflowLabel(overflow)}
          </span>
        </button>
      ) : null}
      {canCollapse ? (
        <button
          type="button"
          className="att-card att-card--more att-card--less"
          onClick={() => setExpanded(false)}
          aria-label={lessLabel}
          title={lessLabel}
        >
          <span className="att-card__more-label" aria-hidden>
            −
          </span>
        </button>
      ) : null}
    </div>
  );
}
