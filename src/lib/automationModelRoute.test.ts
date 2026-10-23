import { describe, expect, it } from "vitest";
import {
  automationModelValue,
  effectiveAutomationProviderId,
  inferAutomationProviderId,
  normalizeAutomationRoute,
  parseAutomationModelValue,
} from "./automationModelRoute";

const providers = [
  {
    id: "relay-a",
    model: "deepseek-v4-flash",
    models: [{ id: "deepseek-v4-flash" }, { id: "qwen3.8-max" }],
  },
];

describe("automation model route", () => {
  it("round-trips official and custom picks", () => {
    expect(
      parseAutomationModelValue(
        automationModelValue({ kind: "official", modelId: "grok-4.7" }),
      ),
    ).toEqual({ kind: "official", modelId: "grok-4.7" });
    expect(
      parseAutomationModelValue(
        automationModelValue({
          kind: "custom",
          providerId: "relay-a",
          modelId: "qwen3.8-max",
        }),
      ),
    ).toEqual({
      kind: "custom",
      providerId: "relay-a",
      modelId: "qwen3.8-max",
    });
  });

  it("ignores malformed option values", () => {
    expect(parseAutomationModelValue("grok-4.7")).toBeNull();
    expect(parseAutomationModelValue('{"kind":"custom"}')).toBeNull();
  });

  it("prefers an explicit provider and infers official for legacy rows", () => {
    expect(
      effectiveAutomationProviderId(
        { providerId: "relay-a", modelId: "grok-4.7" },
        ["grok-4.7"],
        providers,
      ),
    ).toBe("relay-a");
    expect(
      effectiveAutomationProviderId(
        { modelId: "grok-4.7" },
        ["grok-4.7"],
        providers,
      ),
    ).toBe("official");
    expect(
      effectiveAutomationProviderId(
        { modelId: "__no_such_model__" },
        ["grok-4.7"],
        providers,
      ),
    ).toBeNull();
  });

  it("infers the provider that uniquely lists a legacy custom model", () => {
    expect(
      inferAutomationProviderId({
        modelId: "qwen3.8-max",
        officialModelIds: ["grok-4.7"],
        providers,
      }),
    ).toBe("relay-a");
    expect(
      inferAutomationProviderId({
        modelId: "grok-4.7",
        officialModelIds: ["grok-4.7"],
        providers,
      }),
    ).toBe("official");
  });

  it("keeps the active route when a legacy model matches several providers", () => {
    const shared = [
      { id: "relay-a", model: "qwen3.8-max" },
      { id: "relay-b", model: "qwen3.8-max" },
    ];
    expect(
      inferAutomationProviderId({
        modelId: "qwen3.8-max",
        officialModelIds: ["grok-4.7"],
        providers: shared,
      }),
    ).toBe("");
    expect(
      effectiveAutomationProviderId(
        { modelId: "qwen3.8-max" },
        ["grok-4.7"],
        shared,
      ),
    ).toBeNull();
  });

  it("normalizes a saved route to a pair the picker can show", () => {
    const base = {
      officialModelIds: ["grok-4.7"],
      officialDefaultModelId: "grok-4.7",
      providers,
    };
    expect(
      normalizeAutomationRoute({
        ...base,
        providerId: "official",
        modelId: "grok-4.7",
      }),
    ).toEqual({ providerId: "official", modelId: "grok-4.7" });
    expect(
      normalizeAutomationRoute({
        ...base,
        providerId: "official",
        modelId: "gone",
      }),
    ).toEqual({ providerId: "official", modelId: "grok-4.7" });
    expect(
      normalizeAutomationRoute({
        ...base,
        providerId: "relay-a",
        modelId: "qwen3.8-max",
      }),
    ).toEqual({ providerId: "relay-a", modelId: "qwen3.8-max" });
    expect(
      normalizeAutomationRoute({
        ...base,
        providerId: "relay-a",
        modelId: "gone",
      }),
    ).toEqual({
      providerId: "relay-a",
      modelId: "deepseek-v4-flash",
    });
    expect(
      normalizeAutomationRoute({
        ...base,
        providerId: "deleted-provider",
        modelId: "gone",
      }),
    ).toEqual({ providerId: "", modelId: "gone" });
  });
});
