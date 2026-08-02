/**
 * Memoized transcript message row.
 * Isolates stream ticks / parent chrome re-renders so unchanged history rows
 * skip rebuilding markdown, tools, and action chrome.
 */

import { memo, useMemo, type ReactNode } from "react";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import {
  formatTurnErrorBody,
  messageSegments,
  type ChatMessage,
  type MessageSegment,
} from "@/lib/session";
import { formatMessageDeepLink } from "@/lib/messageNodeDeepLink";
import type { Attachment } from "@/lib/attachments";
import {
  buildInlineMediaPathMap,
  filterAttachmentsNotInlined,
  isImagePath,
  isMediaPath,
} from "@/lib/attachments";
import { mergePathMaps } from "@/lib/sessionPathMap";
import { AttachmentCard } from "@/components/AttachmentCard";
import type { ResourceOpenTarget } from "@/components/ResourceViewer";
import {
  IconArrowsMinimize,
  IconChat,
  IconClock,
  IconExportMd,
  IconFork,
  IconLink,
  IconRename,
  IconRewind,
  IconTarget,
} from "@/components/icons";
import type { MessageTimeFormat } from "@/lib/messageTimeFormatPref";
import { computeMessageLength } from "@/lib/messageLength";
import { formatTokenCount } from "@/lib/contextUsage";
import type { ModelOption } from "@/lib/grokCatalog";
import { StructuredJsonPanel } from "./StructuredJsonPanel";
import {
  MessageActionButton,
  MessageCopyButton,
  MessageRegenerateButton,
} from "./MessageAction";
import { ChatItem } from "./ChatItem";
import { MarkdownChat } from "./MarkdownChat";
import { Thinking } from "./Thinking";
import { InlineUserEdit } from "./InlineUserEdit";
import { SkillChip } from "@/components/SkillChip";
import { HighlightedText } from "@/components/HighlightedText";
import { findChatMatches } from "@/lib/chatFind";
import { hydrateDisplayContent, parseStoredContent } from "@/lib/draftDoc";
import { parseScheduledUserContent } from "@/lib/automations";
import {
  parseRemoteImUserContent,
  remoteImChannelLabel,
} from "@/lib/remoteImUserContent";
import { extractAutomationPayload } from "@/lib/automationSetup";
import {
  isToolStepMessage,
  LiveToolText,
} from "./AgentActivity";
import { EndOfTurnChip } from "./EndOfTurnChip";
import {
  TimelineToolRow,
  toolSegmentFromMessage,
  toolSegmentIsRunning,
} from "./TimelineToolRow";
import { TimelinePhaseBlock } from "./TimelinePhaseBlock";
import { buildTimelineUnits } from "@/lib/timelinePhases";
import { isEndOfTurnMarker } from "@/lib/endOfTurn";
import { ChatMessageTime } from "./ChatMessageTime";

export type AttachLabels = {
  open: string;
  reveal: string;
  copyPath: string;
  copyImage: string;
  addToComposer: string;
  remove: string;
};

/**
 * Assistant markdown + attachment cards.
 * Memoized so parent re-renders (showBack, live tool pulse, etc.) do not
 * rebuild imagePathMap / remount ImageUi frames mid-scroll.
 */
