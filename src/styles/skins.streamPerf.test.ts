import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("stream-perf wallpaper CSS", () => {
  it("drops wallpaper pane blur while data-stream-perf is on", () => {
    const css = readFileSync(join(here, "skins.css"), "utf8");
    expect(css).toContain(
      'html[data-stream-perf="1"][data-wallpaper="1"] .sidebar',
    );
    expect(css).toContain(
      'html[data-stream-perf="1"][data-wallpaper="1"] .aside',
    );
    expect(css).toContain(
      'html[data-stream-perf="1"][data-wallpaper="1"] .settings-page__nav',
    );
    expect(css).toMatch(
      /html\[data-stream-perf="1"\]\[data-wallpaper="1"\] \.app-settings-stage,[^{]*\{[^}]*backdrop-filter:\s*none\s*!important/s,
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
