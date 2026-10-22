/**
 * Validation for the host's `session://stream` chunk length table.
 *
 * The table maps text back onto model chunk boundaries, and a one-off offset
 * would split the reveal at the wrong character. Only arrays where every entry
 * is a finite non-negative integer and the total equals the text's UTF-16
 * length are accepted; anything else is dropped whole rather than patched.
 */

/**
 * Validates and returns a usable chunk length table.
 *
 * @param text Streamed text from the same payload (untrusted).
 * @param lens `chunkLens` sent by the host (untrusted).
 * @returns The original array (or an empty one) when valid, otherwise
 * `undefined`.
 */
export function sanitizeChunkLens(
  text: unknown,
  lens: unknown,
): number[] | undefined {
  if (typeof text !== "string" || !Array.isArray(lens)) return undefined;
  const out: number[] = [];
  let sum = 0;
  for (const len of lens) {
    if (typeof len !== "number" || !Number.isInteger(len) || len < 0) {
      return undefined;
    }
    out.push(len);
    sum += len;
  }
  return sum === text.length ? out : undefined;
}
