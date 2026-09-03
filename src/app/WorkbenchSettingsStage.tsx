/**
 * Settings overlay stage. Navigation lives in useSettingsNavigation;
 * prefs hydrate in useAppSettingsPrefs. This file owns the SettingsPage
 * prop surface.
 */
import { SettingsPage } from "@/components/SettingsPage";
import { UiErrorBoundary } from "@/components/UiErrorBoundary";
import { saveMessageTimestampsPref } from "@/lib/messageTimestampsPref";
import { saveShowReplyLengthPref } from "@/lib/messageLength";
import { saveReplaceProviderBrandLogoPref } from "@/lib/replaceProviderBrandLogoPref";
import { saveWelcomeMotionPref } from "@/lib/welcomeMotionPref";
import { saveMessageTimeFormatPref } from "@/lib/messageTimeFormatPref";
import { saveSidebarShowRelativeTimePref } from "@/lib/sidebarShowRelativeTimePref";
import { writeOpenTargetStorage } from "@/lib/openEditorHonesty";
import { saveNotifySoundPref } from "@/lib/notifySound";
import { saveWindowAlwaysOnTopPref } from "@/lib/windowAlwaysOnTop";
import { savePermissionTimeoutSec } from "@/lib/permissionTimeout";
import { saveAskUserTimeoutSec } from "@/lib/askUserTimeout";
import { IDLE_SNAPSHOT } from "@/lib/session";
import { normalizeSessionDataMode } from "@/lib/sessionDataMode";
import {
  normalizeCompactionDetail,
  normalizeCompactionMode,
} from "@/lib/compactionMode";
import { saveTrayBusyBadgePref } from "@/lib/trayBusyBadgePref";
import { saveWinTaskbarOverlayPref } from "@/lib/winTaskbarOverlayPref";
import { saveGoalOrchUiEnabled } from "@/lib/goalOrch";
import * as api from "@/lib/api";
import {
  parseLocalePreference,
  resolveLocalePreference,
} from "@/i18n";
import { isValidPolicy, isValidPrefsScope } from "@/lib/grokCatalog";
import { mapProbeToCliInfo } from "@/lib/cliVersionStatus";
import type { SessionRow } from "@/lib/app/sidebarModels";

export type WorkbenchSettingsStageProps = {
  [key: string]: any;
};

