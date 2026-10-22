import { describe, expect, it } from "vitest";
import {
  claimIsStale,
  claimReleasableBy,
  newConnectClaim,
  rebindConnectClaim,
  type ConnectClaim,
} from "./sessionConnectClaim";
import { SESSION_CONNECT_CLAIM_WAIT_MS } from "./sessionConnectTimeout";

describe("connect claim ownership", () => {
  it("treats a claim as stale only after the connect budget (timeout path)", () => {
    const c = newConnectClaim(1_000);
    expect(claimIsStale(c, 1_000 + SESSION_CONNECT_CLAIM_WAIT_MS - 1, SESSION_CONNECT_CLAIM_WAIT_MS)).toBe(false);
    expect(claimIsStale(c, 1_000 + SESSION_CONNECT_CLAIM_WAIT_MS, SESSION_CONNECT_CLAIM_WAIT_MS)).toBe(true);
    expect(claimIsStale(undefined, 0, SESSION_CONNECT_CLAIM_WAIT_MS)).toBe(true);
  });

  it("double connect: a wedged owner's late release cannot drop the takeover claim", () => {
    const wedged = newConnectClaim(0);
    const takeover = newConnectClaim(SESSION_CONNECT_CLAIM_WAIT_MS);
    expect(wedged.id).not.toBe(takeover.id);
    // Current holder is the takeover; the old owner finally-releases late.
    expect(claimReleasableBy(takeover, wedged)).toBe(false);
    expect(claimReleasableBy(takeover, takeover)).toBe(true);
  });

  it("cancel/legacy release without an owner still clears the key", () => {
    expect(claimReleasableBy(newConnectClaim(), undefined)).toBe(true);
    expect(claimReleasableBy(undefined, newConnectClaim())).toBe(true);
  });

  it("moves a claim onto the new chat while the owner still holds the draft", () => {
    const owner = newConnectClaim(0);
    const claims = new Set(["__draft__"]);
    const owners = new Map<string, ConnectClaim>([["__draft__", owner]]);
    expect(
      rebindConnectClaim(claims, owners, "__draft__", "s-a", owner),
    ).toBe(true);
    expect(claims.has("__draft__")).toBe(false);
    expect(claims.has("s-a")).toBe(true);
    expect(owners.get("s-a")?.id).toBe(owner.id);
  });

  it("does not rebind a draft a newer connect already took", () => {
    const older = newConnectClaim(0);
    const newer = newConnectClaim(SESSION_CONNECT_CLAIM_WAIT_MS);
    const claims = new Set(["__draft__"]);
    const owners = new Map<string, ConnectClaim>([["__draft__", newer]]);
    expect(
      rebindConnectClaim(claims, owners, "__draft__", "s-a", older),
    ).toBe(false);
    expect(claims.has("__draft__")).toBe(true);
    expect(owners.get("__draft__")?.id).toBe(newer.id);
    expect(claims.has("s-a")).toBe(false);
  });

  it("does not rebind after the draft claim was dropped", () => {
    const older = newConnectClaim(0);
    const claims = new Set<string>();
    const owners = new Map<string, ConnectClaim>();
    expect(
      rebindConnectClaim(claims, owners, "__draft__", "s-a", older),
    ).toBe(false);
    expect(claims.has("s-a")).toBe(false);
  });

  it("keeps the draft claim when the new chat id is already held", () => {
    const owner = newConnectClaim(0);
    const other = newConnectClaim(1);
    const claims = new Set(["__draft__", "s-a"]);
    const owners = new Map<string, ConnectClaim>([
      ["__draft__", owner],
      ["s-a", other],
    ]);
    expect(
      rebindConnectClaim(claims, owners, "__draft__", "s-a", owner),
    ).toBe(false);
    expect(claims.has("__draft__")).toBe(true);
    expect(owners.get("__draft__")?.id).toBe(owner.id);
    expect(owners.get("s-a")?.id).toBe(other.id);
  });
});
