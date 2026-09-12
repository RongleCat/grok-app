/** User bubble body: text / skill chips / quote cards / fold, plus the
 * scheduled & Remote IM pill headers (`[Scheduled: …]` / `[Remote IM · …]`
 * → label, not raw brackets). Extracted from ConversationThread.tsx — the
 * row consumes only {@link UserMessageBody}. */

import { memo, useCallback, useState } from "react";
import { createT, type Locale } from "@/i18n";
import { useAttachedChatLookup } from "@/components/AttachedChatLookup";
import { ChatRefChip } from "@/components/ChatRefChip";
import { UserQuoteCards } from "@/components/ComposerQuoteCards";
import { HighlightedText } from "@/components/HighlightedText";
import { IconChat, IconClock } from "@/components/icons";
import { SkillChip } from "@/components/SkillChip";
import { parseScheduledUserContent } from "@/lib/automations";
import {
  parseQuotesFromContent,
  type ComposerQuote,
} from "@/lib/composerQuotes";
import {
  parseAttachmentsFromContent,
} from "@/lib/attachments";
import { hydrateDisplayContent, parseStoredContent } from "@/lib/draftDoc";
import {
  parseRemoteImUserContent,
  remoteImChannelLabel,
} from "@/lib/remoteImUserContent";
import {
  previewUserMessageText,
  shouldFoldUserMessage,
} from "@/lib/userMessageFold";

const UserBodyText = memo(function UserBodyText({
  content,
  findQuery,
  findActiveOccurrence,
}: {
  content: string;
  findQuery?: string;
  findActiveOccurrence?: number | null;
}) {
  const chatLookup = useAttachedChatLookup();
  const hydrated = hydrateDisplayContent(
    parseAttachmentsFromContent(content).text,
  );
  const segs = parseStoredContent(hydrated);
  if (
    !segs.some(
      (s) => s.type === "skill" || s.type === "plugin" || s.type === "chat",
    )
  ) {
    if (findQuery?.trim()) {
      return (
        <span className="user-msg-body">
          <HighlightedText
            text={hydrated}
            query={findQuery}
            activeOccurrence={findActiveOccurrence ?? null}
          />
        </span>
      );
    }
    return <span className="user-msg-body">{hydrated}</span>;
  }
  return (
    <span className="user-msg-body">
      {segs.map((s, i) => {
        if (s.type === "skill") {
          return <SkillChip key={`sk-${i}-${s.name}`} name={s.name} size="sm" />;
        }
        if (s.type === "plugin") {
          return (
            <SkillChip
              key={`pl-${i}-${s.name}`}
              name={s.name}
              size="sm"
              kind="plugin"
            />
          );
        }
        if (s.type === "chat") {
          const status = chatLookup.statusOf(s.sessionId);
          return (
            <ChatRefChip
              key={`ch-${i}-${s.sessionId}`}
              title={chatLookup.titleOf(s.sessionId)}
              status={status}
              size="sm"
              onOpen={
                chatLookup.onOpen
                  ? () => chatLookup.onOpen?.(s.sessionId)
                  : undefined
              }
            />
          );
        }
        if (findQuery?.trim() && s.text) {
          return (
            <HighlightedText
              key={`t-${i}`}
              text={s.text}
              query={findQuery}
              activeOccurrence={findActiveOccurrence ?? null}
            />
          );
        }
        return (
          <span key={`t-${i}`} className="user-msg-body__text">
            {s.text}
          </span>
        );
      })}
    </span>
  );
});

