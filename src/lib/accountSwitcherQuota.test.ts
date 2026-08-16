import { describe, expect, it } from "vitest";
import {
  isSwitcherQuotaKnown,
  liveQuotaFromBilling,
  mergeAccountQuota,
  quotaFromHostItem,
  switcherDisplayName,
} from "./accountSwitcherQuota";

describe("switcherDisplayName", () => {
  it("prefers displayName", () => {
    expect(
      switcherDisplayName({
        displayName: "Gusts",
        label: "dannier87666@gmail.com",
        email: "dannier87666@gmail.com",
      }),
    ).toBe("Gusts");
  });

  it("falls back to label without a trailing percent suffix", () => {
    expect(
      switcherDisplayName({
        displayName: "",
        label: "Work · 12% remaining",
        email: "a@b.com",
      }),
    ).toBe("Work");
  });
});

describe("quotaFromHostItem", () => {
  it("nulls percents when the Host marks the probe unavailable", () => {
    expect(
      quotaFromHostItem({
        remainingPercent: 0,
        usedPercent: 100,
        available: false,
      }),
    ).toEqual({
      remainingPercent: null,
      usedPercent: null,
      resetsAt: null,
      available: false,
    });
  });

  it("keeps a real exhausted quota", () => {
    const q = quotaFromHostItem({
      remainingPercent: 0,
      usedPercent: 100,
      available: true,
    });
    expect(q.available).toBe(true);
    expect(q.remainingPercent).toBe(0);
    expect(q.usedPercent).toBe(100);
  });
});

describe("liveQuotaFromBilling", () => {
  it("does not invent remaining when billing is silent", () => {
    const q = liveQuotaFromBilling({ available: true });
    expect(q.available).toBe(false);
    expect(q.remainingPercent).toBeNull();
    expect(q.usedPercent).toBeNull();
  });
});

describe("mergeAccountQuota", () => {
  it("uses fetched snapshot when the probe is known", () => {
    const q = mergeAccountQuota(
      "u2",
      "b@x.ai",
      {
        u2: {
          remainingPercent: 8,
          usedPercent: 92,
          resetsAt: null,
          available: true,
        },
      },
      { id: "u1", email: "a@x.ai", remaining: 70, used: 30 },
    );
    expect(q?.remainingPercent).toBe(8);
  });

  it("seeds the current account from live billing before fetch returns", () => {
    const q = mergeAccountQuota(
      "u1",
      "a@x.ai",
      {},
      { id: "u1", email: "a@x.ai", remaining: 69, used: 31, resetsAt: "t" },
    );
    expect(q).toEqual({
      remainingPercent: 69,
      usedPercent: 31,
      resetsAt: "t",
      available: true,
    });
  });

  it("keeps live current quota when the later probe failed", () => {
    const q = mergeAccountQuota(
      "u1",
      "a@x.ai",
      {
        u1: {
          remainingPercent: null,
          usedPercent: null,
          resetsAt: null,
          available: false,
        },
      },
      { id: "u1", email: "a@x.ai", remaining: 69, used: 31 },
    );
    expect(q?.remainingPercent).toBe(69);
    expect(isSwitcherQuotaKnown(q)).toBe(true);
  });

  it("does not invent quota for other accounts", () => {
    expect(
      mergeAccountQuota(
        "u2",
        "b@x.ai",
        {},
        { id: "u1", email: "a@x.ai", remaining: 69, used: 31 },
      ),
    ).toBeNull();
  });
});
