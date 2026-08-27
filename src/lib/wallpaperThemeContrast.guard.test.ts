import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../styles/skins.css"), "utf8");
const workbenchCss = readFileSync(
  join(__dirname, "../styles/workbench.part1b.css"),
  "utf8",
);
const sideWorkbenchCss = ["part1", "part2", "part3"]
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
const composerChromeCss = readFileSync(
  join(__dirname, "../styles/chat.part2.css"),
  "utf8",
);
const settingsCss = ["part1", "part2"]
  .map((part) =>
    readFileSync(join(__dirname, `../styles/settings.${part}.css`), "utf8"),
  )
  .join("\n");
const sidebarCss = readFileSync(
  join(__dirname, "../styles/sidebar.part1.css"),
  "utf8",
);
const sidebarTreeCss = readFileSync(
  join(__dirname, "../styles/sidebar.part2.css"),
  "utf8",
);
const statusPillCss = readFileSync(
  join(__dirname, "../styles/chat.part5.css"),
  "utf8",
);
const userAvatarCss = readFileSync(
  join(__dirname, "../styles/sidebar.part4.css"),
  "utf8",
);
const composerBtnCss = readFileSync(
  join(__dirname, "../styles/chat.part4.css"),
  "utf8",
);
const chipCss = readFileSync(join(__dirname, "../styles/chat.part3.css"), "utf8");
const cmmCss = readFileSync(join(__dirname, "../styles/chat.part6.css"), "utf8");
const menuSurfaceCss = readFileSync(
  join(__dirname, "../styles/sidebar.part3.css"),
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
    expect(css).not.toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\][^{]*:is\([^)]*, \.status-pill\)\s*\{/s,
    );
    expect(css).not.toContain("--wallpaper-light-elevated-surface");
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

  it("bakes wallpaper scrim into the gradient instead of a window opacity layer", () => {
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] \.app-shell::after\s*\{[^}]*calc\(88% \* var\(--wallpaper-theme-scrim-opacity/s,
    );
    expect(css).not.toMatch(
      /html\[data-wallpaper="1"\] \.app-shell::after\s*\{[^}]*opacity:\s*var\(--wallpaper-theme-scrim-opacity/s,
    );
  });

  it("keeps wallpaper chrome washes opaque so they do not sample the scrim", () => {
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] \.main\s*\{[^}]*--bg-hover:\s*color-mix\(\s*in srgb,\s*var\(--bg-elevated\) 90%,\s*var\(--text-primary\) 10%\s*\)/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] \.main\s*\{[^}]*--bg-active:\s*color-mix\(\s*in srgb,\s*var\(--bg-elevated\) 82%,\s*var\(--text-primary\) 18%\s*\)/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] \.composer-wrap\s*\{[^}]*--bg-hover:\s*rgba\(255, 255, 255, 0\.05\)/s,
    );
    expect(css).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\] \.composer-wrap\s*\{[^}]*--bg-hover:\s*rgba\(0, 0, 0, 0\.04\)/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] \.main :is\(\.chrome-btn, \.main__pane-toggle\)\s*\{[^}]*--bg-hover:\s*rgba\(255, 255, 255, 0\.05\)/s,
    );
    expect(css).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\][\s\S]*\.main[\s\S]*:is\(\.chrome-btn, \.main__pane-toggle\)\s*\{[^}]*--bg-hover:\s*rgba\(0, 0, 0, 0\.04\)/s,
    );
    expect(css).not.toMatch(
      /html\[data-wallpaper="1"\] \.composer__context-bar\s*\{[^}]*background:\s*transparent/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] \.main__top \.status-pill,[^}]*\.user-avatar--logo\s*\{[^}]*background:\s*transparent/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\][\s\S]*\.composer-welcome-prompt\s*\{[^}]*background:\s*none/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\][\s\S]*\.composer-welcome-mark\.is-entering[\s\S]*\.composer-welcome-prompt\s*\{[^}]*animation:\s*none/s,
    );
  });

  it("keeps status pill as a flat chip and avatar on card opacity mix", () => {
    expect(statusPillCss).toMatch(/\.status-pill\s*\{[^}]*height:\s*28px/s);
    expect(statusPillCss).toMatch(
      /\.status-pill\s*\{[^}]*background:\s*transparent/s,
    );
    expect(statusPillCss).not.toMatch(/\.status-pill::before/);
    expect(statusPillCss).toMatch(
      /\.status-pill--action:hover\s*\{[^}]*background:\s*var\(--bg-hover\)/s,
    );
    expect(userAvatarCss).toMatch(
      /\.user-avatar::before\s*\{[^}]*var\(--ui-opacity-mix, 100%\)/s,
    );
    expect(userAvatarCss).toMatch(
      /\.user-avatar--logo::before\s*\{[^}]*var\(--ui-opacity-mix, 100%\)/s,
    );
  });

  it("washes composer hover like chrome-btn, without isolation layers", () => {
    expect(composerBtnCss).toMatch(
      /\.composer\s+\.icon-btn:not\(\.icon-btn--primary\):not\(\.icon-btn--danger\):hover:not\(\s*:disabled\s*\)[\s\S]{0,160}background:\s*var\(--bg-hover\)/s,
    );
    expect(composerBtnCss).not.toMatch(
      /\.composer \.icon-btn:not\(\.icon-btn--primary\):not\(\.icon-btn--danger\)::after/s,
    );
    expect(composerBtnCss).not.toMatch(
      /\.composer \.icon-btn:not\(\.icon-btn--primary\):not\(\.icon-btn--danger\)\s*\{[^}]*isolation:\s*isolate/s,
    );
    expect(composerBtnCss).toMatch(
      /\.composer \.icon-btn:not\(\.icon-btn--primary\):not\(\.icon-btn--danger\)\s*\{[^}]*-webkit-appearance:\s*none/s,
    );
    expect(composerChromeCss).toMatch(
      /\.composer__context-item:hover:not\(:disabled\),\s*\.composer__context-item\.is-open\s*\{[^}]*background:\s*var\(--bg-hover\)/s,
    );
    expect(chipCss).toMatch(
      /\.chip:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--bg-hover\)/s,
    );
    expect(cmmCss).toMatch(
      /\.cmm__trigger:hover,\s*\.cmm\.is-open \.cmm__trigger\s*\{[^}]*background:\s*var\(--bg-hover\)/s,
    );
    expect(cmmCss).toMatch(
      /\.cmm__trigger\s*\{[^}]*-webkit-appearance:\s*none/s,
    );
    expect(cmmCss).not.toMatch(/\.cmm__trigger::after/);
    expect(composerChromeCss).toMatch(
      /\.composer__context-item\s*\{[^}]*-webkit-appearance:\s*none/s,
    );
    expect(chipCss).toMatch(
      /\.chip\s*\{[^}]*-webkit-appearance:\s*none/s,
    );
  });

  it("strips native button chrome so wallpaper does not show leftover tiles", () => {
    expect(sidebarCss).toMatch(
      /button\s*\{[^}]*-webkit-appearance:\s*none/s,
    );
    expect(sidebarCss).toMatch(
      /\.chrome-btn\s*\{[^}]*-webkit-appearance:\s*none/s,
    );
    expect(sidebarCss).toMatch(
      /\.chrome-btn\s*\{[^}]*background:\s*transparent/s,
    );
    expect(sidebarCss).not.toMatch(
      /\.chrome-btn\s*\{[^}]*isolation:\s*isolate/s,
    );
    expect(sidebarTreeCss).toMatch(
      /\.tree-icon-btn\s*\{[^}]*-webkit-appearance:\s*none/s,
    );
  });

  it("keeps tips as an opaque pill without a 0.5px square stroke", () => {
    expect(sidebarCss).toMatch(
      /\.ui-tip\s*\{[^}]*background:\s*var\(--bg-elevated\)/s,
    );
    expect(sidebarCss).toMatch(
      /\.ui-tip\s*\{[^}]*box-shadow:\s*0 0 0 1px var\(--glass-border\)/s,
    );
    expect(sidebarCss).not.toMatch(
      /\.ui-tip\s*\{[^}]*border:\s*0\.5px/s,
    );
    expect(sidebarCss).not.toMatch(
      /\.ui-tip\s*\{[^}]*--glass-surface-solid/s,
    );
    expect(sidebarCss).not.toMatch(
      /\.ui-tip\s*\{[^}]*backdrop-filter:/s,
    );
    expect(sidebarCss).not.toMatch(/@keyframes ui-tip-in/);
    expect(sidebarCss).not.toMatch(/\.ui-tip--closing/);
  });

  it("keeps the composer + menu a solid context plate, not glass", () => {
    expect(menuSurfaceCss).not.toMatch(/\.glass-surface,\s*\.composer-plus,/);
    expect(menuSurfaceCss).toMatch(
      /\.composer-plus,[\s\S]*?background:\s*var\(--menu-context-bg\)/s,
    );
    expect(composerBtnCss).not.toMatch(
      /\.composer-plus__item::before\s*\{/s,
    );
    expect(composerBtnCss).not.toMatch(
      /\.composer-plus__item\s*\{[^}]*overflow:\s*hidden/s,
    );
  });

  it("does not leave a clip-path layer on the idle welcome prompt", () => {
    expect(composerLayoutCss).toMatch(
      /\.composer-welcome-prompt\s*\{[^}]*clip-path:\s*none/s,
    );
    expect(composerLayoutCss).not.toMatch(
      /\.composer-welcome-mark\s*\{[^}]*contain:\s*layout style/s,
    );
    expect(composerLayoutCss).toMatch(
      /\.main__stage:has\(\.composer-wrap--welcome\) \.lobe-chat,[\s\S]*user-select:\s*none/s,
    );
  });

  it("keeps the composer on an independent opacity mix, not wallpaper scrim", () => {
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] :is\(\.composer, \.composer__context-bar\)\s*\{[^}]*background:\s*transparent[^}]*backdrop-filter:\s*none/s,
    );
    expect(composerChromeCss).toMatch(
      /\.composer__context-bar::before\s*\{[^}]*var\(--composer-opacity-mix, 100%\)/s,
    );
    expect(composerChromeCss).toMatch(
      /\.composer::before\s*\{[^}]*var\(--composer-opacity-mix, 100%\)/s,
    );
  });

  it("settings overlay uses independent mix tokens, not sidebar mix", () => {
    expect(css).toMatch(
      /html\[data-wallpaper="1"\]\s*\{[^}]*--wallpaper-theme-overlay-mix:\s*var\(--wallpaper-overlay-mix/s,
    );
    expect(css).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\]\s*\{[^}]*--wallpaper-theme-overlay-mix:\s*var\(--wallpaper-light-overlay-mix/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] \.settings-page__nav,[^}]*--wallpaper-theme-overlay-mix/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] \.settings-page__content,[^}]*--wallpaper-theme-overlay-mix/s,
    );
    expect(css).not.toMatch(
      /html\[data-wallpaper="1"\] \.settings-page__nav,[^}]*--wallpaper-theme-mix-sidebar/s,
    );
    expect(css).not.toMatch(
      /html\[data-wallpaper="1"\]\[data-wallpaper-clear="1"\] \.settings-page__content[^}]*background:\s*transparent/s,
    );
    expect(settingsCss).toMatch(
      /\.app-settings-stage\s*\{[^}]*background:\s*var\(--bg-main\)/s,
    );
    expect(settingsCss).toMatch(
      /\.settings-page__nav\s*\{[^}]*background:\s*var\(--bg-sidebar-solid/s,
    );
    expect(sidebarCss).toMatch(
      /\.platform-mac \.settings-page__nav\s*\{[^}]*background:\s*var\(--bg-sidebar-solid[^}]*backdrop-filter:\s*none/s,
    );
  });

  it("does not force wallpaper chrome ink; text shadow is opt-in", () => {
    const lightRoot = css.match(
      /html\[data-theme="light"\]\[data-wallpaper="1"\]\s*\{[^}]*\}/s,
    )?.[0];
    expect(lightRoot).toContain("--wallpaper-chrome-foreground");
    expect(css).not.toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\] \.sidebar\s*\{[^}]*--text-primary:\s*var\(--wallpaper-chrome-foreground\)/s,
    );
    expect(css).not.toMatch(
      /html\[data-theme="dark"\]\[data-wallpaper="1"\] \.sidebar\s*\{[^}]*text-shadow:/s,
    );
    expect(css).toMatch(
      /html\[data-font-shadow="1"\][\s\S]*text-shadow:\s*0 1px 2px rgb\(0 0 0 \/ 0\.55\)/s,
    );
    expect(css).toMatch(
      /html\[data-font-shadow="1"\] \.settings-page\s*\{[^}]*text-shadow:\s*none/s,
    );
    expect(css).toMatch(
      /html\[data-theme="dark"\]\[data-wallpaper="1"\] \.pane-toggle--pinned\s*\{[^}]*color:\s*var\(--text-primary\)/s,
    );
    expect(css).toMatch(
      /html\[data-font-shadow="1"\][\s\S]*\.pane-toggle--pinned/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] \.aside :is\(\.rp-chrome, \.rp__empty-state\)\s*\{[^}]*--text-secondary:\s*color-mix\([^}]*--text-tertiary:\s*color-mix\([^}]*color:\s*var\(--text-primary\)/s,
    );
    expect(css).toMatch(
      /html\[data-font-shadow="1"\][\s\S]*\.aside \.rp-chrome,[\s\S]*\.aside \.rp__empty-state[\s\S]*text-shadow:/s,
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
  });

  it("keeps assistant timeline on theme tokens and carried surfaces unshadowed", () => {
    const timeline = css.match(
      /html\[data-theme="dark"\]\[data-wallpaper="1"\] \.lobe-chat-assistant-timeline\s*\{[^}]*\}/s,
    )?.[0];
    expect(timeline).toContain("--chat-text: var(--text-primary)");
    expect(timeline).toContain("var(--text-primary) 84%");
    expect(timeline).not.toMatch(/text-shadow:/);

    const carriedSurface = css.match(
      /\.lobe-chat-assistant-timeline\s+:is\([^{]*\.lobe-timeline-tool__output,[^{]*\.lobe-chat-plan,[^{]*\.struct-json,[^{]*\.att-card,[^{]*\.file-path-card[^)]*\)\s*\{[^}]*\}/s,
    )?.[0];
    expect(carriedSurface).toContain("--chat-text: var(--text-primary)");
    expect(carriedSurface).toContain("--chat-text-2: var(--text-secondary)");
    expect(carriedSurface).toContain("--chat-text-3: var(--text-tertiary)");
    expect(carriedSurface).toContain("text-shadow: none");
    expect(css).toMatch(
      /html\[data-wallpaper="1"\]\s+\.lobe-chat\s+\.lobe-chat-assistant-timeline\s+:is\(\.chat-md__inline-code, \.chat-md :not\(pre\) > code\)\s*\{[^}]*background:\s*color-mix\([^;]*--bg-elevated\) 82%[^}]*text-shadow:\s*none/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\]\s+\.lobe-chat\s+\.lobe-chat-assistant-timeline\s+:is\([^{]*\.lobe-chat-plan,[^{]*\.struct-json,[^{]*\.att-card,[^{]*\.file-path-card[^)]*\)\s+svg\s*\{[^}]*filter:\s*none/s,
    );
    expect(workbenchCss).toMatch(
      /html\[data-theme="light"\]\[data-wallpaper="1"\]\s+\.auto-page\s+:is\(\.auto-page__title, \.auto-page__subtitle\)/s,
    );
    expect(workbenchCss).toMatch(
      /html\[data-theme="dark"\]\[data-wallpaper="1"\]\s+\.auto-page\s+:is\(\.auto-page__title, \.auto-page__subtitle\)/s,
    );
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

  it("nests the workspace chip as a rounded rect inside a uniform inset", () => {
    expect(composerChromeCss).toMatch(
      /\.composer__context-bar\s*\{[^}]*--composer-context-pad:\s*4px;[^}]*--composer-context-radius:\s*var\(--menu-radius, 12px\);[^}]*padding:\s*var\(--composer-context-pad\);[^}]*border-radius:\s*var\(--composer-context-radius\)/s,
    );
    expect(composerChromeCss).not.toMatch(
      /\.composer__context-bar\s*\{[^}]*padding:\s*4px 10px/s,
    );
    expect(composerChromeCss).toMatch(
      /\.composer__context-item\s*\{[^}]*border-radius:\s*calc\(\s*var\(--composer-context-radius, 12px\)\s*-\s*var\(--composer-context-pad, 4px\)\s*\)/s,
    );
    expect(composerChromeCss).toMatch(
      /\.composer\s*\{[^}]*border-radius:\s*var\(--menu-radius, 12px\)/s,
    );
  });

  it("keeps an expanded wallpaper side pane frosted without exposing chat", () => {
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] \.app-wallpaper-media\s*\{[^}]*filter:\s*blur\(var\(--wallpaper-sidebar-blur, 22px\)\)[^}]*inset:\s*calc\(-2 \* var\(--wallpaper-sidebar-blur, 22px\)\)/s,
    );
    expect(css).not.toMatch(
      /html\[data-wallpaper="1"\] \.app-wallpaper-media\s*\{[^}]*transform:\s*scale/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] \.sidebar\.sidebar--overlay,\s*html\[data-wallpaper="1"\] \.sidebar\.sidebar--phone-drawer\s*\{[^}]*backdrop-filter:\s*blur\(var\(--wallpaper-sidebar-blur, 22px\)\)/s,
    );
    expect(css).toMatch(
      /html\.platform-win\[data-wallpaper="1"\] \.app-wallpaper-media\s*\{[^}]*filter:\s*none/s,
    );
    expect(css).toMatch(
      /html\.platform-win\[data-wallpaper="1"\]\s+\.app-wallpaper-media\.is-ready\s+\.app-wallpaper-media__el\s*\{[^}]*filter:\s*blur\(var\(--wallpaper-sidebar-blur, 22px\)\)/s,
    );
    expect(css).not.toMatch(
      /html\[data-wallpaper="1"\]\s+\.sidebar:not\(\.sidebar--overlay\):not\(\.sidebar--phone-drawer\)::before/,
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
      /html\[data-wallpaper="1"\]\s+\.aside\s+:is\([^)]*\.rp-chrome[^)]*\.sw__empty[^)]*\)\s*\{[^}]*background:\s*var\(--rp-surface/s,
    );
  });

  it("paints the right rail with the same wallpaper mix as the left sidebar", () => {
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] \.sidebar\s*\{[^}]*var\(--bg-sidebar-solid, var\(--bg-sidebar\)\)\s*var\(--wallpaper-theme-mix-sidebar\)/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\] \.aside\s*\{[^}]*var\(--bg-sidebar-solid, var\(--bg-sidebar\)\)\s*var\(--wallpaper-theme-mix-sidebar\)/s,
    );
    expect(css).toMatch(
      /--wallpaper-theme-mix-aside:\s*var\(--wallpaper-theme-mix-sidebar\)/s,
    );
    expect(css).toMatch(
      /html\[data-wallpaper="1"\]\[data-wallpaper-clear="1"\] \.aside[^{]*\{[^}]*background:\s*transparent/s,
    );
  });

  it("uses one right-pane chrome material in rail and full-cover modes", () => {
    expect(sideWorkbenchCss).toMatch(
      /html:not\(\[data-wallpaper="1"\]\) \.aside \.rp-chrome\s*\{[^}]*background:\s*var\(--rp-surface, transparent\) !important[^}]*backdrop-filter:\s*none !important/s,
    );
    expect(sideWorkbenchCss).toMatch(
      /html\[data-wallpaper="1"\] \.aside \.rp-chrome\s*\{[^}]*background:\s*var\(--rp-surface, transparent\) !important/s,
    );
    expect(sideWorkbenchCss).toMatch(
      /\.sw-terminal--pty\s*\{[^}]*--sw-term-veil:\s*var\(--rp-surface, transparent\)/s,
    );
    expect(sideWorkbenchCss).toMatch(
      /\.sw-skills\s*\{[^}]*background:\s*var\(--rp-surface, transparent\)/s,
    );
  });
});
