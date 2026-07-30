/**
 * Pure helpers for optional session JSON Schema structured output.
 *
 * Client-side: parse + light structural checks (object schema).
 * Agent path: best-effort CLI `--json-schema` on spawn (top-level `grok` flag)
 * plus an experimental prompt instruction when the flag is not available mid-session.
 */

export type JsonSchemaParseOk = {
  ok: true;
  /** Canonical pretty-printed schema text (stable for storage / CLI). */
  normalized: string;
  /** Parsed value (always a plain object). */
  value: Record<string, unknown>;
};

export type JsonSchemaParseErr = {
  ok: false;
  error: "empty" | "invalid_json" | "not_object" | "too_large";
  message: string;
};

export type JsonSchemaParseResult = JsonSchemaParseOk | JsonSchemaParseErr;

/** Soft cap so spawn argv / session index stay bounded (~256 KiB). */
export const JSON_SCHEMA_MAX_CHARS = 256 * 1024;

const ERR_EMPTY = "JSON Schema is empty.";
const ERR_INVALID = "Invalid JSON — fix syntax before applying.";
const ERR_NOT_OBJECT =
  "JSON Schema must be a JSON object (e.g. {\"type\":\"object\",…}).";
const ERR_TOO_LARGE = `JSON Schema is too large (max ${JSON_SCHEMA_MAX_CHARS} characters).`;

/**
 * Validate pasted schema text: non-empty JSON object, size-capped.
 * Does not run a full JSON Schema meta-validator — only parse + shape.
 */
export function parseJsonSchemaText(raw: string): JsonSchemaParseResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { ok: false, error: "empty", message: ERR_EMPTY };
  }
  if (trimmed.length > JSON_SCHEMA_MAX_CHARS) {
    return { ok: false, error: "too_large", message: ERR_TOO_LARGE };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "invalid_json", message: ERR_INVALID };
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return { ok: false, error: "not_object", message: ERR_NOT_OBJECT };
  }

  const value = parsed as Record<string, unknown>;
  let normalized: string;
  try {
    normalized = JSON.stringify(value, null, 2);
  } catch {
    return { ok: false, error: "invalid_json", message: ERR_INVALID };
  }
  if (normalized.length > JSON_SCHEMA_MAX_CHARS) {
    return { ok: false, error: "too_large", message: ERR_TOO_LARGE };
  }

  return { ok: true, normalized, value };
}

/** True when stored schema text is present and still valid. */
export function isActiveJsonSchema(raw: string | null | undefined): boolean {
  if (raw == null || !String(raw).trim()) return false;
  return parseJsonSchemaText(String(raw)).ok;
}

/**
 * Extract pretty JSON from an assistant reply for the structured-output panel.
 * Prefers whole-message JSON; falls back to a fenced ```json block.
 */
export function extractStructuredJson(content: string): string | null {
  const text = (content ?? "").trim();
  if (!text) return null;

  const direct = tryPrettyJson(text);
  if (direct) return direct;

  // Fenced code block (```json … ``` or bare ``` … ```)
  const fence =
    /```(?:json|JSON)?\s*\n([\s\S]*?)```/m.exec(text) ??
    /```(?:json|JSON)?\s*([\s\S]*?)```/m.exec(text);
  if (fence?.[1]) {
    const inner = tryPrettyJson(fence[1].trim());
    if (inner) return inner;
  }

  // Leading/trailing prose around a single top-level object/array
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");
  let start = -1;
  if (startObj >= 0 && startArr >= 0) start = Math.min(startObj, startArr);
  else start = Math.max(startObj, startArr);
  if (start >= 0) {
    const slice = text.slice(start);
    const pretty = tryPrettyJson(slice);
    if (pretty) return pretty;
    // Balance braces for object
    if (slice.startsWith("{")) {
      const balanced = extractBalanced(slice, "{", "}");
      if (balanced) {
        const p = tryPrettyJson(balanced);
        if (p) return p;
      }
    } else if (slice.startsWith("[")) {
      const balanced = extractBalanced(slice, "[", "]");
      if (balanced) {
        const p = tryPrettyJson(balanced);
        if (p) return p;
      }
    }
  }

  return null;
}

function tryPrettyJson(raw: string): string | null {
  try {
    const v = JSON.parse(raw);
    if (v === null || typeof v !== "object") return null;
    return JSON.stringify(v, null, 2);
  } catch {
    return null;
  }
}

function extractBalanced(
  s: string,
  open: string,
  close: string,
): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(0, i + 1);
    }
  }
  return null;
}

/**
 * Experimental prompt wrapper when structured output is active.
 * Used always so mid-session schema changes work without respawn;
 * spawn also passes `--json-schema` when connecting with a stored schema.
 */
export function wrapAgentTextWithJsonSchema(
  agentText: string,
  schemaNormalized: string,
): string {
  const schema = schemaNormalized.trim();
  if (!schema) return agentText;
  const header = [
    "[Structured output — experimental]",
    "Your final answer MUST be valid JSON that conforms to this JSON Schema.",
    "Do not wrap the JSON in markdown fences unless the user asks.",
    "JSON Schema:",
    schema,
    "---",
  ].join("\n");
  const body = (agentText ?? "").trim();
  return body ? `${header}\n${body}` : header;
}
