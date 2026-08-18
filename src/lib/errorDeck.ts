/**
 * T04 error deck — structured copy for product error classes
 * (host AgentErrorCode + App/local recoveries): problem / cause / primary / secondary.
 *
 * Labels come from i18n; action ids are stable for App handlers.
 */

import { createT, type Locale, type MessageKey } from "@/i18n";

/** What the banner / toast buttons should do. */
export type ErrorDeckActionId =
  | "reconnect"
  | "open_doctor"
  | "open_runtime"
  | "open_account"
  | "open_providers"
  | "dismiss"
  /** Open Settings runtime section and trigger a CLI upgrade (CLI_TOO_OLD). */
  | "upgrade_cli"
  /** Open Settings → Runtime → Network (proxy). */
  | "open_network"
  /** Stream-stall banner: clear the stall prompt and keep the turn running. */
  | "keep_waiting"
  /** Stream-stall banner: cancel the in-flight turn. */
  | "cancel_turn"
  /** Trust the active project (WORKSPACE_UNTRUSTED). */
  | "trust_project"
  /** Relocate a missing project folder (PROJECT_MISSING path). */
  | "relocate_project"
  /** Open the add-project picker (PROJECT_MISSING / no selection). */
  | "add_project"
  /** Settings → General → Permissions. */
  | "open_permissions"
  /** Open the MCP status / doctor modal. */
  | "open_mcp"
  /** Settings → Extensions (MCP list). */
  | "open_extensions";

/**
 * Host / product error classes (aligned with AgentErrorCode + App-side specials
 * that surface as free-form localError or turn text).
 */
export type ErrorDeckCode =
  | "CLI_NOT_FOUND"
  | "AUTH_FAILED"
  /** Official/agent path: no usable auth context (auth_kind=none / no auth context). */
  | "AUTH_NO_CONTEXT"
  /** Incorrect / invalid / missing API key (often HTTP 400 from xAI or a relay). */
  | "AUTH_API_KEY"
  /** Active custom provider route rejected credentials (re-login alone will not fix). */
  | "AUTH_CUSTOM_PROVIDER"
  | "NETWORK_PROVIDER"
  | "AGENT_CRASHED"
  | "QUOTA_EXCEEDED"
  /** Transient 429 / “slow down” — not included-usage exhaustion. */
  | "RATE_LIMITED"
  | "CONNECT_FAILED"
  | "PROCESS_LIMIT"
  | "CLI_TOO_OLD"
  /** Linux bubblewrap / unprivileged user-namespace restriction (#541). */
  | "SANDBOX_BLOCKED"
  | "TURN_TIMEOUT"
  | "AGENT_DISCONNECTED"
  | "STREAM_STALL"
  /** Active project is not trusted yet (App setLocalError trustFirst). */
  | "WORKSPACE_UNTRUSTED"
  /** Project folder missing / not selected (pathMissing, selectFirst). */
  | "PROJECT_MISSING"
  /** Tool / OS / user denied a permission (not account 401). */
  | "PERMISSION_DENIED"
  /** MCP server needs OAuth / auth handshake. */
  | "MCP_AUTH_FAILED"
  /** MCP or provider OAuth token expired / invalid_grant. */
  | "OAUTH_EXPIRED"
  | "GENERIC";

/** Optional context for refining AUTH_FAILED into a more specific deck. */
export type ErrorDeckResolveOpts = {
  timeout?: boolean;
  disconnected?: boolean;
  /** Active provider route from Host `providers_list.activeSource`. */
  activeSource?: "official" | "custom" | null;
};

export type ErrorDeckAction = {
  id: ErrorDeckActionId;
  label: string;
};

export type ErrorDeckCard = {
  code: ErrorDeckCode;
  /** Short headline (what went wrong). */
  problem: string;
  /** One-line likely cause / context. */
  cause: string;
  primary: ErrorDeckAction;
  secondary: ErrorDeckAction | null;
};

type DeckSpec = {
  problem: MessageKey;
  cause: MessageKey;
  primaryId: ErrorDeckActionId;
  primaryLabel: MessageKey;
  secondaryId?: ErrorDeckActionId;
  secondaryLabel?: MessageKey;
};

