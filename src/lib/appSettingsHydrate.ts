/**
 * Map Host AppSettings into workbench pref fields.
 * Pure — no React / persistence. Side effects (open-target storage, catalog
 * fetch) stay in the settings-prefs hook.
 */
import type { AppSettings, ComposerPrefsScope } from "@/lib/api";
import { isValidPrefsScope } from "@/lib/grokCatalog";
import {
  DEFAULT_SANDBOX_PROFILE,
  normalizeSandboxProfile,
  type SandboxProfileId,
} from "@/lib/sandboxProfile";
import {
  DEFAULT_SESSION_DATA_MODE,
  normalizeSessionDataMode,
} from "@/lib/sessionDataMode";
import { normalizeProxyMode, type ProxyMode } from "@/lib/networkProxy";

export type AppSettingsPrefsSnapshot = {
  sessionDataMode: ReturnType<typeof normalizeSessionDataMode>;
  defaultOpenTarget: string;
  prefsScope: ComposerPrefsScope | null;
  acpServerAddr: string;
  proxyMode: ProxyMode;
  proxyUrl: string;
  proxyNoProxy: string;
  maxConcurrentAgents: number;
  agentIdleMinutes: number;
  streamStallSeconds: number;
  auditLedgerRetentionDays: number;
  includePartialMessages: boolean;
  maxAgentTurns: number;
  backgroundWaitPolicy: string;
  backgroundWaitTimeoutSec: number;
  storeApiKeysInKeychain: boolean;
  sandboxProfile: SandboxProfileId;
  preferredAgent: string;
  agentProfilePath: string;
  agentsJson: string;
  experimentalMemory: boolean;
  twoPassCompactionEnabled: boolean;
  voiceId: string;
  voiceDictationAutoSend: boolean;
  voiceKeepAgentsOnEnd: boolean;
  sttEngine: string;
  sttCustomBaseUrl: string;
  sttCustomModel: string;
  sttCustomLanguage: string;
  sttZhScript: string;
  allowUnverifiedCliInstall: boolean;
  lastCliChecksumVerified: boolean | null;
  subagentsEnabled: boolean;
  subagentWorktreeSnapshotEnabled: boolean;
  autoWakeEnabled: boolean;
  workflowsEnabled: boolean;
  planEnabled: boolean;
  todoGateEnabled: boolean;
  todoGateMaxFiresPerPrompt: number;
  disableWebSearch: boolean;
  noAskUser: boolean;
  disallowedTools: string[];
  allowedTools: string[];
  useLeader: boolean;
  reopenLastSession: boolean;
  closeToTray: boolean;
  keepTrayForSchedules: boolean;
  launchAtLogin: boolean;
  notifyOnTurnDone: boolean;
  notifyOnPermission: boolean;
  lastSessionId: string | null;
  manualCliPath: string;
};

