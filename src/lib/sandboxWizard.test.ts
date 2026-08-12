import { describe, expect, it } from "vitest";
import {
  DEFAULT_SANDBOX_PROFILE,
  RECOMMENDED_SANDBOX_PROFILE,
  SANDBOX_PROFILES,
} from "./sandboxProfile";
import {
  SANDBOX_WIZARD_DISMISS_KEY,
  SANDBOX_WIZARD_STEP_TOTAL,
  advanceSandboxWizardStep,
  clearSandboxWizardDismissed,
  createSandboxWizardAnswers,
  loadSandboxWizardDismissed,
  markSandboxWizardDismissed,
  parseSandboxWizardDismissed,
  planSandboxWizardStep,
  recommendSandboxForTrust,
  resolveSandboxWizardBanner,
  retreatSandboxWizardStep,
  sandboxWizardProfileChoices,
  sandboxWizardStepLabelKey,
  sandboxWizardTitleKey,
  shouldOfferSandboxWizard,
  type SandboxWizardStorage,
} from "./sandboxWizard";

function memoryStorage(seed: Record<string, string> = {}): SandboxWizardStorage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe("recommendSandboxForTrust", () => {
  it("recommends workspace for everyday use on mac without honesty", () => {
    for (const platform of ["mac", "macos", "darwin"]) {
      const r = recommendSandboxForTrust({
        platform,
        cliSupportsSandbox: true,
      });
      expect(r.profile).toBe(RECOMMENDED_SANDBOX_PROFILE);
      expect(r.profile).toBe("workspace");
      expect(r.reasonKey).toBe("sandboxWizard.reason.workspace");
      expect(r.honestyKey).toBeNull();
    }
  });

  it("still recommends workspace on Windows with platform honesty", () => {
    const r = recommendSandboxForTrust({
      platform: "win",
      cliSupportsSandbox: true,
    });
    expect(r.profile).toBe("workspace");
    expect(r.honestyKey).toBe("sandboxWizard.honesty.platform");
  });

  it("flags old CLI soft-fail honesty", () => {
    const r = recommendSandboxForTrust({
      platform: "mac",
      cliSupportsSandbox: false,
    });
    expect(r.profile).toBe("workspace");
    expect(r.honestyKey).toBe("sandboxWizard.honesty.cliUnsupported");
  });

  it("prefers CLI honesty over platform when both apply", () => {
    const r = recommendSandboxForTrust({
      platform: "win",
      cliSupportsSandbox: false,
    });
    expect(r.honestyKey).toBe("sandboxWizard.honesty.cliUnsupported");
  });

  it("unknown CLI support + known enforcing platform → no honesty", () => {
    const r = recommendSandboxForTrust({
      platform: "mac",
      cliSupportsSandbox: null,
    });
    expect(r.honestyKey).toBeNull();
  });

  it("linux userns honesty when isolation recommended", () => {
    const r = recommendSandboxForTrust({
      platform: "linux",
      cliSupportsSandbox: true,
    });
    expect(r.profile).toBe("workspace");
    expect(r.honestyKey).toBe("sandboxWizard.honesty.linuxUserns");
  });
});

describe("planSandboxWizardStep", () => {
  it("intro can continue to pick without a profile", () => {
    const plan = planSandboxWizardStep("intro", { profile: null });
    expect(plan.step).toBe("intro");
    expect(plan.index).toBe(0);
    expect(plan.progress).toBe(1);
    expect(plan.total).toBe(SANDBOX_WIZARD_STEP_TOTAL);
    expect(plan.canContinue).toBe(true);
    expect(plan.canBack).toBe(false);
    expect(plan.nextStep).toBe("pick");
    expect(plan.prevStep).toBeNull();
    expect(plan.isLast).toBe(false);
    expect(plan.recommendedProfile).toBe("workspace");
  });

  it("pick requires a selected profile", () => {
    const blocked = planSandboxWizardStep("pick", { profile: null });
    expect(blocked.canContinue).toBe(false);
    expect(blocked.nextStep).toBe("confirm");
    expect(blocked.canBack).toBe(true);
    expect(blocked.prevStep).toBe("intro");

    const ok = planSandboxWizardStep("pick", { profile: "workspace" });
    expect(ok.canContinue).toBe(true);
    expect(ok.selectedProfile).toBe("workspace");
  });

  it("confirm is last and surfaces danger keys for off/devbox", () => {
    const off = planSandboxWizardStep("confirm", { profile: "off" });
    expect(off.isLast).toBe(true);
    expect(off.nextStep).toBe("done");
    expect(off.dangerKey).toBe("settings.sandbox.dangerConfirmOff");
    expect(off.canContinue).toBe(true);

    const devbox = planSandboxWizardStep("confirm", { profile: "devbox" });
    expect(devbox.dangerKey).toBe("settings.sandbox.dangerConfirmDevbox");

    const safe = planSandboxWizardStep("confirm", { profile: "workspace" });
    expect(safe.dangerKey).toBeNull();
  });
});

describe("advance / retreat", () => {
  it("advances intro → pick → confirm → done", () => {
    expect(advanceSandboxWizardStep("intro", { profile: null })).toBe("pick");
    expect(
      advanceSandboxWizardStep("pick", { profile: "strict" }),
    ).toBe("confirm");
    expect(
      advanceSandboxWizardStep("confirm", { profile: "strict" }),
    ).toBe("done");
  });

  it("stays on pick when no profile selected", () => {
    expect(advanceSandboxWizardStep("pick", { profile: null })).toBe("pick");
  });

  it("retreats confirm → pick → intro", () => {
    expect(retreatSandboxWizardStep("confirm")).toBe("pick");
    expect(retreatSandboxWizardStep("pick")).toBe("intro");
    expect(retreatSandboxWizardStep("intro")).toBe("intro");
  });
});

