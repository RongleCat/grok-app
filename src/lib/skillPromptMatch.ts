/**
 * Rank host skills against a free-text user prompt for Find Skills.
 *
 * Inventory-only: never invents skill names.
 * Matching layers (still local / offline — no LLM call):
 * 1. Tokenize prompt (EN+VI stopwords stripped)
 * 2. Expand intent synonyms / purpose phrases → domain tokens
 * 3. Score name + description with multi-token coverage bonus
 *
 * This is purpose-oriented keyword ranking, not full semantic NLU.
 */

export type SkillMatchRow = {
  name: string;
  description?: string;
  source?: string;
  enabled?: boolean;
  userInvocable?: boolean;
};

export type SkillMatchHit = SkillMatchRow & {
  /** Higher = better fit for the prompt. */
  score: number;
  /** Matched tokens (for UI chips). */
  matchedTokens: string[];
};

/** Common EN + VI stopwords (prompt noise). */
const STOP = new Set(
  [
    "a",
    "an",
    "the",
    "and",
    "or",
    "to",
    "for",
    "of",
    "in",
    "on",
    "at",
    "is",
    "are",
    "be",
    "with",
    "from",
    "by",
    "as",
    "it",
    "this",
    "that",
    "my",
    "me",
    "i",
    "we",
    "you",
    "your",
    "please",
    "help",
    "how",
    "what",
    "when",
    "where",
    "can",
    "could",
    "would",
    "should",
    "need",
    "want",
    "make",
    "do",
    "does",
    "using",
    "use",
    "via",
    "into",
    "just",
    "also",
    "very",
    "really",
    "more",
    "some",
    "any",
    "all",
    "about",
    "về",
    "và",
    "của",
    "cho",
    "với",
    "là",
    "các",
    "những",
    "một",
    "này",
    "kia",
    "đó",
    "tôi",
    "mình",
    "em",
    "anh",
    "chị",
    "bạn",
    "giúp",
    "làm",
    "được",
    "không",
    "cần",
    "muốn",
    "hãy",
    "rồi",
    "thì",
    "nếu",
    "khi",
    "trong",
    "trên",
    "dưới",
    "theo",
    "từ",
    "đến",
    "vào",
    "ra",
    "lại",
    "nhé",
    "nha",
    "ạ",
    "ơi",
    "đi",
    "có",
    "gì",
    "nào",
    "sao",
    "thế",
    "đâu",
    "thấy",
    "nhìn",
    "hôm",
    "nay",
    "đang",
    "sẽ",
    "đã",
    "bị",
    "bằng",
    "như",
    "hay",
    "hoặc",
    "vẫn",
    "mà",
    "để",
    "nữa",
    "luôn",
    "thôi",
    "prompt",
    "skill",
    "skills",
    "panel",
    "please",
  ].map((s) => s.toLowerCase()),
);

/**
 * Purpose / intent phrases → domain tokens (EN skill catalog vocabulary).
 * Keys are normalized (NFD-stripped lowercase). Matched as substrings in prompt.
 */
const INTENT_PHRASES: Array<{ phrase: string; tokens: string[] }> = [
  // React / frontend perf
  { phrase: "react performance", tokens: ["react", "performance", "render", "bundle"] },
  { phrase: "toi uu react", tokens: ["react", "performance", "optimize"] },
  { phrase: "toi uu hieu nang", tokens: ["performance", "optimize", "bundle"] },
  { phrase: "hieu nang", tokens: ["performance", "optimize"] },
  { phrase: "re-render", tokens: ["react", "render", "performance"] },
  { phrase: "rerender", tokens: ["react", "render", "performance"] },
  { phrase: "bundle size", tokens: ["bundle", "performance"] },
  { phrase: "next.js", tokens: ["nextjs", "react", "next"] },
  { phrase: "nextjs", tokens: ["nextjs", "react", "next"] },
  // UI / design
  { phrase: "giao dien", tokens: ["ui", "design", "frontend", "layout"] },
  { phrase: "thiet ke", tokens: ["design", "ui", "frontend"] },
  { phrase: "web design", tokens: ["design", "web", "layout", "accessibility"] },
  { phrase: "accessibility", tokens: ["accessibility", "a11y", "design"] },
  // Security
  { phrase: "bao mat", tokens: ["security", "secure", "auth"] },
  { phrase: "tan cong", tokens: ["attack", "security", "exploit"] },
  { phrase: "lo hong", tokens: ["vulnerability", "security"] },
  { phrase: "sql injection", tokens: ["sql", "injection", "sqli"] },
  { phrase: "xss", tokens: ["xss", "cross", "scripting"] },
  { phrase: "pentest", tokens: ["penetration", "security", "test"] },
  { phrase: "kiem thu bao mat", tokens: ["security", "test", "penetration"] },
  // Skills discovery
  { phrase: "tim skill", tokens: ["find", "skill", "discover"] },
  { phrase: "find skill", tokens: ["find", "skill", "discover"] },
  { phrase: "cai skill", tokens: ["install", "skill", "add"] },
  // Multi-agent / agentwork
  { phrase: "multi agent", tokens: ["multi", "agent", "crew"] },
  { phrase: "da agent", tokens: ["multi", "agent", "crew"] },
  { phrase: "x16", tokens: ["crew", "trustlayer", "agent"] },
  { phrase: "agentwork", tokens: ["agentwork", "crew", "agent"] },
  // Git / review
  { phrase: "code review", tokens: ["review", "code"] },
  { phrase: "kiem tra code", tokens: ["review", "code", "audit"] },
  // Deploy / cloud
  { phrase: "deploy", tokens: ["deploy", "cloud", "ci"] },
  { phrase: "kubernetes", tokens: ["kubernetes", "k8s", "container"] },
  { phrase: "docker", tokens: ["docker", "container"] },
  // Auth
  { phrase: "dang nhap", tokens: ["auth", "login", "authentication"] },
  { phrase: "authentication", tokens: ["auth", "authentication", "login"] },
  { phrase: "oauth", tokens: ["oauth", "auth", "token"] },
  // API
  { phrase: "api security", tokens: ["api", "security", "authorization"] },
  { phrase: "rest api", tokens: ["api", "rest"] },
];

