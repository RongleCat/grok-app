/**
 * KaTeX ships every @font-face in three formats (woff2 + woff + ttf).
 * The desktop WebViews Grok App runs on (WKWebView / WebView2 / WebKitGTK)
 * all support woff2, so the woff / truetype fallbacks are ~700KB of dead
 * dist weight. Build-time helpers below strip the fallback `src` entries
 * from bundled CSS so the matching font assets can be dropped from the
 * bundle (see the `katex-woff2-only` plugin in vite.config.ts).
 */

/**
 * Remove the non-woff2 `url(...)` src entries of KaTeX @font-face rules.
 * Scoped to KaTeX_ font files so a custom font's wof/ttf fallbacks stay.
 */
export function stripKatexFallbackFontSrc(css: string): string {
  return css.replace(
    /,\s*url\((["']?)[^)]*?KaTeX_[^)]*?\.(?:woff|ttf)\1\)\s*format\("(?:woff|truetype)"\)/g,
    "",
  );
}

/** True for a bundled KaTeX font asset that also ships as woff2. */
export function isKatexFallbackFontAsset(fileName: string): boolean {
  return /KaTeX_[^/]*\.(?:woff|ttf)$/.test(fileName);
}
