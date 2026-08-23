import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(__dirname, "../styles/settings.part1.css"),
  "utf8",
);

describe("settings tab motion guard", () => {
  it("slides one shared pill only across two-tab strips", () => {
    expect(css).toMatch(
      /\.settings-page__tabs-seg:has\(\s*> \.settings-seg__btn:nth-child\(2\):last-child\s*\)::before\s*\{[^}]*transition:\s*transform var\(--motion-normal\)/,
    );
    expect(css).toMatch(
      /\.settings-page__tabs-seg:has\(\s*> \.settings-seg__btn:nth-child\(2\)\.is-on:last-child\s*\)::before\s*\{[^}]*transform:\s*translateX\(100%\)/,
    );
  });
});