const DECK: Record<ErrorDeckCode, DeckSpec> = {
  CLI_NOT_FOUND: {
    problem: "error.deck.cli.problem",
    cause: "error.deck.cli.cause",
    primaryId: "open_doctor",
    primaryLabel: "error.action.openDoctor",
    secondaryId: "open_runtime",
    secondaryLabel: "error.action.setCliPath",
  },
  AUTH_FAILED: {
    problem: "error.deck.auth.problem",
    cause: "error.deck.auth.cause",
    primaryId: "open_account",
    primaryLabel: "error.action.openAccount",
    secondaryId: "open_providers",
    secondaryLabel: "error.action.openProviders",
  },
  AUTH_NO_CONTEXT: {
    problem: "error.deck.authNoContext.problem",
    cause: "error.deck.authNoContext.cause",
    primaryId: "open_account",
    primaryLabel: "error.action.openAccount",
    secondaryId: "reconnect",
    secondaryLabel: "error.action.reconnect",
  },
  AUTH_API_KEY: {
    problem: "error.deck.authApiKey.problem",
    cause: "error.deck.authApiKey.cause",
    primaryId: "open_providers",
    primaryLabel: "error.action.openProviders",
    secondaryId: "open_account",
    secondaryLabel: "error.action.openAccount",
  },
  AUTH_CUSTOM_PROVIDER: {
    problem: "error.deck.authCustom.problem",
    cause: "error.deck.authCustom.cause",
    primaryId: "open_providers",
    primaryLabel: "error.action.openProviders",
    secondaryId: "open_account",
    secondaryLabel: "error.action.openAccount",
  },
  NETWORK_PROVIDER: {
    problem: "error.deck.network.problem",
    cause: "error.deck.network.cause",
    primaryId: "reconnect",
    primaryLabel: "error.action.reconnect",
    secondaryId: "open_network",
    secondaryLabel: "error.action.openNetwork",
  },
  AGENT_CRASHED: {
    problem: "error.deck.crash.problem",
    cause: "error.deck.crash.cause",
    primaryId: "reconnect",
    primaryLabel: "error.action.reconnect",
    secondaryId: "open_doctor",
    secondaryLabel: "error.action.openDoctor",
  },
  QUOTA_EXCEEDED: {
    problem: "error.deck.quota.problem",
    cause: "error.deck.quota.cause",
    primaryId: "open_account",
    primaryLabel: "error.action.openAccount",
    secondaryId: "dismiss",
    secondaryLabel: "error.action.dismiss",
  },
  RATE_LIMITED: {
    problem: "error.deck.rateLimit.problem",
    cause: "error.deck.rateLimit.cause",
    primaryId: "dismiss",
    primaryLabel: "error.action.dismiss",
  },
  CONNECT_FAILED: {
    problem: "error.deck.connect.problem",
    cause: "error.deck.connect.cause",
    primaryId: "reconnect",
    primaryLabel: "error.action.reconnect",
    secondaryId: "open_doctor",
    secondaryLabel: "error.action.openDoctor",
  },
  PROCESS_LIMIT: {
    problem: "error.deck.limit.problem",
    cause: "error.deck.limit.cause",
    primaryId: "open_runtime",
    primaryLabel: "error.action.openRuntime",
    secondaryId: "dismiss",
    secondaryLabel: "error.action.dismiss",
  },
  CLI_TOO_OLD: {
    problem: "error.deck.cliTooOld.problem",
    cause: "error.deck.cliTooOld.cause",
    primaryId: "upgrade_cli",
    primaryLabel: "error.action.upgradeCli",
    secondaryId: "open_doctor",
    secondaryLabel: "error.action.openDoctor",
  },
  SANDBOX_BLOCKED: {
    problem: "error.deck.sandbox.problem",
    cause: "error.deck.sandbox.cause",
    primaryId: "open_runtime",
    primaryLabel: "error.action.openRuntime",
    secondaryId: "open_doctor",
    secondaryLabel: "error.action.openDoctor",
  },
  TURN_TIMEOUT: {
    problem: "error.deck.timeout.problem",
    cause: "error.deck.timeout.cause",
    primaryId: "reconnect",
    primaryLabel: "error.action.retry",
    secondaryId: "dismiss",
    secondaryLabel: "error.action.dismiss",
  },
  AGENT_DISCONNECTED: {
    problem: "error.deck.disconnect.problem",
    cause: "error.deck.disconnect.cause",
    primaryId: "reconnect",
    primaryLabel: "error.action.reconnect",
    secondaryId: "open_doctor",
    secondaryLabel: "error.action.openDoctor",
  },
  STREAM_STALL: {
    problem: "error.deck.stall.problem",
    cause: "error.deck.stall.cause",
    // Handled by the stall banner (not the generic error-banner switch):
    // keep_waiting dismisses the prompt; cancel_turn stops the turn.
    primaryId: "keep_waiting",
    primaryLabel: "agent.streamStallKeepWaiting",
    secondaryId: "cancel_turn",
    secondaryLabel: "agent.streamStallCancel",
  },
  WORKSPACE_UNTRUSTED: {
    problem: "error.deck.untrusted.problem",
    cause: "error.deck.untrusted.cause",
    primaryId: "trust_project",
    primaryLabel: "error.action.trustProject",
    secondaryId: "dismiss",
    secondaryLabel: "error.action.dismiss",
  },
  PROJECT_MISSING: {
    problem: "error.deck.projectMissing.problem",
    cause: "error.deck.projectMissing.cause",
    primaryId: "relocate_project",
    primaryLabel: "error.action.relocateProject",
    secondaryId: "add_project",
    secondaryLabel: "error.action.addProject",
  },
  PERMISSION_DENIED: {
    problem: "error.deck.permission.problem",
    cause: "error.deck.permission.cause",
    primaryId: "open_permissions",
    primaryLabel: "error.action.openPermissions",
    secondaryId: "dismiss",
    secondaryLabel: "error.action.dismiss",
  },
  MCP_AUTH_FAILED: {
    problem: "error.deck.mcpAuth.problem",
    cause: "error.deck.mcpAuth.cause",
    primaryId: "open_mcp",
    primaryLabel: "error.action.openMcp",
    secondaryId: "open_extensions",
    secondaryLabel: "error.action.openExtensions",
  },
  OAUTH_EXPIRED: {
    problem: "error.deck.oauthExpired.problem",
    cause: "error.deck.oauthExpired.cause",
    primaryId: "open_mcp",
    primaryLabel: "error.action.openMcp",
    secondaryId: "open_account",
    secondaryLabel: "error.action.openAccount",
  },
  GENERIC: {
    problem: "error.deck.generic.problem",
    cause: "error.deck.generic.cause",
    primaryId: "dismiss",
    primaryLabel: "error.action.dismiss",
    secondaryId: "open_doctor",
    secondaryLabel: "error.action.openDoctor",
  },
};

