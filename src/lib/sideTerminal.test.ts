import { describe, expect, it } from "vitest";
import {
  classifyTerminalCwdHonesty,
  classifyTerminalSpawnCwd,
  classifyTerminalSpawnError,
  formatTerminalCommand,
  normalizeTerminalCwd,
  resolveTerminalCwd,
  resolveTerminalSpawnPlan,
  terminalCwdsEqual,
} from "./sideTerminal";

describe("resolveTerminalSpawnPlan", () => {
  it("uses $SHELL with -l -i and project cwd", () => {
    const plan = resolveTerminalSpawnPlan({
      env: { SHELL: "/bin/zsh", HOME: "/Users/me" },
      projectPath: "/Users/me/proj",
    });
    expect(plan.shell).toBe("/bin/zsh");
    expect(plan.args).toEqual(["-l", "-i"]);
    expect(plan.cwd).toBe("/Users/me/proj");
    expect(plan.fromEnv).toBe(true);
    expect(formatTerminalCommand(plan)).toBe("/bin/zsh -l -i");
  });

  it("falls back to home when no project", () => {
    const plan = resolveTerminalSpawnPlan({
      env: { SHELL: "/bin/bash", HOME: "/home/u" },
      projectPath: null,
    });
    expect(plan.cwd).toBe("/home/u");
  });

  it("defaults shell when SHELL missing", () => {
    const plan = resolveTerminalSpawnPlan({
      env: { HOME: "/Users/x" },
      platform: "darwin",
    });
    expect(plan.shell).toBe("/bin/zsh");
    expect(plan.fromEnv).toBe(false);
    expect(plan.args).toEqual(["-l", "-i"]);
  });
});

describe("resolveTerminalCwd / normalize", () => {
  it("normalizes trailing slashes and separators", () => {
    expect(normalizeTerminalCwd("/a/b/")).toBe("/a/b");
    expect(normalizeTerminalCwd("C:\\Users\\me\\")).toBe("C:/Users/me");
    expect(normalizeTerminalCwd("/")).toBe("/");
    expect(normalizeTerminalCwd("  ")).toBe("");
  });

  it("compares cwd paths honestly", () => {
    expect(terminalCwdsEqual("/proj", "/proj/")).toBe(true);
    expect(terminalCwdsEqual("C:/A", "c:\\a\\")).toBe(true);
    expect(terminalCwdsEqual("/a", "/b")).toBe(false);
  });

  it("prefers project, then home, then dot", () => {
    expect(
      resolveTerminalCwd({
        projectPath: "/p",
        home: "/h",
      }),
    ).toEqual({
      cwd: "/p",
      source: "project",
      requestedProject: "/p",
    });
    expect(
      resolveTerminalCwd({
        projectPath: "  ",
        home: "/h",
        env: {},
      }),
    ).toEqual({
      cwd: "/h",
      source: "home",
      requestedProject: null,
    });
    expect(
      resolveTerminalCwd({
        projectPath: null,
        home: "",
        env: {},
      }).source,
    ).toBe("dot");
  });
});

describe("classifyTerminalSpawnCwd", () => {
  it("matched project", () => {
    const r = classifyTerminalSpawnCwd({
      projectPath: "/proj",
      boundCwd: "/proj/",
      home: "/home",
    });
    expect(r.kind).toBe("matched_project");
  });

  it("project fallback when host used home", () => {
    const r = classifyTerminalSpawnCwd({
      projectPath: "/missing",
      boundCwd: "/Users/me",
      home: "/Users/me",
    });
    expect(r.kind).toBe("project_fallback");
    expect(r.boundCwd).toBe("/Users/me");
    expect(r.intended.cwd).toBe("/missing");
  });

  it("no project → home honesty class", () => {
    const r = classifyTerminalSpawnCwd({
      projectPath: null,
      boundCwd: "/Users/me",
      home: "/Users/me",
    });
    expect(r.kind).toBe("no_project_home");
  });
});

describe("classifyTerminalCwdHonesty", () => {
  it("host only", () => {
    const h = classifyTerminalCwdHonesty({ isTauri: false });
    expect(h.kind).toBe("host_only");
    expect(h.messageKey).toBe("side.terminal.hostOnly");
  });

  it("spawn failed with detail", () => {
    const h = classifyTerminalCwdHonesty({
      isTauri: true,
      spawnError: "spawn shell: ENOENT",
    });
    expect(h.kind).toBe("spawn_failed");
    expect(h.detail).toContain("ENOENT");
  });

  it("session ended", () => {
    const h = classifyTerminalCwdHonesty({
      isTauri: true,
      sessionEnded: true,
      boundCwd: "/p",
    });
    expect(h.kind).toBe("session_ended");
  });

  it("project fallback after spawn", () => {
    const spawnClassified = classifyTerminalSpawnCwd({
      projectPath: "/gone",
      boundCwd: "/home/u",
      home: "/home/u",
    });
    const h = classifyTerminalCwdHonesty({
      isTauri: true,
      ready: true,
      boundCwd: "/home/u",
      projectPath: "/gone",
      spawnClassified,
    });
    expect(h.kind).toBe("project_fallback");
  });

  it("project mismatch when active project changes (cannot chdir)", () => {
    const h = classifyTerminalCwdHonesty({
      isTauri: true,
      ready: true,
      boundCwd: "/old",
      projectPath: "/new",
    });
    expect(h.kind).toBe("project_mismatch");
    expect(h.boundCwd).toBe("/old");
    expect(h.desiredCwd).toBe("/new");
    expect(h.messageKey).toBe("side.terminal.cwd.projectMismatch");
  });

  it("no project honesty when running under home", () => {
    const h = classifyTerminalCwdHonesty({
      isTauri: true,
      ready: true,
      boundCwd: "/home/u",
      projectPath: null,
      home: "/home/u",
    });
    expect(h.kind).toBe("no_project");
  });

  it("none when project matches bound", () => {
    const h = classifyTerminalCwdHonesty({
      isTauri: true,
      ready: true,
      boundCwd: "/proj",
      projectPath: "/proj",
    });
    expect(h.kind).toBe("none");
  });
});

describe("classifyTerminalSpawnError", () => {
  it("maps host-only phrasing", () => {
    expect(classifyTerminalSpawnError("not tauri").kind).toBe("host_only");
  });

  it("maps generic spawn fail", () => {
    const r = classifyTerminalSpawnError(new Error("openpty: denied"));
    expect(r.kind).toBe("spawn_failed");
    expect(r.detail).toContain("openpty");
  });
});
