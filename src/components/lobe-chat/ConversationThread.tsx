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
  isImagePath,
  isMediaPath,
} from "@/lib/attachments";
import {
  buildSessionFilePathMap,
  mergePathMaps,
} from "@/lib/sessionPathMap";
import { AttachmentCard } from "@/components/AttachmentCard";
import type { ResourceOpenTarget } from "@/components/ResourceViewer";
import {
  IconArrowsMinimize,
  IconBulb,
  IconChat,
  IconClock,
  IconExportMd,
  IconFork,
  IconLink,
  IconRename,
  IconRewind,
  IconTarget,
} from "@/components/icons";
import { formatMessageTime, formatRelativeTime } from "@/lib/accountUi";
import type { MessageTimeFormat } from "@/lib/messageTimeFormatPref";
import { computeMessageLength } from "@/lib/messageLength";
import { formatTokenCount } from "@/lib/contextUsage";
import type { ModelOption } from "@/lib/grokCatalog";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import { useChatMessageVirtualizer } from "@/hooks/useChatMessageVirtualizer";
import { estimateChatRowHeight } from "@/lib/chatVirtualList";
import { StructuredJsonPanel } from "./StructuredJsonPanel";
import {
  MessageActionButton,
  MessageCopyButton,
  MessageRegenerateButton,
} from "./MessageAction";
import { ChatItem } from "./ChatItem";
import { MarkdownChat } from "./MarkdownChat";
import { Thinking } from "./Thinking";
import { BackBottom } from "./BackBottom";
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
  pickRunningTurnTool,
} from "./AgentActivity";
import { EndOfTurnChip } from "./EndOfTurnChip";
import {
  TimelineToolRow,
  toolSegmentFromMessage,
  toolSegmentIsRunning,
} from "./TimelineToolRow";
import { TimelinePhaseBlock } from "./TimelinePhaseBlock";
import { buildTimelineUnits } from "@/lib/timelinePhases";
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
  /** Open external http(s) chat links (desktop shell + optional confirm). */
  onOpenExternalLink?: (url: string) => void;
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
  canRegenerate = false,
  onRegenerateAssistant,
  regenerateModels = [],
  regenerateModelId = "",
  canRewindSession = false,
  onRewindToUserMessage,
  onForkFromUserMessage,
  onOpenResource,
  onOpenExternalLink,
  onAddAttachmentToComposer,
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

  const messageNodes = useMemo(
    () => buildSessionMessageNodes(messages),
    [messages],
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
  /** Authoritative cursor for prev/next — survives brief active-id flicker. */
  const railCursorRef = useRef<string | null>(null);

  /**
   * Free-scroll rail highlight lives in MessageNodeRail (rAF + no parent
   * setState). This only updates railCursorRef after programmatic jumps settle
   * so prev/next keep a stable cursor without re-rendering the transcript.
   */
  const syncRailCursorAfterNav = useCallback(() => {
    if (performance.now() < navLockUntilRef.current) return;
    // Cursor already set by scrollToMessageNode / select; nothing else needed.
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
        syncRailCursorAfterNav();
      }, 700);
    },
    [scrollRef, syncRailCursorAfterNav],
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

      // Coarse jump via estimates so the virtual window moves near the target
      // even before the row is mounted.
      const approx = estimateStartScrollTop(
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
    [applyScrollToNodeDom, isPinnedRef, messages, scrollRef],
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
  const sessionPathMap = useMemo(
    () => buildSessionFilePathMap(messages, projectPath),
    [messages, projectPath],
  );

  // Quiet thinking when busy, no tool motion, no assistant yet.
  const showQuietThinking =
    turnBusy && !liveTool && !hasStreamingAssistant;

  const empty =
    messages.length === 0 &&
    !showQuietThinking &&
    !liveTool &&
    !turnBusy;

  /**
   * Display-layer weave: journal reload / cache races can leave tool_step rows
   * outside assistant.segments. Always stitch before paint so history shows the
   * same Worked-for phase as live (thought ↔ tools interleaved).
   */
  const wovenMessages = useMemo(
    () => weaveToolsIntoAssistantSegments(messages),
    [messages],
  );

  /**
   * Paint list: drop inlined tool_step journal rows; when filter is
   * `conversation`, also drop every tool_step row. Full `messages` stays for
   * path maps / live tools / nodes — only the virtual list + render loop use this.
   * (64 woven tools otherwise force virtualization and thrash near-bottom stick.)
   */
  const transcriptMessages = useMemo(
    () => filterMessagesForTranscript(wovenMessages, transcriptFilter),
    [wovenMessages, transcriptFilter],
  );

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
        return estimateChatRowHeight({
          contentLength: m.content?.length ?? 0,
          role: "tool",
        });
      }
      const body = m.content || "";
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
          m.marker !== "context_compact" &&
          !(m.content?.startsWith("context_compact") || m.compactMeta));
      return estimateChatRowHeight({
        contentLength: body.length,
        thoughtLength: m.thought?.length ?? 0,
        role: m.role,
        attachmentCount: m.attachments?.length ?? 0,
        hasVideoCard,
        collapsed: collapsedTool,
      });
    },
    [transcriptMessages],
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
    streaming: turnBusy || hasStreamingAssistant,
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
      >
        <div ref={contentRef} className="lobe-chat__inner">
          {empty && !suppressEmptyCopy ? (
            <div className="lobe-chat-empty">
              <h3 className="lobe-chat-empty__title">{tr("main.startTitle")}</h3>
              <p className="lobe-chat-empty__desc">{tr("main.startHint")}</p>
            </div>
          ) : null}

          {virtualized && paddingTop > 0 ? (
            <div
              aria-hidden
              className="lobe-chat__virt-spacer"
              style={{ height: paddingTop, flexShrink: 0 }}
            />
          ) : null}

          {visibleMessages.map(({ m, index: msgIndex }) => {
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
                  before: formatTokenCount(meta.tokensBefore, locale),
                  after: formatTokenCount(meta.tokensAfter, locale),
                });
              } else if (meta?.note) {
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
            const timelineUnits = buildTimelineUnits(segs, {
              streaming: !!m.streaming,
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
                                thoughtForLabel={(n) =>
                                  tr("chat.thoughtFor", { n })
                                }
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
                              unit.si === lastContentSi
                                ? m.attachments
                                : undefined
                            }
                            streaming={unit.streaming}
                            locale={locale}
                            projectPath={projectPath}
                            sessionPathMap={sessionPathMap}
                            onOpenResource={onOpenResource}
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
                  if (m.streaming) return null;
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
          })}

          {virtualized && paddingBottom > 0 ? (
            <div
              aria-hidden
              className="lobe-chat__virt-spacer"
              style={{ height: paddingBottom, flexShrink: 0 }}
            />
          ) : null}

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
            <div
              className="grok-act__step is-running is-last"
              role="status"
              data-testid="quiet-thinking"
            >
              <div className="grok-act__icon-col" aria-hidden>
                <span className="grok-act__icon">
                  <IconBulb size={16} stroke={1.5} />
                </span>
              </div>
              <span className="grok-act__label grok-act__label--live">
                {tr("chat.thinkingLabel")}
              </span>
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
        messages={messages}
        navLockUntilRef={navLockUntilRef}
      />

      <BackBottom
        visible={backBottomVisible}
        label={tr("chat.scrollBottom")}
        onClick={() => scrollToBottom("smooth")}
      />
    </div>
  );
}