export function buildErrorDeck(
  code: ErrorDeckCode,
  locale: Locale = "en",
): ErrorDeckCard {
  const t = createT(locale);
  const spec = DECK[code] ?? DECK.GENERIC;
  return {
    code,
    problem: t(spec.problem),
    cause: t(spec.cause),
    primary: { id: spec.primaryId, label: t(spec.primaryLabel) },
    secondary:
      spec.secondaryId && spec.secondaryLabel
        ? { id: spec.secondaryId, label: t(spec.secondaryLabel) }
        : null,
  };
}

/** Codes the host may emit as stable SCREAMING_SNAKE (or App may prefix). */
const AGENT_DECK_CODES: ErrorDeckCode[] = [
  "CLI_NOT_FOUND",
  "AUTH_FAILED",
  "AUTH_NO_CONTEXT",
  "AUTH_API_KEY",
  "AUTH_CUSTOM_PROVIDER",
  "NETWORK_PROVIDER",
  "AGENT_CRASHED",
  "QUOTA_EXCEEDED",
  "RATE_LIMITED",
  "CONNECT_FAILED",
  "PROCESS_LIMIT",
  "CLI_TOO_OLD",
  "SANDBOX_BLOCKED",
  "WORKSPACE_UNTRUSTED",
  "PROJECT_MISSING",
  "PERMISSION_DENIED",
  "MCP_AUTH_FAILED",
  "OAUTH_EXPIRED",
  "STREAM_STALL",
];

/** Map a classified agent code (or special timeout/disconnect) to a deck code. */
export function deckCodeFromAgent(
  code: string | null | undefined,
  opts?: ErrorDeckResolveOpts,
): ErrorDeckCode {
  if (opts?.timeout) return "TURN_TIMEOUT";
  if (opts?.disconnected) return "AGENT_DISCONNECTED";
  if (code && (AGENT_DECK_CODES as string[]).includes(code)) {
    return code as ErrorDeckCode;
  }
  return "GENERIC";
}

/**
 * Linux bubblewrap / unprivileged user-namespace denial (Ubuntu 24.04 AppArmor).
 * Keep markers specific — bare "permission denied" is tool/FS, not sandbox.
 */
