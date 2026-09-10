/**
 * About-page version label.
 *
 * Packaging still uses package.json / tauri semver (NSIS name, updater).
 * This string is independent: an exact `vX.Y.Z` tag shows that tag; any
 * other commit shows the short git hash so an install-latest / main build
 * is not mistaken for the last GitHub Release.
 */

const RELEASE_TAG_RE = /^v\d+\.\d+\.\d+$/;
const GIT_SHA_RE = /^[0-9a-f]{7,40}$/i;

export type AppDisplayVersionInput = {
  /** Tags pointing at HEAD (`git tag --points-at HEAD`). */
  tagsAtHead?: readonly string[] | null;
  shortSha?: string | null;
  packageVersion?: string | null;
  /** `GITHUB_REF`, e.g. `refs/tags/v0.2.33` (CI tag builds often lack local tags). */
  githubRef?: string | null;
  githubRefType?: string | null;
  githubRefName?: string | null;
  /** Explicit override (`GROK_DISPLAY_VERSION`). */
  displayOverride?: string | null;
};

export function resolveAppDisplayVersion(
  input: AppDisplayVersionInput = {},
): string {
  const override = (input.displayOverride ?? "").trim();
  if (override) return override;

  const pkg = (input.packageVersion ?? "").trim().replace(/^v/i, "");
  const pkgTag = pkg ? `v${pkg}` : "";
  const releaseTags = (input.tagsAtHead ?? [])
    .map((t) => t.trim())
    .filter((t) => RELEASE_TAG_RE.test(t));
  const exact = releaseTags.find((t) => t === pkgTag) ?? releaseTags[0];
  if (exact) return exact;

  const ref = (input.githubRef ?? "").trim();
  const fromRef = ref.startsWith("refs/tags/")
    ? ref.slice("refs/tags/".length)
    : "";
  if (RELEASE_TAG_RE.test(fromRef)) return fromRef;
  if ((input.githubRefType ?? "").trim() === "tag") {
    const name = (input.githubRefName ?? "").trim();
    if (RELEASE_TAG_RE.test(name)) return name;
  }

  const sha = (input.shortSha ?? "").trim();
  if (GIT_SHA_RE.test(sha)) return sha;

  return pkgTag;
}

export function appDisplayVersion(): string {
  const baked = import.meta.env.VITE_GROK_DISPLAY_VERSION;
  return typeof baked === "string" ? baked.trim() : "";
}