/**
 * Single-token synonyms (VI/EN casual → catalog English).
 */
const TOKEN_SYNONYMS: Record<string, string[]> = {
  // VI purpose words
  toi: ["optimize"], // part of tối ưu after strip may be "toi"
  uu: ["optimize"],
  toi_uu: ["optimize", "performance"],
  hieu: ["performance"],
  nang: ["performance"],
  baomat: ["security"],
  bao: ["security"],
  mat: ["security"],
  thiet: ["design"],
  ke: ["design"],
  giao: ["ui", "interface"],
  dien: ["ui", "interface"],
  tim: ["find", "search", "discover"],
  cai: ["install", "add"],
  dat: ["install"],
  kiem: ["test", "audit", "check"],
  thu: ["test"],
  sua: ["fix", "patch"],
  loi: ["bug", "error", "fix"],
  bug: ["bug", "error", "fix"],
  // EN purpose
  optimize: ["optimize", "performance"],
  optimise: ["optimize", "performance"],
  performance: ["performance", "optimize"],
  faster: ["performance", "optimize"],
  slow: ["performance", "optimize"],
  security: ["security", "secure"],
  secure: ["security", "secure"],
  vulnerability: ["vulnerability", "security"],
  design: ["design", "ui", "frontend"],
  ui: ["ui", "design", "frontend"],
  ux: ["ux", "design", "ui"],
  react: ["react"],
  next: ["nextjs", "react", "next"],
  nextjs: ["nextjs", "react"],
  sql: ["sql", "injection"],
  injection: ["injection", "sql"],
  find: ["find", "discover", "skill"],
  discover: ["find", "discover", "skill"],
  install: ["install", "add", "skill"],
  review: ["review", "code"],
  agent: ["agent", "crew"],
  agents: ["agent", "crew"],
  panel: [], // noise for ranking
};

/** Cap tokens so live ranking stays O(skills × tokens) under control. */
const MAX_PROMPT_TOKENS = 24;

function normalizeText(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Expand free text into ranking tokens: raw tokens + intent phrase hits + synonyms.
 */
export function expandPromptTokens(text: string): string[] {
  const norm = normalizeText(text);
  if (!norm.trim()) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    const x = t.trim().toLowerCase();
    if (x.length < 2 || STOP.has(x) || /^\d+$/.test(x)) return;
    if (seen.has(x)) return;
    if (out.length >= MAX_PROMPT_TOKENS) return;
    seen.add(x);
    out.push(x);
  };

  // 1) Phrase-level purpose detection (before token split so multi-word works).
  for (const { phrase, tokens } of INTENT_PHRASES) {
    const p = normalizeText(phrase);
    if (p && norm.includes(p)) {
      for (const t of tokens) push(t);
    }
  }

  // 2) Word tokens from prompt.
  const raw = norm
    .split(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t));

  for (const t of raw) {
    push(t);
    for (const part of t.split(/[-_./]+/)) {
      push(part);
    }
    // Synonym expansion for purpose words.
    const syn = TOKEN_SYNONYMS[t];
    if (syn) {
      for (const s of syn) push(s);
    }
  }

  // 3) Compact VI compounds often appear as separate syllables after accent strip
  // e.g. "toi uu" → already handled via phrase; "baomat" glue.
  const compact = norm.replace(/\s+/g, "");
  for (const { phrase, tokens } of INTENT_PHRASES) {
    const p = normalizeText(phrase).replace(/\s+/g, "");
    if (p.length >= 4 && compact.includes(p)) {
      for (const t of tokens) push(t);
    }
  }

  return out;
}

/**
 * Tokenize free text into ranking tokens (lowercase, de-hyphenated parts).
 * Includes intent expansion — preferred entry for ranking.
 */
export function tokenizePrompt(text: string): string[] {
  return expandPromptTokens(text);
}

