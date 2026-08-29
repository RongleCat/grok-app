import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = join(__dirname, "../styles");
const chat1 = readFileSync(join(styles, "chat.part1.css"), "utf8");
const chat2 = readFileSync(join(styles, "chat.part2.css"), "utf8");
const chat4 = readFileSync(join(styles, "chat.part4.css"), "utf8");
const lobe3 = readFileSync(
  join(__dirname, "../components/lobe-chat/lobe-chat.part3.css"),
  "utf8",
);
const column = readFileSync(
  join(__dirname, "../app/WorkbenchComposerColumn.tsx"),
  "utf8",
);
const shell = readFileSync(
  join(__dirname, "../app/WorkbenchComposerShell.tsx"),
  "utf8",
);
const app = column + shell;
const modelMenu = readFileSync(
  join(__dirname, "../components/ComposerModelMenu.tsx"),
  "utf8",
);
const composer1 = readFileSync(join(styles, "composer.part1.css"), "utf8");

describe("composer column matches chat width", () => {
  it("publishes --chat-width-max on html so composer inherits it", () => {
    expect(lobe3).toMatch(/html\s*\{[^}]*--chat-width-max:\s*800px/s);
    expect(lobe3).toMatch(
      /html\[data-chat-width="medium"\],\s*\.lobe-chat\[data-chat-width="medium"\]\s*\{[^}]*--chat-width-max:\s*800px/s,
    );
    expect(lobe3).toMatch(
      /html\[data-chat-width="full"\],\s*\.lobe-chat\[data-chat-width="full"\]\s*\{[^}]*--chat-width-max:\s*none/s,
    );
  });

  it("caps empty and active composer on the same token as the transcript", () => {
    expect(chat1).toMatch(
      /\.composer-stack\s*\{[^}]*max-width:\s*var\(--chat-width-max, 800px\)/s,
    );
    expect(chat1).toMatch(
      /\.composer-wrap--welcome \.composer-stack\s*\{[^}]*max-width:\s*var\(--chat-width-max, 800px\)/s,
    );
    expect(chat1).not.toMatch(
      /\.composer-wrap--welcome[^{]*\{[^}]*max-width:\s*42rem/s,
    );
    expect(chat2).toMatch(
      /\.composer\s*\{[^}]*max-width:\s*var\(--chat-width-max, 800px\)/s,
    );
  });

  it("keeps the workspace bar as a menu-radius shell, not a pill", () => {
    expect(chat2).toMatch(
      /\.composer__chip-shell\s*\{[^}]*--composer-context-radius:\s*var\(--menu-radius, 12px\)[^}]*border-radius:\s*var\(--composer-context-radius\)/s,
    );
    expect(chat2).toMatch(
      /\.composer__chip-shell::before\s*\{[^}]*var\(--composer-opacity-mix, 100%\)/s,
    );
    expect(chat2).toMatch(
      /\.composer\s*\{[^}]*background:\s*transparent[^}]*border-radius:\s*var\(--menu-radius, 12px\)/s,
    );
    expect(chat2).toMatch(
      /\.composer::before\s*\{[^}]*var\(--composer-opacity-mix, 100%\)/s,
    );
  });

  it("splits workspace and model chips into content-sized chrome shells", () => {
    expect(chat2).toMatch(
      /\.composer__chrome\s*\{[^}]*justify-content:\s*space-between/s,
    );
    expect(chat2).toMatch(
      /\.composer__chip-shell\s*\{[^}]*width:\s*max-content/s,
    );
    expect(chat1).toMatch(
      /\.composer-stack\s*\{[^}]*container-name:\s*composer/s,
    );
    expect(app).toContain('className="composer__chrome"');
    expect(app).toContain(
      'className="composer__model-bar composer__chip-shell"',
    );
    expect(modelMenu).not.toContain("cmm__nested");
    expect(modelMenu).toContain("cmm__hub");
    expect(modelMenu).toContain("cmm__stage");
    expect(modelMenu).toContain("cmm__pop--flyout");
    expect(modelMenu).toContain('showFlyout("models")');
    expect(modelMenu).not.toContain('goPane("models")');
    const modelIdx = app.indexOf("<ComposerModelMenu");
    const accessIdx = app.indexOf("<ComposerAccessMenu");
    const shellIdx = app.indexOf("ref={composerShellRef}");
    expect(modelIdx).toBeGreaterThan(-1);
    expect(accessIdx).toBeGreaterThan(-1);
    expect(modelIdx).toBeLessThan(shellIdx);
    expect(accessIdx).toBeGreaterThan(shellIdx);
    expect(app.indexOf("<ComposerModelMenu", modelIdx + 1)).toBe(-1);
    expect(modelMenu).toContain("cmm__stops");
    expect(modelMenu).toMatch(
      /const triggerText = `\$\{modelLabel\} \$\{eLabel\}`/,
    );
    expect(modelMenu).toContain("pinParent");
    expect(modelMenu).not.toContain('className="cmm--effort"');
    expect(chat2).toMatch(
      /\.composer__model-bar:has\(\.is-open\)\s*\{[^}]*width:\s*280px/s,
    );
    expect(chat2).toMatch(
      /\.composer__model-bar \.cmm__trigger\s*\{[^}]*justify-content:\s*center/s,
    );
  });

  it("keeps composer chip pops as compact dropdowns", () => {
    expect(composer1).not.toMatch(/max-width:\s*min\(720px/);
    expect(composer1).toMatch(
      /\.cmm__pop(?:\.cmm__pop--model|--model)\s*\{[^}]*max-width:\s*min\(280px/s,
    );
    expect(modelMenu).toMatch(/align:\s*"end"/);
    expect(modelMenu).toMatch(/anchor:\s*"bottom"/);
    expect(composer1).toMatch(
      /\.cmm__pop\.cmm__pop--access\s*\{[^}]*width:\s*300px/s,
    );
    expect(composer1).toMatch(/\.cmm__stops-rail/);
    expect(composer1).toMatch(/@keyframes cmm-pop-up/);
    expect(composer1).toMatch(
      /\.cmm__pop\.cmm__pop--portal\.cmm__pop--flyout/,
    );
    expect(composer1).not.toMatch(/\.cmm__nested\s*\{/);
    expect(composer1).not.toMatch(/\.cmm__back\s*\{/);
  });

  it("shows composer icon wells only on hover or open", () => {
    expect(chat4).toMatch(
      /\.composer \.icon-btn:not\(\.icon-btn--primary\):not\(\.icon-btn--danger\):not\(\s*\.chip--json-schema\s*\)\s*\{[^}]*background:\s*transparent/s,
    );
    expect(chat4).toContain("-webkit-tap-highlight-color: transparent");
  });
});
