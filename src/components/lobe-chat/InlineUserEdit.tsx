/**
 * Inline edit for the last user bubble — simple local form, not the main composer.
 * Full-width of the transcript column; hosts editable attachment chips + drop target.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  isDraftEmpty,
  parseUserMessageContent,
  plainTextOf,
  serializeStored,
} from "@/lib/draftDoc";
import type { Attachment } from "@/lib/attachments";
import { isImagePath } from "@/lib/attachments";
import { AttachmentCard } from "@/components/AttachmentCard";
import type { AttachmentCardLabels } from "@/components/AttachmentCard";
import { SkillChip } from "@/components/SkillChip";
import { ChatRefChip } from "@/components/ChatRefChip";
import { cn } from "@/lib/utils";

export function InlineUserEdit({
  content,
  attachments = [],
  attachLabels,
  busy,
  cancelLabel,
  resendLabel,
  placeholder,
  onCancel,
  onSubmit,
  onRemoveAttachment,
}: {
  content: string;
  attachments?: Attachment[];
  attachLabels: AttachmentCardLabels;
  busy?: boolean;
  cancelLabel: string;
  resendLabel: string;
  placeholder?: string;
  onCancel: () => void;
  onSubmit: (storedContent: string) => void;
  onRemoveAttachment?: (a: Attachment) => void;
}) {
  const skills = useMemo(() => {
    return parseUserMessageContent(content)
      .filter((s): s is { type: "skill"; name: string } => s.type === "skill")
      .map((s) => s.name);
  }, [content]);

  const chats = useMemo(() => {
    return parseUserMessageContent(content)
      .filter(
        (s): s is { type: "chat"; sessionId: string } => s.type === "chat",
      )
      .map((s) => s.sessionId);
  }, [content]);

  const initialText = useMemo(
    () => plainTextOf(parseUserMessageContent(content)),
    [content],
  );
  const [text, setText] = useState(initialText);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(initialText);
  }, [initialText]);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.focus();
    el.selectionStart = el.value.length;
    el.selectionEnd = el.value.length;
    // Grow to content
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, []);

  const canSubmit =
    !busy &&
    (!isDraftEmpty([
      ...chats.map((sessionId) => ({ type: "chat" as const, sessionId })),
      ...skills.map((name) => ({ type: "skill" as const, name })),
      { type: "text" as const, text },
    ]) ||
      attachments.length > 0);

  const submit = () => {
    if (!canSubmit) return;
    const segs = [
      ...chats.map((sessionId) => ({ type: "chat" as const, sessionId })),
      ...skills.map((name) => ({ type: "skill" as const, name })),
      { type: "text" as const, text },
    ];
    onSubmit(serializeStored(segs));
  };

  const galleryPaths = attachments
    .filter((x) => !x.isDir && isImagePath(x.path))
    .map((x) => x.path);

  return (
    <div className="lobe-inline-edit" data-testid="inline-user-edit">
      {attachments.length > 0 ? (
        <div className="lobe-inline-edit__atts" aria-label="attachments">
          {attachments.map((a) => (
            <AttachmentCard
              key={a.path}
              attachment={a}
              variant="chip"
              labels={attachLabels}
              galleryPaths={galleryPaths}
              onRemove={
                busy || !onRemoveAttachment
                  ? undefined
                  : (att) => onRemoveAttachment(att)
              }
            />
          ))}
        </div>
      ) : null}
      {chats.length > 0 || skills.length > 0 ? (
        <div className="lobe-inline-edit__skills">
          {chats.map((sessionId) => (
            <ChatRefChip key={sessionId} title={sessionId.slice(0, 8)} size="sm" />
          ))}
          {skills.map((name) => (
            <SkillChip key={name} name={name} size="sm" />
          ))}
        </div>
      ) : null}
      <textarea
        ref={taRef}
        className="lobe-inline-edit__textarea"
        value={text}
        disabled={busy}
        placeholder={placeholder}
        rows={3}
        // Textarea is plain-text by default; still strip just in case of OS rich paste.
        onPaste={(e) => {
          e.preventDefault();
          const plain =
            e.clipboardData?.getData("text/plain") ??
            e.clipboardData?.getData("text") ??
            "";
          if (!plain) return;
          const el = e.currentTarget;
          const start = el.selectionStart ?? text.length;
          const end = el.selectionEnd ?? text.length;
          const next =
            text.slice(0, start) +
            plain.replace(/\r\n/g, "\n").replace(/\r/g, "\n") +
            text.slice(end);
          setText(next);
          requestAnimationFrame(() => {
            const pos = start + plain.length;
            el.selectionStart = pos;
            el.selectionEnd = pos;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
          });
        }}
        onChange={(e) => {
          setText(e.target.value);
          const el = e.target;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="lobe-inline-edit__actions">
        <button
          type="button"
          className="lobe-inline-edit__btn lobe-inline-edit__btn--ghost"
          disabled={busy}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={cn(
            "lobe-inline-edit__btn lobe-inline-edit__btn--primary",
            !canSubmit && "is-disabled",
          )}
          disabled={!canSubmit}
          onClick={submit}
        >
          {resendLabel}
        </button>
      </div>
    </div>
  );
}
