/**
 * Stable-tail split for streaming markdown — DSH-inspired incremental paint.
 *
 * While streaming, only the tail (last ~2 blocks) keeps re-parsing; the stable
 * prefix is memoized as settled markdown. Split only at a blank line outside a
 * fenced block so lists/quotes/tables spanning the cut stay intact. Falls back
 * to `{ prefix: "", tail: source }` (single render) when no safe split exists.
 */

/** True when the line opens/closes a ``` / ~~~ fence. */
function isFenceLine(line: string): boolean {
  return /^\s*(`{3,}|~{3,})/.test(line);
}

/** Find a safe split offset: blank line outside fences, tail <= maxTail. */
export function splitStableMarkdownTail(
  source: string,
  options: { maxTail?: number; minPrefix?: number } = {},
): { prefix: string; tail: string } {
  const maxTail = options.maxTail ?? 3000;
  const minPrefix = options.minPrefix ?? 1500;
  if (!source || source.length < minPrefix + 500) {
    return { prefix: "", tail: source };
  }
  // Walk lines tracking fence state so we never cut inside ``` blocks.
  const lines = source.split("\n");
  const fenceState: boolean[] = [];
  let inFence = false;
  for (const line of lines) {
    if (isFenceLine(line)) inFence = !inFence;
    fenceState.push(inFence);
  }
  // Offsets of each line start.
  let offset = 0;
  const lineStart: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    lineStart.push(offset);
    offset += lines[i]!.length + 1;
  }
  const wantTailStart = Math.max(minPrefix, source.length - maxTail);
  // Prefer the last blank line outside fences at/after wantTailStart.
  let best = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lineStart[i]! < wantTailStart) continue;
    if (fenceState[i]) continue;
    if (lines[i]!.trim() !== "") continue;
    // Next line must also be outside fences (cut between blocks).
    if (i + 1 < lines.length && fenceState[i + 1]) continue;
    best = i;
  }
  if (best < 0) return { prefix: "", tail: source };
  const cut = lineStart[best + 1] ?? source.length;
  if (cut < minPrefix || source.length - cut > maxTail + 500) {
    return { prefix: "", tail: source };
  }
  const prefix = source.slice(0, cut);
  const tail = source.slice(cut);
  if (!prefix.trim() || !tail.trim()) return { prefix: "", tail: source };
  return { prefix, tail };
}
