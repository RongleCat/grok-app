/**
 * Tool presentation meta — DSH-inspired presenter/card split.
 *
 * `presentToolCall` is a pure view-model derivation from recorded call fields
 * (kind/title/input/path/detail). An explicit `meta` from the Host (future
 * `tool/result.meta`) always wins via `resolveToolPresentation`; otherwise we
 * derive so replayed journals still get a typed card instead of bare generic.
 *
 * No I/O, no session reads, no clock — safe for live stream + log replay.
 */

import {
  classifyToolKind,
  toolInputDisplay,
  toolPathBase,
  type ToolDisplayKind,
} from "./toolDisplay";

/** Typed card the Web UI should paint for a tool call. */
export type ToolPresentationCard =
  | "terminal"
  | "diff"
  | "read"
  | "search"
  | "web"
  | "generic";

/**
 * Bounded structured facts for the card. Only plain JSON — never React props,
 * selection state, or raw stdout bodies (those stay in `output`/`detail`).
 */
export interface ToolPresentationMeta {
  card: ToolPresentationCard;
  /** Search/browse query (target file / command / url already in input/path). */
  query?: string;
  /** Parsed `N results` count from detail when present. */
  resultCount?: number;
  /** Host domains mentioned in detail (max 3, for favicon chips). */
  resultDomains?: string[];
  /** File/dir base name when the tool acted on a path. */
  pathBase?: string;
  /** Machine tool name that produced this card (e.g. enter_plan_mode). */
  toolKind?: string;
}

export interface ToolPresentationSource {
  toolCallId?: string | null;
  toolKind?: string | null;
  title?: string | null;
  input?: string | null;
  path?: string | null;
  detail?: string | null;
}

