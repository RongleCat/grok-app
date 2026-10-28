import { describe, expect, it } from "vitest";
import {
  composerModelChipLabel,
  effectiveComposerModel,
  resolveCustomRouteDisplay,
} from "./effectiveModel";

describe("effectiveComposerModel", () => {
  it("keeps the official catalog selection on the official route", () => {
    expect(effectiveComposerModel("grok-4.5", null)).toBe("grok-4.5");
    expect(effectiveComposerModel("grok-3", undefined)).toBe("grok-3");
  });

  it("prefers the active custom provider request model", () => {
    expect(effectiveComposerModel("grok-4.5", "deepseek-v4-flash")).toBe(
      "deepseek-v4-flash",
    );
  });

  it("falls back to the composer selection when provider model is blank", () => {
    expect(effectiveComposerModel("grok-4.5", "")).toBe("grok-4.5");
    expect(effectiveComposerModel("grok-4.5", "   ")).toBe("grok-4.5");
  });

  it("keeps the composer selection when no provider is active", () => {
    expect(effectiveComposerModel("grok-4.5", "")).toBe("grok-4.5");
  });
});

describe("resolveCustomRouteDisplay", () => {
  const provider = {
    name: "云驿",
    model: "deepseek-chat",
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat" },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    ],
  };

  it("shows the catalog row a generic chat stored", () => {
    const shown = resolveCustomRouteDisplay(provider, "deepseek-v4-flash");
    expect(shown?.chip).toEqual({
      name: "DeepSeek V4 Flash",
      model: "deepseek-v4-flash",
    });
    expect(shown?.requestModel).toBe("deepseek-v4-flash");
  });

  it("shows the catalog id a Grok Build-compatible relay picked", () => {
    const shown = resolveCustomRouteDisplay(
      { ...provider, providerMode: "grok_build_proxy" },
      "deepseek-v4-flash",
    );
    expect(shown?.chip).toEqual({
      name: "DeepSeek V4 Flash",
      model: "deepseek-v4-flash",
    });
    expect(shown?.requestModel).toBe("deepseek-v4-flash");
  });

  it("ignores an official catalog id on a custom route", () => {
    const shown = resolveCustomRouteDisplay(provider, "grok-4.7");
    expect(shown?.chip.name).toBe("DeepSeek Chat");
    expect(shown?.requestModel).toBe("deepseek-chat");
  });
});

describe("composerModelChipLabel", () => {
  it("uses official label when no custom route", () => {
    expect(
      composerModelChipLabel({
        modelId: "grok-4.5",
        officialLabel: "Grok 4.5",
        activeCustom: null,
      }),
    ).toBe("Grok 4.5");
  });

  it("uses custom name when set", () => {
    expect(
      composerModelChipLabel({
        modelId: "grok-4.5",
        officialLabel: "Grok 4.5",
        activeCustom: { name: "云驿 DeepSeek", model: "deepseek-chat" },
      }),
    ).toBe("云驿 DeepSeek");
  });

  it("falls back to custom model when name empty", () => {
    expect(
      composerModelChipLabel({
        modelId: "grok-4.5",
        officialLabel: "Grok 4.5",
        activeCustom: { name: "  ", model: "deepseek-chat" },
      }),
    ).toBe("deepseek-chat");
  });
});
