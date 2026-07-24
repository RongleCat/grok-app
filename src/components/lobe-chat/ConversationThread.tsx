/**
 * LobeHub-aligned chat thread (pure CSS 1:1).
 * Replaces AI Elements / previous ConversationThread.
 */

import { memo, useMemo } from "react";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import {
  formatTurnErrorBody,
  messageSegments,
  type ChatMessage,
  type SessionState,
} from "@/lib/session";
import type { Attachment } from "@/lib/attachments";
import {
  buildInlineMediaPathMap,
  filterAttachmentsNotInlined,
  isImagePath,
  isMediaPath,
} from "@/lib/attachments";
import { AttachmentCard } from "@/components/AttachmentCard";
import type { ResourceOpenTarget } from "@/components/ResourceViewer";
import {
  IconArrowsMinimize,
  IconClock,
  IconExportMd,
  IconFork,
  IconPlan,
  IconRename,
  IconRewind,
} from "@/components/icons";
import { formatMessageTime } from "@/lib/accountUi";
import { formatTokenCount } from "@/lib/contextUsage";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import {
  MessageActionButton,
  MessageCopyButton,
} from "./MessageAction";
import { Button } from "@/components/ui/button";
import { ChatItem } from "./ChatItem";
import { MarkdownChat } from "./MarkdownChat";
import { Thinking } from "./Thinking";
import { BackBottom } from "./BackBottom";
import { InlineUserEdit } from "./InlineUserEdit";
import { SkillChip } from "@/components/SkillChip";
import { MarkdownBody } from "@/components/MarkdownBody";
import { hydrateDisplayContent, parseStoredContent } from "@/lib/draftDoc";
import { parseScheduledUserContent } from "@/lib/automations";
import { extractAutomationPayload } from "@/lib/automationSetup";
import { planDisplayMarkdown } from "@/lib/planBody";
import {
  isToolStepMessage,
  LiveToolText,
  pickRunningTurnTool,
  TurnCancelledRow,
} from "./AgentActivity";
import "./lobe-chat.css";

type AttachLabels = {
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
  onOpenResource,
  onAddAttachmentToComposer,
  attachLabels,
}: {
  content: string;
  attachments?: Attachment[];
  streaming?: boolean;
  locale: Locale;
  projectPath?: string | null;
  onOpenResource?: (target: ResourceOpenTarget) => void;
  onAddAttachmentToComposer?: (att: Attachment) => void;
  attachLabels: AttachLabels;
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
    return Object.keys(imagePathMap).length ? imagePathMap : undefined;
  }, [imagePathMap]);
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
function UserPlainOrSkills({ content }: { content: string }) {
  const hydrated = hydrateDisplayContent(content);
  const segs = parseStoredContent(hydrated);
  if (!segs.some((s) => s.type === "skill")) {
    return <>{content}</>;
  }
  return (
    <span className="user-msg-body">
      {segs.map((s, i) =>
        s.type === "skill" ? (
          <SkillChip key={`sk-${i}-${s.name}`} name={s.name} size="sm" />
        ) : (
          <span key={`t-${i}`}>{s.text}</span>
        ),
      )}
    </span>
  );
}

/**
 * User bubble: skill chips + scheduled-task header as a clock tag
 * (`[Scheduled: title]` → label, not raw brackets).
 */
function UserMessageBody({
  content,
  scheduledLabel,
}: {
  content: string;
  /** Short badge word, e.g. 已安排 / Scheduled */
  scheduledLabel: string;
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
          <span className="lobe-scheduled-tag__title">{scheduled.title}</span>
        </span>
        {scheduled.body.trim() ? (
          <div className="lobe-chat-user-msg__body">
            <UserPlainOrSkills content={scheduled.body} />
          </div>
        ) : null}
      </div>
    );
  }
  return <UserPlainOrSkills content={content} />;
}

