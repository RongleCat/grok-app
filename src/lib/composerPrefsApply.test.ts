import { describe, expect, it } from "vitest";
import { GROK_BUILD_MODELS } from "@/lib/grokCatalog";
import { resolveCustomRouteDisplay } from "@/lib/effectiveModel";
import { resolveComposerPrefsSelection } from "./composerPrefsApply";

const requesty = {
  id: "requesty",
  model: "grok-4.6",
  baseUrl: "https://router.requesty.ai/v1",
  efforts: [
    { id: "low", name: "low" },
    { id: "medium", name: "medium", isDefault: true },
    { id: "high", name: "high" },
    { id: "max", name: "max" },
  ],
  models: [
    { id: "grok-4.6", name: "Grok 4.6" },
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  ],
};

describe("resolveComposerPrefsSelection", () => {
  it("keeps a custom provider model that is not in the official catalog", () => {
    const next = resolveComposerPrefsSelection({
      prefs: {
        modelId: "gemini-3.5-flash",
        effort: "max",
        providerId: "requesty",
      },
      catalog: GROK_BUILD_MODELS,
      providers: [requesty],
    });
    expect(next.modelId).toBe("gemini-3.5-flash");
    expect(next.effort).toBe("max");
    const shown = resolveCustomRouteDisplay(requesty, next.modelId);
    expect(shown?.chip).toEqual({
      name: "Gemini 3.5 Flash",
      model: "gemini-3.5-flash",
    });
    expect(shown?.requestModel).toBe("gemini-3.5-flash");
  });

  it("validates effort against the picked custom model, not the channel default", () => {
    const provider = {
      id: "relay",
      model: "plain",
      baseUrl: "https://relay.example/v1",
      efforts: [
        { id: "low", name: "low" },
        { id: "high", name: "high", isDefault: true },
      ],
      models: [
        {
          id: "plain",
          name: "Plain",
          efforts: [
            { id: "low", name: "low" },
            { id: "high", name: "high", isDefault: true },
          ],
        },
        {
          id: "gemini-3.5-flash",
          name: "Gemini 3.5 Flash",
          efforts: [
            { id: "low", name: "low" },
            { id: "high", name: "high" },
            { id: "max", name: "max", isDefault: true },
          ],
        },
      ],
    };
    const next = resolveComposerPrefsSelection({
      prefs: {
        modelId: "gemini-3.5-flash",
        effort: "max",
        providerId: "relay",
      },
      catalog: GROK_BUILD_MODELS,
      providers: [provider],
    });
    expect(next.modelId).toBe("gemini-3.5-flash");
    expect(next.effort).toBe("max");
  });

  it("falls back to the provider model when the stored custom id is unknown", () => {
    const next = resolveComposerPrefsSelection({
      prefs: {
        modelId: "not-in-catalog",
        effort: "max",
        providerId: "requesty",
      },
      catalog: GROK_BUILD_MODELS,
      providers: [requesty],
    });
    expect(next.modelId).toBe("grok-4.6");
    expect(next.effort).toBe("max");
  });

  it("keeps the stored custom id until that provider's catalog has loaded", () => {
    const next = resolveComposerPrefsSelection({
      prefs: {
        modelId: "deepseek-v4-flash",
        effort: "max",
        providerId: "requesty",
      },
      catalog: GROK_BUILD_MODELS,
      providers: [],
    });
    expect(next.modelId).toBe("deepseek-v4-flash");
    expect(next.effort).toBe("max");
  });

  it("still resolves official prefs against the official catalog", () => {
    const kept = resolveComposerPrefsSelection({
      prefs: { modelId: "grok-4.5", effort: "low", providerId: "official" },
      catalog: GROK_BUILD_MODELS,
      providers: [requesty],
    });
    expect(kept).toEqual({ modelId: "grok-4.5", effort: "low" });

    const fallback = resolveComposerPrefsSelection({
      prefs: { modelId: "nope", effort: "nope", providerId: null },
      catalog: GROK_BUILD_MODELS,
    });
    expect(fallback.modelId).toBe("grok-4.7");
    expect(fallback.effort).toBe("xhigh");
  });
});
