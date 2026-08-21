import { describe, expect, it } from "vitest";
import {
  channelExtraBodyKey,
  channelFromHostString,
  classifyUpdateError,
  formatUpdateProgressLine,
  isAutoUpdatePath,
  isUpdateActionBusy,
  mapUpdateStatusCopy,
  needsInstallAndRestartConfirm,
  planUserCheckUpdate,
  resolveManualUpdateUrls,
  resolveUpdateChannelHonesty,
  resolveUpdateChannelHonestyPreferHost,
  isUpdateAffordanceVisible,
  shouldInstallWhenReady,
  shouldShowInstallButton,
  shouldShowInstallProgress,
  shouldShowManualDownloadCtas,
  updateChannelLabelKey,
  updateErrorBodyKey,
  updateInstallConfirmCopyKeys,
  updateStatusToneClass,
  type AppUpdateStatusLike,
} from "./appUpdateHonesty";

describe("resolveUpdateChannelHonesty", () => {
  it("returns host_only when not desktop", () => {
    expect(
      resolveUpdateChannelHonesty({
        pluginEnabled: true,
        autoUpdateSupported: true,
        isDesktopHost: false,
      }),
    ).toBe("host_only");
  });

  it("returns manual_github when plugin is off", () => {
    expect(
      resolveUpdateChannelHonesty({
        pluginEnabled: false,
        autoUpdateSupported: false,
        isDesktopHost: true,
      }),
    ).toBe("manual_github");
  });

  it("returns unsupported when plugin on but platform cannot auto-update", () => {
    expect(
      resolveUpdateChannelHonesty({
        pluginEnabled: true,
        autoUpdateSupported: false,
        isDesktopHost: true,
      }),
    ).toBe("unsupported");
  });

  it("returns auto when plugin + platform support silent path", () => {
    expect(
      resolveUpdateChannelHonesty({
        pluginEnabled: true,
        autoUpdateSupported: true,
        isDesktopHost: true,
      }),
    ).toBe("auto");
  });

  it("manual-required + platform gate → unsupported", () => {
    expect(
      resolveUpdateChannelHonesty({
        pluginEnabled: true,
        autoUpdateSupported: false,
        isDesktopHost: true,
        status: {
          state: "manual-required",
          version: "0.2.4",
          releaseUrl: "https://example.com/r",
        },
      }),
    ).toBe("unsupported");
  });

  it("manual-required without platform gate → manual_github", () => {
    expect(
      resolveUpdateChannelHonesty({
        pluginEnabled: false,
        autoUpdateSupported: false,
        isDesktopHost: true,
        status: {
          state: "manual-required",
          version: "0.2.4",
          releaseUrl: "https://example.com/r",
        },
      }),
    ).toBe("manual_github");
  });
});

describe("updateChannelLabelKey / isAutoUpdatePath", () => {
  it("maps channels to i18n keys", () => {
    expect(updateChannelLabelKey("auto")).toBe(
      "settings.autoUpdateChannelSilent",
    );
    expect(updateChannelLabelKey("manual_github")).toBe(
      "settings.autoUpdateChannelManual",
    );
    expect(updateChannelLabelKey("unsupported")).toBe(
      "settings.autoUpdateChannelUnsupported",
    );
    expect(updateChannelLabelKey("host_only")).toBe(
      "settings.autoUpdateChannelHostOnly",
    );
  });

  it("only auto is silent-install path", () => {
    expect(isAutoUpdatePath("auto")).toBe(true);
    expect(isAutoUpdatePath("manual_github")).toBe(false);
    expect(isAutoUpdatePath("unsupported")).toBe(false);
    expect(isAutoUpdatePath("host_only")).toBe(false);
  });
});

