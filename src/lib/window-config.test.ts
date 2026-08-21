/**
 * Window chrome: mac Overlay traffic lights; Windows frameless + self-drawn controls.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const TAURI_DIR = resolve(__dirname, "../../src-tauri");
const CONF_PATH = resolve(TAURI_DIR, "tauri.conf.json");
const MAC_PATH = resolve(TAURI_DIR, "tauri.macos.conf.json");
const WIN_PATH = resolve(TAURI_DIR, "tauri.windows.conf.json");
const LINUX_PATH = resolve(TAURI_DIR, "tauri.linux.conf.json");

/**
 * Read a source file for text assertions, normalized to LF.
 *
 * The repo stores LF, but git's default `core.autocrlf=true` on Windows writes
 * CRLF into the working tree. Asserting on raw bytes then fails against source
 * that is perfectly correct, and only ever for Windows contributors.
 */
const readSource = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("window chrome", () => {
  it("ships platform-specific window configs", () => {
    expect(existsSync(CONF_PATH)).toBe(true);
    expect(existsSync(MAC_PATH)).toBe(true);
    expect(existsSync(WIN_PATH)).toBe(true);
  });

  it("mac uses Overlay traffic lights without system title text", () => {
    const conf = JSON.parse(readFileSync(MAC_PATH, "utf8")) as {
      app: {
        macOSPrivateApi?: boolean;
        windows: Array<{
          decorations?: boolean;
          titleBarStyle?: string;
          hiddenTitle?: boolean;
          trafficLightPosition?: { x: number; y: number };
          transparent?: boolean;
        }>;
      };
    };
    const main = conf.app.windows[0]!;
    expect(main.titleBarStyle).toBe("Overlay");
    expect(main.hiddenTitle).toBe(true);
    expect(main.trafficLightPosition).toBeTruthy();
    expect(main.transparent).toBe(true);
    expect(main.decorations).toBe(true);
    expect(conf.app.macOSPrivateApi).toBe(true);
  });

  it("comfort min stays 900; Host caps OS min to half the work area", () => {
    // Do not drop JSON minWidth to "fit" 1440 — large screens keep 900.
    // window_min.rs caps WM_GETMINMAXINFO to half the current work area.
    for (const path of [CONF_PATH, MAC_PATH, WIN_PATH, LINUX_PATH]) {
      const conf = JSON.parse(readFileSync(path, "utf8")) as {
        app: { windows: Array<{ minWidth?: number }> };
      };
      expect(conf.app.windows[0]!.minWidth).toBe(900);
    }
    const host = readSource(resolve(TAURI_DIR, "src/window_min.rs"));
    expect(host).toMatch(/fn snap_friendly_min/);
    expect(host).toContain("work_area");
    // Same cases as src-tauri/src/window_min.rs (comfort stays 900; OS min ≤ half).
    const snapFriendlyMin = (comfort: number, work: number) => {
      if (!Number.isFinite(comfort) || comfort <= 0) return 1;
      if (!Number.isFinite(work) || work <= 0) return comfort;
      const half = Math.floor(work / 2);
      if (half <= 0) return comfort;
      return Math.min(comfort, half);
    };
    expect(snapFriendlyMin(900, 1440)).toBe(720);
    expect(snapFriendlyMin(900, 1920)).toBe(900);
    expect(snapFriendlyMin(600, 852)).toBe(426);
  });

  it("windows is frameless for self-drawn controls", () => {
    const conf = JSON.parse(readFileSync(WIN_PATH, "utf8")) as {
      app: {
        windows: Array<{
          decorations?: boolean;
          transparent?: boolean;
        }>;
      };
    };
    const main = conf.app.windows[0]!;
    expect(main.decorations).toBe(false);
    expect(main.transparent).toBe(false);
  });

  it("ships Windows shell integration for Show Desktop (frameless alone)", () => {
    // decorations:false + tray skip_taskbar needs win_shell.rs so Explorer
    // ToggleDesktop still minimizes when Grok is the only window.
    const winShell = resolve(TAURI_DIR, "src/win_shell.rs");
    expect(existsSync(winShell)).toBe(true);
    const body = readSource(winShell);
    expect(body).toMatch(/SetCurrentProcessExplicitAppUserModelID/);
    expect(body).toMatch(/WS_EX_APPWINDOW/);
    expect(body).toMatch(/ensure_main_window_shell_integration/);
    expect(body).toMatch(/set_main_window_skip_taskbar/);
    const conf = JSON.parse(readFileSync(CONF_PATH, "utf8")) as { identifier?: string };
    expect(conf.identifier).toBe("com.grokapp.desktop");
    expect(body).toContain("com.grokapp.desktop");
  });

  it("user close keeps the macOS Dock icon", () => {
    const tray = readSource(resolve(TAURI_DIR, "src/tray.rs"));
    expect(tray).toContain("pub fn hide_to_tray");
    expect(tray).toContain("pub fn hide_to_tray_accessory");
    const hideFn = tray.slice(tray.indexOf("pub fn hide_to_tray("));
    const innerStart = tray.indexOf("fn hide_to_tray_inner");
    const inner = tray.slice(innerStart, innerStart + 1800);
    expect(hideFn.startsWith("pub fn hide_to_tray(app: &AppHandle) {\n    hide_to_tray_inner(app, false);")).toBe(
      true,
    );
    expect(inner).toContain("set_dock_visibility(true)");
    expect(inner).toContain("ActivationPolicy::Regular");
  });

  it("base product identity is Grok", () => {
    const conf = JSON.parse(readFileSync(CONF_PATH, "utf8")) as {
      productName?: string;
      app: { windows: Array<{ title?: string }> };
    };
    expect(conf.productName).toBe("Grok");
    expect(conf.app.windows[0]!.title).toBe("Grok");
  });

  it("uses window-vibrancy for native frosted glass on macOS", () => {
    const cargo = readSource(resolve(TAURI_DIR, "Cargo.toml"));
    expect(cargo).toMatch(/window-vibrancy/);
  });
});
