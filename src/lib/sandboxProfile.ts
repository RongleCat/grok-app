/**
 * OS-level sandbox profile for spawned agents (`grok --sandbox` / GROK_SANDBOX).
 *
 * Values align with Host `SandboxSpawnSpec` / settings.sandboxProfile and the
 * Grok Build built-in profiles:
 *   off | workspace | read-only | strict | devbox
 *
 * Kernel enforcement is Linux Landlock / macOS Seatbelt. On unsupported
 * platforms (e.g. Windows) the CLI soft-fails (warns and continues without
 * enforcement). Older CLIs without `--sandbox` must omit the flag to avoid
 * clap crash (AGENT_CRASHED).
 */

import type { MessageKey } from "@/i18n";

export const SANDBOX_PROFILES = [
  "off",
  "workspace",
  "read-only",
  "strict",
  "devbox",
] as const;

export type SandboxProfileId = (typeof SANDBOX_PROFILES)[number];

/**
 * New-install / missing-field default. Matches the everyday CLI recommendation
 * (`workspace`) so first-run agents are isolated under the project tree.
 * Existing settings.json that already stored `"off"` keep that value.
 *
 * Product honesty: App default is **stricter** than CLI default (`off`).
 * See {@link CLI_DEFAULT_SANDBOX_PROFILE} and Settings product-default note.
 */
export const DEFAULT_SANDBOX_PROFILE: SandboxProfileId = "workspace";

/**
 * Grok Build CLI default when no `--sandbox` / `GROK_SANDBOX` is set
 * (unrestricted). App intentionally defaults to {@link DEFAULT_SANDBOX_PROFILE}.
 */
export const CLI_DEFAULT_SANDBOX_PROFILE: SandboxProfileId = "off";

/** Everyday coding recommendation (CLI docs) — same as App default. */
export const RECOMMENDED_SANDBOX_PROFILE: SandboxProfileId = "workspace";

/** Profiles that disable isolation or use a relaxed disposable layout. */
export const DANGEROUS_SANDBOX_PROFILES: readonly SandboxProfileId[] = [
  "off",
  "devbox",
] as const;

/** Profiles that request child-process network block (Linux only; macOS no-op). */
export const NETWORK_RESTRICT_SANDBOX_PROFILES: readonly SandboxProfileId[] = [
  "read-only",
  "strict",
] as const;

/** Top-level CLI flag (before `agent`). */
export const SANDBOX_CLI_FLAG = "--sandbox";

/** Process env the CLI also reads. */
export const SANDBOX_ENV = "GROK_SANDBOX";

/**
 * First App-aligned floor where `--sandbox` / `GROK_SANDBOX` is expected.
 * Matches the host min CLI generation (0.2.112) so known-older binaries
 * soft-fail (omit flag) instead of clap-rejecting.
 */
export const SANDBOX_MIN_CLI = "0.2.112";

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

/** i18n label keys for each built-in profile. */
export const SANDBOX_PROFILE_LABEL_KEYS: Record<SandboxProfileId, MessageKey> = {
  off: "settings.sandbox.off",
  workspace: "settings.sandbox.workspace",
  "read-only": "settings.sandbox.readOnly",
  strict: "settings.sandbox.strict",
  devbox: "settings.sandbox.devbox",
};

/** i18n help keys for each built-in profile. */
export const SANDBOX_PROFILE_HELP_KEYS: Record<SandboxProfileId, MessageKey> = {
  off: "settings.sandbox.off.help",
  workspace: "settings.sandbox.workspace.help",
  "read-only": "settings.sandbox.readOnly.help",
  strict: "settings.sandbox.strict.help",
  devbox: "settings.sandbox.devbox.help",
};

/**
 * Soft-fail / honesty reasons for Settings banners.
 * `null` = no hard soft-fail (isolation may apply; still show product notes).
 *
 * Priority for {@link sandboxSoftFailKind}:
 * cli_missing → cli_unsupported → platform_soft → null
 * (disabled/off is not a soft-fail kind — use {@link sandboxDisabledSoftNoteKey}).
 */
