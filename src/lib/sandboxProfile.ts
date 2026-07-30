/**
 * OS-level sandbox profile for spawned agents (`grok --sandbox` / GROK_SANDBOX).
 *
 * Values align with Host `SandboxSpawnSpec` / settings.sandboxProfile:
 * off | workspace | read-only | strict | devbox
 */

export const SANDBOX_PROFILES = [
  "off",
  "workspace",
  "read-only",
  "strict",
  "devbox",
] as const;

export type SandboxProfileId = (typeof SANDBOX_PROFILES)[number];

export const DEFAULT_SANDBOX_PROFILE: SandboxProfileId = "off";

/** Profiles that disable isolation or use a relaxed disposable layout. */
export const DANGEROUS_SANDBOX_PROFILES: readonly SandboxProfileId[] = [
  "off",
  "devbox",
] as const;

const KNOWN = new Set<string>(SANDBOX_PROFILES);

/** Values that clear a project override (inherit app default). */
const INHERIT_TOKENS = new Set([
  "",
  "inherit",
  "app_default",
  "app-default",
  "default",
  "none",
]);

/**
 * Normalize a raw settings / project value to a known profile id.
 * Empty, inherit tokens, and unknown strings → `null` (caller chooses default).
 */
export function normalizeSandboxProfile(raw: unknown): SandboxProfileId | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (!t || INHERIT_TOKENS.has(t)) return null;
  if (KNOWN.has(t)) return t as SandboxProfileId;
  return null;
}

/**
 * Effective sandbox profile for spawn:
 * project override (when set + valid) wins over the global settings value.
 * Invalid / missing global falls back to {@link DEFAULT_SANDBOX_PROFILE}.
 */
export function resolveSandboxProfile(
  global: unknown,
  projectOverride?: unknown | null,
): SandboxProfileId {
  const fromProject = normalizeSandboxProfile(projectOverride);
  if (fromProject) return fromProject;
  return normalizeSandboxProfile(global) ?? DEFAULT_SANDBOX_PROFILE;
}

/** True when switching to this profile warrants a danger confirm. */
export function isDangerousSandboxProfile(profile: unknown): boolean {
  const id = normalizeSandboxProfile(profile);
  return id != null && (DANGEROUS_SANDBOX_PROFILES as readonly string[]).includes(id);
}
