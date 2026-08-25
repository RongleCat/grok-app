import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../styles/skins.css"), "utf8");
const workbenchCss = readFileSync(
  join(__dirname, "../styles/workbench.part1b.css"),
  "utf8",
);
const sideWorkbenchCss = ["part1", "part2"]
  .map((part) =>
    readFileSync(
      join(__dirname, `../styles/side-workbench.${part}.css`),
      "utf8",
    ),
  )
  .join("\n");
const composerLayoutCss = readFileSync(
  join(__dirname, "../styles/chat.part1.css"),
  "utf8",
);

describe("wallpaper theme contrast CSS", () => {
  it("maps light wallpaper to its own white veil and pane curves", () => {
    expect(css).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\]\s*\{[^}]*--wallpaper-theme-scrim-color:\s*#ffffff[^}]*--wallpaper-theme-scrim-opacity:\s*var\(\s*--wallpaper-light-scrim-opacity[^}]*--wallpaper-theme-mix-main:\s*var\(--wallpaper-light-mix-main/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\]\s*\{[^}]*--wallpaper-theme-scrim-opacity:\s*var\(--wallpaper-scrim-opacity[^}]*--wallpaper-theme-mix-main:\s*var\(--wallpaper-mix-main/s,
    );
  });

  it("keeps light controls readable without adding structural surfaces", () => {
    const material = css.match(
      /html\[data-theme="light"\]\[data-wallpaper="1"\][^{]*:is\(\.composer, \.composer__context-bar, \.main__top \.status-pill\)\s*\{[^}]*\}/s,
    )?.[0];
    expect(material).toContain(
      "background: var(--wallpaper-light-elevated-surface)",
    );
    expect(material).not.toContain("backdrop-filter");
    expect(css).not.toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\][^{]*:is\([^)]*, \.status-pill\)\s*\{/s,
    );
    expect(css).toMatch(
      /--wallpaper-light-elevated-surface:\s*color-mix\(\s*in srgb,\s*var\(--bg-elevated\) 74%,\s*transparent/s,
    );
    expect(css).not.toContain("--wallpaper-light-surface-border");
    expect(css).not.toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\] \.sidebar\s*\{[^}]*background:\s*var\(--wallpaper-light-elevated-surface\)/s,
    );
    expect(css).not.toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\] \.main__top\s*\{[^}]*background:\s*var\(--wallpaper-light-elevated-surface\)/s,
    );
    expect(css).not.toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\][^{]*\.composer-welcome-mark\s*\{[^}]*(?:background|border|box-shadow):/s,
    );
    expect(css).toMatch(
      /\.lobe-chat-assistant-timeline\s+:is\(\s*pre,\s*code,\s*\.chat-code,\s*\.chat-md__table-wrap,[^)]*\.lobe-timeline-tool__output,[^)]*\.lobe-chat-plan,[^)]*\.struct-json,[^)]*\.att-card[^)]*\)\s*\{[^}]*text-shadow:\s*none/s,
    );
  });

  it("gives dark wallpaper composers a translucent blurred surface", () => {
    expect(css).toMatch(
      /html\[data-theme="dark"\]\[data-wallpaper="1"\][^{]*:is\(\.composer, \.composer__context-bar\)\s*\{[^}]*background:\s*color-mix\(\s*in srgb,\s*var\(--bg-elevated\) 68%,\s*transparent\s*\)[^}]*backdrop-filter:\s*blur\(var\(--wallpaper-settings-blur, 14px\)\)/s,
    );
    expect(css).toMatch(
      /html\[data-stream-perf="1"\]\[data-wallpaper="1"\][^{]*:is\(\.composer, \.composer__context-bar\)\s*\{[^}]*backdrop-filter:\s*none !important/s,
    );
  });

  it("uses a dark edge on exposed light wallpaper chrome", () => {
    const lightRoot = css.match(
      /html\[data-theme="light"\]\[data-wallpaper="1"\]\s*\{[^}]*\}/s,
    )?.[0];
    expect(lightRoot).toContain("--wallpaper-chrome-foreground");
    expect(lightRoot).toContain("--wallpaper-chrome-shadow-color");
    expect(css).toMatch(
      /html\[data-theme="dark"\]\[data-wallpaper="1"\] \.sidebar\s*\{[^}]*text-shadow:/s,
    );
    expect(css).toMatch(
      /html\[data-theme="dark"\]\[data-wallpaper="1"\] \.pane-toggle--pinned\s*\{[^}]*color:\s*var\(--text-primary\)/s,
    );
    expect(css).toMatch(
      /html\[data-theme="dark"\]\[data-wallpaper="1"\] \.pane-toggle--pinned svg,[\s\S]*?filter:\s*drop-shadow\(0 1px 1px var\(--wallpaper-foreground-shadow-color\)\)/s,
    );
    expect(css).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\] \.sidebar\s*\{[^}]*--text-primary:\s*var\(--wallpaper-chrome-foreground\)[^}]*text-shadow:\s*0 1px 2px var\(--wallpaper-chrome-shadow-color\)/s,
    );
    expect(css).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\]\s+\.sidebar\s+\.user-avatar--logo\s+\.grok-logo\s+svg\s*\{[^}]*color:\s*var\(--text-inverse\)[^}]*filter:\s*none/s,
    );
    expect(css).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\]\s+\.sidebar\s+\.user-avatar--logo\s+\.provider-brand-icon\s*\{[^}]*filter:\s*none/s,
    );
    expect(css).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\]\s+\.sidebar\s+\.user-avatar--logo\s+:is\(\.provider-brand-icon--amux,\s*\.provider-brand-icon--opencode-go\)\s*\{[^}]*color:\s*var\(--text-inverse\)/s,
    );
    expect(css).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\][^{]*:is\(\.main__title,[^)]*\.main__title-row \.chrome-btn,[^)]*\.main__top-actions \.chrome-btn[^)]*\)\s*\{[^}]*color:\s*var\(--wallpaper-chrome-foreground\)[^}]*text-shadow:/s,
    );
    expect(css).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\] \.composer-welcome-mark\s*\{[^}]*--text-primary:\s*var\(--wallpaper-chrome-foreground\)[^}]*text-shadow:/s,
    );
  });

  it("protects light wallpaper assistant ink while preserving carried surfaces", () => {
    const timeline = css.match(
      /html\[data-theme="light"\]\[data-wallpaper="1"\] \.lobe-chat-assistant-timeline\s*\{[^}]*\}/s,
    )?.[0];
    expect(timeline).toContain(
      "--chat-text: var(--wallpaper-chrome-foreground)",
    );
    expect(timeline).toContain(
      "text-shadow: 0 1px 2px var(--wallpaper-chrome-shadow-color)",
    );
    expect(timeline).not.toMatch(/(?:background|border|box-shadow):/);
    expect(css).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\] \.lobe-chat-assistant-timeline svg\s*\{[^}]*filter:\s*drop-shadow\(0 1px 1px var\(--wallpaper-chrome-shadow-color\)\)/s,
    );

    const carriedSurface = css.match(
      /\.lobe-chat-assistant-timeline\s+:is\([^{]*\.lobe-timeline-tool__output,[^{]*\.lobe-chat-plan,[^{]*\.struct-json,[^{]*\.att-card,[^{]*\.file-path-card[^)]*\)\s*\{[^}]*\}/s,
    )?.[0];
    expect(carriedSurface).toContain("--chat-text: var(--text-primary)");
    expect(carriedSurface).toContain("--chat-text-2: var(--text-secondary)");
    expect(carriedSurface).toContain("--chat-text-3: var(--text-tertiary)");
    expect(carriedSurface).toContain("text-shadow: none");
    expect(css).toMatch(
      /html\[data-wallpaper="1"\]\s+\.lobe-chat\s+\.lobe-chat-assistant-timeline\s+:is\([^{]*\.lobe-chat-plan,[^{]*\.struct-json,[^{]*\.att-card,[^{]*\.file-path-card[^)]*\)\s+svg\s*\{[^}]*filter:\s*none/s,
    );
  });

  it("extends wallpaper contrast only to exposed main-page text", () => {
    const darkTimeline = css.match(
      /html\[data-theme="dark"\]\[data-wallpaper="1"\] \.lobe-chat-assistant-timeline\s*\{[^}]*\}/s,
    )?.[0];
    expect(darkTimeline).toContain("--chat-text: var(--text-primary)");
    expect(darkTimeline).toContain("var(--text-primary) 84%");
    expect(darkTimeline).toContain("var(--text-primary) 72%");

    const lightExposed = css.match(
      /html\[data-theme="light"\]\[data-wallpaper="1"\]\s+:is\(\.lobe-chat-empty, \.main__stage > \.conn-bar\)\s*\{[^}]*color:\s*var\(--wallpaper-chrome-foreground\)[^}]*text-shadow:\s*0 1px 2px var\(--wallpaper-chrome-shadow-color\)[^}]*\}/s,
    )?.[0];
    const darkExposed = css.match(
      /html\[data-theme="dark"\]\[data-wallpaper="1"\]\s+:is\(\.lobe-chat-empty, \.main__stage > \.conn-bar\)\s*\{[^}]*color:\s*var\(--text-primary\)[^}]*text-shadow:\s*0 1px 2px var\(--wallpaper-foreground-shadow-color\)[^}]*\}/s,
    )?.[0];
    expect(lightExposed).toBeTruthy();
    expect(darkExposed).toBeTruthy();
    expect(workbenchCss).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\]\s+\.auto-page\s+:is\(\.auto-page__title, \.auto-page__subtitle\)\s*\{/s,
    );
    expect(workbenchCss).toMatch(
      /html\[data-theme="dark"\]\[data-wallpaper="1"\]\s+\.auto-page\s+:is\(\.auto-page__title, \.auto-page__subtitle\)\s*\{/s,
    );
    for (const exposed of [lightExposed, darkExposed]) {
      expect(exposed).not.toMatch(
        /(?:\.lobe-chat-bubble|\.composer|\.chat-code|\.att-card)/,
      );
    }
  });

  it("keeps the floating composer free of theme-specific fades", () => {
    const floatingComposer = composerLayoutCss.match(
      /\.composer-wrap--float\s*\{[^}]*\}/s,
    )?.[0];
    expect(floatingComposer).toBeTruthy();
    expect(floatingComposer).not.toMatch(/\bbackground(?:-image)?:/);
    expect(css).not.toMatch(
      /data-theme="(?:light|dark)"[^}]*\.composer-wrap--float/,
    );
  });

  it("keeps an expanded wallpaper side pane frosted without exposing chat", () => {
    expect(css).toMatch(
      /html\[data-wallpaper="1"\]\s+:is\(\.sidebar, \.aside\)\s*\{[^}]*backdrop-filter:\s*blur\(var\(--wallpaper-sidebar-blur, 22px\)\)/s,
    );
    expect(css).toMatch(
      /html\[data-stream-perf="1"\]\[data-wallpaper="1"\] \.aside,/,
    );
    expect(sideWorkbenchCss).toMatch(
      /\.workbench--side-expanded \.main\s*\{[^}]*visibility:\s*hidden/s,
    );
    expect(sideWorkbenchCss).toMatch(
      /html:not\(\[data-wallpaper="1"\]\)\s+\.workbench--side-expanded\s+\.aside:not\(\.aside--hidden\)\s*\{[^}]*background:\s*var\(--bg-aside\)/s,
    );
    expect(sideWorkbenchCss).toMatch(
      /html\[data-wallpaper="1"\]\s+\.workbench--side-expanded\s+\.aside\s+:is\([^)]*\.rp-chrome[^)]*\.sw__empty[^)]*\)\s*\{[^}]*background:\s*transparent/s,
    );
  });

  it("uses one right-pane chrome material in rail and full-cover modes", () => {
    expect(sideWorkbenchCss).toMatch(
      /html:not\(\[data-wallpaper="1"\]\) \.aside \.rp-chrome\s*\{[^}]*background:\s*var\(--bg-card\) !important[^}]*backdrop-filter:\s*none !important/s,
    );
    expect(sideWorkbenchCss).toMatch(
      /html\[data-wallpaper="1"\] \.aside \.rp-chrome\s*\{[^}]*background:\s*transparent !important/s,
    );
  });
});
