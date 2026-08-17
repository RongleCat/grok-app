/**
 * Agent-run Kanban — Orca-style columns over live App sessions.
 *
 * Cards are agent sessions (not user to-dos). Placement is derived from
 * Host liveMap + session meta via `buildTaskBoard`. Opening a Done card
 * marks it seen so it can move toward Idle (persisted, injectable store).
 */

import {
  buildTaskBoard,
  filterTaskBoard,
  type TaskBoard,
  type TaskBoardCard,
  type TaskBoardColumn,
} from "./sessionTaskBoard";
import type {
  AgentDashboardProjectInput,
  AgentDashboardSessionInput,
} from "./agentDashboard";
import type { SessionLiveMap } from "./sessionLiveStore";
import { getFinishedTurns } from "./sessionFinishedTurns";

/** Orca Agent Dashboard columns. Idle is hidden unless prefs say otherwise. */
export type AgentKanbanColumnId =
  | "needs_you"
  | "working"
  | "done"
  | "idle";

export const AGENT_KANBAN_COLUMN_IDS: readonly AgentKanbanColumnId[] = [
  "needs_you",
  "working",
  "done",
  "idle",
] as const;

/** Default visible stages (Idle off, matching Orca). */
export const AGENT_KANBAN_DEFAULT_COLUMNS: readonly AgentKanbanColumnId[] = [
  "needs_you",
  "working",
  "done",
] as const;

export const AGENT_KANBAN_PREFS_KEY = "grok-app.agentKanbanPrefs";

export type AgentKanbanCard = TaskBoardCard & {
  kanbanColumn: AgentKanbanColumnId;
};

export type AgentKanbanBoard = Record<AgentKanbanColumnId, AgentKanbanCard[]>;

export type AgentKanbanPrefs = {
  /** Session ids the user already opened from Done (move toward Idle). */
  seenDoneIds: string[];
  /** Opened-at (ms) per session; a later live `updatedAt` is a new Done turn. */
  seenDoneAt: Record<string, number>;
  /** When true, the Idle column is shown (Orca board-settings). */
  showIdle: boolean;
};

export interface AgentKanbanStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): AgentKanbanStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return { getItem: () => null, setItem: () => {} };
}

export function createEmptyAgentKanbanPrefs(): AgentKanbanPrefs {
  return { seenDoneIds: [], seenDoneAt: {}, showIdle: false };
}

/** Prefer the store; fall back to the workbench prop when it is empty. */
export function mergeKanbanLiveMaps(
  store: SessionLiveMap | null | undefined,
  prop: SessionLiveMap | null | undefined,
): SessionLiveMap {
  const fromStore = store ?? {};
  const fromProp = prop ?? {};
  if (Object.keys(fromStore).length === 0) return fromProp;
  if (Object.keys(fromProp).length === 0) return fromStore;
  return { ...fromProp, ...fromStore };
}

export function createEmptyAgentKanbanBoard(): AgentKanbanBoard {
  return {
    needs_you: [],
    working: [],
    done: [],
    idle: [],
  };
}

export function visibleAgentKanbanColumns(
  showIdle: boolean,
): readonly AgentKanbanColumnId[] {
  return showIdle
    ? AGENT_KANBAN_COLUMN_IDS
    : AGENT_KANBAN_DEFAULT_COLUMNS;
}

/**
 * Map a session-task-board column + live hints onto an Orca kanban column.
 * Error/blocked joins Needs You (attention). Finished idle sits in Done
 * until marked seen.
 */
export function mapTaskColumnToAgentKanban(
  column: TaskBoardColumn,
  opts: { seenDone?: boolean; finishedTurn?: boolean } = {},
): AgentKanbanColumnId {
  if (column === "needs_you" || column === "error") return "needs_you";
  if (column === "running") return "working";
  const seen = opts.seenDone === true;
  if (column === "done") return seen ? "idle" : "done";
  // idle
  if (opts.finishedTurn && !seen) return "done";
  return "idle";
}

export function cardsInAgentColumn(
  board: AgentKanbanBoard,
  columnId: AgentKanbanColumnId,
): AgentKanbanCard[] {
  return board[columnId] ?? [];
}

