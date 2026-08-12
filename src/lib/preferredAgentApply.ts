/**
 * Preferred agent apply-path honesty.
 *
 * Product truth (Grok Build / Host):
 * - Runtime selection is **spawn-time only**: top-level `grok --agent NAME`
 *   via {@link agentSpawnCliArgs} / Host `preferred_agent_spawn_flags`.
 * - There is **no** mid-session ACP hot-swap for the agent definition.
 * - Host `settings_set` soft-respawns when `preferred_agent` flips and a live
 *   agent process is attached (skips mid-turn; no-op when no ACP).
 * - Idle (no live agent): next connect / next message spawn picks up the flag
 *   → `next_message`.
 * - Live agent: soft-respawn so the next message reconnects with new flags
 *   → `soft_respawn`.
 * - Invalid / sentinel values soft-fail to CLI default (omit `--agent`).
 *   Names missing from the discovered catalog still spawn (CLI may fail) —
 *   UI warns; never invents a replacement name.
 *
 * Pure helpers — no I/O. UI translates returned message keys via `t()`.
 */

import {
  agentSpawnCliArgs,
  normalizePreferredAgent,
} from "./agentsCatalog";
import { sessionHasLiveAgent } from "./modelEffortApply";

export { sessionHasLiveAgent, normalizePreferredAgent, agentSpawnCliArgs };

/** How a preferred-agent settings change takes effect. */
export type PreferredAgentApplyEffect = "next_message" | "soft_respawn";

/** Banner payload: i18n key + interpolation vars (caller runs `t()`). */
export type PreferredAgentApplyBanner = {
  messageKey: string;
  vars: Record<string, string>;
};

/**
 * Soft-fail kinds for a preferred-agent settings value.
 * `null` = honest default or a named agent (catalog miss is separate warn).
 */
export type PreferredAgentSoftFailKind =
  | null
  | "invalid_chars"
  | "missing_catalog";

/**
 * Resolve when a preferred-agent change applies.
 *
 * - Idle (no live agent): next spawn / next message → `next_message`
 * - Live agent: Host soft-respawns on settings flip → `soft_respawn`
 */
export function resolvePreferredAgentApplyEffect(input: {
  hasLiveAgent: boolean;
}): PreferredAgentApplyEffect {
  if (!input.hasLiveAgent) return "next_message";
  return "soft_respawn";
}

/** Stable i18n key for a preferred-agent apply effect (toast / inline). */
export function preferredAgentApplyMessageKey(
  effect: PreferredAgentApplyEffect,
): string {
  switch (effect) {
    case "soft_respawn":
      return "settings.preferredAgent.apply.softRespawn";
    case "next_message":
      return "settings.preferredAgent.apply.nextMessage";
  }
}

/**
 * Static dual-path note under the preferred-agent control
 * (no live-state required — covers both paths honestly).
 */
export function preferredAgentApplyNoteKey(): string {
  return "settings.preferredAgent.apply.note";
}

/**
 * Build a short honesty banner after the user changes preferred agent.
 * Never claims mid-session hot-swap.
 */
export function buildPreferredAgentApplyBanner(input: {
  effect: PreferredAgentApplyEffect;
  /** Normalized preferred name when set (omit for CLI default). */
  agentName?: string | null;
}): PreferredAgentApplyBanner {
  const vars: Record<string, string> = {};
  const name = (input.agentName ?? "").trim();
  if (name) vars.name = name;
  return {
    messageKey: preferredAgentApplyMessageKey(input.effect),
    vars,
  };
}

/**
 * Footer / settings note: live → soft_respawn key; idle → next_message key.
 * Always returns a banner (preferred agent is always spawn-scoped).
 */
export function buildPreferredAgentApplyFooter(input: {
  hasLiveAgent: boolean;
  agentName?: string | null;
}): PreferredAgentApplyBanner {
  const effect = resolvePreferredAgentApplyEffect({
    hasLiveAgent: input.hasLiveAgent,
  });
  return buildPreferredAgentApplyBanner({
    effect,
    agentName: input.agentName,
  });
}

/**
 * Soft-fail classification for a preferred-agent settings value.
 *
 * - Empty / sentinels → CLI default (omit `--agent`), no soft-fail
 * - Control chars → soft-fail `invalid_chars`, spawn omitted
 * - Named but not in catalog → soft-fail `missing_catalog`, spawn still passes name
 * - Named and in catalog (or catalog unknown) → ok
 */
export function classifyPreferredAgentSoftFail(
  raw: string | null | undefined,
  catalog?: readonly { name: string }[] | null,
): {
  kind: PreferredAgentSoftFailKind;
  /** Normalized spawn name, or null for CLI default. */
  name: string | null;
  /** True when spawn will emit `--agent NAME`. */
  willSpawn: boolean;
} {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { kind: null, name: null, willSpawn: false };
  }
  if (/[\0\r\n]/.test(trimmed)) {
    return { kind: "invalid_chars", name: null, willSpawn: false };
  }
  const name = normalizePreferredAgent(trimmed);
  if (!name) {
    return { kind: null, name: null, willSpawn: false };
  }
  const willSpawn = agentSpawnCliArgs(name) != null;
  if (catalog != null && catalog.length > 0) {
    const key = name.toLowerCase();
    const hit = catalog.find(
      (e) => (e.name ?? "").trim().toLowerCase() === key,
    );
    if (!hit) {
      return { kind: "missing_catalog", name, willSpawn };
    }
    // Prefer catalog spelling for honesty (same as resolvePreferredAgentLabel).
    const catalogName = (hit.name ?? "").trim() || name;
    return { kind: null, name: catalogName, willSpawn: true };
  }
  return { kind: null, name, willSpawn };
}

/** i18n key for a soft-fail kind (null → no banner). */
export function preferredAgentSoftFailMessageKey(
  kind: PreferredAgentSoftFailKind,
): string | null {
  switch (kind) {
    case "invalid_chars":
      return "settings.preferredAgent.apply.invalidChars";
    case "missing_catalog":
      return "settings.agentsPersonas.preferredMissing";
    case null:
      return null;
  }
}
