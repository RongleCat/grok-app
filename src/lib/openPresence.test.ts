import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPEN_PRESENCE_MS,
  VIEW_PRESENCE_MS,
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
  const tree = readFileSync(
    resolve(__dirname, "../styles/sidebar.part2.css"),
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

  it("crossfades settings over a still-mounted workbench", () => {
    expect(VIEW_PRESENCE_MS).toBe(320);
    expect(settings).toMatch(/\.app-settings-stage\.is-open/);
    expect(settings).toMatch(/transform-origin:\s*bottom left/);
    expect(settings).toMatch(/var\(--motion-pane\) var\(--motion-pane-ease\)/);
    expect(workbenchCss).toMatch(/\.workbench\.is-view-idle/);
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
