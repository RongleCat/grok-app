/**
 * Session data mode honesty — pure helpers for independent | shared.
 *
 * - **shared** (default): CLI home `~/.grok` (same sessions as terminal Grok Build)
 * - **independent**: App agent-home `~/.grok-app/agent-home`
 *
 * Flipping modes never silently merges histories (E04). Host recycles all
 * agents on `session_data_mode` change so reconnect does not `session/load`
 * against the previous GROK_HOME. UI translates returned message keys.
 *
 * No I/O. Paths are honest product labels (tilde form), not resolved OS paths.
 */

// ── Modes ───────────────────────────────────────────────────────────────────

export const SESSION_DATA_MODES = ["shared", "independent"] as const;
export type SessionDataMode = (typeof SESSION_DATA_MODES)[number];
export const DEFAULT_SESSION_DATA_MODE: SessionDataMode = "shared";

const MODE_SET = new Set<string>(SESSION_DATA_MODES);

/** Honest product home labels (not resolved OS paths). */
export const SESSION_DATA_MODE_HOME = {
  independent: "~/.grok-app/agent-home",
  shared: "~/.grok",
} as const;

export type SessionDataModeHomeLabel =
  (typeof SESSION_DATA_MODE_HOME)[SessionDataMode];

/** Known aliases that normalize to a SessionDataMode. */
const MODE_ALIASES: Record<string, SessionDataMode> = {
  independent: "independent",
  app: "independent",
  "agent-home": "independent",
  agent_home: "independent",
  isolated: "independent",
  private: "independent",
  shared: "shared",
  cli: "shared",
  common: "shared",
  grok: "shared",
};

export function isSessionDataMode(raw: unknown): raw is SessionDataMode {
  if (typeof raw !== "string") return false;
  return MODE_SET.has(raw.trim().toLowerCase());
}

/**
 * Normalize a settings / host value to a known session data mode.
 * Unknown / empty → {@link DEFAULT_SESSION_DATA_MODE} (`shared`).
 */
export function normalizeSessionDataMode(raw: unknown): SessionDataMode {
  if (raw == null) return DEFAULT_SESSION_DATA_MODE;
  const s = String(raw).trim().toLowerCase();
  if (!s) return DEFAULT_SESSION_DATA_MODE;
  if (MODE_SET.has(s)) return s as SessionDataMode;
  const alias = MODE_ALIASES[s];
  if (alias) return alias;
  return DEFAULT_SESSION_DATA_MODE;
}

/**
 * Custom provider routes write `config.toml` only under App agent-home.
 * Shared `~/.grok` cannot see those sections, so the host keeps independent.
 */
export function sessionDataModeLockedByCustomRoute(
  activeSource: unknown,
): boolean {
  return String(activeSource ?? "").trim().toLowerCase() === "custom";
}

/**
 * After `settings_set`, show the mode that actually landed.
 * Custom-route self-heal can persist independent even when the UI asked for shared.
 */
export function applyPersistedSessionDataMode(
  requested: unknown,
  persisted: unknown,
): SessionDataMode {
  if (persisted == null) return normalizeSessionDataMode(requested);
  if (String(persisted).trim() === "") {
    return normalizeSessionDataMode(requested);
  }
  return normalizeSessionDataMode(persisted);
}

/** Honest tilde-form home path for the mode. */
export function sessionDataModeHomeLabel(mode: unknown): SessionDataModeHomeLabel {
  const m = normalizeSessionDataMode(mode);
  return SESSION_DATA_MODE_HOME[m];
}

// ── Switch plan / risks ─────────────────────────────────────────────────────

/**
 * Concrete risk i18n keys for the confirm modal (order is display order).
 * Callers pass keys through `createT` / `tr`.
 */
export type SessionDataModeRiskKey =
  | "settings.sessionDataMode.risk.homesDiffer"
  | "settings.sessionDataMode.risk.noSilentMerge"
  | "settings.sessionDataMode.risk.recycleAgents"
  | "settings.sessionDataMode.risk.sharedWithCli"
  | "settings.sessionDataMode.risk.noConfigRewrite"
  | "settings.sessionDataMode.risk.conflictPossible"
  | "settings.sessionDataMode.risk.leaveShared";

export type SessionDataModeSwitchPlan = {
  from: SessionDataMode;
  to: SessionDataMode;
  /** True when modes differ — always confirm before flip. */
  needsConfirm: boolean;
  /** Message keys describing concrete risks (not vague). */
  risks: SessionDataModeRiskKey[];
  /**
   * Host always recycles agents on a real flip (E04).
   * False when from === to (no-op).
   */
  recycleAgents: boolean;
};

/**
 * Plan a session-data-mode switch: confirm requirement, risk keys, recycle.
 * Same-mode input → no confirm, empty risks, no recycle claim.
 */