describe("mapUpdateStatusCopy", () => {
  it("maps idle with no invented version (empty honesty)", () => {
    const c = mapUpdateStatusCopy({ state: "idle" });
    expect(c.titleKey).toBe("settings.autoUpdateIdle");
    expect(c.version).toBeNull();
    expect(c.severity).toBe("none");
    expect(c.bodyKey).toBeNull();
  });

  it("maps checking / progress states with body notes", () => {
    expect(mapUpdateStatusCopy({ state: "checking" }).bodyKey).toBe(
      "settings.autoUpdateBody.checking",
    );
    expect(
      mapUpdateStatusCopy({ state: "downloading", version: "1.2.3" }),
    ).toMatchObject({
      titleKey: "settings.autoUpdateDownloading",
      bodyKey: "settings.autoUpdateBody.downloading",
      version: "1.2.3",
      severity: "info",
    });
    expect(
      mapUpdateStatusCopy({ state: "installing", version: "1.2.3" }).bodyKey,
    ).toBe("settings.autoUpdateBody.installing");
  });

  it("never invents version on up-to-date without one", () => {
    const bare = mapUpdateStatusCopy({ state: "up-to-date" });
    expect(bare.titleKey).toBe("settings.autoUpdateUpToDate");
    expect(bare.version).toBeNull();

    const withV = mapUpdateStatusCopy({
      state: "up-to-date",
      version: "0.2.3",
    });
    expect(withV.titleKey).toBe("settings.checkUpdateLatest");
    expect(withV.version).toBe("0.2.3");
  });

  it("manual-required keeps version and manual body", () => {
    const c = mapUpdateStatusCopy({
      state: "manual-required",
      version: "0.3.0",
      releaseUrl: "https://github.com/x/y/releases/latest",
    });
    expect(c.titleKey).toBe("settings.autoUpdateManualRequired");
    expect(c.bodyKey).toBe("settings.autoUpdateBody.manual");
    expect(c.version).toBe("0.3.0");
    expect(c.severity).toBe("warn");
  });

  it("available notes agents stop only after install prepare", () => {
    const c = mapUpdateStatusCopy({ state: "available", version: "1.0.0" });
    expect(c.bodyKey).toBe("settings.autoUpdateBody.agentsNote");
  });

  it("ready uses warn severity for install CTA", () => {
    const c = mapUpdateStatusCopy({ state: "ready", version: "1.0.1" });
    expect(c.titleKey).toBe("settings.autoUpdateReady");
    expect(c.bodyKey).toBe("settings.autoUpdateBody.ready");
    expect(c.severity).toBe("warn");
  });

  it("classifies error soft-fails into body keys", () => {
    const net = mapUpdateStatusCopy({
      state: "error",
      message: "network timeout while fetching",
    });
    expect(net.severity).toBe("error");
    expect(net.errorKind).toBe("network");
    expect(net.bodyKey).toBe("settings.autoUpdateError.network");
    expect(net.version).toBeNull();
  });
});

describe("formatUpdateProgressLine", () => {
  it("returns null for idle", () => {
    expect(formatUpdateProgressLine({ state: "idle" })).toBeNull();
  });

  it("returns title key without inventing version", () => {
    expect(formatUpdateProgressLine({ state: "checking" })).toEqual({
      titleKey: "settings.autoUpdateChecking",
      version: null,
      severity: "info",
    });
    expect(
      formatUpdateProgressLine({ state: "available", version: "9.9.9" }),
    ).toEqual({
      titleKey: "settings.autoUpdateAvailable",
      version: "9.9.9",
      severity: "info",
    });
  });
});

describe("shouldShowInstallProgress / busy / CTAs", () => {
  it("shows progress only for downloading, installing, restarting", () => {
    expect(shouldShowInstallProgress({ state: "downloading" })).toBe(true);
    expect(shouldShowInstallProgress({ state: "installing" })).toBe(true);
    expect(shouldShowInstallProgress({ state: "restarting" })).toBe(true);
    expect(shouldShowInstallProgress({ state: "available" })).toBe(false);
    expect(shouldShowInstallProgress({ state: "ready" })).toBe(false);
    expect(shouldShowInstallProgress({ state: "checking" })).toBe(false);
    expect(shouldShowInstallProgress(null)).toBe(false);
  });

  it("marks check/install busy for checking + progress + restarting", () => {
    expect(isUpdateActionBusy({ state: "checking" })).toBe(true);
    expect(isUpdateActionBusy({ state: "downloading" })).toBe(true);
    expect(isUpdateActionBusy({ state: "installing" })).toBe(true);
    expect(isUpdateActionBusy({ state: "restarting" })).toBe(true);
    expect(isUpdateActionBusy({ state: "ready" })).toBe(false);
  });

  it("install button only when ready; manual CTAs only when manual-required", () => {
    expect(shouldShowInstallButton({ state: "ready" })).toBe(true);
    expect(shouldShowInstallButton({ state: "available" })).toBe(false);
    expect(shouldShowManualDownloadCtas({ state: "manual-required" })).toBe(
      true,
    );
    expect(shouldShowManualDownloadCtas({ state: "available" })).toBe(false);
  });

  it("sidebar update affordance shows for known newer build / in-flight", () => {
    expect(isUpdateAffordanceVisible({ state: "available" })).toBe(true);
    expect(isUpdateAffordanceVisible({ state: "downloading" })).toBe(true);
    expect(isUpdateAffordanceVisible({ state: "ready" })).toBe(true);
    expect(isUpdateAffordanceVisible({ state: "installing" })).toBe(true);
    expect(isUpdateAffordanceVisible({ state: "restarting" })).toBe(true);
    expect(isUpdateAffordanceVisible({ state: "manual-required" })).toBe(true);
    expect(isUpdateAffordanceVisible({ state: "idle" })).toBe(false);
    expect(isUpdateAffordanceVisible({ state: "checking" })).toBe(false);
    expect(isUpdateAffordanceVisible({ state: "up-to-date" })).toBe(false);
    expect(isUpdateAffordanceVisible({ state: "error" })).toBe(false);
    expect(isUpdateAffordanceVisible(null)).toBe(false);
  });
});

