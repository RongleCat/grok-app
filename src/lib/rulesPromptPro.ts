/**
 * RULES-PROMPT-PRO — pure helpers for project rules editor + session
 * system-prompt / extra-rules UX (validation, soft-fail, presentation).
 *
 * Disk I/O and Tauri invokes stay in the host / App; this module never invents
 * success and never returns full secret-bearing bodies for logs.
 */

import {
  SESSION_EXTRA_RULES_MAX_CHARS,
  sanitizeExtraRules,
} from "./sessionExtraRules";
import {
  SESSION_SYSTEM_PROMPT_MAX_CHARS,
  sanitizeSystemPromptOverride,
} from "./sessionSystemPrompt";
import { isFsWriteConflict, isResourceDraftDirty } from "./resourceEdit";
import {
  normalizeRuleRelativePath,
  type ProjectRuleKind,
} from "./projectRules";

/** Which per-session text field the user is editing. */
export type SessionPromptFieldKind = "system_prompt" | "extra_rules";

/** Soft-fail / outcome kinds for rules + prompt host actions. */
export type RulesPromptErrorKind =
  | "ok"
  | "cleared"
  | "need_tauri"
  | "need_project"
  | "host_error"
  | "conflict"
  | "truncated_readonly"
  | "empty_path"
  | "permission"
  | "not_found"
  | "other";

/** Visual severity for chips / count / banners. */
export type RulesPromptSeverity = "ok" | "warn" | "err" | "info";

/** Char-budget snapshot for a session prompt / rules draft. */
export type SessionTextBudget = {
  /** Length of the raw editor value (before sanitize). */
  rawLen: number;
  /** Length after sanitize (NUL strip + trim + clamp). */
  sanitizedLen: number;
  max: number;
  remaining: number;
  /** True when input was longer than max (UI clamp or sanitize clamp). */
  clamped: boolean;
  /** True when raw contained NUL bytes that sanitize strips. */
  nulStripped: boolean;
  /** True when sanitized body is empty (save will clear). */
  empty: boolean;
  /** >= 90% of max (warn). */
  nearCap: boolean;
  /** At max capacity. */
  atCap: boolean;
};

/** Stable status for session text field chrome. */
export type SessionTextStatus =
  | "empty"
  | "ok"
  | "near_cap"
  | "at_cap"
  | "nul_stripped"
  | "will_clear";

export type SessionTextValidation = {
  field: SessionPromptFieldKind;
  budget: SessionTextBudget;
  status: SessionTextStatus;
  /** Value ready to persist (`""` means clear). */
  sanitized: string;
  /** Draft differs from baseline (raw string compare). */
  dirty: boolean;
  severity: RulesPromptSeverity;
  /**
   * Message key for a short status line (caller passes through `t()`).
   * Null when no extra status beyond the char counter is needed.
   */
  statusKey:
    | "session.promptStatus.empty"
    | "session.promptStatus.willClear"
    | "session.promptStatus.nearCap"
    | "session.promptStatus.atCap"
    | "session.promptStatus.nulStripped"
    | null;
};

/** Fraction of max length that triggers the near-cap warning. */
export const SESSION_TEXT_NEAR_CAP_RATIO = 0.9;

/** Soft cap shared by both session fields (keep in sync with field helpers). */
export function sessionFieldMaxChars(field: SessionPromptFieldKind): number {
  return field === "system_prompt"
    ? SESSION_SYSTEM_PROMPT_MAX_CHARS
    : SESSION_EXTRA_RULES_MAX_CHARS;
}

/** Sanitize for the given field kind. */
export function sanitizeSessionPromptField(
  field: SessionPromptFieldKind,
  raw: string | null | undefined,
  maxLen?: number,
): string {
  if (field === "system_prompt") {
    return sanitizeSystemPromptOverride(raw, maxLen);
  }
  return sanitizeExtraRules(raw, maxLen);
}

