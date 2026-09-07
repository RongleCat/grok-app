import { describe, expect, it } from "vitest";
import {
  applySessionMoveMeta,
  buildSessionMoveMenuTargets,
  classifySessionMoveError,
  evaluateSessionMove,
  isSameProjectDrop,
  parseSessionDropId,
  SESSION_DROP_ORPHAN,
  sessionIdsForDrag,
  sessionMoveCwdChanges,
  sessionMoveConfirmKeys,
} from "./sessionMoveProject";

const projA = {
  id: "a",
  name: "Alpha",
  path: "/tmp/alpha",
  trusted: true,
  pathOk: true,
};

const projB = {
  id: "b",
  name: "Beta",
  path: "/tmp/beta",
  trusted: true,
  pathOk: true,
};

const untrusted = {
  id: "u",
  name: "Unsafe",
  path: "/tmp/unsafe",
  trusted: false,
  pathOk: true,
};

const missing = {
  id: "m",
  name: "Missing",
  path: "/gone",
  trusted: true,
  pathOk: false,
};

describe("sessionMoveCwdChanges", () => {
  it("treats system:general as unbound", () => {
    expect(sessionMoveCwdChanges("system:general", null)).toBe(false);
    expect(sessionMoveCwdChanges("system:general", "a")).toBe(true);
  });

  it("is false when the project does not change", () => {
    expect(sessionMoveCwdChanges("a", "a")).toBe(false);
    expect(sessionMoveCwdChanges(null, null)).toBe(false);
  });
});

