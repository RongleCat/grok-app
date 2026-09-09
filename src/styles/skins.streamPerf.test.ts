import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("stream-perf wallpaper CSS", () => {
  it("does not rebuild wallpaper pane filters while data-stream-perf changes", () => {
    const css = readFileSync(join(here, "skins.css"), "utf8");
    expect(css).not.toMatch(
      /html\[data-stream-perf="1"\]\[data-wallpaper="1"\][^{]*\{[^}]*backdrop-filter:/s,
    );
    expect(css).not.toContain(
      'html[data-stream-perf="1"][data-wallpaper="1"]',
    );
  });

  it("keeps wallpaper media frost and inset during stream-perf (#941)", () => {
    const css = readFileSync(join(here, "skins.css"), "utf8");
    expect(css).not.toMatch(
      /html\[data-stream-perf="1"\]\[data-wallpaper="1"\]\s+\.app-wallpaper-media\s*\{[^}]*filter:\s*none/s,
    );
    expect(css).not.toMatch(
      /html\[data-stream-perf="1"\]\[data-wallpaper="1"\]\s+\.app-wallpaper-media\s*\{[^}]*inset:\s*0/s,
    );
    expect(css).not.toMatch(
      /html\.platform-win\[data-stream-perf="1"\]\[data-wallpaper="1"\]\s+\.app-wallpaper-media__el\s*\{[^}]*filter:\s*none/s,
    );
  });

  it("only drops pane blur mid-gesture when wallpaper is absent", () => {
    const css = readFileSync(join(here, "skins.css"), "utf8");
    expect(css).toContain(
      'html:not([data-wallpaper="1"]):has(.lobe-chat__scroll[data-scrolling="1"]) .composer',
    );
    expect(css).toContain(
      'html:not([data-wallpaper="1"]):has(.lobe-chat__scroll[data-scrolling="1"]) .sidebar',
    );
    expect(css).not.toContain(
      'html:has(.lobe-chat__scroll[data-scrolling="1"]) .sidebar',
    );
  });

  it("never paints an opaque transcript plate over wallpaper", () => {
    const css = readFileSync(join(here, "skins.css"), "utf8");
    expect(css).not.toMatch(
      /html\[data-wallpaper="1"\]\s+\.lobe-chat__scroll\[data-scrolling="1"\]\s*\{[^}]*background:\s*var\(--bg-main\)/s,
    );
  });

  it("keeps wallpaper plan-bar blur stable during stream-perf", () => {
    const css = readFileSync(join(here, "skins.css"), "utf8");
    expect(css).toContain(
      'html[data-stream-perf="1"]:not([data-wallpaper="1"]) .plan-bar',
    );
    expect(css).not.toContain(
      'html[data-stream-perf="1"] .plan-bar',
    );
  });

  it("keeps wallpaper kanban filters stable during stream-perf", () => {
    const css = readFileSync(join(here, "workbench.part1b.css"), "utf8");
    expect(css).not.toMatch(
      /html\[data-stream-perf="1"\]\[data-wallpaper="1"\][^{]*\{[^}]*backdrop-filter:/s,
    );
  });

  it("does not put backdrop-filter on in-scroller video play buttons", () => {
    const css = readFileSync(join(here, "chat.part3.css"), "utf8");
    expect(css).not.toMatch(
      /\.md-body__video-card__play\s*\{[^}]*backdrop-filter/s,
    );
  });

  it("keeps wallpaper media frost at scrim 0% (#941)", () => {
    const css = readFileSync(join(here, "skins.css"), "utf8");
    expect(css).not.toMatch(
      /html\[data-wallpaper="1"\]\[data-wallpaper-clear="1"\]\s+\.app-wallpaper-media\s*\{[^}]*filter:\s*none/s,
    );
    expect(css).not.toMatch(
      /html\[data-wallpaper="1"\]\[data-wallpaper-clear="1"\]\s+\.app-wallpaper-media\s*\{[^}]*inset:\s*0/s,
    );
  });
});
