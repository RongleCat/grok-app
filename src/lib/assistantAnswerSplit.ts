/**
 * Split an assistant content blob into a foldable work diary vs the
 * visible conclusion.
 *
 * Grok Build TUI and Codex desktop keep thinking / tools off the answer
 * surface. Grok 4.6 sometimes writes first-person progress into `content`
 * (the real thought stream is already on the Worked-for rail). This is a
 * conservative client rescue so that diary does not mash into the reply.
 *
 * Cut, earliest wins:
 * 1. First-person process prefix, then a heading / `**title**：` line
 * 2. Standalone markdown `---` / `***` / `___` (not a table rule, not in a fence)
 * 3. Numbered deliverable heading (`**01 ·` / `## 01.`)
 *
 * No cut when the prefix is too short, the remainder is empty, or the
 * only hit is inside a fence / table separator.
 */

export type AssistantAnswerCut = "heading" | "hr" | "numbered";

export type AssistantAnswerSplit = {
  process: string | null;
  answer: string;
  cut: AssistantAnswerCut | null;
};

const MIN_PROCESS_CHARS = 80;
const MIN_ANSWER_CHARS = 20;

const PROCESS_MARKERS: RegExp[] = [
  /接下来/,
  /我先/,
  /我再/,
  /我把/,
  /我补/,
  /我按/,
  /我核/,
  /下面/,
  /接着/,
  /已经/,
  /先把/,
  /先读/,
  /根因是/,
  /本地已经/,
  /截图已经/,
  /\bLet me\b/i,
  /\bI(?:'ll| will)\b/,
  /\bNext[, ]/i,
  /\bI've (?:now|already)\b/i,
  /\bLooking at\b/i,
];

const HR_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_SEP_RE =
  /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const NUMBERED_RE =
  /^(?:\s{0,3}#{1,3}\s+\*{0,2}|\s*\*\*)(?:0?[1-9]|[1-9]\d)\s*[.·、.)]/;
const ATX_HEADING_RE = /^\s{0,3}#{1,6}\s+\S/;
const BOLD_LEAD_RE = /^\s*\*\*([^*]{1,40})\*\*\s*[:：]?/;

export function splitAssistantAnswer(
  raw: string | null | undefined,
): AssistantAnswerSplit {
  const text = raw ?? "";
  if (!text.trim()) {
    return { process: null, answer: text, cut: null };
  }

  const lines = text.split(/\r?\n/);
  let inFence = false;
  let fenceMark = "";
  let firstHr = -1;
  let firstNumbered = -1;
  let firstHeading = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = line.match(FENCE_RE);
    if (fence) {
      const mark = fence[1]!.charAt(0);
      if (!inFence) {
        inFence = true;
        fenceMark = mark;
      } else if (mark === fenceMark) {
        inFence = false;
        fenceMark = "";
      }
      continue;
    }
    if (inFence) continue;
    if (TABLE_SEP_RE.test(line)) continue;
    if (HR_RE.test(line)) {
      if (firstHr < 0) firstHr = i;
      continue;
    }
    if (NUMBERED_RE.test(line)) {
      if (firstNumbered < 0) firstNumbered = i;
      continue;
    }
    if (isAnswerHeading(line) && firstHeading < 0) {
      firstHeading = i;
    }
  }

  type Cand = {
    line: number;
    kind: AssistantAnswerCut;
    skipLine: boolean;
  };
  const cands: Cand[] = [];
  if (firstHeading >= 0) {
    const prefix = lines.slice(0, firstHeading).join("\n");
    if (looksLikeProcessDiary(prefix) && prefixLooksUnstructured(prefix)) {
      cands.push({ line: firstHeading, kind: "heading", skipLine: false });
    }
  }
  if (firstHr >= 0) {
    cands.push({ line: firstHr, kind: "hr", skipLine: true });
  }
  if (firstNumbered >= 0) {
    cands.push({ line: firstNumbered, kind: "numbered", skipLine: false });
  }
  cands.sort((a, b) => a.line - b.line);

  for (const cand of cands) {
    const process = lines.slice(0, cand.line).join("\n").trim();
    const answerStart = cand.skipLine ? cand.line + 1 : cand.line;
    const answer = lines.slice(answerStart).join("\n").trim();
    if (process.length < MIN_PROCESS_CHARS) continue;
    if (answer.length < MIN_ANSWER_CHARS) continue;
    return { process, answer, cut: cand.kind };
  }

  return { process: null, answer: text, cut: null };
}

function isAnswerHeading(line: string): boolean {
  if (ATX_HEADING_RE.test(line)) return true;
  const bold = line.match(BOLD_LEAD_RE);
  return !!bold?.[1]?.trim();
}

function countProcessMarkers(text: string): number {
  let n = 0;
  for (const re of PROCESS_MARKERS) {
    if (re.test(text)) n += 1;
  }
  return n;
}

function looksLikeProcessDiary(prefix: string): boolean {
  const t = prefix.trim();
  if (t.length < MIN_PROCESS_CHARS) return false;
  return countProcessMarkers(t) >= 2;
}

function prefixLooksUnstructured(prefix: string): boolean {
  for (const line of prefix.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (NUMBERED_RE.test(line) || isAnswerHeading(line)) return false;
  }
  return true;
}
