import { describe, expect, it } from "vitest";
import {
  buildForkWorktreeName,
  canRestoreCodeOnFork,
  isGitWorkingTreeDirty,
  sanitizeForkNameFragment,
} from "./sessionFork";

describe("isGitWorkingTreeDirty", () => {
  it("is false when unavailable or empty", () => {
    expect(isGitWorkingTreeDirty(null)).toBe(false);
    expect(isGitWorkingTreeDirty(undefined)).toBe(false);
    expect(isGitWorkingTreeDirty({ available: false, files: [{ path: "a" }] })).toBe(
      false,
    );
    expect(isGitWorkingTreeDirty({ available: true, files: [] })).toBe(false);
    expect(isGitWorkingTreeDirty({ available: true, files: null })).toBe(false);
  });

  it("is true when available and any files listed", () => {
    expect(
      isGitWorkingTreeDirty({
        available: true,
        files: [{ path: "src/a.ts" }],
      }),
    ).toBe(true);
    expect(
      isGitWorkingTreeDirty({
        available: true,
        files: [{}, {}],
      }),
    ).toBe(true);
  });
});

describe("canRestoreCodeOnFork", () => {
  it("requires a project path", () => {
    expect(canRestoreCodeOnFork("", { available: true, files: [] })).toEqual({
      ok: false,
      reason: "no_project",
    });
    expect(canRestoreCodeOnFork(null, { available: true, files: [] })).toEqual({
      ok: false,
      reason: "no_project",
    });
  });

  it("requires available git status", () => {
    expect(
      canRestoreCodeOnFork("/repo", { available: false, reason: "not a repo" }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(canRestoreCodeOnFork("/repo", null)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("refuses dirty trees", () => {
    expect(
      canRestoreCodeOnFork("/repo", {
        available: true,
        files: [{ path: "x" }],
      }),
    ).toEqual({ ok: false, reason: "dirty" });
  });

  it("allows clean git project", () => {
    expect(
      canRestoreCodeOnFork("/repo", { available: true, files: [] }),
    ).toEqual({ ok: true });
  });
});

describe("sanitizeForkNameFragment", () => {
  it("strips unsafe chars and caps length", () => {
    expect(sanitizeForkNameFragment("abc-def-ghi", 8)).toBe("abc-def-");
    expect(sanitizeForkNameFragment("!!@@", 8)).toBe("chat");
    expect(sanitizeForkNameFragment("  ab_12  ", 4)).toBe("ab_1");
    expect(sanitizeForkNameFragment("---x", 8)).toBe("x");
  });
});

describe("buildForkWorktreeName", () => {
  it("builds a stable sanitize-safe name", () => {
    const name = buildForkWorktreeName("a1b2c3d4-eeee-ffff", {
      now: 1_700_000_000_000,
      attempt: 0,
    });
    expect(name).toMatch(/^fork-a1b2c3d4-[a-z0-9]+$/);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name.startsWith("-")).toBe(false);
  });

  it("includes attempt suffix when retrying", () => {
    const name = buildForkWorktreeName("session-id", {
      now: 42,
      attempt: 2,
    });
    expect(name).toContain("-2");
    expect(name.startsWith("fork-")).toBe(true);
  });

  it("falls back when session id is empty", () => {
    const name = buildForkWorktreeName("", { now: 99, attempt: 0 });
    expect(name.startsWith("fork-chat-")).toBe(true);
  });
});
