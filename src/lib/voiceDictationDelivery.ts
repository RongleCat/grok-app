/**
 * Dictation result ownership: the composer buffer that was focused when the
 * user stopped recording — a session draft for real chats, the per-project
 * new-chat buffer on the draft page. Switching chats while STT runs must not
 * land the transcript in whatever chat is open at finish time.
 */

import {
  loadComposerProjectDraft,
  saveComposerProjectDraft,
  type ComposerProjectDraftStorage,
} from "@/lib/composerProjectDraft";
import {
  loadComposerSessionDraft,
  saveComposerSessionDraft,
  type ComposerSessionDraftStorage,
} from "@/lib/composerSessionDraft";
import { planTranscriptInsert } from "@/lib/voiceDictation";

export type DictationTarget = {
  /** App session id when a real chat held the composer at stop time. */
  sessionId: string | null;
  /** New-chat project buffer key (`projectDraftKey`); always non-null. */
  projectKey: string;
};

export function sameDictationTarget(
  a: DictationTarget,
  b: DictationTarget,
): boolean {
  return a.sessionId === b.sessionId && a.projectKey === b.projectKey;
}

/**
 * Merge `transcript` into the origin buffer's stored draft at the caret the
 * composer had at stop time, preserving that draft's attachments / quotes /
 * goal flag. Returns the merged text (and goal flag for a targeted send), or
 * null when the transcript was blank.
 */
export function parkDictationTranscript(opts: {
  target: DictationTarget;
  transcript: string;
  caret: number | null;
  sessionStorage?: ComposerSessionDraftStorage;
  projectStorage?: ComposerProjectDraftStorage;
}): { text: string; goalMode: boolean } | null {
  const { target, transcript, caret } = opts;
  if (target.sessionId) {
    const existing = loadComposerSessionDraft(
      target.sessionId,
      opts.sessionStorage,
    );
    const plan = planTranscriptInsert(
      existing?.text ?? "",
      transcript,
      caret ?? (existing?.text ?? "").length,
    );
    if (!plan) return null;
    saveComposerSessionDraft(
      target.sessionId,
      {
        text: plan.text,
        attachments: existing?.attachments ?? [],
        chatAttachments: existing?.chatAttachments,
        quotes: existing?.quotes,
        goalMode: existing?.goalMode,
      },
      opts.sessionStorage,
    );
    return { text: plan.text, goalMode: !!existing?.goalMode };
  }
  const existing = loadComposerProjectDraft(
    target.projectKey,
    opts.projectStorage,
  );
  const plan = planTranscriptInsert(
    existing?.text ?? "",
    transcript,
    caret ?? (existing?.text ?? "").length,
  );
  if (!plan) return null;
  saveComposerProjectDraft(
    target.projectKey,
    {
      text: plan.text,
      attachments: existing?.attachments ?? [],
      chatAttachments: existing?.chatAttachments,
      quotes: existing?.quotes,
      goalMode: existing?.goalMode,
    },
    opts.projectStorage,
  );
  return { text: plan.text, goalMode: !!existing?.goalMode };
}