/**
 * Clamp raw editor input to max length for controlled textareas.
 * Does not trim (so typing spaces mid-edit is preserved); strips NULs only
 * when present so the caret does not jump on ordinary keystrokes.
 */
export function clampSessionTextInput(
  raw: string,
  maxLen: number,
): { value: string; clamped: boolean; nulStripped: boolean } {
  const hadNul = raw.includes("\0");
  const cleaned = hadNul ? raw.replace(/\0/g, "") : raw;
  const cap = maxLen > 0 ? maxLen : 0;
  if (cap <= 0) {
    return { value: "", clamped: cleaned.length > 0, nulStripped: hadNul };
  }
  if (cleaned.length <= cap) {
    return { value: cleaned, clamped: false, nulStripped: hadNul };
  }
  return {
    value: cleaned.slice(0, cap),
    clamped: true,
    nulStripped: hadNul,
  };
}

/** Char budget + flags for a draft (raw editor value). */
export function sessionTextBudget(
  field: SessionPromptFieldKind,
  raw: string | null | undefined,
  maxLen?: number,
): SessionTextBudget {
  const max = maxLen != null && maxLen > 0 ? maxLen : sessionFieldMaxChars(field);
  const source = typeof raw === "string" ? raw : "";
  const hadNul = source.includes("\0");
  const withoutNul = hadNul ? source.replace(/\0/g, "") : source;
  const sanitized = sanitizeSessionPromptField(field, source, max);
  const rawLen = source.length;
  const sanitizedLen = sanitized.length;
  // Clamped when either the editor value already sits at/over max, or sanitize
  // shortened non-whitespace content beyond trim/NUL effects.
  const clamped =
    withoutNul.length > max ||
    (sanitizedLen === max && withoutNul.trim().length > max);
  const remaining = Math.max(0, max - rawLen);
  const empty = sanitizedLen === 0;
  const atCap = rawLen >= max;
  const nearCap = !empty && rawLen >= Math.floor(max * SESSION_TEXT_NEAR_CAP_RATIO);
  return {
    rawLen,
    sanitizedLen,
    max,
    remaining,
    clamped,
    nulStripped: hadNul,
    empty,
    nearCap,
    atCap,
  };
}

/**
 * Full validation model for session system-prompt / extra-rules editors.
 * `baseline` is the value loaded when the modal opened (pre-edit).
 */
export function validateSessionTextField(opts: {
  field: SessionPromptFieldKind;
  draft: string | null | undefined;
  baseline?: string | null | undefined;
  maxLen?: number;
  /** True when a non-empty value is currently stored for this session. */
  hadStored?: boolean;
}): SessionTextValidation {
  const field = opts.field;
  const draft = typeof opts.draft === "string" ? opts.draft : "";
  const budget = sessionTextBudget(field, draft, opts.maxLen);
  const sanitized = sanitizeSessionPromptField(field, draft, opts.maxLen);
  const dirty = isResourceDraftDirty(draft, opts.baseline ?? "");

  let status: SessionTextStatus = "ok";
  let severity: RulesPromptSeverity = "ok";
  let statusKey: SessionTextValidation["statusKey"] = null;

  if (budget.nulStripped) {
    status = "nul_stripped";
    severity = "warn";
    statusKey = "session.promptStatus.nulStripped";
  } else if (budget.empty && opts.hadStored) {
    status = "will_clear";
    severity = "info";
    statusKey = "session.promptStatus.willClear";
  } else if (budget.empty) {
    status = "empty";
    severity = "info";
    statusKey = "session.promptStatus.empty";
  } else if (budget.atCap || budget.clamped) {
    status = "at_cap";
    severity = "warn";
    statusKey = "session.promptStatus.atCap";
  } else if (budget.nearCap) {
    status = "near_cap";
    severity = "warn";
    statusKey = "session.promptStatus.nearCap";
  }

  return {
    field,
    budget,
    status,
    sanitized,
    dirty,
    severity,
    statusKey,
  };
}

