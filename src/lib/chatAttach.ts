/**
 * Attach another local chat as context (Codex-style).
 *
 * Journal / user bubble store `[[chat:<uuid>]]` tokens.
 * The agent prompt is built on the host from those ids — never persist
 * the full source transcript into the target journal.
 */

export const MAX_ATTACHED_CHATS = 3;
export const ATTACH_SCOPE_RECENT_TURNS = 16;
export const ATTACH_SCOPE_FULL_TURNS = 40;
export const RECENT_ATTACH_STORAGE_KEY = "grok.recentAttachChatIds";
const RECENT_ATTACH_MAX = 12;

/** How much of the source journal is expanded on send. */
export type ChatAttachScope = "recent" | "user" | "full";

export const CHAT_ATTACH_SCOPES: ChatAttachScope[] = [
  "recent",
  "user",
  "full",
];

/** Standard UUID used as App session ids. */
export const CHAT_SESSION_ID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const CHAT_TOKEN_RE =
  /\[\[chat:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?::(recent|user|full))?\]\]/g;

export type ChatRef = {
  sessionId: string;
  title: string;
  /** Source session `updatedAt` when attached or last refreshed. */
  attachedUpdatedAt?: string;
  /** Default `recent` (last 16 user/assistant turns). */
  scope?: ChatAttachScope;
};

export type ChatAttachStatus = "ok" | "missing" | "archived";

export function parseChatAttachScope(
  raw?: string | null,
): ChatAttachScope {
  if (raw === "user" || raw === "full" || raw === "recent") return raw;
  return "recent";
}

export function nextChatAttachScope(
  cur?: ChatAttachScope | null,
): ChatAttachScope {
  const i = CHAT_ATTACH_SCOPES.indexOf(parseChatAttachScope(cur));
  return CHAT_ATTACH_SCOPES[(i + 1) % CHAT_ATTACH_SCOPES.length]!;
}

export function chatToken(
  sessionId: string,
  scope?: ChatAttachScope,
): string {
  const id = sessionId.trim();
  const sc = parseChatAttachScope(scope);
  return sc === "recent" ? `[[chat:${id}]]` : `[[chat:${id}:${sc}]]`;
}

/** HTML5 drag payload for sidebar → composer. */
export const GROK_SESSION_DRAG_MIME = "application/x-grok-session";
export const GROK_SESSION_DRAG_MIME_ALT = "text/x-grok-session";
/** WKWebView often only preserves standard types. JSON payload. */
export const GROK_SESSION_DRAG_TEXT = "text/plain";

export type SessionDragPayload = {
  id: string;
  title: string;
  updatedAt?: string;
};

export type AddChatRefResult = {
  refs: ChatRef[];
  added: boolean;
  reason?: "duplicate" | "self" | "limit" | "invalid";
};

export function isChatSessionId(id: string): boolean {
  return CHAT_SESSION_ID_RE.test(id.trim());
}

