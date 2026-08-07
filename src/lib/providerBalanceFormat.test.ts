import { describe, expect, it } from "vitest";
import type { ProviderBalanceResult } from "@/lib/api";
import {
  formatProviderBalanceLine,
  isProviderBalanceCacheFresh,
  pickPrimaryBalance,
  PROVIDER_BALANCE_TTL_MS,
} from "./providerBalanceFormat";

const okCny: ProviderBalanceResult = {
  kind: "balance",
  provider: "deepseek",
  endpoint: "https://api.deepseek.com/user/balance",
  ok: true,
  latencyMs: 12,
  isAvailable: true,
  balances: [
    {
      currency: "CNY",
      totalBalance: "110.00",
      grantedBalance: "10.00",
      toppedUpBalance: "100.00",
    },
  ],
};

describe("pickPrimaryBalance / formatProviderBalanceLine", () => {
  it("formats DeepSeek CNY fixture", () => {
    expect(pickPrimaryBalance(okCny.balances)?.totalBalance).toBe("110.00");
    expect(formatProviderBalanceLine(okCny)).toBe("110.00 CNY");
  });

  it("prefers CNY over USD", () => {
    const multi: ProviderBalanceResult = {
      ...okCny,
      balances: [
        {
          currency: "USD",
          totalBalance: "1.00",
          grantedBalance: "0",
          toppedUpBalance: "1.00",
        },
        {
          currency: "CNY",
          totalBalance: "110.00",
          grantedBalance: "10.00",
          toppedUpBalance: "100.00",
        },
      ],
    };
    expect(formatProviderBalanceLine(multi)).toBe("110.00 CNY");
  });

  it("never invents zero on failure or empty", () => {
    expect(
      formatProviderBalanceLine({ ...okCny, ok: false, balances: undefined }),
    ).toBeNull();
    expect(
      formatProviderBalanceLine({
        ...okCny,
        balances: [],
      }),
    ).toBeNull();
  });
});

describe("isProviderBalanceCacheFresh", () => {
  it("respects provider id and TTL", () => {
    const now = 1_000_000;
    const cache = {
      providerId: "deepseek",
      fetchedAt: now - 1000,
      result: okCny,
    };
    expect(isProviderBalanceCacheFresh(cache, "deepseek", now)).toBe(true);
    expect(isProviderBalanceCacheFresh(cache, "amux", now)).toBe(false);
    expect(
      isProviderBalanceCacheFresh(
        { ...cache, fetchedAt: now - PROVIDER_BALANCE_TTL_MS - 1 },
        "deepseek",
        now,
      ),
    ).toBe(false);
  });
});
