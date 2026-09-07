import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROXY_MODE,
  PROXY_MODES,
  PROXY_URL_SCHEMES,
  classifyProbeResult,
  classifyProbeTarget,
  classifyProbeTargetError,
  isProxyMode,
  isValidProxyUrl,
  manualProxyUrlSoftFail,
  normalizeProxyMode,
  probeOutcomeMessageKey,
  probeOutcomeTone,
  probeTargetClassMessageKey,
  probeToneClass,
  proxyApplyHonestyScopes,
  proxyApplyMessageKey,
  proxySoftFailMessageKey,
  proxyUrlErrorMessageKey,
  validateProxyUrl,
} from "./networkProxy";

describe("normalizeProxyMode", () => {
  it("accepts known modes (case / trim)", () => {
    for (const m of PROXY_MODES) {
      expect(normalizeProxyMode(m)).toBe(m);
      expect(normalizeProxyMode(`  ${m.toUpperCase()}  `)).toBe(m);
    }
  });

  it("maps aliases", () => {
    expect(normalizeProxyMode("direct")).toBe("none");
    expect(normalizeProxyMode("off")).toBe("none");
    expect(normalizeProxyMode("custom")).toBe("manual");
    expect(normalizeProxyMode("os")).toBe("system");
    expect(normalizeProxyMode("auto")).toBe("system");
  });

  it("only migrates legacy use when a valid manual URL exists", () => {
    expect(
      normalizeProxyMode(" USE ", " http://127.0.0.1:18080 "),
    ).toBe("manual");
    expect(normalizeProxyMode("use", "127.0.0.1:18080")).toBe("system");
    expect(normalizeProxyMode("use", "")).toBe("system");
    expect(normalizeProxyMode("use")).toBe("system");
  });

  it("defaults unknown / empty to system", () => {
    expect(normalizeProxyMode(null)).toBe(DEFAULT_PROXY_MODE);
    expect(normalizeProxyMode(undefined)).toBe(DEFAULT_PROXY_MODE);
    expect(normalizeProxyMode("")).toBe(DEFAULT_PROXY_MODE);
    expect(normalizeProxyMode("  ")).toBe(DEFAULT_PROXY_MODE);
    expect(normalizeProxyMode("bogus")).toBe(DEFAULT_PROXY_MODE);
    expect(normalizeProxyMode(42)).toBe(DEFAULT_PROXY_MODE);
  });
});

describe("isProxyMode", () => {
  it("type-guards known ids", () => {
    expect(isProxyMode("system")).toBe(true);
    expect(isProxyMode("  MANUAL ")).toBe(true);
    expect(isProxyMode("direct")).toBe(false);
    expect(isProxyMode(null)).toBe(false);
  });
});

describe("validateProxyUrl", () => {
  it("accepts http / https / socks5 / socks5h with host", () => {
    for (const scheme of PROXY_URL_SCHEMES) {
      const r = validateProxyUrl(`${scheme}://127.0.0.1:7890`);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.scheme).toBe(scheme);
        expect(r.host).toBe("127.0.0.1");
      }
    }
    expect(isValidProxyUrl("http://proxy.example.com:8080")).toBe(true);
    expect(isValidProxyUrl("socks5://user:pass@10.0.0.1:1080")).toBe(true);
  });

  it("rejects empty", () => {
    expect(validateProxyUrl("")).toEqual({ ok: false, error: "empty" });
    expect(validateProxyUrl("   ")).toEqual({ ok: false, error: "empty" });
    expect(validateProxyUrl(null)).toEqual({ ok: false, error: "empty" });
  });

  it("rejects missing scheme", () => {
    expect(validateProxyUrl("127.0.0.1:7890")).toEqual({
      ok: false,
      error: "missing_scheme",
    });
    expect(validateProxyUrl("proxy.local:1080")).toEqual({
      ok: false,
      error: "missing_scheme",
    });
  });

  it("rejects unsupported scheme", () => {
    expect(validateProxyUrl("ftp://x:1")).toEqual({
      ok: false,
      error: "unsupported_scheme",
    });
    expect(validateProxyUrl("socks4://127.0.0.1:1080")).toEqual({
      ok: false,
      error: "unsupported_scheme",
    });
  });

  it("rejects missing host / empty authority", () => {
    // Node URL throws on `http://` (invalid_url); browsers may parse empty host.
    const bare = validateProxyUrl("http://");
    expect(bare.ok).toBe(false);
    if (!bare.ok) {
      expect(["missing_host", "invalid_url"]).toContain(bare.error);
    }
  });

  it("rejects unparseable junk", () => {
    expect(validateProxyUrl("http://[bad").ok).toBe(false);
  });
});

describe("manualProxyUrlSoftFail", () => {
  it("only soft-fails in manual mode", () => {
    expect(manualProxyUrlSoftFail("system", "")).toBeNull();
    expect(manualProxyUrlSoftFail("none", "nope")).toBeNull();
    expect(manualProxyUrlSoftFail("manual", "http://127.0.0.1:7890")).toBeNull();
    expect(manualProxyUrlSoftFail("use", "http://127.0.0.1:18080")).toBeNull();
    expect(manualProxyUrlSoftFail("manual", "")).toBe("empty");
    expect(manualProxyUrlSoftFail("manual", "127.0.0.1:7890")).toBe(
      "missing_scheme",
    );
  });
});

