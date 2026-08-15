import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseSkinImportUri,
  resolveOfficialSkinImport,
  resolveSkinImport,
} from "./skinImportUrl";
import { OFFICIAL_SKIN_CATALOG_URL } from "./skinCatalog";

type Case = {
  name: string;
  input: string;
  padTo?: number;
  ok: boolean;
  kind?: string;
  href?: string;
  hrefContains?: string;
  id?: string;
  reason?: string;
  code?: string;
};

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(here, "skinImportUrl.fixtures.json"), "utf8"),
) as { cases: Case[] };

function materialize(c: Case): string {
  if (!c.padTo) return c.input;
  if (c.input.length >= c.padTo) {
    return c.input.slice(0, c.padTo);
  }
  const extra = c.padTo - c.input.length;
  return `${c.input}#${"x".repeat(extra - 1)}`;
}

describe("parseSkinImportUri fixtures", () => {
  for (const c of fixtures.cases) {
    it(c.name, () => {
      const input = materialize(c);
      const r = parseSkinImportUri(input);
      expect(r.ok).toBe(c.ok);
      if (c.ok && r.ok) {
        expect(r.kind).toBe(c.kind);
        if (c.kind === "url" && r.kind === "url") {
          if (c.href) expect(r.href).toBe(c.href);
          if (c.hrefContains) expect(r.href).toContain(c.hrefContains);
        }
        if (c.kind === "official" && r.kind === "official" && c.id) {
          expect(r.id).toBe(c.id);
        }
      } else if (!c.ok && !r.ok) {
        if (c.reason) expect(r.reason).toBe(c.reason);
        if (c.code) expect(r.code).toBe(c.code);
      }
    });
  }
});

describe("resolveOfficialSkinImport", () => {
  it("returns official_unconfigured while official URL is empty", () => {
    expect(OFFICIAL_SKIN_CATALOG_URL).toBe("");
    const r = resolveOfficialSkinImport("harbor-dusk");
    expect(r).toEqual({
      ok: false,
      code: "official_unconfigured",
      reason: "empty_official_url",
    });
    const via = resolveSkinImport("grok://skin/import?repo=official&id=harbor-dusk");
    expect(via.ok).toBe(false);
    if (!via.ok) expect(via.code).toBe("official_unconfigured");
  });
});
