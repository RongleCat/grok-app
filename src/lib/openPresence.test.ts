import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPEN_PRESENCE_MS,
  reduceOpenPresence,
  type OpenPresenceState,
} from "./openPresence";

const closed: OpenPresenceState = { mounted: false, entered: false };

describe("reduceOpenPresence", () => {
  it("opens mounted but not entered so the first frame can paint closed styles", () => {
    expect(reduceOpenPresence(closed, { type: "open" })).toEqual({
      mounted: true,
      entered: false,
    });
  });

  it("enters only after the panel is mounted", () => {
    expect(reduceOpenPresence(closed, { type: "enter-frame" })).toEqual(closed);
    expect(
      reduceOpenPresence({ mounted: true, entered: false }, { type: "enter-frame" }),
    ).toEqual({ mounted: true, entered: true });
  });

  it("keeps the node mounted on close so the exit transition can run", () => {
    expect(
      reduceOpenPresence(
        { mounted: true, entered: true },
        { type: "close", reducedMotion: false },
      ),
    ).toEqual({ mounted: true, entered: false });
  });

  it("unmounts immediately when motion is reduced", () => {
    expect(
      reduceOpenPresence(
        { mounted: true, entered: true },
        { type: "close", reducedMotion: true },
      ),
    ).toEqual(closed);
  });

  it("drops a leaving panel after the exit timeout", () => {
    expect(
      reduceOpenPresence({ mounted: true, entered: false }, { type: "exit-done" }),
    ).toEqual(closed);
  });

  it("does not unmount if the menu re-entered before the timeout", () => {
    expect(
      reduceOpenPresence({ mounted: true, entered: true }, { type: "exit-done" }),
    ).toEqual({ mounted: true, entered: true });
  });
});

