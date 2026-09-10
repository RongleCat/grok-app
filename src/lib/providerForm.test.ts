import { describe, expect, it } from "vitest";
import {
  asFormModel,
  ccSwitchStatusKey,
  emptyForm,
  formFromPreset,
  hostOf,
  modelsFromProvider,
  toFormEfforts,
} from "./providerForm";
import { PROVIDER_PRESETS } from "@/lib/providerPresets";

describe("toFormEfforts", () => {
  it("maps entries and trims empty names to ids", () => {
    const out = toFormEfforts([
      { id: "high", name: "  " },
      { id: "low", name: "Low", isDefault: true },
    ]);
    expect(out).toEqual([
      { id: "high", name: "high", isDefault: false },
      { id: "low", name: "Low", isDefault: true },
    ]);
  });

  it("keeps undefined for absent lists and [] for empty ones", () => {
    expect(toFormEfforts(undefined)).toBeUndefined();
    expect(toFormEfforts([])).toEqual([]);
  });
});

describe("asFormModel", () => {
  it("normalizes contextWindow null and passes flags through", () => {
    const out = asFormModel({
      id: "m1",
      name: "M1",
      contextWindow: undefined,
      supportsVision: true,
      supportsVideo: false,
    } as Parameters<typeof asFormModel>[0]);
    expect(out.contextWindow).toBeNull();
    expect(out.supportsVision).toBe(true);
    expect(out.efforts).toBeUndefined();
  });
});

describe("modelsFromProvider", () => {
  it("uses explicit models when present", () => {
    const out = modelsFromProvider({
      id: "p",
      models: [{ id: "a" }, { id: "b", name: "B" }],
    } as Parameters<typeof modelsFromProvider>[0]);
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
    expect(out[1]?.name).toBe("B");
  });

  it("falls back to the legacy single model field", () => {
    const out = modelsFromProvider({
      id: "p",
      model: "legacy-id",
    } as Parameters<typeof modelsFromProvider>[0]);
    expect(out).toEqual([{ id: "legacy-id", name: "legacy-id" }]);
  });

  it("returns empty when the provider has no model at all", () => {
    const out = modelsFromProvider({ id: "p" } as Parameters<
      typeof modelsFromProvider
    >[0]);
    expect(out).toEqual([]);
  });
});

describe("emptyForm", () => {
  it("seeds default custom-channel efforts and neutral defaults", () => {
    const f = emptyForm();
    expect(f.id).toBe("");
    expect(f.providerMode).toBe("generic");
    expect(f.apiBackend).toBe("responses");
    expect(f.efforts.length).toBeGreaterThan(0);
    expect(f.models).toEqual([]);
  });
});

describe("formFromPreset", () => {
  it("builds a form from a real preset with its default endpoint", () => {
    const preset = PROVIDER_PRESETS[0];
    const f = formFromPreset(preset);
    expect(f.id).toBe(preset.suggestedId);
    expect(f.name).toBe(preset.name);
    expect(f.baseUrl).toContain("http");
    expect(f.apiKey).toBe("");
    expect(f.models.length).toBe(preset.models.length);
  });
});

describe("hostOf", () => {
  it("extracts the host of valid urls and passes junk through", () => {
    expect(hostOf("https://api.example.com/v1")).toBe("api.example.com");
    expect(hostOf("not a url")).toBe("not a url");
  });
});

describe("ccSwitchStatusKey", () => {
  it("maps every known status and falls back to invalid", () => {
    expect(ccSwitchStatusKey("importable")).toBe("prov.ccSwitch.status.importable");
    expect(ccSwitchStatusKey("official")).toBe("prov.ccSwitch.status.official");
    expect(ccSwitchStatusKey("missing_key")).toBe("prov.ccSwitch.status.missing_key");
    expect(ccSwitchStatusKey("proxy_managed")).toBe("prov.ccSwitch.status.proxy_managed");
    expect(ccSwitchStatusKey("exists")).toBe("prov.ccSwitch.status.exists");
    expect(ccSwitchStatusKey("whatever")).toBe("prov.ccSwitch.status.invalid");
  });
});
