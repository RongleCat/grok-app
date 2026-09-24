import { describe, expect, it } from "vitest";
import {
  AI98PRO_MODELS,
  AMUX_MODELS,
  DEEPSEEK_EFFORTS,
  DEEPSEEK_MODELS,
  GROK_CHANNEL_EFFORTS,
  GROK_OFFICIAL_EFFORTS,
  OPENROUTER_EFFORTS,
  OPENROUTER_MODELS,
  ORCAROUTER_MODELS,
  PROVIDER_PRESETS,
  REQUESTY_MODELS,
  VOLCANO_ARK_MODELS,
  YUN_API_MODELS,
  ZHIPU_ENDPOINTS,
  ZHIPU_MODELS,
  alignGrokPresetEfforts,
  applyPresetEndpoint,
  defaultCustomChannelEfforts,
  findProviderPreset,
  isLegacyGrokChannelEffortIds,
  matchPresetEndpoint,
  resolveMatchedProviderPreset,
  resolveProviderApiKeyUrl,
  resolveProviderBrandId,
} from "./providerPresets";

describe("providerPresets", () => {
  it("ships DeepSeek with flash, vision-exp, and pro plus thinking efforts", () => {
    const ds = findProviderPreset("deepseek");
    expect(ds).toBeDefined();
    expect(ds!.models.map((m) => m.id)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
      "deepseek-v4-pro",
    ]);
    expect(DEEPSEEK_MODELS).toHaveLength(3);
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
      { id: "grok-4.7", name: "Grok 4.7", supportsVision: true },
      { id: "grok-4.6", name: "Grok 4.6", supportsVision: true },
      { id: "grok-4.5", name: "Grok 4.5", supportsVision: true },
    ]);
    expect(amux!.models).toEqual(AMUX_MODELS);
    expect(amux!.efforts.map((e) => e.id)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(amux!.efforts.map((e) => e.name)).toEqual([
      "Low",
      "Medium",
      "High",
      "Extra high",
    ]);
    expect(amux!.efforts.find((e) => e.isDefault)?.id).toBe("xhigh");
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
      { id: "grok-4.7", name: "Grok 4.7", supportsVision: true },
      { id: "grok-4.6", name: "Grok 4.6", supportsVision: true },
      { id: "grok-4.5", name: "Grok 4.5", supportsVision: true },
    ]);
    expect(yun!.apiKeyUrl).toBe(
      "https://api.yunyi.ai/register/?aff_code=W0iw",
    );
    expect(yun!.efforts.map((e) => e.id)).toEqual(
      GROK_OFFICIAL_EFFORTS.map((e) => e.id),
    );
    expect(yun!.efforts.find((e) => e.isDefault)?.id).toBe("xhigh");
  });

  it("ships OpenRouter with GLM-5.3 Flash, chat_completions, vision, and 1M context", () => {
    const p = findProviderPreset("openrouter");
    expect(p).toBeDefined();
    expect(findProviderPreset("OpenRouter")?.id).toBe("openrouter");
    expect(p!.name).toBe("OpenRouter");
    expect(p!.suggestedId).toBe("openrouter");
    expect(p!.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(p!.apiBackend).toBe("chat_completions");
    expect(p!.supportsVision).toBe(true);
    expect(p!.contextWindow).toBe(1_048_576);
    expect(p!.brandId).toBe("openrouter");
    expect(OPENROUTER_MODELS).toEqual([
      {
        id: "z-ai/glm-5.3-flash",
        name: "GLM-5.3 Flash",
        contextWindow: 1_048_576,
        supportsVision: true,
        supportsVideo: true,
        efforts: OPENROUTER_EFFORTS,
      },
    ]);
    expect(p!.models).toEqual(OPENROUTER_MODELS);
    expect(p!.efforts.map((e) => e.id)).toEqual(
      OPENROUTER_EFFORTS.map((e) => e.id),
    );
    expect(p!.efforts.find((e) => e.isDefault)?.id).toBe("max");
    expect(p!.apiKeyUrl).toBe("https://openrouter.ai/settings/keys");
    expect(
      resolveProviderApiKeyUrl({
        providerId: "openrouter-----123",
      }),
    ).toBe("https://openrouter.ai/settings/keys");
    expect(
      resolveProviderApiKeyUrl({
        baseUrl: "https://openrouter.ai/api/v1",
      }),
    ).toBe("https://openrouter.ai/settings/keys");
  });

  it("ships OrcaRouter with Auto Router, chat_completions, vision, and Grok efforts", () => {
    const p = findProviderPreset("orcarouter");
    expect(p).toBeDefined();
    expect(findProviderPreset("OrcaRouter")?.id).toBe("orcarouter");
    expect(p!.name).toBe("OrcaRouter");
    expect(p!.suggestedId).toBe("orcarouter");
    expect(p!.baseUrl).toBe("https://api.orcarouter.ai/v1");
    expect(p!.apiBackend).toBe("chat_completions");
    expect(p!.supportsVision).toBe(true);
    expect(p!.brandId).toBeUndefined();
    expect(ORCAROUTER_MODELS).toEqual([
      { id: "orcarouter/auto", name: "Auto Router", supportsVision: true },
      { id: "openai/gpt-4o-mini", name: "GPT-4o mini", supportsVision: true },
      {
        id: "google/gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        supportsVision: true,
      },
    ]);
    expect(p!.models).toEqual(ORCAROUTER_MODELS);
    expect(p!.efforts.map((e) => e.id)).toEqual(
      GROK_CHANNEL_EFFORTS.map((e) => e.id),
    );
    expect(p!.efforts.find((e) => e.isDefault)?.id).toBe("medium");
    expect(p!.apiKeyUrl).toBe("https://orcarouter.ai/");
    expect(
      resolveProviderApiKeyUrl({
        providerId: "orcarouter-----123",
      }),
    ).toBe("https://orcarouter.ai/");
    expect(
      resolveProviderApiKeyUrl({
        baseUrl: "https://api.orcarouter.ai/v1",
      }),
    ).toBe("https://orcarouter.ai/");
    expect(
      resolveMatchedProviderPreset({
        providerId: "orcarouter-----999",
      })?.id,
    ).toBe("orcarouter");
    expect(
      resolveMatchedProviderPreset({
        baseUrl: "https://api.orcarouter.ai/v1",
      })?.id,
    ).toBe("orcarouter");
    expect(resolveProviderBrandId({ providerId: "orcarouter" })).toBe(null);
  });

  it("ships Requesty with managed policy ids, chat_completions, vision, and Grok efforts", () => {
    const p = findProviderPreset("requesty");
    expect(p).toBeDefined();
    expect(findProviderPreset("Requesty")?.id).toBe("requesty");
    expect(p!.name).toBe("Requesty");
    expect(p!.suggestedId).toBe("requesty");
    expect(p!.baseUrl).toBe("https://router.requesty.ai/v1");
    expect(p!.apiBackend).toBe("chat_completions");
    expect(p!.supportsVision).toBe(true);
    expect(p!.brandId).toBeUndefined();
    expect(REQUESTY_MODELS.map((m) => m.id)).toEqual([
      "grok-4.6",
      "gemini-3.5-flash",
      "deepseek-v4-flash",
    ]);
    expect(p!.models).toEqual(REQUESTY_MODELS);
    expect(p!.efforts.map((e) => e.id)).toEqual(
      GROK_CHANNEL_EFFORTS.map((e) => e.id),
    );
    expect(p!.efforts.find((e) => e.isDefault)?.id).toBe("medium");
    expect(p!.apiKeyUrl).toBe("https://app.requesty.ai/api-keys");
    expect(
      resolveProviderApiKeyUrl({
        providerId: "requesty-----123",
      }),
    ).toBe("https://app.requesty.ai/api-keys");
    expect(
      resolveProviderApiKeyUrl({
        baseUrl: "https://router.requesty.ai/v1",
      }),
    ).toBe("https://app.requesty.ai/api-keys");
    expect(
      resolveMatchedProviderPreset({
        providerId: "requesty-----999",
      })?.id,
    ).toBe("requesty");
    expect(resolveProviderBrandId({ providerId: "requesty" })).toBe(null);
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

  it("ships AI98PRO with short id, Grok 4.7/4.6/4.5, Responses, and vision", () => {
    const p = findProviderPreset("ai98pro");
    expect(p).toBeDefined();
    expect(findProviderPreset("AI98PRO")?.id).toBe("ai98pro");
    expect(p!.name).toBe("AI98PRO");
    expect(p!.suggestedId).toBe("AI98PRO");
    expect(p!.baseUrl).toBe("https://ai98pro.xyz/v1");
    expect(p!.apiBackend).toBe("responses");
    expect(p!.supportsVision).toBe(true);
    expect(p!.brandId).toBeUndefined();
    expect(AI98PRO_MODELS).toEqual([
      { id: "grok-4.7", name: "Grok 4.7", supportsVision: true },
      { id: "grok-4.6", name: "Grok 4.6", supportsVision: true },
      { id: "grok-4.5", name: "Grok 4.5", supportsVision: true },
    ]);
    expect(p!.models).toEqual(AI98PRO_MODELS);
    expect(p!.efforts.map((e) => e.id)).toEqual(
      GROK_OFFICIAL_EFFORTS.map((e) => e.id),
    );
    expect(p!.efforts.find((e) => e.isDefault)?.id).toBe("xhigh");
    expect(p!.apiKeyUrl).toBe("https://ai98pro.xyz");
    expect(
      resolveProviderApiKeyUrl({
        providerId: "ai98pro-----1072183582",
      }),
    ).toBe("https://ai98pro.xyz");
    expect(
      resolveProviderApiKeyUrl({
        baseUrl: "https://ai98pro.xyz/v1",
      }),
    ).toBe("https://ai98pro.xyz");
  });

  it("resolves brand logos for DeepSeek/OpenRouter/Amux/OpenCode Go/Volcano Ark/Zhipu", () => {
    expect(resolveProviderBrandId({ providerId: "deepseek" })).toBe(
      "deepseek",
    );
    expect(resolveProviderBrandId({ providerId: "openrouter" })).toBe(
      "openrouter",
    );
    expect(
      resolveProviderBrandId({
        baseUrl: "https://openrouter.ai/api/v1",
      }),
    ).toBe("openrouter");
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
    expect(resolveProviderBrandId({ providerId: "zhipu" })).toBe("zhipu");
    expect(resolveProviderBrandId({ providerId: "zhi-p" })).toBe("zhipu");
    expect(
      resolveProviderBrandId({
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      }),
    ).toBe("zhipu");
    expect(
      resolveProviderBrandId({
        baseUrl: "https://api.z.ai/api/coding/paas/v4",
      }),
    ).toBe("zhipu");
  });

  it("ships one 智谱 chip with four CN/intl × API/Coding Plan endpoints", () => {
    const zp = findProviderPreset("zhipu");
    expect(zp).toBeDefined();
    expect(zp!.name).toBe("智谱");
    expect(zp!.brandId).toBe("zhipu");
    expect(zp!.apiBackend).toBe("chat_completions");
    expect(zp!.baseUrlFullPath).toBe(true);
    expect(zp!.baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(ZHIPU_MODELS.map((m) => m.id)).toEqual(["glm-5.3-flash"]);
    expect(ZHIPU_MODELS[0]?.efforts?.map((e) => e.id)).toEqual([
      "low",
      "high",
      "max",
    ]);
    expect(ZHIPU_ENDPOINTS.map((e) => e.id)).toEqual([
      "cn-api",
      "cn-coding",
      "intl-api",
      "intl-coding",
    ]);
    expect(ZHIPU_ENDPOINTS.map((e) => e.baseUrl)).toEqual([
      "https://open.bigmodel.cn/api/paas/v4",
      "https://open.bigmodel.cn/api/coding/paas/v4",
      "https://api.z.ai/api/paas/v4",
      "https://api.z.ai/api/coding/paas/v4",
    ]);
    expect(
      applyPresetEndpoint(zp!, "cn-coding").baseUrl,
    ).toBe("https://open.bigmodel.cn/api/coding/paas/v4");
    expect(
      applyPresetEndpoint(zp!, "intl-api").baseUrl,
    ).toBe("https://api.z.ai/api/paas/v4");
    expect(
      matchPresetEndpoint(zp!, "https://api.z.ai/api/coding/paas/v4/")?.id,
    ).toBe("intl-coding");
    expect(resolveMatchedProviderPreset({ providerId: "zhi-p" })?.id).toBe(
      "zhipu",
    );
    expect(
      resolveMatchedProviderPreset({
        baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      })?.id,
    ).toBe("zhipu");
    expect(
      resolveProviderApiKeyUrl({
        baseUrl: "https://api.z.ai/api/paas/v4",
      }),
    ).toBe("https://z.ai/manage-apikey/apikey-list");
    expect(
      resolveProviderApiKeyUrl({
        providerId: "zhipu",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      }),
    ).toContain("open.bigmodel.cn");
  });

  it("defaults blank custom channels to Grok low/medium/high/max (ladder order)", () => {
    expect(defaultCustomChannelEfforts().map((e) => e.id)).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
  });

  it("rewrites legacy Amux/Yun max ladders to official xhigh", () => {
    expect(
      isLegacyGrokChannelEffortIds(["low", "medium", "high", "max"]),
    ).toBe(true);
    expect(
      isLegacyGrokChannelEffortIds(["low", "medium", "high", "xhigh"]),
    ).toBe(false);
    const aligned = alignGrokPresetEfforts({
      providerId: "amux",
      efforts: [
        { id: "low", name: "low" },
        { id: "medium", name: "medium", isDefault: true },
        { id: "high", name: "high" },
        { id: "max", name: "max" },
      ],
    });
    expect(aligned?.map((e) => e.id)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(aligned?.find((e) => e.isDefault)?.id).toBe("xhigh");
    expect(
      alignGrokPresetEfforts({
        providerId: "deepseek",
        efforts: [{ id: "max", name: "max" }],
      }),
    ).toBeNull();
    expect(
      alignGrokPresetEfforts({
        providerId: "ai98pro-----1072183582",
        efforts: [
          { id: "low", name: "low" },
          { id: "medium", name: "medium", isDefault: true },
          { id: "high", name: "high" },
          { id: "max", name: "max" },
        ],
      })?.map((e) => e.id),
    ).toEqual(["low", "medium", "high", "xhigh"]);
    expect(
      alignGrokPresetEfforts({
        providerId: "yun-api",
        efforts: [
          { id: "low", name: "Low" },
          { id: "custom", name: "Custom" },
          { id: "max", name: "Turbo" },
        ],
      })?.map((e) => ({ id: e.id, name: e.name })),
    ).toEqual([
      { id: "low", name: "Low" },
      { id: "custom", name: "Custom" },
      { id: "xhigh", name: "Turbo" },
    ]);
  });
});
