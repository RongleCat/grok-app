import { describe, expect, it } from "vitest";
import {
  classifyProviderBalanceError,
  providerBalanceErrorMessageKey,
  supportsProviderBalance,
} from "./providerBalanceHonesty";

describe("supportsProviderBalance", () => {
  it("accepts deepseek id and official host", () => {
    expect(
      supportsProviderBalance({
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
      }),
    ).toBe(true);
    expect(
      supportsProviderBalance({
        providerId: null,
        baseUrl: "https://api.deepseek.com",
      }),
    ).toBe(true);
    expect(
      supportsProviderBalance({
        providerId: "deepseek",
        baseUrl: "",
      }),
    ).toBe(true);
  });

  it("rejects other presets and DeepSeek models on foreign hosts", () => {
    expect(
      supportsProviderBalance({
        providerId: "amux",
        baseUrl: "https://api.amux.ai/v1",
      }),
    ).toBe(false);
    expect(
      supportsProviderBalance({
        providerId: "opencode-go",
        baseUrl: "https://opencode.ai/zen/go/v1",
      }),
    ).toBe(false);
    expect(
      supportsProviderBalance({
        providerId: "volcano-ark",
        baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
      }),
    ).toBe(false);
  });
});

describe("classifyProviderBalanceError", () => {
  it("maps host kinds and message heuristics", () => {
    expect(
      classifyProviderBalanceError({ isTauri: false }),
    ).toBe("host_only");
    expect(
      classifyProviderBalanceError({ errorKind: "auth" }),
    ).toBe("auth");
    expect(
      classifyProviderBalanceError({ error: "balance HTTP 401: unauthorized" }),
    ).toBe("auth");
    expect(
      classifyProviderBalanceError({ error: "request timed out" }),
    ).toBe("timeout");
    expect(providerBalanceErrorMessageKey("network")).toBe(
      "prov.balance.err.network",
    );
  });
});
