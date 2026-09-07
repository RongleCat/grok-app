/**
 * Resource-pane code preview — highlight.js (same stack as Grok Desktop)
 * with light/dark themes bound to `data-theme` on documentElement.
 * Line-number gutter is always on for pane previews.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js/lib/core";
import { normalizeFocusLine } from "@/lib/pathLineCitation";
import { VirtualList } from "@/components/VirtualList";
import {
  CODE_PREVIEW_LINE_HEIGHT_PX,
  CODE_PREVIEW_OVERSCAN,
  CODE_PREVIEW_VIRTUALIZE_THRESHOLD,
  shouldVirtualizeCodePreview,
  splitSourceLines,
} from "@/lib/codePreviewWindow";

// src/lib/codeLang.ts maps many more ids than are registered here — that's
// fine: highlightSource falls back to plain text for unregistered grammars,
// and CodeMirror (codeEditorLang) keeps full editor coverage. Bundling only
// the common grammars below keeps this preview chunk small.
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import rust from "highlight.js/lib/languages/rust";
import python from "highlight.js/lib/languages/python";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import sql from "highlight.js/lib/languages/sql";
import bash from "highlight.js/lib/languages/bash";
import shell from "highlight.js/lib/languages/shell";
import yaml from "highlight.js/lib/languages/yaml";
import ini from "highlight.js/lib/languages/ini";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import makefile from "highlight.js/lib/languages/makefile";
import diff from "highlight.js/lib/languages/diff";
import plaintext from "highlight.js/lib/languages/plaintext";

import { languageFromFileName } from "@/lib/codeLang";
import { cn } from "@/lib/utils";

// Themes: Atom One Dark / One Light (scoped in code-preview.css)
import "@/styles/code-preview.css";

type HljsLang = typeof javascript;

let registered = false;
function ensureLangs() {
  if (registered) return;
  registered = true;
  const langs: [string, HljsLang][] = [
    ["javascript", javascript],
    ["typescript", typescript],
    ["json", json],
    ["markdown", markdown],
    ["rust", rust],
    ["python", python],
    ["go", go],
    ["java", java],
    ["c", c],
    ["cpp", cpp],
    ["csharp", csharp],
    ["sql", sql],
    ["bash", bash],
    ["shell", shell],
    ["yaml", yaml],
    ["ini", ini],
    ["css", css],
    ["xml", xml],
    ["html", xml],
    ["dockerfile", dockerfile],
    ["makefile", makefile],
    ["diff", diff],
    ["plaintext", plaintext],
  ];
  for (const [name, def] of langs) {
    if (!hljs.getLanguage(name)) hljs.registerLanguage(name, def);
  }
}

export interface CodePreviewProps {
  code: string;
  /** File name for language detection (preferred). */
  fileName?: string;
  /** Explicit highlight.js language id. */
  language?: string;
  className?: string;
  /** Optional footer note (e.g. truncated). */
  footer?: string | null;
  /** Show line-number gutter (default true for resource pane). */
  showLineNumbers?: boolean;
  /**
   * 1-based line to scroll into view and highlight.
   * Soft-fail when out of range / invalid (no scroll, no highlight).
   */
  focusLine?: number | null;
}

function readDocTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" ? "light" : "dark";
}

function escapeHtml(code: string): string {
  return code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Split highlighted HTML into per-line fragments so the gutter stays aligned
 * even when a token span wraps multiple source lines.
 */
function splitHighlightedLines(html: string): string[] {
  if (!html) return [""];
  // Preserve empty trailing line only when source ends with \n (caller decides count).
  const lines: string[] = [];
  let buf = "";
  let i = 0;
  while (i < html.length) {
    if (html[i] === "\n") {
      lines.push(buf);
      buf = "";
      i += 1;
      continue;
    }
    // Keep tags intact across lines — do not split mid-tag.
    if (html[i] === "<") {
      const end = html.indexOf(">", i);
      if (end === -1) {
        buf += html.slice(i);
        break;
      }
      buf += html.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    buf += html[i];
    i += 1;
  }
  lines.push(buf);
  return lines;
}

function highlightSource(code: string, lang: string): string {
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, {
        language: lang,
        ignoreIllegals: true,
      }).value;
    }
  } catch {
    /* fall through */
  }
  return escapeHtml(code);
}

