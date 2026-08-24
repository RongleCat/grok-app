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
  });
});