export interface ConversationThreadProps {
  locale: Locale;
  messages: ChatMessage[];
  sessionState: SessionState;
  sessionKey?: string;
  projectPath?: string | null;
  /** When true, suppress generic empty copy (brand mark lives above composer). */
  suppressEmptyCopy?: boolean;
  /** Only the latest user message may be edited (idle session). */
  canEditLastUser?: boolean;
  lastUserMessageId?: string | null;
  /** Message currently being edited inline (id). */
  editingUserMessageId?: string | null;
  /** True while edit-resend is in flight (rewind + send). */
  editSubmitting?: boolean;
  /** Editable attachments for the open inline edit (reloaded from the message). */
  editAttachments?: Attachment[];
  onEditUserMessage?: (message: ChatMessage) => void;
  onCancelEditUserMessage?: () => void;
  onSubmitEditUserMessage?: (message: ChatMessage, content: string) => void;
  onRemoveEditAttachment?: (att: Attachment) => void;
  /** Idle session — allow rewind / fork from user bubbles. */
  canRewindSession?: boolean;
  onRewindToUserMessage?: (message: ChatMessage) => void;
  onForkFromUserMessage?: (message: ChatMessage) => void;
  onOpenResource?: (
    target: import("@/components/ResourceViewer").ResourceOpenTarget,
  ) => void;
  plan?: {
    visible: boolean;
    waiting: boolean;
    title: string;
    body: string;
    entries: unknown[];
    rpcId?: number | null;
  };
  onApprovePlan?: () => void;
  onRequestPlanChanges?: () => void;
  onDismissPlan?: () => void;
  /** Open full plan in the resource pane (preferred review surface). */
  onOpenPlanDetails?: () => void;
  onAddAttachmentToComposer?: (att: Attachment) => void;
  attachLabels: {
    open: string;
    reveal: string;
    copyPath: string;
    copyImage: string;
    addToComposer: string;
    remove: string;
  };
  /**
   * Epoch ms when current agent turn started.
   * Retained for callers; not rendered in the transcript.
   */
  turnStartedAt?: number | null;
}