describe("classifyUpdateError", () => {
  it("classifies network soft-fails", () => {
    expect(classifyUpdateError("Network request failed")).toBe("network");
    expect(classifyUpdateError("connection timed out")).toBe("network");
    expect(classifyUpdateError("failed to fetch latest.json")).toBe("network");
  });

  it("classifies signature soft-fails", () => {
    expect(classifyUpdateError("signature verification failed")).toBe(
      "signature",
    );
    expect(classifyUpdateError("minisign: invalid pubkey")).toBe("signature");
  });

  it("classifies plugin_missing soft-fails", () => {
    expect(classifyUpdateError("plugin updater not found")).toBe(
      "plugin_missing",
    );
    expect(classifyUpdateError('command "check" not found')).toBe(
      "plugin_missing",
    );
  });

  it("classifies not_ready and host_only", () => {
    expect(classifyUpdateError("Update is not ready to install yet")).toBe(
      "not_ready",
    );
    expect(
      classifyUpdateError("Updates are only available in the desktop app"),
    ).toBe("host_only");
  });

  it("falls back to other for unknown / empty", () => {
    expect(classifyUpdateError("")).toBe("other");
    expect(classifyUpdateError(null)).toBe("other");
    expect(classifyUpdateError("weird boom")).toBe("other");
  });

  it("maps kinds to body keys", () => {
    expect(updateErrorBodyKey("network")).toBe(
      "settings.autoUpdateError.network",
    );
    expect(updateErrorBodyKey("signature")).toBe(
      "settings.autoUpdateError.signature",
    );
    expect(updateErrorBodyKey("plugin_missing")).toBe(
      "settings.autoUpdateError.pluginMissing",
    );
  });
});

describe("resolveManualUpdateUrls", () => {
  it("prefers status URLs and never invents download", () => {
    const r = resolveManualUpdateUrls(
      {
        state: "manual-required",
        version: "1.0.0",
        releaseUrl: "https://github.com/RongleCat/grok-app/releases/tag/v1.0.0",
        downloadUrl: "https://github.com/x/y/releases/download/v1/a.dmg",
        assetNames: ["a.dmg", ""],
      },
      "https://github.com/RongleCat/grok-app/releases/latest",
    );
    expect(r.releaseUrl).toContain("tag/v1.0.0");
    expect(r.downloadUrl).toContain("a.dmg");
    expect(r.assetNames).toEqual(["a.dmg"]);
  });

  it("falls back to provided releases URL when status has none", () => {
    const r = resolveManualUpdateUrls(
      { state: "manual-required", version: "1.0.0" },
      "https://github.com/RongleCat/grok-app/releases/latest",
    );
    expect(r.releaseUrl).toBe(
      "https://github.com/RongleCat/grok-app/releases/latest",
    );
    expect(r.downloadUrl).toBeNull();
  });
});

describe("channelFromHostString / prefer host", () => {
  it("parses known host channel strings only", () => {
    expect(channelFromHostString("silent")).toBe("auto");
    expect(channelFromHostString("github_manual")).toBe("manual_github");
    expect(channelFromHostString("unsupported")).toBe("unsupported");
    expect(channelFromHostString("nightly")).toBeNull();
    expect(channelFromHostString("")).toBeNull();
  });

  it("prefer host silent when capability is auto; live manual-required wins", () => {
    expect(
      resolveUpdateChannelHonestyPreferHost({
        hostChannel: "silent",
        pluginEnabled: true,
        autoUpdateSupported: true,
        isDesktopHost: true,
      }),
    ).toBe("auto");

    expect(
      resolveUpdateChannelHonestyPreferHost({
        hostChannel: "silent",
        pluginEnabled: true,
        autoUpdateSupported: false,
        isDesktopHost: true,
        status: {
          state: "manual-required",
          version: "0.2.4",
          releaseUrl: "https://example.com",
        },
      }),
    ).toBe("unsupported");
  });

  it("never claims silent when plugin is off (stale host silent)", () => {
    expect(
      resolveUpdateChannelHonestyPreferHost({
        hostChannel: "silent",
        pluginEnabled: false,
        autoUpdateSupported: false,
        isDesktopHost: true,
      }),
    ).toBe("manual_github");
  });

  it("capability unsupported wins over collapsed host github_manual", () => {
    expect(
      resolveUpdateChannelHonestyPreferHost({
        hostChannel: "github_manual",
        pluginEnabled: true,
        autoUpdateSupported: false,
        isDesktopHost: true,
      }),
    ).toBe("unsupported");
  });

  it("safer host non-auto wins when capability looks auto", () => {
    expect(
      resolveUpdateChannelHonestyPreferHost({
        hostChannel: "github_manual",
        pluginEnabled: true,
        autoUpdateSupported: true,
        isDesktopHost: true,
      }),
    ).toBe("manual_github");
  });
});

