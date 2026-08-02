/**
 * Resource-pane code preview — highlight.js (same stack as Grok Desktop)
 * with light/dark themes bound to `data-theme` on documentElement.
 *
 * highlight.js core + languages load on first mount via a cached dynamic
 * import so ResourceViewer / chat cold path never pay language-pack cost at
 * module eval. While loading, plain escaped text is shown immediately.
 */

import { useEffect, useMemo, useState } from "react";

import { languageFromFileName } from "@/lib/codeLang";
import { cn } from "@/lib/utils";

// Themes: Atom One Dark / One Light (scoped in code-preview.css)
import "@/styles/code-preview.css";

type HljsCore = typeof import("highlight.js/lib/core").default;

/** Module-level cached promise — languages register exactly once. */
let hljsLoadPromise: Promise<HljsCore> | null = null;

function loadHljs(): Promise<HljsCore> {
  if (!hljsLoadPromise) {
    hljsLoadPromise = (async () => {
      const [
        { default: hljs },
        { default: javascript },
        { default: typescript },
        { default: json },
        { default: markdown },
        { default: rust },
        { default: python },
        { default: go },
        { default: java },
        { default: kotlin },
        { default: c },
        { default: cpp },
        { default: csharp },
        { default: ruby },
        { default: php },
        { default: swift },
        { default: sql },
        { default: bash },
        { default: yaml },
        { default: ini },
        { default: css },
        { default: scss },
        { default: xml },
        { default: dockerfile },
        { default: makefile },
        { default: diff },
        { default: graphql },
        { default: lua },
        { default: r },
        { default: plaintext },
      ] = await Promise.all([
        import("highlight.js/lib/core"),
        import("highlight.js/lib/languages/javascript"),
        import("highlight.js/lib/languages/typescript"),
        import("highlight.js/lib/languages/json"),
        import("highlight.js/lib/languages/markdown"),
        import("highlight.js/lib/languages/rust"),
        import("highlight.js/lib/languages/python"),
        import("highlight.js/lib/languages/go"),
        import("highlight.js/lib/languages/java"),
        import("highlight.js/lib/languages/kotlin"),
        import("highlight.js/lib/languages/c"),
        import("highlight.js/lib/languages/cpp"),
        import("highlight.js/lib/languages/csharp"),
        import("highlight.js/lib/languages/ruby"),
        import("highlight.js/lib/languages/php"),
        import("highlight.js/lib/languages/swift"),
        import("highlight.js/lib/languages/sql"),
        import("highlight.js/lib/languages/bash"),
        import("highlight.js/lib/languages/yaml"),
        import("highlight.js/lib/languages/ini"),
        import("highlight.js/lib/languages/css"),
        import("highlight.js/lib/languages/scss"),
        import("highlight.js/lib/languages/xml"),
        import("highlight.js/lib/languages/dockerfile"),
        import("highlight.js/lib/languages/makefile"),
        import("highlight.js/lib/languages/diff"),
        import("highlight.js/lib/languages/graphql"),
        import("highlight.js/lib/languages/lua"),
        import("highlight.js/lib/languages/r"),
        import("highlight.js/lib/languages/plaintext"),
      ]);

      const langs: [string, typeof javascript][] = [
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
        ["sql", sql],
        ["bash", bash],
        ["shell", bash],
        ["yaml", yaml],
        ["ini", ini],
        ["css", css],
        ["scss", scss],
        ["xml", xml],
        ["html", xml],
        ["dockerfile", dockerfile],
        ["makefile", makefile],
        ["diff", diff],
        ["graphql", graphql],
        ["lua", lua],
        ["r", r],
        ["plaintext", plaintext],
      ];
      for (const [name, def] of langs) {
        if (!hljs.getLanguage(name)) hljs.registerLanguage(name, def);
      }
      return hljs;
    })();
  }
  return hljsLoadPromise;
}

function escapeCodeHtml(code: string): string {
  return code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
}

function readDocTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" ? "light" : "dark";
}

export function CodePreview({
  code,
  fileName,
  language,
  className,
  footer,
}: CodePreviewProps) {
  const [theme, setTheme] = useState<"light" | "dark">(readDocTheme);
  const [hljs, setHljs] = useState<HljsCore | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(readDocTheme());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadHljs().then((mod) => {
      if (!cancelled) setHljs(mod);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const lang = useMemo(() => {
    if (language && language !== "auto") return language;
    if (fileName) return languageFromFileName(fileName);
    return "plaintext";
  }, [language, fileName]);

  const html = useMemo(() => {
    // Show plain escaped text immediately while highlight.js loads (no empty flash).
    if (!hljs) return escapeCodeHtml(code);
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true })
          .value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return escapeCodeHtml(code);
    }
  }, [code, lang, hljs]);

  const lines = useMemo(() => {
    // Keep trailing newline as empty last line for gutter count
    const parts = code.split("\n");
    if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
    return Math.max(parts.length, 1);
  }, [code]);

  return (
    <div
      className={cn(
        "rp-code",
        theme === "light" ? "rp-code--light" : "rp-code--dark",
        className,
      )}
      data-language={lang}
    >
      <div className="rp-code__scroll">
        <div className="rp-code__gutter" aria-hidden>
          {Array.from({ length: lines }, (_, i) => (
            <span key={i} className="rp-code__ln">
              {i + 1}
            </span>
          ))}
        </div>
        <pre className="rp-code__pre">
          <code
            className={`hljs language-${lang}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </pre>
      </div>
      {footer ? <div className="rp-code__footer">{footer}</div> : null}
    </div>
  );
}
