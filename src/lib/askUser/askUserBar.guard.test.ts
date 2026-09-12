import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const column = readFileSync(
  resolve(__dirname, "../../app/WorkbenchComposerColumn.tsx"),
  "utf8",
);
const modals = readFileSync(
  resolve(__dirname, "../../app/WorkbenchSessionModals.tsx"),
  "utf8",
);

describe("ask-user composer gate (#891)", () => {
  it("live questionnaires mount in the composer column, not a session modal overlay", () => {
    expect(column).toContain("AskUserBar");
    expect(column).toContain("askUser.minimize");
    expect(modals).not.toContain("AskUserModal");
  });
});
