import { describe, expect, it } from "vitest";
import {
  classifyWorkflowSlashLine,
  classifyWorkflowSlashQuery,
  leftoverWorkflowArgs,
  resolveWorkflowSlashAction,
  stripWorkflowSlashFromDraft,
} from "./workflowSlash";

describe("classifyWorkflowSlashQuery", () => {
  it("treats workflow / workflows with no args as dashboard", () => {
    expect(classifyWorkflowSlashQuery("workflow")).toEqual({
      kind: "dashboard",
    });
    expect(classifyWorkflowSlashQuery("workflows")).toEqual({
      kind: "dashboard",
    });
    expect(classifyWorkflowSlashQuery("WORKFLOWS extra")).toEqual({
      kind: "dashboard",
    });
  });

  it("passes /workflow args through as a session command", () => {
    expect(classifyWorkflowSlashQuery("workflow review-changes")).toEqual({
      kind: "session",
      command: "/workflow review-changes",
    });
    expect(
      classifyWorkflowSlashQuery('workflow pause review-changes'),
    ).toEqual({
      kind: "session",
      command: "/workflow pause review-changes",
    });
  });

  it("returns null for other queries", () => {
    expect(classifyWorkflowSlashQuery("compact")).toBeNull();
    expect(classifyWorkflowSlashQuery("")).toBeNull();
    expect(classifyWorkflowSlashQuery(null)).toBeNull();
  });
});

describe("classifyWorkflowSlashLine", () => {
  it("matches a lone first line", () => {
    expect(classifyWorkflowSlashLine("  /workflows  ")).toEqual({
      kind: "dashboard",
    });
    expect(classifyWorkflowSlashLine("/workflow")).toEqual({
      kind: "dashboard",
    });
    expect(classifyWorkflowSlashLine("/workflow review-changes")).toEqual({
      kind: "session",
      command: "/workflow review-changes",
    });
  });

  it("ignores multi-paragraph drafts and non-slash text", () => {
    expect(
      classifyWorkflowSlashLine("/workflow review-changes\nplease run it"),
    ).toBeNull();
    expect(classifyWorkflowSlashLine("please /workflow review-changes")).toBeNull();
    expect(classifyWorkflowSlashLine("hello")).toBeNull();
  });
});

describe("leftoverWorkflowArgs + resolveWorkflowSlashAction", () => {
  it("reads the rest of the line after /workflow", () => {
    const stored = "/workflow review-changes";
    // slash token is `/workflow` → end = 9
    expect(leftoverWorkflowArgs(stored, "/workflow".length)).toBe(
      "review-changes",
    );
  });

  it("prefers leftover args over a bare workflow query", () => {
    expect(
      resolveWorkflowSlashAction({
        query: "workflow",
        leftoverArgs: "pause foo",
      }),
    ).toEqual({ kind: "session", command: "/workflow pause foo" });
  });

  it("forceDashboard wins", () => {
    expect(
      resolveWorkflowSlashAction({
        leftoverArgs: "review-changes",
        forceDashboard: true,
      }),
    ).toEqual({ kind: "dashboard" });
  });

  it("strips /workflow plus same-line args", () => {
    expect(
      stripWorkflowSlashFromDraft("/workflow review-changes", 0, 9),
    ).toBe("");
    expect(
      stripWorkflowSlashFromDraft("/workflow review-changes\nkeep", 0, 9),
    ).toBe("keep");
  });
});