export function WorkbenchSettingsStage(p: WorkbenchSettingsStageProps) {
  const {
    account, accountBusy, accountHeatmapError, accountLoading, accountProbeError, acpServerAddr,
    activeAccountId, activeProject, agentCatalog, agentIdleMinutes, agentProfilePath, agentsJson,
    allowUnverifiedCliInstall, allowedTools, applyComposerPrefs, applyGlobalSandboxProfile, applyPermissionPolicy, applySkinChoice,
    applyThemeChoice, applyThemeScheduleChoice, applyWallpaperAdjustChoice, applyWallpaperChoice, applyWallpaperMediaSize, applyWallpaperScrimChoice, applyWallpaperBlurChoice,
    archivedGroups, askUserTimeoutSec, auditLedgerRetentionDays, autoWakeEnabled, availableModels, backgroundWaitPolicy,
    backgroundWaitTimeoutSec, cancelAccountLogin, cliAgentSkewRepairing, cliInfo, closeToTray, compactionDetail,
    compactionMode, confirmArchiveOlderThan, defaultOpenTarget, deleteSessionsConfirm, disableWebSearch, disallowedTools,
    effectiveProjectPath, experimentalMemory, goalOrchUiEnabled, handleClearAllSessionMutes, handleClearAllSessionUnread, importChatTranscript,
    includePartialMessages, keepTrayForSchedules, lastCliChecksumVerified, lastProcessLimit, launchAtLogin, locale,
    localePreference, loginHint, manualCliPath, maxAgentTurns, maxConcurrentAgents, messageTimeFormat,
    mutedSessionIds, navigateSettings, navigateWorkbench, noAskUser, notifyOnPermission, notifyOnTurnDone,
    notifySound, openAsidePane, openBatchAgents, openDoctor, openReliability, openSandboxWizardGuide,
    permissionTimeoutSec, phoneLayout, planEnabled, policy, prHubHighlightPr, preferredAgent,
    prefsScope, projects, proxyMode, proxyNoProxy, proxyUrl, refreshAccount,
    refreshProviderRoute, refreshSessions, refreshVoiceGate, reopenLastSession, replaceProviderBrandLogo, restoreSessions,
    runAccountLogin, runAccountLogout, runAddAccount, runRemoveAccount, runSaveAccount, runSwitchAccount,
    sandboxProfile, savedAccounts, session, sessionDataMode, sessions, setAcpServerAddr,
    setAgentIdleMinutes, setAgentProfilePath, setAgentsJson, setAllowUnverifiedCliInstall, setAllowedTools, setAppDialog,
    setAskUserTimeoutSec, setAuditLedgerRetentionDays, setAutoWakeEnabled, setBackgroundWaitPolicy, setBackgroundWaitTimeoutSec, setCliAgentSkewRepairing,
    setCliInfo, setCloseToTray, setCompactionDetail, setCompactionMode, setDefaultOpenTarget, setDisableWebSearch,
    setDisallowedTools, setExperimentalMemory, setGoalOrchUiEnabled, setIncludePartialMessages, setKeepTrayForSchedules, setLaunchAtLogin,
    setLocale, setLocalePreference, setManualCliPath, setMaxAgentTurns, setMaxConcurrentAgents, setMessageTimeFormat,
    setNoAskUser, setNotifyOnPermission, setNotifyOnTurnDone, setNotifySound, setPermissionTimeoutSec, setPlanEnabled,
    setPreferredAgent, setPrefsScope, setProviderBalanceCache, setProxyMode, setProxyNoProxy, setProxyUrl,
    setReopenLastSession, setReplaceProviderBrandLogo, setResourceOpenTarget, setSession, setSessionDataMode, setSettingsFocusAnchor,
    setSetup, setShowMessageTimestamps, setShowProductTutorial, setShowReplyLength, setShowShortcuts, setSidebarShowRelativeTime,
    setSkillsReloadToken, setStoreApiKeysInKeychain, setStreamStallSeconds, setSttCustomBaseUrl, setSttCustomLanguage, setSttCustomModel,
    setSttEngine, setSttZhScript, setSubagentWorktreeSnapshotEnabled, setSubagentsEnabled, setToast, setTodoGateEnabled,
    setTodoGateMaxFiresPerPrompt, setTrayBusyBadge, setTwoPassCompactionEnabled, setUseLeader, setVoiceDictationAutoSend, setVoiceId,
    setVoiceKeepAgentsOnEnd, setWinTaskbarOverlay, setWindowAlwaysOnTop, setWorkflowsEnabled, setZenModeEnabled, settingsFocusAnchor,
    settingsLabels, settingsSection, settingsTab, showMessageTimestamps, showReplyLength,
    showToast, sidebarShowRelativeTime, skin, storeApiKeysInKeychain, streamStallSeconds, sttCustomBaseUrl,
    sttCustomLanguage, sttCustomModel, sttEngine, sttZhScript, subagentWorktreeSnapshotEnabled, subagentsEnabled,
    submitAccountLoginCode, theme, themePreference, themeSchedule, todoGateEnabled, todoGateMaxFiresPerPrompt,
    tr, trayBusyBadge, trayHandlersRef, twoPassCompactionEnabled, unreadSessionIds, useLeader,
    voiceDictationAutoSend, voiceId, voiceKeepAgentsOnEnd, wallpaperRecord, wallpaperScrim, wallpaperBlur, wallpaperUrl,
    winTaskbarOverlay, windowAlwaysOnTop, workflowsEnabled, zenMode,
    welcomeMotionEnabled, setWelcomeMotionEnabled,
  } = p;
  return (
        <div
          className="app-settings-stage is-open"
          data-testid="settings-stage"
        >
          <UiErrorBoundary
            resetKey={`${settingsSection ?? ""}:${settingsTab ?? ""}`}
            labels={{
              title: tr("ui.errorBoundary.title"),
              body: tr("ui.errorBoundary.settingsBody"),
              retry: tr("ui.errorBoundary.retry"),
            }}
          >
          <SettingsPage
          section={settingsSection}
          tab={settingsTab}
          onSection={(id, nextTab) => {
          navigateSettings(id, nextTab);
          }}
          onBack={navigateWorkbench}
          phoneLayout={phoneLayout}
          focusAnchorId={settingsFocusAnchor}
          prHubHighlightPr={prHubHighlightPr}
          onFocusAnchorConsumed={() => setSettingsFocusAnchor(null)}
          labels={settingsLabels}
          locale={locale}
          localePreference={localePreference}
          onLocale={(v) => {
          const pref = parseLocalePreference(v);
          setLocalePreference(pref);
          const next = resolveLocalePreference(pref);
          setLocale(next);
          void api.settingsGet().then(async (s) => {
          // Persist preference including "system" (not the resolved catalog id).
          await api.settingsSet({ ...s, locale: pref });
          // settings_set also refreshes tray; call again so UI stays in sync if invoke fails mid-way.
          void api.trayRefresh();
          });
          }}
          theme={theme}
          themePreference={themePreference}
          onTheme={applyThemeChoice}
          themeSchedule={themeSchedule}
          onThemeSchedule={applyThemeScheduleChoice}
          showMessageTimestamps={showMessageTimestamps}
          onShowMessageTimestamps={(v) => {
          saveMessageTimestampsPref(v, localStorage);
          setShowMessageTimestamps(v);
          }}
          showReplyLength={showReplyLength}
          onShowReplyLength={(v) => {
          saveShowReplyLengthPref(v, localStorage);
          setShowReplyLength(v);
          }}
          replaceProviderBrandLogo={replaceProviderBrandLogo}
          onReplaceProviderBrandLogo={(v) => {
          saveReplaceProviderBrandLogoPref(v, localStorage);
          setReplaceProviderBrandLogo(v);
          }}
          welcomeMotionEnabled={welcomeMotionEnabled}
          onWelcomeMotionEnabled={(v) => {
          saveWelcomeMotionPref(v, localStorage);
          setWelcomeMotionEnabled(v);
          }}
          goalOrchUiEnabled={goalOrchUiEnabled}
          onGoalOrchUiEnabled={(v) => {
          saveGoalOrchUiEnabled(v, localStorage);
          setGoalOrchUiEnabled(v);
          }}
          messageTimeFormat={messageTimeFormat}
          onMessageTimeFormat={(v) => {
          saveMessageTimeFormatPref(v, localStorage);
          setMessageTimeFormat(v);
          }}
          sidebarShowRelativeTime={sidebarShowRelativeTime}
          onSidebarShowRelativeTime={(v) => {
          saveSidebarShowRelativeTimePref(v, localStorage);
          setSidebarShowRelativeTime(v);
          }}
          mutedSessionCount={mutedSessionIds.size}
          onClearAllSessionMutes={handleClearAllSessionMutes}
          unreadSessionCount={unreadSessionIds.size}
          onClearAllSessionUnread={handleClearAllSessionUnread}
          zenMode={zenMode}
          onZenMode={setZenModeEnabled}
          skin={skin}
          onSkin={applySkinChoice}
          wallpaperUrl={wallpaperUrl}
          wallpaperKind={wallpaperRecord?.kind ?? null}
          wallpaperFocus={wallpaperRecord?.focus ?? null}
          wallpaperClip={wallpaperRecord?.clip ?? null}
          wallpaperMediaSize={
          wallpaperRecord?.width && wallpaperRecord?.height
          ? { w: wallpaperRecord.width, h: wallpaperRecord.height }
          : null
          }
          onWallpaper={applyWallpaperChoice}
          onWallpaperAdjust={applyWallpaperAdjustChoice}
          onWallpaperMediaSize={applyWallpaperMediaSize}
          wallpaperScrim={wallpaperScrim}
          onWallpaperScrim={applyWallpaperScrimChoice}
          wallpaperBlur={wallpaperBlur}
          onWallpaperBlur={applyWallpaperBlurChoice}
          sessionDataMode={sessionDataMode}
          onCliSessionsImported={() => {
          void refreshSessions();
          }}
          onOpenCliSession={(appSessionId) => {
          void (async () => {
          await refreshSessions();
          trayHandlersRef.current.openSessionById(appSessionId);
          })();
          }}
          onSessionDataMode={(v) => {
          const mode = normalizeSessionDataMode(v);
          const commit = () => {
          setSessionDataMode(mode);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, sessionDataMode: mode }),
          );
          };
          // Tauri WebView: window.confirm is unreliable (often always false).
          if (v === "shared") {
          setAppDialog({
          kind: "confirm",
          title: tr("settings.sessionDataMode"),
          message: tr("settings.sharedConfirm"),
          confirmLabel: tr("common.confirm"),
          onConfirm: commit,
          });
          return;
          }
          commit();
          }}
          policy={policy}
          onPolicy={(v) => {
          if (!isValidPolicy(v)) return;
          applyPermissionPolicy(v);
          }}
          prefsScope={prefsScope}
          onPrefsScope={(v) => {
          if (!isValidPrefsScope(v)) return;
          setPrefsScope(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, composerPrefsScope: v }),
          );
          void api
          .composerPrefsResolve({
          projectId: activeProject?.id ?? null,
          sessionId: session.sessionId ?? null,
          })
          .then((prefs) => applyComposerPrefs(prefs, availableModels))
          .catch(() => {});
          }}
          availableModels={availableModels}
          manualCliPath={manualCliPath}
          onManualCliPath={setManualCliPath}
          onCliBlur={(v) => {
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, manualCliPath: v || null }),
          );
          void api.probeCli(v || undefined).then((cli) => {
          setCliInfo(mapProbeToCliInfo(cli));
          setSetup((prev: { auth?: boolean }) => ({
          ...prev,
          cli: cli.found,
          auth: prev.auth || !!cli.cliAuthPresent,
          }));
          });
          }}
          allowUnverifiedCliInstall={allowUnverifiedCliInstall}
          lastCliChecksumVerified={lastCliChecksumVerified}
          onAllowUnverifiedCliInstall={(v) => {
          setAllowUnverifiedCliInstall(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, allowUnverifiedCliInstall: v }),
          );
          }}
          acpServerAddr={acpServerAddr}
          onAcpServerAddr={setAcpServerAddr}
          onAcpServerBlur={(v) => {
          setAcpServerAddr(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, acpServerAddr: v.trim() || null }),
          );
          }}
          proxyMode={proxyMode}
          onProxyMode={(v) => {
          setProxyMode(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, proxyMode: v }),
          );
          }}
          proxyUrl={proxyUrl}
          onProxyUrl={(v) => {
          setProxyUrl(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, proxyUrl: v.trim() || null }),
          );
          }}
          proxyNoProxy={proxyNoProxy}
          onProxyNoProxy={(v) => {
          setProxyNoProxy(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, proxyNoProxy: v.trim() || null }),
          );
          }}
          maxConcurrentAgents={maxConcurrentAgents}
          onMaxConcurrentAgents={(v) => {
          setMaxConcurrentAgents(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, maxConcurrentAgents: v }),
          );
          }}
          lastProcessLimit={lastProcessLimit}
          agentIdleMinutes={agentIdleMinutes}
          onAgentIdleMinutes={(v) => {
          setAgentIdleMinutes(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, agentIdleMinutes: v }),
          );
          }}
          streamStallSeconds={streamStallSeconds}
          onStreamStallSeconds={(v) => {
          setStreamStallSeconds(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, streamStallSeconds: v }),
          );
          }}
          auditLedgerRetentionDays={auditLedgerRetentionDays}
          onAuditLedgerRetentionDays={(v) => {
          const n = v === 7 || v === 30 || v === 90 ? v : 0;
          setAuditLedgerRetentionDays(n);
          void api
          .settingsGet()
          .then((s) =>
          api.settingsSet({ ...s, auditLedgerRetentionDays: n }),
          );
          }}
          includePartialMessages={includePartialMessages}
          onIncludePartialMessages={(v) => {
          setIncludePartialMessages(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, includePartialMessages: v }),
          );
          }}
          maxAgentTurns={maxAgentTurns}
          onMaxAgentTurns={(v) => {
          const n = v > 0 ? Math.min(200, Math.round(v)) : 0;
          setMaxAgentTurns(n);
          void api.settingsGet().then((s) =>
          api.settingsSet({
          ...s,
          // null clears the optional field; 0 would also omit on spawn.
          maxAgentTurns: n > 0 ? n : null,
          }),
          );
          }}
          backgroundWaitPolicy={backgroundWaitPolicy}
          onBackgroundWaitPolicy={(v) => {
          const next =
          v === "no_wait" || v === "timeout" ? v : "wait";
          setBackgroundWaitPolicy(next);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, backgroundWaitPolicy: next }),
          );
          }}
          backgroundWaitTimeoutSec={backgroundWaitTimeoutSec}
          onBackgroundWaitTimeoutSec={(v) => {
          const n = Math.min(3600, Math.max(1, Math.round(v)));
          setBackgroundWaitTimeoutSec(n);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, backgroundWaitTimeoutSec: n }),
          );
          }}
          storeApiKeysInKeychain={storeApiKeysInKeychain}
          onStoreApiKeysInKeychain={(v) => {
          const prev = storeApiKeysInKeychain;
          setStoreApiKeysInKeychain(v);
          void api
          .settingsGet()
          .then((s) =>
          api.settingsSet({ ...s, storeApiKeysInKeychain: v }),
          )
          .catch((e) => {
          setStoreApiKeysInKeychain(prev);
          showToast(String(e), 4500);
          });
          }}
          sandboxProfile={sandboxProfile}
          onSandboxProfile={(v) => {
          applyGlobalSandboxProfile(v);
          }}
          onOpenSandboxWizard={openSandboxWizardGuide}
          preferredAgent={preferredAgent}
          onPreferredAgent={(v) => {
          setPreferredAgent(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, preferredAgent: v }),
          );
          }}
          agentProfilePath={agentProfilePath}
          onAgentProfilePath={setAgentProfilePath}
          onAgentProfilePathCommit={(v) => {
          const next = (v || "").trim();
          setAgentProfilePath(next);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, agentProfilePath: next }),
          );
          }}
          agentsJson={agentsJson}
          onAgentsJson={setAgentsJson}
          onAgentsJsonCommit={async (v) => {
          const next = (v || "").trim();
          setAgentsJson(next);
          const s = await api.settingsGet();
          await api.settingsSet({ ...s, agentsJson: next });
          }}
          agentCatalog={agentCatalog}
          experimentalMemory={experimentalMemory}
          onExperimentalMemory={(v) => {
          setExperimentalMemory(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, experimentalMemory: v }),
          );
          }}
          compactionMode={compactionMode}
          onCompactionMode={(v) => {
          const next = normalizeCompactionMode(v);
          setCompactionMode(next);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, compactionMode: next }),
          );
          }}
          compactionDetail={compactionDetail}
          onCompactionDetail={(v) => {
          const next = normalizeCompactionDetail(v);
          setCompactionDetail(next);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, compactionDetail: next }),
          );
          }}
          twoPassCompactionEnabled={twoPassCompactionEnabled}
          onTwoPassCompactionEnabled={(v) => {
          setTwoPassCompactionEnabled(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, twoPassCompactionEnabled: v }),
          );
          }}
          voiceId={voiceId}
          onVoiceId={(v) => {
          const next = (v || "eve").trim() || "eve";
          setVoiceId(next);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, voiceId: next }),
          );
          }}
          voiceDictationAutoSend={voiceDictationAutoSend}
          onVoiceDictationAutoSend={(v) => {
          setVoiceDictationAutoSend(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, voiceDictationAutoSend: v }),
          );
          }}
          voiceKeepAgentsOnEnd={voiceKeepAgentsOnEnd}
          onVoiceKeepAgentsOnEnd={(v) => {
          setVoiceKeepAgentsOnEnd(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, voiceKeepAgentsOnEnd: v }),
          );
          }}
          sttEngine={sttEngine}
          onSttEngine={(v) => {
          const next = (v || "official").trim() || "official";
          setSttEngine(next);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, sttEngine: next }),
          );
          }}
          sttCustomBaseUrl={sttCustomBaseUrl}
          onSttCustomBaseUrl={(v) => {
          const next = (v || "").trim();
          setSttCustomBaseUrl(next);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, sttCustomBaseUrl: next }),
          );
          }}
          sttCustomModel={sttCustomModel}
          onSttCustomModel={(v) => {
          const next = (v || "").trim();
          setSttCustomModel(next);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, sttCustomModel: next }),
          );
          }}
          sttCustomLanguage={sttCustomLanguage}
          onSttCustomLanguage={(v) => {
          const next = (v || "").trim();
          setSttCustomLanguage(next);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, sttCustomLanguage: next }),
          );
          }}
          sttZhScript={sttZhScript}
          onSttZhScript={(v) => {
          const next = (v || "auto").trim() || "auto";
          setSttZhScript(next);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, sttZhScript: next }),
          );
          }}
          subagentsEnabled={subagentsEnabled}
          onSubagentsEnabled={(v) => {
          setSubagentsEnabled(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, subagentsEnabled: v }),
          );
          }}
          subagentWorktreeSnapshotEnabled={subagentWorktreeSnapshotEnabled}
          onSubagentWorktreeSnapshotEnabled={(v) => {
          setSubagentWorktreeSnapshotEnabled(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, subagentWorktreeSnapshotEnabled: v }),
          );
          }}
          autoWakeEnabled={autoWakeEnabled}
          onAutoWakeEnabled={(v) => {
          setAutoWakeEnabled(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, autoWakeEnabled: v }),
          );
          }}
          workflowsEnabled={workflowsEnabled}
          onWorkflowsEnabled={(v) => {
          setWorkflowsEnabled(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, workflowsEnabled: v }),
          );
          }}
          planEnabled={planEnabled}
          onPlanEnabled={(v) => {
          setPlanEnabled(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, planEnabled: v }),
          );
          }}
          todoGateEnabled={todoGateEnabled}
          onTodoGateEnabled={(v) => {
          setTodoGateEnabled(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, todoGateEnabled: v }),
          );
          }}
          todoGateMaxFiresPerPrompt={todoGateMaxFiresPerPrompt}
          // Host has no fire-activity channel yet — Settings shows honest N/A.
          todoGateFireSignal={null}
          onTodoGateMaxFiresPerPrompt={(v) => {
          const n =
          typeof v === "number" && Number.isFinite(v) && v > 0
          ? Math.min(20, Math.max(1, Math.round(v)))
          : 3;
          setTodoGateMaxFiresPerPrompt(n);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, todoGateMaxFiresPerPrompt: n }),
          );
          }}
          disableWebSearch={disableWebSearch}
          onDisableWebSearch={(v) => {
          setDisableWebSearch(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, disableWebSearch: v }),
          );
          }}
          noAskUser={noAskUser}
          onNoAskUser={(v) => {
          setNoAskUser(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, noAskUser: v }),
          );
          }}
          disallowedTools={disallowedTools}
          onDisallowedTools={(v) => {
          setDisallowedTools(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, disallowedTools: v }),
          );
          }}
          allowedTools={allowedTools}
          onAllowedTools={(v) => {
          setAllowedTools(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, allowedTools: v }),
          );
          }}
          useLeader={useLeader}
          onUseLeader={(v) => {
          setUseLeader(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, useLeader: v }),
          );
          }}
          reopenLastSession={reopenLastSession}
          onReopenLastSession={(v) => {
          setReopenLastSession(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, reopenLastSession: v }),
          );
          }}
          closeToTray={closeToTray}
          onCloseToTray={(v) => {
          setCloseToTray(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, closeToTray: v }),
          );
          }}
          keepTrayForSchedules={keepTrayForSchedules}
          onKeepTrayForSchedules={(v) => {
          setKeepTrayForSchedules(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, keepTrayForSchedules: v }),
          );
          }}
          trayBusyBadge={trayBusyBadge}
          trayBusyCount={unreadSessionIds.size}
          onTrayBusyBadge={(v) => {
          saveTrayBusyBadgePref(v, localStorage);
          setTrayBusyBadge(v);
          }}
          winTaskbarOverlay={winTaskbarOverlay}
          onWinTaskbarOverlay={(v) => {
          saveWinTaskbarOverlayPref(v, localStorage);
          setWinTaskbarOverlay(v);
          }}
          launchAtLogin={launchAtLogin}
          onLaunchAtLogin={(v) => {
          setLaunchAtLogin(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, launchAtLogin: v }).catch(() => {
          // Host rolls back AppSettings when OS login-item update fails.
          setLaunchAtLogin(!v);
          }),
          );
          }}
          windowAlwaysOnTop={windowAlwaysOnTop}
          onWindowAlwaysOnTop={(v) => {
          saveWindowAlwaysOnTopPref(v, localStorage);
          setWindowAlwaysOnTop(v);
          }}
          notifyOnTurnDone={notifyOnTurnDone}
          onNotifyOnTurnDone={(v) => {
          setNotifyOnTurnDone(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, notifyOnTurnDone: v }),
          );
          }}
          notifyOnPermission={notifyOnPermission}
          onNotifyOnPermission={(v) => {
          setNotifyOnPermission(v);
          void api.settingsGet().then((s) =>
          api.settingsSet({ ...s, notifyOnPermission: v }),
          );
          }}
          notifySound={notifySound}
          onNotifySound={(v) => {
          saveNotifySoundPref(v, localStorage);
          setNotifySound(v);
          }}
          permissionTimeoutSec={permissionTimeoutSec}
          onPermissionTimeoutSec={(v) => {
          savePermissionTimeoutSec(v, localStorage);
          setPermissionTimeoutSec(v);
          }}
          askUserTimeoutSec={askUserTimeoutSec}
          onAskUserTimeoutSec={(v) => {
          saveAskUserTimeoutSec(v, localStorage);
          setAskUserTimeoutSec(v);
          }}
          cliInfo={cliInfo}
          onCliInfoRefresh={(cli) => {
            setCliInfo(mapProbeToCliInfo(cli));
          }}
          cliAgentSkewRepairing={cliAgentSkewRepairing}
          onCliRepairAgentSidecar={async () => {
            if (cliAgentSkewRepairing) {
              return { ok: false, error: "busy" };
            }
            setCliAgentSkewRepairing(true);
            try {
              const r = await api.cliRepairAgentSidecar(cliInfo.path);
              const again = await api.probeCli(
                manualCliPath || cliInfo.path || undefined,
              );
              setCliInfo(mapProbeToCliInfo(again));
              return {
                ok: !!r.ok && !again.agentBinarySkew,
                agentVersion:
                  again.agentVersion ?? r.agentVersion ?? again.version,
                error: again.agentBinarySkew
                  ? "still_skewed"
                  : null,
              };
            } catch (e) {
              return {
                ok: false,
                error: e instanceof Error ? e.message : String(e),
              };
            } finally {
              setCliAgentSkewRepairing(false);
            }
          }}
          onDoctor={() => void openDoctor()}
          onOpenReliability={() => openReliability()}
          onOpenBatchAgents={() => openBatchAgents()}
          costRollupSessions={sessions.map((s: SessionRow) => ({
          id: s.id,
          projectId: s.projectId,
          title: s.title,
          modelId: s.modelId,
          updatedAt: s.updatedAt,
          }))}
          costRollupProjects={projects.map((p: { id: string; name: string }) => ({
          id: p.id,
          name: p.name,
          }))}
          onOpenShortcutsHelp={() => setShowShortcuts(true)}
          onOpenProductTutorial={() => setShowProductTutorial(true)}
          versionFooter={tr("app.versionFooter")}
          account={account}
          accountLoading={accountLoading}
          accountBusy={accountBusy}
          accountHeatmapError={accountHeatmapError}
          accountProbeError={accountProbeError}
          loginHint={loginHint}
          savedAccounts={savedAccounts}
          activeAccountId={activeAccountId}
          onAccountLoginOauth={() => void runAccountLogin("oauth")}
          onAccountLoginDevice={() => void runAccountLogin("device")}
          onAccountLoginSubmitCode={(code) => void submitAccountLoginCode(code)}
          onCancelLogin={() => void cancelAccountLogin()}
          onAccountLogout={() => void runAccountLogout()}
          onAccountRefresh={() => void refreshAccount({ refreshBilling: true })}
          onAccountManageUsage={() => void api.accountOpenUsage()}
          onAccountSubscribe={() => void api.accountOpenSubscribe()}
          onSaveAccount={() => void runSaveAccount()}
          onAddAccount={() => void runAddAccount()}
          onSwitchAccount={(id) => void runSwitchAccount(id)}
          onRemoveAccount={(id) => void runRemoveAccount(id)}
          onImportChat={() => void importChatTranscript()}
          defaultOpenTarget={defaultOpenTarget}
          onDefaultOpenTarget={(v) => {
            setDefaultOpenTarget(v);
            writeOpenTargetStorage(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, defaultOpenTarget: v }),
            );
          }}
          archivedGroups={archivedGroups}
          onRestoreArchivedSessions={(ids) => {
          const rows = ids
          .map((id) => sessions.find((x: SessionRow) => x.id === id))
          .filter((s): s is SessionRow => !!s);
          void restoreSessions(rows);
          }}
          onDeleteArchivedSessions={(ids) => {
          const rows = ids
          .map((id) => sessions.find((x: SessionRow) => x.id === id))
          .filter((s): s is SessionRow => !!s);
          deleteSessionsConfirm(rows);
          }}
          onArchiveOlderThan={(days) => {
          confirmArchiveOlderThan(days);
          }}
          archiveAgeSessions={sessions}
          projectPath={effectiveProjectPath}
          onOpenProjectFileInResources={({ path, relativePath, line }) => {
          const targetPath = (path || relativePath || "").trim();
          if (!targetPath) return;
          navigateWorkbench();
          openAsidePane();
          setResourceOpenTarget({
          type: "file",
          path: targetPath,
          title: relativePath || targetPath,
          line: line ?? null,
          });
          }}
          onSkillsPrefsChanged={() =>
          setSkillsReloadToken((n: number) => n + 1)
          }
          trustedProjects={projects
          .filter((p: { trusted?: boolean }) => p.trusted)
          .map((p: { id: string; name: string; path: string }) => ({ id: p.id, name: p.name, path: p.path }))}
          onProvidersChanged={() => {
          // CRUD on provider list / models / efforts — keep composer menu in sync.
          void refreshProviderRoute();
          }}
          onProviderBalanceLoaded={(providerId, result) => {
            if (!result.ok) return;
            setProviderBalanceCache({
              providerId,
              fetchedAt: Date.now(),
              result,
            });
          }}
          onProviderActivated={() => {
          // Host already recycled warm agents on upsert/activate. Refresh UI
          // chrome only — never park (sessionDisconnect) a live process: that
          // kept stale OIDC/config in memory and required a full app restart
          // (issue #376). Soft-fail so save UI never sticks on “Saving…”.
          void (async () => {
          try {
          if (api.isTauri()) {
          setSession({ ...IDLE_SNAPSHOT });
          }
          await refreshProviderRoute();
          // #557: custom activate may flip session_data_mode → independent.
          try {
            const s = await api.settingsGet();
            if (s?.sessionDataMode) {
              setSessionDataMode(
                s.sessionDataMode === "shared" ? "shared" : "independent",
              );
            }
          } catch {
            /* soft-fail mode refresh */
          }
          await refreshAccount({ refreshBilling: false }).catch(() => {
          /* soft-fail billing refresh */
          });
          await refreshVoiceGate().catch(() => {
          /* soft-fail voice gate */
          });
        } catch (e) {
          setToast(
          tr("prov.savedApplyFailed", { detail: String(e) }),
          );
          window.setTimeout(() => setToast(null), 4800);
          }
          })();
          }}
          />
          </UiErrorBoundary>
        </div>
  );
}