export type SandboxSoftFailKind =
  | "cli_missing"
  | "cli_unsupported"
  | "platform_soft";

export type SandboxSoftFailInput = {
  /** Effective profile (global or project-resolved). */
  profile?: unknown;
  /** Whether the Grok Build CLI binary was found. */
  cliFound?: boolean | null;
  /** Raw `grok --version` banner (or null when unknown). */
  cliVersion?: string | null;
  /**
   * App platform token (`mac` | `win` | `linux` | `other`).
   * When omitted, platform soft-fail is not reported.
   */
  platform?: string | null;
};

/**
 * Product-path honesty notes (always-on / contextual).
 * Separate from soft-fail kinds so disabled and Linux userns stay informative.
 */
export type SandboxProductNoteKind =
  | "app_default"
  | "disabled"
  | "linux_userns"
  | "leader_mutex";

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

/** True when value is a known profile id (after trim/lower). */
export function isSandboxProfileId(value: unknown): value is SandboxProfileId {
  return normalizeSandboxProfile(value) != null;
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

/**
 * True when isolation is requested after resolve.
 * Unknown / empty / inherit → {@link DEFAULT_SANDBOX_PROFILE} (workspace → true).
 * Explicit `"off"` → false.
 */
export function sandboxIsolationActive(profile: unknown): boolean {
  return resolveSandboxProfile(profile, null) !== "off";
}

/** Alias: non-`off` effective profile. */
export function isSandboxIsolationRequested(profile: unknown): boolean {
  return sandboxIsolationActive(profile);
}

/** Label i18n key for a profile (falls back to off). */
export function sandboxProfileLabelKey(profile: unknown): MessageKey {
  const id = normalizeSandboxProfile(profile) ?? DEFAULT_SANDBOX_PROFILE;
  return SANDBOX_PROFILE_LABEL_KEYS[id];
}

/** Help i18n key for a profile (falls back to off). */
export function sandboxProfileHelpKey(profile: unknown): MessageKey {
  const id = normalizeSandboxProfile(profile) ?? DEFAULT_SANDBOX_PROFILE;
  return SANDBOX_PROFILE_HELP_KEYS[id];
}

/**
 * Danger-confirm body key when switching to a dangerous profile.
 * `null` when no confirm is needed.
 */
export function sandboxDangerConfirmKey(profile: unknown): MessageKey | null {
  const id = normalizeSandboxProfile(profile);
  if (id === "off") return "settings.sandbox.dangerConfirmOff";
  if (id === "devbox") return "settings.sandbox.dangerConfirmDevbox";
  return null;
}

/** Select options for Settings / project menus (stable order). */
export function sandboxProfileSelectOptions(): Array<{
  value: SandboxProfileId;
  labelKey: MessageKey;
}> {
  return SANDBOX_PROFILES.map((value) => ({
    value,
    labelKey: SANDBOX_PROFILE_LABEL_KEYS[value],
  }));
}

/**
 * Top-level CLI argv for sandbox: `["--sandbox", "<profile>"]`.
 * Empty when off / invalid (CLI default = unrestricted).
 */
export function sandboxSpawnArgs(profile: unknown): string[] {
  const id = normalizeSandboxProfile(profile);
  if (!id || id === "off") return [];
  return [SANDBOX_CLI_FLAG, id];
}

/**
 * Env pairs for the agent process.
 * Empty when off / invalid so nested tools inherit CLI default.
 */
export function sandboxSpawnEnv(profile: unknown): Array<[string, string]> {
  const id = normalizeSandboxProfile(profile);
  if (!id || id === "off") return [];
  return [[SANDBOX_ENV, id]];
}

/**
 * Combined spawn plan mirroring Host `sandbox_spawn_flags`.
 * `null` when no flags/env should be applied (off / invalid).
 */
export function sandboxSpawnFlags(
  profile: unknown,
): { args: string[]; env: [string, string] } | null {
  const args = sandboxSpawnArgs(profile);
  if (args.length === 0) return null;
  const env = sandboxSpawnEnv(profile);
  if (env.length === 0) return null;
  return { args, env: env[0]! };
}

/**
 * Pure: does a CLI version string look new enough for `--sandbox`?
 * - Known ≥ {@link SANDBOX_MIN_CLI} → true
 * - Known older → false
 * - Unparseable / missing → null (caller soft-fails non-default flags)
 */
export function cliSupportsSandbox(
  rawVersion: string | null | undefined,
): boolean | null {
  if (rawVersion == null) return null;
  const m = String(rawVersion)
    .trim()
    .match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3] ?? "0");
  if (![major, minor, patch].every(Number.isFinite)) return null;
  const [rm, rn, rp] = SANDBOX_MIN_CLI.split(".").map(Number) as [
    number,
    number,
    number,
  ];
  if (major > rm) return true;
  if (major < rm) return false;
  if (minor > rn) return true;
  if (minor < rn) return false;
  return patch >= rp;
}

