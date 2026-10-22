import { beforeEach, describe, expect, it } from "vitest";
import { claimEntrance, resetEntranceLedger } from "./entranceLedger";

describe("entrance ledger", () => {
  beforeEach(() => {
    resetEntranceLedger();
  });

  it("claims a key once and refuses replays after a remount", () => {
    expect(claimEntrance("tool:abc")).toBe(true);
    expect(claimEntrance("tool:abc")).toBe(false);
  });

  it("keeps different keys independent", () => {
    expect(claimEntrance("tool:abc")).toBe(true);
    expect(claimEntrance("tool:def")).toBe(true);
  });

  it("ignores empty keys", () => {
    expect(claimEntrance("")).toBe(false);
  });

  it("forgets every claim when reset", () => {
    expect(claimEntrance("phase:p1")).toBe(true);
    resetEntranceLedger();
    expect(claimEntrance("phase:p1")).toBe(true);
  });
});
