/**
 * Fixed-row windowing for resource-pane code preview.
 * Short files stay a full DOM list; large files must not mount every line.
 */

/** Below this line count, CodePreview renders every row. */
export const CODE_PREVIEW_VIRTUALIZE_THRESHOLD = 200;

/** Must match `.rp-code__row` height in `code-preview.css`. */
export const CODE_PREVIEW_LINE_HEIGHT_PX = 20;

/** Extra rows above/below the viewport when windowed. */
export const CODE_PREVIEW_OVERSCAN = 40;

/** Split source into gutter rows. Trailing newline does not add an empty row. */
export function splitSourceLines(code: string): string[] {
  if (!code) return [""];
  const parts = code.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  if (parts.length === 0) parts.push("");
  return parts;
}

export function shouldVirtualizeCodePreview(lineCount: number): boolean {
  return lineCount >= CODE_PREVIEW_VIRTUALIZE_THRESHOLD;
}