describe("proxyUrlErrorMessageKey / softFail", () => {
  it("maps errors to stable keys", () => {
    expect(proxyUrlErrorMessageKey("empty")).toBe(
      "settings.proxyUrlError.empty",
    );
    expect(proxyUrlErrorMessageKey("missing_scheme")).toBe(
      "settings.proxyUrlError.missingScheme",
    );
    expect(proxySoftFailMessageKey("manual", "ftp://x")).toBe(
      "settings.proxyUrlError.unsupportedScheme",
    );
    expect(proxySoftFailMessageKey("system", "")).toBeNull();
  });
});

describe("classifyProbeTargetError", () => {
  it("returns ok when reachable", () => {
    expect(classifyProbeTargetError("timeout", true)).toBe("ok");
  });

  it("classifies common failure shapes", () => {
    expect(classifyProbeTargetError("operation timed out", false)).toBe(
      "fail_timeout",
    );
    expect(classifyProbeTargetError("dns error: no such host", false)).toBe(
      "fail_dns",
    );
    expect(
      classifyProbeTargetError("error sending request for url: proxy", false),
    ).toBe("fail_proxy");
    expect(classifyProbeTargetError("tls handshake failure", false)).toBe(
      "fail_tls",
    );
    expect(classifyProbeTargetError("connection refused", false)).toBe(
      "fail_connect",
    );
    expect(classifyProbeTargetError("something weird", false)).toBe(
      "fail_other",
    );
    expect(classifyProbeTargetError("", false)).toBe("fail_other");
  });
});

describe("classifyProbeResult", () => {
  const sampleTargets = [
    {
      key: "auth",
      url: "https://auth.x.ai/",
      ok: true,
      status: 200,
      millis: 40,
    },
    {
      key: "chat",
      url: "https://cli-chat-proxy.grok.com/",
      ok: false,
      error: "connection refused",
      millis: 12,
    },
    {
      key: "api",
      url: "https://api.x.ai/",
      ok: true,
      status: 401,
      millis: 55,
    },
  ];

  it("classifies partial / all_ok / all_fail", () => {
    const partial = classifyProbeResult({ targets: sampleTargets });
    expect(partial.outcome).toBe("partial");
    expect(partial.okCount).toBe(2);
    expect(partial.failCount).toBe(1);
    expect(partial.tone).toBe("warn");
    expect(partial.targets[1]?.klass).toBe("fail_connect");

    const allOk = classifyProbeResult({
      allOk: true,
      targets: sampleTargets.map((t) => ({ ...t, ok: true, error: undefined })),
    });
    expect(allOk.outcome).toBe("all_ok");
    expect(allOk.tone).toBe("ok");

    const allFail = classifyProbeResult({
      targets: sampleTargets.map((t) => ({
        ...t,
        ok: false,
        error: "timed out",
      })),
    });
    expect(allFail.outcome).toBe("all_fail");
    expect(allFail.tone).toBe("err");
  });

  it("handles empty / invoke error / unavailable", () => {
    expect(classifyProbeResult({ targets: [] }).outcome).toBe("empty");
    expect(classifyProbeResult(null).outcome).toBe("empty");
    const err = classifyProbeResult(null, {
      invokeError: "command network_probe not found",
    });
    expect(err.outcome).toBe("error");
    expect(err.invokeError).toContain("network_probe");
    expect(
      classifyProbeResult(null, { available: false }).outcome,
    ).toBe("unavailable");
  });

  it("normalize target status / millis soft", () => {
    const t = classifyProbeTarget({
      key: "api",
      ok: true,
      status: "404",
      millis: 12.8,
    });
    expect(t.status).toBe(404);
    expect(t.millis).toBe(12);
    expect(t.klass).toBe("ok");
  });
});

describe("probe message keys + tone class", () => {
  it("maps outcomes and target classes", () => {
    expect(probeOutcomeMessageKey("partial")).toBe(
      "settings.netProbe.outcome.partial",
    );
    expect(probeTargetClassMessageKey("fail_dns")).toBe(
      "settings.netProbe.target.dns",
    );
    expect(probeOutcomeTone("all_ok")).toBe("ok");
    expect(probeToneClass("warn")).toBe("is-warn");
    expect(probeToneClass("muted")).toBe("is-muted");
  });
});

describe("proxy apply honesty", () => {
  it("lists core scopes and adds manual invalid inherit", () => {
    const base = proxyApplyHonestyScopes("system", "");
    expect(base).toContain("saved");
    expect(base).toContain("new_agents");
    expect(base).toContain("reconnect");
    expect(base).toContain("probe_effective");
    expect(base).not.toContain("manual_invalid_inherit");

    const bad = proxyApplyHonestyScopes("manual", "nope");
    expect(bad).toContain("manual_invalid_inherit");
    expect(proxyApplyMessageKey("reconnect")).toBe(
      "settings.proxy.apply.reconnect",
    );
  });
});
