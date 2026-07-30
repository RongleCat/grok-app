import { describe, expect, it } from "vitest";
import {
  DEFAULT_SANDBOX_PROFILE,
  DANGEROUS_SANDBOX_PROFILES,
  SANDBOX_PROFILES,
  isDangerousSandboxProfile,
  normalizeSandboxProfile,
  resolveSandboxProfile,
} from "./sandboxProfile";

describe("normalizeSandboxProfile", () => {
  it("accepts known profiles (case / trim)", () => {
    for (const p of SANDBOX_PROFILES) {
      expect(normalizeSandboxProfile(p)).toBe(p);
      expect(normalizeSandboxProfile(`  ${p.toUpperCase()}  `)).toBe(p);
    }
  });

  it("treats empty / inherit tokens as null", () => {
    expect(normalizeSandboxProfile(null)).toBeNull();
    expect(normalizeSandboxProfile(undefined)).toBeNull();
    expect(normalizeSandboxProfile("")).toBeNull();
    expect(normalizeSandboxProfile("   ")).toBeNull();
    expect(normalizeSandboxProfile("inherit")).toBeNull();
    expect(normalizeSandboxProfile("app_default")).toBeNull();
    expect(normalizeSandboxProfile("default")).toBeNull();
    expect(normalizeSandboxProfile(42)).toBeNull();
    expect(normalizeSandboxProfile(true)).toBeNull();
  });

  it("rejects unknown profiles", () => {
    expect(normalizeSandboxProfile("full")).toBeNull();
    expect(normalizeSandboxProfile("readonly")).toBeNull();
  });
});

describe("resolveSandboxProfile", () => {
  it("prefers a valid project override over global", () => {
    expect(resolveSandboxProfile("workspace", "strict")).toBe("strict");
    expect(resolveSandboxProfile("off", "read-only")).toBe("read-only");
    expect(resolveSandboxProfile("strict", "devbox")).toBe("devbox");
  });

  it("falls back to global when project override is inherit / empty / invalid", () => {
    expect(resolveSandboxProfile("workspace", null)).toBe("workspace");
    expect(resolveSandboxProfile("workspace", undefined)).toBe("workspace");
    expect(resolveSandboxProfile("workspace", "inherit")).toBe("workspace");
    expect(resolveSandboxProfile("workspace", "")).toBe("workspace");
    expect(resolveSandboxProfile("workspace", "nope")).toBe("workspace");
    expect(resolveSandboxProfile("  STRICT  ", null)).toBe("strict");
  });

  it("defaults when both are missing or invalid", () => {
    expect(resolveSandboxProfile(null, null)).toBe(DEFAULT_SANDBOX_PROFILE);
    expect(resolveSandboxProfile("bogus", "inherit")).toBe(
      DEFAULT_SANDBOX_PROFILE,
    );
    expect(resolveSandboxProfile("", "")).toBe(DEFAULT_SANDBOX_PROFILE);
  });

  it("project override of off still wins (explicit unrestricted)", () => {
    expect(resolveSandboxProfile("strict", "off")).toBe("off");
  });
});

describe("isDangerousSandboxProfile", () => {
  it("flags off and devbox only", () => {
    expect(DANGEROUS_SANDBOX_PROFILES).toEqual(["off", "devbox"]);
    expect(isDangerousSandboxProfile("off")).toBe(true);
    expect(isDangerousSandboxProfile("devbox")).toBe(true);
    expect(isDangerousSandboxProfile("workspace")).toBe(false);
    expect(isDangerousSandboxProfile("strict")).toBe(false);
    expect(isDangerousSandboxProfile("read-only")).toBe(false);
    expect(isDangerousSandboxProfile("inherit")).toBe(false);
    expect(isDangerousSandboxProfile(null)).toBe(false);
  });
});