export function findAgentKanbanColumn(
  board: AgentKanbanBoard,
  sessionId: string,
): AgentKanbanColumnId | null {
  for (const col of AGENT_KANBAN_COLUMN_IDS) {
    if (board[col].some((c) => c.sessionId === sessionId)) return col;
  }
  return null;
}

function projectTaskBoard(
  taskBoard: TaskBoard,
  liveMap: SessionLiveMap,
  recentDoneAt: Readonly<Record<string, number>>,
): AgentKanbanBoard {
  const out = createEmptyAgentKanbanBoard();
  const cols: TaskBoardColumn[] = [
    "needs_you",
    "running",
    "error",
    "idle",
    "done",
  ];
  for (const src of cols) {
    for (const card of taskBoard[src]) {
      const snap = liveMap[card.sessionId];
      const finishedTurn =
        snap?.terminalReason != null ||
        recentDoneAt[card.sessionId] != null;
      const dest = mapTaskColumnToAgentKanban(card.column, {
        finishedTurn,
      });
      out[dest].push({ ...card, kanbanColumn: dest });
    }
  }
  return out;
}

export type BuildAgentKanbanOpts = {
  sessions: AgentDashboardSessionInput[];
  liveMap: SessionLiveMap;
  projects: AgentDashboardProjectInput[];
  currentSessionId?: string | null;
  untitledLabel?: string;
  generalWorkspacePath?: string | null;
  unboundProjectLabel?: string | null;
  seenDoneIds?: Iterable<string>;
  seenDoneAt?: Readonly<Record<string, number>>;
  /** sessionId → finish time; keeps Done after liveMap remount. */
  recentDoneAt?: Readonly<Record<string, number>>;
};

/**
 * Build the agent-run board from live sessions.
 * Archived idle chats stay off the board (Orca Done is a just-finished turn,
 * not the archive). Live-busy archived rows still appear via buildTaskBoard.
 */
export function buildAgentKanban(opts: BuildAgentKanbanOpts): AgentKanbanBoard {
  const recentDoneAt = opts.recentDoneAt ?? getFinishedTurns();
  const taskBoard = buildTaskBoard({
    sessions: opts.sessions,
    liveMap: opts.liveMap,
    projects: opts.projects,
    currentSessionId: opts.currentSessionId,
    includeArchived: false,
    untitledLabel: opts.untitledLabel,
    generalWorkspacePath: opts.generalWorkspacePath,
    unboundProjectLabel: opts.unboundProjectLabel,
  });
  return projectTaskBoard(taskBoard, opts.liveMap, recentDoneAt);
}

export function filterAgentKanban(
  board: AgentKanbanBoard,
  filter: { query?: string; projectQuery?: string } = {},
): AgentKanbanBoard {
  const asTask: TaskBoard = {
    needs_you: board.needs_you,
    running: board.working,
    idle: board.idle,
    done: board.done,
    error: [],
  };
  const filtered = filterTaskBoard(asTask, filter);
  return {
    needs_you: filtered.needs_you.map((c) => ({
      ...c,
      kanbanColumn: "needs_you" as const,
    })),
    working: filtered.running.map((c) => ({
      ...c,
      kanbanColumn: "working" as const,
    })),
    done: filtered.done.map((c) => ({ ...c, kanbanColumn: "done" as const })),
    idle: filtered.idle.map((c) => ({ ...c, kanbanColumn: "idle" as const })),
  };
}

export type AgentKanbanProjectGroup = {
  key: string;
  name: string;
  path: string | null;
  cards: AgentKanbanCard[];
};

/** Agent Map: nest cards under project / worktree. */
export function groupAgentKanbanByProject(
  board: AgentKanbanBoard,
  columns: readonly AgentKanbanColumnId[] = AGENT_KANBAN_DEFAULT_COLUMNS,
): AgentKanbanProjectGroup[] {
  const order: string[] = [];
  const map = new Map<string, AgentKanbanProjectGroup>();
  for (const col of columns) {
    for (const card of board[col]) {
      const key = card.projectPath || card.projectName || "__none__";
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          name: card.projectName || card.projectPath || "",
          path: card.projectPath,
          cards: [],
        };
        map.set(key, group);
        order.push(key);
      }
      group.cards.push(card);
    }
  }
  return order.map((k) => map.get(k)!);
}