function extractQuery(
  source: ToolPresentationSource,
  bucket: ToolDisplayKind,
): string | undefined {
  if (bucket !== "search" && bucket !== "browse") return undefined;
  const fromInput = (source.input || "").trim();
  if (fromInput) {
    // Input may be a full URL for browse — keep it clipped, UI shortens host.
    return fromInput.length > 120 ? `${fromInput.slice(0, 119)}…` : fromInput;
  }
  // Browse prefers an explicit URL in path/detail over a generic title like
  // "Fetch" (ACP `Fetch: https://…` titles aside — those carry the URL).
  if (bucket === "browse") {
    const pathUrl = (source.path || "").trim();
    if (pathUrl) return pathUrl.slice(0, 120);
    const titleFetch = (source.title || "").match(
      /^fetch:\s*(https?:\/\/\S+)/i,
    );
    if (titleFetch?.[1]?.trim()) return titleFetch[1].trim().slice(0, 120);
  }
  const title = (source.title || "").trim();
  const m = title.match(/^(?:web\s*search|search|x\s*search)\s*[:：]\s*(.+)$/i);
  if (m?.[1]?.trim()) return m[1].trim().slice(0, 120);
  if (
    title &&
    !/^tool$/i.test(title) &&
    !/^web\s*search:?$/i.test(title) &&
    !/^search$/i.test(title) &&
    // Generic browse placeholders must not become the query/URL.
    !/^(fetch|browse|open(\s+page|\s+url)?|web\s*fetch)$/i.test(title)
  ) {
    return title.slice(0, 120);
  }
  const detail = (source.detail || "").trim();
  if (detail) {
    for (const line of detail.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      if (/^https?:\/\//i.test(t)) continue;
      if (/^\d+\s*results?/i.test(t)) continue;
      return t.slice(0, 120);
    }
  }
  return undefined;
}

function extractResultCount(detail: string | null | undefined): number | undefined {
  const blob = `${detail || ""}`;
  const m = blob.match(/(\d+)\s*results?/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function extractResultDomains(
  detail: string | null | undefined,
  max = 3,
): string[] | undefined {
  const blob = detail || "";
  if (!blob) return undefined;
  const found: string[] = [];
  const re = /https?:\/\/([^/\s)\]"'<>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blob)) && found.length < max) {
    const host = m[1]!.toLowerCase().replace(/^www\./, "");
    if (host && !found.includes(host)) found.push(host);
  }
  return found.length ? found : undefined;
}

export function toolCardForBucket(bucket: ToolDisplayKind): ToolPresentationCard {
  switch (bucket) {
    case "bash":
      return "terminal";
    case "edit":
      return "diff";
    case "read":
      return "read";
    case "search":
      return "search";
    case "browse":
      return "web";
    default:
      return "generic";
  }
}

export function toolBucketForCard(card: ToolPresentationCard): ToolDisplayKind {
  switch (card) {
    case "terminal":
      return "bash";
    case "diff":
      return "edit";
    case "read":
      return "read";
    case "search":
      return "search";
    case "web":
      return "browse";
    default:
      return "fallback";
  }
}

/**
 * Pure derivation: recorded call fields → typed card + bounded facts.
 * Never throws; unknown tools fall back to `generic` (DSH GenericToolCard).
 */
export function presentToolCall(
  source: ToolPresentationSource,
): ToolPresentationMeta {
  const bucket = classifyToolKind(
    source.toolKind,
    source.title,
    source.toolCallId,
  );
  const card = toolCardForBucket(bucket);
  const meta: ToolPresentationMeta = { card };
  const kind = (source.toolKind || "").trim();
  if (kind) meta.toolKind = kind;
  const query = extractQuery(source, bucket);
  if (query) meta.query = query;
  // Search/web cards benefit from parsed counts/domains without re-scanning
  // strings at paint time (log replay + live share one path).
  if (card === "search" || card === "web") {
    const count = extractResultCount(source.detail);
    if (count != null) meta.resultCount = count;
    const domains = extractResultDomains(source.detail);
    if (domains) meta.resultDomains = domains;
  }
  // Keep the specific call detail alongside the card for the one-line label:
  // prefer input-derived basename, fall back to path basename.
  const specific = toolInputDisplay(source.input, bucket);
  const base = toolPathBase(source.path);
  const label = specific || base;
  if (label && card !== "search" && card !== "web") {
    // Path-ish cards surface basename; terminal keeps full snippet in input.
    if (card === "read" || card === "diff") meta.pathBase = label;
    else if (card === "terminal" && source.input?.trim()) {
      // Terminal card title already shows the command via input display.
    } else if (card === "generic" && label) {
      meta.pathBase = label;
    }
  } else if (base && (card === "read" || card === "diff")) {
    meta.pathBase = base;
  }
  return meta;
}

/**
 * Resolve the card to paint: explicit Host meta wins (validated shape only),
 * otherwise derive. Never throws; malformed explicit meta falls back to
 * derivation (then generic) — the transcript must never break on old logs.
 */
export function resolveToolPresentation(
  source: ToolPresentationSource,
  explicit?: ToolPresentationMeta | null,
): ToolPresentationMeta {
  if (explicit && typeof explicit === "object") {
    const card = explicit.card;
    if (
      card === "terminal" ||
      card === "diff" ||
      card === "read" ||
      card === "search" ||
      card === "web" ||
      card === "generic"
    ) {
      const out: ToolPresentationMeta = { card };
      if (typeof explicit.query === "string" && explicit.query.trim()) {
        out.query = explicit.query.slice(0, 120);
      }
      if (
        typeof explicit.resultCount === "number" &&
        Number.isFinite(explicit.resultCount) &&
        explicit.resultCount >= 0
      ) {
        out.resultCount = Math.floor(explicit.resultCount);
      }
      if (Array.isArray(explicit.resultDomains)) {
        const domains = explicit.resultDomains
          .filter((d): d is string => typeof d === "string" && !!d.trim())
          .map((d) => d.trim().slice(0, 64))
          .slice(0, 3);
        if (domains.length) out.resultDomains = domains;
      }
      if (typeof explicit.pathBase === "string" && explicit.pathBase.trim()) {
        out.pathBase = explicit.pathBase.slice(0, 64);
      }
      if (typeof explicit.toolKind === "string" && explicit.toolKind.trim()) {
        out.toolKind = explicit.toolKind.slice(0, 64);
      } else if ((source.toolKind || "").trim()) {
        out.toolKind = source.toolKind!.trim().slice(0, 64);
      }
      // Explicit card without query still benefits from derived query/counts.
      if (!out.query || out.resultCount == null || !out.resultDomains) {
        const derived = presentToolCall(source);
        return {
          ...derived,
          ...out,
          query: out.query ?? derived.query,
          resultCount: out.resultCount ?? derived.resultCount,
          resultDomains: out.resultDomains ?? derived.resultDomains,
          pathBase: out.pathBase ?? derived.pathBase,
        };
      }
      return out;
    }
  }
  return presentToolCall(source);
}
