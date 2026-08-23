import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const app = readFileSync(resolve(__dirname, "../app/AppWorkbench.tsx"), "utf8");
const css = readFileSync(resolve(__dirname, "../styles/chat.part1.css"), "utf8");
const phoneCss = readFileSync(
  resolve(__dirname, "../styles/phone.part1.css"),
  "utf8",
);

describe("new-chat welcome intro", () => {
  it("runs only on the empty welcome surface and settles after the type reveal", () => {
    expect(app).toContain("welcomeSession && welcomeBrandKind && !sideDockActive");
    expect(app).toContain('welcomeIntroActive ? " is-entering" : ""');
    expect(app).toContain("onAnimationEnd={() => setWelcomeIntroActive(false)}");
  });

  it("rises before a locale-sized stepped reveal and honors reduced motion", () => {
    expect(css).toContain("@keyframes composer-welcome-brand-rise");
    expect(css).toContain("steps(var(--welcome-prompt-steps), end)");
    expect(css).toMatch(
      /\.composer-welcome-brand\s*\{[^}]*translate:\s*0 calc\(-100% - 12px\)/s,
    );
    expect(css).toMatch(
      /\.composer-welcome-mark\.is-entering \.composer-welcome-brand\s*\{[^}]*composer-welcome-brand-rise 480ms ease both/s,
    );
    expect(css).toMatch(
      /@keyframes composer-welcome-brand-rise\s*\{\s*from\s*\{[^}]*translateY\(calc\(100% \+ 12px\)\)[^}]*\}\s*to\s*\{[^}]*translateY\(0\)/s,
    );
    expect(css).toMatch(
      /\.composer-welcome-mark\s*\{[\s\S]*?width: 100%;[\s\S]*?max-width: 42rem;/,
    );
    expect(css).toMatch(
      /\.composer-welcome-prompt\s*\{[\s\S]*?max-width: calc\(100% - 32px\);[\s\S]*?overflow-wrap: anywhere;/,
    );
    expect(phoneCss).toMatch(
      /\.app-shell--phone \.composer-wrap--welcome \.composer-welcome-mark\s*\{[\s\S]*?align-self: stretch;[\s\S]*?width: auto;[\s\S]*?max-width: none;/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?composer-welcome-mark\.is-entering[\s\S]*?animation: none;/,
    );
  });
});