export function looksLikeLinuxSandboxBlock(
  raw: string | null | undefined,
): boolean {
  const s = (raw ?? "").toLowerCase();
  if (!s.trim()) return false;
  if (s.includes("bwrap")) return true;
  if (s.includes("setting up uid map")) return true;
  if (
    s.includes("uid map") &&
    (s.includes("permission denied") || s.includes("operation not permitted"))
  ) {
    return true;
  }
  if (s.includes("apparmor_restrict_unprivileged_userns")) return true;
  if (
    s.includes("unprivileged user namespace") ||
    (s.includes("user namespace") &&
      (s.includes("permission denied") ||
        s.includes("operation not permitted") ||
        s.includes("restricted")))
  ) {
    return true;
  }
  return false;
}

/**
 * Official included-usage / credit exhaustion (same family as Grok Build CLI).
 * Do not treat a bare 429 / "rate limit, retry later" as terminal.
 */
export function looksLikeTerminalQuota(
  raw: string | null | undefined,
): boolean {
  const s = (raw ?? "").toLowerCase();
  if (!s.trim()) return false;
  return (
    s.includes("free-usage-exhausted") ||
    s.includes("free_usage_exhausted") ||
    s.includes("usage-exhausted") ||
    s.includes("usage_exhausted") ||
    s.includes("included free usage") ||
    s.includes("included usage exhausted") ||
    s.includes("you've used all") ||
    s.includes("you have used all") ||
    s.includes("used all the included") ||
    s.includes("out of credits") ||
    s.includes("insufficient credit") ||
    s.includes("quota exceeded") ||
    s.includes("额度用尽") ||
    s.includes("额度已用尽") ||
    s.includes("额度已用完") ||
    s.includes("免費額度") ||
    s.includes("免费额度已")
  );
}

/** Transient throttle — HTTP 429 / “too many requests” without usage exhaustion. */
export function looksLikeRateLimit(
  raw: string | null | undefined,
): boolean {
  if (looksLikeTerminalQuota(raw)) return false;
  const s = (raw ?? "").toLowerCase();
  if (!s.trim()) return false;
  return (
    s.includes("rate limit") ||
    s.includes("rate_limit") ||
    s.includes("too many requests") ||
    s.includes("429") ||
    s.includes("retry later") ||
    s.includes("slow down")
  );
}

/** Host still emits QUOTA_EXCEEDED for some 429s — split the card from the message. */
export function refineQuotaDeckCode(
  message?: string | null,
): ErrorDeckCode {
  if (looksLikeTerminalQuota(message)) return "QUOTA_EXCEEDED";
  if (looksLikeRateLimit(message)) return "RATE_LIMITED";
  return "QUOTA_EXCEEDED";
}

/**
 * Split host `AUTH_FAILED` / free-form auth strings into actionable subtypes.
 * Host still emits AUTH_FAILED; UI refines with message + active route.
 *
 * CharlieLam 2026-08-05: generic “re-login” misled when the failure was
 * missing agent auth context, a bad API key, or a custom relay route.
 */
export function refineAuthDeckCode(
  message?: string | null,
  opts?: Pick<ErrorDeckResolveOpts, "activeSource">,
): ErrorDeckCode {
  const s = (message ?? "").toLowerCase();
  const custom = opts?.activeSource === "custom";

  // Custom routes never become valid by re-logging into the official account.
  if (custom) return "AUTH_CUSTOM_PROVIDER";

  // Process / agent-home has no usable credentials (not just "wrong key").
  if (
    s.includes("no auth context") ||
    s.includes("auth_kind=none") ||
    s.includes("auth_kind\":none") ||
    s.includes("auth_kind: none") ||
    (s.includes("auth_kind") && s.includes("none") && s.includes("permissiondenied")) ||
    (s.includes("x_xai_token_auth=none") && s.includes("no auth"))
  ) {
    return "AUTH_NO_CONTEXT";
  }

  // Explicit API key rejection (xAI often HTTP 400 without "401").
  const apiKeyish =
    s.includes("incorrect api key") ||
    s.includes("invalid api key") ||
    (s.includes("api key") &&
      (s.includes("incorrect") ||
        s.includes("invalid") ||
        s.includes("missing") ||
        s.includes("not provided") ||
        s.includes("provided")));
  if (apiKeyish) {
    return "AUTH_API_KEY";
  }

  // Invalid/expired bearer with no more specific marker → generic re-login.
  return "AUTH_FAILED";
}