export function ConversationThread({
  locale,
  messages,
  sessionState,
  sessionKey,
  projectPath,
  suppressEmptyCopy = false,
  canEditLastUser = false,
  lastUserMessageId = null,
  editingUserMessageId = null,
  editSubmitting = false,
  editAttachments = [],
  onEditUserMessage,
  onCancelEditUserMessage,
  onSubmitEditUserMessage,
  onRemoveEditAttachment,
  canRewindSession = false,
  onRewindToUserMessage,
  onForkFromUserMessage,
  onOpenResource,
  plan,
  onApprovePlan,
  onRequestPlanChanges,
  onDismissPlan,
  onOpenPlanDetails,
  onAddAttachmentToComposer,
  attachLabels,
}: ConversationThreadProps) {
  const tr = useMemo(() => createT(locale), [locale]);

  // Re-pin when user sends (even if they had scrolled up to read history).
  const forceStickKey = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") return messages[i]!.id;
    }
    return null;
  }, [messages]);

  const {
    viewportRef: scrollRef,
    contentRef,
    onScroll,
    scrollToBottom,
    showBack,
  } = useStickToBottom({
    conversationKey: sessionKey ?? "chat",
    forceStickKey,
  });

  const turnBusy =
    sessionState === "streaming" || sessionState === "awaiting_permission";

  /**
   * Live tool: only while a tool is running in this turn.
   * Completing a tool (or content resuming) clears it; next tool replaces.
   */
  const liveTool = useMemo(() => {
    if (!turnBusy) return null;
    return pickRunningTurnTool(messages);
  }, [messages, turnBusy]);

  /** Last assistant bubble after the latest user (anchor for mid-stream tool text). */
  const activeAssistantId = useMemo(() => {
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "user") {
        lastUser = i;
        break;
      }
    }
    let lastAssistantId: string | null = null;
    for (let i = lastUser + 1; i < messages.length; i++) {
      const m = messages[i]!;
      if (m.role === "assistant" && !m.isError) {
        lastAssistantId = m.id;
        if (m.streaming) return m.id;
      }
    }
    return turnBusy ? lastAssistantId : null;
  }, [messages, turnBusy]);

  const hasStreamingAssistant = messages.some(
    (m) => m.role === "assistant" && m.streaming,
  );

  // Quiet thinking when busy, no tool motion, no assistant yet.
  const showQuietThinking =
    turnBusy && !liveTool && !hasStreamingAssistant;

  const empty =
    messages.length === 0 &&
    !showQuietThinking &&
    !liveTool &&
    !turnBusy &&
    !plan?.visible;

  return (
    <div className="lobe-chat" data-slot="lobe-chat">
      <div
        ref={scrollRef}
        className="lobe-chat__scroll"
        onScroll={onScroll}
      >
        <div ref={contentRef} className="lobe-chat__inner">
          {empty && !suppressEmptyCopy ? (
            <div className="lobe-chat-empty">
              <h3 className="lobe-chat-empty__title">{tr("main.startTitle")}</h3>
              <p className="lobe-chat-empty__desc">{tr("main.startHint")}</p>
            </div>
          ) : null}

          {messages.map((m) => {
            if (
              m.marker === "turn_cancelled" ||
              (m.role === "tool" && m.content?.startsWith("turn_cancelled"))
            ) {
              return (
                <TurnCancelledRow key={m.id} message={m} locale={locale} />
              );
            }

            // Historical tool_step: never stack in transcript; live line is injected below.
            if (isToolStepMessage(m)) {
              return null;
            }

            if (
              m.marker === "context_compact" ||
              (m.role === "tool" &&
                (m.content?.startsWith("context_compact") ||
                  m.compactMeta))
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
                  before: formatTokenCount(meta.tokensBefore),
                  after: formatTokenCount(meta.tokensAfter),
                });
              } else if (meta?.note) {
                detail = meta.note;
              }
              const summary = meta?.summaryPreview?.trim();
              return (
                <div
                  key={m.id}
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
                </div>
              );
            }

            // Generic tool rows (non marker) — keep quiet; no history stack.
            if (m.role === "tool") {
              return null;
            }

            if (m.role === "user") {
              const isLastUser = lastUserMessageId === m.id;
              const isEditing = editingUserMessageId === m.id;
              const timeLabel = formatMessageTime(m.createdAt, locale);
              return (
                <ChatItem
                  key={m.id}
                  id={m.id}
                  placement="right"
                  showAvatar={false}
                  showTitle={false}
                  message={
                    <div
                      className={
                        "lobe-chat-user-stack" +
                        (isEditing ? " lobe-chat-user-stack--editing" : "")
                      }
                    >
                      {/* Read-only attachments above bubble; edit mode reloads them inside the form */}
                      {!isEditing &&
                      m.attachments &&
                      m.attachments.length > 0 ? (
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
                          onSubmit={(stored) =>
                            onSubmitEditUserMessage?.(m, stored)
                          }
                          onRemoveAttachment={onRemoveEditAttachment}
                        />
                      ) : m.content.trim() ? (
                        <div className="lobe-chat-bubble">
                          <UserMessageBody
                            content={m.content}
                            scheduledLabel={tr("automations.msgTag")}
                          />
                        </div>
                      ) : null}
                    </div>
                  }
                  actions={
                    isEditing ? null : (
                      <>
                        {timeLabel ? (
                          <span className="lobe-chat-action-time">
                            {timeLabel}
                          </span>
                        ) : null}
                        {m.content.trim() ? (
                          <MessageCopyButton
                            text={m.content}
                            copyLabel={tr("message.copy")}
                            copiedLabel={tr("message.copied")}
                          />
                        ) : null}
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
                        {onRewindToUserMessage ? (
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
                        {onForkFromUserMessage ? (
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
                />
              );
            }

            if (m.isError) {
              const friendly = formatTurnErrorBody(
                { content: m.content, code: undefined, message: undefined },
                locale === "en" ? "en" : "zh",
              );
              return (
                <div
                  key={m.id}
                  className="lobe-chat-error"
                  role="alert"
                  data-testid="chat-turn-error"
                >
                  <div className="lobe-chat-error__label">
                    {tr("chat.turnFailed")}
                  </div>
                  <div className="lobe-chat-error__body">{friendly}</div>
                </div>
              );
            }

            // Assistant — interleave thought / body in stream order (not all
            // thinking stacked above the answer).
            const segs = messageSegments(m);
            const thoughtSegs = segs.filter((s) => s.kind === "thought");
            const thoughtCount = thoughtSegs.length;
            const lastSeg = segs[segs.length - 1];
            const isActiveAssistant = activeAssistantId === m.id;
            const showLiveToolBelow = !!liveTool && isActiveAssistant;
            const showThinkingPlaceholder =
              !!m.streaming &&
              segs.length === 0 &&
              !showLiveToolBelow;

            const contentSegCount = segs.filter((s) => s.kind === "content")
              .length;
            let lastContentSi = -1;
            for (let i = segs.length - 1; i >= 0; i--) {
              if (segs[i]!.kind === "content") {
                lastContentSi = i;
                break;
              }
            }

            return (
              <ChatItem
                key={m.id}
                id={m.id}
                placement="left"
                showAvatar={false}
                loading={!!m.streaming}
                message={
                  <div className="lobe-chat-assistant-timeline">
                    {showThinkingPlaceholder ? (
                      <Thinking
                        locale={locale}
                        thinking
                        streamingLabel={tr("chat.thinking")}
                        doneLabel={tr("chat.thoughtDone")}
                        thoughtForLabel={(n) => tr("chat.thoughtFor", { n })}
                      />
                    ) : null}
                    {segs.map((seg, si) => {
                      if (seg.kind === "thought") {
                        // Skip empty finished phases (avoids "Thought for 0.0s").
                        if (
                          !seg.text.trim() &&
                          !(m.streaming && lastSeg === seg)
                        ) {
                          return null;
                        }
                        const thoughtIdx = segs
                          .slice(0, si + 1)
                          .filter((x) => x.kind === "thought").length;
                        const phaseStreaming =
                          !!m.streaming && lastSeg === seg;
                        const multi = thoughtCount > 1;
                        const label = multi
                          ? tr("plan.phaseLabel", { n: String(thoughtIdx) })
                          : tr("chat.thinking");
                        return (
                          <Thinking
                            key={`${m.id}-th-${si}`}
                            locale={locale}
                            thinking={phaseStreaming}
                            content={seg.text}
                            streamingLabel={label}
                            doneLabel={
                              multi
                                ? tr("plan.phaseLabel", {
                                    n: String(thoughtIdx),
                                  })
                                : tr("chat.thoughtDone")
                            }
                            thoughtForLabel={(n) =>
                              tr("chat.thoughtFor", { n })
                            }
                          />
                        );
                      }
                      return (
                        <AssistantMessageBody
                          key={`${m.id}-c-${si}`}
                          content={seg.text}
                          attachments={
                            si === lastContentSi ? m.attachments : undefined
                          }
                          streaming={!!m.streaming && lastSeg === seg}
                          locale={locale}
                          projectPath={projectPath}
                          onOpenResource={onOpenResource}
                          onAddAttachmentToComposer={
                            onAddAttachmentToComposer
                          }
                          attachLabels={attachLabels}
                        />
                      );
                    })}
                    {/* Body-less turn with only attachments */}
                    {!contentSegCount && m.attachments?.length ? (
                      <AssistantMessageBody
                        content=""
                        attachments={m.attachments}
                        streaming={!!m.streaming}
                        locale={locale}
                        projectPath={projectPath}
                        onOpenResource={onOpenResource}
                        onAddAttachmentToComposer={onAddAttachmentToComposer}
                        attachLabels={attachLabels}
                      />
                    ) : null}
                  </div>
                }
                belowMessage={
                  showLiveToolBelow && liveTool ? (
                    <LiveToolText message={liveTool} locale={locale} />
                  ) : null
                }
                actions={
                  !m.streaming && m.content.trim() ? (
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
                  ) : null
                }
              />
            );
          })}

          {/* Tool before any assistant bubble exists for this turn. */}
          {liveTool && !activeAssistantId ? (
            <LiveToolText message={liveTool} locale={locale} />
          ) : null}

          {showQuietThinking ? (
            <div className="lobe-chat-live-tool is-running" role="status">
              <span className="lobe-chat-live-tool__mark" aria-hidden>
                <span className="lobe-chat-thinking__dot lobe-chat-thinking__dot--live" />
              </span>
              <span className="lobe-chat-live-tool__title lobe-chat-live-tool__title--pulse">
                {tr("chat.thinking")}
              </span>
            </div>
          ) : null}

          {plan?.visible ? (
            <div className="lobe-chat-plan" data-plan-card>
              <div className="lobe-chat-plan__head">
                <IconPlan size={14} />
                <span className="lobe-chat-plan__status">
                  {plan.waiting && plan.rpcId == null
                    ? tr("plan.waiting")
                    : tr("plan.ready")}
                </span>
                <strong className="lobe-chat-plan__title">{plan.title}</strong>
              </div>
              <div className="lobe-chat-plan__body">
                {(() => {
                  const md = planDisplayMarkdown(plan.body, plan.entries);
                  if (!md) {
                    return (
                      <p className="lobe-chat-plan__empty">{tr("plan.empty")}</p>
                    );
                  }
                  return <MarkdownBody locale={locale}>{md}</MarkdownBody>;
                })()}
              </div>
              <div className="lobe-chat-plan__actions">
                {onOpenPlanDetails ? (
                  <Button type="button" onClick={onOpenPlanDetails}>
                    {tr("plan.openInResources")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={plan.rpcId == null}
                  onClick={onApprovePlan}
                >
                  {tr("plan.approve")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={plan.rpcId == null}
                  onClick={onRequestPlanChanges}
                >
                  {tr("plan.changes")}
                </Button>
                <Button type="button" variant="ghost" onClick={onDismissPlan}>
                  {tr("plan.dismiss")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <BackBottom
        visible={showBack}
        label={tr("chat.scrollBottom")}
        onClick={() => scrollToBottom("smooth")}
      />
    </div>
  );
}
