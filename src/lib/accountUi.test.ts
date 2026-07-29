import { describe, expect, it, beforeEach } from "vitest";
import {
  formatChineseCount,
  formatMessageTime,
  formatQuotaResetTime,
  loadCachedSuperGrokBrand,
  localDateKeyFromIso,
  resolveWelcomeBrandKind,
  saveCachedSuperGrokBrand,
  superGrokBrandKind,
  SUPERGROK_BRAND_CACHE_KEY,
  tierLabel,
} from "./accountUi";
import type { BillingSnapshot } from "./api";

function billing(partial: Partial<BillingSnapshot>): BillingSnapshot {
  return {
    available: false,
    source: "test",
    message: null,
    subscriptionTier: null,
    creditUsagePercent: null,
    remainingPercent: null,
    monthlyLimit: null,
    includedUsed: null,
    totalUsed: null,
    prepaidBalance: null,
    onDemandEnabled: null,
    onDemandCap: null,
    onDemandUsed: null,
    billingPeriodStart: null,
    billingPeriodEnd: null,
    resetsAt: null,
    isUnifiedBillingUser: null,
    products: [],
    manageUrl: "",
    subscribeUrl: "",
    fetchedAt: null,
    ...partial,
  };
}

describe("superGrokBrandKind", () => {
  it("returns null when signed out", () => {
    expect(
      superGrokBrandKind(billing({ subscriptionTier: "SuperGrok Heavy" }), false),
    ).toBeNull();
  });

  it("maps SuperGrok Heavy display and SuperGrokPro enum", () => {
    expect(
      superGrokBrandKind(billing({ subscriptionTier: "SuperGrok Heavy" }), true),
    ).toBe("heavy");
    expect(
      superGrokBrandKind(billing({ subscriptionTier: "SuperGrokPro" }), true),
    ).toBe("heavy");
  });

  it("maps SuperGrok standard", () => {
    expect(
      superGrokBrandKind(billing({ subscriptionTier: "SuperGrok" }), true),
    ).toBe("supergrok");
  });

  it("falls back when quota is available but tier string missing", () => {
    expect(
      superGrokBrandKind(billing({ available: true, subscriptionTier: null }), true),
    ).toBe("supergrok");
  });
});

describe("resolveWelcomeBrandKind", () => {
  it("prefers live over cache", () => {
    expect(resolveWelcomeBrandKind("heavy", "supergrok")).toBe("heavy");
  });

  it("uses cache while live is still unknown", () => {
    expect(resolveWelcomeBrandKind(null, "heavy")).toBe("heavy");
  });

  it("drops cache when account is ready and signed out", () => {
    expect(
      resolveWelcomeBrandKind(null, "heavy", {
        accountReady: true,
        signedIn: false,
      }),
    ).toBeNull();
  });

  it("forces SuperGrok (not Heavy) on custom relay route", () => {
    expect(
      resolveWelcomeBrandKind("heavy", "heavy", {
        accountReady: true,
        signedIn: true,
        customRoute: true,
      }),
    ).toBe("supergrok");
    expect(
      resolveWelcomeBrandKind(null, null, { customRoute: true }),
    ).toBe("supergrok");
  });
});

describe("cached SuperGrok brand", () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
  } as Storage;

  beforeEach(() => {
    mem.clear();
  });

  it("round-trips kind", () => {
    saveCachedSuperGrokBrand("heavy", storage);
    expect(loadCachedSuperGrokBrand(storage)).toBe("heavy");
    expect(mem.get(SUPERGROK_BRAND_CACHE_KEY)).toBe("heavy");
  });

  it("clears on null", () => {
    saveCachedSuperGrokBrand("supergrok", storage);
    saveCachedSuperGrokBrand(null, storage);
    expect(loadCachedSuperGrokBrand(storage)).toBeNull();
  });
});

describe("tierLabel", () => {
  it("prefers subscriptionTier string", () => {
    expect(
      tierLabel(billing({ subscriptionTier: "SuperGrok Heavy" }), "official_oauth"),
    ).toBe("SuperGrok Heavy");
  });
});

describe("formatMessageTime", () => {
  it("formats weekday + time", () => {
    const iso = "2026-07-21T07:23:00.000Z";
    const zh = formatMessageTime(iso, "zh");
    const en = formatMessageTime(iso, "en");
    expect(zh.length).toBeGreaterThan(4);
    expect(en.length).toBeGreaterThan(4);
    expect(formatMessageTime(null, "zh")).toBe("");
  });
});

describe("formatQuotaResetTime", () => {
  it("formats MM-DD HH:mm in local time", () => {
    // Fixed local instant via Date components
    const d = new Date(2026, 3, 15, 9, 5); // Apr 15 09:05
    const iso = d.toISOString();
    expect(formatQuotaResetTime(iso)).toBe("04-15 09:05");
    expect(formatQuotaResetTime(null)).toBe("");
    expect(formatQuotaResetTime("not-a-date")).toBe("");
  });
});

describe("localDateKeyFromIso", () => {
  it("maps ISO to local YYYY-MM-DD", () => {
    const d = new Date(2026, 3, 15, 23, 30);
    expect(localDateKeyFromIso(d.toISOString())).toBe("2026-04-15");
    expect(localDateKeyFromIso(null)).toBeNull();
    expect(localDateKeyFromIso("bad")).toBeNull();
  });
});

describe("formatChineseCount", () => {
  it("uses 百 / 千 / 万 / 亿 (simplified)", () => {
    expect(formatChineseCount(0)).toBe("0");
    expect(formatChineseCount(42)).toBe("42");
    expect(formatChineseCount(100)).toBe("1百");
    expect(formatChineseCount(500)).toBe("5百");
    expect(formatChineseCount(1_000)).toBe("1千");
    expect(formatChineseCount(12_500)).toBe("1.3万");
    expect(formatChineseCount(123_456)).toBe("12.3万");
    expect(formatChineseCount(10_000)).toBe("1万");
    expect(formatChineseCount(100_000_000)).toBe("1亿");
  });

  it("uses 萬 / 億 for zh-TW", () => {
    expect(formatChineseCount(12_500, "zh-TW")).toBe("1.3萬");
    expect(formatChineseCount(100_000_000, "zh-TW")).toBe("1億");
  });

  it("handles null / non-finite", () => {
    expect(formatChineseCount(null)).toBe("—");
    expect(formatChineseCount(Number.NaN)).toBe("—");
  });
});