export function countAgentKanbanCards(
  board: AgentKanbanBoard,
  columns: readonly AgentKanbanColumnId[] = AGENT_KANBAN_DEFAULT_COLUMNS,
): number {
  let n = 0;
  for (const col of columns) n += board[col].length;
  return n;
}

/** True when this finish was already opened. A later `finishedAt` is a new turn. */
export function isAgentKanbanSeenDone(
  seenDoneAt: Readonly<Record<string, number>> | undefined,
  seenDoneIds: ReadonlySet<string> | Iterable<string> | undefined,
  sessionId: string,
  finishedAt: number,
): boolean {
  const at = seenDoneAt?.[sessionId];
  if (typeof at === "number" && Number.isFinite(at)) {
    return at >= finishedAt;
  }
  if (!seenDoneIds) return false;
  if (seenDoneIds instanceof Set) return seenDoneIds.has(sessionId);
  for (const id of seenDoneIds) {
    if (id === sessionId) return true;
  }
  return false;
}

/** Persist: opening a Done card marks it seen (Orca Done → Idle). */
export function markAgentKanbanSeen(
  prefs: AgentKanbanPrefs,
  sessionId: string,
  seenAt: number = Date.now(),
): AgentKanbanPrefs {
  const id = sessionId.trim();
  if (!id) return prefs;
  const at = Number.isFinite(seenAt) ? seenAt : Date.now();
  const already = prefs.seenDoneIds.includes(id);
  if (already && prefs.seenDoneAt[id] === at) return prefs;
  return {
    ...prefs,
    seenDoneIds: already ? prefs.seenDoneIds : [...prefs.seenDoneIds, id],
    seenDoneAt: { ...prefs.seenDoneAt, [id]: at },
  };
}

export function parseAgentKanbanPrefs(raw: unknown): AgentKanbanPrefs {
  const empty = createEmptyAgentKanbanPrefs();
  let data: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return empty;
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      return empty;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return empty;
  const rec = data as Record<string, unknown>;
  const ids = Array.isArray(rec.seenDoneIds)
    ? rec.seenDoneIds.filter((x): x is string => typeof x === "string" && !!x)
    : [];
  const seenDoneAt: Record<string, number> = {};
  if (rec.seenDoneAt && typeof rec.seenDoneAt === "object" && !Array.isArray(rec.seenDoneAt)) {
    for (const [key, value] of Object.entries(
      rec.seenDoneAt as Record<string, unknown>,
    )) {
      if (!key || typeof value !== "number" || !Number.isFinite(value)) continue;
      seenDoneAt[key] = value;
    }
  }
  return {
    seenDoneIds: [...new Set([...ids, ...Object.keys(seenDoneAt)])],
    seenDoneAt,
    showIdle: rec.showIdle === true,
  };
}

export function serializeAgentKanbanPrefs(prefs: AgentKanbanPrefs): string {
  return JSON.stringify({
    seenDoneIds: prefs.seenDoneIds,
    seenDoneAt: prefs.seenDoneAt,
    showIdle: prefs.showIdle === true,
  });
}

export function loadAgentKanbanPrefs(
  storage: AgentKanbanStorage = defaultStorage(),
): AgentKanbanPrefs {
  try {
    const raw = storage.getItem(AGENT_KANBAN_PREFS_KEY);
    if (!raw) return createEmptyAgentKanbanPrefs();
    return parseAgentKanbanPrefs(raw);
  } catch {
    return createEmptyAgentKanbanPrefs();
  }
}

export function saveAgentKanbanPrefs(
  prefs: AgentKanbanPrefs,
  storage: AgentKanbanStorage = defaultStorage(),
): void {
  try {
    storage.setItem(AGENT_KANBAN_PREFS_KEY, serializeAgentKanbanPrefs(prefs));
  } catch {
    /* private mode / quota */
  }
}
