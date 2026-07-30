/**
 * Session-level plugin directories — pure spawn-arg helpers.
 *
 * CLI: `grok agent --plugin-dir <DIR> … stdio` (repeatable).
 * Highest-priority plugin scope for that process only; always trusted.
 * Independent of global Extensions / `grok plugin install`.
 */

/** Normalize raw session meta paths: trim, drop empties, dedupe (first wins). */
export function normalizePluginDirs(
  dirs: readonly string[] | null | undefined,
): string[] {
  if (!dirs?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of dirs) {
    const d = (raw ?? "").trim();
    if (!d) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

/**
 * Agent-option CLI args for session plugin dirs (before `stdio`):
 * `["--plugin-dir", path, …]`. Empty when none.
 */
export function pluginDirSpawnArgs(
  dirs: readonly string[] | null | undefined,
): string[] {
  const paths = normalizePluginDirs(dirs);
  const args: string[] = [];
  for (const p of paths) {
    args.push("--plugin-dir", p);
  }
  return args;
}

/** Append a folder path onto existing session plugin dirs (deduped). */
export function appendPluginDir(
  current: readonly string[] | null | undefined,
  nextPath: string | null | undefined,
): string[] {
  const base = normalizePluginDirs(current);
  const d = (nextPath ?? "").trim();
  if (!d) return base;
  if (base.includes(d)) return base;
  return [...base, d];
}
