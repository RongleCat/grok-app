import { describe, expect, it } from "vitest";
import {
  buildProviderApplyToastKey,
  classifyProviderPingError,
  classifyProviderSaveError,
  providerPingErrorMessageKey,
  providerSaveErrorMessageKey,
  resolveProviderApplyEffect,
  resolveProvidersEmptyState,
  unsupportedGrokBuildProxyModels,
} from "./providerRouteHonesty";

describe("resolveProviderApplyEffect", () => {
  it("host_only when not Tauri regardless of reload", () => {
    expect(
      resolveProviderApplyEffect({ needsReload: true, isTauri: false }),
    ).toBe("host_only");
    expect(
      resolveProviderApplyEffect({ needsReload: false, isTauri: false }),
    ).toBe("host_only");
  });

  it("soft_respawn when Tauri + needsReload", () => {
    expect(
      resolveProviderApplyEffect({ needsReload: true, isTauri: true }),
    ).toBe("soft_respawn");
  });

  it("saved_disk_only when Tauri + no reload", () => {
    expect(
      resolveProviderApplyEffect({ needsReload: false, isTauri: true }),
    ).toBe("saved_disk_only");
  });
});

describe("buildProviderApplyToastKey", () => {
  it("maps effects to stable prov.apply.* keys", () => {
    expect(buildProviderApplyToastKey("soft_respawn")).toBe(
      "prov.apply.softRespawn",
    );
    expect(buildProviderApplyToastKey("saved_disk_only")).toBe(
      "prov.apply.savedDiskOnly",
    );
    expect(buildProviderApplyToastKey("host_only")).toBe(
      "prov.apply.hostOnly",
    );
  });
});

describe("classifyProviderSaveError / providerSaveErrorMessageKey", () => {
  it("classifies timeout", () => {
    expect(classifyProviderSaveError("Provider save timed out")).toBe(
      "timeout",
    );
    expect(classifyProviderSaveError("Save is taking too long")).toBe(
      "timeout",
    );
    expect(classifyProviderSaveError({ code: "timeout" })).toBe("timeout");
    expect(providerSaveErrorMessageKey("timeout")).toBe(
      "prov.err.saveTimeout",
    );
  });

  it("classifies validation", () => {
    expect(classifyProviderSaveError("provider already exists")).toBe(
      "validation",
    );
    expect(classifyProviderSaveError("Base URL is required")).toBe(
      "validation",
    );
    expect(classifyProviderSaveError("unknown provider")).toBe("validation");
    expect(classifyProviderSaveError({ code: "validation" })).toBe(
      "validation",
    );
    expect(providerSaveErrorMessageKey("validation")).toBe(
      "prov.err.validation",
    );
  });

  it("classifies network", () => {
    expect(classifyProviderSaveError("connection refused")).toBe("network");
    expect(classifyProviderSaveError("ENOTFOUND api.example")).toBe(
      "network",
    );
    expect(classifyProviderSaveError({ code: "econnrefused" })).toBe(
      "network",
    );
    expect(providerSaveErrorMessageKey("network")).toBe("prov.err.network");
  });

  it("classifies host_only", () => {
    expect(classifyProviderSaveError("need tauri")).toBe("host_only");
    expect(classifyProviderSaveError("requires the desktop app")).toBe(
      "host_only",
    );
    expect(classifyProviderSaveError({ code: "need_tauri" })).toBe(
      "host_only",
    );
    expect(providerSaveErrorMessageKey("host_only")).toBe(
      "prov.err.hostOnly",
    );
  });

  it("falls back to other", () => {
    expect(classifyProviderSaveError("weird boom")).toBe("other");
    expect(classifyProviderSaveError(null)).toBe("other");
    expect(classifyProviderSaveError(new Error("unexpected ipc"))).toBe(
      "other",
    );
    expect(providerSaveErrorMessageKey("other")).toBe("prov.err.other");
  });
});

