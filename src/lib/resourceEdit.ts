/**
 * Resource pane text edit helpers — which kinds can Save, dirty check, conflict parse.
 */

/** Preview kinds that carry editable UTF-8 text (not binary / office / media). */
const EDITABLE_KINDS = new Set([
  "text",
  "code",
  "markdown",
  "json",
  "config",
  "css",
  "csv",
  "html",
]);

export function isResourceTextEditable(opts: {
  kind?: string | null;
  text?: string | null;
  truncated?: boolean | null;
  error?: string | null;
}): boolean {
  if (opts.truncated) return false;
  if (opts.error && !opts.text) return false;
  if (opts.text == null) return false;
  const kind = (opts.kind || "text").toLowerCase();
  if (EDITABLE_KINDS.has(kind)) return true;
  // Host may classify odd extensions as generic text with a body.
  if (kind === "binary" || kind === "image" || kind === "video" || kind === "audio") {
    return false;
  }
  if (kind === "pdf" || kind.startsWith("doc") || kind === "xlsx" || kind === "pptx") {
    return false;
  }
  // Unknown kind but we have full text → allow.
  return opts.text.length >= 0 && !opts.truncated;
}

export function isResourceDraftDirty(
  draft: string | null | undefined,
  baseline: string | null | undefined,
): boolean {
  if (draft == null) return false;
  if (baseline == null) return draft.length > 0;
  return draft !== baseline;
}

/** Host errors for concurrent disk changes start with this prefix. */
export function isFsWriteConflict(err: unknown): boolean {
  const s = String(err ?? "");
  return s.includes("CONFLICT:") || s.toLowerCase().includes("conflict:");
}

/**
 * Editable kinds open in **preview** first (syntax highlight + line numbers for
 * code; rendered markdown for .md). User toggles Edit for the highlighted
 * source editor (CodeMirror) or the markdown TipTap editor.
 */
export function defaultResourceEditMode(
  _kind: string | null | undefined,
): boolean {
  void _kind;
  return false;
}
