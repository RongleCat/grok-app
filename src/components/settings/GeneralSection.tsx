/**
 * Settings → general section (consumes SettingsModel context).
 */
import { useSettingsModel } from "@/providers/SettingsModelContext";
import type { SettingsViewModel } from "./types";

import { Select } from "@/components/Select";
import {
  IconLanguage,
  IconShield,
} from "@/components/icons";
import {
  COMMON_DISALLOWED_TOOLS,
  isToolDisallowed,
  isWebSearchTool,
  normalizeDisallowedTools,
  parseDisallowedToolsInput,
  toggleDisallowedTool,
} from "@/lib/disallowedTools";
import { parseAgentsJson } from "@/lib/agentsJson";
import {
  COMMON_ALLOWED_TOOLS,
  bothToolListsSet,
  isToolAllowed,
  normalizeAllowedTools,
  parseAllowedToolsInput,
  toggleAllowedTool,
} from "@/lib/allowedTools";
import { detectAppPlatform } from "@/lib/appPlatform";
import {
  DEFAULT_SANDBOX_PROFILE,
  RECOMMENDED_SANDBOX_PROFILE,
  SANDBOX_MIN_CLI,
  childNetworkRestrictApplies,
  sandboxIsolationActive,
  sandboxProfileSelectOptions,
  sandboxProfileHelpKey,
  sandboxSoftFailKind,
  sandboxSoftFailMessageKey,
} from "@/lib/sandboxProfile";
import {
  DEFAULT_TODO_GATE_MAX_FIRES,
  MAX_TODO_GATE_MAX_FIRES,
  MIN_TODO_GATE_MAX_FIRES,
  TODO_GATE_MIN_CLI,
  describeTodoGateSettings,
  normalizeTodoGateMaxFires,
} from "@/lib/todoGate";
import {
  COMPOSER_PREFS_SCOPES,
  PERMISSION_POLICIES,
} from "@/lib/grokCatalog";
import type { ComposerPrefsScope, PermissionPolicyId } from "@/lib/grokCatalog";
import {
  CLI_PERMISSION_MODES,
  cliPermissionModeToPolicy,
  isPolicyCliOneToOne,
  policyToCliPermissionMode,
} from "@/lib/permissionModeMap";
import {
  saveComposerSendKeyPref,
  type ComposerSendKeyPref,
} from "@/lib/composerSendKey";
import { saveComposerDraftStatsPref } from "@/lib/draftStats";
import { saveComposerSpellcheck } from "@/lib/composerSpellcheck";
import { COMPOSER_MIN_ROWS_OPTIONS } from "@/lib/composerMinRows";
import { saveVoiceHotkeyEnabled } from "@/lib/voiceHotkeyPref";
import { saveStopAllSkipConfirmPref } from "@/lib/stopAllSkipConfirmPref";
import { saveAlwaysQuitWithoutAskingPref } from "@/lib/confirmQuit";
import { normalizeHHmm } from "@/lib/notifyQuietHours";
import { PermissionRulesPanel } from "@/components/PermissionRulesPanel";
import { AgentConfigEditPanel } from "@/components/AgentConfigEditPanel";
import { MemoryBrowserPanel } from "@/components/MemoryBrowserPanel";
import { MemoryEmbedPanel } from "@/components/MemoryEmbedPanel";
import { CodebaseIndexingPanel } from "@/components/CodebaseIndexingPanel";
import { CodebaseSearchPanel } from "@/components/CodebaseSearchPanel";
import { AgentConfigTomlPanel } from "@/components/AgentConfigTomlPanel";
import { CliSessionsPanel } from "./CliSessionsPanel";
import { SettingsTabStrip, UiCheck } from "./shared";
import { resolveLocale } from "@/i18n";
import * as api from "@/lib/api";


