/**
 * Variable-height windowing for resource-pane markdown preview.
 * Short files stay one ReactMarkdown tree; long files split into sections.
 */

export const MARKDOWN_PREVIEW_VIRTUALIZE_THRESHOLD = 200;
export const MARKDOWN_SECTION_LINE_HEIGHT_PX = 24;
export const MARKDOWN_SECTION_MAX_LINES = 80;
export const MARKDOWN_SECTION_OVERSCAN = 2;

export type MarkdownPreviewSection = {
  startLine: number;
  lineCount: number;
  source: string;
};

export type MarkdownSectionWindow = {
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
  totalHeight: number;
};

export function countMarkdownLines(text: string): number {
  if (!text) return 1;
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return Math.max(1, parts.length);
}

export function shouldWindowMarkdownPreview(lineCount: number): boolean {
  return lineCount >= MARKDOWN_PREVIEW_VIRTUALIZE_THRESHOLD;
}

function isFenceLine(line: string): boolean {
  return /^```/.test(line) || /^~~~/.test(line);
}

function isAtxHeading(line: string): boolean {
  return /^#{1,6} /.test(line);
}

/** Split on ATX headings and on blank lines once a section hits the line cap. */
export function splitMarkdownSections(text: string): MarkdownPreviewSection[] {
  const lines = (text ?? "").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) {
    return [{ startLine: 1, lineCount: 1, source: "" }];
  }

  const sections: MarkdownPreviewSection[] = [];
  let buf: string[] = [];
  let start = 0;
  let inFence = false;

  const flush = () => {
    if (buf.length === 0) return;
    sections.push({
      startLine: start + 1,
      lineCount: buf.length,
      source: buf.join("\n"),
    });
    start += buf.length;
    buf = [];
  };

  for (const line of lines) {
    if (isFenceLine(line)) inFence = !inFence;
    const heading = !inFence && isAtxHeading(line) && buf.length > 0;
    const capped =
      !inFence &&
      buf.length >= MARKDOWN_SECTION_MAX_LINES &&
      (line === "" || isAtxHeading(line));
    if (heading || capped) flush();
    buf.push(line);
  }
  flush();
  return sections;
}

export function markdownSectionLayout(
  sections: readonly { lineCount: number }[],
  linePx = MARKDOWN_SECTION_LINE_HEIGHT_PX,
): { heights: number[]; offsets: number[]; total: number } {
  const heights = sections.map((s) =>
    Math.max(linePx, s.lineCount * linePx),
  );
  const offsets: number[] = [];
  let acc = 0;
  for (const h of heights) {
    offsets.push(acc);
    acc += h;
  }
  return { heights, offsets, total: acc };
}

function sectionIndexAt(offsets: readonly number[], y: number): number {
  if (offsets.length === 0) return 0;
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function computeMarkdownSectionWindow(input: {
  offsets: readonly number[];
  heights: readonly number[];
  totalHeight: number;
  scrollOffset: number;
  viewportHeight: number;
  overscan?: number;
}): MarkdownSectionWindow {
  const count = input.offsets.length;
  const totalHeight = Math.max(0, input.totalHeight);
  if (count === 0) {
    return {
      start: 0,
      end: 0,
      paddingTop: 0,
      paddingBottom: 0,
      totalHeight: 0,
    };
  }
  const overscan = Math.max(0, Math.floor(input.overscan ?? MARKDOWN_SECTION_OVERSCAN));
  const visibleTop = Math.max(0, input.scrollOffset);
  const visibleBottom = Math.max(
    visibleTop,
    input.scrollOffset + Math.max(0, input.viewportHeight),
  );
  let start = sectionIndexAt(input.offsets, visibleTop);
  let end = sectionIndexAt(input.offsets, visibleBottom) + 1;
  start = Math.max(0, start - overscan);
  end = Math.min(count, end + overscan);
  if (start >= end) {
    start = Math.min(sectionIndexAt(input.offsets, visibleTop), count - 1);
    end = start + 1;
  }
  const paddingTop = input.offsets[start] ?? 0;
  let rendered = 0;
  for (let i = start; i < end; i++) rendered += input.heights[i] ?? 0;
  return {
    start,
    end,
    paddingTop,
    paddingBottom: Math.max(0, totalHeight - paddingTop - rendered),
    totalHeight,
  };
}

export function initialMarkdownSectionWindow(
  count: number,
  windowed: boolean,
  overscan = MARKDOWN_SECTION_OVERSCAN,
): MarkdownSectionWindow {
  if (!windowed) {
    return {
      start: 0,
      end: count,
      paddingTop: 0,
      paddingBottom: 0,
      totalHeight: 0,
    };
  }
  const end = Math.min(count, Math.max(1, overscan * 2 + 1));
  return {
    start: 0,
    end,
    paddingTop: 0,
    paddingBottom: 0,
    totalHeight: 0,
  };
}