function highlightOneLine(text: string, lang: string): string {
  if (!text) return "";
  return highlightSource(text, lang);
}

export function CodePreview({
  code,
  fileName,
  language,
  className,
  footer,
  showLineNumbers = true,
  focusLine = null,
}: CodePreviewProps) {
  ensureLangs();

  const [theme, setTheme] = useState<"light" | "dark">(readDocTheme);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(readDocTheme());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  const lang = useMemo(() => {
    if (language && language !== "auto") return language;
    if (fileName) return languageFromFileName(fileName);
    return "plaintext";
  }, [language, fileName]);

  const sourceLines = useMemo(() => splitSourceLines(code), [code]);
  const virtualize = shouldVirtualizeCodePreview(sourceLines.length);

  const smallHtml = useMemo(() => {
    if (virtualize) return null;
    const parts = splitHighlightedLines(highlightSource(code, lang));
    if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
    if (parts.length === 0) parts.push("");
    return parts;
  }, [code, lang, virtualize]);

  const lineCacheRef = useRef<{
    lang: string;
    code: string;
    map: Map<number, string>;
  }>({ lang: "", code: "", map: new Map() });
  if (
    lineCacheRef.current.lang !== lang ||
    lineCacheRef.current.code !== code
  ) {
    lineCacheRef.current = { lang, code, map: new Map() };
  }

  const htmlAt = (index: number): string => {
    if (smallHtml) return smallHtml[index] ?? "";
    const cached = lineCacheRef.current.map.get(index);
    if (cached != null) return cached;
    const html = highlightOneLine(sourceLines[index] ?? "", lang);
    lineCacheRef.current.map.set(index, html);
    return html;
  };

  const lines = sourceLines.length;
  const activeLine = normalizeFocusLine(focusLine, lines);

  return (
    <div
      className={cn(
        "rp-code",
        theme === "light" ? "rp-code--light" : "rp-code--dark",
        showLineNumbers && "rp-code--lines",
        className,
      )}
      data-language={lang}
      data-focus-line={activeLine ?? undefined}
      data-virtualized={virtualize ? "1" : "0"}
    >
      <div className="rp-code__scroll" style={{ overflow: "auto" }}>
        <VirtualList
          className="rp-code__list"
          items={sourceLines}
          getKey={(_line, index) => String(index)}
          rowHeight={CODE_PREVIEW_LINE_HEIGHT_PX}
          threshold={CODE_PREVIEW_VIRTUALIZE_THRESHOLD}
          overscan={CODE_PREVIEW_OVERSCAN}
          scrollToKey={
            activeLine != null ? String(activeLine - 1) : null
          }
          style={{ paddingTop: 14, paddingBottom: 20 }}
          renderItem={(_line, index) => {
            const isFocus = activeLine === index + 1;
            const html = htmlAt(index);
            return (
              <div
                className={cn("rp-code__row", isFocus && "is-focus")}
                data-line={index + 1}
              >
                {showLineNumbers ? (
                  <span
                    className={cn(
                      "rp-code__ln",
                      isFocus && "rp-code__ln--focus",
                    )}
                    aria-hidden
                  >
                    {index + 1}
                  </span>
                ) : null}
                <span
                  className={cn(
                    "rp-code__line",
                    "hljs",
                    `language-${lang}`,
                    isFocus && "rp-code__line--focus",
                  )}
                  dangerouslySetInnerHTML={{
                    __html: html.length ? html : "&#8203;",
                  }}
                />
              </div>
            );
          }}
        />
      </div>
      {footer ? <div className="rp-code__footer">{footer}</div> : null}
    </div>
  );
}
