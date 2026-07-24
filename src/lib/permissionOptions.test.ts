import { describe, expect, it } from "vitest";
import { mapPermissionButtons } from "./permissionOptions";

describe("mapPermissionButtons (shipped)", () => {
  it("maps ACP optionIds from real options list", () => {
    const buttons = mapPermissionButtons([
      { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
      { optionId: "allow_always", name: "Allow always", kind: "allow_always" },
      { optionId: "reject", name: "Reject", kind: "reject_once" },
    ]);
    expect(buttons.map((b) => b.optionId)).toEqual([
      "allow_once",
      "allow_always",
      "reject",
    ]);
    expect(buttons.map((b) => b.decision)).toEqual([
      "allow_once",
      "allow_session",
      "deny",
    ]);
  });

  it("falls back when options empty", () => {
    const buttons = mapPermissionButtons([]);
    expect(buttons).toHaveLength(3);
    expect(buttons[0]!.decision).toBe("allow_once");
    expect(buttons[2]!.decision).toBe("deny");
  });
});