describe("classifyProviderPingError / providerPingErrorMessageKey", () => {
  it("classifies timeout / network / auth / invalid_url / host_only", () => {
    expect(classifyProviderPingError("request timed out after 10s")).toBe(
      "timeout",
    );
    expect(classifyProviderPingError("ECONNREFUSED 127.0.0.1:443")).toBe(
      "network",
    );
    expect(classifyProviderPingError("HTTP 401 Unauthorized")).toBe("auth");
    expect(classifyProviderPingError("invalid URL")).toBe("invalid_url");
    expect(classifyProviderPingError("need tauri")).toBe("host_only");
    expect(classifyProviderPingError("weird")).toBe("other");
    expect(classifyProviderPingError(null)).toBe("other");
  });

  it("maps kinds to stable message keys", () => {
    expect(providerPingErrorMessageKey("timeout")).toBe(
      "prov.ping.err.timeout",
    );
    expect(providerPingErrorMessageKey("network")).toBe(
      "prov.ping.err.network",
    );
    expect(providerPingErrorMessageKey("auth")).toBe("prov.ping.err.auth");
    expect(providerPingErrorMessageKey("host_only")).toBe(
      "prov.ping.err.hostOnly",
    );
    expect(providerPingErrorMessageKey("invalid_url")).toBe(
      "prov.ping.err.invalidUrl",
    );
    expect(providerPingErrorMessageKey("other")).toBe("prov.ping.err.other");
  });

  it("honors structured codes", () => {
    expect(classifyProviderPingError({ code: "401", message: "nope" })).toBe(
      "auth",
    );
    expect(
      classifyProviderPingError({ code: "invalid_url", message: "x" }),
    ).toBe("invalid_url");
  });
});

describe("resolveProvidersEmptyState", () => {
  it("host_only when not Tauri", () => {
    const s = resolveProvidersEmptyState({
      isTauri: false,
      customCount: 3,
    });
    expect(s.kind).toBe("host_only");
    expect(s.messageKey).toBe("prov.empty.hostOnly");
    expect(s.severity).toBe("warn");
  });

  it("load_error when list failed", () => {
    const s = resolveProvidersEmptyState({
      isTauri: true,
      customCount: 0,
      loadError: "ipc failed",
    });
    expect(s.kind).toBe("load_error");
    expect(s.messageKey).toBe("prov.empty.loadError");
    expect(s.severity).toBe("err");
  });

  it("no_custom when zero custom providers", () => {
    const s = resolveProvidersEmptyState({
      isTauri: true,
      customCount: 0,
    });
    expect(s.kind).toBe("no_custom");
    expect(s.messageKey).toBe("prov.empty.noCustom");
    expect(s.severity).toBe("info");
  });

  it("ok when custom providers present", () => {
    const s = resolveProvidersEmptyState({
      isTauri: true,
      customCount: 2,
    });
    expect(s.kind).toBe("ok");
    expect(s.messageKey).toBeNull();
    expect(s.severity).toBe("none");
  });
});

describe("unsupportedGrokBuildProxyModels", () => {
  const remoteModels = [
    { id: "grok-4.6", supportsBackendSearch: true },
    { id: "grok-4.5", supportsBackendSearch: false },
    { id: "relay-without-claim" },
  ];

  it("stays neutral for generic mode or before a live catalog is fetched", () => {
    expect(
      unsupportedGrokBuildProxyModels({
        providerMode: "generic",
        selectedModelIds: ["grok-4.5"],
        remoteModels,
      }),
    ).toEqual([]);
    expect(
      unsupportedGrokBuildProxyModels({
        providerMode: "grok_build_proxy",
        selectedModelIds: ["grok-4.5"],
        remoteModels: [],
      }),
    ).toEqual([]);
  });

  it("reports missing, false, and omitted capability claims", () => {
    expect(
      unsupportedGrokBuildProxyModels({
        providerMode: "grok_build_proxy",
        selectedModelIds: [
          "grok-4.6",
          "grok-4.5",
          "relay-without-claim",
          "missing-model",
        ],
        remoteModels,
      }),
    ).toEqual(["grok-4.5", "relay-without-claim", "missing-model"]);
  });
});

describe("product matrix", () => {
  const cases: Array<{
    name: string;
    needsReload: boolean;
    isTauri: boolean;
    effect: ReturnType<typeof resolveProviderApplyEffect>;
  }> = [
    {
      name: "browser + reload → host_only",
      needsReload: true,
      isTauri: false,
      effect: "host_only",
    },
    {
      name: "browser + no reload → host_only",
      needsReload: false,
      isTauri: false,
      effect: "host_only",
    },
    {
      name: "tauri + active route → soft_respawn",
      needsReload: true,
      isTauri: true,
      effect: "soft_respawn",
    },
    {
      name: "tauri + inactive edit → saved_disk_only",
      needsReload: false,
      isTauri: true,
      effect: "saved_disk_only",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(
        resolveProviderApplyEffect({
          needsReload: c.needsReload,
          isTauri: c.isTauri,
        }),
      ).toBe(c.effect);
      expect(buildProviderApplyToastKey(c.effect).startsWith("prov.apply.")).toBe(
        true,
      );
    });
  }
});