export function planSessionDataModeSwitch(input: {
  from: unknown;
  to: unknown;
}): SessionDataModeSwitchPlan {
  const from = normalizeSessionDataMode(input.from);
  const to = normalizeSessionDataMode(input.to);
  if (from === to) {
    return {
      from,
      to,
      needsConfirm: false,
      risks: [],
      recycleAgents: false,
    };
  }

  const risks: SessionDataModeRiskKey[] = [
    "settings.sessionDataMode.risk.homesDiffer",
    "settings.sessionDataMode.risk.noSilentMerge",
    "settings.sessionDataMode.risk.recycleAgents",
  ];
  if (to === "shared") {
    risks.push(
      "settings.sessionDataMode.risk.sharedWithCli",
      "settings.sessionDataMode.risk.noConfigRewrite",
      "settings.sessionDataMode.risk.conflictPossible",
    );
  } else {
    // Leaving shared → independent: isolate from CLI home.
    risks.push("settings.sessionDataMode.risk.leaveShared");
  }

  return {
    from,
    to,
    needsConfirm: true,
    risks,
    recycleAgents: true,
  };
}

/**
 * Whether the UI/host must refuse silent mixed history across the switch.
 * Always true when modes differ (E04 — no silent merge).
 */
export function shouldBlockMixedRead(from: unknown, to: unknown): boolean {
  return (
    normalizeSessionDataMode(from) !== normalizeSessionDataMode(to)
  );
}

// ── Shared-mode banner ──────────────────────────────────────────────────────

/** Honesty keys shown while shared mode is selected. */
export type SessionDataModeBannerKey =
  | "settings.sessionDataMode.banner.sharedWithCli"
  | "settings.sessionDataMode.banner.noRewriteSecrets"
  | "settings.sessionDataMode.banner.conflictPossible";

export type SessionDataModeBanner = {
  mode: SessionDataMode;
  homeLabel: SessionDataModeHomeLabel;
  /** Stronger banner when shared is active. */
  showSharedBanner: boolean;
  /** Message keys for shared honesty lines (empty when independent). */
  keys: SessionDataModeBannerKey[];
  /** Status line key: current mode + home path. */
  statusKey: "settings.sessionDataMode.status";
};

/**
 * Resolve honesty banner for the active mode.
 * Shared → CLI share / no rewrite secrets / conflict possible.
 */
export function resolveSessionDataModeBanner(
  mode: unknown,
): SessionDataModeBanner {
  const m = normalizeSessionDataMode(mode);
  const homeLabel = sessionDataModeHomeLabel(m);
  if (m === "shared") {
    return {
      mode: m,
      homeLabel,
      showSharedBanner: true,
      keys: [
        "settings.sessionDataMode.banner.sharedWithCli",
        "settings.sessionDataMode.banner.noRewriteSecrets",
        "settings.sessionDataMode.banner.conflictPossible",
      ],
      statusKey: "settings.sessionDataMode.status",
    };
  }
  return {
    mode: m,
    homeLabel,
    showSharedBanner: false,
    keys: [],
    statusKey: "settings.sessionDataMode.status",
  };
}

// ── Confirm modal body ──────────────────────────────────────────────────────

export type SessionDataModeConfirmBody = {
  from: SessionDataMode;
  to: SessionDataMode;
  fromHome: SessionDataModeHomeLabel;
  toHome: SessionDataModeHomeLabel;
  /** Intro key with `{fromHome}` / `{toHome}` vars. */
  introKey: "settings.sessionDataMode.confirm.intro";
  riskKeys: SessionDataModeRiskKey[];
  /** Danger styling when switching into shared. */
  danger: boolean;
  /** True when a confirm dialog should be shown. */
  needsConfirm: boolean;
};

/**
 * Modal copy vars for independent ↔ shared flip (risk list, homes, danger).
 */
export function formatSessionDataModeConfirmBody(
  from: unknown,
  to: unknown,
): SessionDataModeConfirmBody {
  const plan = planSessionDataModeSwitch({ from, to });
  return {
    from: plan.from,
    to: plan.to,
    fromHome: sessionDataModeHomeLabel(plan.from),
    toHome: sessionDataModeHomeLabel(plan.to),
    introKey: "settings.sessionDataMode.confirm.intro",
    riskKeys: plan.risks,
    danger: plan.to === "shared" && plan.needsConfirm,
    needsConfirm: plan.needsConfirm,
  };
}

/**
 * Join translated intro + risk lines into a multi-line confirm message
 * (`white-space: pre-line` on `.app-dialog__msg`).
 */
export function joinSessionDataModeConfirmMessage(parts: {
  intro: string;
  riskLines: string[];
}): string {
  const intro = (parts.intro ?? "").trim();
  const lines: string[] = [];
  if (intro) lines.push(intro);
  for (const raw of parts.riskLines ?? []) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    // Avoid double bullets if caller already prefixed.
    lines.push(t.startsWith("•") || t.startsWith("-") ? t : `• ${t}`);
  }
  return lines.join("\n");
}

/**
 * Cheap status line vars for Settings / Doctor / Reliability:
 * `{modeLabel}` + `{path}` for `settings.sessionDataMode.status`.
 */
export function formatSessionDataModeStatusVars(
  mode: unknown,
  modeLabel: string,
): { modeLabel: string; path: string } {
  return {
    modeLabel: (modeLabel ?? "").trim() || normalizeSessionDataMode(mode),
    path: sessionDataModeHomeLabel(mode),
  };
}
