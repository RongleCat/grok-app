/**
 * Host AppSettings prefs: state + hydrate from settingsGet.
 * Locale/catalog, composer model chips, and CLI probe stay on the host.
 */
import { useCallback, useRef, useState } from "react";
import type { AppSettings, ComposerPrefsScope } from "@/lib/api";
import {
  parseAppSettingsPrefs,
  type AppSettingsPrefsSnapshot,
} from "@/lib/appSettingsHydrate";
import { writeOpenTargetStorage } from "@/lib/openEditorHonesty";
import { DEFAULT_SANDBOX_PROFILE } from "@/lib/sandboxProfile";
import { DEFAULT_SESSION_DATA_MODE } from "@/lib/sessionDataMode";

export function useAppSettingsPrefs() {
  const [sessionDataMode, setSessionDataMode] = useState(
    DEFAULT_SESSION_DATA_MODE,
  );
  const [defaultOpenTarget, setDefaultOpenTarget] = useState("finder");
  const [prefsScope, setPrefsScope] =
    useState<ComposerPrefsScope>("global");
  const [acpServerAddr, setAcpServerAddr] = useState("");
  const [proxyMode, setProxyMode] = useState("system");
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyNoProxy, setProxyNoProxy] = useState("");
  const [maxConcurrentAgents, setMaxConcurrentAgents] = useState(8);
  const [agentIdleMinutes, setAgentIdleMinutes] = useState(30);
  const [streamStallSeconds, setStreamStallSeconds] = useState(600);
  const [auditLedgerRetentionDays, setAuditLedgerRetentionDays] = useState(0);
  const [includePartialMessages, setIncludePartialMessages] = useState(false);
  const [maxAgentTurns, setMaxAgentTurns] = useState(0);
  const [backgroundWaitPolicy, setBackgroundWaitPolicy] = useState("wait");
  const [backgroundWaitTimeoutSec, setBackgroundWaitTimeoutSec] = useState(600);
  const [storeApiKeysInKeychain, setStoreApiKeysInKeychain] = useState(true);
  const [sandboxProfile, setSandboxProfile] = useState(DEFAULT_SANDBOX_PROFILE);
  const [preferredAgent, setPreferredAgent] = useState("");
  const [agentProfilePath, setAgentProfilePath] = useState("");
  const [agentsJson, setAgentsJson] = useState("");
  const [agentCatalog, setAgentCatalog] = useState<
    Array<{ name: string; source: string }>
  >([]);
  const [experimentalMemory, setExperimentalMemory] = useState(false);
  const [twoPassCompactionEnabled, setTwoPassCompactionEnabled] =
    useState(false);
  const [voiceId, setVoiceId] = useState("eve");
  const [voiceDictationAutoSend, setVoiceDictationAutoSend] = useState(false);
  const [voiceKeepAgentsOnEnd, setVoiceKeepAgentsOnEnd] = useState(true);
  const [sttEngine, setSttEngine] = useState("official");
  const [sttCustomBaseUrl, setSttCustomBaseUrl] = useState("");
  const [sttCustomModel, setSttCustomModel] = useState("");
  const [sttCustomLanguage, setSttCustomLanguage] = useState("");
  const [sttZhScript, setSttZhScript] = useState("auto");
  const [allowUnverifiedCliInstall, setAllowUnverifiedCliInstall] =
    useState(false);
  const [lastCliChecksumVerified, setLastCliChecksumVerified] = useState<
    boolean | null
  >(null);
  const [subagentsEnabled, setSubagentsEnabled] = useState(true);
  const [subagentWorktreeSnapshotEnabled, setSubagentWorktreeSnapshotEnabled] =
    useState(false);
  const [autoWakeEnabled, setAutoWakeEnabled] = useState(false);
  const [workflowsEnabled, setWorkflowsEnabled] = useState(false);
  const [planEnabled, setPlanEnabled] = useState(true);
  const [todoGateEnabled, setTodoGateEnabled] = useState(false);
  const [todoGateMaxFiresPerPrompt, setTodoGateMaxFiresPerPrompt] =
    useState(3);
  const [disableWebSearch, setDisableWebSearch] = useState(false);
  const [noAskUser, setNoAskUser] = useState(false);
  const [disallowedTools, setDisallowedTools] = useState<string[]>([]);
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [useLeader, setUseLeader] = useState(false);
  const [reopenLastSession, setReopenLastSession] = useState(false);
  const [closeToTray, setCloseToTray] = useState(true);
  const [keepTrayForSchedules, setKeepTrayForSchedules] = useState(true);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [notifyOnTurnDone, setNotifyOnTurnDone] = useState(true);
  const [notifyOnPermission, setNotifyOnPermission] = useState(true);
  const notifyPrefsRef = useRef({
    notifyOnTurnDone: true,
    notifyOnPermission: true,
  });
  notifyPrefsRef.current = { notifyOnTurnDone, notifyOnPermission };
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);
  const [manualCliPath, setManualCliPath] = useState("");

  const applySnapshot = useCallback((p: AppSettingsPrefsSnapshot) => {
    setSessionDataMode(p.sessionDataMode);
    setDefaultOpenTarget(p.defaultOpenTarget);
    writeOpenTargetStorage(p.defaultOpenTarget);
    if (p.prefsScope) setPrefsScope(p.prefsScope);
    setAcpServerAddr(p.acpServerAddr);
    setProxyMode(p.proxyMode);
    setProxyUrl(p.proxyUrl);
    setProxyNoProxy(p.proxyNoProxy);
    setMaxConcurrentAgents(p.maxConcurrentAgents);
    setAgentIdleMinutes(p.agentIdleMinutes);
    setStreamStallSeconds(p.streamStallSeconds);
    setAuditLedgerRetentionDays(p.auditLedgerRetentionDays);
    setIncludePartialMessages(p.includePartialMessages);
    setMaxAgentTurns(p.maxAgentTurns);
    setBackgroundWaitPolicy(p.backgroundWaitPolicy);
    setBackgroundWaitTimeoutSec(p.backgroundWaitTimeoutSec);
    setStoreApiKeysInKeychain(p.storeApiKeysInKeychain);
    setSandboxProfile(p.sandboxProfile);
    setPreferredAgent(p.preferredAgent);
    setAgentProfilePath(p.agentProfilePath);
    setAgentsJson(p.agentsJson);
    setExperimentalMemory(p.experimentalMemory);
    setTwoPassCompactionEnabled(p.twoPassCompactionEnabled);
    setVoiceId(p.voiceId);
    setVoiceDictationAutoSend(p.voiceDictationAutoSend);
    setVoiceKeepAgentsOnEnd(p.voiceKeepAgentsOnEnd);
    setSttEngine(p.sttEngine);
    setSttCustomBaseUrl(p.sttCustomBaseUrl);
    setSttCustomModel(p.sttCustomModel);
    setSttCustomLanguage(p.sttCustomLanguage);
    setSttZhScript(p.sttZhScript);
    setAllowUnverifiedCliInstall(p.allowUnverifiedCliInstall);
    setLastCliChecksumVerified(p.lastCliChecksumVerified);
    setSubagentsEnabled(p.subagentsEnabled);
    setSubagentWorktreeSnapshotEnabled(p.subagentWorktreeSnapshotEnabled);
    setAutoWakeEnabled(p.autoWakeEnabled);
    setWorkflowsEnabled(p.workflowsEnabled);
    setPlanEnabled(p.planEnabled);
    setTodoGateEnabled(p.todoGateEnabled);
    setTodoGateMaxFiresPerPrompt(p.todoGateMaxFiresPerPrompt);
    setDisableWebSearch(p.disableWebSearch);
    setNoAskUser(p.noAskUser);
    setDisallowedTools(p.disallowedTools);
    setAllowedTools(p.allowedTools);
    setUseLeader(p.useLeader);
    setReopenLastSession(p.reopenLastSession);
    setCloseToTray(p.closeToTray);
    setKeepTrayForSchedules(p.keepTrayForSchedules);
    setLaunchAtLogin(p.launchAtLogin);
    setNotifyOnTurnDone(p.notifyOnTurnDone);
    setNotifyOnPermission(p.notifyOnPermission);
    setLastSessionId(p.lastSessionId);
    setManualCliPath(p.manualCliPath);
  }, []);

  const hydrateFromSettings = useCallback(
    (settings: AppSettings, opts?: { fallbackCliPath?: string | null }) => {
      applySnapshot(parseAppSettingsPrefs(settings, opts));
    },
    [applySnapshot],
  );

  return {
    sessionDataMode,
    setSessionDataMode,
    defaultOpenTarget,
    setDefaultOpenTarget,
    prefsScope,
    setPrefsScope,
    acpServerAddr,
    setAcpServerAddr,
    proxyMode,
    setProxyMode,
    proxyUrl,
    setProxyUrl,
    proxyNoProxy,
    setProxyNoProxy,
    maxConcurrentAgents,
    setMaxConcurrentAgents,
    agentIdleMinutes,
    setAgentIdleMinutes,
    streamStallSeconds,
    setStreamStallSeconds,
    auditLedgerRetentionDays,
    setAuditLedgerRetentionDays,
    includePartialMessages,
    setIncludePartialMessages,
    maxAgentTurns,
    setMaxAgentTurns,
    backgroundWaitPolicy,
    setBackgroundWaitPolicy,
    backgroundWaitTimeoutSec,
    setBackgroundWaitTimeoutSec,
    storeApiKeysInKeychain,
    setStoreApiKeysInKeychain,
    sandboxProfile,
    setSandboxProfile,
    preferredAgent,
    setPreferredAgent,
    agentProfilePath,
    setAgentProfilePath,
    agentsJson,
    setAgentsJson,
    agentCatalog,
    setAgentCatalog,
    experimentalMemory,
    setExperimentalMemory,
    twoPassCompactionEnabled,
    setTwoPassCompactionEnabled,
    voiceId,
    setVoiceId,
    voiceDictationAutoSend,
    setVoiceDictationAutoSend,
    voiceKeepAgentsOnEnd,
    setVoiceKeepAgentsOnEnd,
    sttEngine,
    setSttEngine,
    sttCustomBaseUrl,
    setSttCustomBaseUrl,
    sttCustomModel,
    setSttCustomModel,
    sttCustomLanguage,
    setSttCustomLanguage,
    sttZhScript,
    setSttZhScript,
    allowUnverifiedCliInstall,
    setAllowUnverifiedCliInstall,
    lastCliChecksumVerified,
    setLastCliChecksumVerified,
    subagentsEnabled,
    setSubagentsEnabled,
    subagentWorktreeSnapshotEnabled,
    setSubagentWorktreeSnapshotEnabled,
    autoWakeEnabled,
    setAutoWakeEnabled,
    workflowsEnabled,
    setWorkflowsEnabled,
    planEnabled,
    setPlanEnabled,
    todoGateEnabled,
    setTodoGateEnabled,
    todoGateMaxFiresPerPrompt,
    setTodoGateMaxFiresPerPrompt,
    disableWebSearch,
    setDisableWebSearch,
    noAskUser,
    setNoAskUser,
    disallowedTools,
    setDisallowedTools,
    allowedTools,
    setAllowedTools,
    useLeader,
    setUseLeader,
    reopenLastSession,
    setReopenLastSession,
    closeToTray,
    setCloseToTray,
    keepTrayForSchedules,
    setKeepTrayForSchedules,
    launchAtLogin,
    setLaunchAtLogin,
    notifyOnTurnDone,
    setNotifyOnTurnDone,
    notifyOnPermission,
    setNotifyOnPermission,
    notifyPrefsRef,
    lastSessionId,
    setLastSessionId,
    manualCliPath,
    setManualCliPath,
    hydrateFromSettings,
  };
}
