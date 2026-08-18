/**
 * LobeHub-aligned chat thread (pure CSS 1:1).
 * Replaces AI Elements / previous ConversationThread.
 *
 * Activity chrome: Grok.com Worked-for / tool rail (TimelinePhaseBlock + lobe-chat.css .grok-act).
 * Hard-reload the webview if CSS HMR misses a bulk style rewrite.
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import {
  formatTurnErrorBody,
  isToolInlinedInAssistants,
  lastRegenerableAssistantId,
  messageSegments,
  isTurnPromptMessage,
  weaveToolsIntoAssistantSegments,
  type ChatMessage,
  type MessageToolSegment,
  type SessionState,
} from "@/lib/session";
import {
  adjacentNode,
  buildSessionMessageNodes,
  estimateStartScrollTop,
  nodeById,
  type SessionMessageNode,
} from "@/lib/sessionMessageNodes";
import {
  formatMessageDeepLink,
  planScrollToMessage,
} from "@/lib/messageNodeDeepLink";
import { MessageNodeRail } from "./MessageNodeRail";
import { isEndOfTurnMarker } from "@/lib/endOfTurn";
import type { Attachment } from "@/lib/attachments";
import {
  buildInlineMediaPathMap,
  filterAttachmentsNotInlined,
  filterEchoedUserAttachments,
  isImagePath,
  isMediaPath,
  pathBasename,
} from "@/lib/attachments";
import {
  buildSessionFilePathMap,
  mergePathMaps,
} from "@/lib/sessionPathMap";
import { AttachmentCard } from "@/components/AttachmentCard";
import { ImageUi, imageUiLabels } from "@/components/ImageUi";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { UserAttachments } from "@/components/lobe-chat/UserAttachments";
import { TranscriptSelectionToolbar } from "@/components/TranscriptSelectionToolbar";
import { UserQuoteCards } from "@/components/ComposerQuoteCards";
import {
  parseQuotesFromContent,
  type ComposerQuote,
} from "@/lib/composerQuotes";
import type { ResourceOpenTarget } from "@/components/ResourceViewer";
import {
  IconArrowsMinimize,
  IconChat,
  IconClock,
  IconCopy,
  IconExportMd,
  IconFork,
  IconLink,
  IconPaperclip,
  IconRename,
  IconRewind,
  IconTarget,
} from "@/components/icons";
import { setDraft } from "@/lib/composerDraftStore";
import {
  clampThinkingStartToMessage,
  parseCreatedAtMs,
} from "@/lib/thinkingStartAnchor";
import { formatMessageTime, formatRelativeTime } from "@/lib/accountUi";
import type { MessageTimeFormat } from "@/lib/messageTimeFormatPref";
import { computeMessageLength } from "@/lib/messageLength";
import {
  formatCompactBeforeAfterRange,
  isContextCompactMessage,
} from "@/lib/contextUsage";
import type { ModelOption } from "@/lib/grokCatalog";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import { useChatMessageVirtualizer } from "@/hooks/useChatMessageVirtualizer";
import {
  estimateChatRowHeight,
  splitVirtSpacerHeights,
} from "@/lib/chatVirtualList";
import { StructuredJsonPanel } from "./StructuredJsonPanel";
import {
  MessageActionButton,
  MessageCopyButton,
  MessageRegenerateButton,
} from "./MessageAction";
import { ChatItem } from "./ChatItem";
import { MarkdownChat } from "./MarkdownChat";
import { LongAssistantSpillNote } from "./LongAssistantSpillNote";
import {
  previewLongAssistant,
  shouldSpillLongAssistant,
} from "@/lib/longAssistantSpill";
import { detectAppPlatform } from "@/lib/appPlatform";
import { Thinking } from "./Thinking";
import { LeadFragmentsStrip } from "./LeadFragmentsStrip";
import { BackBottom } from "./BackBottom";
import { InlineUserEdit } from "./InlineUserEdit";
import { SkillChip } from "@/components/SkillChip";
import { ChatRefChip } from "@/components/ChatRefChip";
import { useAttachedChatLookup } from "@/components/AttachedChatLookup";
import { HighlightedText } from "@/components/HighlightedText";
import { findChatMatches, findMatchesBeforeVisible } from "@/lib/chatFind";
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
  pickRunningTurnTool,
} from "./AgentActivity";
import { EndOfTurnChip } from "./EndOfTurnChip";
import {
  TimelineToolRow,
  TimelineToolGroup,
  toolSegmentFromMessage,
  toolSegmentIsRunning,
} from "./TimelineToolRow";
import { TimelinePhaseBlock } from "./TimelinePhaseBlock";
import {
  buildAssistantTimeline,
  shouldShowTrailingLiveThinking,
} from "@/lib/timelinePhases";
import { resolveChatTranscriptEmptyState } from "@/lib/chatTranscriptEmpty";
import { Spinner } from "@/components/ui/spinner";
import {
  BACK_BOTTOM_ALWAYS_CHANGE_EVENT,
  loadBackBottomAlwaysPref,
  shouldShowBackBottom,
} from "@/lib/backBottomAlwaysPref";
import {
  TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT,
  loadToolStepsAutoCollapsePref,
} from "@/lib/toolStepsAutoCollapsePref";
import {
  TRANSCRIPT_FILTER_CHANGE_EVENT,
  filterMessagesForTranscript,
  loadTranscriptFilterPref,
  shouldShowTranscriptToolChrome,
  type TranscriptFilterMode,
} from "@/lib/transcriptFilterPref";
import "./lobe-chat.css";

type AttachLabels = {
  open: string;
  reveal: string;
  copyPath: string;
  copyImage: string;
  addToComposer: string;
  remove: string;
};


/** Keep path-map object identity when tool paths did not change (stream text growth). */
function useStableSessionPathMap(
  messages: ChatMessage[],
  projectPath?: string | null,
): Record<string, string> {
  const prevRef = useRef<Record<string, string>>({});
  const next = useMemo(
    () => buildSessionFilePathMap(messages, projectPath),
    [messages, projectPath],
  );
  const prev = prevRef.current;
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (
    prevKeys.length === nextKeys.length &&
    nextKeys.every((k) => prev[k] === next[k])
  ) {
    return prev;
  }
  prevRef.current = next;
  return next;
}

/**
 * Assistant markdown + attachment cards.
 * Memoized so parent re-renders (showBack, live tool pulse, etc.) do not
 * rebuild imagePathMap / remount ImageUi frames mid-scroll.
 *
 * Path map is available on every content segment so `images/N.jpg` renders
 * inline at the stream position. Bottom strip only on the last segment, and
 * only for media not already cited in the full turn body.
 */
