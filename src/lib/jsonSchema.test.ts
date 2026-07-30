import { describe, expect, it } from "vitest";
import {
  extractStructuredJson,
  isActiveJsonSchema,
  JSON_SCHEMA_MAX_CHARS,
  parseJsonSchemaText,
  wrapAgentTextWithJsonSchema,
} from "./jsonSchema";

describe("parseJsonSchemaText", () => {
  it("rejects empty / whitespace", () => {
    expect(parseJsonSchemaText("").ok).toBe(false);
    expect(parseJsonSchemaText("   \n").ok).toBe(false);
    const empty = parseJsonSchemaText("");
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toBe("empty");
  });

  it("rejects invalid JSON", () => {
    const r = parseJsonSchemaText("{type: object}");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_json");
  });

  it("rejects arrays and primitives", () => {
    expect(parseJsonSchemaText("[]").ok).toBe(false);
    expect(parseJsonSchemaText('"string"').ok).toBe(false);
    expect(parseJsonSchemaText("42").ok).toBe(false);
    expect(parseJsonSchemaText("null").ok).toBe(false);
    expect(parseJsonSchemaText("true").ok).toBe(false);
    for (const raw of ["[]", '"x"', "1", "null", "true"]) {
      const r = parseJsonSchemaText(raw);
      if (!r.ok) expect(r.error).toBe("not_object");
    }
  });

  it("accepts a minimal object schema and normalizes", () => {
    const r = parseJsonSchemaText(
      '{"type":"object","properties":{"name":{"type":"string"}}}',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("object");
      expect(r.normalized).toContain('"type": "object"');
      expect(JSON.parse(r.normalized)).toEqual(r.value);
    }
  });

  it("accepts nested schemas with $defs", () => {
    const raw = `{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": { "items": { "type": "array", "items": { "type": "string" } } }
    }`;
    const r = parseJsonSchemaText(raw);
    expect(r.ok).toBe(true);
  });

  it("rejects oversized input", () => {
    const huge = `{"x":"${"a".repeat(JSON_SCHEMA_MAX_CHARS)}"}`;
    const r = parseJsonSchemaText(huge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("too_large");
  });
});

describe("isActiveJsonSchema", () => {
  it("is false for null/empty/invalid", () => {
    expect(isActiveJsonSchema(null)).toBe(false);
    expect(isActiveJsonSchema(undefined)).toBe(false);
    expect(isActiveJsonSchema("")).toBe(false);
    expect(isActiveJsonSchema("not-json")).toBe(false);
  });

  it("is true for valid object schema", () => {
    expect(isActiveJsonSchema('{"type":"object"}')).toBe(true);
  });
});

describe("extractStructuredJson", () => {
  it("pretty-prints whole-message JSON objects", () => {
    const out = extractStructuredJson('{"a":1,"b":[true]}');
    expect(out).toBe('{\n  "a": 1,\n  "b": [\n    true\n  ]\n}');
  });

  it("extracts fenced json blocks", () => {
    const out = extractStructuredJson(
      'Here you go:\n```json\n{"ok": true}\n```\nThanks.',
    );
    expect(out).toBe('{\n  "ok": true\n}');
  });

  it("extracts balanced object from prose", () => {
    const out = extractStructuredJson('Result: {"x": 1} end');
    expect(out).toBe('{\n  "x": 1\n}');
  });

  it("returns null for non-JSON assistant text", () => {
    expect(extractStructuredJson("Just a normal reply.")).toBeNull();
    expect(extractStructuredJson("")).toBeNull();
  });

  it("rejects primitive JSON roots", () => {
    expect(extractStructuredJson("42")).toBeNull();
    expect(extractStructuredJson('"hi"')).toBeNull();
  });
});

describe("wrapAgentTextWithJsonSchema", () => {
  it("prefixes user body with experimental instruction + schema", () => {
    const schema = '{\n  "type": "object"\n}';
    const out = wrapAgentTextWithJsonSchema("List names", schema);
    expect(out).toContain("[Structured output — experimental]");
    expect(out).toContain('"type": "object"');
    expect(out.endsWith("List names")).toBe(true);
  });

  it("works with empty body", () => {
    const out = wrapAgentTextWithJsonSchema("", '{"type":"object"}');
    expect(out).toContain("[Structured output — experimental]");
    expect(out).toContain('{"type":"object"}');
  });

  it("is a no-op when schema empty", () => {
    expect(wrapAgentTextWithJsonSchema("hi", "  ")).toBe("hi");
  });
});