describe("channelExtraBodyKey", () => {
  it("adds Linux AppImage note only for unsupported channel", () => {
    expect(channelExtraBodyKey("unsupported")).toBe(
      "settings.autoUpdateBody.linuxAppImage",
    );
    expect(channelExtraBodyKey("auto")).toBeNull();
    expect(channelExtraBodyKey("manual_github")).toBeNull();
    expect(channelExtraBodyKey("host_only")).toBeNull();
  });
});

describe("updateStatusToneClass", () => {
  it("maps severity to CSS modifiers", () => {
    expect(updateStatusToneClass("error")).toBe("is-error");
    expect(updateStatusToneClass("warn")).toBe("is-available");
    expect(updateStatusToneClass("info")).toBe("is-available");
    expect(updateStatusToneClass("success")).toBe("");
    expect(updateStatusToneClass("none")).toBe("");
  });
});

describe("user-initiated check must not auto-install", () => {
  it("only confirmed apply installs when download reaches ready", () => {
    expect(shouldInstallWhenReady("check")).toBe(false);
    expect(shouldInstallWhenReady("background")).toBe(false);
    expect(shouldInstallWhenReady("apply")).toBe(true);
  });

  it("About check stops at ready / downloading and only downloads when available", () => {
    expect(planUserCheckUpdate({ state: "ready", version: "1.2.3" })).toEqual({
      action: "noop",
    });
    expect(planUserCheckUpdate({ state: "downloading", version: "1.2.3" })).toEqual({
      action: "noop",
    });
    expect(planUserCheckUpdate({ state: "installing", version: "1.2.3" })).toEqual({
      action: "noop",
    });
    expect(planUserCheckUpdate({ state: "restarting", version: "1.2.3" })).toEqual({
      action: "noop",
    });
    expect(planUserCheckUpdate({ state: "available", version: "1.2.3" })).toEqual({
      action: "download",
      version: "1.2.3",
    });
    expect(planUserCheckUpdate({ state: "idle" })).toEqual({ action: "runCheck" });
    expect(planUserCheckUpdate({ state: "up-to-date" })).toEqual({
      action: "runCheck",
    });
    expect(planUserCheckUpdate({ state: "error" })).toEqual({
      action: "runCheck",
    });
  });

  it("signed ready/available/downloading need confirm; manual GitHub does not", () => {
    expect(needsInstallAndRestartConfirm({ state: "ready" })).toBe(true);
    expect(needsInstallAndRestartConfirm({ state: "available" })).toBe(true);
    expect(needsInstallAndRestartConfirm({ state: "downloading" })).toBe(true);
    expect(needsInstallAndRestartConfirm({ state: "manual-required" })).toBe(
      false,
    );
    expect(needsInstallAndRestartConfirm({ state: "installing" })).toBe(false);
    expect(needsInstallAndRestartConfirm({ state: "idle" })).toBe(false);
    expect(needsInstallAndRestartConfirm(null)).toBe(false);
  });

  it("confirm copy keys keep a {version} placeholder", () => {
    const keys = updateInstallConfirmCopyKeys();
    expect(keys.titleKey).toBe("settings.autoUpdateConfirm.title");
    expect(keys.messageKey).toBe("settings.autoUpdateConfirm.message");
    expect(keys.confirmKey).toBe("settings.autoUpdateConfirm.confirm");
    expect(keys.cancelKey).toBe("settings.autoUpdateConfirm.cancel");
  });
});

describe("status machine exhaustiveness smoke", () => {
  const states: AppUpdateStatusLike[] = [
    { state: "idle" },
    { state: "checking" },
    { state: "up-to-date" },
    { state: "up-to-date", version: "1.0.0" },
    { state: "available", version: "1.0.1" },
    { state: "downloading", version: "1.0.1" },
    { state: "installing", version: "1.0.1" },
    { state: "ready", version: "1.0.1" },
    {
      state: "manual-required",
      version: "1.0.1",
      releaseUrl: "https://example.com",
    },
    { state: "error", message: "boom" },
  ];

  it("maps every known state without throwing", () => {
    for (const s of states) {
      const copy = mapUpdateStatusCopy(s);
      expect(copy.severity).toBeTruthy();
      if (s.state !== "error" && s.state !== "idle" && s.state !== "checking") {
        // version fields only when provided
        if (s.version) expect(copy.version).toBe(s.version);
      }
    }
  });
});