/**
 * Soft-fail gate for CLI args:
 * - off / invalid → empty
 * - Known older → omit (avoid clap crash)
 * - Known ≥ min / unknown → emit (forward-compatible)
 */
export function sandboxSpawnArgsSoft(
  profile: unknown,
  rawCliVersion: string | null | undefined,
): string[] {
  const args = sandboxSpawnArgs(profile);
  if (args.length === 0) return args;
  if (cliSupportsSandbox(rawCliVersion) === false) return [];
  return args;
}

/**
 * Soft-fail gate for env:
 * Same policy as {@link sandboxSpawnArgsSoft}.
 */
export function sandboxSpawnEnvSoft(
  profile: unknown,
  rawCliVersion: string | null | undefined,
): Array<[string, string]> {
  const env = sandboxSpawnEnv(profile);
  if (env.length === 0) return env;
  if (cliSupportsSandbox(rawCliVersion) === false) return [];
  return env;
}

/**
 * Combined soft-fail spawn plan.
 * `null` when flags/env omitted (off, invalid, or unsupported CLI).
 */
export function sandboxSpawnFlagsSoft(
  profile: unknown,
  rawCliVersion: string | null | undefined,
): { args: string[]; env: [string, string] } | null {
  const args = sandboxSpawnArgsSoft(profile, rawCliVersion);
  if (args.length === 0) return null;
  const env = sandboxSpawnEnvSoft(profile, rawCliVersion);
  if (env.length === 0) return null;
  return { args, env: env[0]! };
}

/**
 * Kernel OS sandbox is documented for macOS Seatbelt + Linux Landlock.
 * Windows / other: CLI may accept the flag but soft-fails enforcement.
 */
export function platformEnforcesOsSandbox(
  platform: string | null | undefined,
): boolean {
  if (platform == null) return true; // unknown → don't invent unsupported
  const p = String(platform).trim().toLowerCase();
  return p === "mac" || p === "macos" || p === "darwin" || p === "linux";
}

/**
 * Child-network restrict is Linux-only for built-in read-only / strict.
 * macOS: no-op (honest UI note). Windows: N/A (no kernel sandbox).
 */
export function childNetworkRestrictApplies(
  profile: unknown,
  platform: string | null | undefined,
): boolean {
  const id = normalizeSandboxProfile(profile);
  if (!id || !(NETWORK_RESTRICT_SANDBOX_PROFILES as readonly string[]).includes(id)) {
    return false;
  }
  if (platform == null) return false;
  const p = String(platform).trim().toLowerCase();
  return p === "linux";
}

/**
 * Classify honest soft-fail / honesty banner for Settings.
 * Priority: cli_missing → cli_unsupported → platform_soft → null.
 * Never invents "enforced" — returns null when no banner is needed.
 */
export function sandboxSoftFailKind(
  input: SandboxSoftFailInput,
): SandboxSoftFailKind | null {
  if (!sandboxIsolationActive(input.profile)) return null;

  if (input.cliFound === false) return "cli_missing";

  const support = cliSupportsSandbox(input.cliVersion);
  if (support === false) return "cli_unsupported";
  // Unknown version: still try flags (forward-compat) — no cli_unsupported banner.
  // Missing version with cliFound true: treat as unknown (ok).

  if (
    input.platform != null &&
    !platformEnforcesOsSandbox(input.platform)
  ) {
    return "platform_soft";
  }

  return null;
}