/** Ordered unique session ids from stored / draft text. */
export function extractChatSessionIds(content: string): string[] {
  if (!content) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(CHAT_TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const id = m[1]!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function parseChatTokens(
  content: string,
  titleOf?: (sessionId: string) => string,
): ChatRef[] {
  if (!content) return [];
  const out: ChatRef[] = [];
  const seen = new Set<string>();
  const re = new RegExp(CHAT_TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const sessionId = m[1]!;
    if (seen.has(sessionId)) continue;
    seen.add(sessionId);
    const scope = parseChatAttachScope(m[2]);
    out.push({
      sessionId,
      title: titleOf?.(sessionId) ?? "",
      scope: scope === "recent" ? undefined : scope,
    });
  }
  return out;
}

/** Remove `[[chat:uuid]]` tokens. Collapses leftover blank runs at the edges. */
export function stripChatTokens(content: string): string {
  if (!content) return content;
  const stripped = content.replace(new RegExp(CHAT_TOKEN_RE.source, "g"), "");
  return stripped.replace(/[ \t]+\n/g, "\n").replace(/^\n+/, "").replace(/\n+$/, "");
}

export function serializeChatTokens(refs: ChatRef[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const r of refs) {
    const id = r.sessionId.trim();
    if (!isChatSessionId(id) || seen.has(id)) continue;
    seen.add(id);
    parts.push(chatToken(id, r.scope));
  }
  return parts.join("");
}

/**
 * Put chat tokens at the front of stored display so user bubbles render chips
 * first, then the typed prompt. Existing tokens in `display` are stripped first.
 */
export function prependChatTokens(display: string, refs: ChatRef[]): string {
  const tokens = serializeChatTokens(refs);
  const body = stripChatTokens(display);
  if (!tokens) return body;
  if (!body) return tokens;
  return `${tokens}\n${body}`;
}

export function addChatRef(
  prev: ChatRef[],
  next: ChatRef,
  opts?: { currentId?: string | null },
): AddChatRefResult {
  const id = next.sessionId.trim();
  if (!isChatSessionId(id)) {
    return { refs: prev, added: false, reason: "invalid" };
  }
  const current = (opts?.currentId ?? "").trim();
  if (current && id === current) {
    return { refs: prev, added: false, reason: "self" };
  }
  if (prev.some((r) => r.sessionId === id)) {
    return { refs: prev, added: false, reason: "duplicate" };
  }
  if (prev.length >= MAX_ATTACHED_CHATS) {
    return { refs: prev, added: false, reason: "limit" };
  }
  const title = (next.title || "").trim();
  const attachedUpdatedAt = (next.attachedUpdatedAt || "").trim() || undefined;
  const scope = parseChatAttachScope(next.scope);
  return {
    refs: [
      ...prev,
      {
        sessionId: id,
        title,
        attachedUpdatedAt,
        scope: scope === "recent" ? undefined : scope,
      },
    ],
    added: true,
  };
}

export function setChatRefScope(
  prev: ChatRef[],
  sessionId: string,
  scope: ChatAttachScope,
): ChatRef[] {
  return prev.map((r) =>
    r.sessionId === sessionId
      ? { ...r, scope: scope === "recent" ? undefined : scope }
      : r,
  );
}

export function removeChatRef(prev: ChatRef[], sessionId: string): ChatRef[] {
  return prev.filter((r) => r.sessionId !== sessionId);
}

export type AttachableSession = {
  id: string;
  title: string;
  projectId?: string | null;
  updatedAt?: string;
  archived?: boolean;
};

/**
 * Sessions the user can attach into the current chat.
 * Excludes self, archived (by default), and already-attached ids.
 */
export function filterAttachableSessions(
  sessions: AttachableSession[],
  opts?: {
    currentId?: string | null;
    alreadyIds?: Iterable<string>;
    query?: string;
    includeArchived?: boolean;
    max?: number;
    currentProjectId?: string | null;
    recentIds?: Iterable<string>;
  },
): AttachableSession[] {
  const current = (opts?.currentId ?? "").trim();
  const already = new Set(
    [...(opts?.alreadyIds ?? [])].map((s) => s.trim()).filter(Boolean),
  );
  const includeArchived = opts?.includeArchived === true;
  const max = opts?.max ?? 40;
  const q = (opts?.query ?? "").trim().toLowerCase();
  const recent = [...(opts?.recentIds ?? [])]
    .map((s) => s.trim())
    .filter(Boolean);
  const recentRank = new Map(recent.map((id, i) => [id, i]));
  const projectId = (opts?.currentProjectId ?? "").trim();

  const out: AttachableSession[] = [];
  for (const s of sessions) {
    if (!s.id || s.id === current) continue;
    if (already.has(s.id)) continue;
    if (!includeArchived && s.archived) continue;
    if (q) {
      const title = (s.title || "").toLowerCase();
      if (!title.includes(q) && !s.id.toLowerCase().includes(q)) continue;
    }
    out.push(s);
  }
  out.sort((a, b) => {
    const ra = recentRank.has(a.id) ? recentRank.get(a.id)! : 999;
    const rb = recentRank.has(b.id) ? recentRank.get(b.id)! : 999;
    if (ra !== rb) return ra - rb;
    if (projectId) {
      const ap = a.projectId === projectId ? 0 : 1;
      const bp = b.projectId === projectId ? 0 : 1;
      if (ap !== bp) return ap - bp;
    }
    const ta = parseStamp(a.updatedAt);
    const tb = parseStamp(b.updatedAt);
    const na = Number.isFinite(ta) ? ta : 0;
    const nb = Number.isFinite(tb) ? tb : 0;
    return nb - na;
  });
  return out.slice(0, max);
}

export function lookupChatStatus(
  sessionId: string,
  sessions: { id: string; archived?: boolean }[],
): ChatAttachStatus {
  const hit = sessions.find((s) => s.id === sessionId);
  if (!hit) return "missing";
  if (hit.archived) return "archived";
  return "ok";
}

export function loadRecentAttachIds(
  storage: Pick<Storage, "getItem"> | null = defaultAttachStorage(),
): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_ATTACH_STORAGE_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of v) {
      if (typeof item !== "string" || !isChatSessionId(item) || seen.has(item)) {
        continue;
      }
      seen.add(item);
      out.push(item);
      if (out.length >= RECENT_ATTACH_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function rememberRecentAttach(
  sessionId: string,
  storage: Pick<Storage, "getItem" | "setItem"> | null = defaultAttachStorage(),
): string[] {
  const id = sessionId.trim();
  const prev = loadRecentAttachIds(storage);
  if (!isChatSessionId(id) || !storage) return prev;
  const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_ATTACH_MAX);
  try {
    storage.setItem(RECENT_ATTACH_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}

function defaultAttachStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function attachSessionBadge(
  session: AttachableSession,
  opts?: {
    recentIds?: Iterable<string>;
    currentProjectId?: string | null;
  },
): "recent" | "project" | null {
  const recent = new Set(
    [...(opts?.recentIds ?? [])].map((s) => s.trim()).filter(Boolean),
  );
  if (recent.has(session.id)) return "recent";
  const proj = (opts?.currentProjectId ?? "").trim();
  if (proj && session.projectId === proj) return "project";
  return null;
}

export function lookupChatTitle(
  sessionId: string,
  sessions: { id: string; title: string }[],
  fallback = "",
): string {
  const hit = sessions.find((s) => s.id === sessionId);
  const title = (hit?.title ?? "").trim();
  return title || fallback;
}

export function encodeSessionDrag(payload: SessionDragPayload): string {
  return JSON.stringify({
    id: payload.id,
    title: payload.title ?? "",
    updatedAt: payload.updatedAt ?? "",
  });
}

export function parseSessionDrag(raw: string | null | undefined): SessionDragPayload | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!isChatSessionId(id)) return null;
    const title = typeof o.title === "string" ? o.title : "";
    const updatedAt =
      typeof o.updatedAt === "string" && o.updatedAt.trim()
        ? o.updatedAt.trim()
        : undefined;
    return { id, title, updatedAt };
  } catch {
    return null;
  }
}

export function dataTransferHasSession(
  dt: DataTransfer | null | undefined,
): boolean {
  if (!dt) return false;
  const types = Array.from(dt.types ?? []);
  if (
    types.includes(GROK_SESSION_DRAG_MIME) ||
    types.includes(GROK_SESSION_DRAG_MIME_ALT)
  ) {
    return true;
  }
  if (!types.includes(GROK_SESSION_DRAG_TEXT)) return false;
  try {
    return parseSessionDrag(dt.getData(GROK_SESSION_DRAG_TEXT)) != null;
  } catch {
    return false;
  }
}

export function parseSessionDragFromTransfer(
  dt: DataTransfer | null | undefined,
): SessionDragPayload | null {
  if (!dt) return null;
  for (const mime of [
    GROK_SESSION_DRAG_MIME,
    GROK_SESSION_DRAG_MIME_ALT,
    GROK_SESSION_DRAG_TEXT,
  ]) {
    try {
      const parsed = parseSessionDrag(dt.getData(mime));
      if (parsed) return parsed;
    } catch {
      /* getData can throw on some dragover paths */
    }
  }
  return null;
}

/** Prefer the in-memory payload (same-document); fall back to DataTransfer. */
export function takeSessionDragPayload(
  held: SessionDragPayload | null | undefined,
  dt?: DataTransfer | null,
): SessionDragPayload | null {
  if (held && isChatSessionId(held.id)) return held;
  return parseSessionDragFromTransfer(dt);
}

function parseStamp(raw: string | undefined | null): number {
  if (!raw) return Number.NaN;
  const n = Date.parse(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** True when the source session is newer than the attach snapshot. */
export function chatHasUpdate(
  ref: ChatRef,
  sessions: { id: string; updatedAt?: string }[],
): boolean {
  const attached = parseStamp(ref.attachedUpdatedAt);
  if (!Number.isFinite(attached)) return false;
  const src = sessions.find((s) => s.id === ref.sessionId);
  const incoming = parseStamp(src?.updatedAt);
  if (!Number.isFinite(incoming)) return false;
  return incoming > attached;
}

export function staleAttachedChats(
  refs: ChatRef[],
  sessions: { id: string; updatedAt?: string }[],
): ChatRef[] {
  return refs.filter((r) => chatHasUpdate(r, sessions));
}

export function refreshChatRef(
  prev: ChatRef[],
  sessionId: string,
  next: { updatedAt?: string; title?: string },
): ChatRef[] {
  return prev.map((r) => {
    if (r.sessionId !== sessionId) return r;
    const title = (next.title ?? r.title).trim() || r.title;
    const attachedUpdatedAt =
      (next.updatedAt || "").trim() || r.attachedUpdatedAt;
    return { ...r, title, attachedUpdatedAt };
  });
}

export function refreshStaleChatRefs(
  prev: ChatRef[],
  sessions: { id: string; title: string; updatedAt?: string }[],
): { refs: ChatRef[]; refreshed: number } {
  let refreshed = 0;
  const refs = prev.map((r) => {
    if (!chatHasUpdate(r, sessions)) return r;
    const src = sessions.find((s) => s.id === r.sessionId);
    if (!src) return r;
    refreshed += 1;
    return {
      ...r,
      title: (src.title || r.title).trim() || r.title,
      attachedUpdatedAt: src.updatedAt || r.attachedUpdatedAt,
    };
  });
  return { refs, refreshed };
}
