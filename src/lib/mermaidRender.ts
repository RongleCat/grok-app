/**
 * Lazy Mermaid SVG render for chat / markdown fences.
 * Keeps a single init + sequential render queue (mermaid is not re-entrant).
 */

export type MermaidThemeMode = "dark" | "light";

export function isMermaidLanguage(language?: string | null): boolean {
  if (!language) return false;
  const lang = language.replace(/^language-/, "").trim().toLowerCase();
  return lang === "mermaid";
}

export function documentThemeMode(): MermaidThemeMode {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (
    id: string,
    text: string,
  ) => Promise<{ svg: string } | string>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;
let initTheme: MermaidThemeMode | null = null;
let renderChain: Promise<unknown> = Promise.resolve();
let renderSeq = 0;

async function loadMermaid(theme: MermaidThemeMode): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const api = (mod.default ?? mod) as MermaidApi;
      return api;
    });
  }
  const api = await mermaidPromise;
  if (initTheme !== theme) {
    api.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme === "light" ? "default" : "dark",
      fontFamily: "inherit",
    });
    initTheme = theme;
  }
  return api;
}

function normalizeSvg(result: { svg: string } | string): string {
  const svg = typeof result === "string" ? result : result.svg;
  if (!svg || !/<svg[\s>]/i.test(svg)) {
    throw new Error("Mermaid did not return SVG");
  }
  return svg;
}

/** Render Mermaid source to an SVG string (queued; theme-aware). */
export async function renderMermaidSvg(
  source: string,
  theme: MermaidThemeMode,
): Promise<string> {
  const text = source.replace(/\r\n/g, "\n").trim();
  if (!text) throw new Error("Mermaid source is empty");

  const run = async () => {
    const api = await loadMermaid(theme);
    renderSeq += 1;
    const id = `grok-mermaid-${renderSeq}`;
    const result = await api.render(id, text);
    return normalizeSvg(result);
  };

  const next = renderChain.then(run, run);
  // Keep the queue alive even when a render fails.
  renderChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
