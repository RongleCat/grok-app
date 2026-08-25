import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createT } from "@/i18n";
import {
  emptyLiveSnapshot,
  projectHostIntoLiveMap,
  type SessionLiveMap,
} from "./sessionLiveStore";
import { resetFinishedTurnsForTests } from "./sessionFinishedTurns";
import {
  AGENT_KANBAN_DEFAULT_COLUMNS,
  AGENT_KANBAN_PREFS_KEY,
  buildAgentKanban,
  cardsInAgentColumn,
  countAgentKanbanCards,
  createEmptyAgentKanbanBoard,
  createEmptyAgentKanbanPrefs,
  findAgentKanbanColumn,
  groupAgentKanbanByProject,
  loadAgentKanbanPrefs,
  mapTaskColumnToAgentKanban,
  markAgentKanbanSeen,
  mergeKanbanLiveMaps,
  saveAgentKanbanPrefs,
  visibleAgentKanbanColumns,
  type AgentKanbanStorage,
} from "./kanbanBoard";

afterEach(() => {
  resetFinishedTurnsForTests();
});

function memoryStore(initial?: Record<string, string>): AgentKanbanStorage {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

const projects = [
  { id: "p1", name: "grok-app", path: "/Users/me/Code/grok-app" },
];

function idsIn(
  board: ReturnType<typeof buildAgentKanban>,
  col: "needs_you" | "working" | "done" | "idle",
) {
  return cardsInAgentColumn(board, col).map((c) => c.sessionId);
}

function countVisible(board: ReturnType<typeof buildAgentKanban>) {
  return countAgentKanbanCards(board, AGENT_KANBAN_DEFAULT_COLUMNS);
}

describe("empty agent kanban", () => {
  it("starts with Orca's three default stages and no cards", () => {
    const board = createEmptyAgentKanbanBoard();
    expect([...AGENT_KANBAN_DEFAULT_COLUMNS]).toEqual([
      "needs_you",
      "working",
      "done",
    ]);
    expect(visibleAgentKanbanColumns(false)).toEqual([
      "needs_you",
      "working",
      "done",
    ]);
    expect(visibleAgentKanbanColumns(true)).toContain("idle");
    for (const col of AGENT_KANBAN_DEFAULT_COLUMNS) {
      expect(board[col]).toEqual([]);
    }
  });

  it("labels stages via i18n (not To Do / Doing)", () => {
    const en = createT("en");
    const zh = createT("zh");
    expect(en("kanban.column.needsYou")).toBe("Needs you");
    expect(en("kanban.column.working")).toBe("Working");
    expect(en("kanban.column.done")).toBe("Done");
    expect(zh("kanban.column.working")).toBe("工作中");
    expect(en("kanban.title")).toBe("Agents");
    expect(en("kanban.searchPlaceholder").toLowerCase()).toContain("worktree");
  });
});

describe("mapTaskColumnToAgentKanban", () => {
  it("maps permission/error → needs_you, running → working", () => {
    expect(mapTaskColumnToAgentKanban("needs_you")).toBe("needs_you");
    expect(mapTaskColumnToAgentKanban("error")).toBe("needs_you");
    expect(mapTaskColumnToAgentKanban("running")).toBe("working");
  });

  it("keeps finished idle in done until seen", () => {
    expect(mapTaskColumnToAgentKanban("done")).toBe("done");
    expect(mapTaskColumnToAgentKanban("done", { seenDone: true })).toBe("idle");
    expect(
      mapTaskColumnToAgentKanban("idle", { finishedTurn: true }),
    ).toBe("done");
    expect(
      mapTaskColumnToAgentKanban("idle", {
        finishedTurn: true,
        seenDone: true,
      }),
    ).toBe("idle");
    expect(mapTaskColumnToAgentKanban("idle")).toBe("idle");
  });
});

describe("buildAgentKanban (shipped buildTaskBoard path)", () => {
  it("places live agents on Needs You / Working only in that column", () => {
    const liveMap: SessionLiveMap = {
      a: {
        ...emptyLiveSnapshot("a", 100),
        state: "streaming",
        liveToolTitle: "bash",
        updatedAt: 5000,
      },
      b: {
        ...emptyLiveSnapshot("b", 50),
        state: "awaiting_permission",
        awaitingPermission: true,
        updatedAt: 4000,
      },
    };
    const board = buildAgentKanban({
      sessions: [
        { id: "a", title: "Fix CI", projectId: "p1" },
        { id: "b", title: "Review PR", projectId: "p1" },
      ],
      projects,
      liveMap,
      currentSessionId: "a",
    });
    expect(idsIn(board, "working")).toEqual(["a"]);
    expect(idsIn(board, "needs_you")).toEqual(["b"]);
    expect(idsIn(board, "done")).toEqual([]);
    expect(findAgentKanbanColumn(board, "a")).toBe("working");
    expect(findAgentKanbanColumn(board, "b")).toBe("needs_you");
    expect(board.working[0]!.liveToolTitle).toBe("bash");
  });

  it("moves a card only to the destination when live status changes", () => {
    const sessions = [{ id: "c1", title: "Ship it", projectId: "p1" }];
    const waiting: SessionLiveMap = {
      c1: {
        ...emptyLiveSnapshot("c1", 10),
        state: "awaiting_permission",
        awaitingPermission: true,
      },
    };
    const running: SessionLiveMap = {
      c1: {
        ...emptyLiveSnapshot("c1", 20),
        state: "streaming",
        liveToolTitle: "edit",
      },
    };
    const before = buildAgentKanban({ sessions, projects, liveMap: waiting });
    expect(findAgentKanbanColumn(before, "c1")).toBe("needs_you");
    expect(idsIn(before, "working")).toEqual([]);

    const after = buildAgentKanban({ sessions, projects, liveMap: running });
    expect(findAgentKanbanColumn(after, "c1")).toBe("working");
    expect(idsIn(after, "needs_you")).toEqual([]);
    expect(idsIn(after, "done")).toEqual([]);
    expect(idsIn(after, "idle")).toEqual([]);
  });

  it("does not treat a live agent as idle when liveMap is missing (sidebar-busy case)", () => {
    const sessions = [
      { id: "live-1", title: "内部SkillsHub开源…", projectId: "p1" },
    ];
    const empty = buildAgentKanban({
      sessions,
      projects,
      liveMap: {},
    });
    expect(findAgentKanbanColumn(empty, "live-1")).not.toBe("working");

    const live = buildAgentKanban({
      sessions,
      projects,
      liveMap: {
        "live-1": {
          ...emptyLiveSnapshot("live-1", 99),
          state: "streaming",
          liveToolTitle: "bash",
        },
      },
    });
    expect(findAgentKanbanColumn(live, "live-1")).toBe("working");
    expect(idsIn(live, "working")).toEqual(["live-1"]);
    expect(idsIn(live, "done")).toEqual([]);
  });

  it("does not dump archived chats into Done", () => {
    const archived = Array.from({ length: 12 }, (_, i) => ({
      id: `old-${i}`,
      title: `Old ${i}`,
      projectId: "p1",
      archived: true,
    }));
    const board = buildAgentKanban({
      sessions: archived,
      projects,
      liveMap: {},
    });
    expect(idsIn(board, "done")).toEqual([]);
    expect(countVisible(board)).toBe(0);
  });

  it("puts a finished turn in Done and keeps it after a liveMap remount", () => {
    const storage = memoryStore();
    const sessions = [
      { id: "done-1", title: "Wrapped up", projectId: "p1" },
    ];
    const liveMap = projectHostIntoLiveMap(
      projectHostIntoLiveMap(
        {},
        { sessionId: "done-1", state: "streaming" },
        1,
      ),
      { sessionId: "done-1", state: "ready" },
      2,
    );
    const open = buildAgentKanban({
      sessions,
      projects,
      liveMap,
      recentDoneAt: { "done-1": 2 },
    });
    expect(idsIn(open, "done")).toEqual(["done-1"]);
    expect(idsIn(open, "idle")).toEqual([]);

    let prefs = createEmptyAgentKanbanPrefs();
    prefs = markAgentKanbanSeen(prefs, "done-1", 2);
    saveAgentKanbanPrefs(prefs, storage);
    const loaded = loadAgentKanbanPrefs(storage);
    expect(loaded.seenDoneIds).toEqual(["done-1"]);
    expect(storage.getItem(AGENT_KANBAN_PREFS_KEY)).toBeTruthy();

    // Opening the card (legacy seen prefs) must not hide Done on remount.
    const remounted = buildAgentKanban({
      sessions,
      projects,
      liveMap: {},
      seenDoneIds: loaded.seenDoneIds,
      seenDoneAt: loaded.seenDoneAt,
      recentDoneAt: { "done-1": 2 },
    });
    expect(idsIn(remounted, "done")).toEqual(["done-1"]);
    expect(findAgentKanbanColumn(remounted, "done-1")).toBe("done");
  });

  it("does not put a cold ready snapshot (no terminalReason) in Done", () => {
    const board = buildAgentKanban({
      sessions: [{ id: "idle-1", title: "Just sitting", projectId: "p1" }],
      projects,
      liveMap: {
        "idle-1": {
          ...emptyLiveSnapshot("idle-1", 1),
          state: "ready",
          terminalReason: null,
        },
      },
      recentDoneAt: {},
    });
    expect(idsIn(board, "done")).toEqual([]);
    expect(findAgentKanbanColumn(board, "idle-1")).toBe("idle");
  });

  it("drops a remembered Done card once the session is working again", () => {
    const sessions = [{ id: "done-1", title: "Wrapped up", projectId: "p1" }];
    const working = buildAgentKanban({
      sessions,
      projects,
      liveMap: {
        "done-1": {
          ...emptyLiveSnapshot("done-1", 3),
          state: "streaming",
        },
      },
      recentDoneAt: { "done-1": 2 },
    });
    expect(idsIn(working, "working")).toEqual(["done-1"]);
    expect(idsIn(working, "done")).toEqual([]);
  });

  it("merges an empty workbench liveMap with the store", () => {
    const store = {
      a: { ...emptyLiveSnapshot("a"), state: "streaming" as const },
    };
    expect(mergeKanbanLiveMaps(store, {})).toBe(store);
    expect(mergeKanbanLiveMaps({}, store)).toBe(store);
    expect(mergeKanbanLiveMaps(store, store).a!.state).toBe("streaming");
  });

  it("groups the map view by project", () => {
    const board = buildAgentKanban({
      sessions: [
        { id: "a", title: "A", projectId: "p1" },
        { id: "b", title: "B", projectId: "p1" },
      ],
      projects,
      liveMap: {
        a: { ...emptyLiveSnapshot("a"), state: "streaming" },
        b: {
          ...emptyLiveSnapshot("b"),
          state: "awaiting_permission",
          awaitingPermission: true,
        },
      },
    });
    const groups = groupAgentKanbanByProject(board);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name).toBe("grok-app");
    expect(groups[0]!.cards.map((c) => c.sessionId).sort()).toEqual(["a", "b"]);
  });
});