/** True for any product auth deck (banner / bubble recovery). */
export function isAuthDeckCode(code: ErrorDeckCode | string | null | undefined): boolean {
  return (
    code === "AUTH_FAILED" ||
    code === "AUTH_NO_CONTEXT" ||
    code === "AUTH_API_KEY" ||
    code === "AUTH_CUSTOM_PROVIDER"
  );
}

/**
 * Map free-form error text to a deck code when the host did not emit a stable code.
 * Order: App project gates → MCP OAuth → tool permission → classic four classes.
 */
export function classifyErrorMessage(raw: string | null | undefined): ErrorDeckCode {
  const s = (raw ?? "").toLowerCase();
  if (!s.trim()) return "GENERIC";

  // ── Linux sandbox / userns (before bare "permission denied") ──
  if (looksLikeLinuxSandboxBlock(raw) || s.includes("sandbox_blocked")) {
    return "SANDBOX_BLOCKED";
  }

  // ── App project gates (setLocalError from trust / path / select) ──
  if (
    s.includes("workspace_untrusted") ||
    s.includes("trust project") ||
    s.includes("project not trusted") ||
    s.includes("untrusted project") ||
    s.includes("workspace untrusted") ||
    s.includes("请先信任") ||
    s.includes("請先信任")
  ) {
    return "WORKSPACE_UNTRUSTED";
  }
  if (
    s.includes("project_missing") ||
    s.includes("path missing") ||
    s.includes("folder missing") ||
    s.includes("is missing or not a directory") ||
    (s.includes("folder for") && s.includes("missing")) ||
    s.includes("select a project") ||
    s.includes("add and select a project") ||
    s.includes("no project") ||
    s.includes("project missing") ||
    s.includes("请先选择") ||
    s.includes("請先選擇") ||
    s.includes("文件夹已丢失") ||
    s.includes("資料夾已遺失") ||
    s.includes("資料夾遺失") ||
    s.includes("不是目录") ||
    s.includes("不是目錄") ||
    s.includes("重新定位")
  ) {
    return "PROJECT_MISSING";
  }

  // ── MCP / OAuth (more specific than generic AUTH_FAILED) ──
  const mcpish =
    s.includes("mcp") ||
    s.includes("oauth") ||
    s.includes("resource_metadata") ||
    s.includes("protected-resource") ||
    s.includes("protected_resource") ||
    s.includes("www-authenticate") ||
    s.includes("authorization required") ||
    s.includes("auth required");
  const expiredish =
    s.includes("expired") ||
    s.includes("invalid_token") ||
    s.includes("invalid_grant") ||
    s.includes("token expir") ||
    (s.includes("credential") && s.includes("expir")) ||
    s.includes("refresh_token");
  if (mcpish && expiredish) {
    return "OAUTH_EXPIRED";
  }
  if (
    s.includes("oauth_expired") ||
    (expiredish &&
      (s.includes("oauth") || s.includes("mcp") || s.includes("access_token")))
  ) {
    return "OAUTH_EXPIRED";
  }
  if (
    s.includes("mcp_auth_failed") ||
    s.includes("mcp auth") ||
    s.includes("oauth failed") ||
    s.includes("oauth error") ||
    s.includes("authorization failed") ||
    s.includes("authorization required") ||
    s.includes("auth required") ||
    s.includes("resource_metadata") ||
    (s.includes("mcp") &&
      (s.includes("auth") || s.includes("oauth") || s.includes("unauthorized")))
  ) {
    return "MCP_AUTH_FAILED";
  }

  // ── Tool / FS permission (not account 401) ──
  // CLI rejects Host optionId → mid-turn cancel (#523 / #542 / #544). Surface
  // as permission recovery (open Permissions), not a silent end_turn.
  if (
    s.includes("permission_denied") ||
    s.includes("permission denied") ||
    s.includes("eacces") ||
    s.includes("operation not permitted") ||
    s.includes("user rejected") ||
    s.includes("user denied") ||
    s.includes("tool denied") ||
    s.includes("tool call denied") ||
    s.includes("rejected by user") ||
    s.includes("unknown permission option") ||
    s.includes("permission_rejected") ||
    s.includes("failed to request permission") ||
    s.includes("权限被拒绝") ||
    s.includes("權限被拒絕") ||
    s.includes("无权访问") ||
    s.includes("無權存取")
  ) {
    return "PERMISSION_DENIED";
  }

  if (
    s.includes("cli_not_found") ||
    s.includes("command not found") ||
    s.includes("no such file") ||
    s.includes("not found in path") ||
    s.includes("grok build not found") ||
    s.includes("cli not found") ||
    (s.includes("executable") && s.includes("not"))
  ) {
    return "CLI_NOT_FOUND";
  }
  if (
    s.includes("auth_failed") ||
    s.includes("unauthorized") ||
    s.includes("401") ||
    s.includes("invalid api key") ||
    s.includes("incorrect api key") ||
    // xAI often returns HTTP 400 + "Incorrect API key provided" (no "auth"/"401").
    (s.includes("api key") &&
      (s.includes("incorrect") ||
        s.includes("invalid") ||
        s.includes("missing") ||
        s.includes("provided"))) ||
    s.includes("invalid or expired credentials") ||
    s.includes("bad-credentials") ||
    s.includes("bad credentials") ||
    s.includes("no auth context") ||
    s.includes("not logged in") ||
    s.includes("authentication") ||
    s.includes("login required")
  ) {
    return "AUTH_FAILED";
  }
  if (looksLikeTerminalQuota(raw) || s.includes("quota_exceeded")) {
    return "QUOTA_EXCEEDED";
  }
  if (s.includes("quota") || s.includes("insufficient credit") || s.includes("out of credits")) {
    return "QUOTA_EXCEEDED";
  }
  if (looksLikeRateLimit(raw)) {
    return "RATE_LIMITED";
  }
  if (
    s.includes("network_provider") ||
    s.includes("timed out") ||
    s.includes("timeout") ||
    s.includes("econnrefused") ||
    s.includes("enotfound") ||
    s.includes("dns") ||
    s.includes("proxy") ||
    s.includes("502") ||
    s.includes("503") ||
    s.includes("provider") ||
    s.includes("fetch failed")
  ) {
    return "NETWORK_PROVIDER";
  }
  if (
    s.includes("process_limit") ||
    s.includes("too many agent") ||
    s.includes("concurrent agent")
  ) {
    return "PROCESS_LIMIT";
  }
  if (
    s.includes("connect_failed") ||
    s.includes("failed to connect") ||
    s.includes("attach failed")
  ) {
    return "CONNECT_FAILED";
  }
  if (
    s.includes("agent_crashed") ||
    s.includes("exited") ||
    s.includes("panic") ||
    s.includes("segfault") ||
    s.includes("broken pipe") ||
    s.includes("protocol error")
  ) {
    return "AGENT_CRASHED";
  }
  return "GENERIC";
}

