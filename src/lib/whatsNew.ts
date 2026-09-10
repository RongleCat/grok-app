/**
 * Version "what's new" notes: parse CHANGELOG.md, remember the last seen
 * version, decide whether to auto-show after an update.
 */

import type { Locale } from "@/i18n";
import pkg from "../../package.json";
import changelogMarkdown from "../../CHANGELOG.md?raw";

export const APP_VERSION: string = String(
  (pkg as { version?: string }).version ?? "",
).trim();

export const CHANGELOG_MARKDOWN: string = changelogMarkdown;

export const WHATS_NEW_SEEN_KEY = "grok-app.whatsNew.seenVersion";
export const WHATS_NEW_FIRST_SEEN_KEY = "grok-app.whatsNew.firstSeenVersion";
export const WHATS_NEW_OPEN_EVENT = "grok-app.whats-new.open";

export type ChangelogLang = "en" | "zh";

export type WhatsNewSectionId = "added" | "changed" | "fixed";

export type WhatsNewSection = {
  id: WhatsNewSectionId;
  items: string[];
};

export type WhatsNewNotes = {
  version: string;
  date: string | null;
  highlight: string | null;
  sections: WhatsNewSection[];
};

export interface WhatsNewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const SECTION_HEADINGS: Record<WhatsNewSectionId, RegExp> = {
  added: /^###\s+Added\b/i,
  changed: /^###\s+Changed\b/i,
  fixed: /^###\s+Fixed\b/i,
};

