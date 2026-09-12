import { describe, expect, it } from "vitest";
import { mapStoredMessageToChat, mapStoredMessagesToChat } from "./mapStoredMessages";

describe("mapStoredMessages", () => {
  it("keeps structured user attachments for history cards", () => {
    const msg = mapStoredMessageToChat({
      id: "u-1",
      role: "user",
      content: "see this screenshot",
      createdAt: "2026-08-01T00:00:00.000Z",
      attachments: [
        {
          path: "/Users/me/Desktop/shot.png",
          name: "shot.png",
          isDir: false,
        },
      ],
    });
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("see this screenshot");
    expect(msg.attachments).toEqual([
      {
        path: "/Users/me/Desktop/shot.png",
        name: "shot.png",
        isDir: false,
      },
    ]);
  });

  it("parses @path lines when structured attachments are missing", () => {
    const msg = mapStoredMessageToChat({
      id: "u-2",
      role: "user",
      content: "docs please\n\n@/tmp/notes.md",
      createdAt: "2026-08-01T00:00:00.000Z",
      attachments: null,
    });
    expect(msg.content).toBe("docs please");
    expect(msg.attachments?.map((a) => a.path)).toEqual(["/tmp/notes.md"]);
  });

  it("keeps @/goal prose in the bubble instead of a missing-file chip (#1197)", () => {
    const msg = mapStoredMessageToChat({
      id: "u-goal",
      role: "user",
      content: "两句说明\n\n@/goal 你再检查优化一下吧",
      createdAt: "2026-08-01T00:00:00.000Z",
      attachments: null,
    });
    expect(msg.content).toBe("两句说明\n\n@/goal 你再检查优化一下吧");
    expect(msg.attachments).toBeUndefined();
  });

  it("maps a batch without dropping attachments", () => {
    const out = mapStoredMessagesToChat([
      {
        id: "u-1",
        role: "user",
        content: "hi",
        createdAt: "2026-08-01T00:00:00.000Z",
        attachments: [
          { path: "/a/b.pdf", name: "b.pdf", isDir: false },
        ],
      },
      {
        id: "a-1",
        role: "assistant",
        content: "ok",
        createdAt: "2026-08-01T00:00:01.000Z",
      },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.attachments).toHaveLength(1);
    expect(out[1]!.attachments).toBeUndefined();
  });

  it("dual-written @path lines become cards and are stripped from bubble text", () => {
    const msg = mapStoredMessageToChat({
      id: "u-3",
      role: "user",
      content:
        "see this screenshot\n\n@/Users/me/Desktop/shot.png\n@/tmp/notes.md",
      createdAt: "2026-08-01T00:00:00.000Z",
      attachments: null,
    });
    expect(msg.content).toBe("see this screenshot");
    expect(msg.attachments?.map((a) => a.path)).toEqual([
      "/Users/me/Desktop/shot.png",
      "/tmp/notes.md",
    ]);
  });

  it("merges structured attachments with dual-written @paths without dupes", () => {
    const msg = mapStoredMessageToChat({
      id: "u-4",
      role: "user",
      content: "hi\n\n@/Users/me/a.png",
      createdAt: "2026-08-01T00:00:00.000Z",
      attachments: [
        { path: "/Users/me/a.png", name: "a.png", isDir: false },
        { path: "/Users/me/b.pdf", name: "b.pdf", isDir: false },
      ],
    });
    expect(msg.content).toBe("hi");
    expect(msg.attachments?.map((a) => a.path).sort()).toEqual([
      "/Users/me/a.png",
      "/Users/me/b.pdf",
    ]);
  });

  it("preserves internal blank lines and skill tokens on user reload", () => {
    const body = "[[skill:aihot]] hello\n\nworld\n\nend";
    const msg = mapStoredMessageToChat({
      id: "u-5",
      role: "user",
      content: `${body}\n\n@/tmp/x.png`,
      createdAt: "2026-08-01T00:00:00.000Z",
      attachments: null,
    });
    expect(msg.content).toBe(body);
    expect(msg.content.includes("hello\n\nworld\n\nend")).toBe(true);
    expect(msg.attachments?.map((a) => a.path)).toEqual(["/tmp/x.png"]);
  });

  it("reloads hard-end chips with same reason as live turn_marker", () => {
    const cases: Array<{ content: string; reason: string; marker?: string }> = [
      {
        content: "turn_cancelled|user_stop",
        reason: "user_stop",
        marker: "turn_cancelled",
      },
      {
        content: "turn_cancelled|cli_upgrade",
        reason: "cli_upgrade",
        marker: "turn_cancelled",
      },
      {
        content: "turn_cancelled|permission_denied",
        reason: "permission_denied",
        marker: "turn_cancelled",
      },
      {
        content: "turn_cancelled|cancelled",
        reason: "cancelled",
      },
    ];
    for (const c of cases) {
      const msg = mapStoredMessageToChat({
        id: `m-${c.reason}`,
        role: "tool",
        content: c.content,
        marker: c.marker ?? null,
        createdAt: "2026-08-12T00:00:00.000Z",
      });
      expect(msg.marker).toBe("turn_cancelled");
      expect(msg.content).toBe(c.content);
      expect(msg.toolStatus).toBe(c.reason);
    }
  });
});
