/**
 * Copyable structured JSON panel under an assistant reply when the session
 * has an optional JSON Schema (structured output mode).
 */

import { useMemo, useState } from "react";
import { IconCheck, IconCopy } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { extractStructuredJson } from "@/lib/jsonSchema";
import { cn } from "@/lib/utils";

export function StructuredJsonPanel({
  content,
  title,
  copyLabel,
  copiedLabel,
  className,
}: {
  content: string;
  title: string;
  copyLabel: string;
  copiedLabel: string;
  className?: string;
}) {
  const pretty = useMemo(() => extractStructuredJson(content), [content]);
  const [copied, setCopied] = useState(false);

  if (!pretty) return null;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={cn("struct-json", className)} data-testid="struct-json-panel">
      <div className="struct-json__bar">
        <span className="struct-json__title">{title}</span>
        <Tip label={copied ? copiedLabel : copyLabel}>
          <button
            type="button"
            className={cn("struct-json__copy", copied && "is-copied")}
            aria-label={copyLabel}
            onClick={() => void onCopy()}
          >
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            <span>{copied ? copiedLabel : copyLabel}</span>
          </button>
        </Tip>
      </div>
      <pre className="struct-json__pre">
        <code>{pretty}</code>
      </pre>
    </div>
  );
}