describe("evaluateSessionMove", () => {
  const session = {
    id: "s1",
    title: "Chat",
    projectId: null as string | null,
    agentSessionId: "agent-1",
    isWorktreeSession: false,
    worktreePath: null as string | null,
  };

  it("allows orphan → trusted project and requires confirm + agent reset", () => {
    const r = evaluateSessionMove({
      session,
      targetProjectId: "a",
      projects: [projA],
      busy: false,
    });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("ok");
    expect(r.needsConfirm).toBe(true);
    expect(r.clearAgentSession).toBe(true);
    expect(r.clearWorktree).toBe(true);
    expect(r.cwdChanges).toBe(true);
  });

  it("is a no-op when the session is already on that project", () => {
    const r = evaluateSessionMove({
      session: { ...session, projectId: "a" },
      targetProjectId: "a",
      projects: [projA],
      busy: false,
    });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("same_project");
    expect(r.needsConfirm).toBe(false);
    expect(r.clearAgentSession).toBe(false);
  });

  it("refuses a mid-turn session", () => {
    const r = evaluateSessionMove({
      session,
      targetProjectId: "a",
      projects: [projA],
      busy: true,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("busy");
  });

  it("refuses untrusted and missing folders", () => {
    expect(
      evaluateSessionMove({
        session,
        targetProjectId: "u",
        projects: [untrusted],
        busy: false,
      }).reason,
    ).toBe("untrusted");
    expect(
      evaluateSessionMove({
        session,
        targetProjectId: "m",
        projects: [missing],
        busy: false,
      }).reason,
    ).toBe("path_missing");
    expect(
      evaluateSessionMove({
        session,
        targetProjectId: "nope",
        projects: [projA],
        busy: false,
      }).reason,
    ).toBe("project_not_found");
  });

  it("allows a trusted SSH remote even if local pathOk is false", () => {
    const r = evaluateSessionMove({
      session,
      targetProjectId: "ssh",
      projects: [
        {
          id: "ssh",
          trusted: true,
          pathOk: false,
          sshAlias: "UTS",
        },
      ],
      busy: false,
    });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("ok");
  });

  it("allows project → other sessions with confirm", () => {
    const r = evaluateSessionMove({
      session: { ...session, projectId: "a" },
      targetProjectId: null,
      projects: [projA],
      busy: false,
    });
    expect(r.allowed).toBe(true);
    expect(r.needsConfirm).toBe(true);
    expect(r.clearAgentSession).toBe(true);
  });
});

describe("applySessionMoveMeta", () => {
  it("clears agent id and worktree when cwd changes", () => {
    const next = applySessionMoveMeta(
      {
        id: "s1",
        projectId: "a",
        agentSessionId: "agent-1",
        worktreePath: "/tmp/wt",
        worktreeBranch: "feat",
        isWorktreeSession: true,
      },
      "b",
    );
    expect(next.projectId).toBe("b");
    expect(next.agentSessionId).toBeNull();
    expect(next.worktreePath).toBeNull();
    expect(next.worktreeBranch).toBeNull();
    expect(next.isWorktreeSession).toBe(false);
  });

  it("leaves agent id alone when the project is unchanged", () => {
    const next = applySessionMoveMeta(
      {
        id: "s1",
        projectId: "a",
        agentSessionId: "agent-1",
        isWorktreeSession: false,
      },
      "a",
    );
    expect(next.agentSessionId).toBe("agent-1");
  });
});

describe("buildSessionMoveMenuTargets", () => {
  it("lists other projects plus Default workspace, skipping the current one", () => {
    const targets = buildSessionMoveMenuTargets({
      projects: [projA, projB, untrusted],
      currentProjectId: "a",
      otherSessionsLabel: "Default workspace",
    });
    expect(targets.map((t) => t.id)).toEqual([null, "b", "u"]);
    expect(targets[0]?.label).toBe("Default workspace");
    expect(targets.find((t) => t.id === "b")?.disabled).toBe(false);
    expect(targets.find((t) => t.id === "u")?.disabled).toBe(true);
    expect(targets.find((t) => t.id === "u")?.reason).toBe("untrusted");
  });

  it("omits Default workspace when the chat is already unbound", () => {
    const targets = buildSessionMoveMenuTargets({
      projects: [projA],
      currentProjectId: null,
      otherSessionsLabel: "Default workspace",
    });
    expect(targets.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("sessionMoveConfirmKeys", () => {
  it("uses the single-chat copy for one title", () => {
    const keys = sessionMoveConfirmKeys({
      count: 1,
    });
    expect(keys.title).toBe("session.move.title");
    expect(keys.message).toBe("session.move.confirm");
    expect(keys.action).toBe("session.move.action");
  });

  it("uses the bulk copy when moving several chats, including to Default workspace", () => {
    const keys = sessionMoveConfirmKeys({
      count: 3,
    });
    expect(keys.title).toBe("session.move.manyTitle");
    expect(keys.message).toBe("session.move.manyConfirm");
  });
});

describe("classifySessionMoveError", () => {
  it("maps host codes", () => {
    expect(classifySessionMoveError("session_move_busy")).toBe("busy");
    expect(classifySessionMoveError(new Error("session_move_untrusted"))).toBe(
      "untrusted",
    );
    expect(classifySessionMoveError("session_move_path_missing")).toBe(
      "path_missing",
    );
    expect(classifySessionMoveError("nope")).toBe("other");
  });
});

describe("parseSessionDropId", () => {
  it("maps the orphan marker and project ids", () => {
    expect(parseSessionDropId(SESSION_DROP_ORPHAN)).toEqual({
      hit: true,
      projectId: null,
    });
    expect(parseSessionDropId("proj-1")).toEqual({
      hit: true,
      projectId: "proj-1",
    });
    expect(parseSessionDropId("")).toEqual({ hit: false });
    expect(parseSessionDropId(null)).toEqual({ hit: false });
  });
});

describe("sessionIdsForDrag", () => {
  it("moves the whole selection when dragging a checked row", () => {
    expect(
      sessionIdsForDrag({
        draggedId: "s2",
        selectedIds: ["s1", "s2", "s3"],
        selectMode: true,
      }),
    ).toEqual(["s1", "s2", "s3"]);
  });

  it("moves only the dragged row when it is not selected", () => {
    expect(
      sessionIdsForDrag({
        draggedId: "s9",
        selectedIds: ["s1", "s2"],
        selectMode: true,
      }),
    ).toEqual(["s9"]);
  });

  it("moves only the dragged row outside select mode", () => {
    expect(
      sessionIdsForDrag({
        draggedId: "s1",
        selectedIds: ["s1", "s2"],
        selectMode: false,
      }),
    ).toEqual(["s1"]);
  });
});

describe("isSameProjectDrop", () => {
  it("is true when every row already lives on the target", () => {
    expect(
      isSameProjectDrop(
        [
          { projectId: "a" },
          { projectId: "a" },
        ],
        "a",
      ),
    ).toBe(true);
    expect(
      isSameProjectDrop([{ projectId: null }, { projectId: "system:general" }], null),
    ).toBe(true);
    expect(
      isSameProjectDrop([{ projectId: "a" }, { projectId: "b" }], "a"),
    ).toBe(false);
  });
});