/** True when closing the modal should confirm discard. */
export function shouldConfirmSessionTextDiscard(
  validation: Pick<SessionTextValidation, "dirty">,
): boolean {
  return Boolean(validation.dirty);
}

/**
 * Classify a host / client error for rules or prompt actions.
 * Never upgrades an error into success.
 */
export function classifyRulesPromptError(
  err: unknown,
  opts?: { needTauri?: boolean; needProject?: boolean },
): RulesPromptErrorKind {
  if (opts?.needTauri) return "need_tauri";
  if (opts?.needProject) return "need_project";
  if (err == null || err === "") return "other";
  if (isFsWriteConflict(err)) return "conflict";
  const s = String(err).toLowerCase();
  if (!s.trim()) return "other";
  if (
    s.includes("not a tauri") ||
    s.includes("need tauri") ||
    s.includes("requires the desktop") ||
    s.includes("desktop app")
  ) {
    return "need_tauri";
  }
  if (
    s.includes("no project") ||
    s.includes("need project") ||
    s.includes("select a project") ||
    s.includes("project path")
  ) {
    return "need_project";
  }
  if (
    s.includes("permission denied") ||
    s.includes("access denied") ||
    s.includes("eacces") ||
    s.includes("not trusted") ||
    s.includes("untrusted")
  ) {
    return "permission";
  }
  if (
    s.includes("not found") ||
    s.includes("enoent") ||
    s.includes("no such file")
  ) {
    return "not_found";
  }
  if (s.includes("truncated")) return "truncated_readonly";
  if (
    s.includes("empty path") ||
    s.includes("no path") ||
    s.includes("missing path")
  ) {
    return "empty_path";
  }
  // Generic invoke / IO failures
  if (
    s.includes("failed") ||
    s.includes("error") ||
    s.includes("reject") ||
    s.includes("timeout") ||
    s.includes("i/o") ||
    s.includes("io error")
  ) {
    return "host_error";
  }
  return "other";
}

/** Message key for a classified soft-fail (project rules or session field). */
export function rulesPromptErrorMessageKey(
  kind: RulesPromptErrorKind,
  surface: "project_rules" | "session_prompt",
):
  | "rules.needTauri"
  | "rules.needProject"
  | "rules.actionError"
  | "rules.openFailed"
  | "rules.truncatedReadonly"
  | "rules.permissionDenied"
  | "rules.notFound"
  | "rules.emptyPath"
  | "session.promptError.needTauri"
  | "session.promptError.host"
  | "session.promptError.other"
  | "resources.conflictTitle"
  | "resources.saveFailed" {
  if (surface === "session_prompt") {
    switch (kind) {
      case "need_tauri":
        return "session.promptError.needTauri";
      case "host_error":
      case "permission":
      case "not_found":
        return "session.promptError.host";
      case "conflict":
        return "resources.conflictTitle";
      default:
        return "session.promptError.other";
    }
  }
  switch (kind) {
    case "need_tauri":
      return "rules.needTauri";
    case "need_project":
      return "rules.needProject";
    case "conflict":
      return "resources.conflictTitle";
    case "truncated_readonly":
      return "rules.truncatedReadonly";
    case "permission":
      return "rules.permissionDenied";
    case "not_found":
      return "rules.notFound";
    case "empty_path":
      return "rules.emptyPath";
    case "host_error":
      return "rules.actionError";
    default:
      return "rules.actionError";
  }
}

/** Severity for classified soft-fail. */
export function rulesPromptErrorSeverity(
  kind: RulesPromptErrorKind,
): RulesPromptSeverity {
  switch (kind) {
    case "ok":
    case "cleared":
      return "ok";
    case "truncated_readonly":
    case "need_tauri":
    case "need_project":
      return "warn";
    case "conflict":
    case "permission":
    case "not_found":
    case "empty_path":
    case "host_error":
    case "other":
      return "err";
  }
}