export function GeneralSection() {
  const s = useSettingsModel() as SettingsViewModel & Record<string, any>;
  const {
    title,
    activeTab,
    agentCatalog = [],
    agentProfilePath,
    agentsJson,
    agentsJsonError,
    agentsJsonSaving,
    allowedTools,
    alwaysQuitWithoutAsking,
    askUserTimeoutSec,
    autoWakeEnabled,
    availableModels = [],
    backgroundWaitPolicy,
    backgroundWaitTimeoutSec = 600,
    clearMemoryBusy,
    cliInfo,
    closeToTray,
    compactionDetail,
    compactionMode,
    composerDraftStats,
    composerMinRows,
    composerSendKeyPref,
    composerSpellcheck,
    defaultOpenTarget = "finder",
    disableWebSearch,
    disallowedTools,
    editors,
    experimentalMemory,
    keepTrayForSchedules,
    launchAtLogin,
    locale,
    localePreference = "en",
    maxAgentTurns = 0,
    memoryBrowserEpoch,
    noAskUser,
    notifyHonesty,
    notifyOnPermission,
    notifyOnTurnDone,
    notifyPermBusy,
    notifyQuietHours,
    notifySound,
    onAgentProfilePath,
    onAgentProfilePathCommit,
    onAgentsJson,
    onAgentsJsonCommit,
    onAllowedTools,
    onAskUserTimeoutSec,
    onAutoWakeEnabled,
    onBackgroundWaitPolicy,
    onBackgroundWaitTimeoutSec,
    onCliSessionsImported,
    onCloseToTray,
    onCompactionDetail,
    onCompactionMode,
    onComposerMinRows,
    onDefaultOpenTarget,
    onDisableWebSearch,
    onDisallowedTools,
    onExperimentalMemory,
    onKeepTrayForSchedules,
    onLaunchAtLogin,
    onLocale,
    onMaxAgentTurns,
    onNoAskUser,
    onNotifyOnPermission,
    onNotifyOnTurnDone,
    onNotifyQuietHours,
    onNotifySound,
    onOpenCliSession,
    onOpenProjectFileInResources,
    onPermissionTimeoutSec,
    onPlanEnabled,
    onPolicy,
    onPreferredAgent,
    onPrefsScope,
    onReopenLastSession,
    onSandboxProfile,
    onSessionDataMode,
    onStoreApiKeysInKeychain,
    onSubagentWorktreeSnapshotEnabled,
    onSubagentsEnabled,
    onTodoGateEnabled,
    onTodoGateMaxFiresPerPrompt,
    onTrayBusyBadge,
    onTwoPassCompactionEnabled,
    onUseLeader,
    onVoiceDictationAutoSend,
    onVoiceId,
    onVoiceKeepAgentsOnEnd,
    onWindowAlwaysOnTop,
    permissionTimeoutSec,
    planEnabled,
    policy,
    preferredAgent,
    prefsScope = "global",
    reopenLastSession = true,
    requestNotifyPermission,
    testDesktopNotification,
    notifyTestBusy,
    rowHighlight,
    sandboxProfile,
    sectionNav,
    sessionDataMode,
    setAgentsJsonError,
    setAgentsJsonSaving,
    setAlwaysQuitWithoutAsking,
    setClearMemoryOpen,
    setComposerDraftStats,
    setComposerSendKeyPref,
    setComposerSpellcheck,
    setSectionTab,
    setStopAllSkipConfirm,
    setVoiceHotkeyEnabled,
    showSettingsToast,
    stopAllSkipConfirm,
    storeApiKeysInKeychain = false,
    subagentWorktreeSnapshotEnabled,
    subagentsEnabled,
    t,
    todoGateEnabled,
    todoGateFireSignal,
    todoGateMaxFiresPerPrompt,
    trayBusyBadge,
    trayBusySurface,
    twoPassCompactionEnabled,
    useLeader,
    voiceDictationAutoSend,
    voiceHotkeyEnabled,
    voiceId,
    voiceKeepAgentsOnEnd,
    windowAlwaysOnTop,
    workspaceCwd,
  } = s;

  return (
    <>
<>
            <SettingsTabStrip
              tabs={sectionNav?.tabs ?? []}
              active={activeTab}
              onChange={setSectionTab}
              ariaLabel={title}
              t={(k) => t(k)}
            />
            {activeTab === "composer" && (
            <>
            <h2 className="settings-page__h2">{t("settings.section.composer")}</h2>
            <div className="settings-card" id="settings-anchor-composer">
              {onPrefsScope && (
                <div
                  className={"settings-row settings-row--stack" + rowHighlight("settings-anchor-prefsScope")}
                  id="settings-anchor-prefsScope"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.prefsScope")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.prefsScopeDesc")}
                    </div>
                  </div>
                  <Select
                    value={prefsScope}
                    onChange={(v) => onPrefsScope(v as ComposerPrefsScope)}
                    options={COMPOSER_PREFS_SCOPES.map((s) => ({
                      value: s,
                      label: t(
                        (
                          {
                            global: "settings.prefsScope.global",
                            project: "settings.prefsScope.project",
                            session: "settings.prefsScope.session",
                          } as const
                        )[s],
                      ),
                    }))}
                  />
                </div>
              )}
              <div
                className={"settings-row settings-row--stack" + rowHighlight("settings-anchor-availableModels")}
                id="settings-anchor-availableModels"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.availableModels")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.availableModelsDesc")}
                  </div>
                </div>
                <div className="settings-models-list" role="list">
                  {availableModels.length === 0 ? (
                    <span className="settings-row__desc">
                      {t("settings.availableModelsEmpty")}
                    </span>
                  ) : (
                    availableModels.map((m) => (
                      <div
                        key={m.id}
                        className="settings-models-list__item"
                        role="listitem"
                      >
                        <span className="settings-models-list__name">
                          {m.label}
                        </span>
                        <span className="settings-models-list__id">{m.id}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div
                className={
                  "settings-row" +
                  rowHighlight("settings-anchor-composerMinRows")
                }
                id="settings-anchor-composerMinRows"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.composerMinRows")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.composerMinRowsDesc")}
                  </div>
                </div>
                <div
                  className="settings-seg"
                  role="radiogroup"
                  aria-label={t("settings.composerMinRows")}
                >
                  {COMPOSER_MIN_ROWS_OPTIONS.map((rows) => (
                    <button
                      key={rows}
                      type="button"
                      role="radio"
                      aria-checked={composerMinRows === rows}
                      className={
                        "settings-seg__btn" +
                        (composerMinRows === rows ? " is-on" : "")
                      }
                      onClick={() => onComposerMinRows(rows)}
                    >
                      {t(`settings.composerMinRows.${rows}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div
                className={
                  "settings-row settings-row--stack" +
                  rowHighlight("settings-anchor-composerSendKey")
                }
                id="settings-anchor-composerSendKey"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.composerSendKey")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.composerSendKeyDesc")}
                  </div>
                </div>
                <Select
                  value={composerSendKeyPref}
                  onChange={(v) => {
                    const next = v as ComposerSendKeyPref;
                    setComposerSendKeyPref(next);
                    saveComposerSendKeyPref(next);
                  }}
                  options={[
                    {
                      value: "enter",
                      label: t("settings.composerSendKey.enter"),
                    },
                    {
                      value: "mod-enter",
                      label: t("settings.composerSendKey.modEnter"),
                    },
                  ]}
                />
              </div>
              <div
                className={
                  "settings-row" +
                  rowHighlight("settings-anchor-composerSpellcheck")
                }
                id="settings-anchor-composerSpellcheck"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.composerSpellcheck")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.composerSpellcheckDesc")}
                  </div>
                </div>
                <UiCheck
                  checked={composerSpellcheck}
                  onChange={() => {
                    const next = !composerSpellcheck;
                    setComposerSpellcheck(next);
                    saveComposerSpellcheck(next);
                  }}
                  ariaLabel={t("settings.composerSpellcheck")}
                />
              </div>
              <div
                className={
                  "settings-row" +
                  rowHighlight("settings-anchor-composerDraftStats")
                }
                id="settings-anchor-composerDraftStats"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.composerDraftStats")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.composerDraftStatsDesc")}
                  </div>
                </div>
                <UiCheck
                  checked={composerDraftStats}
                  onChange={() => {
                    const next = !composerDraftStats;
                    setComposerDraftStats(next);
                    saveComposerDraftStatsPref(next);
                  }}
                  ariaLabel={t("settings.composerDraftStats")}
                />
              </div>
            </div>
            </>
            )}

            {activeTab === "permissions" && (
            <>
            <h2 className="settings-page__h2">{t("settings.section.permissions")}</h2>
            <div className="settings-card" id="settings-anchor-permissionRules">
              <div
                className={"settings-row settings-row--stack" + rowHighlight("settings-anchor-permissionPolicy")}
                id="settings-anchor-permissionPolicy"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    <IconShield size={16} />
                    {t("settings.permissionDeep")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.permissionDeepDesc")}
                  </div>
                </div>
                <Select
                  value={policy}
                  onChange={(v) => onPolicy(v as PermissionPolicyId)}
                  options={PERMISSION_POLICIES.map((p) => ({
                    value: p.id,
                    label: t(
                      (
                        {
                          ask: "policy.ask",
                          accept_edits: "policy.accept_edits",
                          allow_for_session: "policy.allow_for_session",
                          auto: "policy.auto",
                          dont_ask: "policy.dont_ask",
                          always_approve: "policy.always_approve",
                        } as const
                      )[p.id],
                    ),
                  }))}
                />
                <div
                  className="settings-row__desc"
                  id="settings-anchor-cliPermissionMode"
                >
                  {t("settings.permissionCliMode", {
                    mode: policyToCliPermissionMode(policy),
                  })}
                  {!isPolicyCliOneToOne(policy) ? (
                    <>
                      {" "}
                      {t("settings.permissionCliModeNotOneToOne")}
                    </>
                  ) : null}
                </div>
              </div>
              <div
                className={
                  "settings-row settings-row--stack" +
                  rowHighlight("settings-anchor-cliPermissionModeAdvanced")
                }
                id="settings-anchor-cliPermissionModeAdvanced"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.permissionCliAdvanced")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.permissionCliAdvancedDesc")}
                  </div>
                </div>
                <Select
                  value={policyToCliPermissionMode(policy)}
                  onChange={(v) => {
                    if (v === "plan") {
                      // Plan is a product session mode, not a stored policy.
                      // Keep current policy; user switches Plan from the composer.
                      return;
                    }
                    onPolicy(cliPermissionModeToPolicy(v));
                  }}
                  options={CLI_PERMISSION_MODES.map((mode) => ({
                    value: mode,
                    label: t(
                      (
                        {
                          default: "cliPermission.default",
                          acceptEdits: "cliPermission.acceptEdits",
                          auto: "cliPermission.auto",
                          dontAsk: "cliPermission.dontAsk",
                          bypassPermissions: "cliPermission.bypassPermissions",
                          plan: "cliPermission.plan",
                        } as const
                      )[mode],
                    ),
                  }))}
                />
                <div className="settings-row__desc">
                  {t("settings.permissionCliAdvancedHint", {
                    mode: policyToCliPermissionMode(policy),
                  })}
                </div>
              </div>
              {onSandboxProfile ? (
                <div
                  className={"settings-row settings-row--stack" + rowHighlight("settings-anchor-sandbox")}
                  id="settings-anchor-sandbox"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.sandboxProfile")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.sandboxProfileDesc")}
                    </div>
                  </div>
                  <Select
                    value={sandboxProfile || DEFAULT_SANDBOX_PROFILE}
                    onChange={(v) => onSandboxProfile(v)}
                    options={sandboxProfileSelectOptions().map((o) => ({
                      value: o.value,
                      label: t(o.labelKey),
                    }))}
                  />
                  <div className="settings-row__desc">
                    {t(
                      sandboxProfileHelpKey(
                        sandboxProfile || DEFAULT_SANDBOX_PROFILE,
                      ),
                    )}
                  </div>
                  {sandboxProfile === RECOMMENDED_SANDBOX_PROFILE ? (
                    <div className="settings-row__hint">
                      {t("settings.sandbox.recommendedNote")}
                    </div>
                  ) : null}
                  {(() => {
                    const platform = detectAppPlatform();
                    const soft = sandboxSoftFailKind({
                      profile: sandboxProfile,
                      cliFound: cliInfo.found,
                      cliVersion: cliInfo.version,
                      platform,
                    });
                    if (!soft) {
                      // Linux-only network note when isolation is on but soft-fail is clear.
                      if (
                        sandboxIsolationActive(sandboxProfile) &&
                        !childNetworkRestrictApplies(sandboxProfile, platform) &&
                        (sandboxProfile === "read-only" ||
                          sandboxProfile === "strict") &&
                        (platform === "mac" || platform === "other")
                      ) {
                        return (
                          <div className="settings-row__hint">
                            {t("settings.sandbox.networkLinuxOnly")}
                          </div>
                        );
                      }
                      return null;
                    }
                    return (
                      <div
                        className="settings-row__hint is-danger"
                        role="status"
                      >
                        {t(sandboxSoftFailMessageKey(soft), {
                          min: SANDBOX_MIN_CLI,
                        })}
                      </div>
                    );
                  })()}
                </div>
              ) : null}
              {onPermissionTimeoutSec ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-permissionTimeout")
                  }
                  id="settings-anchor-permissionTimeout"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.permissionTimeout")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.permissionTimeoutDesc")}
                    </div>
                  </div>
                  <Select
                    value={String(permissionTimeoutSec ?? 0)}
                    onChange={(v) => onPermissionTimeoutSec(Number(v))}
                    options={(() => {
                      const presets = [
                        {
                          value: "0",
                          label: t("settings.permissionTimeout.off"),
                        },
                        {
                          value: "30",
                          label: t("settings.permissionTimeout.30"),
                        },
                        {
                          value: "60",
                          label: t("settings.permissionTimeout.60"),
                        },
                        {
                          value: "120",
                          label: t("settings.permissionTimeout.120"),
                        },
                        {
                          value: "300",
                          label: t("settings.permissionTimeout.300"),
                        },
                      ];
                      const cur = Math.max(0, Math.round(permissionTimeoutSec ?? 0));
                      if (
                        cur > 0 &&
                        !presets.some((o) => o.value === String(cur))
                      ) {
                        return [
                          ...presets,
                          { value: String(cur), label: `${cur}s` },
                        ];
                      }
                      return presets;
                    })()}
                  />
                </div>
              ) : null}
              {onAskUserTimeoutSec ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-askUserTimeout")
                  }
                  id="settings-anchor-askUserTimeout"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.askUserTimeout")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.askUserTimeoutDesc")}
                    </div>
                  </div>
                  <Select
                    value={String(askUserTimeoutSec ?? 0)}
                    onChange={(v) => onAskUserTimeoutSec(Number(v))}
                    options={(() => {
                      const presets = [
                        {
                          value: "0",
                          label: t("settings.askUserTimeout.off"),
                        },
                        {
                          value: "30",
                          label: t("settings.askUserTimeout.30"),
                        },
                        {
                          value: "60",
                          label: t("settings.askUserTimeout.60"),
                        },
                        {
                          value: "120",
                          label: t("settings.askUserTimeout.120"),
                        },
                        {
                          value: "300",
                          label: t("settings.askUserTimeout.300"),
                        },
                      ];
                      const cur = Math.max(0, Math.round(askUserTimeoutSec ?? 0));
                      if (
                        cur > 0 &&
                        !presets.some((o) => o.value === String(cur))
                      ) {
                        return [
                          ...presets,
                          { value: String(cur), label: `${cur}s` },
                        ];
                      }
                      return presets;
                    })()}
                  />
                </div>
              ) : null}
              <PermissionRulesPanel t={t} />
            </div>
            </>
            )}

            {activeTab === "agent" && (
            <>
            <h2 className="settings-page__h2">{t("settings.section.agent")}</h2>
            <div className="settings-card" id="settings-agent-card">
              {onMaxAgentTurns ? (
                <div
                  className={"settings-row settings-row--stack" + rowHighlight("settings-anchor-maxAgentTurns")}
                  id="settings-anchor-maxAgentTurns"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.maxAgentTurns")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.maxAgentTurnsDesc")}
                    </div>
                  </div>
                  <input
                    className="settings-input"
                    type="number"
                    min={0}
                    max={200}
                    step={1}
                    placeholder={t("settings.maxAgentTurnsPlaceholder")}
                    value={maxAgentTurns > 0 ? maxAgentTurns : ""}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      if (!raw) {
                        onMaxAgentTurns(0);
                        return;
                      }
                      const n = Number(raw);
                      if (!Number.isFinite(n)) return;
                      onMaxAgentTurns(Math.min(200, Math.max(0, Math.round(n))));
                    }}
                  />
                </div>
              ) : null}
              {onBackgroundWaitPolicy ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-backgroundWait")
                  }
                  id="settings-anchor-backgroundWait"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.backgroundWaitPolicy")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.backgroundWaitPolicyDesc")}
                    </div>
                  </div>
                  <Select
                    value={
                      backgroundWaitPolicy === "no_wait" ||
                      backgroundWaitPolicy === "timeout"
                        ? backgroundWaitPolicy
                        : "wait"
                    }
                    onChange={(v) => onBackgroundWaitPolicy(v)}
                    options={[
                      {
                        value: "wait",
                        label: t("settings.backgroundWait.wait"),
                      },
                      {
                        value: "no_wait",
                        label: t("settings.backgroundWait.noWait"),
                      },
                      {
                        value: "timeout",
                        label: t("settings.backgroundWait.timeout"),
                      },
                    ]}
                    aria-label={t("settings.backgroundWaitPolicy")}
                  />
                  {backgroundWaitPolicy === "timeout" &&
                  onBackgroundWaitTimeoutSec ? (
                    <>
                      <div className="settings-row__text">
                        <div className="settings-row__label">
                          {t("settings.backgroundWaitTimeout")}
                        </div>
                        <div className="settings-row__desc">
                          {t("settings.backgroundWaitTimeoutDesc")}
                        </div>
                      </div>
                      <input
                        className="settings-input"
                        type="number"
                        min={1}
                        max={3600}
                        step={1}
                        value={
                          backgroundWaitTimeoutSec > 0
                            ? backgroundWaitTimeoutSec
                            : 600
                        }
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          const n = Number(raw);
                          if (!Number.isFinite(n)) return;
                          onBackgroundWaitTimeoutSec(
                            Math.min(3600, Math.max(1, Math.round(n))),
                          );
                        }}
                        aria-label={t("settings.backgroundWaitTimeout")}
                      />
                    </>
                  ) : null}
                </div>
              ) : null}
              {onPreferredAgent ? (
                <div
                  className={"settings-row settings-row--stack" + rowHighlight("settings-anchor-preferredAgent")}
                  id="settings-anchor-preferredAgent"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.preferredAgent")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.preferredAgentDesc")}
                    </div>
                  </div>
                  <Select
                    value={preferredAgent || ""}
                    onChange={(v) => onPreferredAgent(v)}
                    options={[
                      {
                        value: "",
                        label: t("settings.preferredAgent.default"),
                      },
                      ...agentCatalog.map((a) => {
                        const srcKey = (
                          {
                            builtin: "settings.preferredAgent.source.builtin",
                            bundled: "settings.preferredAgent.source.bundled",
                            user: "settings.preferredAgent.source.user",
                            project: "settings.preferredAgent.source.project",
                          } as const
                        )[a.source as "builtin" | "bundled" | "user" | "project"];
                        const srcLabel = srcKey ? t(srcKey) : a.source || "other";
                        return {
                          value: a.name,
                          label: `${a.name} · ${srcLabel}`,
                        };
                      }),
                    ]}
                  />
                  <div className="settings-row__desc">
                    {t("settings.preferredAgent.apply.note")}
                  </div>
                </div>
              ) : null}
              {onAgentProfilePath ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-agentProfilePath")
                  }
                  id="settings-anchor-agentProfilePath"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.agentProfilePath")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.agentProfilePathDesc")}
                    </div>
                  </div>
                  <input
                    className="settings-input"
                    value={agentProfilePath || ""}
                    placeholder={t("settings.agentProfilePathPlaceholder")}
                    onChange={(e) => onAgentProfilePath(e.target.value)}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      onAgentProfilePath(next);
                      onAgentProfilePathCommit?.(next);
                    }}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label={t("settings.agentProfilePath")}
                  />
                  <div className="settings-row__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => {
                        void api.pickAgentProfile().then((path) => {
                          if (!path) return;
                          onAgentProfilePath(path);
                          onAgentProfilePathCommit?.(path);
                        });
                      }}
                    >
                      {t("settings.agentProfilePathBrowse")}
                    </button>
                    {agentProfilePath ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          onAgentProfilePath("");
                          onAgentProfilePathCommit?.("");
                        }}
                      >
                        {t("settings.agentProfilePathClear")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div
                className={rowHighlight("settings-anchor-configTomlView")}
              >
                <AgentConfigTomlPanel locale={resolveLocale(locale)} />
              </div>
              {onAgentsJson ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-agentsJson")
                  }
                  id="settings-anchor-agentsJson"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.agentsJson")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.agentsJsonDesc")}
                    </div>
                  </div>
                  <textarea
                    className="settings-input settings-agents-json__textarea"
                    value={agentsJson || ""}
                    placeholder={t("settings.agentsJsonPlaceholder")}
                    onChange={(e) => {
                      setAgentsJsonError(null);
                      onAgentsJson(e.target.value);
                    }}
                    rows={6}
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    aria-label={t("settings.agentsJson")}
                    aria-invalid={agentsJsonError ? true : undefined}
                  />
                  {agentsJsonError ? (
                    <div
                      className="settings-row__desc is-danger"
                      role="alert"
                    >
                      {agentsJsonError}
                    </div>
                  ) : null}
                  <div className="settings-row__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={agentsJsonSaving}
                      onClick={() => {
                        const draft = agentsJson || "";
                        const parsed = parseAgentsJson(draft);
                        if (!parsed.ok) {
                          setAgentsJsonError(
                            t("settings.agentsJsonInvalid") +
                              (parsed.message ? ` ${parsed.message}` : ""),
                          );
                          return;
                        }
                        setAgentsJsonError(null);
                        const next = parsed.normalized;
                        onAgentsJson(next);
                        setAgentsJsonSaving(true);
                        void Promise.resolve(onAgentsJsonCommit?.(next))
                          .catch((e) => {
                            setAgentsJsonError(
                              String(e || t("settings.agentsJsonInvalid")),
                            );
                          })
                          .finally(() => setAgentsJsonSaving(false));
                      }}
                    >
                      {t("settings.agentsJsonApply")}
                    </button>
                    {agentsJson ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={agentsJsonSaving}
                        onClick={() => {
                          setAgentsJsonError(null);
                          onAgentsJson("");
                          setAgentsJsonSaving(true);
                          void Promise.resolve(onAgentsJsonCommit?.(""))
                            .catch((e) => {
                              setAgentsJsonError(String(e));
                            })
                            .finally(() => setAgentsJsonSaving(false));
                        }}
                      >
                        {t("settings.agentsJsonClear")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {onExperimentalMemory ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-experimentalMemory")}
                  id="settings-anchor-experimentalMemory"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.experimentalMemory")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.experimentalMemoryDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!experimentalMemory}
                    onChange={() => onExperimentalMemory(!experimentalMemory)}
                    ariaLabel={t("settings.experimentalMemory")}
                  />
                </div>
              ) : null}
              {onCompactionMode ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-compactionMode")
                  }
                  id="settings-anchor-compactionMode"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.compactionMode")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.compactionModeDesc")}
                    </div>
                  </div>
                  <Select
                    value={compactionMode || "summary"}
                    onChange={(v) => onCompactionMode(v)}
                    options={[
                      {
                        value: "summary",
                        label: t("settings.compactionMode.summary"),
                      },
                      {
                        value: "transcript",
                        label: t("settings.compactionMode.transcript"),
                      },
                      {
                        value: "segments",
                        label: t("settings.compactionMode.segments"),
                      },
                    ]}
                  />
                  <div className="settings-row__desc">
                    {(() => {
                      const helpByMode: Record<string, string> = {
                        summary: "settings.compactionMode.summary.help",
                        transcript: "settings.compactionMode.transcript.help",
                        segments: "settings.compactionMode.segments.help",
                      };
                      return t(
                        helpByMode[compactionMode || "summary"] ??
                          "settings.compactionMode.summary.help",
                      );
                    })()}
                  </div>
                </div>
              ) : null}
              {onCompactionDetail ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-compactionDetail")
                  }
                  id="settings-anchor-compactionDetail"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.compactionDetail")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.compactionDetailDesc")}
                    </div>
                  </div>
                  <Select
                    value={compactionDetail || "verbose"}
                    onChange={(v) => onCompactionDetail(v)}
                    disabled={(compactionMode || "summary") !== "segments"}
                    options={[
                      {
                        value: "none",
                        label: t("settings.compactionDetail.none"),
                      },
                      {
                        value: "minimal",
                        label: t("settings.compactionDetail.minimal"),
                      },
                      {
                        value: "balanced",
                        label: t("settings.compactionDetail.balanced"),
                      },
                      {
                        value: "verbose",
                        label: t("settings.compactionDetail.verbose"),
                      },
                    ]}
                  />
                  <div className="settings-row__desc">
                    {t("settings.compactionDetail.help")}
                  </div>
                </div>
              ) : null}
              {onTwoPassCompactionEnabled ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-twoPassCompaction")
                  }
                  id="settings-anchor-twoPassCompaction"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.twoPassCompaction")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.twoPassCompactionDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!twoPassCompactionEnabled}
                    onChange={() =>
                      onTwoPassCompactionEnabled(!twoPassCompactionEnabled)
                    }
                    ariaLabel={t("settings.twoPassCompaction")}
                  />
                </div>
              ) : null}
              {onExperimentalMemory ? (
                <div
                  className={
                    "settings-memory-browser-wrap" +
                    rowHighlight("settings-anchor-memoryBrowser")
                  }
                >
                  <MemoryBrowserPanel
                    key={memoryBrowserEpoch}
                    locale={resolveLocale(locale)}
                    projectPath={workspaceCwd}
                    experimentalMemory={!!experimentalMemory}
                    onClearAll={
                      workspaceCwd
                        ? () => setClearMemoryOpen(true)
                        : undefined
                    }
                    clearAllBusy={clearMemoryBusy}
                  />
                </div>
              ) : null}
              <div
                className={
                  "settings-memory-embed-wrap" +
                  rowHighlight("settings-anchor-memoryEmbed")
                }
              >
                <MemoryEmbedPanel
                  locale={resolveLocale(locale)}
                  onSaved={() =>
                    showSettingsToast(t("settings.memoryEmbed.saved"), 2200)
                  }
                  onError={(msg) => showSettingsToast(msg, 3200)}
                />
              </div>
              <div
                className={
                  "settings-codebase-indexing-wrap" +
                  rowHighlight("settings-anchor-codebaseIndexing")
                }
              >
                <CodebaseIndexingPanel
                  locale={resolveLocale(locale)}
                  cliVersion={cliInfo.version}
                  onSaved={() =>
                    showSettingsToast(
                      t("settings.codebaseIndexing.saved"),
                      2200,
                    )
                  }
                  onError={(msg) => showSettingsToast(msg, 3200)}
                />
              </div>
              <div
                className={
                  "settings-codebase-search-wrap" +
                  rowHighlight("settings-anchor-codebaseSearch")
                }
              >
                <CodebaseSearchPanel
                  locale={resolveLocale(locale)}
                  projectPath={workspaceCwd}
                  onOpenInResources={onOpenProjectFileInResources}
                />
              </div>
              {onSubagentsEnabled ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-subagents")}
                  id="settings-anchor-subagents"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.subagentsEnabled")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.subagentsEnabledDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!subagentsEnabled}
                    onChange={() => onSubagentsEnabled(!subagentsEnabled)}
                    ariaLabel={t("settings.subagentsEnabled")}
                  />
                </div>
              ) : null}
              {onSubagentWorktreeSnapshotEnabled ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-subagentWtSnap")
                  }
                  id="settings-anchor-subagentWtSnap"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.subagentWorktreeSnapshot")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.subagentWorktreeSnapshotDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!subagentWorktreeSnapshotEnabled}
                    onChange={() =>
                      onSubagentWorktreeSnapshotEnabled(
                        !subagentWorktreeSnapshotEnabled,
                      )
                    }
                    ariaLabel={t("settings.subagentWorktreeSnapshot")}
                  />
                </div>
              ) : null}
              {onAutoWakeEnabled ? (
                <div
                  className={
                    "settings-row" + rowHighlight("settings-anchor-autoWake")
                  }
                  id="settings-anchor-autoWake"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.autoWake")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.autoWakeDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!autoWakeEnabled}
                    onChange={() => onAutoWakeEnabled(!autoWakeEnabled)}
                    ariaLabel={t("settings.autoWake")}
                  />
                </div>
              ) : null}
              {onPlanEnabled ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-planEnabled")}
                  id="settings-anchor-planEnabled"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.planEnabled")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.planEnabledDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!planEnabled}
                    onChange={() => onPlanEnabled(!planEnabled)}
                    ariaLabel={t("settings.planEnabled")}
                  />
                </div>
              ) : null}
              {onTodoGateEnabled ? (
                (() => {
                  const todoGateView = describeTodoGateSettings({
                    enabled: todoGateEnabled,
                    maxFires: todoGateMaxFiresPerPrompt,
                    maxFiresRaw: todoGateMaxFiresPerPrompt,
                    sessionDataMode,
                    cliVersion: cliInfo.version,
                    fireSignal: todoGateFireSignal,
                  });
                  return (
                    <>
                      <div
                        className={
                          "settings-row settings-row--stack" +
                          rowHighlight("settings-anchor-todoGate")
                        }
                        id="settings-anchor-todoGate"
                      >
                        <div className="settings-row__text">
                          <div className="settings-row__label">
                            {t("settings.todoGate")}
                          </div>
                          <div className="settings-row__desc">
                            {t("settings.todoGateDesc")}
                          </div>
                        </div>
                        <UiCheck
                          checked={!!todoGateEnabled}
                          onChange={() => onTodoGateEnabled(!todoGateEnabled)}
                          ariaLabel={t("settings.todoGate")}
                        />
                        <div className="settings-row__hint" role="status">
                          {t(todoGateView.softRespawnKey)}
                        </div>
                        {todoGateView.cliSoftFailKey ? (
                          <div
                            className="settings-row__hint is-danger"
                            role="status"
                          >
                            {t(todoGateView.cliSoftFailKey, {
                              min: TODO_GATE_MIN_CLI,
                            })}
                          </div>
                        ) : null}
                        <div
                          className={
                            "settings-row__hint" +
                            (todoGateView.activity.tone === "warn"
                              ? " is-danger"
                              : "")
                          }
                          role="status"
                          data-todo-gate-activity={todoGateView.activity.kind}
                        >
                          {t(
                            todoGateView.activity.messageKey,
                            todoGateView.activity.vars,
                          )}
                        </div>
                      </div>
                      {onTodoGateMaxFiresPerPrompt ? (
                        <div
                          className={
                            "settings-row settings-row--stack" +
                            rowHighlight("settings-anchor-todoGate")
                          }
                          id="settings-anchor-todoGateMaxFires"
                        >
                          <div className="settings-row__text">
                            <div className="settings-row__label">
                              {t("settings.todoGateMaxFires")}
                            </div>
                            <div className="settings-row__desc">
                              {t("settings.todoGateMaxFiresDesc")}
                            </div>
                          </div>
                          <input
                            className="settings-input"
                            type="number"
                            min={MIN_TODO_GATE_MAX_FIRES}
                            max={MAX_TODO_GATE_MAX_FIRES}
                            step={1}
                            disabled={!todoGateEnabled}
                            value={todoGateView.maxFires}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (!raw) {
                                onTodoGateMaxFiresPerPrompt(
                                  DEFAULT_TODO_GATE_MAX_FIRES,
                                );
                                return;
                              }
                              const n = Number(raw);
                              if (!Number.isFinite(n)) return;
                              onTodoGateMaxFiresPerPrompt(
                                normalizeTodoGateMaxFires(n),
                              );
                            }}
                            aria-label={t("settings.todoGateMaxFires")}
                          />
                          <div className="settings-row__hint" role="status">
                            {t(todoGateView.effectiveKey, {
                              n: todoGateView.maxFires,
                              min: MIN_TODO_GATE_MAX_FIRES,
                              max: MAX_TODO_GATE_MAX_FIRES,
                              default: DEFAULT_TODO_GATE_MAX_FIRES,
                            })}
                          </div>
                          <div
                            className={
                              "settings-row__hint" +
                              (todoGateView.applyPath === "shared_app_only"
                                ? " is-danger"
                                : "")
                            }
                            role="status"
                          >
                            {t(todoGateView.applyPathKey)}
                          </div>
                          {todoGateView.clampedKey ? (
                            <div className="settings-row__hint" role="status">
                              {t(todoGateView.clampedKey, {
                                min: MIN_TODO_GATE_MAX_FIRES,
                                max: MAX_TODO_GATE_MAX_FIRES,
                                default: DEFAULT_TODO_GATE_MAX_FIRES,
                              })}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  );
                })()
              ) : null}
              {onDisableWebSearch ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-disableWebSearch")}
                  id="settings-anchor-disableWebSearch"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.disableWebSearch")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.disableWebSearchDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!disableWebSearch}
                    onChange={() => onDisableWebSearch(!disableWebSearch)}
                    ariaLabel={t("settings.disableWebSearch")}
                  />
                </div>
              ) : null}
              {onNoAskUser ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-noAskUser")}
                  id="settings-anchor-noAskUser"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.noAskUser")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.noAskUserDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!noAskUser}
                    onChange={() => onNoAskUser(!noAskUser)}
                    ariaLabel={t("settings.noAskUser")}
                  />
                </div>
              ) : null}
              {onAllowedTools ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-allowedTools")
                  }
                  id="settings-anchor-allowedTools"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.allowedTools")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.allowedToolsDesc")}
                    </div>
                    {bothToolListsSet(allowedTools, disallowedTools) ? (
                      <div className="settings-row__hint">
                        {t("settings.allowedTools.bothSet")}
                      </div>
                    ) : null}
                  </div>
                  <div
                    className="settings-tool-deny__chips"
                    role="group"
                    aria-label={t("settings.allowedTools")}
                  >
                    {COMMON_ALLOWED_TOOLS.map((tool) => {
                      const selected = isToolAllowed(allowedTools, tool.id);
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          className={
                            "settings-tool-deny__chip" +
                            (selected ? " is-on" : "") +
                            (tool.caution ? " is-caution" : "")
                          }
                          aria-pressed={selected}
                          title={
                            tool.caution
                              ? t("settings.allowedTools.caution")
                              : tool.id
                          }
                          onClick={() => {
                            onAllowedTools(
                              toggleAllowedTool(allowedTools, tool.id),
                            );
                          }}
                        >
                          {tool.id}
                        </button>
                      );
                    })}
                  </div>
                  <div className="settings-tool-deny__row">
                    <input
                      type="text"
                      className="settings-input settings-tool-deny__input"
                      placeholder={t("settings.allowedToolsPlaceholder")}
                      defaultValue={normalizeAllowedTools(allowedTools)
                        .filter(
                          (id) =>
                            !COMMON_ALLOWED_TOOLS.some(
                              (c) => c.id.toLowerCase() === id.toLowerCase(),
                            ),
                        )
                        .join(", ")}
                      key={normalizeAllowedTools(allowedTools)
                        .filter(
                          (id) =>
                            !COMMON_ALLOWED_TOOLS.some(
                              (c) => c.id.toLowerCase() === id.toLowerCase(),
                            ),
                        )
                        .join(",")}
                      onBlur={(e) => {
                        const custom = parseAllowedToolsInput(e.target.value);
                        const keptCommon = normalizeAllowedTools(
                          allowedTools,
                        ).filter((id) =>
                          COMMON_ALLOWED_TOOLS.some(
                            (c) => c.id.toLowerCase() === id.toLowerCase(),
                          ),
                        );
                        onAllowedTools(
                          normalizeAllowedTools([...keptCommon, ...custom]),
                        );
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                    />
                    {normalizeAllowedTools(allowedTools).length > 0 ? (
                      <button
                        type="button"
                        className="btn btn--sm settings-tool-deny__clear"
                        onClick={() => onAllowedTools([])}
                      >
                        {t("settings.allowedTools.clear")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {onDisallowedTools ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-disallowedTools")
                  }
                  id="settings-anchor-disallowedTools"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.disallowedTools")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.disallowedToolsDesc")}
                    </div>
                    {disableWebSearch ? (
                      <div className="settings-row__hint">
                        {t("settings.disallowedTools.webCovered")}
                      </div>
                    ) : null}
                    {bothToolListsSet(allowedTools, disallowedTools) ? (
                      <div className="settings-row__hint">
                        {t("settings.allowedTools.bothSet")}
                      </div>
                    ) : null}
                  </div>
                  <div
                    className="settings-tool-deny__chips"
                    role="group"
                    aria-label={t("settings.disallowedTools")}
                  >
                    {COMMON_DISALLOWED_TOOLS.map((tool) => {
                      const selected =
                        isToolDisallowed(disallowedTools, tool.id) ||
                        (!!disableWebSearch && isWebSearchTool(tool.id));
                      const coveredByWeb =
                        !!disableWebSearch && isWebSearchTool(tool.id);
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          className={
                            "settings-tool-deny__chip" +
                            (selected ? " is-on" : "") +
                            (tool.caution ? " is-caution" : "") +
                            (coveredByWeb ? " is-covered" : "")
                          }
                          aria-pressed={selected}
                          title={
                            tool.caution
                              ? t("settings.disallowedTools.caution")
                              : coveredByWeb
                                ? t("settings.disallowedTools.webCovered")
                                : tool.id
                          }
                          onClick={() => {
                            if (coveredByWeb) return;
                            onDisallowedTools(
                              toggleDisallowedTool(disallowedTools, tool.id),
                            );
                          }}
                        >
                          {tool.id}
                        </button>
                      );
                    })}
                  </div>
                  <div className="settings-tool-deny__row">
                    <input
                      type="text"
                      className="settings-input settings-tool-deny__input"
                      placeholder={t("settings.disallowedToolsPlaceholder")}
                      defaultValue={normalizeDisallowedTools(disallowedTools)
                        .filter(
                          (id) =>
                            !COMMON_DISALLOWED_TOOLS.some(
                              (c) => c.id.toLowerCase() === id.toLowerCase(),
                            ),
                        )
                        .join(", ")}
                      key={normalizeDisallowedTools(disallowedTools)
                        .filter(
                          (id) =>
                            !COMMON_DISALLOWED_TOOLS.some(
                              (c) => c.id.toLowerCase() === id.toLowerCase(),
                            ),
                        )
                        .join(",")}
                      onBlur={(e) => {
                        const custom = parseDisallowedToolsInput(e.target.value);
                        const keptCommon = normalizeDisallowedTools(
                          disallowedTools,
                        ).filter((id) =>
                          COMMON_DISALLOWED_TOOLS.some(
                            (c) => c.id.toLowerCase() === id.toLowerCase(),
                          ),
                        );
                        onDisallowedTools(
                          normalizeDisallowedTools([...keptCommon, ...custom]),
                        );
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                    />
                    {normalizeDisallowedTools(disallowedTools).length > 0 ? (
                      <button
                        type="button"
                        className="btn btn--sm settings-tool-deny__clear"
                        onClick={() => onDisallowedTools([])}
                      >
                        {t("settings.disallowedTools.clear")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {onUseLeader ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-useLeader")}
                  id="settings-anchor-useLeader"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.useLeader")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.useLeaderDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!useLeader}
                    onChange={() => onUseLeader(!useLeader)}
                    ariaLabel={t("settings.useLeader")}
                  />
                </div>
              ) : null}
              <div className={rowHighlight("settings-anchor-configTomlEdit")}>
                <AgentConfigEditPanel locale={resolveLocale(locale)} />
              </div>
            </div>
            </>
            )}

            {activeTab === "app" && (
            <>
            <h2 className="settings-page__h2">{t("settings.section.voice")}</h2>
            <div className="settings-card" id="settings-voice-card">
              <div
                className={
                  "settings-row" +
                  rowHighlight("settings-anchor-voiceHotkeyEnabled")
                }
                id="settings-anchor-voiceHotkeyEnabled"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.voiceHotkeyEnabled")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.voiceHotkeyEnabledDesc")}
                  </div>
                </div>
                <UiCheck
                  checked={voiceHotkeyEnabled}
                  onChange={() => {
                    const next = !voiceHotkeyEnabled;
                    setVoiceHotkeyEnabled(next);
                    saveVoiceHotkeyEnabled(next);
                  }}
                  ariaLabel={t("settings.voiceHotkeyEnabled")}
                />
              </div>
              {onVoiceId ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-voiceId")
                  }
                  id="settings-anchor-voiceId"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.voiceId")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.voiceIdDesc")}
                    </div>
                  </div>
                  <Select
                    value={voiceId || "eve"}
                    onChange={(v) => onVoiceId(v)}
                    options={[
                      { value: "eve", label: "Eve" },
                      { value: "ara", label: "Ara" },
                      { value: "rex", label: "Rex" },
                      { value: "sal", label: "Sal" },
                      { value: "leo", label: "Leo" },
                      ...(voiceId &&
                      !["eve", "ara", "rex", "sal", "leo"].includes(voiceId)
                        ? [{ value: voiceId, label: voiceId }]
                        : []),
                    ]}
                  />
                </div>
              ) : null}
              {onVoiceDictationAutoSend ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-voiceDictationAutoSend")
                  }
                  id="settings-anchor-voiceDictationAutoSend"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.voiceDictationAutoSend")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.voiceDictationAutoSendDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!voiceDictationAutoSend}
                    onChange={() =>
                      onVoiceDictationAutoSend(!voiceDictationAutoSend)
                    }
                    ariaLabel={t("settings.voiceDictationAutoSend")}
                  />
                </div>
              ) : null}
              {onVoiceKeepAgentsOnEnd ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-voiceKeepAgentsOnEnd")
                  }
                  id="settings-anchor-voiceKeepAgentsOnEnd"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.voiceKeepAgentsOnEnd")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.voiceKeepAgentsOnEndDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!voiceKeepAgentsOnEnd}
                    onChange={() =>
                      onVoiceKeepAgentsOnEnd(!voiceKeepAgentsOnEnd)
                    }
                    ariaLabel={t("settings.voiceKeepAgentsOnEnd")}
                  />
                </div>
              ) : null}
            </div>

            <h2 className="settings-page__h2">{t("settings.section.general")}</h2>
            <div className="settings-card">
              <div
                className={"settings-row" + rowHighlight("settings-anchor-language")}
                id="settings-anchor-language"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    <IconLanguage size={16} />
                    {t("settings.language")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.languageDesc")}
                  </div>
                </div>
                <Select
                  value={localePreference}
                  onChange={onLocale}
                  options={[
                    { value: "system", label: t("settings.languageSystem") },
                    { value: "en", label: "English" },
                    { value: "zh", label: "简体中文" },
                    { value: "zh-TW", label: "繁體中文" },
                  ]}
                />
              </div>
              <div
                className={
                  "settings-row" + rowHighlight("settings-anchor-sessionDataMode")
                }
                id="settings-anchor-sessionDataMode"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.sessionDataMode")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.sessionDataModeDesc")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.sessionModeHelp")}
                  </div>
                </div>
                <Select
                  value={sessionDataMode}
                  onChange={onSessionDataMode}
                  options={[
                    { value: "shared", label: t("settings.modeShared") },
                    {
                      value: "independent",
                      label: t("settings.modeIndependent"),
                    },
                  ]}
                />
              </div>
              <CliSessionsPanel
                t={t}
                sessionDataMode={sessionDataMode}
                onImported={onCliSessionsImported}
                onOpenSession={onOpenCliSession}
              />
              {onStoreApiKeysInKeychain ? (
                <div
                  className={
                    "settings-row" + rowHighlight("settings-anchor-keychain")
                  }
                  id="settings-anchor-keychain"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.storeApiKeysInKeychain")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.storeApiKeysInKeychainDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={storeApiKeysInKeychain}
                    onChange={() =>
                      onStoreApiKeysInKeychain(!storeApiKeysInKeychain)
                    }
                    ariaLabel={t("settings.storeApiKeysInKeychain")}
                  />
                </div>
              ) : null}
              {workspaceCwd ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-clearMemory")}
                  id="settings-anchor-clearMemory"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.clearWorkspaceMemory")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.clearWorkspaceMemoryDesc")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn--ghost btn--danger settings-row__action"
                    disabled={clearMemoryBusy}
                    onClick={() => setClearMemoryOpen(true)}
                  >
                    {clearMemoryBusy
                      ? t("settings.clearWorkspaceMemoryBusy")
                      : t("settings.clearWorkspaceMemory")}
                  </button>
                </div>
              ) : null}
              {onReopenLastSession ? (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-reopenLastSession")}
                  id="settings-anchor-reopenLastSession"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.reopenLastSession")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.reopenLastSessionDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!reopenLastSession}
                    onChange={() => onReopenLastSession(!reopenLastSession)}
                    ariaLabel={t("settings.reopenLastSession")}
                  />
                </div>
              ) : null}
              {onCloseToTray ? (
                <div
                  className={
                    "settings-row" + rowHighlight("settings-anchor-closeToTray")
                  }
                  id="settings-anchor-closeToTray"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.closeToTray")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.closeToTrayDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!closeToTray}
                    onChange={() => onCloseToTray(!closeToTray)}
                    ariaLabel={t("settings.closeToTray")}
                  />
                </div>
              ) : null}
              {onKeepTrayForSchedules ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-keepTrayForSchedules")
                  }
                  id="settings-anchor-keepTrayForSchedules"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.keepTrayForSchedules")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.keepTrayForSchedulesDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!keepTrayForSchedules}
                    onChange={() =>
                      onKeepTrayForSchedules(!keepTrayForSchedules)
                    }
                    ariaLabel={t("settings.keepTrayForSchedules")}
                  />
                </div>
              ) : null}
              {onTrayBusyBadge ? (
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-trayBusyBadge")
                  }
                  id="settings-anchor-trayBusyBadge"
                >
                  <div className="settings-tray-notify__row-main">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("settings.trayBusyBadge")}
                      </div>
                      <div className="settings-row__desc">
                        {t("settings.trayBusyBadgeDesc")}
                      </div>
                    </div>
                    <UiCheck
                      checked={!!trayBusyBadge}
                      onChange={() => onTrayBusyBadge(!trayBusyBadge)}
                      ariaLabel={t("settings.trayBusyBadge")}
                    />
                  </div>
                  <div
                    className={
                      "settings-tray-notify__status" +
                      (trayBusySurface.severity === "info"
                        ? " is-info"
                        : "")
                    }
                    role="status"
                  >
                    {t(trayBusySurface.statusKey, {
                      n: trayBusySurface.displayCount,
                      cap: trayBusySurface.displayCount,
                    })}
                  </div>
                </div>
              ) : null}
              {onLaunchAtLogin ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-launchAtLogin")
                  }
                  id="settings-anchor-launchAtLogin"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.launchAtLogin")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.launchAtLoginDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!launchAtLogin}
                    onChange={() => onLaunchAtLogin(!launchAtLogin)}
                    ariaLabel={t("settings.launchAtLogin")}
                  />
                </div>
              ) : null}
              {onWindowAlwaysOnTop ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-windowAlwaysOnTop")
                  }
                  id="settings-anchor-windowAlwaysOnTop"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.windowAlwaysOnTop")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.windowAlwaysOnTopDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!windowAlwaysOnTop}
                    onChange={() => onWindowAlwaysOnTop(!windowAlwaysOnTop)}
                    ariaLabel={t("settings.windowAlwaysOnTop")}
                  />
                </div>
              ) : null}
              {onNotifyOnTurnDone || onNotifyOnPermission || onNotifySound ? (
                <div
                  className={
                    "settings-row settings-row--stack settings-tray-notify__honesty" +
                    rowHighlight("settings-anchor-notifyHonesty")
                  }
                  id="settings-anchor-notifyHonesty"
                >
                  <div className="settings-tray-notify__honesty-head">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("settings.notify.honesty.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("settings.notify.honesty.desc")}
                      </div>
                    </div>
                  </div>
                  <div className="settings-tray-notify__honesty-body">
                    <span
                      className={
                        "settings-acp-chip settings-tray-notify__perm-chip" +
                        (notifyHonesty.severity === "warn"
                          ? " is-fail"
                          : notifyHonesty.canFireDesktop
                            ? " is-ok"
                            : "")
                      }
                      role="status"
                    >
                      <span className="settings-acp-chip__dot" aria-hidden />
                      <span className="settings-acp-chip__label">
                        {t(notifyHonesty.permissionLabelKey)}
                      </span>
                    </span>
                    {notifyHonesty.canRequestPermission ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={notifyPermBusy}
                        onClick={() => void requestNotifyPermission()}
                      >
                        {notifyPermBusy
                          ? t("settings.notify.honesty.requesting")
                          : t("settings.notify.honesty.request")}
                      </button>
                    ) : null}
                    {testDesktopNotification ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={!!notifyTestBusy}
                        onClick={() => void testDesktopNotification()}
                      >
                        {notifyTestBusy
                          ? t("settings.notify.honesty.testing")
                          : t("settings.notify.honesty.test")}
                      </button>
                    ) : null}
                  </div>
                  <div
                    className={
                      "settings-tray-notify__status" +
                      (notifyHonesty.severity === "warn"
                        ? " is-warn"
                        : notifyHonesty.severity === "info"
                          ? " is-info"
                          : "")
                    }
                    role="status"
                  >
                    {t(notifyHonesty.blockReasonKey)}
                  </div>
                </div>
              ) : null}
              {onNotifyOnTurnDone ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-notifyOnTurnDone")
                  }
                  id="settings-anchor-notifyOnTurnDone"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.notifyOnTurnDone")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.notifyOnTurnDoneDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!notifyOnTurnDone}
                    onChange={() => onNotifyOnTurnDone(!notifyOnTurnDone)}
                    ariaLabel={t("settings.notifyOnTurnDone")}
                  />
                </div>
              ) : null}
              {onNotifyOnPermission ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-notifyOnPermission")
                  }
                  id="settings-anchor-notifyOnPermission"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.notifyOnPermission")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.notifyOnPermissionDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!notifyOnPermission}
                    onChange={() => onNotifyOnPermission(!notifyOnPermission)}
                    ariaLabel={t("settings.notifyOnPermission")}
                  />
                </div>
              ) : null}
              {onNotifySound ? (
                <div
                  className={
                    "settings-row" +
                    rowHighlight("settings-anchor-notifySound")
                  }
                  id="settings-anchor-notifySound"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.notifySound")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.notifySoundDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!notifySound}
                    onChange={() => onNotifySound(!notifySound)}
                    ariaLabel={t("settings.notifySound")}
                  />
                </div>
              ) : null}
              <div
                className={
                  "settings-row" +
                  rowHighlight("settings-anchor-notifyQuietHours")
                }
                id="settings-anchor-notifyQuietHours"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.notifyQuietHours")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.notifyQuietHoursDesc")}
                  </div>
                </div>
                <UiCheck
                  checked={!!notifyQuietHours.enabled}
                  onChange={() =>
                    onNotifyQuietHours({
                      ...notifyQuietHours,
                      enabled: !notifyQuietHours.enabled,
                    })
                  }
                  ariaLabel={t("settings.notifyQuietHours")}
                />
              </div>
              {notifyQuietHours.enabled ? (
                <div className="settings-row settings-row--stack settings-quiet-hours">
                  {notifyHonesty.quietHoursActive ? (
                    <div
                      className="settings-tray-notify__status is-info"
                      role="status"
                    >
                      {t("settings.notifyQuietHours.activeNow")}
                    </div>
                  ) : null}
                  <div className="settings-quiet-hours__times">
                    <label className="settings-quiet-hours__field">
                      <span className="settings-quiet-hours__label">
                        {t("settings.notifyQuietHoursStart")}
                      </span>
                      <input
                        type="time"
                        className="settings-input settings-quiet-hours__input"
                        value={notifyQuietHours.start}
                        onChange={(e) => {
                          const next =
                            normalizeHHmm(e.target.value) ??
                            notifyQuietHours.start;
                          onNotifyQuietHours({
                            ...notifyQuietHours,
                            start: next,
                          });
                        }}
                        aria-label={t("settings.notifyQuietHoursStart")}
                      />
                    </label>
                    <label className="settings-quiet-hours__field">
                      <span className="settings-quiet-hours__label">
                        {t("settings.notifyQuietHoursEnd")}
                      </span>
                      <input
                        type="time"
                        className="settings-input settings-quiet-hours__input"
                        value={notifyQuietHours.end}
                        onChange={(e) => {
                          const next =
                            normalizeHHmm(e.target.value) ??
                            notifyQuietHours.end;
                          onNotifyQuietHours({
                            ...notifyQuietHours,
                            end: next,
                          });
                        }}
                        aria-label={t("settings.notifyQuietHoursEnd")}
                      />
                    </label>
                  </div>
                </div>
              ) : null}
              <div
                className={
                  "settings-row" +
                  rowHighlight("settings-anchor-stopAllSkipConfirm")
                }
                id="settings-anchor-stopAllSkipConfirm"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.stopAllSkipConfirm")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.stopAllSkipConfirmDesc")}
                  </div>
                </div>
                <UiCheck
                  checked={stopAllSkipConfirm}
                  onChange={() => {
                    const next = !stopAllSkipConfirm;
                    setStopAllSkipConfirm(next);
                    saveStopAllSkipConfirmPref(next);
                  }}
                  ariaLabel={t("settings.stopAllSkipConfirm")}
                />
              </div>
              <div
                className={
                  "settings-row" +
                  rowHighlight("settings-anchor-alwaysQuitWithoutAsking")
                }
                id="settings-anchor-alwaysQuitWithoutAsking"
              >
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.alwaysQuitWithoutAsking")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.alwaysQuitWithoutAskingDesc")}
                  </div>
                </div>
                <UiCheck
                  checked={alwaysQuitWithoutAsking}
                  onChange={() => {
                    const next = !alwaysQuitWithoutAsking;
                    setAlwaysQuitWithoutAsking(next);
                    saveAlwaysQuitWithoutAskingPref(next);
                  }}
                  ariaLabel={t("settings.alwaysQuitWithoutAsking")}
                />
              </div>
              {onDefaultOpenTarget && (
                <div
                  className={"settings-row" + rowHighlight("settings-anchor-openTarget")}
                  id="settings-anchor-openTarget"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.openTarget")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.openTargetDesc")}
                    </div>
                  </div>
                  <Select
                    value={defaultOpenTarget}
                    onChange={onDefaultOpenTarget}
                    options={[
                      { value: "finder", label: t("settings.openFinder") },
                      ...editors.map((e: { id: string; label: string }) => ({
                        value: e.id,
                        label: e.label,
                      })),
                    ]}
                  />
                </div>
              )}
            </div>
            </>
            )}
          </>
    </>
  );
}
