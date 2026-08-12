import { describe, expect, it } from "vitest";
import {
  AMUX_MODELS,
  DEEPSEEK_EFFORTS,
  DEEPSEEK_MODELS,
  PROVIDER_PRESETS,
  VOLCANO_ARK_MODELS,
  YUN_API_MODELS,
  defaultCustomChannelEfforts,
  findProviderPreset,
  resolveProviderApiKeyUrl,
  resolveProviderBrandId,
} from "./providerPresets";

describe("providerPresets", () => {
  it("ships DeepSeek with both models and low/high/xhigh/max efforts", () => {
    const ds = findProviderPreset("deepseek");
    expect(ds).toBeDefined();
    expect(ds!.models.map((m) => m.id)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ]);
    expect(DEEPSEEK_MODELS).toHaveLength(2);
    expect(DEEPSEEK_EFFORTS.map((e) => e.id)).toEqual([
      "low",
      "high",
      "xhigh",
      "max",
    ]);
    expect(DEEPSEEK_EFFORTS.find((e) => e.isDefault)?.id).toBe("high");
    expect(PROVIDER_PRESETS.some((p) => p.id === "deepseek")).toBe(true);
  });

  it("ships Amux with grok-4.6 + grok-4.5 and Grok efforts", () => {
    const amux = findProviderPreset("amux");
    expect(amux).toBeDefined();
    expect(amux!.baseUrl).toBe("https://api.amux.ai/v1");
    expect(amux!.apiBackend).toBe("responses");
    expect(AMUX_MODELS).toEqual([
      { id: "grok-4.6", name: "Grok 4.6" },
      { id: "grok-4.5", name: "Grok 4.5" },
    ]);
    expect(amux!.models).toEqual(AMUX_MODELS);
    expect(amux!.efforts.map((e) => e.id)).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(amux!.apiKeyUrl).toContain("api.amux.ai/register");
  });

  it("ships OpenCode Go with chat_completions for DeepSeek-class models", () => {
    const go = findProviderPreset("opencode-go");
    expect(go).toBeDefined();
    expect(go!.baseUrl).toBe("https://opencode.ai/zen/go/v1");
    expect(go!.apiBackend).toBe("chat_completions");
    expect(go!.models.map((m) => m.id)).toContain("deepseek-v4-flash");
    expect(go!.brandId).toBe("opencode-go");
  });

  it("ships Yun API with grok-4.6 + grok-4.5 and yunyi register link", () => {
    const yun = findProviderPreset("yun-api");
    expect(yun).toBeDefined();
    expect(yun!.baseUrl).toBe("https://api.yunyi.ai/v1");
    expect(YUN_API_MODELS).toEqual([
      { id: "grok-4.6", name: "Grok 4.6" },
      { id: "grok-4.5", name: "Grok 4.5" },
    ]);
    expect(yun!.apiKeyUrl).toBe(
      "https://api.yunyi.ai/register/?aff_code=W0iw",
    );
  });

  it("resolves get-api-key URLs by id or base host", () => {
    expect(
      resolveProviderApiKeyUrl({ providerId: "deepseek" }),
    ).toBe("https://platform.deepseek.com/");
    expect(
      resolveProviderApiKeyUrl({ baseUrl: "https://api.amux.ai/v1" }),
    ).toContain("amux.ai/register");
    expect(
      resolveProviderApiKeyUrl({ baseUrl: "https://api.yunyi.ai/v1" }),
    ).toContain("aff_code=W0iw");
    expect(resolveProviderApiKeyUrl({ baseUrl: "https://example.com" })).toBe(
      null,
    );
  });

  it("ships Volcengine Ark (火山方舟) with full-path Coding Plan root", () => {
    const ark = findProviderPreset("volcano-ark");
    expect(ark).toBeDefined();
    expect(ark!.name).toBe("火山方舟");
    expect(ark!.baseUrl).toBe(
      "https://ark.cn-beijing.volces.com/api/plan/v3",
    );
    expect(ark!.baseUrlFullPath).toBe(true);
    expect(ark!.apiBackend).toBe("chat_completions");
    expect(VOLCANO_ARK_MODELS).toEqual([
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    ]);
    expect(ark!.models).toEqual(VOLCANO_ARK_MODELS);
    expect(ark!.brandId).toBe("volcano-ark");
    expect(ark!.apiKeyUrl).toContain("console.volcengine.com/ark");
    expect(ark!.efforts.find((e) => e.isDefault)?.id).toBe("medium");
  });

  it("resolves brand logos for DeepSeek/Amux/OpenCode Go/Volcano Ark", () => {
    expect(resolveProviderBrandId({ providerId: "deepseek" })).toBe(
      "deepseek",
    );
    expect(resolveProviderBrandId({ baseUrl: "https://api.amux.ai/v1" })).toBe(
      "amux",
    );
    expect(
      resolveProviderBrandId({ providerId: "opencode-go" }),
    ).toBe("opencode-go");
    expect(
      resolveProviderBrandId({ baseUrl: "https://opencode.ai/zen/go/v1" }),
    ).toBe("opencode-go");
    expect(resolveProviderBrandId({ providerId: "yun-api" })).toBe(null);
    expect(resolveProviderBrandId({ providerId: "volcano-ark" })).toBe(
      "volcano-ark",
    );
    expect(resolveProviderBrandId({ providerId: "huo-shan" })).toBe(
      "volcano-ark",
    );
    expect(
      resolveProviderBrandId({
        baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
      }),
    ).toBe("volcano-ark");
  });

  it("defaults blank custom channels to Grok low/medium/high/max (ladder order)", () => {
    expect(defaultCustomChannelEfforts().map((e) => e.id)).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
  });
});