/** Prefer a host code; otherwise classify the message text. */
export function resolveErrorDeckCode(
  code: string | null | undefined,
  message?: string | null,
  opts?: ErrorDeckResolveOpts,
): ErrorDeckCode {
  // bwrap/userns text wins even when host still emits AGENT_CRASHED / NETWORK_PROVIDER
  // (stderr may sit after "stream closed" and previously looked like a network flap).
  if (
    looksLikeLinuxSandboxBlock(message) ||
    looksLikeLinuxSandboxBlock(code) ||
    code === "SANDBOX_BLOCKED"
  ) {
    return "SANDBOX_BLOCKED";
  }
  // Host retry abort used to emit NETWORK_PROVIDER around free-usage-exhausted.
  // Do not pass the host *code* into these helpers — `QUOTA_EXCEEDED` contains
  // `quota_exceeded` and would skip rate-limit refine.
  if (looksLikeTerminalQuota(message)) {
    return "QUOTA_EXCEEDED";
  }
  if (looksLikeRateLimit(message)) {
    return "RATE_LIMITED";
  }
  const fromCode = deckCodeFromAgent(code, opts);
  // Host often emits plain AUTH_FAILED — refine with message + active route.
  if (fromCode === "AUTH_FAILED") {
    return refineAuthDeckCode(message ?? code, opts);
  }
  if (fromCode === "QUOTA_EXCEEDED") {
    return refineQuotaDeckCode(message ?? code);
  }
  if (fromCode !== "GENERIC") return fromCode;
  const classified = classifyErrorMessage(message ?? code);
  if (classified === "AUTH_FAILED") {
    return refineAuthDeckCode(message ?? code, opts);
  }
  if (classified === "QUOTA_EXCEEDED") {
    return refineQuotaDeckCode(message ?? code);
  }
  return classified;
}

/** Whether the primary/secondary action should re-open the agent. */
export function isReconnectAction(id: ErrorDeckActionId): boolean {
  return id === "reconnect";
}
