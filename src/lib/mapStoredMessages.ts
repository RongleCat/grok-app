/**
 * Map host journal rows (`session_messages`) → UI `ChatMessage`s.
 * Shared by openSession + live index reload so attachments never diverge.
 */

import {
  extractAutomationPayload,
} from "@/lib/automationSetup";
import {
  mergeAttachments,
  mergeMessageAttachments,
  parseAttachmentsFromContent,
  type Attachment,
} from "@/lib/attachments";
import { hydrateDisplayContent } from "@/lib/draftDoc";
import {
  isEndOfTurnMarker,
  parseEndOfTurnContent,
} from "@/lib/endOfTurn";
import {
  buildSegmentsFromLegacy,
  parseCompactContent,
  parseToolStepContent,
  splitThoughtPhases,
  type ChatMessage,
  type MessageAttachment,
} from "@/lib/session";
import { maybeCompactToolOutputForMemory } from "@/lib/toolOutputMemory";

/** Wire shape from `session_messages` / disk journal. */
export type StoredJournalMessage = {
  id: string;
  role: string;
  content: string;
  thought?: string | null;
  createdAt?: string | null;
  isError?: boolean | null;
  marker?: string | null;
  attachments?: Array<{
    path: string;
    name: string;
    isDir?: boolean;
  }> | null;
};

/**
 * Convert one journal row into a chat message with attachments merged from
 * structured storage + `@path` lines + absolute media paths in text.
 */
export function mapStoredMessageToChat(
  m: StoredJournalMessage,
): ChatMessage {
  const parsed = parseAttachmentsFromContent(m.content ?? "");
  const storedAtts: Attachment[] = (m.attachments ?? []).map((a) => ({
    path: a.path,
    name: a.name || a.path.split(/[/\\]/).pop() || a.path,
    isDir: !!a.isDir,
  }));
  const attachments = mergeMessageAttachments(
    mergeAttachments(parsed.attachments, storedAtts),
    m.content ?? "",
  );
  const rawContent =
    parsed.text || (parsed.attachments.length ? "" : m.content ?? "");
  const content =
    m.role === "user" ? hydrateDisplayContent(rawContent) : rawContent;
  const rawMarker = m.marker || undefined;
  const marker =
    rawMarker ||
    (m.role === "tool" &&
    (content === "context_compact" ||
      content.startsWith("context_compact|") ||
      content.startsWith("context_compact\n"))
      ? "context_compact"
      : m.role === "tool" && content.startsWith("tool_step|")
        ? "tool_step"
        : m.role === "tool" && content.startsWith("turn_cancelled")
          ? "turn_cancelled"
          : m.role === "tool" && content.startsWith("turn_end|")
            ? "turn_end"
            : undefined);
  const compactMeta =
    marker === "context_compact"
      ? parseCompactContent(content) || undefined
      : undefined;
  const toolParsed =
    marker === "tool_step" ? parseToolStepContent(content) : null;
  const role = m.role as "user" | "assistant" | "tool";
  let displayContent = toolParsed?.title || content;
  if (role === "assistant" && displayContent) {
    displayContent = extractAutomationPayload(displayContent).cleanText;
  }
  const thoughtPhases = splitThoughtPhases(m.thought);
  const atts: MessageAttachment[] | undefined = attachments?.map((a) => ({
    path: a.path,
    name: a.name,
    isDir: a.isDir,
  }));
  return {
    id: m.id,
    role,
    content: displayContent,
    thought: m.thought ?? undefined,
    thoughtPhases,
    segments:
      role === "assistant"
        ? buildSegmentsFromLegacy(displayContent, m.thought, thoughtPhases)
        : undefined,
    isError: m.isError || undefined,
    attachments: atts,
    createdAt: m.createdAt || undefined,
    marker,
    compactMeta: compactMeta ?? undefined,
    toolCallId: m.id.startsWith("tool-") ? m.id.slice(5) : undefined,
    toolKind: toolParsed?.kind,
    // End-of-turn chips: keep reason in toolStatus so live applyTurnMarker and
    // history reload paint the same EndOfTurnChip label (content is source of truth).
    toolStatus:
      toolParsed?.status ??
      (isEndOfTurnMarker(marker)
        ? (parseEndOfTurnContent(content) ?? undefined)
        : undefined),
    toolDetail: toolParsed?.detail,
    toolPath: toolParsed?.path,
    toolInput: toolParsed?.input,
    // Compact on hydrate so journal reloads do not re-inflate WebContent (#1029).
    toolOutput: toolParsed?.output
      ? maybeCompactToolOutputForMemory(toolParsed.output, false)
      : undefined,
    streaming: false,
  };
}

/** Map a full journal array. */
export function mapStoredMessagesToChat(
  stored: StoredJournalMessage[],
): ChatMessage[] {
  return stored.map(mapStoredMessageToChat);
}
