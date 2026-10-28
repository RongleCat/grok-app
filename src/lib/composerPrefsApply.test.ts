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
  it("keeps a proxy catalog id that is not in the official catalog", () => {
    const proxy = { ...requesty, providerMode: "grok_build_proxy" as const };
    const next = resolveComposerPrefsSelection({
      prefs: {
        modelId: "gemini-3.5-flash",
        effort: "max",
        providerId: "requesty",
      },
      catalog: GROK_BUILD_MODELS,
      providers: [proxy],
    });
    expect(next.modelId).toBe("gemini-3.5-flash");
    expect(next.effort).toBe("max");
    const shown = resolveCustomRouteDisplay(proxy, next.modelId);
    expect(shown?.chip).toEqual({
      name: "Gemini 3.5 Flash",
      model: "gemini-3.5-flash",
    });
    expect(shown?.requestModel).toBe("gemini-3.5-flash");
  });

  it("keeps a stored catalog id on a generic channel", () => {
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

  it("keeps a new chat's pick when the resolve returns the default", () => {
    // Arrange — a chat with no session row: its pick is only in memory
    const next = resolveComposerPrefsSelection({
      prefs: { modelId: "grok-4.7", effort: "medium" },
      catalog: GROK_BUILD_MODELS,
      draft: { providerId: "official", modelId: "grok-4.6", effort: "high" },
    });

    // Act / Assert
    expect(next).toEqual({ modelId: "grok-4.6", effort: "high" });
  });

  it("keeps a new chat's custom-provider pick", () => {
    // Arrange — the resolve knows the global route, not the one the chat picked
    const next = resolveComposerPrefsSelection({
      prefs: { modelId: "grok-4.7", effort: "medium", providerId: null },
      catalog: GROK_BUILD_MODELS,
      providers: [requesty],
      draft: {
        providerId: "requesty",
        modelId: "gemini-3.5-flash",
        effort: "max",
      },
    });

    // Act / Assert
    expect(next).toEqual({ modelId: "gemini-3.5-flash", effort: "max" });
  });

  it("keeps a new chat's pick on a Grok Build-compatible relay", () => {
    const next = resolveComposerPrefsSelection({
      prefs: { modelId: "grok-4.7", effort: "medium", providerId: null },
      catalog: GROK_BUILD_MODELS,
      providers: [{ ...requesty, providerMode: "grok_build_proxy" }],
      draft: {
        providerId: "requesty",
        modelId: "gemini-3.5-flash",
        effort: "max",
      },
    });
    expect(next).toEqual({ modelId: "gemini-3.5-flash", effort: "max" });
  });

  it("keeps a new chat's pick while the provider list is not loaded yet", () => {
    // Arrange — nothing disproves the pick, so it is not thrown away
    const next = resolveComposerPrefsSelection({
      prefs: { modelId: "grok-4.7", effort: "medium" },
      catalog: GROK_BUILD_MODELS,
      providers: [],
      draft: {
        providerId: "requesty",
        modelId: "gemini-3.5-flash",
        effort: "max",
      },
    });

    // Act / Assert
    expect(next.modelId).toBe("gemini-3.5-flash");
  });

  it("ignores a draft pick that is not a model of the resolved route", () => {
    // Arrange — the route moved on, so the old pick no longer applies
    const next = resolveComposerPrefsSelection({
      prefs: { modelId: "grok-4.7", effort: "medium" },
      catalog: GROK_BUILD_MODELS,
      draft: { providerId: "official", modelId: "not-a-real-model", effort: "high" },
    });

    // Act / Assert
    expect(next.modelId).toBe("grok-4.7");
  });

  it("validates effort against the picked proxy model, not the channel default", () => {
    const provider = {
      id: "relay",
      model: "plain",
      providerMode: "grok_build_proxy" as const,
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

  it("keeps the selected model's effort ladder on a generic channel", () => {
    const provider = {
      id: "relay",
      model: "plain",
      providerMode: "generic" as const,
      baseUrl: "https://relay.example/v1",
      efforts: [
        { id: "low", name: "low" },
        { id: "high", name: "high", isDefault: true },
      ],
      models: [
        { id: "plain", name: "Plain" },
        {
          id: "gemini-3.5-flash",
          name: "Gemini 3.5 Flash",
          efforts: [{ id: "max", name: "max", isDefault: true }],
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

  it("keeps each generic chat on its stored catalog model", () => {
    const kiro = {
      id: "kiro",
      model: "auto",
      baseUrl: "https://kiro.example/v1",
      models: [
        { id: "auto", name: "Auto" },
        { id: "gpt-5.6-luna", name: "Luna" },
      ],
    };
    const other = {
      id: "other",
      model: "sol",
      baseUrl: "https://other.example/v1",
      models: [
        { id: "sol", name: "Sol" },
        { id: "gpt-5.6-luna", name: "Luna" },
      ],
    };
    const luna = resolveComposerPrefsSelection({
      prefs: { modelId: "gpt-5.6-luna", effort: "low", providerId: "kiro" },
      catalog: GROK_BUILD_MODELS,
      providers: [kiro, other],
    });
    const sol = resolveComposerPrefsSelection({
      prefs: { modelId: "gpt-5.6-luna", effort: "low", providerId: "other" },
      catalog: GROK_BUILD_MODELS,
      providers: [kiro, other],
    });
    expect(luna.modelId).toBe("gpt-5.6-luna");
    expect(sol.modelId).toBe("gpt-5.6-luna");
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