/** Outcome after a successful session field save. */
export type SessionPromptSaveOutcome = {
  kind: "saved" | "cleared";
  /** Safe meta for logs — never the body. */
  logMeta: { field: SessionPromptFieldKind; chars: number } | null;
  toastKey: "session.rulesSaved" | "session.rulesCleared" | "session.sysPromptSaved" | "session.sysPromptCleared";
};

export function sessionPromptSaveOutcome(
  field: SessionPromptFieldKind,
  stored: string | null | undefined,
): SessionPromptSaveOutcome {
  const sanitized = sanitizeSessionPromptField(field, stored);
  if (!sanitized) {
    return {
      kind: "cleared",
      logMeta: null,
      toastKey:
        field === "system_prompt"
          ? "session.sysPromptCleared"
          : "session.rulesCleared",
    };
  }
  return {
    kind: "saved",
    logMeta: { field, chars: sanitized.length },
    toastKey:
      field === "system_prompt"
        ? "session.sysPromptSaved"
        : "session.rulesSaved",
  };
}

// ---------------------------------------------------------------------------
// Project rules list / editor presentation
// ---------------------------------------------------------------------------

export type ProjectRuleListItem = {
  name: string;
  relativePath: string;
  absolutePath?: string;
  kind: string;
  scope?: string;
  exists?: boolean;
};

/** Single-letter chip for a rule kind (A / C / G / N). */
export function projectRuleKindChipLetter(kind: string | null | undefined): string {
  switch ((kind || "").trim()) {
    case "agents_md":
      return "A";
    case "claude_md":
      return "C";
    case "grok_rules":
      return "G";
    case "nested_agents":
      return "N";
    default:
      return "R";
  }
}

/** Message key for a rule kind label. */
export function projectRuleKindLabelKey(
  kind: string | null | undefined,
):
  | "rules.kind.agents_md"
  | "rules.kind.claude_md"
  | "rules.kind.grok_rules"
  | "rules.kind.nested_agents"
  | "rules.title" {
  switch ((kind || "").trim()) {
    case "agents_md":
      return "rules.kind.agents_md";
    case "claude_md":
      return "rules.kind.claude_md";
    case "grok_rules":
      return "rules.kind.grok_rules";
    case "nested_agents":
      return "rules.kind.nested_agents";
    default:
      return "rules.title";
  }
}

export type ProjectRuleRowTitleSpec = {
  key:
    | "rules.row.projectFile"
    | "rules.row.locatedFile"
    | "rules.row.userAgentsFile"
    | "rules.row.cliHomeFile"
    | "rules.row.appHomeFile";
  params: { name: string; dir?: string };
};

function isAppAgentHomePath(absolutePath: string | undefined): boolean {
  const p = (absolutePath || "").replace(/\\/g, "/").toLowerCase();
  return (
    p.includes("/agent-home/") ||
    p.endsWith("/agent-home") ||
    p.includes("/.grok-app/")
  );
}

/**
 * Row title: root files are "this project · AGENTS.md"; user homes keep
 * their well-known location; nested project files keep the parent directory.
 */
export function projectRuleRowTitleSpec(
  rule: ProjectRuleListItem,
): ProjectRuleRowTitleSpec {
  const relativePath = normalizeRuleRelativePath(rule.relativePath || "");
  const name =
    (rule.name || "").trim() ||
    relativePath.split("/").pop() ||
    (rule.absolutePath || "").replace(/\\/g, "/").split("/").pop() ||
    relativePath ||
    "AGENTS.md";
  const scope = (rule.scope || "project").trim() || "project";
  if (scope === "user_agents") {
    return { key: "rules.row.userAgentsFile", params: { name } };
  }
  if (scope === "grok_home") {
    if (isAppAgentHomePath(rule.absolutePath || rule.relativePath)) {
      return { key: "rules.row.appHomeFile", params: { name } };
    }
    return { key: "rules.row.cliHomeFile", params: { name } };
  }
  if (relativePath && !relativePath.includes("/")) {
    return { key: "rules.row.projectFile", params: { name } };
  }
  const slash = relativePath.lastIndexOf("/");
  const dir = slash > 0 ? relativePath.slice(0, slash) : relativePath || ".";
  return { key: "rules.row.locatedFile", params: { dir, name } };
}