const AssistantMessageBody = memo(function AssistantMessageBody({
  content,
  attachments,
  streaming,
  locale,
  projectPath,
  /** Session-level token→abs map (tool-touched files + unique tails). */
  sessionPathMap,
  onOpenResource,
  onOpenExternalLink,
  onAddAttachmentToComposer,
  attachLabels,
  findQuery,
  findActiveOccurrence,
  findOccurrenceBase = 0,
}: {
  content: string;
  attachments?: Attachment[];
  streaming?: boolean;
  locale: Locale;
  projectPath?: string | null;
  sessionPathMap?: Record<string, string>;
  onOpenResource?: (target: ResourceOpenTarget) => void;
  onOpenExternalLink?: (url: string) => void;
  onAddAttachmentToComposer?: (att: Attachment) => void;
  attachLabels: AttachLabels;
  findQuery?: string;
  findActiveOccurrence?: number | null;
  /** Offset into the message-level occurrence index for multi-segment bodies. */
  findOccurrenceBase?: number;
}) {
  // Never show silent grok-automation fences in the transcript.
  const displayContent = content?.trim()
    ? extractAutomationPayload(content).cleanText
    : content;
  const imagePathMap = useMemo(
    () => buildInlineMediaPathMap(attachments),
    [attachments],
  );
  const bottomAtts = useMemo(
    () =>
      filterAttachmentsNotInlined(displayContent || content, attachments),
    [displayContent, content, attachments],
  );
  const pathMapProp = useMemo(() => {
    // Session tool paths first so short relatives (04-正文/正文.md) beat media
    // basename collisions; media map fills in image/video short tokens.
    const merged = mergePathMaps(imagePathMap, sessionPathMap);
    return Object.keys(merged).length ? merged : undefined;
  }, [imagePathMap, sessionPathMap]);
  const galleryPaths = useMemo(
    () =>
      (bottomAtts ?? [])
        .filter((x) => !x.isDir && isImagePath(x.path))
        .map((x) => x.path),
    [bottomAtts],
  );

  if (!(displayContent || "").trim() && !(bottomAtts && bottomAtts.length)) {
    return null;
  }

  return (
    <>
      {(displayContent || "").trim() ? (
        <MarkdownChat
          locale={locale}
          streaming={!!streaming}
          imagePathMap={pathMapProp}
          projectPath={projectPath}
          onOpenResource={onOpenResource}
          onOpenExternalLink={onOpenExternalLink}
          findQuery={findQuery}
          findActiveOccurrence={findActiveOccurrence}
          findOccurrenceBase={findOccurrenceBase}
        >
          {displayContent}
        </MarkdownChat>
      ) : null}
      {bottomAtts && bottomAtts.length > 0 ? (
        <div className="lobe-chat-atts">
          {bottomAtts.map((a) => (
            <AttachmentCard
              key={a.path}
              attachment={a}
              variant={!a.isDir && isMediaPath(a.path) ? "card" : "chip"}
              labels={attachLabels}
              galleryPaths={galleryPaths}
              onAddToComposer={onAddAttachmentToComposer}
            />
          ))}
        </div>
      ) : null}
    </>
  );
});

