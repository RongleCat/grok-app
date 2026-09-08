/**
 * Chat Mermaid fence — lazy SVG render with source fallback + copy.
 */

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IconCheck, IconCopy } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import {
  documentThemeMode,
  renderMermaidSvg,
  type MermaidThemeMode,
} from "@/lib/mermaidRender";
import { cn } from "@/lib/utils";

function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    const p = node as { props?: { children?: ReactNode } };
    return extractText(p.props?.children);
  }
  return "";
}

function readTheme(): MermaidThemeMode {
  return documentThemeMode();
}

export const MermaidBlock = memo(function MermaidBlock({
  source: sourceProp,
  children,
  streaming = false,
  copyLabel = "Copy",
  sourceLabel = "Source",
  diagramLabel = "Diagram",
  loadingLabel = "Rendering diagram…",
  errorLabel = "Could not render diagram",
}: {
  /** Prefer explicit source when available. */
  source?: string;
  children?: ReactNode;
  /** While streaming, keep last good SVG on parse errors. */
  streaming?: boolean;
  copyLabel?: string;
  sourceLabel?: string;
  diagramLabel?: string;
  loadingLabel?: string;
  errorLabel?: string;
}) {
  const reactId = useId().replace(/:/g, "");
  const source = (sourceProp ?? extractText(children)).replace(/\n$/, "");
  const [theme, setTheme] = useState<MermaidThemeMode>(() => readTheme());
  const [svg, setSvg] = useState<string | null>(null);
  const svgRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const sync = () => setTheme(readTheme());
    sync();
    const root = document.documentElement;
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const text = source.trim();
    if (!text) {
      setPending(false);
      setError(null);
      setSvg(null);
      svgRef.current = null;
      return;
    }
    setPending(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void renderMermaidSvg(text, theme)
        .then((next) => {
          if (cancelled) return;
          svgRef.current = next;
          setSvg(next);
          setError(null);
          setPending(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const message =
            err instanceof Error ? err.message : String(err || "error");
          // Keep last good diagram while the agent is still streaming.
          if (!(streaming && svgRef.current)) {
            setError(message);
          }
          setPending(false);
        });
    }, streaming ? 180 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, theme, streaming]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }, [source]);

  const showFallback = Boolean(error) && !svg;
  const bodySource = showSource || showFallback;

  return (
    <div
      className={cn(
        "chat-code chat-mermaid",
        pending && "is-pending",
        error && "is-error",
      )}
      data-mermaid-id={reactId}
    >
      <div className="chat-code__bar">
        <span className="chat-code__lang">mermaid</span>
        <div className="chat-code__bar-actions">
          {svg ? (
            <Tip label={bodySource ? diagramLabel : sourceLabel}>
              <button
                type="button"
                className={cn("chat-code__btn", bodySource && "is-on")}
                aria-label={bodySource ? diagramLabel : sourceLabel}
                aria-pressed={bodySource}
                onClick={() => setShowSource((v) => !v)}
              >
                <span className="chat-mermaid__toggle" aria-hidden>
                  {bodySource ? "{ }" : "▣"}
                </span>
              </button>
            </Tip>
          ) : null}
          <Tip label={copied ? "OK" : copyLabel}>
            <button
              type="button"
              className={cn("chat-code__btn", copied && "is-copied")}
              aria-label={copyLabel}
              onClick={() => void onCopy()}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </button>
          </Tip>
        </div>
      </div>
      <div className="chat-code__body chat-mermaid__body">
        {pending && !svg ? (
          <p className="chat-mermaid__status">{loadingLabel}</p>
        ) : null}
        {showFallback ? (
          <p className="chat-mermaid__status chat-mermaid__status--error">
            {errorLabel}
          </p>
        ) : null}
        {bodySource || !svg ? (
          <pre className="chat-code__pre is-wrap">
            <code>{source}</code>
          </pre>
        ) : (
          <div
            className="chat-mermaid__svg"
            // Mermaid SVG is produced under securityLevel: "strict".
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </div>
    </div>
  );
});
