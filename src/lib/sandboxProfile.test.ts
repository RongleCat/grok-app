import { describe, expect, it } from "vitest";
import {
  CLI_DEFAULT_SANDBOX_PROFILE,
  DEFAULT_SANDBOX_PROFILE,
  DANGEROUS_SANDBOX_PROFILES,
  NETWORK_RESTRICT_SANDBOX_PROFILES,
  RECOMMENDED_SANDBOX_PROFILE,
  SANDBOX_CLI_FLAG,
  SANDBOX_ENV,
  SANDBOX_MIN_CLI,
  SANDBOX_PROFILES,
  SANDBOX_PROFILE_HELP_KEYS,
  SANDBOX_PROFILE_LABEL_KEYS,
  childNetworkRestrictApplies,
  cliSupportsSandbox,
  isDangerousSandboxProfile,
  isSandboxProfileId,
  normalizeSandboxProfile,
  platformEnforcesOsSandbox,
  resolveSandboxProfile,
  sandboxAppDefaultNoteKey,
  sandboxDangerConfirmKey,
  sandboxDisabledSoftNoteKey,
  sandboxIsolationActive,
  sandboxLeaderMutexActive,
  sandboxLeaderMutexMessageKey,
  sandboxLinuxUsernsNoteKey,
  sandboxProductHonestyNotes,
  sandboxProfileEqual,
  sandboxProfileHelpKey,
  sandboxProfileLabelKey,
  sandboxProfileSelectOptions,
  sandboxSoftFailKind,
  sandboxSoftFailMessageKey,
  sandboxSpawnArgs,
  sandboxSpawnArgsSoft,
  sandboxSpawnEnv,
  sandboxSpawnEnvSoft,
  sandboxSpawnFlags,
  sandboxSpawnFlagsSoft,
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

describe("isSandboxProfileId", () => {
  it("type-guards known ids", () => {
    expect(isSandboxProfileId("workspace")).toBe(true);
    expect(isSandboxProfileId("  STRICT ")).toBe(true);
    expect(isSandboxProfileId("nope")).toBe(false);
    expect(isSandboxProfileId(null)).toBe(false);
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

describe("sandboxIsolationActive", () => {
  it("is true only for non-off known profiles", () => {
    expect(sandboxIsolationActive("workspace")).toBe(true);
    expect(sandboxIsolationActive("strict")).toBe(true);
    expect(sandboxIsolationActive("off")).toBe(false);
    // Missing / invalid → DEFAULT_SANDBOX_PROFILE (workspace) → isolation on.
    expect(sandboxIsolationActive(null)).toBe(true);
    expect(sandboxIsolationActive("bogus")).toBe(true);
    expect(sandboxIsolationActive("workspace")).toBe(true);
  });
});

describe("label / help / danger keys", () => {
  it("maps every profile to a label + help key", () => {
    for (const p of SANDBOX_PROFILES) {
      expect(sandboxProfileLabelKey(p)).toBe(SANDBOX_PROFILE_LABEL_KEYS[p]);
      expect(sandboxProfileHelpKey(p)).toBe(SANDBOX_PROFILE_HELP_KEYS[p]);
    }
    expect(sandboxProfileLabelKey("nope")).toBe(
      SANDBOX_PROFILE_LABEL_KEYS.workspace,
    );
  });

  it("danger confirm keys only for off / devbox", () => {
    expect(sandboxDangerConfirmKey("off")).toBe(
      "settings.sandbox.dangerConfirmOff",
    );
    expect(sandboxDangerConfirmKey("devbox")).toBe(
      "settings.sandbox.dangerConfirmDevbox",
    );
    expect(sandboxDangerConfirmKey("workspace")).toBeNull();
    expect(sandboxDangerConfirmKey(null)).toBeNull();
  });

  it("select options cover all profiles in order", () => {
    const opts = sandboxProfileSelectOptions();
    expect(opts.map((o) => o.value)).toEqual([...SANDBOX_PROFILES]);
    expect(opts[1]?.labelKey).toBe("settings.sandbox.workspace");
  });
});

describe("sandboxSpawnArgs / env / flags", () => {
  it("omits for off and invalid", () => {
    expect(sandboxSpawnArgs("off")).toEqual([]);
    expect(sandboxSpawnArgs(null)).toEqual([]);
    expect(sandboxSpawnArgs("bogus")).toEqual([]);
    expect(sandboxSpawnEnv("off")).toEqual([]);
    expect(sandboxSpawnFlags("off")).toBeNull();
  });

  it("emits top-level flag + GROK_SANDBOX for isolation profiles", () => {
    for (const p of ["workspace", "read-only", "strict", "devbox"] as const) {
      expect(sandboxSpawnArgs(p)).toEqual([SANDBOX_CLI_FLAG, p]);
      expect(sandboxSpawnEnv(p)).toEqual([[SANDBOX_ENV, p]]);
      expect(sandboxSpawnFlags(p)).toEqual({
        args: [SANDBOX_CLI_FLAG, p],
        env: [SANDBOX_ENV, p],
      });
    }
  });
});

describe("cliSupportsSandbox", () => {
  it(`accepts ≥ ${SANDBOX_MIN_CLI}`, () => {
    expect(cliSupportsSandbox("0.2.112")).toBe(true);
    expect(cliSupportsSandbox("grok 0.2.117 (abc)")).toBe(true);
    expect(cliSupportsSandbox("0.3.0")).toBe(true);
    expect(cliSupportsSandbox("1.0.0")).toBe(true);
  });

  it("rejects known older", () => {
    expect(cliSupportsSandbox("0.2.111")).toBe(false);
    expect(cliSupportsSandbox("0.2.100")).toBe(false);
    expect(cliSupportsSandbox("0.1.99")).toBe(false);
  });

  it("returns null for unknown", () => {
    expect(cliSupportsSandbox(null)).toBeNull();
    expect(cliSupportsSandbox(undefined)).toBeNull();
    expect(cliSupportsSandbox("")).toBeNull();
    expect(cliSupportsSandbox("nope")).toBeNull();
  });
});

describe("sandboxSpawnArgsSoft / env soft", () => {
  it("omits non-off flags only on known-old CLI", () => {
    expect(sandboxSpawnArgsSoft("workspace", "0.2.100")).toEqual([]);
    expect(sandboxSpawnEnvSoft("workspace", "0.2.111")).toEqual([]);
    expect(sandboxSpawnFlagsSoft("workspace", "0.2.100")).toBeNull();
  });

  it("emits on supported or unknown CLI (forward-compat)", () => {
    expect(sandboxSpawnArgsSoft("workspace", "0.2.112")).toEqual([
      SANDBOX_CLI_FLAG,
      "workspace",
    ]);
    expect(sandboxSpawnArgsSoft("strict", null)).toEqual([
      SANDBOX_CLI_FLAG,
      "strict",
    ]);
    expect(sandboxSpawnArgsSoft("strict", "garbage")).toEqual([
      SANDBOX_CLI_FLAG,
      "strict",
    ]);
    expect(sandboxSpawnEnvSoft("strict", "grok 0.2.117")).toEqual([
      [SANDBOX_ENV, "strict"],
    ]);
    expect(sandboxSpawnFlagsSoft("devbox", "0.2.117")).toEqual({
      args: [SANDBOX_CLI_FLAG, "devbox"],
      env: [SANDBOX_ENV, "devbox"],
    });
  });

  it("always empty for off", () => {
    expect(sandboxSpawnArgsSoft("off", "0.2.117")).toEqual([]);
    expect(sandboxSpawnArgsSoft("off", "0.2.100")).toEqual([]);
  });
});

describe("platform honesty", () => {
  it("enforces OS sandbox on mac / linux only", () => {
    expect(platformEnforcesOsSandbox("mac")).toBe(true);
    expect(platformEnforcesOsSandbox("linux")).toBe(true);
    expect(platformEnforcesOsSandbox("win")).toBe(false);
    expect(platformEnforcesOsSandbox("other")).toBe(false);
    expect(platformEnforcesOsSandbox(null)).toBe(true);
  });

  it("child network restrict is Linux-only for read-only / strict", () => {
    expect(NETWORK_RESTRICT_SANDBOX_PROFILES).toEqual(["read-only", "strict"]);
    expect(childNetworkRestrictApplies("strict", "linux")).toBe(true);
    expect(childNetworkRestrictApplies("read-only", "linux")).toBe(true);
    expect(childNetworkRestrictApplies("strict", "mac")).toBe(false);
    expect(childNetworkRestrictApplies("workspace", "linux")).toBe(false);
    expect(childNetworkRestrictApplies("strict", "win")).toBe(false);
  });
});

describe("sandboxSoftFailKind", () => {
  it("null when off", () => {
    expect(
      sandboxSoftFailKind({
        profile: "off",
        cliFound: false,
        platform: "win",
      }),
    ).toBeNull();
  });

  it("cli_missing wins", () => {
    expect(
      sandboxSoftFailKind({
        profile: "workspace",
        cliFound: false,
        cliVersion: "0.2.100",
        platform: "win",
      }),
    ).toBe("cli_missing");
  });

  it("cli_unsupported when version known old", () => {
    expect(
      sandboxSoftFailKind({
        profile: "workspace",
        cliFound: true,
        cliVersion: "0.2.100",
        platform: "mac",
      }),
    ).toBe("cli_unsupported");
  });

  it("platform_soft on Windows when CLI is ok", () => {
    expect(
      sandboxSoftFailKind({
        profile: "workspace",
        cliFound: true,
        cliVersion: "0.2.117",
        platform: "win",
      }),
    ).toBe("platform_soft");
  });

  it("null when mac + supported CLI", () => {
    expect(
      sandboxSoftFailKind({
        profile: "workspace",
        cliFound: true,
        cliVersion: "0.2.117",
        platform: "mac",
      }),
    ).toBeNull();
  });

  it("maps soft-fail kinds to i18n keys", () => {
    expect(sandboxSoftFailMessageKey("cli_missing")).toBe(
      "settings.sandbox.softFail.cliMissing",
    );
    expect(sandboxSoftFailMessageKey("cli_unsupported")).toBe(
      "settings.sandbox.softFail.cliUnsupported",
    );
    expect(sandboxSoftFailMessageKey("platform_soft")).toBe(
      "settings.sandbox.softFail.platform",
    );
  });
});

describe("sandboxProfileEqual", () => {
  it("normalizes before compare", () => {
    expect(sandboxProfileEqual("  WorkSpace ", "workspace")).toBe(true);
    expect(sandboxProfileEqual("strict", "off")).toBe(false);
    expect(sandboxProfileEqual(null, "workspace")).toBe(true);
    expect(sandboxProfileEqual(null, "off")).toBe(false);
    expect(sandboxProfileEqual("bogus", null)).toBe(true);
  });
});

describe("recommended profile", () => {
  it("is workspace (CLI everyday default recommendation)", () => {
    expect(RECOMMENDED_SANDBOX_PROFILE).toBe("workspace");
  });
});

describe("product path honesty", () => {
  it("App default is workspace; CLI bare default is off", () => {
    expect(DEFAULT_SANDBOX_PROFILE).toBe("workspace");
    expect(CLI_DEFAULT_SANDBOX_PROFILE).toBe("off");
    expect(DEFAULT_SANDBOX_PROFILE).not.toBe(CLI_DEFAULT_SANDBOX_PROFILE);
    expect(sandboxAppDefaultNoteKey()).toBe("settings.sandbox.appDefaultNote");
  });

  it("disabled soft note only when isolation is off", () => {
    expect(sandboxDisabledSoftNoteKey("off")).toBe(
      "settings.sandbox.softFail.disabled",
    );
    expect(sandboxDisabledSoftNoteKey("workspace")).toBeNull();
    expect(sandboxDisabledSoftNoteKey(null)).toBeNull(); // resolves to workspace
  });

  it("linux userns note only on linux with isolation", () => {
    expect(sandboxLinuxUsernsNoteKey("linux", "workspace")).toBe(
      "settings.sandbox.linuxUserns",
    );
    expect(sandboxLinuxUsernsNoteKey("linux", "off")).toBeNull();
    expect(sandboxLinuxUsernsNoteKey("mac", "workspace")).toBeNull();
    expect(sandboxLinuxUsernsNoteKey("win", "strict")).toBeNull();
  });

  it("leader mutex when useLeader + non-off sandbox", () => {
    expect(sandboxLeaderMutexActive("workspace", true)).toBe(true);
    expect(sandboxLeaderMutexActive("off", true)).toBe(false);
    expect(sandboxLeaderMutexActive("workspace", false)).toBe(false);
    expect(sandboxLeaderMutexMessageKey()).toBe("settings.sandbox.leaderMutex");
  });

  it("product honesty notes include app_default always and leader when both on", () => {
    const base = sandboxProductHonestyNotes({
      profile: "workspace",
      useLeader: false,
      platform: "mac",
    });
    expect(base.map((n) => n.kind)).toEqual(["app_default"]);

    const off = sandboxProductHonestyNotes({
      profile: "off",
      useLeader: false,
      platform: "mac",
    });
    expect(off.map((n) => n.kind)).toEqual(["app_default", "disabled"]);

    const linux = sandboxProductHonestyNotes({
      profile: "workspace",
      useLeader: true,
      platform: "linux",
    });
    expect(linux.map((n) => n.kind)).toEqual([
      "app_default",
      "linux_userns",
      "leader_mutex",
    ]);
  });
});
