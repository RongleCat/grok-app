/**
 * Open-session journal pipeline: disk rows → painted transcript.
 *
 * Rapid-switch abort is the caller's `stillThisOpen()`. This module owns
 * map / prefer / weave / busy-streaming / fence strip / attachment refine /
 * reconcile equality — not chrome, composer, or warm-connect.
 */
import * as api from "@/lib/api";
import {
  applyResolvedSessionMedia,
  collectSessionRelativeMediaRefs,
  isDisplayableAttachmentPath,
} from "@/lib/attachments";
import { extractAutomationPayload } from "@/lib/automationSetup";
import { parseScheduledUserContent } from "@/lib/automations";
import {
  restoreContextUsageForSession,
  type ContextUsageState,
} from "@/lib/contextUsage";
import {
  mapStoredMessagesToChat,
  type StoredJournalMessage,
} from "@/lib/mapStoredMessages";
import {
  sessionChangesFromMessages,
  type SessionFileChange,
} from "@/lib/sessionChanges";
import { sessionJournalLooksUnchanged } from "@/lib/sessionOpenSwitch";
import {
  ensureBusyTurnStreaming,
  preferSessionMessages,
  weaveToolsIntoAssistantSegments,
  type ChatMessage,
  type SessionState,
} from "@/lib/session";
import { sessionTranscriptStore } from "@/lib/sessionTranscriptStore";

export type JournalIo = {
  isTauri: () => boolean;
  sessionMessages: (
    id: string,
    opts: { reconcile: boolean },
  ) => Promise<StoredJournalMessage[]>;
  sessionResolveRelativeMedia: (
    id: string,
    rels: string[],
  ) => Promise<Array<{ path: string; name?: string; isDir?: boolean }>>;
  pathsClassify: (
    paths: string[],
  ) => Promise<
    Array<{ path: string; name: string; isDir: boolean; exists?: boolean }>
  >;
};

export type PathClassify = {
  path: string;
  name: string;
  isDir: boolean;
  exists?: boolean;
};

export type HydrateSessionJournalResult = {
  status: "applied" | "aborted" | "failed";
  /** True when deferred reconcile projected the same ids (no second paint). */
  unchanged?: boolean;
  painted: ChatMessage[];
  changesFromHistory: SessionFileChange[];
  scheduledFromJournal: boolean;
  usage: ContextUsageState;
  refinePromise?: Promise<void>;
};

const defaultIo: JournalIo = {
  isTauri: () => api.isTauri(),
  sessionMessages: (id, opts) => api.sessionMessages(id, opts),
  sessionResolveRelativeMedia: (id, rels) =>
    api.sessionResolveRelativeMedia(id, rels),
  pathsClassify: (paths) => api.pathsClassify(paths),
};

/** Strip grok-automation fences from assistant bodies for display. */
export function stripAutomationFences(rows: ChatMessage[]): ChatMessage[] {
  return rows.map((m) => {
    if (m.role !== "assistant" || !m.content) return m;
    const { cleanText } = extractAutomationPayload(m.content);
    return cleanText === m.content ? m : { ...m, content: cleanText };
  });
}

export function journalHasScheduledUser(
  rows: readonly ChatMessage[],
): boolean {
  return rows.some(
    (m) => m.role === "user" && !!parseScheduledUserContent(m.content || ""),
  );
}

/**
 * Map stored journal → UI rows: prefer in-memory cache, weave tools, mark
 * the busy turn streaming so reload does not look idle mid-turn.
 */
export function projectJournalToChat(opts: {
  stored: StoredJournalMessage[];
  cached: ChatMessage[] | undefined;
  liveState: SessionState | string | null | undefined;
}): ChatMessage[] {
  return ensureBusyTurnStreaming(
    weaveToolsIntoAssistantSegments(
      preferSessionMessages(opts.cached, mapStoredMessagesToChat(opts.stored)),
    ),
    opts.liveState,
  );
}

/**
 * Partial-fork follow-up: Host already cut the child journal. Disk is
 * authoritative — never prefer/merge the in-memory cache, which can still
 * hold the parent's later turns.
 */
export function projectTrimmedJournalToChat(
  stored: StoredJournalMessage[],
): ChatMessage[] {
  return stripAutomationFences(
    weaveToolsIntoAssistantSegments(mapStoredMessagesToChat(stored)),
  );
}

/**
 * Drop missing local thumbs; keep http(s); on classify failure keep only
 * displayable paths. Relative-media resolve is applied first when present.
 */
export function refineJournalAttachments(
  rows: ChatMessage[],
  opts: {
    resolved: Array<{ path: string; name: string; isDir: boolean }>;
    classifyByPath: Map<string, PathClassify> | null;
    classifyFailed: boolean;
  },
): ChatMessage[] {
  let next = opts.resolved.length
    ? applyResolvedSessionMedia(rows, opts.resolved)
    : rows;
  if (opts.classifyByPath) {
    const byPath = opts.classifyByPath;
    next = next.map((msg) => {
      if (!msg.attachments?.length) return msg;
      const nextAtts = msg.attachments
        .map((a) => {
          if (!isDisplayableAttachmentPath(a.path)) return null;
          const remote = /^https?:\/\//i.test(a.path);
          const c = byPath.get(a.path);
          if (remote) {
            return c
              ? { path: c.path, name: c.name, isDir: c.isDir }
              : a;
          }
          if (c && !c.exists) return null;
          return c ? { path: c.path, name: c.name, isDir: c.isDir } : a;
        })
        .filter((a): a is NonNullable<typeof a> => a != null);
      return {
        ...msg,
        attachments: nextAtts.length ? nextAtts : undefined,
      };
    });
  } else if (opts.classifyFailed) {
    next = next.map((msg) => {
      if (!msg.attachments?.length) return msg;
      const nextAtts = msg.attachments.filter((a) =>
        isDisplayableAttachmentPath(a.path),
      );
      return {
        ...msg,
        attachments: nextAtts.length ? nextAtts : undefined,
      };
    });
  }
  return next;
}