describe("agent kanban surface is not a todo list", () => {
  const root = join(__dirname, "..");

  it("keeps wallpaper glass and contrast scoped to the agent board", () => {
    const css = readFileSync(
      join(root, "styles/workbench.part1b.css"),
      "utf8",
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\]\s+\.agent-kanban-page\s+\.agent-kanban__col\s*\{[^}]*background:\s*color-mix\([^;]*var\(--bg-elevated\) 68%[^;]*transparent[^;]*\);[^}]*backdrop-filter:\s*blur\(var\(--wallpaper-settings-blur, 14px\)\)/s,
    );
    expect(css).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\]\s+\.agent-kanban-page\s+\.settings-input\s*\{[^}]*background:\s*color-mix\([^;]*var\(--bg-input\) 72%[^;]*transparent/s,
    );
    expect(css).toMatch(
      /html\[data-theme="dark"\]\[data-wallpaper="1"\]\s+\.agent-kanban-page\s+\.settings-input\s*\{[^}]*background:\s*color-mix\([^;]*var\(--bg-input\) 68%[^;]*transparent/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\]\s+\.agent-kanban-page\s+:is\(\.agent-kanban__col-title, \.agent-kanban__col-count\)\s*\{[^}]*color:\s*var\(--text-primary\)/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\]\s+\.agent-kanban-page\s+:is\([^)]*\.agent-kanban__none[^)]*\.agent-kanban__card-age[^)]*\)\s*\{[^}]*color:\s*var\(--text-secondary\)/s,
    );
  });

  it("page uses live agent columns + i18n, not a GlassModal todo list", () => {
    const src = readFileSync(
      join(root, "components/KanbanBoardPage.tsx"),
      "utf8",
    );
    expect(src).toContain("createT");
    expect(src).toContain("buildAgentKanban");
    expect(src).toContain("kanban.column.needsYou");
    expect(src).toContain("kanban.column.working");
    expect(src).toContain("kanban.searchPlaceholder");
    expect(src).toContain("agent-kanban-page");
    expect(src).toContain("useLiveMap");
    expect(src).toContain("mergeKanbanLiveMaps");
    expect(src).toContain("getFinishedTurns");
    expect(src).not.toContain("markAgentKanbanSeen");
    expect(src).not.toContain("GlassModal");
    expect(src).not.toContain("kanban.create");
    expect(src).not.toMatch(/window\.(confirm|prompt|alert)/);
    expect(src).not.toMatch(/<select[\s>]/);
  });

  it("opens as a sidebar main-pane page, not a floating modal", () => {
    const palette = readFileSync(join(root, "lib/paletteActions.ts"), "utf8");
    expect(palette).toContain('id: "open-kanban"');
    expect(palette).toContain('id: "open-task-board"');
    const workbench = readFileSync(join(root, "app/AppWorkbench.tsx"), "utf8");
    const sessionModals = readFileSync(
      join(root, "app/WorkbenchSessionModals.tsx"),
      "utf8",
    );
    const chrome = workbench + sessionModals;
    const sidebar = readFileSync(join(root, "app/WorkbenchSidebar.tsx"), "utf8");
    expect(workbench).toContain("KanbanBoardPage");
    expect(workbench).toContain("navigateKanban");
    expect(chrome).toContain('hash = "#/kanban"');
    expect(sidebar).toContain('tr("sidebar.kanban")');
    expect(workbench).toContain('mainPane === "kanban"');
    expect(workbench).toContain("liveVoiceOpen ||");
    expect(workbench).toContain('mainPane === "kanban"');
    const liveWhen = workbench.slice(
      workbench.indexOf("liveMapEnabled:"),
      workbench.indexOf("liveMapEnabled:") + 420,
    );
    expect(liveWhen).toContain('mainPane === "kanban"');
    expect(chrome).toContain("SessionTaskBoardModal");
    expect(workbench).not.toContain("KanbanBoardHost");
    expect(workbench).not.toContain("openKanbanBoard");
    expect(workbench).toContain("onSelectSession={openSessionByIdHandler}");
    const app = readFileSync(join(root, "App.tsx"), "utf8");
    expect(app).not.toContain("KanbanBoardHost");
    expect(app).not.toContain("KanbanBoardPage");
  });
});