function skillSearchBlob(s: SkillMatchRow): {
  name: string;
  nameParts: string[];
  desc: string;
} {
  const name = (s.name ?? "").toLowerCase();
  const nameParts = name
    .split(/[-_./\s]+/)
    .filter((p) => p.length >= 2);
  const desc = (s.description ?? "").toLowerCase();
  return { name, nameParts, desc };
}

/**
 * Score one skill against prompt tokens (purpose-weighted keyword match).
 */
export function scoreSkillAgainstTokens(
  skill: SkillMatchRow,
  tokens: readonly string[],
): { score: number; matchedTokens: string[] } {
  if (!tokens.length) return { score: 0, matchedTokens: [] };
  const { name, nameParts, desc } = skillSearchBlob(skill);
  let score = 0;
  const matched: string[] = [];
  const matchedSet = new Set<string>();
  let nameHits = 0;
  let descHits = 0;

  for (const tok of tokens) {
    let hit = false;
    if (name === tok) {
      score += 24;
      hit = true;
      nameHits += 1;
    } else if (nameParts.some((p) => p === tok)) {
      score += 14;
      hit = true;
      nameHits += 1;
    } else if (name.includes(`-${tok}`) || name.includes(`_${tok}`)) {
      score += 12;
      hit = true;
      nameHits += 1;
    } else if (name.startsWith(tok) || name.includes(tok)) {
      // Substring in name — weaker if tok is short
      score += tok.length >= 4 ? 8 : 4;
      hit = true;
      nameHits += 1;
    } else if (nameParts.some((p) => p.startsWith(tok) && tok.length >= 3)) {
      score += 8;
      hit = true;
      nameHits += 1;
    }
    if (desc.includes(tok)) {
      // Description hit = purpose/body match (find-skills UX)
      score += hit ? 2 : 5;
      if (!hit) hit = true;
      descHits += 1;
    }
    if (hit && !matchedSet.has(tok)) {
      matchedSet.add(tok);
      matched.push(tok);
    }
  }

  if (score <= 0) return { score: 0, matchedTokens: [] };

  // Multi-token coverage = better purpose fit than a single weak keyword.
  const distinct = matched.length;
  if (distinct >= 2) score += 6 * (distinct - 1);
  if (distinct >= 3) score += 4;
  if (nameHits > 0 && descHits > 0) score += 4;

  // Prefer user-invocable / enabled slightly
  if (skill.userInvocable !== false) score += 1;
  if (skill.enabled !== false) score += 1;
  if (nameHits > 0) score += 1;

  // Drop pure-noise single short-token hits (e.g. "implementing" alone).
  if (distinct === 1 && matched[0] && matched[0].length <= 3 && nameHits === 0) {
    return { score: 0, matchedTokens: [] };
  }

  return { score, matchedTokens: matched };
}

/**
 * Rank catalog skills for a prompt. Returns only score > 0, highest first.
 * Does not invent skills.
 */
export function rankSkillsForPrompt(input: {
  skills: readonly SkillMatchRow[];
  prompt: string;
  /** Max hits to return (default 40). */
  limit?: number;
  /**
   * Drop weak hits below this score (default 6).
   * Filters single-token noise from huge catalogs.
   */
  minScore?: number;
}): SkillMatchHit[] {
  const tokens = tokenizePrompt(input.prompt);
  if (!tokens.length) return [];

  const minScore = input.minScore ?? 6;
  const hits: SkillMatchHit[] = [];
  for (const s of input.skills) {
    const name = (s.name ?? "").trim();
    if (!name) continue;
    const { score, matchedTokens } = scoreSkillAgainstTokens(s, tokens);
    if (score < minScore) continue;
    hits.push({
      name,
      description: s.description,
      source: s.source,
      enabled: s.enabled,
      userInvocable: s.userInvocable,
      score,
      matchedTokens,
    });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Prefer more matched tokens (better purpose coverage)
    const mb = b.matchedTokens.length - a.matchedTokens.length;
    if (mb !== 0) return mb;
    return a.name.localeCompare(b.name);
  });

  const limit = input.limit ?? 40;
  return hits.slice(0, Math.max(1, limit));
}

/**
 * Default auto-pack: top N hits above a minimum score for composer inject.
 */
export function autoPackSkills(
  hits: readonly SkillMatchHit[],
  opts?: { max?: number; minScore?: number },
): SkillMatchHit[] {
  const max = opts?.max ?? 5;
  const minScore = opts?.minScore ?? 10;
  return hits.filter((h) => h.score >= minScore).slice(0, max);
}

/**
 * Build composer text that references selected skills (token form).
 * Agents / host already understand `[[skill:name]]` from the task picker.
 */
export function formatSkillPackForComposer(
  skills: readonly { name: string }[],
  prompt?: string,
): string {
  const lines: string[] = [];
  if (prompt?.trim()) {
    lines.push(prompt.trim());
    lines.push("");
  }
  if (skills.length) {
    lines.push("Skills to load (matched for this prompt):");
    for (const s of skills) {
      lines.push(`[[skill:${s.name}]]`);
    }
  }
  return lines.join("\n");
}