/** i18n key for a soft-fail kind (caller must handle null). */
export function sandboxSoftFailMessageKey(kind: SandboxSoftFailKind): MessageKey {
  switch (kind) {
    case "cli_missing":
      return "settings.sandbox.softFail.cliMissing";
    case "cli_unsupported":
      return "settings.sandbox.softFail.cliUnsupported";
    case "platform_soft":
      return "settings.sandbox.softFail.platform";
  }
}

/** True when two raw profiles normalize equal (soft-respawn flip detection). */
export function sandboxProfileEqual(a: unknown, b: unknown): boolean {
  return resolveSandboxProfile(a, null) === resolveSandboxProfile(b, null);
}

/**
 * Always-on product default explanation:
 * App new-install default is {@link DEFAULT_SANDBOX_PROFILE} (`workspace`);
 * CLI bare default is {@link CLI_DEFAULT_SANDBOX_PROFILE} (`off`).
 */
export function sandboxAppDefaultNoteKey(): MessageKey {
  return "settings.sandbox.appDefaultNote";
}

/**
 * Soft honesty when isolation is intentionally **off** (empty/disabled path).
 * Not a failure — states that no OS sandbox flags will be applied.
 * `null` when isolation is requested.
 */
export function sandboxDisabledSoftNoteKey(profile: unknown): MessageKey | null {
  if (sandboxIsolationActive(profile)) return null;
  return "settings.sandbox.softFail.disabled";
}

/**
 * Linux unprivileged userns / bubblewrap honesty when isolation is requested.
 * Ubuntu 24.04+ may set `kernel.apparmor_restrict_unprivileged_userns=1` and
 * surface `SANDBOX_BLOCKED` — never invents kernel state without a host probe.
 * `null` when not Linux or isolation is off.
 */
export function sandboxLinuxUsernsNoteKey(
  platform: string | null | undefined,
  profile?: unknown,
): MessageKey | null {
  if (profile != null && !sandboxIsolationActive(profile)) return null;
  if (platform == null) return null;
  const p = String(platform).trim().toLowerCase();
  if (p !== "linux") return null;
  return "settings.sandbox.linuxUserns";
}

/**
 * CLI refuses shared leader when a non-`off` sandbox profile is requested
 * (tools stay in-process). Honest when both controls are on.
 */
export function sandboxLeaderMutexActive(
  profile: unknown,
  useLeader: boolean,
): boolean {
  return !!useLeader && sandboxIsolationActive(profile);
}

/** i18n key for leader ↔ sandbox mutual exclusion (caller checks active). */
export function sandboxLeaderMutexMessageKey(): MessageKey {
  return "settings.sandbox.leaderMutex";
}

/**
 * Ordered product honesty notes for Settings / Runtime surfaces.
 * Soft-fail kinds (cli/platform) stay via {@link sandboxSoftFailKind}.
 * Never invents Landlock/userns enforcement results.
 */
export function sandboxProductHonestyNotes(input: {
  profile?: unknown;
  useLeader?: boolean;
  platform?: string | null;
}): Array<{ kind: SandboxProductNoteKind; messageKey: MessageKey }> {
  const notes: Array<{ kind: SandboxProductNoteKind; messageKey: MessageKey }> =
    [];

  notes.push({
    kind: "app_default",
    messageKey: sandboxAppDefaultNoteKey(),
  });

  const disabled = sandboxDisabledSoftNoteKey(input.profile);
  if (disabled) {
    notes.push({ kind: "disabled", messageKey: disabled });
  }

  const userns = sandboxLinuxUsernsNoteKey(input.platform, input.profile);
  if (userns) {
    notes.push({ kind: "linux_userns", messageKey: userns });
  }

  if (sandboxLeaderMutexActive(input.profile, !!input.useLeader)) {
    notes.push({
      kind: "leader_mutex",
      messageKey: sandboxLeaderMutexMessageKey(),
    });
  }

  return notes;
}
