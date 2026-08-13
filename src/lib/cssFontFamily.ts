/**
 * CSS `font-family` quoting + Nerd Font alias expansion.
 *
 * Unquoted multi-word families are parsed as separate names
 * (`JetBrainsMono Nerd Font` → `JetBrainsMono`, `Nerd`, `Font`), so WebKit
 * can match the non-patched `JetBrains Mono` and drop Powerline glyphs.
 */

/** Quote a single family so spaces stay one name. */
export function quoteCssFontFamily(name: string): string {
  const t = name.trim();
  if (!t) return "";
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    return t;
  }
  if (/[\s,]/.test(t)) return `"${t.replace(/["']/g, "")}"`;
  return t;
}

export function normalizeFontFamilyKey(name: string): string {
  return name
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Deduped, quoted CSS font-family list. */
export function joinCssFontStack(names: readonly string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const q = quoteCssFontFamily(n);
    if (!q) continue;
    const key = normalizeFontFamilyKey(q);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out.join(", ");
}

/**
 * Known Nerd Font name groups. Mono / NFM first — icons stay single-cell
 * so Starship / Powerline separators fill the glyph box.
 */
export const NERD_FONT_FAMILY_GROUPS: readonly (readonly string[])[] = [
  [
    "JetBrainsMono Nerd Font Mono",
    "JetBrainsMono NFM",
    "JetBrainsMonoNL Nerd Font Mono",
    "JetBrainsMonoNL NFM",
    "JetBrainsMono Nerd Font",
    "JetBrainsMono NF",
    "JetBrainsMonoNL Nerd Font",
    "JetBrainsMonoNL NF",
  ],
  ["MesloLGS NF", "MesloLGM Nerd Font", "MesloLGL Nerd Font"],
  ["Hack Nerd Font Mono", "Hack Nerd Font"],
  ["FiraCode Nerd Font Mono", "FiraCode Nerd Font"],
  ["Maple Mono NF CN", "Maple Mono NF"],
];

/**
 * If `custom` is a known Nerd Font shorthand, return the full group
 * (Mono faces first). Otherwise just the trimmed custom name.
 */
export function expandNerdFontAliases(custom: string): string[] {
  const key = normalizeFontFamilyKey(custom);
  if (!key) return [];
  for (const group of NERD_FONT_FAMILY_GROUPS) {
    if (group.some((n) => normalizeFontFamilyKey(n) === key)) {
      return [...group];
    }
  }
  return [custom.trim()];
}