async function refinePaintedJournal(opts: {
  sessionId: string;
  source: ChatMessage[];
  stillThisOpen: () => boolean;
  io: JournalIo;
  store: typeof sessionTranscriptStore;
}): Promise<void> {
  const { sessionId, source, stillThisOpen, io, store } = opts;
  const rels = io.isTauri() ? collectSessionRelativeMediaRefs(source) : [];
  let resolved: Array<{ path: string; name: string; isDir: boolean }> = [];
  if (rels.length) {
    try {
      const list = await io.sessionResolveRelativeMedia(sessionId, rels);
      resolved = list.map((a) => ({
        path: a.path,
        name: a.name || a.path.split(/[/\\]/).pop() || a.path,
        isDir: !!a.isDir,
      }));
    } catch {
      /* ignore */
    }
  }
  const pathSource = resolved.length
    ? applyResolvedSessionMedia(source, resolved)
    : source;
  const allPaths = pathSource.flatMap(
    (m) => m.attachments?.map((a) => a.path) ?? [],
  );
  let classifyByPath: Map<string, PathClassify> | null = null;
  let classifyFailed = false;
  if (allPaths.length && io.isTauri()) {
    try {
      const list = await io.pathsClassify(allPaths);
      if (list.length) {
        classifyByPath = new Map(list.map((c) => [c.path, c]));
      }
    } catch {
      classifyFailed = true;
    }
  } else if (allPaths.length) {
    classifyFailed = true;
  }
  if (!resolved.length && !classifyByPath && !classifyFailed) return;
  const latest = store.getCached(sessionId) ?? source;
  const next = refineJournalAttachments(latest, {
    resolved,
    classifyByPath,
    classifyFailed,
  });
  store.cacheSession(sessionId, next);
  if (!stillThisOpen()) return;
  store.setMessages(stripAutomationFences(next));
}

export async function hydrateSessionJournal(opts: {
  sessionId: string;
  sessionScheduled: boolean;
  stillThisOpen: () => boolean;
  liveState: SessionState | string | null | undefined;
  reconcile?: boolean;
  io?: JournalIo;
  store?: typeof sessionTranscriptStore;
}): Promise<HydrateSessionJournalResult> {
  const io = opts.io ?? defaultIo;
  const store = opts.store ?? sessionTranscriptStore;
  const sessionId = opts.sessionId;
  const reconcile = opts.reconcile === true;
  const emptyUsage = restoreContextUsageForSession(sessionId, []);

  try {
    const stored = await io.sessionMessages(sessionId, { reconcile });
    if (!opts.stillThisOpen()) {
      // First open: keep cache warm. Deferred reconcile: just drop.
      if (!reconcile) {
        try {
          const mappedEarly = mapStoredMessagesToChat(stored);
          store.cacheSession(
            sessionId,
            preferSessionMessages(store.getCached(sessionId), mappedEarly),
          );
          store.finishJournalLoad(sessionId);
        } catch {
          store.abortJournalLoad(sessionId);
        }
      }
      return {
        status: "aborted",
        painted: store.getCached(sessionId) ?? [],
        changesFromHistory: [],
        scheduledFromJournal: false,
        usage: emptyUsage,
      };
    }

    const chosen = projectJournalToChat({
      stored,
      cached: store.getCached(sessionId),
      liveState: opts.liveState,
    });

    if (
      reconcile &&
      sessionJournalLooksUnchanged(store.getCached(sessionId), chosen)
    ) {
      return {
        status: "applied",
        unchanged: true,
        painted: store.getCached(sessionId) ?? chosen,
        changesFromHistory: [],
        scheduledFromJournal: false,
        usage: restoreContextUsageForSession(
          sessionId,
          store.getCached(sessionId) ?? chosen,
        ),
      };
    }

    store.cacheSession(sessionId, chosen);
    const stripped = stripAutomationFences(chosen);
    store.setMessages(stripped);
    if (!reconcile) store.finishJournalLoad(sessionId);

    const refinePromise = reconcile
      ? undefined
      : refinePaintedJournal({
          sessionId,
          source: store.getCached(sessionId) ?? chosen,
          stillThisOpen: opts.stillThisOpen,
          io,
          store,
        });

    return {
      status: "applied",
      painted: stripped,
      changesFromHistory: sessionChangesFromMessages(chosen),
      scheduledFromJournal:
        !opts.sessionScheduled && journalHasScheduledUser(chosen),
      usage: restoreContextUsageForSession(sessionId, stripped),
      refinePromise,
    };
  } catch {
    if (reconcile) {
      return {
        status: "failed",
        painted: store.getCached(sessionId) ?? [],
        changesFromHistory: [],
        scheduledFromJournal: false,
        usage: emptyUsage,
      };
    }
    if (!opts.stillThisOpen()) {
      store.abortJournalLoad(sessionId);
      return {
        status: "aborted",
        painted: store.getCached(sessionId) ?? [],
        changesFromHistory: [],
        scheduledFromJournal: false,
        usage: emptyUsage,
      };
    }
    const cached = store.getCached(sessionId) ?? [];
    store.setMessages(cached);
    store.finishJournalLoad(sessionId);
    return {
      status: "failed",
      painted: cached,
      changesFromHistory: [],
      scheduledFromJournal: false,
      usage: restoreContextUsageForSession(sessionId, cached),
    };
  }
}
