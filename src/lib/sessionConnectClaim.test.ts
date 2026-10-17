import { describe, expect, it } from "vitest";
import { claimIsStale, claimReleasableBy, newConnectClaim } from "./sessionConnectClaim";
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
});
