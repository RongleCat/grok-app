/**
 * Pure helpers for Settings → Extensions → Hooks.
 * Listing / paths only — no hook JSON editor.
 */

import { intlLocale } from "@/i18n";

export type HookScope = "user" | "project" | string;

export type HookLike = {
  name: string;
  path: string;
  scope: HookScope;
  kind: string;
  ext?: string;
  size: number;
  mtimeMs: number;
};

/** Join a hooks directory with a simple file name (no traversal). */
export function joinHooksPath(
  dir: string | null | undefined,
  name: string | null | undefined,
): string | null {
  const d = (dir ?? "").trim().replace(/[/\\]+$/, "");
  const n = (name ?? "").trim();
  if (!d || !n) return null;
  if (n === "." || n === ".." || n.includes("/") || n.includes("\\")) return null;
  if (/^[A-Za-z]:[\\/]/.test(n) || n.startsWith("/")) return null;
  const sep = d.includes("\\") && !d.includes("/") ? "\\" : "/";
  return `${d}${sep}${n}`;
}

/** Project hooks dir: `<project>/.grok/hooks`. */
export function projectHooksDir(projectPath: string | null | undefined): string | null {
  const root = (projectPath ?? "").trim().replace(/[/\\]+$/, "");
  if (!root) return null;
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root}${sep}.grok${sep}hooks`;
}

/** Human file size (B / KB / MB). */
export function formatHookSize(bytes: number | null | undefined): string {
  const n = typeof bytes === "number" && Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Compact local mtime for list rows. */
export function formatHookMtime(
  mtimeMs: number | null | undefined,
  locale?: string,
): string {
  const ms = typeof mtimeMs === "number" && mtimeMs > 0 ? mtimeMs : 0;
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString(intlLocale(locale), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

/** Badge / type label: dir, json, sh, … */
export function hookTypeLabel(hook: Pick<HookLike, "kind" | "ext">): string {
  if ((hook.kind ?? "").toLowerCase() === "dir") return "dir";
  const ext = (hook.ext ?? "").trim().toLowerCase();
  return ext || "file";
}

/** Meta line under a hook name: scope · type · size · mtime. */
export function hookMetaLine(
  hook: HookLike,
  opts?: { locale?: string; scopeLabel?: (scope: string) => string },
): string {
  const scopeRaw = (hook.scope ?? "").trim() || "user";
  const scope =
    opts?.scopeLabel?.(scopeRaw) ??
    (scopeRaw === "project" ? "project" : scopeRaw === "user" ? "user" : scopeRaw);
  const parts: string[] = [scope, hookTypeLabel(hook)];
  if ((hook.kind ?? "").toLowerCase() !== "dir") {
    parts.push(formatHookSize(hook.size));
  }
  const mt = formatHookMtime(hook.mtimeMs, opts?.locale);
  if (mt) parts.push(mt);
  return parts.join(" · ");
}

/** User hooks first, then project; name A–Z within scope. */
export function sortHooksByScopeName<T extends { name: string; scope: string; path?: string }>(
  hooks: T[],
): T[] {
  const rank = (s: string) => {
    const t = (s ?? "").trim().toLowerCase();
    if (t === "user") return 0;
    if (t === "project") return 1;
    return 2;
  };
  return [...hooks].sort((a, b) => {
    const sr = rank(a.scope) - rank(b.scope);
    if (sr !== 0) return sr;
    const nc = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (nc !== 0) return nc;
    return (a.path ?? "").localeCompare(b.path ?? "");
  });
}

/** Row key stable across refresh. */
export function hookRowKey(hook: Pick<HookLike, "scope" | "path" | "name">): string {
  return `${hook.scope}:${hook.path || hook.name}`;
}
