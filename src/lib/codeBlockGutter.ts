/** One text node of 1..N so chat fences do not mount a DOM node per line. */

export function formatLineNumberGutter(lineCount: number): string {
  const n = Number.isFinite(lineCount) ? Math.max(1, Math.floor(lineCount)) : 1;
  if (n === 1) return "1";
  const parts = new Array<string>(n);
  for (let i = 0; i < n; i++) parts[i] = String(i + 1);
  return parts.join("\n");
}
