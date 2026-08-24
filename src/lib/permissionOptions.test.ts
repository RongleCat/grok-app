import { describe, expect, it } from "vitest";
import {
  displayPermissionPreview,
  fallbackSessionOptionId,
  formatPermissionSummary,
  mapPermissionButtons,
  normalizePermissionOptions,
  permissionDecisionHint,
} from "./permissionOptions";

describe("mapPermissionButtons (shipped)", () => {
  it("maps ACP optionIds from real options list", () => {
    const buttons = mapPermissionButtons([
      { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
      { optionId: "always-allow", name: "Allow always", kind: "allow_always" },
      { optionId: "reject-once", name: "Reject", kind: "reject_once" },
    ]);
    expect(buttons.map((b) => b.optionId)).toEqual([
      "allow-once",
      "always-allow",
      "reject-once",
    ]);
    expect(buttons.map((b) => b.decision)).toEqual([
      "allow_once",
      "allow_session",
      "deny",
    ]);
  });

  it("falls back to hyphenated CLI wire ids when options empty (#523)", () => {
    const buttons = mapPermissionButtons([]);
    expect(buttons).toHaveLength(3);
    expect(buttons[0]!.decision).toBe("allow_once");
    expect(buttons[0]!.optionId).toBe("allow-once");
    expect(buttons[1]!.optionId).toBe("always-allow");
    expect(buttons[2]!.decision).toBe("deny");
    expect(buttons[2]!.optionId).toBe("reject-once");
  });

  it("uses tool-scoped session fallback when options empty (#542 / #544)", () => {
    expect(
      mapPermissionButtons([], undefined, "run_terminal_command")[1]!.optionId,
    ).toBe("allow-always-command");
    expect(mapPermissionButtons([], undefined, "execute")[1]!.optionId).toBe(
      "allow-always-command",
    );
    expect(mapPermissionButtons([], undefined, "web_fetch")[1]!.optionId).toBe(
      "allow-always-domain",
    );
    expect(mapPermissionButtons([], undefined, "use_tool")[1]!.optionId).toBe(
      "allow-always-mcp",
    );
  });

  it("maps bash allow-always-command as session button", () => {
    const buttons = mapPermissionButtons([
      { optionId: "allow-once", kind: "allow_once" },
      { optionId: "allow-always-command", kind: "allow_always" },
      { optionId: "reject-once", kind: "reject_once" },
    ]);
    expect(buttons[1]!.decision).toBe("allow_session");
    expect(buttons[1]!.optionId).toBe("allow-always-command");
  });

  it("maps allow_always_bash kind + bash name copy to session button", () => {
    const buttons = mapPermissionButtons([
      { optionId: "allow-once", kind: "allow_once" },
      {
        optionId: "allow-always-command",
        kind: "allow_always_bash",
        name: "Yes, and don't ask again for bash commands",
      },
      { optionId: "reject-once", kind: "reject_once" },
    ]);
    expect(buttons[1]!.decision).toBe("allow_session");
    expect(buttons[1]!.optionId).toBe("allow-always-command");
  });

  it("prefers short i18n labels over long agent names", () => {
    const buttons = mapPermissionButtons(
      [{ optionId: "allow-once", name: "Allow this bash command once", kind: "allow_once" }],
      { allowOnce: "Allow once", allowSession: "Allow for session", deny: "Deny" },
    );
    expect(buttons[0]!.label).toBe("Allow once");
  });

  it("does not bind session chip to reject-always via name", () => {
    const buttons = mapPermissionButtons([
      { optionId: "allow-once", kind: "allow_once" },
      {
        optionId: "reject-always",
        kind: "reject_always",
        name: "Reject always for this session",
      },
    ]);
    expect(buttons[1]!.decision).toBe("allow_session");
    expect(buttons[1]!.optionId).not.toBe("reject-always");
    expect(buttons[1]!.optionId).toBe("allow-once");
  });

  it("session-allow on write/edit lists uses allow-once wire id (#600)", () => {
    const buttons = mapPermissionButtons(
      [
        { optionId: "allow-once", kind: "allow_once" },
        { optionId: "reject-once", kind: "reject_once" },
      ],
      undefined,
      "search_replace",
    );
    expect(buttons[1]!.decision).toBe("allow_session");
    expect(buttons[1]!.optionId).toBe("allow-once");
  });

  it("unwraps ACP params blobs that nest the option list", () => {
    const wrapped = {
      options: [
        { optionId: "allow-once", kind: "allow_once" },
        { optionId: "reject-once", kind: "reject_once" },
      ],
      sessionId: "01aa",
    };
    expect(normalizePermissionOptions(wrapped)).toHaveLength(2);
    const buttons = mapPermissionButtons(
      wrapped,
      undefined,
      "run_terminal_command",
    );
    expect(buttons[0]!.optionId).toBe("allow-once");
    expect(buttons[2]!.optionId).toBe("reject-once");
  });
});

describe("fallbackSessionOptionId", () => {
  it("maps shell / fetch / mcp families", () => {
    expect(fallbackSessionOptionId("run_terminal_command")).toBe(
      "allow-always-command",
    );
    expect(fallbackSessionOptionId("web_fetch")).toBe("allow-always-domain");
    expect(fallbackSessionOptionId("mcp_foo")).toBe("allow-always-mcp");
    expect(fallbackSessionOptionId("read_file")).toBe("allow-always");
    expect(fallbackSessionOptionId("write")).toBe("allow-always");
    expect(fallbackSessionOptionId("search_replace")).toBe("allow-always");
    expect(fallbackSessionOptionId("unknown_tool")).toBe("always-allow");
  });
});

describe("formatPermissionSummary", () => {
  it("prefers command text when present", () => {
    expect(
      formatPermissionSummary({
        toolName: "bash",
        command: "rm -rf /tmp/foo",
      }),
    ).toBe("bash: rm -rf /tmp/foo");
  });

  it("does not treat ACP permission JSON dumps as the command", () => {
    const dump =
      '{"options":[{"kind":"allow_once","optionId":"allow-once"},{"kind":"reject_once","optionId":"reject-once"}],"sessionId":"01aa"}';
    expect(
      formatPermissionSummary({
        toolName: "run_terminal_command",
        title: "Execute `python ./get_context.py`",
        command: dump,
      }),
    ).toBe("run_terminal_command");
    expect(displayPermissionPreview(dump)).toBe("");
    expect(displayPermissionPreview("python ./get_context.py")).toBe(
      "python ./get_context.py",
    );
  });

  it("falls back to path", () => {
    expect(
      formatPermissionSummary({
        toolName: "write",
        path: "src/App.tsx",
      }),
    ).toBe("write · src/App.tsx");
  });

  it("truncates long commands", () => {
    const long = "x".repeat(120);
    const s = formatPermissionSummary({ command: long });
    expect(s.endsWith("…")).toBe(true);
    expect(s.length).toBeLessThan(long.length);
  });
});

describe("permissionDecisionHint", () => {
  it("explains once / session / deny", () => {
    expect(permissionDecisionHint("allow_once")).toMatch(/once/i);
    expect(permissionDecisionHint("allow_session")).toMatch(/session|chat/i);
    expect(permissionDecisionHint("deny")).toMatch(/block/i);
  });
});
