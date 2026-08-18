import { describe, expect, it } from "vitest";
import {
  boundsNearlyEqual,
  clipHostRectAgainstLeftResizers,
  clipHostRectToAncestor,
  createTrailingSingleFlight,
  isAsideWebviewSuppressed,
  snapBounds,
} from "./nativeWebviewBounds";

describe("boundsNearlyEqual", () => {
  it("matches within eps", () => {
    expect(
      boundsNearlyEqual(
        { x: 10, y: 20, width: 100, height: 200 },
        { x: 10.3, y: 20.2, width: 100.1, height: 199.8 },
        0.5,
      ),
    ).toBe(true);
  });

  it("rejects large deltas", () => {
    expect(
      boundsNearlyEqual(
        { x: 10, y: 20, width: 100, height: 200 },
        { x: 40, y: 20, width: 100, height: 200 },
        0.5,
      ),
    ).toBe(false);
  });

  it("false when previous missing", () => {
    expect(
      boundsNearlyEqual(null, { x: 0, y: 0, width: 1, height: 1 }),
    ).toBe(false);
  });
});

describe("snapBounds", () => {
  it("rounds and floors negative size to 0", () => {
    expect(snapBounds({ x: 1.6, y: 2.4, width: -3, height: 9.7 })).toEqual({
      x: 2,
      y: 2,
      width: 0,
      height: 10,
    });
  });
});

describe("isAsideWebviewSuppressed", () => {
  it("is true for hidden / collapsed / aria-hidden aside", () => {
    expect(
      isAsideWebviewSuppressed({
        classList: { contains: (n) => n === "aside--hidden" },
        getAttribute: () => null,
      }),
    ).toBe(true);
    expect(
      isAsideWebviewSuppressed({
        classList: { contains: (n) => n === "aside--collapsed" },
        getAttribute: () => null,
      }),
    ).toBe(true);
    expect(
      isAsideWebviewSuppressed({
        classList: { contains: () => false },
        getAttribute: (n) => (n === "aria-hidden" ? "true" : null),
      }),
    ).toBe(true);
    expect(
      isAsideWebviewSuppressed({
        classList: { contains: () => false },
        getAttribute: () => null,
      }),
    ).toBe(false);
  });
});

describe("clipHostRectToAncestor", () => {
  const host = {
    left: 200,
    top: 40,
    right: 800,
    bottom: 700,
    width: 600,
    height: 660,
  };

  it("returns null when the aside is a 0-width sliver", () => {
    expect(
      clipHostRectToAncestor(host, {
        left: 800,
        top: 0,
        right: 800,
        bottom: 700,
        width: 0,
        height: 700,
      }),
    ).toBeNull();
  });

  it("clips a host that overflowed a shrinking aside", () => {
    const next = clipHostRectToAncestor(host, {
      left: 500,
      top: 0,
      right: 800,
      bottom: 700,
      width: 300,
      height: 700,
    });
    expect(next).toEqual({
      left: 500,
      top: 40,
      right: 800,
      bottom: 700,
      width: 300,
      height: 660,
    });
  });
});

describe("clipHostRectAgainstLeftResizers", () => {
  const host = {
    left: 100,
    top: 0,
    right: 500,
    bottom: 400,
    width: 400,
    height: 400,
  };

  it("insets left when a resizer covers the host left edge (in-host handle)", () => {
    const next = clipHostRectAgainstLeftResizers(host, [
      { left: 100, right: 106, top: 0, bottom: 400, width: 6, height: 400 },
    ]);
    expect(next.left).toBe(106);
    expect(next.width).toBe(394);
    expect(next.right).toBe(500);
  });

  it("no-ops for straddle handles that start outside the host (keep browser flush)", () => {
    // left: -4 relative → rect starts at 96 when host is 100
    const next = clipHostRectAgainstLeftResizers(host, [
      { left: 96, right: 104, top: 0, bottom: 400, width: 8, height: 400 },
    ]);
    expect(next).toEqual(host);
  });

  it("no-ops when resizer is outside host", () => {
    const next = clipHostRectAgainstLeftResizers(host, [
      { left: 0, right: 6, top: 0, bottom: 400, width: 6, height: 400 },
    ]);
    expect(next).toEqual(host);
  });

  it("no-ops when resizer list empty", () => {
    expect(clipHostRectAgainstLeftResizers(host, [])).toEqual(host);
  });
});

describe("createTrailingSingleFlight", () => {
  it("coalesces concurrent schedules into trailing re-apply", async () => {
    const order: number[] = [];
    let n = 0;
    const flight = createTrailingSingleFlight(async () => {
      const mine = ++n;
      order.push(mine);
      await new Promise((r) => setTimeout(r, 20));
    });

    flight.schedule();
    // While first apply is (or will be) in flight, more schedules only set pending.
    flight.schedule();
    flight.schedule();
    await flight.flush();
    // First run + at most one trailing re-run (not 3 full applies).
    expect(order.length).toBeGreaterThanOrEqual(1);
    expect(order.length).toBeLessThanOrEqual(2);
    flight.dispose();
  });

  it("re-runs when scheduled during apply", async () => {
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const flight = createTrailingSingleFlight(async () => {
      calls.push("start");
      await gate;
      calls.push("end");
    });

    flight.schedule();
    // Wait until first apply has entered (no vi.waitFor — older vitest typings).
    const deadline = Date.now() + 2000;
    while (!calls.includes("start") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(calls).toContain("start");
    flight.schedule(); // pending while first in flight
    release();
    await flight.flush();
    expect(calls.filter((c) => c === "start").length).toBe(2);
    expect(calls.filter((c) => c === "end").length).toBe(2);
    flight.dispose();
  });
});
