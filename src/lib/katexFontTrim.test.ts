import { describe, expect, it } from "vitest";
import {
  isKatexFallbackFontAsset,
  stripKatexFallbackFontSrc,
} from "./katexFontTrim";

const KATEX_FONT_FACE =
  '@font-face{font-display:block;font-family:KaTeX_AMS;font-style:normal;font-weight:400;src:url(assets/KaTeX_AMS-Regular-BQhdFMY1.woff2) format("woff2"),url(assets/KaTeX_AMS-Regular-DMm9YOAa.woff) format("woff"),url(assets/KaTeX_AMS-Regular-DRggAlZN.ttf) format("truetype")}';

describe("stripKatexFallbackFontSrc", () => {
  it("keeps only the woff2 src entry of a bundled KaTeX font-face", () => {
    const out = stripKatexFallbackFontSrc(KATEX_FONT_FACE);
    expect(out).toBe(
      '@font-face{font-display:block;font-family:KaTeX_AMS;font-style:normal;font-weight:400;src:url(assets/KaTeX_AMS-Regular-BQhdFMY1.woff2) format("woff2")}',
    );
  });

  it("keeps the woff2 url when fallbacks are quoted", () => {
    const out = stripKatexFallbackFontSrc(
      'src:url("assets/KaTeX_Main-Regular-xyz.woff2") format("woff2"),url("assets/KaTeX_Main-Regular-abc.woff") format("woff")',
    );
    expect(out).toBe(
      'src:url("assets/KaTeX_Main-Regular-xyz.woff2") format("woff2")',
    );
  });

  it("leaves non-KaTeX woff and truetype fallbacks untouched", () => {
    const css =
      'src:url(assets/MyFont-Regular.woff2) format("woff2"),url(assets/MyFont-Regular.woff) format("woff"),url(assets/MyFont-Regular.ttf) format("truetype")';
    expect(stripKatexFallbackFontSrc(css)).toBe(css);
  });

  it("handles multiple font-faces in one sheet", () => {
    const out = stripKatexFallbackFontSrc(
      `${KATEX_FONT_FACE}@font-face{font-family:KaTeX_Caligraphic;src:url(a/KaTeX_Caligraphic-Bold-1.woff2) format("woff2"),url(a/KaTeX_Caligraphic-Bold-2.woff) format("woff"),url(a/KaTeX_Caligraphic-Bold-3.ttf) format("truetype")}`,
    );
    expect(out).not.toMatch(/\.woff\)/);
    expect(out).not.toMatch(/\.ttf\)/);
    expect(out).toMatch(/KaTeX_AMS-Regular-BQhdFMY1\.woff2/);
    expect(out).toMatch(/KaTeX_Caligraphic-Bold-1\.woff2/);
  });
});

describe("isKatexFallbackFontAsset", () => {
  it("accepts hashed KaTeX woff and ttf assets", () => {
    expect(isKatexFallbackFontAsset("assets/KaTeX_AMS-Regular-DMm9YOAa.woff")).toBe(true);
    expect(isKatexFallbackFontAsset("assets/KaTeX_AMS-Regular-DRggAlZN.ttf")).toBe(true);
  });

  it("rejects woff2 assets and non-KaTeX fonts", () => {
    expect(isKatexFallbackFontAsset("assets/KaTeX_AMS-Regular-BQhdFMY1.woff2")).toBe(false);
    expect(isKatexFallbackFontAsset("assets/MyFont-Regular-abc.woff")).toBe(false);
    expect(isKatexFallbackFontAsset("assets/MyFont-Regular-abc.ttf")).toBe(false);
  });
});
