import { describe, expect, it } from "vitest";
import {
  composerModelChipLabel,
  effectiveComposerModel,
  resolveActiveCustomModel,
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

describe("resolveActiveCustomModel", () => {
  const provider = {
    id: "relay",
    name: "中转通道",
    model: "claude-glm-5.3-flash[1M]",
    models: [
      { id: "claude-glm-5.3-flash[1M]", name: "GLM 5.3 Flash" },
      { id: "claude-glm-5.3-pro", name: "GLM 5.3 Pro" },
    ],
  };

  it("prefers the session model when it belongs to the provider", () => {
    expect(
      resolveActiveCustomModel({
        provider,
        modelId: "claude-glm-5.3-pro",
      }),
    ).toEqual({ name: "GLM 5.3 Pro", model: "claude-glm-5.3-pro" });
  });

  it("keeps the provider global model when modelId is not its model", () => {
    expect(
      resolveActiveCustomModel({ provider, modelId: "grok-4.5" }),
    ).toEqual({ name: "GLM 5.3 Flash", model: "claude-glm-5.3-flash[1M]" });
  });

  it("falls back to the provider global model when modelId is blank", () => {
    expect(
      resolveActiveCustomModel({ provider, modelId: "  " }),
    ).toEqual({ name: "GLM 5.3 Flash", model: "claude-glm-5.3-flash[1M]" });
  });

  it("returns null without a provider", () => {
    expect(
      resolveActiveCustomModel({ provider: null, modelId: "x" }),
    ).toBeNull();
    expect(
      resolveActiveCustomModel({ provider: undefined, modelId: "x" }),
    ).toBeNull();
  });
});
