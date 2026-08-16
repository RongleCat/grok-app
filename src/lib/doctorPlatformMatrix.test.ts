import { describe, expect, it } from "vitest";
import {
  DOCTOR_PLATFORM_MATRIX_ROW_IDS,
  buildDoctorPlatformMatrix,
  countDoctorPlatformMatrix,
  doctorPlatformCellStatusKey,
  doctorPlatformCellTone,
  normalizeDoctorPlatform,
  normalizeDoctorUpdateChannel,
} from "./doctorPlatformMatrix";

describe("normalizeDoctorPlatform", () => {
  it("maps mac aliases", () => {
    expect(normalizeDoctorPlatform("mac")).toBe("mac");
    expect(normalizeDoctorPlatform("macOS")).toBe("mac");
    expect(normalizeDoctorPlatform("darwin")).toBe("mac");
  });

  it("maps win / linux aliases", () => {
    expect(normalizeDoctorPlatform("win")).toBe("win");
    expect(normalizeDoctorPlatform("Windows")).toBe("win");
    expect(normalizeDoctorPlatform("linux")).toBe("linux");
  });

  it("unknown / empty → other", () => {
    expect(normalizeDoctorPlatform(null)).toBe("other");
    expect(normalizeDoctorPlatform("")).toBe("other");
    expect(normalizeDoctorPlatform("freebsd")).toBe("other");
  });
});

describe("normalizeDoctorUpdateChannel", () => {
  it("normalizes silent / auto", () => {
    expect(normalizeDoctorUpdateChannel("silent")).toBe("silent");
    expect(normalizeDoctorUpdateChannel("auto")).toBe("silent");
  });

  it("normalizes manual tokens", () => {
    expect(normalizeDoctorUpdateChannel("github_manual")).toBe("github_manual");
    expect(normalizeDoctorUpdateChannel("manual_github")).toBe("github_manual");
    expect(normalizeDoctorUpdateChannel("manual")).toBe("github_manual");
  });

  it("does not invent from unknown strings", () => {
    expect(normalizeDoctorUpdateChannel(null)).toBe("unknown");
    expect(normalizeDoctorUpdateChannel("nightly")).toBe("unknown");
    expect(normalizeDoctorUpdateChannel("")).toBe("unknown");
  });
});

