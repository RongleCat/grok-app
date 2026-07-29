/**
 * LobeHub-aligned chat thread (pure CSS 1:1).
 * Replaces AI Elements / previous ConversationThread.
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
  filterTranscriptMessages,
  isToolInlinedInAssistants,
  lastRegenerableAssistantId,
  messageSegments,
  isTurnPromptMessage,
  type ChatMessage,
  type SessionState,
} from "@/lib/session";
import {
  adjacentNode,
  buildSessionMessageNodes,
  estimateMessageIndexAtY,
  estimateStartScrollTop,
  nearestNodeForMessageIndex,
  pickActiveNodeIdFromRects,
  type SessionMessageNode,
} from "@/lib/sessionMessageNodes";
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
  IconChat,
  IconClock,
  IconExportMd,
  IconFork,
  IconRefresh,
  IconRename,
  IconRewind,
  IconTarget,
} from "@/components/icons";
import { formatMessageTime, formatRelativeTime } from "@/lib/accountUi";
import type { MessageTimeFormat } from "@/lib/messageTimeFormatPref";
import { formatTokenCount } from "@/lib/contextUsage";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import { useChatMessageVirtualizer } from "@/hooks/useChatMessageVirtualizer";
import { estimateChatRowHeight } from "@/lib/chatVirtualList";
import {
  MessageActionButton,
  MessageCopyButton,
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
   */
  canRegenerate?: boolean;
  onRegenerateAssistant?: (message: ChatMessage) => void;
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
  onOpenSessionChanges: _onOpenSessionChanges,
  onOpenModifiedPath: _onOpenModifiedPath,
  showTimestamps = true,
  messageTimeFormat = "absolute",
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

  const syncActiveNodeFromScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || messageNodes.length === 0) return;
    // Programmatic next/prev owns the highlight until the jump settles.
    if (performance.now() < navLockUntilRef.current) return;

    const viewportRect = el.getBoundingClientRect();
    const focusY = viewportRect.top + el.clientHeight * 0.28;

    const rects: { id: string; top: number; bottom: number }[] = [];
    for (const node of messageNodes) {
      const row = el.querySelector(
        `[data-message-id="${CSS.escape(node.id)}"]`,
      ) as HTMLElement | null;
      if (!row) continue;
      const r = row.getBoundingClientRect();
      rects.push({ id: node.id, top: r.top, bottom: r.bottom });
    }

    let bestId = pickActiveNodeIdFromRects(rects, focusY);

    if (!bestId) {
      const y = el.scrollTop + el.clientHeight * 0.28;
      const msgIdx = estimateMessageIndexAtY(messages, y);
      bestId = nearestNodeForMessageIndex(messageNodes, msgIdx)?.id ?? null;
    }

    if (bestId) railCursorRef.current = bestId;
    setActiveNodeId((prev) => (prev === bestId ? prev : bestId));
  }, [messageNodes, messages, scrollRef]);

  const onScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      onStickScroll(e);
      syncActiveNodeFromScroll();
    },
    [onStickScroll, syncActiveNodeFromScroll],
  );

  // Keep rail highlight in sync on mount / message growth / session switch.
  useEffect(() => {
    const t = window.requestAnimationFrame(() => syncActiveNodeFromScroll());
    return () => window.cancelAnimationFrame(t);
  }, [syncActiveNodeFromScroll, sessionKey, messages.length]);

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
        syncActiveNodeFromScroll();
      }, 700);
    },
    [scrollRef, syncActiveNodeFromScroll],
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
   * Paint list: drop inlined tool_step journal rows. Full `messages` stays for
   * path maps / live tools / nodes — only the virtual list + render loop use this.
   * (64 woven tools otherwise force virtualization and thrash near-bottom stick.)
   */
  const transcriptMessages = useMemo(
    () => filterTranscriptMessages(messages),
    [messages],
  );

  // Force-mount only what must stay in DOM. Do NOT always force the last N
  // rows while reading history — that expanded every window to the tail and
  // remounted huge answers (org charts) mid-scroll → bounce.
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
          body.includes("media://"));
      return estimateChatRowHeight({
        contentLength: body.length,
        thoughtLength: m.thought?.length ?? 0,
        role: m.role,
        attachmentCount: m.attachments?.length ?? 0,
        hasVideoCard,
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
            if (isToolStepMessage(m)) {
              const tcid =
                (m.toolCallId || "").trim() ||
                (m.id.startsWith("tool-") ? m.id.slice(5) : "");
              if (tcid && isToolInlinedInAssistants(messages, tcid)) {
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
                    <TimelineToolRow tool={toolSeg} />
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
                  before: formatTokenCount(meta.tokensBefore),
                  after: formatTokenCount(meta.tokensAfter),
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
                        <MessageActionButton
                          label={tr("message.regenerate")}
                          disabled={!canRegenerate}
                          onClick={() => {
                            if (!canRegenerate) return;
                            onRegenerateAssistant?.(m);
                          }}
                        >
                          <IconRefresh size={14} />
                        </MessageActionButton>
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
            const showLiveToolBelow =
              !!liveTool && isActiveAssistant && !hasInlinedRunningTool;
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
                        streamingLabel={tr("chat.thinking")}
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
                          return (
                            <TimelinePhaseBlock
                              key={`${m.id}-${unit.id}`}
                              phase={unit}
                              locale={locale}
                              messageStreaming={!!m.streaming}
                            />
                          );
                        }
                        if (unit.kind === "tool") {
                          return (
                            <div
                              key={`${m.id}-tool-${unit.tool.toolCallId || unit.si}`}
                              className="lobe-timeline-rail"
                            >
                              <TimelineToolRow tool={unit.tool} />
                            </div>
                          );
                        }
                        if (unit.kind === "thought") {
                          if (
                            !unit.text.trim() &&
                            !(m.streaming && unit.streaming)
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
                                thinking={unit.streaming}
                                content={unit.text}
                                streamingLabel={tr("chat.thinking")}
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
                      {showRegen ? (
                        <MessageActionButton
                          label={tr("message.regenerate")}
                          disabled={!canRegenerate}
                          onClick={() => {
                            if (!canRegenerate) return;
                            onRegenerateAssistant?.(m);
                          }}
                        >
                          <IconRefresh size={15} />
                        </MessageActionButton>
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
          {liveTool &&
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
            <div className="lobe-chat-live-tool is-running" role="status">
              <span className="lobe-chat-live-tool__mark" aria-hidden>
                <span className="lobe-chat-thinking__dot lobe-chat-thinking__dot--live" />
              </span>
              <span className="lobe-chat-live-tool__title lobe-chat-live-tool__title--pulse">
                {tr("chat.thinking")}
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
      />

      <BackBottom
        visible={backBottomVisible}
        label={tr("chat.scrollBottom")}
        onClick={() => scrollToBottom("smooth")}
      />
    </div>
  );
}