/** Prefer the absolute filesystem path; fall back to the project-relative path. */
export function projectRuleDisplayPath(
  rule: ProjectRuleListItem,
): string {
  const abs = (rule.absolutePath || "").trim();
  if (abs) return abs;
  return normalizeRuleRelativePath(rule.relativePath || "");
}

function projectRuleScopeOrder(scope: string | null | undefined): number {
  switch ((scope || "project").trim()) {
    case "project":
      return 0;
    case "grok_home":
      return 1;
    case "user_agents":
      return 2;
    default:
      return 9;
  }
}

function projectRuleKindOrder(kind: string | null | undefined): number {
  switch ((kind || "").trim()) {
    case "agents_md":
      return 0;
    case "claude_md":
      return 1;
    case "grok_rules":
      return 2;
    case "nested_agents":
      return 3;
    default:
      return 9;
  }
}

/** Existing files first, then project → GROK_HOME → ~/.agents, then kind/path. */
export function compareProjectRuleListItems(
  a: ProjectRuleListItem,
  b: ProjectRuleListItem,
): number {
  const ae = a.exists === false ? 1 : 0;
  const be = b.exists === false ? 1 : 0;
  if (ae !== be) return ae - be;
  const so = projectRuleScopeOrder(a.scope) - projectRuleScopeOrder(b.scope);
  if (so !== 0) return so;
  const ko = projectRuleKindOrder(a.kind) - projectRuleKindOrder(b.kind);
  if (ko !== 0) return ko;
  return (a.relativePath || "").localeCompare(b.relativePath || "");
}

/** Filter rules by name / path / kind (case-insensitive substring). */
export function filterProjectRulesList<T extends ProjectRuleListItem>(
  rules: readonly T[],
  query: string | null | undefined,
): T[] {
  const q = (query ?? "").trim().toLowerCase();
  const matched = !q
    ? rules.slice()
    : rules.filter((r) => {
        const name = (r.name || "").toLowerCase();
        const rel = (r.relativePath || "").toLowerCase();
        const abs = (r.absolutePath || "").toLowerCase();
        const kind = (r.kind || "").toLowerCase();
        const scope = (r.scope || "").toLowerCase();
        return (
          name.includes(q) ||
          rel.includes(q) ||
          abs.includes(q) ||
          kind.includes(q) ||
          scope.includes(q)
        );
      });
  return matched.sort(compareProjectRuleListItems);
}

export type ProjectRulesSummary = {
  total: number;
  missingCount: number;
  byKind: Partial<Record<ProjectRuleKind | string, number>>;
  hasAgentsMd: boolean;
  hasClaudeMd: boolean;
  hasGrokRules: boolean;
  hasNestedAgents: boolean;
};