/** Render skill chips / plain text for the user bubble body. */
const UserPlainOrSkills = memo(function UserPlainOrSkills({
  content,
  findQuery,
  findActiveOccurrence,
  locale,
}: {
  content: string;
  findQuery?: string;
  findActiveOccurrence?: number | null;
  locale: Locale;
}) {
  const parsed = parseQuotesFromContent(content);
  const body = parsed.text;
  const quotes: ComposerQuote[] = parsed.quotes;
  const tr = createT(locale);
  const [showFull, setShowFull] = useState(false);

  const targetText = body || (quotes.length ? "" : content);
  const findActiveHere = !!findQuery?.trim();
  const canFold = shouldFoldUserMessage(targetText) && !findActiveHere;
  const displayText =
    canFold && !showFull ? previewUserMessageText(targetText) : targetText;

  const handleBubbleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!canFold) return;
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("button, a, .skill-chip, .chat-ref-chip")) return;
      setShowFull((v) => !v);
    },
    [canFold],
  );

  return (
    <>
      <UserQuoteCards
        quotes={quotes}
        listLabel={tr("composer.quotes")}
        findQuery={findQuery}
      />
      {body.trim() || !quotes.length ? (
        <div
          className={
            "lobe-chat-user-body-wrap" +
            (canFold ? " lobe-chat-user-body-wrap--foldable" : "") +
            (canFold && !showFull ? " lobe-chat-user-body-wrap--collapsed" : "")
          }
          onClick={canFold ? handleBubbleClick : undefined}
          title={
            canFold
              ? showFull
                ? tr("inspect.collapse")
                : tr("inspect.expandMore", { n: "" })
              : undefined
          }
        >
          <UserBodyText
            content={displayText}
            findQuery={findQuery}
            findActiveOccurrence={findActiveOccurrence}
          />
          {canFold ? (
            <div className="lobe-chat-user-fold-cue" aria-hidden>
              <span>{showFull ? "▲" : "▼"}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
});

/**
 * User bubble: skill chips + scheduled / Remote IM headers as pill tags
 * (`[Scheduled: title]` / `[Remote IM · feishu]` → label, not raw brackets).
 */
export const UserMessageBody = memo(function UserMessageBody({
  content,
  scheduledLabel,
  remoteImLabel,
  locale,
  findQuery,
  findActiveOccurrence,
}: {
  content: string;
  /** Short badge word, e.g. 已安排 / Scheduled */
  scheduledLabel: string;
  /** Short badge word, e.g. 远程 IM / Remote IM */
  remoteImLabel: string;
  locale: Locale;
  findQuery?: string;
  findActiveOccurrence?: number | null;
}) {
  const scheduled = parseScheduledUserContent(content);
  if (scheduled) {
    return (
      <div className="lobe-chat-user-msg">
        <span className="lobe-scheduled-tag" title={scheduled.title}>
          <IconClock size={13} className="lobe-scheduled-tag__icon" />
          <span className="lobe-scheduled-tag__kind">{scheduledLabel}</span>
          <span className="lobe-scheduled-tag__sep" aria-hidden>
            ·
          </span>
          <span className="lobe-scheduled-tag__title">
            {findQuery?.trim() ? (
              <HighlightedText
                text={scheduled.title}
                query={findQuery}
                activeOccurrence={null}
              />
            ) : (
              scheduled.title
            )}
          </span>
        </span>
        {scheduled.body.trim() ? (
          <div className="lobe-chat-user-msg__body">
            <UserPlainOrSkills
              content={scheduled.body}
              locale={locale}
              findQuery={findQuery}
              findActiveOccurrence={findActiveOccurrence}
            />
          </div>
        ) : null}
      </div>
    );
  }

  const remoteIm = parseRemoteImUserContent(content);
  if (remoteIm) {
    const channelTitle = remoteImChannelLabel(remoteIm.channel, locale);
    const tip = `${remoteImLabel} · ${channelTitle}`;
    return (
      <div className="lobe-chat-user-msg">
        <span className="lobe-scheduled-tag lobe-remote-im-tag" title={tip}>
          <IconChat size={13} className="lobe-scheduled-tag__icon" />
          <span className="lobe-scheduled-tag__kind">{remoteImLabel}</span>
          <span className="lobe-scheduled-tag__sep" aria-hidden>
            ·
          </span>
          <span className="lobe-scheduled-tag__title">
            {findQuery?.trim() ? (
              <HighlightedText
                text={channelTitle}
                query={findQuery}
                activeOccurrence={null}
              />
            ) : (
              channelTitle
            )}
          </span>
        </span>
        {remoteIm.body.trim() ? (
          <div className="lobe-chat-user-msg__body">
            <UserPlainOrSkills
              content={remoteIm.body}
              locale={locale}
              findQuery={findQuery}
              findActiveOccurrence={findActiveOccurrence}
            />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <UserPlainOrSkills
      content={content}
      locale={locale}
      findQuery={findQuery}
      findActiveOccurrence={findActiveOccurrence}
    />
  );
});
