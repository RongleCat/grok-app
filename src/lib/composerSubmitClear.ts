import type { Attachment } from "@/lib/attachments";

type AttachmentPath = Pick<Attachment, "path">;

function attachmentsMatchForSubmit(
  sent: AttachmentPath[],
  current: AttachmentPath[],
): boolean {
  if (sent.length !== current.length) return false;
  return sent.every((item, i) => item.path === current[i]?.path);
}

export type ComposerSubmitPayload = {
  sentText: string;
  sentAttachments: AttachmentPath[];
  currentText: string;
  currentAttachments: AttachmentPath[];
};

export type ComposerSubmitSettlement = "persist-clear" | "restore" | "leave";

function isComposerEmptyAfterOptimisticClear(
  text: string,
  attachments: AttachmentPath[],
): boolean {
  return text === "" && attachments.length === 0;
}

function composerMatchesSentPayload(opts: ComposerSubmitPayload): boolean {
  return (
    opts.currentText === opts.sentText &&
    attachmentsMatchForSubmit(opts.sentAttachments, opts.currentAttachments)
  );
}

/**
 * True when the visible composer is still the submitted payload. Used by the
 * enqueue path (clear immediately) and as the "unchanged" half of settlement.
 */
export function shouldClearComposerAfterSubmit(
  opts: ComposerSubmitPayload,
): boolean {
  return composerMatchesSentPayload(opts);
}

/**
 * After the optimistic UI clear (user bubble already painted), decide how
 * `executeSend` should settle the composer:
 *
 * - empty or still the sent payload + success → wipe persisted draft
 * - empty or still the sent payload + failure → put the sent payload back
 * - follow-up text / attachments typed during send → leave alone
 *
 * Fail keeps draft (#599 / P1-3). Success must not swallow follow-up input.
 */
export function nextComposerSubmitSettlement(
  opts: ComposerSubmitPayload & { sendSucceeded: boolean },
): ComposerSubmitSettlement {
  const idle = isComposerEmptyAfterOptimisticClear(
    opts.currentText,
    opts.currentAttachments,
  );
  if (!idle && !composerMatchesSentPayload(opts)) return "leave";
  return opts.sendSucceeded ? "persist-clear" : "restore";
}

/**
 * A new-chat send materializes a session and adopts that view, so `stillHere`
 * is false. The per-project new-session buffer must still be wiped on success,
 * or the next "New session" restores the just-sent prompt (#620).
 *
 * Follow-up on the new thread is a per-session draft — do not keep the
 * project buffer just because we left the draft page.
 */
export function shouldClearProjectDraftAfterNewChatSend(opts: {
  fromNewChatPage: boolean;
  sendSucceeded: boolean;
}): boolean {
  return opts.fromNewChatPage && opts.sendSucceeded;
}