describe("floating pop CSS", () => {
  const sidebar = readFileSync(
    resolve(__dirname, "../styles/sidebar.part4.css"),
    "utf8",
  );
  const env = readFileSync(
    resolve(__dirname, "../styles/side-workbench.css"),
    "utf8",
  );
  const settings = readFileSync(
    resolve(__dirname, "../styles/settings.part1.css"),
    "utf8",
  );
  const workbenchCss = readFileSync(
    resolve(__dirname, "../styles/sidebar.part1.css"),
    "utf8",
  );
  const skins = readFileSync(
    resolve(__dirname, "../styles/skins.css"),
    "utf8",
  );
  const tree = readFileSync(
    resolve(__dirname, "../styles/sidebar.part2.css"),
    "utf8",
  );
  const appWorkbench = readFileSync(
    resolve(__dirname, "../app/AppWorkbench.tsx"),
    "utf8",
  );
  const userMenu = readFileSync(
    resolve(__dirname, "../components/UserMenu.tsx"),
    "utf8",
  );

  it("keeps account / env pops on the shared motion tokens", () => {
    expect(OPEN_PRESENCE_MS).toBe(200);
    expect(sidebar).toMatch(/\.user-menu__pop\.user-menu__pop--portal\.is-open/);
    expect(sidebar).toMatch(/transform-origin:\s*bottom/);
    expect(sidebar).toMatch(/translateY\(16px\) scaleY\(0\.92\)/);
    expect(sidebar).toMatch(/\.user-menu__flyout\.is-open/);
    expect(env).toMatch(/\.sw-env-menu\.menu-panel\.is-open/);
    expect(sidebar).toMatch(/var\(--motion-normal\) var\(--motion-pane-ease\)/);
    expect(env).toMatch(/var\(--motion-normal\) var\(--motion-pane-ease\)/);
  });

  it("switches settings atomically without a presence or paint gap", () => {
    const start = settings.indexOf(".app-settings-stage {");
    expect(start).toBeGreaterThanOrEqual(0);
    const stageCss = settings.slice(
      start,
      settings.indexOf("/* ===== Settings full page"),
    );
    expect(stageCss).not.toMatch(/visibility\s*:/);
    expect(stageCss).not.toMatch(/opacity\s*:/);
    expect(stageCss).not.toMatch(/transform\s*:/);
    expect(stageCss).not.toMatch(/(?:transition|animation)\s*:/);
    expect(stageCss).toMatch(/z-index:\s*20/);
    expect(appWorkbench).toMatch(/\{appView === "settings" \? \(/);
    expect(appWorkbench).not.toMatch(/settingsPresence|VIEW_PRESENCE_MS/);
    expect(settings).not.toMatch(/settings-stage-(?:enter|leave)/);
  });

  it("uses the same CSS frost on workbench sidebar and settings nav", () => {
    const blur =
      /backdrop-filter:\s*blur\(var\(--sidebar-blur\)\)\s*saturate\(var\(--sidebar-saturate\)\)/;
    expect(workbenchCss).toMatch(
      /\.platform-mac \.sidebar\s*\{[^}]*backdrop-filter:\s*blur\(var\(--sidebar-blur\)\)/,
    );
    expect(workbenchCss).toMatch(
      /\.platform-mac \.settings-page__nav\s*\{[^}]*backdrop-filter:\s*blur\(var\(--sidebar-blur\)\)/,
    );
    expect(workbenchCss).toMatch(blur);
  });

  it("keeps the workbench fully painted behind the direct settings swap", () => {
    expect(appWorkbench).not.toMatch(/is-view-idle/);
    expect(workbenchCss).not.toMatch(/\.workbench\.is-view-idle/);
    expect(workbenchCss).toMatch(/\.workbench\s*\{[^}]*z-index:\s*0/);
    expect(skins).toMatch(
      /html\[data-wallpaper="1"\] \.app-settings-stage\s*\{[^}]*z-index:\s*20/,
    );
    expect(skins).toMatch(
      /> \*:not\(\.window-controls\):not\(\.window-edge-n\):not\(\.app-wallpaper-media\):not\(\.app-settings-stage\)/,
    );
  });

  it("closes the account portal immediately when settings takes over", () => {
    expect(appWorkbench).toMatch(/closeImmediately=\{appView === "settings"\}/);
    expect(userMenu).toMatch(
      /useOpenPresence\(\s*open,\s*true,\s*closeImmediately \? 0 : OPEN_PRESENCE_MS,\s*\)/,
    );
    expect(userMenu).toMatch(
      /const panel\s*=\s*!closeImmediately\s*&&\s*panelPresence\.mounted/,
    );
    const hashRoute = appWorkbench.slice(
      appWorkbench.indexOf("const syncFromHash = () =>"),
      appWorkbench.indexOf("window.addEventListener(\"hashchange\""),
    );
    expect(hashRoute).toMatch(
      /if \(raw\.startsWith\("settings"\)\) \{\s*ensureSettingsNativeCover\(\);\s*setShowUserMenu\(false\);/,
    );
  });

  it("covers native child webviews before committing settings", () => {
    const navigateStart = appWorkbench.indexOf(
      "const navigateSettings = useCallback(",
    );
    const navigateEnd = appWorkbench.indexOf(
      "/** Settings → Runtime",
      navigateStart,
    );
    const navigate = appWorkbench.slice(navigateStart, navigateEnd);
    expect(navigate.indexOf("ensureSettingsNativeCover();")).toBeGreaterThan(0);
    expect(navigate.indexOf("ensureSettingsNativeCover();")).toBeLessThan(
      navigate.indexOf('setAppView("settings")'),
    );
    expect(appWorkbench).toMatch(
      /useLayoutEffect\(\(\) => \{\s*if \(appView === "settings"\)/,
    );
  });

  it("loads settings before the first navigation can hard-cut in", () => {
    expect(appWorkbench).toMatch(
      /import\s*\{\s*SettingsPage,\s*type SettingsSectionId,\s*\}\s*from "@\/components\/SettingsPage"/,
    );
    expect(appWorkbench).not.toMatch(
      /(?:lazy|import)\([^\n]*@\/components\/SettingsPage/,
    );
  });

  it("settings nav width follows the workbench rail token", () => {
    expect(settings).toMatch(
      /\.settings-page__nav\s*\{[^}]*width:\s*var\(--sidebar-rail-width/,
    );
  });

  it("interpolates project session lists instead of hard-cutting", () => {
    expect(tree).toMatch(/\.tree-reveal\s*\{/);
    expect(tree).not.toMatch(/grid-template-rows/);
    expect(tree).toMatch(/height var\(--motion-normal\)/);
    expect(tree).toMatch(/min-height var\(--motion-normal\)/);
    expect(tree).toMatch(/max-height var\(--motion-normal\)/);
    expect(tree).toMatch(/var\(--motion-pane-ease\)/);
  });
});