export function parseAppSettingsPrefs(
  settings: AppSettings,
  opts?: { fallbackCliPath?: string | null },
): AppSettingsPrefsSnapshot {
  const rawRetention = settings.auditLedgerRetentionDays;
  const retentionN =
    typeof rawRetention === "number" && Number.isFinite(rawRetention)
      ? Math.floor(rawRetention)
      : 0;
  const turns = settings.maxAgentTurns;
  const pol = (settings.backgroundWaitPolicy || "wait")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  const ts = settings.backgroundWaitTimeoutSec;
  const sb = (settings.sandboxProfile || DEFAULT_SANDBOX_PROFILE)
    .trim()
    .toLowerCase();
  const todoFires = settings.todoGateMaxFiresPerPrompt;
  const strings = (xs: unknown): string[] =>
    Array.isArray(xs)
      ? xs.filter((x): x is string => typeof x === "string")
      : [];
  const proxyUrl = settings.proxyUrl || "";

  return {
    sessionDataMode: normalizeSessionDataMode(
      settings.sessionDataMode || DEFAULT_SESSION_DATA_MODE,
    ),
    defaultOpenTarget: settings.defaultOpenTarget || "finder",
    prefsScope:
      settings.composerPrefsScope &&
      isValidPrefsScope(settings.composerPrefsScope)
        ? settings.composerPrefsScope
        : null,
    acpServerAddr: settings.acpServerAddr || "",
    proxyMode: normalizeProxyMode(settings.proxyMode, proxyUrl),
    proxyUrl,
    proxyNoProxy: settings.proxyNoProxy || "",
    maxConcurrentAgents:
      typeof settings.maxConcurrentAgents === "number" &&
      settings.maxConcurrentAgents >= 1
        ? Math.min(32, Math.round(settings.maxConcurrentAgents))
        : 3,
    agentIdleMinutes:
      typeof settings.agentIdleMinutes === "number" &&
      settings.agentIdleMinutes >= 1
        ? Math.min(1440, Math.round(settings.agentIdleMinutes))
        : 30,
    streamStallSeconds:
      typeof settings.streamStallSeconds === "number" &&
      settings.streamStallSeconds >= 15
        ? Math.min(900, Math.round(settings.streamStallSeconds))
        : 120,
    auditLedgerRetentionDays:
      retentionN === 7 || retentionN === 30 || retentionN === 90 ? retentionN : 0,
    includePartialMessages: !!settings.includePartialMessages,
    maxAgentTurns:
      typeof turns === "number" && turns > 0
        ? Math.min(200, Math.round(turns))
        : 0,
    backgroundWaitPolicy:
      pol === "no_wait" || pol === "timeout" ? pol : "wait",
    backgroundWaitTimeoutSec:
      typeof ts === "number" && Number.isFinite(ts)
        ? Math.min(3600, Math.max(1, Math.round(ts)))
        : 600,
    storeApiKeysInKeychain: !!settings.storeApiKeysInKeychain,
    sandboxProfile: normalizeSandboxProfile(sb) ?? DEFAULT_SANDBOX_PROFILE,
    preferredAgent: (settings.preferredAgent || "").trim(),
    agentProfilePath: (settings.agentProfilePath || "").trim(),
    agentsJson: (settings.agentsJson || "").trim(),
    experimentalMemory: !!settings.experimentalMemory,
    twoPassCompactionEnabled: !!settings.twoPassCompactionEnabled,
    voiceId: (settings.voiceId || "eve").trim() || "eve",
    voiceDictationAutoSend: !!settings.voiceDictationAutoSend,
    voiceKeepAgentsOnEnd: settings.voiceKeepAgentsOnEnd !== false,
    sttEngine: (settings.sttEngine || "official").trim() || "official",
    sttCustomBaseUrl: settings.sttCustomBaseUrl || "",
    sttCustomModel: settings.sttCustomModel || "",
    sttCustomLanguage: settings.sttCustomLanguage || "",
    sttZhScript: (settings.sttZhScript || "auto").trim() || "auto",
    allowUnverifiedCliInstall: !!settings.allowUnverifiedCliInstall,
    lastCliChecksumVerified:
      typeof settings.lastCliChecksumVerified === "boolean"
        ? settings.lastCliChecksumVerified
        : null,
    subagentsEnabled: settings.subagentsEnabled !== false,
    subagentWorktreeSnapshotEnabled: !!settings.subagentWorktreeSnapshotEnabled,
    autoWakeEnabled: !!settings.autoWakeEnabled,
    workflowsEnabled: !!settings.workflowsEnabled,
    planEnabled: settings.planEnabled !== false,
    todoGateEnabled: !!settings.todoGateEnabled,
    todoGateMaxFiresPerPrompt:
      typeof todoFires === "number" && todoFires > 0
        ? Math.min(20, Math.max(1, Math.round(todoFires)))
        : 3,
    disableWebSearch: !!settings.disableWebSearch,
    noAskUser: !!settings.noAskUser,
    disallowedTools: strings(settings.disallowedTools),
    allowedTools: strings(settings.allowedTools),
    useLeader: !!settings.useLeader,
    reopenLastSession: settings.reopenLastSession === true,
    closeToTray: settings.closeToTray !== false,
    keepTrayForSchedules: settings.keepTrayForSchedules !== false,
    launchAtLogin: settings.launchAtLogin === true,
    notifyOnTurnDone: settings.notifyOnTurnDone !== false,
    notifyOnPermission: settings.notifyOnPermission !== false,
    lastSessionId:
      typeof settings.lastSessionId === "string"
        ? settings.lastSessionId.trim() || null
        : null,
    manualCliPath: settings.manualCliPath || opts?.fallbackCliPath || "",
  };
}
