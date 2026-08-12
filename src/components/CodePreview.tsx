/**
 * Resource-pane code preview — highlight.js (same stack as Grok Desktop)
 * with light/dark themes bound to `data-theme` on documentElement.
 * Line-number gutter is always on for pane previews.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js/lib/core";
import { normalizeFocusLine } from "@/lib/pathLineCitation";

import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import rust from "highlight.js/lib/languages/rust";
import python from "highlight.js/lib/languages/python";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import kotlin from "highlight.js/lib/languages/kotlin";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import ruby from "highlight.js/lib/languages/ruby";
import php from "highlight.js/lib/languages/php";
import swift from "highlight.js/lib/languages/swift";
import objectivec from "highlight.js/lib/languages/objectivec";
import sql from "highlight.js/lib/languages/sql";
import bash from "highlight.js/lib/languages/bash";
import shell from "highlight.js/lib/languages/shell";
import powershell from "highlight.js/lib/languages/powershell";
import dos from "highlight.js/lib/languages/dos";
import yaml from "highlight.js/lib/languages/yaml";
import ini from "highlight.js/lib/languages/ini";
import properties from "highlight.js/lib/languages/properties";
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import less from "highlight.js/lib/languages/less";
import xml from "highlight.js/lib/languages/xml";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import makefile from "highlight.js/lib/languages/makefile";
import cmake from "highlight.js/lib/languages/cmake";
import nginx from "highlight.js/lib/languages/nginx";
import nix from "highlight.js/lib/languages/nix";
import diff from "highlight.js/lib/languages/diff";
import graphql from "highlight.js/lib/languages/graphql";
import protobuf from "highlight.js/lib/languages/protobuf";
import http from "highlight.js/lib/languages/http";
import lua from "highlight.js/lib/languages/lua";
import r from "highlight.js/lib/languages/r";
import julia from "highlight.js/lib/languages/julia";
import dart from "highlight.js/lib/languages/dart";
import scala from "highlight.js/lib/languages/scala";
import groovy from "highlight.js/lib/languages/groovy";
import perl from "highlight.js/lib/languages/perl";
import elixir from "highlight.js/lib/languages/elixir";
import erlang from "highlight.js/lib/languages/erlang";
import haskell from "highlight.js/lib/languages/haskell";
import clojure from "highlight.js/lib/languages/clojure";
import elm from "highlight.js/lib/languages/elm";
import ocaml from "highlight.js/lib/languages/ocaml";
import fsharp from "highlight.js/lib/languages/fsharp";
import coffeescript from "highlight.js/lib/languages/coffeescript";
import latex from "highlight.js/lib/languages/latex";
import matlab from "highlight.js/lib/languages/matlab";
import fortran from "highlight.js/lib/languages/fortran";
import vbnet from "highlight.js/lib/languages/vbnet";
import wasm from "highlight.js/lib/languages/wasm";
import glsl from "highlight.js/lib/languages/glsl";
import vim from "highlight.js/lib/languages/vim";
import lisp from "highlight.js/lib/languages/lisp";
import scheme from "highlight.js/lib/languages/scheme";
import tcl from "highlight.js/lib/languages/tcl";
import awk from "highlight.js/lib/languages/awk";
import nim from "highlight.js/lib/languages/nim";
import crystal from "highlight.js/lib/languages/crystal";
import arduino from "highlight.js/lib/languages/arduino";
import autohotkey from "highlight.js/lib/languages/autohotkey";
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
    ["kotlin", kotlin],
    ["c", c],
    ["cpp", cpp],
    ["csharp", csharp],
    ["ruby", ruby],
    ["php", php],
    ["swift", swift],
    ["objectivec", objectivec],
    ["sql", sql],
    ["bash", bash],
    ["shell", shell],
    ["powershell", powershell],
    ["dos", dos],
    ["yaml", yaml],
    ["ini", ini],
    ["properties", properties],
    ["css", css],
    ["scss", scss],
    ["less", less],
    ["xml", xml],
    ["html", xml],
    ["dockerfile", dockerfile],
    ["makefile", makefile],
    ["cmake", cmake],
    ["nginx", nginx],
    ["nix", nix],
    ["diff", diff],
    ["graphql", graphql],
    ["protobuf", protobuf],
    ["http", http],
    ["lua", lua],
    ["r", r],
    ["julia", julia],
    ["dart", dart],
    ["scala", scala],
    ["groovy", groovy],
    ["perl", perl],
    ["elixir", elixir],
    ["erlang", erlang],
    ["haskell", haskell],
    ["clojure", clojure],
    ["elm", elm],
    ["ocaml", ocaml],
    ["fsharp", fsharp],
    ["coffeescript", coffeescript],
    ["latex", latex],
    ["matlab", matlab],
    ["fortran", fortran],
    ["vbnet", vbnet],
    ["wasm", wasm],
    ["glsl", glsl],
    ["vim", vim],
    ["lisp", lisp],
    ["scheme", scheme],
    ["tcl", tcl],
    ["awk", awk],
    ["nim", nim],
    ["crystal", crystal],
    ["arduino", arduino],
    ["autohotkey", autohotkey],
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
  const focusRef = useRef<HTMLSpanElement | null>(null);

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

  const lineHtml = useMemo(() => {
    let highlighted: string;
    try {
      if (lang && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(code, {
          language: lang,
          ignoreIllegals: true,
        }).value;
      } else {
        // Prefer plain escape over highlightAuto for unknown langs — auto is
        // slow on large files and often wrong for short snippets.
        highlighted = escapeHtml(code);
      }
    } catch {
      highlighted = escapeHtml(code);
    }
    const parts = splitHighlightedLines(highlighted);
    // Match source line count: trailing newline does not add an extra gutter row.
    if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
    if (parts.length === 0) parts.push("");
    return parts;
  }, [code, lang]);

  const lines = lineHtml.length;
  const activeLine = normalizeFocusLine(focusLine, lines);

  useEffect(() => {
    if (activeLine == null) return;
    const el = focusRef.current;
    if (!el) return;
    // Double rAF: wait for layout after tab switch / async read.
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    });
    return () => cancelAnimationFrame(id);
  }, [activeLine, code, fileName]);

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
    >
      <div className="rp-code__scroll">
        {showLineNumbers ? (
          <div className="rp-code__gutter" aria-hidden>
            {Array.from({ length: lines }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "rp-code__ln",
                  activeLine === i + 1 && "rp-code__ln--focus",
                )}
              >
                {i + 1}
              </span>
            ))}
          </div>
        ) : null}
        <pre className="rp-code__pre">
          <code className={`hljs language-${lang}`}>
            {lineHtml.map((html, i) => {
              const isFocus = activeLine === i + 1;
              return (
                <span
                  key={i}
                  ref={isFocus ? focusRef : undefined}
                  className={cn(
                    "rp-code__line",
                    isFocus && "rp-code__line--focus",
                  )}
                  data-line={i + 1}
                  // Empty lines need a non-collapsing marker for gutter alignment.
                  dangerouslySetInnerHTML={{
                    __html: html.length ? html : "&#8203;",
                  }}
                />
              );
            })}
          </code>
        </pre>
      </div>
      {footer ? <div className="rp-code__footer">{footer}</div> : null}
    </div>
  );
}
