import { describe, expect, it } from "vitest";
import {
  classifyCliVersionStatus,
  cliVersionStatusMessageKey,
  extractSemverCore,
  mapProbeToCliInfo,
  probeVsAcpAgentVersionSkew,
} from "./cliVersionStatus";

describe("classifyCliVersionStatus", () => {
  it("classifies missing / too old / recommended", () => {
    expect(classifyCliVersionStatus({ found: false })).toBe("missing");
    expect(
      classifyCliVersionStatus({
        found: true,
        versionSupported: false,
        meetsRecommended: false,
      }),
    ).toBe("too_old");
    expect(
      classifyCliVersionStatus({
        found: true,
        versionSupported: true,
        meetsRecommended: true,
      }),
    ).toBe("recommended");
    expect(
      classifyCliVersionStatus({
        found: true,
        versionSupported: true,
        meetsRecommended: false,
      }),
    ).toBe("below_recommended");
    expect(
      classifyCliVersionStatus({
        found: true,
        versionSupported: null,
        meetsRecommended: null,
      }),
    ).toBe("unknown");
  });

  it("maps status to i18n keys", () => {
    expect(cliVersionStatusMessageKey("recommended")).toBe(
      "settings.cliVersion.recommended",
    );
    expect(cliVersionStatusMessageKey("below_recommended")).toBe(
      "settings.cliVersion.belowRecommended",
    );
  });
});

describe("probeVsAcpAgentVersionSkew", () => {
  it("detects parseable mismatch only", () => {
    expect(probeVsAcpAgentVersionSkew("grok 1.0.0", "grok 0.2.118")).toBe(
      true,
    );
    expect(probeVsAcpAgentVersionSkew("grok 1.0.0", "1.0.0 (abc)")).toBe(
      false,
    );
    expect(probeVsAcpAgentVersionSkew("grok", "1.0.0")).toBe(false);
    expect(probeVsAcpAgentVersionSkew(null, "1.0.0")).toBe(false);
  });
});

describe("extractSemverCore", () => {
  it("pulls numeric core", () => {
    expect(extractSemverCore("grok 1.0.0 (3cd0)")).toBe("1.0.0");
    expect(extractSemverCore("0.2.112")).toBe("0.2.112");
    expect(extractSemverCore("nope")).toBe(null);
  });
});

describe("mapProbeToCliInfo", () => {
  it("preserves skew and recommended fields", () => {
    const info = mapProbeToCliInfo({
      found: true,
      path: "/x/grok",
      version: "grok 1.0.0",
      source: "common_path",
      meetsRecommended: true,
      recommendedVersion: "1.0.0",
      agentBinarySkew: true,
      agentVersion: "0.2.118",
      acpAgentVersion: "grok 0.2.120",
      acpAgentVersionSkew: true,
    });
    expect(info.meetsRecommended).toBe(true);
    expect(info.agentBinarySkew).toBe(true);
    expect(info.agentVersion).toBe("0.2.118");
    expect(info.acpAgentVersion).toBe("grok 0.2.120");
    expect(info.acpAgentVersionSkew).toBe(true);
  });
});