const AssistantMessageBody = memo(function AssistantMessageBody({
  content,
  messageId,
  attachments,
  /**
   * When false, still resolve pathMap from attachments for inline ImageUi,
   * but do not paint the bottom leftover strip (earlier timeline segments).
   */
  showBottomAttachments = true,
  /**
   * Full assistant body used to decide which attachments are already inlined
   * anywhere in the turn (not just this segment).
   */
  fullContentForInlineFilter,
  streaming,
  locale,
  projectPath,
  /** Session-level token→abs map (tool-touched files + unique tails). */
  sessionPathMap,
  onOpenResource,
  onOpenError,
  onOpenExternalLink,
  onAddAttachmentToComposer,
  attachLabels,
  findQuery,
  findActiveOccurrence,
  findOccurrenceBase = 0,
}: {
  content: string;
  /** Session message id — used to cache the spilled .txt path. */
  messageId?: string;
  attachments?: Attachment[];
  showBottomAttachments?: boolean;
  fullContentForInlineFilter?: string;
  streaming?: boolean;
  locale: Locale;
  projectPath?: string | null;
  sessionPathMap?: Record<string, string>;
  onOpenResource?: (target: ResourceOpenTarget) => void;
  onOpenError?: (message: string) => void;
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
  const bottomAtts = useMemo(() => {
    if (!showBottomAttachments) return undefined;
    const filterBody =
      fullContentForInlineFilter?.trim() ||
      displayContent ||
      content ||
      "";
    return filterAttachmentsNotInlined(filterBody, attachments);
  }, [
    showBottomAttachments,
    fullContentForInlineFilter,
    displayContent,
    content,
    attachments,
  ]);
  const pathMapProp = useMemo(() => {
    // Session tool paths first so short relatives (04-正文/正文.md) beat media
    // basename collisions; media map fills in image/video short tokens.
    const merged = mergePathMaps(imagePathMap, sessionPathMap);
    return Object.keys(merged).length ? merged : undefined;
  }, [imagePathMap, sessionPathMap]);
  const imageLabels = useMemo(() => imageUiLabels(locale), [locale]);
  const { bottomImages, bottomFiles, galleryPaths } = useMemo(() => {
    const list = bottomAtts ?? [];
    const images = list.filter((x) => !x.isDir && isImagePath(x.path));
    const files = list.filter((x) => x.isDir || !isImagePath(x.path));
    return {
      bottomImages: images,
      bottomFiles: files,
      galleryPaths: images.map((x) => x.path),
    };
  }, [bottomAtts]);
  const [showFullReply, setShowFullReply] = useState(false);
  if (
    !(displayContent || "").trim() &&
    !(bottomImages.length || bottomFiles.length)
  ) {
    return null;
  }

  const findActiveHere = !!findQuery?.trim();
  const canSpill =
    shouldSpillLongAssistant(
      (displayContent || "").length,
      detectAppPlatform(),
    ) && !findActiveHere;
  const spill = canSpill && !showFullReply;
  const markdownSource = spill
    ? previewLongAssistant(displayContent || "")
    : displayContent;

  const body = (displayContent || "").trim() ? (
    <MarkdownChat
      locale={locale}
      className="chat-md--answer"
      streaming={!!streaming}
      imagePathMap={pathMapProp}
      projectPath={projectPath}
      onOpenResource={onOpenResource}
      onOpenError={onOpenError}
      onOpenExternalLink={onOpenExternalLink}
      findQuery={findQuery}
      findActiveOccurrence={findActiveOccurrence}
      findOccurrenceBase={findOccurrenceBase}
    >
      {markdownSource}
    </MarkdownChat>
  ) : null;

  return (
    <>
      {body}
      {canSpill ? (
        <LongAssistantSpillNote
          fullText={displayContent || ""}
          streaming={!!streaming}
          locale={locale}
          messageId={messageId}
          projectPath={projectPath}
          expanded={showFullReply}
          onToggleExpanded={() => setShowFullReply((v) => !v)}
          onOpenResource={onOpenResource}
          onOpenError={onOpenError}
        />
      ) : null}
      {bottomImages.length > 0 ? (
        <div className="lobe-chat-atts lobe-chat-atts--images">
          {bottomImages.map((a) => (
            <ImageUi
              key={a.path}
              className="md-body__img md-body__img--card"
              src={a.path}
              alt={a.name || pathBasename(a.path)}
              path={a.path}
              gallery={galleryPaths}
              labels={imageLabels}
            />
          ))}
        </div>
      ) : null}
      {bottomFiles.length > 0 ? (
        <div className="lobe-chat-atts">
          {bottomFiles.map((a) => (
            <AttachmentCard
              key={a.path}
              attachment={a}
              variant={!a.isDir && isMediaPath(a.path) ? "card" : "chip"}
              labels={attachLabels}
              onAddToComposer={onAddAttachmentToComposer}
            />
          ))}
        </div>
      ) : null}
    </>
  );
});

function UserBodyText({
  content,
  findQuery,
  findActiveOccurrence,
}: {
  content: string;
  findQuery?: string;
  findActiveOccurrence?: number | null;
}) {
  const chatLookup = useAttachedChatLookup();
  const hydrated = hydrateDisplayContent(content);
  const segs = parseStoredContent(hydrated);
  if (!segs.some((s) => s.type === "skill" || s.type === "chat")) {
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
      {segs.map((s, i) => {
        if (s.type === "skill") {
          return <SkillChip key={`sk-${i}-${s.name}`} name={s.name} size="sm" />;
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
}

/** Render skill chips / plain text for the user bubble body. */
function UserPlainOrSkills({
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
  return (
    <>
      <UserQuoteCards
        quotes={quotes}
        countLabel={tr("composer.quoteCount", { n: String(quotes.length) })}
      />
      {body.trim() || !quotes.length ? (
        <UserBodyText
          content={body || (quotes.length ? "" : content)}
          findQuery={findQuery}
          findActiveOccurrence={findActiveOccurrence}
        />
      ) : null}
    </>
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
}

export interface ConversationThreadProps {
  locale: Locale;
  messages: ChatMessage[];
  sessionState: SessionState;
  sessionKey?: string;
  projectPath?: string | null;
  /** When true, suppress generic empty copy (brand mark lives above composer). */
  suppressEmptyCopy?: boolean;
  /** Selected session journal is still loading — not a fresh draft. */
  journalLoading?: boolean;
  /** Viewing an existing session (not a new draft). */
  hasExistingSession?: boolean;
  /** Viewing session journal has been read at least once this process. */
  journalHydrated?: boolean;
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
  /**
   * Regenerate last assistant reply (resend last user turn unchanged).
   * Gated like edit-last-user: idle session, last completed assistant only.
   * Optional `modelId` switches session model before resend when it differs.
   */
  canRegenerate?: boolean;
  onRegenerateAssistant?: (
    message: ChatMessage,
    opts?: { modelId?: string },
  ) => void;
  /** Live model catalog for regenerate-with-model menu (optional). */
  regenerateModels?: ModelOption[];
  /** Current composer/session model id (highlight + same-model baseline). */
  regenerateModelId?: string;
  /** Idle session — allow rewind / fork from user bubbles. */
  canRewindSession?: boolean;
  onRewindToUserMessage?: (message: ChatMessage) => void;
  onForkFromUserMessage?: (message: ChatMessage) => void;
  onOpenResource?: (
    target: import("@/components/ResourceViewer").ResourceOpenTarget,
  ) => void;
  /** File card soft-fail (missing / denied / host-only). */
  onOpenError?: (message: string) => void;
  /** Open external http(s) chat links (desktop shell + optional confirm). */
  onOpenExternalLink?: (url: string) => void;
  onAddAttachmentToComposer?: (att: Attachment) => void;
  /** Add a selected transcript excerpt as its own composer quote card. */
  onAddQuote?: (quote: {
    text: string;
    comment: string;
    sourceMessageId?: string;
  }) => void;
  attachLabels: {
    open: string;
    reveal: string;
    copyPath: string;
    copyImage: string;
    addToComposer: string;
    remove: string;
  };
  /**
   * Epoch ms when current agent turn / post-steer segment started.
   * Drives live Thinking chrome so remounts after mid-turn steer do not
   * collapse a long wait into “Thought for 1s”.
   */
  turnStartedAt?: number | null;
  /** In-chat find (Cmd/Ctrl+F) — highlight + scroll. */
  findQuery?: string;
  /** Message ids that contain at least one match. */
  findHitMessageIds?: ReadonlySet<string>;
  /** Active match target for scroll / current mark. */
  findActive?: { messageId: string; occurrence: number } | null;
  /**
   * Stored session id for copy-link deep hashes (`#/session/<id>/m/<mid>`).
   * Draft / new-chat leaves this null — copy link is hidden.
   */
  sessionId?: string | null;
  /**
   * External locate request (message deep link). Scrolls once when the
   * journal contains `messageId` (reuses rail virtualizer path).
   */
  locateMessageId?: string | null;
  /**
   * Fired once per locate attempt after messages are available
   * (success or soft-missing). Parent shows toast / clears pending.
   */
  onLocateMessage?: (result: {
    ok: boolean;
    messageId: string;
    reason?: "missing" | "empty_id";
  }) => void;
  /** Open session Changes panel (turn activity file strip). */
  onOpenSessionChanges?: () => void;
  /** Open a modified path from turn activity. */
  onOpenModifiedPath?: (path: string) => void;
  /**
   * When false, hide message time labels in action rows.
   * createdAt data is still kept on messages — UI only.
   * Default true.
   */
  showTimestamps?: boolean;
  /**
   * Absolute (weekday + clock) vs relative (“2 minutes ago”).
   * Relative mode re-renders on a 60s tick so labels stay fresh.
   */
  messageTimeFormat?: MessageTimeFormat;
  /**
   * When true, show muted word/char count under finished assistant replies.
   * Default false (Settings → Appearance → Show reply length).
   */
  showReplyLength?: boolean;
  /**
   * When true, assistant replies get a structured-output panel
   * (session JSON Schema mode): progressive parse + light schema check while
   * streaming, copy/export when complete.
   */
  structuredOutputActive?: boolean;
  /** Active session schema text for required-field validation. */
  structuredOutputSchema?: string | null;
  /**
   * Optional known token usage from agent events (session-level).
   * Shown only on the latest assistant turn — never invents zeros.
   */
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
}


type TranscriptMessageRowProps = {
  m: ChatMessage;
  msgIndex: number;
  virtualized: boolean;
  measureRef: (index: number) => (el: HTMLElement | null) => void;
  locale: Locale;
  tr: ReturnType<typeof createT>;
  projectPath?: string | null;
  sessionPathMap?: Record<string, string>;
  sessionId?: string | null;
  showToolChrome: boolean;
  toolStepsAutoCollapse: boolean;
  showTimestamps: boolean;
  messageTimeFormat: MessageTimeFormat;
  /** Bumps every minute when relative timestamps are on — busts row memo. */
  timeTick: number;
  showReplyLength: boolean;
  lastUserMessageId?: string | null;
  editingUserMessageId?: string | null;
  editSubmitting?: boolean;
  editAttachments: Attachment[];
  canEditLastUser: boolean;
  canRegenerate: boolean;
  /** Host still mid-turn — hide copy/MD/retry even if this row already settled. */
  turnLive: boolean;
  canRewindSession: boolean;
  regenerableAssistantId: string | null;
  regenerateModels: ModelOption[];
  regenerateModelId: string;
  activeAssistantId: string | null;
  liveTool: ReturnType<typeof pickRunningTurnTool>;
  wovenMessages: ChatMessage[];
  /** Consecutive unwoven standalone tool_step rows → merged group info. */
  standaloneToolGroups: ReadonlyMap<
    string,
    { key: string; tools: MessageToolSegment[]; first: boolean }
  >;
  findQuery: string;
  findHitMessageIds?: ReadonlySet<string>;
  findActive: { messageId: string; occurrence: number } | null;
  focusMessageId: string | null;
  structuredUsageMessageId: string | null;
  structuredOutputActive: boolean;
  structuredOutputSchema: string | null;
  structuredOutputUsage: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
  } | null;
  structuredOutputLabels?: ConversationThreadProps["structuredOutputLabels"];
  attachLabels: AttachLabels;
  onEditUserMessage?: ConversationThreadProps["onEditUserMessage"];
  onCancelEditUserMessage?: ConversationThreadProps["onCancelEditUserMessage"];
  onSubmitEditUserMessage?: ConversationThreadProps["onSubmitEditUserMessage"];
  onRemoveEditAttachment?: ConversationThreadProps["onRemoveEditAttachment"];
  onRegenerateAssistant?: ConversationThreadProps["onRegenerateAssistant"];
  onRewindToUserMessage?: ConversationThreadProps["onRewindToUserMessage"];
  onForkFromUserMessage?: ConversationThreadProps["onForkFromUserMessage"];
  onOpenResource?: ConversationThreadProps["onOpenResource"];
  onOpenError?: ConversationThreadProps["onOpenError"];
  onOpenExternalLink?: ConversationThreadProps["onOpenExternalLink"];
  onAddAttachmentToComposer?: ConversationThreadProps["onAddAttachmentToComposer"];
  /**
   * Epoch ms for live thinking on the active streaming assistant
   * (turn / post-steer clock). Null for finished rows.
   */
  thinkingStartedAt?: number | null;
};

function transcriptRowPropsEqual(
  a: TranscriptMessageRowProps,
  b: TranscriptMessageRowProps,
): boolean {
  if (a.m !== b.m) return false;
  if (a.msgIndex !== b.msgIndex) return false;
  if (a.virtualized !== b.virtualized) return false;
  if (a.locale !== b.locale) return false;
  if (a.projectPath !== b.projectPath) return false;
  if (a.sessionPathMap !== b.sessionPathMap) return false;
  if (a.sessionId !== b.sessionId) return false;
  if (a.showToolChrome !== b.showToolChrome) return false;
  if (a.toolStepsAutoCollapse !== b.toolStepsAutoCollapse) return false;
  if (a.showTimestamps !== b.showTimestamps) return false;
  if (a.messageTimeFormat !== b.messageTimeFormat) return false;
  if (a.timeTick !== b.timeTick) return false;
  if (a.showReplyLength !== b.showReplyLength) return false;
  if (a.lastUserMessageId !== b.lastUserMessageId) return false;
  if (a.editingUserMessageId !== b.editingUserMessageId) return false;
  if (a.editSubmitting !== b.editSubmitting) return false;
  if (a.editAttachments !== b.editAttachments) return false;
  if (a.canEditLastUser !== b.canEditLastUser) return false;
  if (a.canRegenerate !== b.canRegenerate) return false;
  if (a.turnLive !== b.turnLive) return false;
  if (a.canRewindSession !== b.canRewindSession) return false;
  if (a.regenerableAssistantId !== b.regenerableAssistantId) return false;
  if (a.regenerateModels !== b.regenerateModels) return false;
  if (a.regenerateModelId !== b.regenerateModelId) return false;
  if (a.activeAssistantId !== b.activeAssistantId) return false;
  if (a.liveTool !== b.liveTool) return false;
  if (a.wovenMessages !== b.wovenMessages) return false;
  if (a.standaloneToolGroups !== b.standaloneToolGroups) return false;
  if (a.findQuery !== b.findQuery) return false;
  if (a.findHitMessageIds !== b.findHitMessageIds) return false;
  if (a.findActive !== b.findActive) return false;
  if (a.focusMessageId !== b.focusMessageId) return false;
  if (a.structuredUsageMessageId !== b.structuredUsageMessageId) return false;
  if (a.structuredOutputActive !== b.structuredOutputActive) return false;
  if (a.structuredOutputSchema !== b.structuredOutputSchema) return false;
  if (a.structuredOutputUsage !== b.structuredOutputUsage) return false;
  if (a.structuredOutputLabels !== b.structuredOutputLabels) return false;
  if (a.attachLabels !== b.attachLabels) return false;
  if (a.thinkingStartedAt !== b.thinkingStartedAt) return false;
  return true;
}

const TranscriptMessageRow = memo(function TranscriptMessageRow({
  m,
  msgIndex,
  virtualized,
  measureRef,
  locale,
  tr,
  projectPath,
  sessionPathMap,
  sessionId = null,
  showToolChrome,
  toolStepsAutoCollapse,
  showTimestamps,
  messageTimeFormat,
  timeTick: _timeTick,
  showReplyLength,
  lastUserMessageId = null,
  editingUserMessageId = null,
  editSubmitting = false,
  editAttachments,
  canEditLastUser,
  canRegenerate,
  turnLive,
  canRewindSession,
  regenerableAssistantId,
  regenerateModels,
  regenerateModelId,
  activeAssistantId,
  liveTool,
  wovenMessages,
  standaloneToolGroups,
  findQuery,
  findHitMessageIds,
  findActive,
  focusMessageId,
  thinkingStartedAt = null,
  structuredUsageMessageId,
  structuredOutputActive,
  structuredOutputSchema,
  structuredOutputUsage,
  structuredOutputLabels,
  attachLabels,
  onEditUserMessage,
  onCancelEditUserMessage,
  onSubmitEditUserMessage,
  onRemoveEditAttachment,
  onRegenerateAssistant,
  onRewindToUserMessage,
  onForkFromUserMessage,
  onOpenResource,
  onOpenError,
  onOpenExternalLink,
  onAddAttachmentToComposer,
}: TranscriptMessageRowProps) {
  void _timeTick;
  const wrap = (node: ReactNode) =>
    virtualized ? (
      <div
        key={m.id}
        ref={measureRef(msgIndex)}
        data-virt-index={msgIndex}
      >
        {node}
      </div>
    ) : (
      node
    );

  if (
    isEndOfTurnMarker(m.marker) ||
    m.marker === "turn_cancelled" ||
    (m.role === "tool" &&
      (m.content?.startsWith("turn_cancelled") ||
        m.content?.startsWith("turn_end|")))
  ) {
    return wrap(
      <EndOfTurnChip key={m.id} message={m} locale={locale} />,
    );
  }

  // Standalone tool_step only when not already woven into an assistant
  // timeline (tools before first assistant bubble, edge cases).
  // Conversation filter hides tool chrome entirely.
  if (isToolStepMessage(m)) {
    if (!showToolChrome) {
      return virtualized ? (
        <div
          key={m.id}
          ref={measureRef(msgIndex)}
          data-virt-index={msgIndex}
          style={{ height: 0, overflow: "hidden" }}
          aria-hidden
        />
      ) : null;
    }
    const tcid =
      (m.toolCallId || "").trim() ||
      (m.id.startsWith("tool-") ? m.id.slice(5) : "");
    // Use woven list — parent `messages` may lag display-layer weave.
    if (tcid && isToolInlinedInAssistants(wovenMessages, tcid)) {
      return virtualized ? (
        <div
          key={m.id}
          ref={measureRef(msgIndex)}
          data-virt-index={msgIndex}
          style={{ height: 0, overflow: "hidden" }}
          aria-hidden
        />
      ) : null;
    }
    const toolSeg = toolSegmentFromMessage(m);
    if (!toolSeg) {
      return virtualized ? (
        <div
          key={m.id}
          ref={measureRef(msgIndex)}
          data-virt-index={msgIndex}
          style={{ height: 0, overflow: "hidden" }}
          aria-hidden
        />
      ) : null;
    }
    // Consecutive unwoven standalone tool_step rows merge into one
    // collapsible group (painted at the first row; the rest become
    // zero-height spacers so virtualization stays consistent).
    const standaloneGroup = standaloneToolGroups.get(m.id);
    if (standaloneGroup) {
      if (!standaloneGroup.first) {
        return virtualized ? (
          <div
            key={m.id}
            ref={measureRef(msgIndex)}
            data-virt-index={msgIndex}
            style={{ height: 0, overflow: "hidden" }}
            aria-hidden
          />
        ) : null;
      }
      return wrap(
        <div key={m.id} className="lobe-chat-assistant-timeline">
          <div className="lobe-timeline-rail">
            <TimelineToolGroup
              tools={standaloneGroup.tools}
              autoCollapse={toolStepsAutoCollapse}
              locale={locale}
            />
          </div>
        </div>,
      );
    }
    return wrap(
      <div key={m.id} className="lobe-chat-assistant-timeline">
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

  if (isContextCompactMessage(m)) {
    const meta = m.compactMeta;
    const auto = (meta?.trigger || "auto") !== "manual";
    const title = auto
      ? tr("compact.bannerAuto")
      : tr("compact.bannerManual");
    // Honest before→after when either side is known; never invent a pair.
    let detail =
      formatCompactBeforeAfterRange(meta?.tokensBefore, meta?.tokensAfter, {
        locale,
        template: tr("compact.tokensRange"),
      }) ?? "";
    if (!detail && meta?.note) {
      detail = meta.note;
    }
    const summary = meta?.summaryPreview?.trim();
    return wrap(
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
      </div>,
    );
  }

  // Generic tool rows (non marker) — keep quiet; no history stack.
  if (m.role === "tool") {
    return virtualized ? (
      <div
        key={m.id}
        ref={measureRef(msgIndex)}
        data-virt-index={msgIndex}
        style={{ height: 0, overflow: "hidden" }}
        aria-hidden
      />
    ) : null;
  }

  if (m.role === "user") {
    const isInterjection = m.marker === "interjection";
    const isLastUser = !isInterjection && lastUserMessageId === m.id;
    const isEditing = editingUserMessageId === m.id;
    const timeLabel =
      showTimestamps && m.createdAt
        ? messageTimeFormat === "relative"
          ? formatRelativeTime(m.createdAt, locale)
          : formatMessageTime(m.createdAt, locale)
        : null;
    const isFindHit = !!findHitMessageIds?.has(m.id);
    const isFindCurrent = findActive?.messageId === m.id;
    const isNodeFocus = focusMessageId === m.id;
    return wrap(
      <ChatItem
        key={m.id}
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
            {!isEditing &&
            m.attachments &&
            m.attachments.length > 0 ? (
              <UserAttachments
                attachments={m.attachments}
                labels={attachLabels}
                onAddToComposer={onAddAttachmentToComposer}
                moreLabel={(n) => tr("attach.showMore", { n: String(n) })}
                lessLabel={tr("attach.showLess")}
              />
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
              <div
                className={
                  "lobe-chat-bubble" +
                  (isInterjection
                    ? " lobe-chat-bubble--interjection"
                    : "")
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
                    isFindCurrent
                      ? (findActive?.occurrence ?? null)
                      : null
                  }
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
              {sessionId
                ? (() => {
                    const link = formatMessageDeepLink(
                      sessionId,
                      m.id,
                    );
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
    const isFindHit = !!findHitMessageIds?.has(m.id);
    const isFindCurrent = findActive?.messageId === m.id;
    const isNodeFocus = focusMessageId === m.id;
    const canRegenError =
      !!onRegenerateAssistant && regenerableAssistantId === m.id;
    // Codex-style soft notice — muted pill, no red box.
    return wrap(
      <div
        key={m.id}
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
                  isFindCurrent
                    ? (findActive?.occurrence ?? null)
                    : null
                }
              />
            ) : (
              friendly
            )}
          </span>
          {canRegenError ? (
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
  let precedingUserAtts: typeof m.attachments;
  for (let i = msgIndex - 1; i >= 0; i--) {
    const row = wovenMessages[i];
    if (row?.role === "user") {
      precedingUserAtts = row.attachments;
      break;
    }
  }
  const displayAttachments = filterEchoedUserAttachments(
    m.attachments,
    precedingUserAtts,
  );
  const isActiveAssistant = activeAssistantId === m.id;
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

  const isFindHit = !!findHitMessageIds?.has(m.id);
  const isFindCurrent = findActive?.messageId === m.id;
  const isNodeFocus = focusMessageId === m.id;
  // Phase projection: thought+tools collapse when phase ends (content
  // / next thought), not only when the full answer is done.
  const timelineUnits = buildAssistantTimeline(segs, {
    streaming: !!m.streaming,
  });
  // Live chrome follows the *current* episode (trailing thought / phase),
  // not “this message already has some body text”. Grok 4.x think→tool
  // loops keep reasoning after the first status sentence.
  const showTrailingThinking = shouldShowTrailingLiveThinking(timelineUnits, {
    messageStreaming: !!m.streaming,
    hasRunningTool: hasInlinedRunningTool || !!showLiveToolBelow,
  });

  return wrap(
    <ChatItem
      key={m.id}
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
            <div
              key={`${m.id}-thinking-live`}
              className="lobe-timeline-rail"
            >
              <Thinking
                locale={locale}
                thinking
                startedAt={thinkingStartedAt}
              />
            </div>
          ) : null}
          {m.leadFragments?.length ? (
            <LeadFragmentsStrip
              fragments={m.leadFragments}
              locale={locale}
              onOpenExternalLink={onOpenExternalLink}
            />
          ) : null}
          {(() => {
            // Running occurrence base across content segments so
            // find marks stay aligned with message-level match index.
            // Hits in the folded process prefix of m.content must be skipped
            // so the conclusion highlight uses the same occurrence as Cmd+F.
            const lastVisibleContent = (() => {
              for (let i = timelineUnits.length - 1; i >= 0; i--) {
                const u = timelineUnits[i]!;
                if (u.kind === "content") return u.text;
              }
              return "";
            })();
            let contentOccBase = findMatchesBeforeVisible({
              full: m.content ?? "",
              visible: lastVisibleContent,
              query: findQuery,
            });
            // First bare thought uses a stable live key for the whole episode
            // (placeholder → tokens → done) so the wall clock does not reset.
            const primaryThoughtSi = (() => {
              for (const u of timelineUnits) {
                if (u.kind === "thought" || u.kind === "thought-group") {
                  return u.si;
                }
              }
              return null;
            })();
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
                    findQuery={findQuery}
                    findActiveOccurrence={
                      isFindCurrent
                        ? (findActive?.occurrence ?? null)
                        : null
                    }
                    messageContent={m.content}
                    onOpenExternalLink={onOpenExternalLink}
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
              if (
                unit.kind === "thought" ||
                unit.kind === "thought-group"
              ) {
                const texts =
                  unit.kind === "thought-group"
                    ? unit.texts
                    : [unit.text];
                const joined = texts
                  .map((t) => t.trim())
                  .filter(Boolean)
                  .join("\n\n");
                const streaming = unit.streaming;
                if (
                  !joined &&
                  !(m.streaming && streaming)
                ) {
                  return null;
                }
                // Stable live key for the primary thought: empty placeholder →
                // tokens → done must not remount (that reset the clock to “1s”).
                const isPrimary =
                  primaryThoughtSi != null && unit.si === primaryThoughtSi;
                const thinkKey = isPrimary
                  ? `${m.id}-thinking-live`
                  : `${m.id}-th-${unit.si}`;
                return (
                  <div
                    key={thinkKey}
                    className="lobe-timeline-rail"
                  >
                    <Thinking
                      locale={locale}
                      // Live = this episode is still the trailing stream
                      // (unit.streaming). Earlier body text must not freeze it.
                      thinking={!!m.streaming && !!streaming}
                      content={joined}
                      startedAt={
                        isPrimary || streaming ? thinkingStartedAt : null
                      }
                      onOpenExternalLink={onOpenExternalLink}
                    />
                  </div>
                );
              }
              // content — conclusion stays outside the work fold
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
                  messageId={m.id}
                  content={unit.text}
                  // Always pass attachments so every content segment can
                  // resolve `images/N.jpg` → ImageUi at stream position.
                  attachments={displayAttachments}
                  // Bottom leftover strip only once (end of turn body).
                  showBottomAttachments={unit.si === lastContentSi}
                  fullContentForInlineFilter={m.content}
                  streaming={unit.streaming}
                  locale={locale}
                  projectPath={projectPath}
                  sessionPathMap={sessionPathMap}
                  onOpenResource={onOpenResource}
                  onOpenError={onOpenError}
                  onOpenExternalLink={onOpenExternalLink}
                  onAddAttachmentToComposer={
                    onAddAttachmentToComposer
                  }
                  attachLabels={attachLabels}
                  findQuery={findQuery}
                  findActiveOccurrence={
                    isFindCurrent
                      ? (findActive?.occurrence ?? null)
                      : null
                  }
                  findOccurrenceBase={segBase}
                />
              );
            });
          })()}
          {showTrailingThinking ? (
            <div
              key={`${m.id}-thinking-trail`}
              className="lobe-timeline-rail"
              data-testid="thinking-trail"
            >
              <Thinking
                locale={locale}
                thinking
                startedAt={thinkingStartedAt}
              />
            </div>
          ) : null}
          {/* Body-less turn with only attachments */}
          {!contentSegCount && displayAttachments?.length ? (
            <AssistantMessageBody
              content=""
              messageId={m.id}
              attachments={displayAttachments}
              showBottomAttachments
              fullContentForInlineFilter={m.content}
              streaming={!!m.streaming}
              locale={locale}
              projectPath={projectPath}
              sessionPathMap={sessionPathMap}
              onOpenResource={onOpenResource}
              onOpenError={onOpenError}
              onOpenExternalLink={onOpenExternalLink}
              onAddAttachmentToComposer={onAddAttachmentToComposer}
              attachLabels={attachLabels}
              findQuery={findQuery}
              findActiveOccurrence={
                isFindCurrent
                  ? (findActive?.occurrence ?? null)
                  : null
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
              usage={
                m.id === structuredUsageMessageId
                  ? structuredOutputUsage
                  : null
              }
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
        if (m.streaming || turnLive) return null;
        const showCopy = !!m.content.trim();
        const showRegen =
          !!onRegenerateAssistant && regenerableAssistantId === m.id;
        if (!showCopy && !showRegen) return null;
        const deepLink =
          sessionId != null
            ? formatMessageDeepLink(sessionId, m.id)
            : "";
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
}, transcriptRowPropsEqual);

export function ConversationThread({
  locale,
  messages,
  sessionState,
  sessionKey,
  projectPath,
  suppressEmptyCopy = false,
  journalLoading = false,
  hasExistingSession = false,
  journalHydrated,
  canEditLastUser = false,
  lastUserMessageId = null,
  editingUserMessageId = null,
  editSubmitting = false,
  editAttachments = [],
  onEditUserMessage,
  onCancelEditUserMessage,
  onSubmitEditUserMessage,
  onRemoveEditAttachment,
  canRegenerate = false,
  onRegenerateAssistant,
  regenerateModels = [],
  regenerateModelId = "",
  canRewindSession = false,
  onRewindToUserMessage,
  onForkFromUserMessage,
  onOpenResource,
  onOpenError,
  onOpenExternalLink,
  onAddAttachmentToComposer,
  onAddQuote,
  attachLabels,
  findQuery = "",
  findHitMessageIds,
  findActive = null,
  sessionId = null,
  locateMessageId = null,
  onLocateMessage,
  onOpenSessionChanges: _onOpenSessionChanges,
  onOpenModifiedPath: _onOpenModifiedPath,
  showTimestamps = true,
  messageTimeFormat = "absolute",
  showReplyLength = false,
  structuredOutputActive = false,
  structuredOutputSchema = null,
  structuredOutputUsage = null,
  structuredOutputLabels,
  turnStartedAt = null,
}: ConversationThreadProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  void _onOpenSessionChanges;
  void _onOpenModifiedPath;

  /** Re-render relative labels roughly once a minute. */
  const [relativeTick, setRelativeTick] = useState(0);
  useEffect(() => {
    if (!showTimestamps || messageTimeFormat !== "relative") return;
    const id = window.setInterval(() => {
      setRelativeTick((n) => n + 1);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [showTimestamps, messageTimeFormat]);
  // Keep tick in the render graph so interval updates recompute labels.
  void relativeTick;

  /**
   * Force stick-to-bottom when a new user turn starts **and** when the turn
   * becomes busy (streaming / permission). Key must not change when the turn
   * ends, or a user who scrolled up mid-stream would be yanked back.
   */
  const prevTurnBusyRef = useRef(false);
  const [stickBump, setStickBump] = useState(0);
  const turnBusyForStick =
    sessionState === "streaming" || sessionState === "awaiting_permission";
  useEffect(() => {
    if (turnBusyForStick && !prevTurnBusyRef.current) {
      // Task just started → re-enter auto-follow once.
      setStickBump((n) => n + 1);
    }
    prevTurnBusyRef.current = turnBusyForStick;
  }, [turnBusyForStick]);

  const forceStickKey = useMemo(() => {
    let lastUserId: string | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") {
        lastUserId = messages[i]!.id;
        break;
      }
    }
    if (!lastUserId && stickBump === 0) return null;
    // stickBump only increments on busy edge — end-of-turn leaves it stable.
    return `${lastUserId ?? "turn"}:${stickBump}`;
  }, [messages, stickBump]);

  /** Last non-streaming assistant in the current user turn — regenerate target. */
  const regenerableAssistantId = useMemo(
    () => lastRegenerableAssistantId(messages),
    [messages],
  );

  /**
   * Latest assistant body message — only this turn shows known usage on the
   * structured panel (session-level usage is not attributed to older turns).
   */
  const structuredUsageMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m || m.role !== "assistant") continue;
      if (m.marker) continue;
      return m.id;
    }
    return null;
  }, [messages]);

  const {
    viewportRef: scrollRef,
    contentRef,
    onScroll: onStickScroll,
    scrollToBottom,
    isPinnedRef,
    showBack,
  } = useStickToBottom({
    conversationKey: sessionKey ?? "chat",
    forceStickKey,
  });

  const [backBottomAlways, setBackBottomAlways] = useState(() =>
    loadBackBottomAlwaysPref(),
  );
  useEffect(() => {
    const onPref = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (typeof detail === "boolean") setBackBottomAlways(detail);
      else setBackBottomAlways(loadBackBottomAlwaysPref());
    };
    window.addEventListener(BACK_BOTTOM_ALWAYS_CHANGE_EVENT, onPref);
    return () =>
      window.removeEventListener(BACK_BOTTOM_ALWAYS_CHANGE_EVENT, onPref);
  }, []);
  const backBottomVisible = shouldShowBackBottom(backBottomAlways, showBack);

  /** Finished tool steps start collapsed when true (default). */
  const [toolStepsAutoCollapse, setToolStepsAutoCollapse] = useState(() =>
    loadToolStepsAutoCollapsePref(),
  );
  useEffect(() => {
    const onPref = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (typeof detail === "boolean") setToolStepsAutoCollapse(detail);
      else setToolStepsAutoCollapse(loadToolStepsAutoCollapsePref());
    };
    window.addEventListener(TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT, onPref);
    return () =>
      window.removeEventListener(TOOL_STEPS_AUTO_COLLAPSE_CHANGE_EVENT, onPref);
  }, []);

  /** all | conversation — hide tool_step rows / tool chrome when conversation. */
  const [transcriptFilter, setTranscriptFilter] =
    useState<TranscriptFilterMode>(() => loadTranscriptFilterPref());
  useEffect(() => {
    const onPref = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (detail === "all" || detail === "conversation") {
        setTranscriptFilter(detail);
      } else {
        setTranscriptFilter(loadTranscriptFilterPref());
      }
    };
    window.addEventListener(TRANSCRIPT_FILTER_CHANGE_EVENT, onPref);
    return () =>
      window.removeEventListener(TRANSCRIPT_FILTER_CHANGE_EVENT, onPref);
  }, []);
  const showToolChrome = shouldShowTranscriptToolChrome(transcriptFilter);

  /**
   * Transcript selection context menu (正文区域): right-click with text
   * selected opens the app ContextMenu (same visual baseline as attachment
   * cards) with Copy / Paste / Add-to-input. No selection → nothing (native
   * menu is already suppressed globally).
   */
  const [selectionMenu, setSelectionMenu] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const [selectionBar, setSelectionBar] = useState<{
    x: number;
    y: number;
    text: string;
    sourceMessageId?: string;
  } | null>(null);
  const [selectionComment, setSelectionComment] = useState("");
  const selectionBarText = selectionBar?.text;
  useEffect(() => {
    setSelectionComment("");
  }, [selectionBarText]);

  const copyText = useCallback((text: string) => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        } catch {
          /* ignore */
        }
      }
    })();
  }, []);

  const closeSelectionUi = useCallback(() => {
    setSelectionBar(null);
    setSelectionMenu(null);
    setSelectionComment("");
  }, []);

  useEffect(() => {
    closeSelectionUi();
  }, [sessionId, closeSelectionUi]);

  const addQuoteFromSelection = useCallback(
    (text: string, comment: string, sourceMessageId?: string) => {
      const excerpt = text.trim();
      if (!excerpt) return;
      if (onAddQuote) {
        onAddQuote({ text: excerpt, comment: comment.trim(), sourceMessageId });
      } else {
        setDraft((prev) => {
          if (!prev) return excerpt;
          return /\s$/.test(prev) ? prev + excerpt : prev + "\n\n" + excerpt;
        });
      }
      closeSelectionUi();
      window.getSelection()?.removeAllRanges();
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(".composer__input");
        if (!el || el.getAttribute("contenteditable") === "false") return;
        el.focus({ preventScroll: false });
      });
    },
    [onAddQuote, closeSelectionUi],
  );

  const onTranscriptContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const sel = window.getSelection();
      if (!sel) return;
      const text = sel.toString().trim();
      if (!text) return;
      // Only when the selection lives inside this transcript viewport.
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;
      const anchor = sel.anchorNode;
      const focus = sel.focusNode;
      const inside =
        (anchor != null && scrollEl.contains(anchor)) ||
        (focus != null && scrollEl.contains(focus));
      if (!inside) return;
      e.preventDefault();
      e.stopPropagation();
      setSelectionMenu({ x: e.clientX, y: e.clientY, text });
    },
    [],
  );

  const selectionMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!selectionMenu) return [];
    const selText = selectionMenu.text;
    return [
      {
        id: "sel-copy",
        label: tr("chat.selectionCopy"),
        icon: <IconCopy size={16} />,
        onClick: () => copyText(selText),
      },
      {
        id: "sel-add-input",
        label: tr("chat.selectionAddToInput"),
        icon: <IconPaperclip size={16} />,
        onClick: () => addQuoteFromSelection(selText, ""),
      },
    ];
  }, [selectionMenu, tr, copyText, addQuoteFromSelection]);

  const readTranscriptSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const text = sel.toString().replace(/\u00a0/g, " ").trim();
    if (!text) return null;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return null;
    const anchor = sel.anchorNode;
    const focus = sel.focusNode;
    const inside =
      (anchor != null && scrollEl.contains(anchor)) ||
      (focus != null && scrollEl.contains(focus));
    if (!inside) return null;
    let sourceMessageId: string | undefined;
    let node: Node | null = anchor;
    while (node && node !== scrollEl) {
      if (node instanceof HTMLElement) {
        const id = node.getAttribute("data-message-id");
        if (id) {
          sourceMessageId = id;
          break;
        }
      }
      node = node.parentNode;
    }
    let rect: DOMRect | null = null;
    if (sel.rangeCount > 0) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width || r.height) rect = r;
    }
    return { text, sourceMessageId, rect };
  }, []);

  useEffect(() => {
    const showBar = (next: {
      text: string;
      sourceMessageId?: string;
      rect: DOMRect | null;
    }) => {
      const x = next.rect
        ? next.rect.left + next.rect.width / 2 - 140
        : 24;
      const y = next.rect ? next.rect.bottom + 8 : 24;
      setSelectionBar({
        x,
        y,
        text: next.text,
        sourceMessageId: next.sourceMessageId,
      });
    };
    const onSel = () => {
      const next = readTranscriptSelection();
      // Focusing the comment box collapses the native selection — keep the bar.
      if (!next) return;
      showBar(next);
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const next = readTranscriptSelection();
      if (next) showBar(next);
    };
    document.addEventListener("selectionchange", onSel);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("selectionchange", onSel);
      document.removeEventListener("mouseup", onUp);
    };
  }, [readTranscriptSelection]);

  useEffect(() => {
    if (!selectionBar) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(".sel-toolbar")) return;
      closeSelectionUi();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [selectionBar, closeSelectionUi]);

  const messageNodes = useMemo(
    () => buildSessionMessageNodes(messages),
    [messages],
  );
  /**
   * Display-layer weave + paint list (early): journal reload can leave
   * tool_step rows outside assistant.segments; stitch before paint. Defined
   * here so rail coarse-scroll estimates share the virtualizer row list
   * (filtered transcript), not full journal indices.
   * `conversation` filter also drops standalone tool_step rows.
   */
  const wovenMessages = useMemo(
    () => weaveToolsIntoAssistantSegments(messages),
    [messages],
  );
  const transcriptMessages = useMemo(
    () => filterMessagesForTranscript(wovenMessages, transcriptFilter),
    [wovenMessages, transcriptFilter],
  );
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [locateTargetId, setLocateTargetId] = useState<string | null>(null);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const focusClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locateClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const locateRafRef = useRef<number | null>(null);
  /** While set, scroll-sync must not overwrite the rail cursor (nav in flight). */
  const navLockUntilRef = useRef(0);
  /**
   * Authoritative cursor for prev/next. Updated by programmatic jumps and by
   * MessageNodeRail free-scroll via onScrollActiveChange (ref only — no
   * parent setState on every scroll frame; #280).
   */
  const railCursorRef = useRef<string | null>(null);

  const onRailScrollActiveChange = useCallback((id: string) => {
    // Ignore free-scroll updates while a programmatic jump is in flight.
    if (performance.now() < navLockUntilRef.current) return;
    railCursorRef.current = id;
  }, []);

  const onScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      onStickScroll(e);
      // Do NOT setActiveNodeId here — MessageNodeRail owns free-scroll highlight (#280).
    },
    [onStickScroll],
  );

  const applyScrollToNodeDom = useCallback(
    (node: SessionMessageNode, attempt = 0) => {
      const viewport = scrollRef.current;
      if (!viewport) return;

      const root = viewport.querySelector(
        `[data-message-id="${CSS.escape(node.id)}"]`,
      ) as HTMLElement | null;

      if (!root) {
        // Virtual window may still be mounting the forced row.
        if (attempt < 8) {
          locateRafRef.current = window.requestAnimationFrame(() => {
            locateRafRef.current = null;
            applyScrollToNodeDom(node, attempt + 1);
          });
        }
        return;
      }

      // Align to the upper band so tall previous messages leave the focus line.
      // Instant first — smooth often no-ops when the row is already partially on screen.
      root.scrollIntoView({ block: "start", behavior: "instant" });
      // Nudge: keep a small top inset so the bubble isn't under chrome.
      const vr = viewport.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      const desiredTop = vr.top + Math.min(48, viewport.clientHeight * 0.1);
      const delta = rr.top - desiredTop;
      if (Math.abs(delta) > 2) {
        viewport.scrollTop += delta;
      }

      if (locateClearTimerRef.current) clearTimeout(locateClearTimerRef.current);
      // Keep force-mount until layout + scroll settle (virtual list).
      locateClearTimerRef.current = setTimeout(() => {
        setLocateTargetId((cur) => (cur === node.id ? null : cur));
        locateClearTimerRef.current = null;
        // Release nav lock shortly after so free scroll can update the rail.
        navLockUntilRef.current = performance.now() + 120;
      }, 700);
    },
    [scrollRef],
  );

  const scrollToMessageNode = useCallback(
    (node: SessionMessageNode) => {
      const viewport = scrollRef.current;
      if (!viewport) return;

      // Leave stick-to-bottom so programmatic jumps are not yanked back.
      isPinnedRef.current = false;

      railCursorRef.current = node.id;
      navLockUntilRef.current = performance.now() + 1200;
      setLocateTargetId(node.id);
      setActiveNodeId(node.id);
      setFocusMessageId(node.id);
      if (focusClearTimerRef.current) clearTimeout(focusClearTimerRef.current);
      focusClearTimerRef.current = setTimeout(() => {
        setFocusMessageId((cur) => (cur === node.id ? null : cur));
        focusClearTimerRef.current = null;
      }, 1600);

      // Coarse jump via the paint list so estimates match the virtualizer.
      // node.messageIndex is journal-space; tool rows may be filtered out.
      const paintIndex = transcriptMessages.findIndex((m) => m.id === node.id);
      const approx =
        paintIndex >= 0
          ? estimateStartScrollTop(
              transcriptMessages,
              paintIndex,
              viewport.clientHeight,
            )
          : estimateStartScrollTop(
              messages,
              node.messageIndex,
              viewport.clientHeight,
            );
      const prevBehavior = viewport.style.scrollBehavior;
      viewport.style.scrollBehavior = "auto";
      viewport.scrollTop = approx;
      if (prevBehavior) viewport.style.scrollBehavior = prevBehavior;
      else viewport.style.removeProperty("scroll-behavior");

      if (locateRafRef.current != null) {
        window.cancelAnimationFrame(locateRafRef.current);
      }
      // Wait a frame for React to apply forceIndices + virtual recompute.
      locateRafRef.current = window.requestAnimationFrame(() => {
        locateRafRef.current = window.requestAnimationFrame(() => {
          locateRafRef.current = null;
          applyScrollToNodeDom(node, 0);
        });
      });
    },
    [
      applyScrollToNodeDom,
      isPinnedRef,
      messages,
      scrollRef,
      transcriptMessages,
    ],
  );

  // After force-mount state commits, finish the jump (virtual list needs a paint).
  useEffect(() => {
    if (!locateTargetId) return;
    const node = messageNodes.find((n) => n.id === locateTargetId);
    if (!node) return;
    const t = window.requestAnimationFrame(() => applyScrollToNodeDom(node, 0));
    return () => window.cancelAnimationFrame(t);
  }, [locateTargetId, messageNodes, applyScrollToNodeDom]);

  /**
   * Deep-link locate: when parent sets `locateMessageId`, scroll once the
   * journal has rows (reuse rail virtualizer path). Soft-missing reports up.
   */
  const deepLocateConsumedRef = useRef<string | null>(null);
  useEffect(() => {
    const mid = (locateMessageId ?? "").trim();
    if (!mid) {
      deepLocateConsumedRef.current = null;
      return;
    }
    // Wait until the session journal is present (open-in-flight → empty).
    if (messages.length === 0) return;
    if (deepLocateConsumedRef.current === mid) return;

    const plan = planScrollToMessage({
      messageId: mid,
      nodes: messageNodes,
      messages,
    });
    deepLocateConsumedRef.current = mid;

    if (!plan.ok) {
      onLocateMessage?.({
        ok: false,
        messageId: mid,
        reason: plan.reason,
      });
      return;
    }

    const fromNode = plan.nodeId ? nodeById(messageNodes, plan.nodeId) : null;
    const roleRaw = messages[plan.messageIndex]?.role;
    const role: SessionMessageNode["role"] =
      roleRaw === "user" ? "user" : "assistant";
    const node: SessionMessageNode =
      fromNode ??
      ({
        id: mid,
        messageIndex: plan.messageIndex,
        nodeIndex: -1,
        role,
        preview: "",
        status: "done",
        promptIndex: null,
      } satisfies SessionMessageNode);

    scrollToMessageNode(node);
    onLocateMessage?.({ ok: true, messageId: mid });
  }, [
    locateMessageId,
    messages,
    messageNodes,
    onLocateMessage,
    scrollToMessageNode,
  ]);

  const onNodePrev = useCallback(() => {
    const cur = railCursorRef.current ?? activeNodeId;
    const next = adjacentNode(messageNodes, cur, -1);
    if (next) scrollToMessageNode(next);
  }, [messageNodes, activeNodeId, scrollToMessageNode]);

  const onNodeNext = useCallback(() => {
    const cur = railCursorRef.current ?? activeNodeId;
    const next = adjacentNode(messageNodes, cur, 1);
    if (next) scrollToMessageNode(next);
  }, [messageNodes, activeNodeId, scrollToMessageNode]);

  const railLabels = useMemo(
    () => ({
      aria: tr("message.nodes.aria"),
      prev: tr("message.nodes.prev"),
      next: tr("message.nodes.next"),
      userRole: tr("message.nodes.user"),
      assistantRole: tr("message.nodes.assistant"),
      count: (current: number, total: number) =>
        tr("message.nodes.count", { current, total }),
    }),
    [tr],
  );

  // Scroll the current find match into view (mark if present, else message).
  useEffect(() => {
    if (!findActive?.messageId) return;
    const q = findQuery.trim();
    if (!q) return;
    const id = findActive.messageId;
    const t = window.requestAnimationFrame(() => {
      const root = document.querySelector(
        `[data-message-id="${CSS.escape(id)}"]`,
      ) as HTMLElement | null;
      if (!root) return;
      const currentMark = root.querySelector(
        '[data-find-mark="current"]',
      ) as HTMLElement | null;
      const target = currentMark ?? root;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(t);
  }, [findActive?.messageId, findActive?.occurrence, findQuery]);

  useEffect(() => {
    return () => {
      if (focusClearTimerRef.current) clearTimeout(focusClearTimerRef.current);
      if (locateClearTimerRef.current) clearTimeout(locateClearTimerRef.current);
      if (locateRafRef.current != null) {
        window.cancelAnimationFrame(locateRafRef.current);
      }
    };
  }, []);

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
      if (isTurnPromptMessage(messages[i])) {
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

  /**
   * Map short path tokens → absolute using tool_step abs paths in this session.
   * Fixes homonyms like many `04-正文/正文.md` under article roots.
   */
  const sessionPathMap = useStableSessionPathMap(messages, projectPath);

  // Quiet thinking when busy, no tool motion, no assistant yet.
  const showQuietThinking =
    turnBusy && !liveTool && !hasStreamingAssistant;

  const empty =
    messages.length === 0 &&
    !showQuietThinking &&
    !liveTool &&
    !turnBusy;
  const emptyCopy = resolveChatTranscriptEmptyState({
    empty,
    suppressEmptyCopy,
    journalLoading,
    journalHydrated,
    hasSession: hasExistingSession,
  });

  /**
   * Consecutive unwoven standalone tool_step rows merge into one collapsible
   * group (painted at the first row; the rest become zero-height spacers).
   * This is where “loose adjacent tool rows” come from when a turn ends with
   * tools never woven into an assistant bubble.
   */
  const standaloneToolGroups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; tools: MessageToolSegment[]; first: boolean }
    >();
    let key: string | null = null;
    let firstId: string | null = null;
    let groupTools: MessageToolSegment[] | null = null;
    const close = () => {
      key = null;
      firstId = null;
      groupTools = null;
    };
    for (const row of transcriptMessages) {
      if (isToolStepMessage(row)) {
        const tcid =
          (row.toolCallId || "").trim() ||
          (row.id.startsWith("tool-") ? row.id.slice(5) : "");
        const woven = !!tcid && isToolInlinedInAssistants(wovenMessages, tcid);
        if (!woven) {
          const seg = toolSegmentFromMessage(row);
          if (seg) {
            if (!key) {
              key = `standalone-tools-${row.id}`;
              firstId = row.id;
              groupTools = [];
            }
            groupTools!.push(seg);
            map.set(row.id, {
              key,
              tools: groupTools!,
              first: row.id === firstId,
            });
            continue;
          }
        }
      }
      close();
    }
    return map;
  }, [transcriptMessages, wovenMessages]);

  // Force-mount only what must stay in DOM. The virtualizer applies force
  // freely while pinned (blank-pin defense) but only expands nearby while
  // escaped — listing the last user/assistant here no longer mounts the
  // whole tail mid-history (see CHAT_FORCE_EXPAND_MAX_GAP).
  const forceVirtualIndices = useMemo(() => {
    const out: number[] = [];
    const pushId = (id: string | null | undefined) => {
      if (!id) return;
      const i = transcriptMessages.findIndex((m) => m.id === id);
      if (i >= 0) out.push(i);
    };
    pushId(findActive?.messageId);
    pushId(locateTargetId);
    pushId(activeAssistantId);
    // While following the live turn, keep the last user + tail mounted.
    if (turnBusy) {
      pushId(lastUserMessageId);
      const n = transcriptMessages.length;
      for (let i = Math.max(0, n - 2); i < n; i++) out.push(i);
    } else {
      // Idle: last transcript row only (assistant). Indices are post-filter.
      const n = transcriptMessages.length;
      if (n > 0) out.push(n - 1);
    }
    // While pinned, last user + last assistant keep the pin window from
    // landing only on trailing tool_step zeros. Escaped history browse
    // ignores distant force (virtualizer max-gap) so long chats stay windowed.
    // Always resolve via pushId (transcript indices) — never push messages[]
    // offsets into the virtual list (idle path used to force wrong rows / thrash).
    if (!turnBusy && transcriptMessages.length > 0) {
      pushId(lastUserMessageId);
      for (let i = transcriptMessages.length - 1; i >= 0; i--) {
        const row = transcriptMessages[i]!;
        if (row.role === "assistant" && !row.isError) {
          pushId(row.id);
          break;
        }
      }
    }
    return out;
  }, [
    transcriptMessages,
    findActive?.messageId,
    locateTargetId,
    activeAssistantId,
    lastUserMessageId,
    turnBusy,
  ]);

  const getEstimateHeight = useCallback(
    (i: number) => {
      const m = transcriptMessages[i];
      if (!m) return 120;
      // Standalone (non-inlined) tool rows only — inlined tools are filtered out.
      if (isToolStepMessage(m)) {
        const g = standaloneToolGroups.get(m.id);
        if (g && !g.first) return 0;
        return estimateChatRowHeight({
          contentLength: m.content?.length ?? 0,
          role: "tool",
        });
      }
      const body = m.content || "";
      const atts = m.attachments ?? [];
      const imageFromAtts = atts.filter(
        (a) => !a.isDir && isImagePath(a.path),
      ).length;
      const fileFromAtts = atts.length - imageFromAtts;
      // Rough count of path-cited images in the body (inline ImageUi).
      // Prefer max with attachment images so we do not double-count when
      // the same files are both cited and attached (bottom strip filters).
      const imageFromBody =
        m.role === "assistant"
          ? (body.match(
              /\.(?:png|jpe?g|gif|webp|bmp|avif|heic)(?:\b|`|\)|\s|$)/gi,
            )?.length ?? 0)
          : 0;
      const imageCardCount =
        m.role === "assistant"
          ? Math.max(imageFromAtts, imageFromBody)
          : 0;
      // User strip keeps compact 36px chips for all attachments.
      const attachmentCount =
        m.role === "user" ? atts.length : fileFromAtts;
      const hasVideoCard =
        m.role === "assistant" &&
        (/\.(mp4|webm|mov|mkv)(\b|$)/i.test(body) ||
          body.includes("media.localhost") ||
          body.includes("media://") ||
          body.includes("127.0.0.1"));
      // Tool steps already woven into an assistant timeline render as 0-height
      // spacers — estimate 0 so virtualization does not invent a blank pin tail.
      const toolInlined =
        isToolStepMessage(m) &&
        (() => {
          const tcid =
            (m.toolCallId || "").trim() ||
            (m.id.startsWith("tool-") ? m.id.slice(5) : "");
          return !!tcid && isToolInlinedInAssistants(wovenMessages, tcid);
        })();
      const collapsedTool =
        toolInlined ||
        (m.role === "tool" &&
          !isToolStepMessage(m) &&
          !isEndOfTurnMarker(m.marker) &&
          !isContextCompactMessage(m));
      return estimateChatRowHeight({
        contentLength: body.length,
        thoughtLength: m.thought?.length ?? 0,
        role: m.role,
        attachmentCount,
        imageCardCount,
        hasVideoCard,
        collapsed: collapsedTool,
      });
    },
    [transcriptMessages, standaloneToolGroups],
  );

  const {
    virtualized,
    start: virtStart,
    end: virtEnd,
    paddingTop,
    paddingBottom,
    measureRef,
  } = useChatMessageVirtualizer({
    itemCount: transcriptMessages.length,
    getKey: (i) => transcriptMessages[i]?.id ?? `i-${i}`,
    getEstimateHeight,
    viewportRef: scrollRef,
    isPinnedRef,
    conversationKey: sessionKey ?? "chat",
    forceIndices: forceVirtualIndices,
  });

  const visibleMessages = useMemo(() => {
    if (!virtualized) {
      return transcriptMessages.map((m, index) => ({ m, index }));
    }
    const slice: { m: ChatMessage; index: number }[] = [];
    for (let i = virtStart; i < virtEnd; i++) {
      const m = transcriptMessages[i];
      if (m) slice.push({ m, index: i });
    }
    return slice;
  }, [transcriptMessages, virtualized, virtStart, virtEnd]);

  return (
    <div className="lobe-chat" data-slot="lobe-chat">
      <div
        ref={scrollRef}
        className="lobe-chat__scroll"
        onScroll={onScroll}
        onContextMenu={onTranscriptContextMenu}
      >
        <div ref={contentRef} className="lobe-chat__inner">
          {emptyCopy ? (
            <div
              className="lobe-chat-empty"
              data-kind={emptyCopy.kind}
              aria-busy={emptyCopy.kind === "loading" ? true : undefined}
            >
              {emptyCopy.kind === "loading" ? (
                <Spinner className="lobe-chat-empty__spinner" size={22} />
              ) : null}
              <h3 className="lobe-chat-empty__title">{tr(emptyCopy.titleKey)}</h3>
              <p className="lobe-chat-empty__desc">{tr(emptyCopy.hintKey)}</p>
            </div>
          ) : null}

          {virtualized && paddingTop > 0
            ? splitVirtSpacerHeights(paddingTop).map((h, i) => (
                <div
                  key={`virt-top-${i}`}
                  aria-hidden
                  className="lobe-chat__virt-spacer"
                  style={{ height: h, flexShrink: 0 }}
                />
              ))
            : null}

          {visibleMessages.map(({ m, index: msgIndex }) => (
            <TranscriptMessageRow
              key={m.id}
              m={m}
              msgIndex={msgIndex}
              virtualized={virtualized}
              measureRef={measureRef}
              locale={locale}
              tr={tr}
              projectPath={projectPath}
              sessionPathMap={sessionPathMap}
              sessionId={sessionId}
              showToolChrome={showToolChrome}
              toolStepsAutoCollapse={toolStepsAutoCollapse}
              showTimestamps={showTimestamps}
              messageTimeFormat={messageTimeFormat}
              timeTick={relativeTick}
              showReplyLength={showReplyLength}
              standaloneToolGroups={standaloneToolGroups}
              lastUserMessageId={lastUserMessageId}
              editingUserMessageId={editingUserMessageId}
              editSubmitting={editSubmitting}
              editAttachments={editAttachments}
              canEditLastUser={canEditLastUser}
              canRegenerate={canRegenerate}
              turnLive={
                sessionState === "streaming" ||
                sessionState === "awaiting_permission"
              }
              canRewindSession={canRewindSession}
              regenerableAssistantId={regenerableAssistantId}
              regenerateModels={regenerateModels}
              regenerateModelId={regenerateModelId}
              activeAssistantId={activeAssistantId}
              liveTool={liveTool}
              wovenMessages={wovenMessages}
              thinkingStartedAt={
                m.streaming && m.id === activeAssistantId
                  ? clampThinkingStartToMessage({
                      turnStartedAt,
                      messageCreatedAtMs: parseCreatedAtMs(m.createdAt),
                    })
                  : null
              }
              findQuery={findQuery}
              findHitMessageIds={findHitMessageIds}
              findActive={findActive}
              focusMessageId={focusMessageId}
              structuredUsageMessageId={structuredUsageMessageId}
              structuredOutputActive={structuredOutputActive}
              structuredOutputSchema={structuredOutputSchema}
              structuredOutputUsage={structuredOutputUsage}
              structuredOutputLabels={structuredOutputLabels}
              attachLabels={attachLabels}
              onEditUserMessage={onEditUserMessage}
              onCancelEditUserMessage={onCancelEditUserMessage}
              onSubmitEditUserMessage={onSubmitEditUserMessage}
              onRemoveEditAttachment={onRemoveEditAttachment}
              onRegenerateAssistant={onRegenerateAssistant}
              onRewindToUserMessage={onRewindToUserMessage}
              onForkFromUserMessage={onForkFromUserMessage}
              onOpenResource={onOpenResource}
              onOpenError={onOpenError}
              onOpenExternalLink={onOpenExternalLink}
              onAddAttachmentToComposer={onAddAttachmentToComposer}
            />
          ))}

          {virtualized && paddingBottom > 0
            ? splitVirtSpacerHeights(paddingBottom).map((h, i) => (
                <div
                  key={`virt-bot-${i}`}
                  aria-hidden
                  className="lobe-chat__virt-spacer"
                  style={{ height: h, flexShrink: 0 }}
                />
              ))
            : null}

          {/* Tool before any assistant bubble — only if not already a message row. */}
          {showToolChrome &&
          liveTool &&
          !activeAssistantId &&
          !(
            liveTool.toolCallId &&
            isToolInlinedInAssistants(messages, liveTool.toolCallId)
          ) &&
          !messages.some(
            (x) =>
              isToolStepMessage(x) &&
              (x.toolCallId === liveTool.toolCallId ||
                x.id === `tool-${liveTool.toolCallId}`),
          ) ? (
            <LiveToolText message={liveTool} locale={locale} />
          ) : null}

          {showQuietThinking ? (
            <div data-testid="quiet-thinking">
              <Thinking
                locale={locale}
                thinking
                startedAt={clampThinkingStartToMessage({
                  turnStartedAt,
                  messageCreatedAtMs: parseCreatedAtMs(
                    messages.find((x) => x.id === activeAssistantId)
                      ?.createdAt,
                  ),
                })}
              />
            </div>
          ) : null}

          {/* Plan UI lives only in PlanStatusBar (top) + ResourceViewer Plan mode. */}
        </div>
      </div>

      <MessageNodeRail
        nodes={messageNodes}
        activeId={activeNodeId}
        onSelect={scrollToMessageNode}
        onPrev={onNodePrev}
        onNext={onNodeNext}
        labels={railLabels}
        scrollParentRef={scrollRef}
        messages={transcriptMessages}
        navLockUntilRef={navLockUntilRef}
        onScrollActiveChange={onRailScrollActiveChange}
      />

      <BackBottom
        visible={backBottomVisible}
        label={tr("chat.scrollBottom")}
        onClick={() => scrollToBottom("smooth")}
      />

      {/* Selection context menu — same ContextMenu baseline as attachment cards. */}
      <ContextMenu
        open={!!selectionMenu}
        x={selectionMenu?.x ?? 0}
        y={selectionMenu?.y ?? 0}
        onClose={() => setSelectionMenu(null)}
        items={selectionMenuItems}
      />
      {selectionBar ? (
        <TranscriptSelectionToolbar
          x={selectionBar.x}
          y={selectionBar.y}
          text={selectionBar.text}
          comment={selectionComment}
          onCommentChange={setSelectionComment}
          onCopy={() => {
            copyText(selectionBar.text);
            closeSelectionUi();
          }}
          onAddQuote={() =>
            addQuoteFromSelection(
              selectionBar.text,
              selectionComment,
              selectionBar.sourceMessageId,
            )
          }
          onClose={closeSelectionUi}
          labels={{
            copy: tr("chat.selectionCopy"),
            addQuote: tr("chat.selectionAddToInput"),
            commentPlaceholder: tr("chat.selectionCommentPlaceholder"),
            commentSubmit: tr("chat.selectionCommentSubmit"),
          }}
        />
      ) : null}
    </div>
  );
}
