/** API domain: account */

import {
  invoke,
  isTauri,
  isMirrorClient,
} from "./host";

// ── Official Grok Build account ─────────────────────────────────────────────

export interface AccountProfile {
  signedIn: boolean;
  authMode: string | null;
  email: string | null;
  displayName: string | null;
  userId: string | null;
  teamId: string | null;
  principalType: string | null;
  expiresAt: string | null;
  expired: boolean;
  hasRefresh: boolean;
  oidcIssuer: string | null;
}

export interface QuotaProduct {
  productId: number;
  label: string;
  usedPercent: number;
}

export interface BillingSnapshot {
  available: boolean;
  source: string;
  message: string | null;
  subscriptionTier: string | null;
  creditUsagePercent: number | null;
  remainingPercent: number | null;
  monthlyLimit: number | null;
  includedUsed: number | null;
  totalUsed: number | null;
  prepaidBalance: number | null;
  onDemandEnabled: boolean | null;
  onDemandCap: number | null;
  onDemandUsed: number | null;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  resetsAt: string | null;
  isUnifiedBillingUser: boolean | null;
  products: QuotaProduct[];
  manageUrl: string;
  subscribeUrl: string;
  fetchedAt: string | null;
}

export interface HeatmapDay {
  date: string;
  requests: number;
  tokens: number;
  costUsd: number;
}

export interface CallLogEntry {
  id: string;
  title: string;
  model: string | null;
  projectPath: string | null;
  startedAt: string | null;
  durationSecs: number | null;
  turns: number;
  toolCalls: number;
  contextTokens: number;
  /** Billing usage (sum of turn_completed); same as heatmap tokens. */
  usageTokens?: number;
  errors: number;
}

export interface AccountStatus {
  profile: AccountProfile;
  hasOfficialKey: boolean;
  hasRelayKey: boolean;
  relayBaseUrl: string | null;
  cliAuthPresent: boolean;
  cliFound: boolean;
  cliPath: string | null;
  channel: string;
  billing: BillingSnapshot;
  heatmap: HeatmapDay[];
  callLogs: CallLogEntry[];
  usageManageUrl: string;
  subscribeUrl: string;
}

export interface LoginResult {
  ok: boolean;
  method: string;
  message: string;
  deviceUrl: string | null;
  deviceCode: string | null;
  profile: AccountProfile | null;
  /** Host watchdog killed the login (auth endpoint unreachable). */
  timedOut?: boolean;
}

export async function accountStatus(opts?: {
  refreshBilling?: boolean;
  manualCliPath?: string | null;
}) {
  if (isMirrorClient()) {
    return invoke<AccountStatus>("account_status", {
      refreshBilling: opts?.refreshBilling ?? false,
      manualCliPath: opts?.manualCliPath ?? null,
    });
  }
  if (!isTauri()) {
    return {
      profile: {
        signedIn: false,
        authMode: null,
        email: null,
        displayName: null,
        userId: null,
        teamId: null,
        principalType: null,
        expiresAt: null,
        expired: false,
        hasRefresh: false,
        oidcIssuer: null,
      },
      hasOfficialKey: false,
      hasRelayKey: false,
      relayBaseUrl: null,
      cliAuthPresent: false,
      cliFound: false,
      cliPath: null,
      channel: "none",
      billing: {
        available: false,
        source: "browser",
        message: "Account requires Tauri desktop runtime",
        subscriptionTier: null,
        creditUsagePercent: null,
        remainingPercent: null,
        monthlyLimit: null,
        includedUsed: null,
        totalUsed: null,
        prepaidBalance: null,
        onDemandEnabled: null,
        onDemandCap: null,
        onDemandUsed: null,
        billingPeriodStart: null,
        billingPeriodEnd: null,
        resetsAt: null,
        isUnifiedBillingUser: null,
        products: [],
        manageUrl: "https://grok.com/?_s=usage",
        subscribeUrl: "https://grok.com/supergrok?referrer=grok-build",
        fetchedAt: null,
      },
      heatmap: [],
      callLogs: [],
      usageManageUrl: "https://grok.com/?_s=usage",
      subscribeUrl: "https://grok.com/supergrok?referrer=grok-build",
    } satisfies AccountStatus;
  }
  return invoke<AccountStatus>("account_status", {
    refreshBilling: opts?.refreshBilling ?? true,
    manualCliPath: opts?.manualCliPath ?? null,
  });
}

export async function accountLogin(method: "oauth" | "device" = "oauth") {
  return invoke<LoginResult>("account_login", { method });
}

/** Paste browser-shown verification code into the running `grok login` stdin. */
export async function accountLoginSubmitCode(code: string) {
  return invoke<void>("account_login_submit_code", { code });
}

/** Abort a running `grok login` (OAuth / device-code). No-op if none is running. */
export async function accountLoginCancel() {
  return invoke<void>("account_login_cancel");
}

export async function accountLogout() {
  return invoke<AccountProfile>("account_logout");
}

export async function accountOpenUsage() {
  if (!isTauri()) {
    window.open("https://grok.com/?_s=usage", "_blank");
    return;
  }
  return invoke<void>("account_open_usage");
}

export async function accountOpenSubscribe() {
  if (!isTauri()) {
    window.open(
      "https://grok.com/supergrok?referrer=grok-build",
      "_blank",
    );
    return;
  }
  return invoke<void>("account_open_subscribe");
}

// ── Multi-account switcher ──────────────────────────────────────────────────

export interface SavedAccount {
  id: string;
  email?: string | null;
  displayName?: string | null;
  label: string;
  updatedAt: string;
}

export interface AccountsListResult {
  profiles: SavedAccount[];
  activeId?: string | null;
}

export async function accountsList() {
  return invoke<AccountsListResult>("accounts_list");
}

export async function accountSaveCurrent(label?: string | null) {
  return invoke<SavedAccount>("account_save_current", {
    label: label ?? null,
  });
}

export async function accountSwitch(id: string) {
  return invoke<AccountProfile>("account_switch", { id });
}

export async function accountRemove(id: string) {
  return invoke<void>("account_remove", { id });
}

export async function accountRename(id: string, label: string) {
  return invoke<SavedAccount>("account_rename", { id, label });
}

/** Import markdown/JSON transcript as a new local session. */
export async function sessionImportTranscript(
  text: string,
  title?: string | null,
  projectId?: string | null,
) {
  return invoke<{
    id: string;
    title: string;
    projectId?: string | null;
  }>("session_import_transcript", {
    text,
    title: title ?? null,
    projectId: projectId ?? null,
  });
}

/** Native file picker → import transcript. Returns null if cancelled. */
export async function sessionImportTranscriptFile(
  title?: string | null,
  projectId?: string | null,
) {
  return invoke<{
    id: string;
    title: string;
    projectId?: string | null;
  } | null>("session_import_transcript_file", {
    title: title ?? null,
    projectId: projectId ?? null,
  });
}