describe("shouldOfferSandboxWizard", () => {
  it("offers after trust when profile is still off and not dismissed", () => {
    expect(
      shouldOfferSandboxWizard({
        justTrusted: true,
        currentProfile: "off",
        dismissed: false,
      }),
    ).toBe(true);
    // Empty/missing resolves to DEFAULT (workspace) → already isolating → no offer.
    expect(
      shouldOfferSandboxWizard({
        justTrusted: true,
        currentProfile: "",
      }),
    ).toBe(false);
  });

  it("skips when not just trusted, dismissed, or already isolating", () => {
    expect(
      shouldOfferSandboxWizard({
        justTrusted: false,
        currentProfile: "off",
      }),
    ).toBe(false);
    expect(
      shouldOfferSandboxWizard({
        justTrusted: true,
        currentProfile: "off",
        dismissed: true,
      }),
    ).toBe(false);
    expect(
      shouldOfferSandboxWizard({
        justTrusted: true,
        currentProfile: "workspace",
      }),
    ).toBe(false);
    expect(
      shouldOfferSandboxWizard({
        justTrusted: true,
        currentProfile: "strict",
      }),
    ).toBe(false);
  });
});

describe("resolveSandboxWizardBanner", () => {
  it("returns null for off profile", () => {
    expect(
      resolveSandboxWizardBanner({
        platform: "win",
        cliSupportsSandbox: false,
        profile: "off",
      }),
    ).toBeNull();
  });

  it("returns platform honesty on Windows when isolating", () => {
    expect(
      resolveSandboxWizardBanner({
        platform: "win",
        cliSupportsSandbox: true,
        profile: "workspace",
      }),
    ).toBe("sandboxWizard.honesty.platform");
  });

  it("returns CLI honesty when unsupported", () => {
    expect(
      resolveSandboxWizardBanner({
        platform: "mac",
        cliSupportsSandbox: false,
        profile: "workspace",
      }),
    ).toBe("sandboxWizard.honesty.cliUnsupported");
  });

  it("returns null when isolation likely applies on mac", () => {
    expect(
      resolveSandboxWizardBanner({
        platform: "mac",
        cliSupportsSandbox: true,
        profile: "workspace",
      }),
    ).toBeNull();
  });

  it("returns linux userns honesty when isolating on Linux", () => {
    expect(
      resolveSandboxWizardBanner({
        platform: "linux",
        cliSupportsSandbox: true,
        profile: "workspace",
      }),
    ).toBe("sandboxWizard.honesty.linuxUserns");
  });
});

describe("dismiss storage", () => {
  it("parses JSON + legacy truthy flags", () => {
    expect(parseSandboxWizardDismissed(null)).toBe(false);
    expect(parseSandboxWizardDismissed("")).toBe(false);
    expect(parseSandboxWizardDismissed("1")).toBe(true);
    expect(parseSandboxWizardDismissed("true")).toBe(true);
    expect(
      parseSandboxWizardDismissed(
        JSON.stringify({ version: 1, dismissed: true }),
      ),
    ).toBe(true);
    expect(
      parseSandboxWizardDismissed(
        JSON.stringify({ version: 1, dismissed: false }),
      ),
    ).toBe(false);
    expect(parseSandboxWizardDismissed("{")).toBe(false);
  });

  it("load / mark / clear via storage surface", () => {
    const storage = memoryStorage();
    expect(loadSandboxWizardDismissed(storage)).toBe(false);
    markSandboxWizardDismissed(storage);
    expect(loadSandboxWizardDismissed(storage)).toBe(true);
    expect(storage.getItem(SANDBOX_WIZARD_DISMISS_KEY)).toContain(
      '"dismissed":true',
    );
    clearSandboxWizardDismissed(storage);
    expect(loadSandboxWizardDismissed(storage)).toBe(false);
  });
});

describe("createSandboxWizardAnswers / choices / keys", () => {
  it("seeds recommended workspace", () => {
    const a = createSandboxWizardAnswers({ platform: "mac" });
    expect(a.profile).toBe(RECOMMENDED_SANDBOX_PROFILE);
    expect(a.dontOfferAgain).toBe(false);
  });

  it("lists all sandbox profiles", () => {
    expect(sandboxWizardProfileChoices()).toEqual([...SANDBOX_PROFILES]);
  });

  it("maps title and step label keys", () => {
    expect(sandboxWizardTitleKey("trust")).toBe("sandboxWizard.title.trust");
    expect(sandboxWizardTitleKey("info")).toBe("sandboxWizard.title.info");
    expect(sandboxWizardStepLabelKey("intro")).toBe("sandboxWizard.step.intro");
    expect(sandboxWizardStepLabelKey("pick")).toBe("sandboxWizard.step.pick");
    expect(sandboxWizardStepLabelKey("confirm")).toBe(
      "sandboxWizard.step.confirm",
    );
  });

  it("default profile is workspace (matches recommended)", () => {
    expect(DEFAULT_SANDBOX_PROFILE).toBe("workspace");
    expect(RECOMMENDED_SANDBOX_PROFILE).toBe("workspace");
  });
});
