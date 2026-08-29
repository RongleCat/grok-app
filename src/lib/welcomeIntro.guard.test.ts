import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const app = readFileSync(resolve(__dirname, "../app/AppWorkbench.tsx"), "utf8") +
  readFileSync(resolve(__dirname, "../app/WorkbenchComposerColumn.tsx"), "utf8") +
  readFileSync(resolve(__dirname, "../hooks/useSessionNavigation.ts"), "utf8");
const css = readFileSync(resolve(__dirname, "../styles/chat.part1.css"), "utf8");
const phoneCss = readFileSync(
  resolve(__dirname, "../styles/phone.part1.css"),
  "utf8",
);

describe("new-chat welcome intro", () => {
  it("runs only on the empty welcome surface and settles after the type reveal", () => {
    expect(app).toContain("welcomeSession && welcomeBrandKind && !sideDockActive");
    expect(app).toContain("useState(\n    welcomeMotionEnabled,\n  )");
    expect(app).toContain("welcomeMotionEnabled && welcomeIntroActive");
    expect(app).toContain("setWelcomeIntroActive(welcomeMotionEnabled)");
    expect(app).toContain("if (!welcomeMotionEnabled)");
    expect(app).toContain("onAnimationEnd={() => setWelcomeIntroActive(false)}");
    expect(app).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
    expect(app).toContain('reducedMotion.addEventListener("change", settle)');
  });

  it("rises before a locale-sized stepped reveal and honors reduced motion", () => {
    expect(css).toContain("@keyframes composer-welcome-brand-rise");
    expect(css).toContain("steps(var(--welcome-prompt-steps), end)");
    const brandBaseBlocks = Array.from(
      css.matchAll(/^\.composer-welcome-brand\s*\{([^}]*)\}/gm),
      (match) => match[1],
    );
    expect(brandBaseBlocks).toHaveLength(1);
    const brandBase = brandBaseBlocks[0];
    const baseTransform = brandBase
      ?.match(/(?:^|\n)\s*transform:\s*([^;]+);/)?.[1]
      ?.trim();
    expect(baseTransform).toBe("translate3d(0, 0, 0)");
    expect(brandBase).not.toMatch(/(?:^|\n)\s*translate\s*:/);
    expect(css).toMatch(
      /\.composer-welcome-mark\.is-entering \.composer-welcome-brand\s*\{[^}]*composer-welcome-brand-rise 480ms ease both/s,
    );
    const riseKeyframes = css.match(
      /@keyframes composer-welcome-brand-rise\s*\{\s*from\s*\{[^}]*transform:\s*translate3d\(0, calc\(100% \+ 12px\), 0\);[^}]*\}\s*to\s*\{[^}]*transform:\s*([^;]+);/s,
    );
    expect(riseKeyframes?.[1]?.trim()).toBe(baseTransform);
    expect(css).toMatch(
      /\.composer-welcome-mark\s*\{[\s\S]*?width: 100%;[\s\S]*?max-width: var\(--chat-width-max, 800px\);/,
    );
    expect(css).toMatch(
      /\.composer-welcome-mark\s*\{[\s\S]*?flex-direction: column;[\s\S]*?gap: 12px;/,
    );
    expect(css).toMatch(
      /\.composer-welcome-prompt\s*\{[\s\S]*?max-width: calc\(100% - 32px\);[\s\S]*?overflow-wrap: anywhere;[\s\S]*?background: none;/,
    );
    expect(css).not.toMatch(
      /\.composer-welcome-prompt\s*\{[^}]*position:\s*absolute/s,
    );
    expect(css).toMatch(
      /\.composer-wrap--welcome\s*\{[^}]*justify-content:\s*flex-end/s,
    );
    expect(css).toMatch(
      /\.composer-wrap--welcome\s*\{[^}]*padding-bottom:\s*max\(72px, 14vh\)/s,
    );
    expect(css).toMatch(
      /\.composer-wrap--welcome \.composer-welcome-mark\s*\{[^}]*flex:\s*1 1 auto/s,
    );
    expect(phoneCss).toMatch(
      /\.app-shell--phone \.composer-wrap--welcome\s*\{[^}]*padding-top:\s*24px/s,
    );
    expect(css).not.toMatch(
      /\.composer-welcome-mark\.is-entering \.composer-welcome-prompt\s*\{[^}]*will-change:\s*clip-path/s,
    );
    expect(app).toContain("window.setTimeout(() => setWelcomeIntroActive(false), 1300)");
    expect(phoneCss).toMatch(
      /\.app-shell--phone \.composer-wrap--welcome \.composer-welcome-mark\s*\{[\s\S]*?align-self: stretch;[\s\S]*?width: auto;[\s\S]*?max-width: none;/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?composer-welcome-mark\.is-entering[\s\S]*?animation: none;/,
    );
  });
});
