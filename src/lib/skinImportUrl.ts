/**
 * Parse `grok://skin/import` / `grok-app://skin/import` (and `grok:skin/import`).
 * Shared fixtures: `skinImportUrl.fixtures.json`.
 */

import { OFFICIAL_SKIN_CATALOG_URL } from "./skinCatalog";
import type { SkinPackErrorCode } from "./skinPack";

export const SKIN_IMPORT_URI_MAX = 2048;
const OFFICIAL_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

export type SkinImportParsed =
  | { ok: true; kind: "url"; href: string }
  | { ok: true; kind: "official"; id: string }
  | { ok: false; code: SkinPackErrorCode | "invalid_url"; reason: string };

function percentDecodeOnce(raw: string): string | null {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === "%") {
      const hex = raw.slice(i + 1, i + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) return null;
      const n = Number.parseInt(hex, 16);
      out += String.fromCharCode(n);
      i += 2;
    } else {
      out += ch;
    }
  }
  return out;
}

function hasC0OrNul(s: string): boolean {
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function parseQuery(qs: string): Map<string, string> | { error: string } {
  const map = new Map<string, string>();
  if (!qs) return map;
  for (const part of qs.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const rawK = eq >= 0 ? part.slice(0, eq) : part;
    const rawV = eq >= 0 ? part.slice(eq + 1) : "";
    const k = percentDecodeOnce(rawK);
    const v = percentDecodeOnce(rawV);
    if (k == null || v == null) return { error: "bad_percent" };
    if (hasC0OrNul(k) || hasC0OrNul(v)) return { error: "control" };
    if (map.has(k)) return { error: "duplicate" };
    map.set(k, v);
  }
  return map;
}

function isPrivateOrBlockedHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "metadata.google.internal") return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map((x) => Number(x));
    if ([a, b, c, d].some((n) => n > 255)) return true;
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    return false;
  }
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  // IPv4-mapped
  const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mapped) return isPrivateOrBlockedHost(mapped[1]!);
  return false;
}

export function validateHttpsPackUrl(href: string): SkinImportParsed {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return { ok: false, code: "url_blocked", reason: "not_url" };
  }
  if (u.protocol !== "https:") {
    return { ok: false, code: "url_blocked", reason: "not_https" };
  }
  if (u.username || u.password) {
    return { ok: false, code: "url_blocked", reason: "userinfo" };
  }
  if (!u.pathname || u.pathname === "/") {
    return { ok: false, code: "url_blocked", reason: "empty_path" };
  }
  if (isPrivateOrBlockedHost(u.hostname)) {
    return { ok: false, code: "url_blocked", reason: "blocked_host" };
  }
  return { ok: true, kind: "url", href: u.toString() };
}

/**
 * Parse a grok / grok-app skin import URI.
 * Does not fetch. `repo=official` is accepted here; empty official URL
 * is resolved by {@link resolveOfficialSkinImport}.
 */
export function parseSkinImportUri(raw: string): SkinImportParsed {
  if (typeof raw !== "string") {
    return { ok: false, code: "invalid_url", reason: "not_string" };
  }
  if (raw.length > SKIN_IMPORT_URI_MAX) {
    return { ok: false, code: "invalid_url", reason: "too_long" };
  }
  const noFrag = raw.split("#")[0] ?? raw;
  const colon = noFrag.indexOf(":");
  if (colon <= 0) return { ok: false, code: "invalid_url", reason: "no_scheme" };
  const scheme = noFrag.slice(0, colon).toLowerCase();
  if (scheme !== "grok" && scheme !== "grok-app") {
    return { ok: false, code: "invalid_url", reason: "scheme" };
  }
  let rest = noFrag.slice(colon + 1);
  if (rest.includes("@") && rest.startsWith("//")) {
    const slashAfterAuth = rest.indexOf("/", 2);
    const authority = slashAfterAuth >= 0 ? rest.slice(2, slashAfterAuth) : rest.slice(2);
    if (authority.includes("@")) {
      return { ok: false, code: "invalid_url", reason: "userinfo" };
    }
  }
  if (rest.startsWith("//")) rest = rest.slice(2);
  const q = rest.indexOf("?");
  const pathPart = (q >= 0 ? rest.slice(0, q) : rest).replace(/\/+$/, "");
  const query = q >= 0 ? rest.slice(q + 1) : "";
  if (pathPart.toLowerCase() !== "skin/import") {
    return { ok: false, code: "invalid_url", reason: "path" };
  }
  const parsed = parseQuery(query);
  if ("error" in parsed) {
    return { ok: false, code: "invalid_url", reason: parsed.error };
  }
  for (const k of parsed.keys()) {
    if (k !== "url" && k !== "repo" && k !== "id") {
      return { ok: false, code: "invalid_url", reason: "unknown_query" };
    }
  }
  const url = parsed.get("url");
  const repo = parsed.get("repo");
  const id = parsed.get("id");
  if (url != null && repo != null) {
    return { ok: false, code: "invalid_url", reason: "url_and_repo" };
  }
  if (url != null) {
    return validateHttpsPackUrl(url);
  }
  if (repo != null) {
    if (repo !== "official") {
      return { ok: false, code: "invalid_url", reason: "repo" };
    }
    if (!id || !OFFICIAL_ID_RE.test(id)) {
      return { ok: false, code: "invalid_url", reason: "id" };
    }
    return { ok: true, kind: "official", id };
  }
  return { ok: false, code: "invalid_url", reason: "missing_query" };
}

export function resolveOfficialSkinImport(id: string): SkinImportParsed {
  if (!OFFICIAL_SKIN_CATALOG_URL.trim()) {
    return { ok: false, code: "official_unconfigured", reason: "empty_official_url" };
  }
  if (!OFFICIAL_ID_RE.test(id)) {
    return { ok: false, code: "invalid_url", reason: "id" };
  }
  return { ok: true, kind: "official", id };
}

export function resolveSkinImport(raw: string): SkinImportParsed {
  const parsed = parseSkinImportUri(raw);
  if (!parsed.ok) return parsed;
  if (parsed.kind === "official") return resolveOfficialSkinImport(parsed.id);
  return parsed;
}