describe("buildDoctorPlatformMatrix", () => {
  it("returns all six rows in stable order", () => {
    const m = buildDoctorPlatformMatrix({
      platform: "mac",
      cliFound: true,
      sandboxProfile: "workspace",
      updateChannel: "silent",
    });
    expect(m.rows.map((r) => r.rowId)).toEqual([
      ...DOCTOR_PLATFORM_MATRIX_ROW_IDS,
    ]);
    expect(m.platform).toBe("mac");
  });

  it("mac: seatbelt pass, overlay chrome, silent update", () => {
    const m = buildDoctorPlatformMatrix({
      platform: "mac",
      cliFound: true,
      sandboxProfile: "strict",
      updateChannel: "silent",
    });
    const byId = Object.fromEntries(m.rows.map((r) => [r.rowId, r]));
    expect(byId.platform?.status).toBe("pass");
    expect(byId.cli_path_probe?.status).toBe("pass");
    expect(byId.sandbox_enforcement).toMatchObject({
      status: "pass",
      messageKey: "doctor.platformMatrix.msg.sandbox.macSeatbelt",
    });
    expect(byId.window_chrome).toMatchObject({
      status: "pass",
      messageKey: "doctor.platformMatrix.msg.chrome.macOverlay",
    });
    expect(byId.auto_update?.status).toBe("pass");
    expect(byId.media_loopback?.status).toBe("pass");
  });

  it("windows: sandbox soft-fail warn when isolation requested", () => {
    const m = buildDoctorPlatformMatrix({
      platform: "win",
      cliFound: true,
      sandboxProfile: "workspace",
      updateChannel: "silent",
    });
    const sandbox = m.rows.find((r) => r.rowId === "sandbox_enforcement");
    expect(sandbox).toMatchObject({
      status: "warn",
      messageKey: "doctor.platformMatrix.msg.sandbox.winSoftFail",
    });
    const chrome = m.rows.find((r) => r.rowId === "window_chrome");
    expect(chrome).toMatchObject({
      status: "pass",
      messageKey: "doctor.platformMatrix.msg.chrome.winFrameless",
    });
  });

  it("linux: landlock note when isolation requested", () => {
    const m = buildDoctorPlatformMatrix({
      platform: "linux",
      cliFound: true,
      sandboxProfile: "read-only",
      updateChannel: "github_manual",
    });
    const sandbox = m.rows.find((r) => r.rowId === "sandbox_enforcement");
    expect(sandbox).toMatchObject({
      status: "pass",
      messageKey: "doctor.platformMatrix.msg.sandbox.linuxLandlock",
    });
    const chrome = m.rows.find((r) => r.rowId === "window_chrome");
    expect(chrome?.messageKey).toBe(
      "doctor.platformMatrix.msg.chrome.linuxFrameless",
    );
    const update = m.rows.find((r) => r.rowId === "auto_update");
    expect(update).toMatchObject({
      status: "warn",
      messageKey: "doctor.platformMatrix.msg.update.manual",
    });
  });

  it("sandbox off → na (not requested)", () => {
    const m = buildDoctorPlatformMatrix({
      platform: "win",
      sandboxProfile: "off",
    });
    const sandbox = m.rows.find((r) => r.rowId === "sandbox_enforcement");
    expect(sandbox).toMatchObject({
      status: "na",
      messageKey: "doctor.platformMatrix.msg.sandbox.off",
    });
  });

  it("does not invent CLI found / update channel", () => {
    const m = buildDoctorPlatformMatrix({
      platform: "mac",
      // cliFound / updateChannel omitted
    });
    const cli = m.rows.find((r) => r.rowId === "cli_path_probe");
    expect(cli?.status).toBe("unknown");
    const update = m.rows.find((r) => r.rowId === "auto_update");
    expect(update?.status).toBe("unknown");
  });

  it("cli missing → warn", () => {
    const m = buildDoctorPlatformMatrix({
      platform: "linux",
      cliFound: false,
    });
    expect(
      m.rows.find((r) => r.rowId === "cli_path_probe")?.status,
    ).toBe("warn");
  });

  it("mediaLoopback false → warn without inventing pass", () => {
    const m = buildDoctorPlatformMatrix({
      platform: "mac",
      mediaLoopback: false,
    });
    expect(
      m.rows.find((r) => r.rowId === "media_loopback"),
    ).toMatchObject({
      status: "warn",
      messageKey: "doctor.platformMatrix.msg.media.unavailable",
    });
  });

  it("update unsupported / host_only honesty", () => {
    const unsupported = buildDoctorPlatformMatrix({
      platform: "linux",
      updateChannel: "unsupported",
    });
    expect(
      unsupported.rows.find((r) => r.rowId === "auto_update"),
    ).toMatchObject({
      status: "warn",
      messageKey: "doctor.platformMatrix.msg.update.unsupported",
    });

    const hostOnly = buildDoctorPlatformMatrix({
      platform: "mac",
      updateChannel: "host_only",
    });
    expect(
      hostOnly.rows.find((r) => r.rowId === "auto_update"),
    ).toMatchObject({
      status: "na",
      messageKey: "doctor.platformMatrix.msg.update.hostOnly",
    });
  });

  it("other platform → unknown platform / chrome / media design", () => {
    const m = buildDoctorPlatformMatrix({
      platform: "freebsd",
      cliFound: true,
      sandboxProfile: "workspace",
    });
    expect(m.platform).toBe("other");
    expect(m.rows.find((r) => r.rowId === "platform")?.status).toBe("unknown");
    expect(m.rows.find((r) => r.rowId === "window_chrome")?.status).toBe(
      "unknown",
    );
    expect(m.rows.find((r) => r.rowId === "sandbox_enforcement")?.status).toBe(
      "unknown",
    );
    expect(m.rows.find((r) => r.rowId === "media_loopback")?.status).toBe(
      "unknown",
    );
  });
});

describe("countDoctorPlatformMatrix / status helpers", () => {
  it("counts statuses", () => {
    const m = buildDoctorPlatformMatrix({
      platform: "win",
      cliFound: false,
      sandboxProfile: "workspace",
      updateChannel: "github_manual",
    });
    const c = countDoctorPlatformMatrix(m);
    expect(c.total).toBe(6);
    expect(c.warn).toBeGreaterThanOrEqual(2); // cli + sandbox + maybe update
    expect(c.pass + c.warn + c.na + c.unknown).toBe(6);
  });

  it("maps status keys and tones", () => {
    expect(doctorPlatformCellStatusKey("pass")).toBe(
      "doctor.platformMatrix.status.pass",
    );
    expect(doctorPlatformCellStatusKey("na")).toBe(
      "doctor.platformMatrix.status.na",
    );
    expect(doctorPlatformCellTone("pass")).toBe("ok");
    expect(doctorPlatformCellTone("warn")).toBe("warn");
    expect(doctorPlatformCellTone("na")).toBe("na");
    expect(doctorPlatformCellTone("unknown")).toBe("unknown");
  });

  it("empty matrix counts zero", () => {
    expect(countDoctorPlatformMatrix(null)).toEqual({
      pass: 0,
      warn: 0,
      na: 0,
      unknown: 0,
      total: 0,
    });
  });
});