/** Render skill chips / plain text for the user bubble body. */
function UserPlainOrSkills({
  content,
  findQuery,
  findActiveOccurrence,
}: {
  content: string;
  findQuery?: string;
  findActiveOccurrence?: number | null;
}) {
  const hydrated = hydrateDisplayContent(content);
  const segs = parseStoredContent(hydrated);
  // Always use a pre-wrap host so input newlines / blank lines match the bubble.
  if (!segs.some((s) => s.type === "skill")) {
    if (findQuery?.trim()) {
      return (
        <span className="user-msg-body">
          <HighlightedText
            text={content}
            query={findQuery}
            activeOccurrence={findActiveOccurrence ?? null}
          />
        </span>
      );
    }
    return <span className="user-msg-body">{content}</span>;
  }
  return (
    <span className="user-msg-body">
      {segs.map((s, i) =>
        s.type === "skill" ? (
          <SkillChip key={`sk-${i}-${s.name}`} name={s.name} size="sm" />
        ) : findQuery?.trim() && s.text ? (
          <HighlightedText
            key={`t-${i}`}
            text={s.text}
            query={findQuery}
            activeOccurrence={findActiveOccurrence ?? null}
          />
        ) : (
          <span key={`t-${i}`} className="user-msg-body__text">
            {s.text}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * User bubble: skill chips + scheduled / Remote IM headers as pill tags
 * (`[Scheduled: title]` / `[Remote IM · feishu]` → label, not raw brackets).
 */
function UserMessageBody({
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
      findQuery={findQuery}
      findActiveOccurrence={findActiveOccurrence}
    />
  );
}

export type TranscriptMessageRowProps = {
  message: ChatMessage;
  msgIndex: number;
  virtualized: boolean;
  measureRef: (index: number) => (el: HTMLElement | null) => void;
  locale: Locale;
  /** True when this tool_step is already woven into an assistant timeline. */
  toolInlined: boolean;
  showToolChrome: boolean;
  toolStepsAutoCollapse: boolean;
  isLastUser: boolean;
  isEditing: boolean;
  editSubmitting: boolean;
  editAttachments: Attachment[];
  canEditLastUser: boolean;
  canRegenerate: boolean;
  canRegenThis: boolean;
  regenerateModels: ModelOption[];
  regenerateModelId: string;
  canRewindSession: boolean;
  sessionId: string | null;
  projectPath?: string | null;
  sessionPathMap: Record<string, string>;
  showTimestamps: boolean;
  messageTimeFormat: MessageTimeFormat;
  showReplyLength: boolean;
  structuredOutputActive: boolean;
  structuredOutputSchema?: string | null;
  structuredOutputUsage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
  } | null;
  structuredOutputLabels?: {
    title: string;
    badge: string;
    copy: string;
    copied: string;
    export: string;
    invalidJson: string;
    empty: string;
    valid: string;
    schemaMismatch: string;
    missingRequired: string;
    streaming?: string;
    partial?: string;
    partialKeys?: string;
    timeline?: string;
    usage?: string;
    usageIo?: string;
    usageTotal?: string;
  };
  /** Only the latest assistant gets session-level usage on the structured panel. */
  showStructuredUsage: boolean;
  isActiveAssistant: boolean;
  liveTool: ChatMessage | null;
  findQuery: string;
  isFindHit: boolean;
  isFindCurrent: boolean;
  findActiveOccurrence: number | null;
  isNodeFocus: boolean;
  attachLabels: AttachLabels;
  onEditUserMessage?: (message: ChatMessage) => void;
  onCancelEditUserMessage?: () => void;
  onSubmitEditUserMessage?: (message: ChatMessage, content: string) => void;
  onRemoveEditAttachment?: (att: Attachment) => void;
  onRegenerateAssistant?: (
    message: ChatMessage,
    opts?: { modelId?: string },
  ) => void;
  onRewindToUserMessage?: (message: ChatMessage) => void;
  onForkFromUserMessage?: (message: ChatMessage) => void;
  onOpenResource?: (target: ResourceOpenTarget) => void;
  onOpenExternalLink?: (url: string) => void;
  onAddAttachmentToComposer?: (att: Attachment) => void;
};

function segmentEqual(a: MessageSegment, b: MessageSegment): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  if (a.kind === "thought" || a.kind === "content") {
    return (a as { text: string }).text === (b as { text: string }).text;
  }
  // tool segment
  const ta = a as Extract<MessageSegment, { kind: "tool" }>;
  const tb = b as Extract<MessageSegment, { kind: "tool" }>;
  return (
    ta.toolCallId === tb.toolCallId &&
    ta.title === tb.title &&
    ta.toolKind === tb.toolKind &&
    ta.status === tb.status &&
    ta.detail === tb.detail &&
    ta.path === tb.path &&
    ta.createdAt === tb.createdAt &&
    !!ta.streaming === !!tb.streaming &&
    !!ta.isError === !!tb.isError
  );
}

function attachmentsEqual(
  a: ChatMessage["attachments"],
  b: ChatMessage["attachments"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.path !== y.path || x.isDir !== y.isDir || x.name !== y.name) {
      return false;
    }
  }
  return true;
}

function compactMetaEqual(
  a: ChatMessage["compactMeta"],
  b: ChatMessage["compactMeta"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    a.trigger === b.trigger &&
    a.tokensBefore === b.tokensBefore &&
    a.tokensAfter === b.tokensAfter &&
    a.note === b.note &&
    a.summaryPreview === b.summaryPreview
  );
}

function messageRowEqual(a: ChatMessage, b: ChatMessage): boolean {
  if (a === b) return true;
  if (a.id !== b.id) return false;
  if (a.role !== b.role) return false;
  if (a.content !== b.content) return false;
  if (a.thought !== b.thought) return false;
  if (!!a.streaming !== !!b.streaming) return false;
  if (a.marker !== b.marker) return false;
  if (!!a.isError !== !!b.isError) return false;
  if (a.createdAt !== b.createdAt) return false;
  if (a.toolCallId !== b.toolCallId) return false;
  if (a.toolKind !== b.toolKind) return false;
  if (a.toolStatus !== b.toolStatus) return false;
  if (a.toolDetail !== b.toolDetail) return false;
  if (a.toolPath !== b.toolPath) return false;
  if (!compactMetaEqual(a.compactMeta, b.compactMeta)) return false;
  if (!attachmentsEqual(a.attachments, b.attachments)) return false;

  const as = a.segments;
  const bs = b.segments;
  if (as === bs) return true;
  if (!as || !bs) return !as && !bs;
  if (as.length !== bs.length) return false;
  // Compare all segments; streaming tail is usually the last content/tool.
  for (let i = 0; i < as.length; i++) {
    if (!segmentEqual(as[i]!, bs[i]!)) return false;
  }
  return true;
}

function liveToolEqual(
  a: ChatMessage | null,
  b: ChatMessage | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.toolCallId === b.toolCallId &&
    a.content === b.content &&
    a.toolKind === b.toolKind &&
    a.toolDetail === b.toolDetail &&
    a.toolPath === b.toolPath &&
    a.toolStatus === b.toolStatus
  );
}

function attachLabelsEqual(a: AttachLabels, b: AttachLabels): boolean {
  return (
    a.open === b.open &&
    a.reveal === b.reveal &&
    a.copyPath === b.copyPath &&
    a.copyImage === b.copyImage &&
    a.addToComposer === b.addToComposer &&
    a.remove === b.remove
  );
}

function rowPropsEqual(
  prev: TranscriptMessageRowProps,
  next: TranscriptMessageRowProps,
): boolean {
  return (
    messageRowEqual(prev.message, next.message) &&
    prev.msgIndex === next.msgIndex &&
    prev.virtualized === next.virtualized &&
    prev.measureRef === next.measureRef &&
    prev.locale === next.locale &&
    prev.toolInlined === next.toolInlined &&
    prev.showToolChrome === next.showToolChrome &&
    prev.toolStepsAutoCollapse === next.toolStepsAutoCollapse &&
    prev.isLastUser === next.isLastUser &&
    prev.isEditing === next.isEditing &&
    prev.editSubmitting === next.editSubmitting &&
    prev.editAttachments === next.editAttachments &&
    prev.canEditLastUser === next.canEditLastUser &&
    prev.canRegenerate === next.canRegenerate &&
    prev.canRegenThis === next.canRegenThis &&
    prev.regenerateModels === next.regenerateModels &&
    prev.regenerateModelId === next.regenerateModelId &&
    prev.canRewindSession === next.canRewindSession &&
    prev.sessionId === next.sessionId &&
    prev.projectPath === next.projectPath &&
    prev.sessionPathMap === next.sessionPathMap &&
    prev.showTimestamps === next.showTimestamps &&
    prev.messageTimeFormat === next.messageTimeFormat &&
    prev.showReplyLength === next.showReplyLength &&
    prev.structuredOutputActive === next.structuredOutputActive &&
    prev.structuredOutputSchema === next.structuredOutputSchema &&
    prev.structuredOutputUsage === next.structuredOutputUsage &&
    prev.structuredOutputLabels === next.structuredOutputLabels &&
    prev.showStructuredUsage === next.showStructuredUsage &&
    prev.isActiveAssistant === next.isActiveAssistant &&
    liveToolEqual(prev.liveTool, next.liveTool) &&
    prev.findQuery === next.findQuery &&
    prev.isFindHit === next.isFindHit &&
    prev.isFindCurrent === next.isFindCurrent &&
    prev.findActiveOccurrence === next.findActiveOccurrence &&
    prev.isNodeFocus === next.isNodeFocus &&
    attachLabelsEqual(prev.attachLabels, next.attachLabels) &&
    prev.onEditUserMessage === next.onEditUserMessage &&
    prev.onCancelEditUserMessage === next.onCancelEditUserMessage &&
    prev.onSubmitEditUserMessage === next.onSubmitEditUserMessage &&
    prev.onRemoveEditAttachment === next.onRemoveEditAttachment &&
    prev.onRegenerateAssistant === next.onRegenerateAssistant &&
    prev.onRewindToUserMessage === next.onRewindToUserMessage &&
    prev.onForkFromUserMessage === next.onForkFromUserMessage &&
    prev.onOpenResource === next.onOpenResource &&
    prev.onOpenExternalLink === next.onOpenExternalLink &&
    prev.onAddAttachmentToComposer === next.onAddAttachmentToComposer
  );
}

function TranscriptMessageRowInner({
  message: m,
  msgIndex,
  virtualized,
  measureRef,
  locale,
  toolInlined,
  showToolChrome,
  toolStepsAutoCollapse,
  isLastUser,
  isEditing,
  editSubmitting,
  editAttachments,
  canEditLastUser,
  canRegenerate,
  canRegenThis,
  regenerateModels,
  regenerateModelId,
  canRewindSession,
  sessionId,
  projectPath,
  sessionPathMap,
  showTimestamps,
  messageTimeFormat,
  showReplyLength,
  structuredOutputActive,
  structuredOutputSchema,
  structuredOutputUsage,
  structuredOutputLabels,
  showStructuredUsage,
  isActiveAssistant,
  liveTool,
  findQuery,
  isFindHit,
  isFindCurrent,
  findActiveOccurrence,
  isNodeFocus,
  attachLabels,
  onEditUserMessage,
  onCancelEditUserMessage,
  onSubmitEditUserMessage,
  onRemoveEditAttachment,
  onRegenerateAssistant,
  onRewindToUserMessage,
  onForkFromUserMessage,
  onOpenResource,
  onOpenExternalLink,
  onAddAttachmentToComposer,
}: TranscriptMessageRowProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const timeFormat = showTimestamps ? messageTimeFormat : "off";

  const wrap = (node: ReactNode, opts?: { zero?: boolean }) => {
    if (virtualized) {
      return (
        <div
          ref={measureRef(msgIndex)}
          data-virt-index={msgIndex}
          style={
            opts?.zero
              ? { height: 0, overflow: "hidden" }
              : undefined
          }
          aria-hidden={opts?.zero ? true : undefined}
        >
          {opts?.zero ? null : node}
        </div>
      );
    }
    return opts?.zero ? null : node;
  };

  if (
    isEndOfTurnMarker(m.marker) ||
    m.marker === "turn_cancelled" ||
    (m.role === "tool" &&
      (m.content?.startsWith("turn_cancelled") ||
        m.content?.startsWith("turn_end|")))
  ) {
    return wrap(<EndOfTurnChip message={m} locale={locale} />);
  }

  // Standalone tool_step only when not already woven into an assistant
  // timeline (tools before first assistant bubble, edge cases).
  // Conversation filter hides tool chrome entirely.
  if (isToolStepMessage(m)) {
    if (!showToolChrome || toolInlined) {
      return wrap(null, { zero: true });
    }
    const toolSeg = toolSegmentFromMessage(m);
    if (!toolSeg) {
      return wrap(null, { zero: true });
    }
    return wrap(
      <div className="lobe-chat-assistant-timeline">
        <div className="lobe-timeline-rail">
          <TimelineToolRow
            tool={toolSeg}
            autoCollapse={toolStepsAutoCollapse}
            locale={locale}
          />
        </div>
      </div>,
    );
  }

  if (
    m.marker === "context_compact" ||
    (m.role === "tool" &&
      (m.content?.startsWith("context_compact") || m.compactMeta))
  ) {
    const meta = m.compactMeta;
    const auto = (meta?.trigger || "auto") !== "manual";
    const title = auto
      ? tr("compact.bannerAuto")
      : tr("compact.bannerManual");
    let detail = "";
    if (
      meta?.tokensBefore != null &&
      meta?.tokensAfter != null &&
      Number.isFinite(meta.tokensBefore) &&
      Number.isFinite(meta.tokensAfter)
    ) {
      detail = tr("compact.tokensRange", {
        before: formatTokenCount(meta.tokensBefore, locale),
        after: formatTokenCount(meta.tokensAfter, locale),
      });
    } else if (meta?.note) {
      detail = meta.note;
    }
    const summary = meta?.summaryPreview?.trim();
    return wrap(
      <div
        className="lobe-chat-compact"
        role="status"
        data-trigger={meta?.trigger || "auto"}
      >
        <span className="lobe-chat-compact__icon" aria-hidden>
          <IconArrowsMinimize size={15} />
        </span>
        <div className="lobe-chat-compact__body">
          <div className="lobe-chat-compact__title">{title}</div>
          {detail ? (
            <div className="lobe-chat-compact__detail">{detail}</div>
          ) : null}
          {summary ? (
            <details className="lobe-chat-compact__summary">
              <summary>{tr("compact.summaryToggle")}</summary>
              <p>{summary}</p>
            </details>
          ) : null}
        </div>
      </div>,
    );
  }

  // Generic tool rows (non marker) — keep quiet; no history stack.
  if (m.role === "tool") {
    return wrap(null, { zero: true });
  }

  if (m.role === "user") {
    const isInterjection = m.marker === "interjection";
    return wrap(
      <ChatItem
        id={m.id}
        placement="right"
        showAvatar={false}
        showTitle={false}
        className={
          (isFindHit ? " lobe-chat-item--find-hit" : "") +
          (isFindCurrent ? " lobe-chat-item--find-current" : "") +
          (isNodeFocus ? " lobe-chat-item--node-focus" : "")
        }
        message={
          <div
            className={
              "lobe-chat-user-stack" +
              (isEditing ? " lobe-chat-user-stack--editing" : "")
            }
          >
            {/* Read-only attachments above bubble; edit mode reloads them inside the form */}
            {!isEditing && m.attachments && m.attachments.length > 0 ? (
              <div className="lobe-chat-atts lobe-chat-atts--user">
                {m.attachments.map((a) => (
                  <AttachmentCard
                    key={a.path}
                    attachment={a}
                    variant="card"
                    labels={attachLabels}
                    galleryPaths={m.attachments
                      ?.filter((x) => !x.isDir && isImagePath(x.path))
                      .map((x) => x.path)}
                    onAddToComposer={onAddAttachmentToComposer}
                  />
                ))}
              </div>
            ) : null}
            {isEditing ? (
              <InlineUserEdit
                content={m.content}
                attachments={editAttachments}
                attachLabels={attachLabels}
                busy={editSubmitting}
                cancelLabel={tr("message.editCancel")}
                resendLabel={tr("message.editResend")}
                placeholder={tr("message.editPlaceholder")}
                onCancel={() => onCancelEditUserMessage?.()}
                onSubmit={(stored) => onSubmitEditUserMessage?.(m, stored)}
                onRemoveAttachment={onRemoveEditAttachment}
              />
            ) : m.content.trim() ? (
              <div
                className={
                  "lobe-chat-bubble" +
                  (isInterjection ? " lobe-chat-bubble--interjection" : "")
                }
                data-message-marker={m.marker}
              >
                {isInterjection ? (
                  <div className="lobe-chat-interjection-tag">
                    <IconTarget size={12} aria-hidden />
                    <span>{tr("message.interjectionTag")}</span>
                  </div>
                ) : null}
                <UserMessageBody
                  content={m.content}
                  scheduledLabel={tr("automations.msgTag")}
                  remoteImLabel={tr("remoteIm.msgTag")}
                  locale={locale}
                  findQuery={findQuery}
                  findActiveOccurrence={
                    isFindCurrent ? findActiveOccurrence : null
                  }
                />
              </div>
            ) : null}
          </div>
        }
        actions={
          isEditing ? null : (
            <>
              <ChatMessageTime
                createdAt={m.createdAt}
                locale={locale}
                format={timeFormat}
              />
              {m.content.trim() ? (
                <MessageCopyButton
                  text={m.content}
                  copyLabel={tr("message.copy")}
                  copiedLabel={tr("message.copied")}
                />
              ) : null}
              {sessionId
                ? (() => {
                    const link = formatMessageDeepLink(sessionId, m.id);
                    if (!link) return null;
                    return (
                      <MessageCopyButton
                        text={link}
                        copyLabel={tr("message.copyLink")}
                        copiedLabel={tr("message.linkCopied")}
                        idleIcon={<IconLink size={15} />}
                      />
                    );
                  })()
                : null}
              {isLastUser ? (
                <MessageActionButton
                  label={tr("message.edit")}
                  disabled={!canEditLastUser}
                  onClick={() => {
                    if (!canEditLastUser) return;
                    onEditUserMessage?.(m);
                  }}
                >
                  <IconRename size={15} />
                </MessageActionButton>
              ) : null}
              {onRewindToUserMessage && !isInterjection ? (
                <MessageActionButton
                  label={tr("message.rewindHere")}
                  disabled={!canRewindSession}
                  onClick={() => {
                    if (!canRewindSession) return;
                    onRewindToUserMessage(m);
                  }}
                >
                  <IconRewind size={15} />
                </MessageActionButton>
              ) : null}
              {onForkFromUserMessage && !isInterjection ? (
                <MessageActionButton
                  label={tr("message.forkHere")}
                  disabled={!canRewindSession}
                  onClick={() => {
                    if (!canRewindSession) return;
                    onForkFromUserMessage(m);
                  }}
                >
                  <IconFork size={15} />
                </MessageActionButton>
              ) : null}
            </>
          )
        }
      />,
    );
  }

  if (m.isError) {
    const friendly = formatTurnErrorBody(
      { content: m.content, code: undefined, message: undefined },
      locale === "en" ? "en" : "zh",
    );
    return wrap(
      <div
        className={
          "lobe-chat-error" +
          (isFindHit ? " lobe-chat-item--find-hit" : "") +
          (isFindCurrent ? " lobe-chat-item--find-current" : "") +
          (isNodeFocus ? " lobe-chat-item--node-focus" : "")
        }
        role="status"
        data-testid="chat-turn-error"
        data-message-id={m.id}
      >
        <div className="lobe-chat-error__pill">
          <span className="lobe-chat-error__icon" aria-hidden>
            ℹ
          </span>
          <span className="lobe-chat-error__text">
            {findQuery.trim() ? (
              <HighlightedText
                text={friendly}
                query={findQuery}
                activeOccurrence={
                  isFindCurrent ? findActiveOccurrence : null
                }
              />
            ) : (
              friendly
            )}
          </span>
          {canRegenThis ? (
            <span className="lobe-chat-error__actions">
              <MessageRegenerateButton
                label={tr("message.regenerate")}
                sameModelLabel={tr("message.regenerateSameModel")}
                pickModelLabel={tr("message.regeneratePickModel")}
                disabled={!canRegenerate}
                models={regenerateModels}
                currentModelId={regenerateModelId}
                iconSize={14}
                onRegenerate={(modelId) => {
                  if (!canRegenerate) return;
                  onRegenerateAssistant?.(
                    m,
                    modelId ? { modelId } : undefined,
                  );
                }}
              />
            </span>
          ) : null}
        </div>
      </div>,
    );
  }

  // Assistant — thought / tool / body in true stream order.
  const segs = messageSegments(m);
  const hasInlinedRunningTool = segs.some(
    (s) => s.kind === "tool" && toolSegmentIsRunning(s),
  );
  // Fallback live line only when tool not yet woven into segments.
  // Conversation filter hides tool chrome (including live tool text).
  const showLiveToolBelow =
    showToolChrome &&
    !!liveTool &&
    isActiveAssistant &&
    !hasInlinedRunningTool;
  const showThinkingPlaceholder =
    !!m.streaming && segs.length === 0 && !showLiveToolBelow;

  const contentSegCount = segs.filter((s) => s.kind === "content").length;
  let lastContentSi = -1;
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i]!.kind === "content") {
      lastContentSi = i;
      break;
    }
  }

  // Phase projection: thought+tools collapse when phase ends (content
  // / next thought), not only when the full answer is done.
  const timelineUnits = buildTimelineUnits(segs, {
    streaming: !!m.streaming,
  });

  return wrap(
    <ChatItem
      id={m.id}
      placement="left"
      showAvatar={false}
      loading={!!m.streaming}
      className={
        (isFindHit ? " lobe-chat-item--find-hit" : "") +
        (isFindCurrent ? " lobe-chat-item--find-current" : "") +
        (isNodeFocus ? " lobe-chat-item--node-focus" : "")
      }
      message={
        <div
          className="lobe-chat-assistant-timeline"
          aria-busy={m.streaming ? true : undefined}
          aria-live={m.streaming ? "polite" : undefined}
          data-find-assistant={isFindCurrent ? "current" : undefined}
        >
          {showThinkingPlaceholder ? (
            <Thinking
              locale={locale}
              thinking
              streamingLabel={tr("chat.thinkingLabel")}
              doneLabel={tr("chat.thoughtDone")}
              thoughtForLabel={(n) => tr("chat.thoughtFor", { n })}
            />
          ) : null}
          {(() => {
            // Running occurrence base across content segments so
            // find marks stay aligned with message-level match index.
            let contentOccBase = 0;
            return timelineUnits.map((unit) => {
              if (unit.kind === "phase") {
                // Always paint Grok Worked-for rail (tools + thought steps).
                // “Conversation only” only hides standalone tool_step rows,
                // not this official activity summary.
                return (
                  <TimelinePhaseBlock
                    key={`${m.id}-${unit.id}`}
                    phase={unit}
                    locale={locale}
                    messageStreaming={!!m.streaming}
                    autoCollapse={toolStepsAutoCollapse}
                    historyTimestamps={[
                      m.createdAt,
                      ...unit.tools.map((t) => t.createdAt),
                    ]}
                  />
                );
              }
              if (unit.kind === "tool") {
                // Bare tool outside a phase — respect hide-tools filter.
                if (!showToolChrome) return null;
                return (
                  <div
                    key={`${m.id}-tool-${unit.tool.toolCallId || unit.si}`}
                    className="lobe-timeline-rail"
                  >
                    <TimelineToolRow
                      tool={unit.tool}
                      autoCollapse={toolStepsAutoCollapse}
                      locale={locale}
                    />
                  </div>
                );
              }
              // Adjacent bare thoughts are coalesced into thought-group.
              if (unit.kind === "thought" || unit.kind === "thought-group") {
                const texts =
                  unit.kind === "thought-group" ? unit.texts : [unit.text];
                const joined = texts
                  .map((t) => t.trim())
                  .filter(Boolean)
                  .join("\n\n");
                const streaming = unit.streaming;
                if (!joined && !(m.streaming && streaming)) {
                  return null;
                }
                return (
                  <div
                    key={`${m.id}-th-${unit.si}`}
                    className="lobe-timeline-rail"
                  >
                    <Thinking
                      locale={locale}
                      thinking={streaming}
                      content={joined}
                      streamingLabel={tr("chat.thinkingLabel")}
                      doneLabel={tr("chat.thoughtDone")}
                      thoughtForLabel={(n) => tr("chat.thoughtFor", { n })}
                      onOpenExternalLink={onOpenExternalLink}
                    />
                  </div>
                );
              }
              // content — never folded into a work phase
              const segBase = contentOccBase;
              if (findQuery.trim()) {
                contentOccBase += findChatMatches(findQuery, [
                  {
                    id: `${m.id}-seg-${unit.si}`,
                    role: "assistant",
                    content: unit.text,
                  },
                ]).length;
              }
              return (
                <AssistantMessageBody
                  key={`${m.id}-c-${unit.si}`}
                  content={unit.text}
                  attachments={
                    unit.si === lastContentSi ? m.attachments : undefined
                  }
                  streaming={unit.streaming}
                  locale={locale}
                  projectPath={projectPath}
                  sessionPathMap={sessionPathMap}
                  onOpenResource={onOpenResource}
                  onOpenExternalLink={onOpenExternalLink}
                  onAddAttachmentToComposer={onAddAttachmentToComposer}
                  attachLabels={attachLabels}
                  findQuery={findQuery}
                  findActiveOccurrence={
                    isFindCurrent ? findActiveOccurrence : null
                  }
                  findOccurrenceBase={segBase}
                />
              );
            });
          })()}
          {/* Body-less turn with only attachments */}
          {!contentSegCount && m.attachments?.length ? (
            <AssistantMessageBody
              content=""
              attachments={m.attachments}
              streaming={!!m.streaming}
              locale={locale}
              projectPath={projectPath}
              sessionPathMap={sessionPathMap}
              onOpenResource={onOpenResource}
              onOpenExternalLink={onOpenExternalLink}
              onAddAttachmentToComposer={onAddAttachmentToComposer}
              attachLabels={attachLabels}
              findQuery={findQuery}
              findActiveOccurrence={
                isFindCurrent ? findActiveOccurrence : null
              }
            />
          ) : null}
          {structuredOutputActive &&
          structuredOutputLabels &&
          (m.streaming || !!m.content.trim()) ? (
            <StructuredJsonPanel
              content={m.content}
              schemaText={structuredOutputSchema}
              labels={structuredOutputLabels}
              streaming={!!m.streaming}
              usage={showStructuredUsage ? structuredOutputUsage : null}
            />
          ) : null}
          {(() => {
            if (m.streaming || !showReplyLength) return null;
            const stats = computeMessageLength(m.content);
            if (stats.empty) return null;
            const words = String(stats.words);
            const chars = String(stats.chars);
            return (
              <div
                className="lobe-chat-reply-length"
                aria-label={tr("message.replyLengthAria", {
                  words,
                  chars,
                })}
              >
                {tr("message.replyLength", { words, chars })}
              </div>
            );
          })()}
        </div>
      }
      belowMessage={
        showLiveToolBelow && liveTool ? (
          <LiveToolText message={liveTool} locale={locale} />
        ) : null
      }
      actions={(() => {
        if (m.streaming) return null;
        const showCopy = !!m.content.trim();
        const showRegen = canRegenThis && !!onRegenerateAssistant;
        if (!showCopy && !showRegen) return null;
        const deepLink =
          sessionId != null ? formatMessageDeepLink(sessionId, m.id) : "";
        const showCopyLink = !!deepLink;
        if (!showCopy && !showRegen && !showCopyLink) return null;
        return (
          <>
            {showCopy ? (
              <>
                <MessageCopyButton
                  text={m.content}
                  copyLabel={tr("message.copy")}
                  copiedLabel={tr("message.copied")}
                />
                <MessageActionButton
                  label={tr("message.exportMd")}
                  onClick={() => {
                    const blob = new Blob([m.content], {
                      type: "text/markdown;charset=utf-8",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `grok-${m.id.slice(0, 8)}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <IconExportMd size={15} />
                </MessageActionButton>
              </>
            ) : null}
            {showCopyLink ? (
              <MessageCopyButton
                text={deepLink}
                copyLabel={tr("message.copyLink")}
                copiedLabel={tr("message.linkCopied")}
                idleIcon={<IconLink size={15} />}
              />
            ) : null}
            {showRegen ? (
              <MessageRegenerateButton
                label={tr("message.regenerate")}
                sameModelLabel={tr("message.regenerateSameModel")}
                pickModelLabel={tr("message.regeneratePickModel")}
                disabled={!canRegenerate}
                models={regenerateModels}
                currentModelId={regenerateModelId}
                onRegenerate={(modelId) => {
                  if (!canRegenerate) return;
                  onRegenerateAssistant?.(
                    m,
                    modelId ? { modelId } : undefined,
                  );
                }}
              />
            ) : null}
          </>
        );
      })()}
    />,
  );
}

export const TranscriptMessageRow = memo(
  TranscriptMessageRowInner,
  rowPropsEqual,
);
