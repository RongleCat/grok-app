/**
 * Case-insensitive search whose indexes point into the original string.
 *
 * `toLowerCase()` can grow a character (İ → i + combining dot). Indexes
 * into that folded string do not line up with the text on screen, so a
 * later match is highlighted on the wrong letters.
 */

type Fold = {
  folded: string;
  /** Original code-unit index for each folded code unit. */
  toOrig: number[];
};

function fold(text: string): Fold {
  let folded = "";
  const toOrig: number[] = [];
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const low = ch.toLowerCase();
    for (let k = 0; k < low.length; k++) {
      folded += low[k]!;
      toOrig.push(i);
    }
    i += ch.length;
  }
  return { folded, toOrig };
}

export type CaseSpan = { start: number; end: number };

/**
 * Non-overlapping case-insensitive matches. `start` / `end` slice the
 * original `text`. Empty query → no matches. Overlaps advance past the
 * match, same as a browser find for "aa" inside "aaa".
 */
export function caseInsensitiveSpans(text: string, query: string): CaseSpan[] {
  const q = query.trim();
  if (!q || !text) return [];
  const hay = fold(text);
  const needle = fold(q).folded;
  if (!needle) return [];
  const out: CaseSpan[] = [];
  let fromFold = 0;
  while (fromFold < hay.folded.length) {
    const at = hay.folded.indexOf(needle, fromFold);
    if (at < 0) break;
    const start = hay.toOrig[at]!;
    const endFold = at + needle.length;
    const end = endFold < hay.toOrig.length ? hay.toOrig[endFold]! : text.length;
    if (end <= start) {
      fromFold = at + 1;
      continue;
    }
    out.push({ start, end });
    fromFold = endFold;
  }
  return out;
}