/** Count existing rules by kind; placeholders are `missingCount` only. */
export function summarizeProjectRules(
  rules: readonly ProjectRuleListItem[],
  hasAgentsMdHint?: boolean | null,
): ProjectRulesSummary {
  const byKind: ProjectRulesSummary["byKind"] = {};
  let existing = 0;
  let missingCount = 0;
  for (const r of rules) {
    if (r.exists === false) {
      missingCount += 1;
      continue;
    }
    existing += 1;
    const k = (r.kind || "").trim() || "other";
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  const hasAgentsMd =
    hasAgentsMdHint != null
      ? Boolean(hasAgentsMdHint)
      : (byKind.agents_md ?? 0) > 0;
  return {
    total: existing,
    missingCount,
    byKind,
    hasAgentsMd,
    hasClaudeMd: (byKind.claude_md ?? 0) > 0,
    hasGrokRules: (byKind.grok_rules ?? 0) > 0,
    hasNestedAgents: (byKind.nested_agents ?? 0) > 0,
  };
}

export type ProjectRuleDraftValidation = {
  dirty: boolean;
  empty: boolean;
  truncated: boolean;
  /** Soft warn — empty body is allowed but unusual. */
  emptyWarn: boolean;
  canSave: boolean;
  severity: RulesPromptSeverity;
  statusKey:
    | "rules.draftEmptyWarn"
    | "rules.truncatedReadonly"
    | "resources.unsaved"
    | null;
};

/** Validate an open project-rule draft before save. */
export function validateProjectRuleDraft(opts: {
  draftText: string | null | undefined;
  baselineText: string | null | undefined;
  truncated?: boolean | null;
  loading?: boolean | null;
  saving?: boolean | null;
}): ProjectRuleDraftValidation {
  const draft = opts.draftText ?? "";
  const baseline = opts.baselineText ?? "";
  const dirty = isResourceDraftDirty(draft, baseline);
  const truncated = Boolean(opts.truncated);
  const empty = draft.trim().length === 0;
  // Soft warn only — empty project rule files are unusual but not blocked.
  const emptyWarn = dirty && empty && !truncated;
  const canSave = dirty && !truncated && !opts.loading && !opts.saving;

  let severity: RulesPromptSeverity = "ok";
  let statusKey: ProjectRuleDraftValidation["statusKey"] = null;
  if (truncated) {
    severity = "warn";
    statusKey = "rules.truncatedReadonly";
  } else if (emptyWarn) {
    severity = "warn";
    statusKey = "rules.draftEmptyWarn";
  } else if (dirty) {
    severity = "info";
    statusKey = "resources.unsaved";
  }

  return {
    dirty,
    empty,
    truncated,
    emptyWarn,
    canSave,
    severity,
    statusKey,
  };
}

/**
 * Soft-fail presentation for project rules list load / ensure / reveal.
 * Prefer classified kind over raw host strings when choosing UI tone.
 */
export function presentProjectRulesSoftFail(
  err: unknown,
  opts?: { needTauri?: boolean; needProject?: boolean },
): {
  kind: RulesPromptErrorKind;
  severity: RulesPromptSeverity;
  messageKey: ReturnType<typeof rulesPromptErrorMessageKey>;
  /** Raw string for detail (may be empty). */
  detail: string;
} {
  const kind = classifyRulesPromptError(err, opts);
  return {
    kind,
    severity: rulesPromptErrorSeverity(kind),
    messageKey: rulesPromptErrorMessageKey(kind, "project_rules"),
    detail: err == null ? "" : String(err),
  };
}

/** Soft-fail presentation for session prompt / rules save. */
export function presentSessionPromptSoftFail(err: unknown): {
  kind: RulesPromptErrorKind;
  severity: RulesPromptSeverity;
  messageKey: ReturnType<typeof rulesPromptErrorMessageKey>;
  detail: string;
} {
  const kind = classifyRulesPromptError(err);
  return {
    kind,
    severity: rulesPromptErrorSeverity(kind),
    messageKey: rulesPromptErrorMessageKey(kind, "session_prompt"),
    detail: err == null ? "" : String(err),
  };
}

/**
 * Safe log meta for a session prompt field — never the body.
 * Returns null when empty.
 */
export function sessionPromptLogMeta(
  field: SessionPromptFieldKind,
  raw: string | null | undefined,
): { field: SessionPromptFieldKind; chars: number } | null {
  const s = sanitizeSessionPromptField(field, raw);
  if (!s) return null;
  return { field, chars: s.length };
}