function defaultStorage(): WhatsNewStorage {
  if (typeof localStorage !== "undefined") return localStorage;
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** zh / zh-TW read the Chinese CHANGELOG blocks; every other catalog reads English. */
export function changelogLang(locale: string | Locale | null | undefined): ChangelogLang {
  const id = String(locale ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (id === "zh" || id === "zh-tw" || id.startsWith("zh-")) return "zh";
  return "en";
}

function stripIssueRefs(text: string): string {
  return text
    // (#123), (#123, #456), （#123）, （#123、#456）
    .replace(/\s*[(（]\s*#[0-9]+(?:\s*[,，、]\s*#[0-9]+)*\s*[)）]/g, "")
    .replace(/\s*#[0-9]+\b/g, "")
    // leftover empty parens after a hash-only strip, e.g. （） / (,)
    .replace(/\s*[(（]\s*[,，、]?\s*[)）]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** First sentence; keep `5.3` / `file.json` from splitting the lead line. */
export function firstSentence(text: string): string {
  const t = text.trim();
  if (!t) return "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (ch === "。" || ch === "！" || ch === "？") {
      return t.slice(0, i + 1).trim();
    }
    if (ch === "." || ch === "!" || ch === "?") {
      const prev = t[i - 1];
      const next = t[i + 1];
      if (prev && /\d/.test(prev) && next && /\d/.test(next)) continue;
      if (next === undefined || /\s/.test(next)) {
        return t.slice(0, i + 1).trim();
      }
    }
  }
  return t;
}

/**
 * What's New modal line: leading `**title**` if present, else the first sentence.
 * CHANGELOG may keep a second short sentence; the popup must not show it.
 */
export function changelogPopupItem(line: string): string {
  const raw = line.replace(/^\s*-\s+/, "").trim();
  if (!raw) return "";
  const boldLead = raw.match(/^\*\*(.+?)\*\*/);
  const lead = boldLead ? boldLead[1] : raw;
  const cleaned = lead
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return firstSentence(stripIssueRefs(cleaned));
}

function extractVersionBody(
  markdown: string,
  version: string,
): { rest: string; body: string } | null {
  // `(?![\s\S])` is the JS way to say "absolute end of input". `\Z` was
  // intended for that but in JS it is a literal-Z identity escape, so any
  // section containing a capital Z (e.g. "ZDR", "Zoom") truncated at it and
  // silently dropped every entry after it from the What's New popup.
  const re = new RegExp(
    `^## \\[${escapeRegExp(version)}\\]([^\\n]*)\\n([\\s\\S]*?)(?=^## \\[|(?![\\s\\S]))`,
    "m",
  );
  const m = re.exec(markdown);
  if (!m) return null;
  return { rest: m[1] ?? "", body: m[2] ?? "" };
}

function pickHighlight(body: string, lang: ChangelogLang): string | null {
  if (lang === "zh") {
    const m = body.match(/\*\*中文\s*·\s*亮点[：:]\*\*\s*(.+)/);
    const t = m?.[1]?.trim() ?? "";
    return firstSentence(stripIssueRefs(t)) || null;
  }
  const m = body.match(/\*\*Highlight:\*\*\s*(.+)/);
  const t = m?.[1]?.trim() ?? "";
  return firstSentence(stripIssueRefs(t)) || null;
}

function parseSectionItems(block: string, lang: ChangelogLang): string[] {
  const zhSplit = block.search(/\*\*中文\s*·/);
  const enPart = zhSplit === -1 ? block : block.slice(0, zhSplit);
  const zhPart = zhSplit === -1 ? "" : block.slice(zhSplit);
  const source = lang === "zh" && zhPart.trim() ? zhPart : enPart;
  const items: string[] = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("- ")) continue;
    const item = changelogPopupItem(line);
    if (item) items.push(item);
  }
  return items;
}

function splitH3Blocks(body: string): Array<{ title: string; body: string }> {
  const parts = body.split(/^###\s+/m);
  const out: Array<{ title: string; body: string }> = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const nl = trimmed.indexOf("\n");
    const title = (nl === -1 ? trimmed : trimmed.slice(0, nl)).trim();
    const rest = nl === -1 ? "" : trimmed.slice(nl + 1);
    out.push({ title, body: rest });
  }
  return out;
}

export function parseChangelogNotes(
  markdown: string,
  version: string,
  lang: ChangelogLang | string,
): WhatsNewNotes | null {
  const ver = version.trim();
  if (!ver || !markdown) return null;
  const extracted = extractVersionBody(markdown, ver);
  if (!extracted) return null;
  const dateMatch = extracted.rest.match(/-\s*(\d{4}-\d{2}-\d{2})/);
  const resolvedLang = lang === "zh" ? "zh" : changelogLang(lang);
  const sections: WhatsNewSection[] = [];
  for (const block of splitH3Blocks(extracted.body)) {
    const heading = `### ${block.title}`;
    let id: WhatsNewSectionId | null = null;
    (Object.keys(SECTION_HEADINGS) as WhatsNewSectionId[]).forEach((key) => {
      if (SECTION_HEADINGS[key].test(heading)) id = key;
    });
    if (!id) continue;
    const items = parseSectionItems(block.body, resolvedLang);
    if (items.length) sections.push({ id, items });
  }
  return {
    version: ver,
    date: dateMatch?.[1] ?? null,
    highlight: pickHighlight(extracted.body, resolvedLang),
    sections,
  };
}

export function notesForAppVersion(
  locale: string | Locale,
  markdown: string = CHANGELOG_MARKDOWN,
  version: string = APP_VERSION,
): WhatsNewNotes | null {
  return (
    parseChangelogNotes(markdown, version, changelogLang(locale)) ??
    parseChangelogNotes(markdown, "Unreleased", changelogLang(locale))
  );
}

function readKey(storage: WhatsNewStorage, key: string): string | null {
  try {
    const raw = storage.getItem(key);
    const v = raw?.trim() ?? "";
    return v || null;
  } catch {
    return null;
  }
}

export function loadSeenVersion(
  storage: WhatsNewStorage = defaultStorage(),
): string | null {
  return readKey(storage, WHATS_NEW_SEEN_KEY);
}

export function loadFirstSeenVersion(
  storage: WhatsNewStorage = defaultStorage(),
): string | null {
  return readKey(storage, WHATS_NEW_FIRST_SEEN_KEY);
}

export function markWhatsNewSeen(
  version: string,
  storage: WhatsNewStorage = defaultStorage(),
): void {
  const v = version.trim();
  if (!v) return;
  try {
    storage.setItem(WHATS_NEW_SEEN_KEY, v);
  } catch {
    /* private mode / quota */
  }
}

export function ensureFirstSeenVersion(
  currentVersion: string,
  storage: WhatsNewStorage = defaultStorage(),
): string | null {
  const existing = readKey(storage, WHATS_NEW_FIRST_SEEN_KEY);
  if (existing) return existing;
  const v = currentVersion.trim();
  if (!v) return null;
  try {
    storage.setItem(WHATS_NEW_FIRST_SEEN_KEY, v);
  } catch {
    return v;
  }
  return v;
}

export function shouldAutoShowWhatsNew(opts: {
  currentVersion: string;
  seenVersion: string | null;
  firstSeenVersion: string | null;
  gateReady: boolean;
  setupOpen: boolean;
  tutorialOpen: boolean;
}): boolean {
  if (!opts.gateReady || opts.setupOpen || opts.tutorialOpen) return false;
  const current = opts.currentVersion.trim();
  if (!current) return false;
  if (opts.seenVersion === current) return false;
  if (opts.firstSeenVersion === current && opts.seenVersion == null) {
    return false;
  }
  return opts.seenVersion !== current;
}

export function requestWhatsNewOpen(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WHATS_NEW_OPEN_EVENT));
}
