/**
 * Settings → account section (consumes SettingsModel context).
 */
import { useSettingsModel } from "@/providers/SettingsModelContext";
import type { SettingsViewModel } from "./types";

import { AccountPanel } from "@/components/AccountPanel";
import { OfficialAuxPanel } from "@/components/OfficialAuxPanel";
import { ProvidersPanel } from "@/components/ProvidersPanel";
import { resolveLocale } from "@/i18n";


export function AccountSection() {
  const s = useSettingsModel() as SettingsViewModel & Record<string, any>;
  const {
    account,
    accountBusy,
    accountHeatmapError,
    accountLoading,
    accountProbeError,
    activeAccountId,
    activeTab,
    locale,
    loginHint,
    onAccountLoginDevice,
    onAccountLoginOauth,
    onAccountLoginSubmitCode,
    onAccountLogout,
    onAccountManageUsage,
    onAccountRefresh,
    onAccountSubscribe,
    onAddAccount,
    onCancelLogin,
    onImportChat,
    onCliSessionsImported,
    onOpenCliSession,
    onProviderActivated,
    onProvidersChanged,
    onProviderBalanceLoaded,
    onRemoveAccount,
    onSaveAccount,
    onSwitchAccount,
    savedAccounts,
    setSectionTab,
    t,
  } = s;

  return (
    <>
<>
            <div
              className="settings-account-tabs"
              role="tablist"
              id={
                activeTab === "providers"
                  ? "settings-anchor-account-providers"
                  : activeTab === "extras"
                    ? "settings-anchor-account-extras"
                    : "settings-anchor-account-official"
              }
            >
              <div className="settings-seg settings-seg--lg" role="presentation">
                <button
                  type="button"
                  role="tab"
                  className={
                    "settings-seg__btn" +
                    (activeTab === "official" || activeTab == null
                      ? " is-on"
                      : "")
                  }
                  aria-selected={activeTab === "official" || activeTab == null}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSectionTab("official");
                  }}
                >
                  {t("settings.tabOfficial")}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={
                    "settings-seg__btn" +
                    (activeTab === "providers" ? " is-on" : "")
                  }
                  aria-selected={activeTab === "providers"}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSectionTab("providers");
                  }}
                >
                  {t("settings.tabProviders")}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={
                    "settings-seg__btn" +
                    (activeTab === "extras" ? " is-on" : "")
                  }
                  aria-selected={activeTab === "extras"}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSectionTab("extras");
                  }}
                >
                  {t("settings.tabExtras")}
                </button>
              </div>
              {activeTab === "providers" ? (
                <p className="settings-account-tabs__hint">
                  {t("settings.tabProvidersHint")}
                </p>
              ) : activeTab === "extras" ? (
                <p className="settings-account-tabs__hint">
                  {t("settings.tabExtrasHint")}
                </p>
              ) : (
                <p className="settings-account-tabs__hint">
                  {t("settings.tabOfficialHint")}
                </p>
              )}
            </div>
            {activeTab === "providers" ? (
              <ProvidersPanel
                locale={resolveLocale(locale)}
                officialAvailable={
                  !!(
                    account?.profile?.signedIn ||
                    account?.cliAuthPresent ||
                    account?.hasOfficialKey
                  )
                }
                onProvidersChanged={onProvidersChanged}
                onProviderActivated={onProviderActivated}
                onBalanceLoaded={onProviderBalanceLoaded}
              />
            ) : activeTab === "extras" ? (
              <OfficialAuxPanel
                locale={resolveLocale(locale)}
                officialAvailable={
                  !!(
                    account?.profile?.signedIn ||
                    account?.cliAuthPresent ||
                    account?.hasOfficialKey
                  )
                }
                onProviderActivated={onProviderActivated}
              />
            ) : (
          <AccountPanel
            status={account}
            loading={accountLoading}
            busy={accountBusy}
            probeError={accountProbeError}
            locale={locale}
            t={t}
            heatmapError={accountHeatmapError}
            labels={{
              signedIn: t("account.signedIn"),
              signedOut: t("account.signedOut"),
              loginOauth: t("account.loginOauth"),
              loginDevice: t("account.loginDevice"),
              logout: t("account.logout"),
              refresh: t("account.refresh"),
              refreshing: t("account.refreshing"),
              manageUsage: t("account.manageUsage"),
              subscribe: t("account.subscribe"),
              channel: t("account.channel"),
              subscription: t("account.subscription"),
              quota: t("account.quota"),
              quotaRemaining: t("account.quotaRemaining"),
              quotaUsed: t("account.quotaUsed"),
              quotaUnknown: t("account.quotaUnknown"),
              period: t("account.period"),
              prepaid: t("account.prepaid"),
              onDemand: t("account.onDemand"),
              heatmap: t("account.heatmap"),
              heatmapHint: t("account.heatmapHint"),
              callLogs: t("account.callLogs"),
              callLogsEmpty: t("account.callLogsEmpty"),
              colSession: t("account.col.session"),
              colModel: t("account.col.model"),
              colTurns: t("account.col.turns"),
              colUsage: t("account.col.usage"),
              colTokens: t("account.col.tokens"),
              colDuration: t("account.col.duration"),
              colWhen: t("account.col.when"),
              less: t("account.heatmap.less"),
              more: t("account.heatmap.more"),
              expired: t("account.expired"),
              team: t("account.team"),
              billingUnavailable: t("account.billingUnavailable"),
              loginBusy: t("account.loginBusy"),
              loginPasteToggle: t("account.loginPasteToggle"),
              loginPasteTitle: t("account.loginPasteTitle"),
              loginPasteBody: t("account.loginPasteBody"),
              loginPastePlaceholder: t("account.loginPastePlaceholder"),
              loginPasteSubmit: t("account.loginPasteSubmit"),
              loginCancel: t("account.loginCancel"),
              resetsAt: t("account.resetsAt"),
              fetchedAt: t("account.fetchedAt"),
              products: t("account.products"),
              heatmapNoData: t("account.heatmap.noData"),
              heatmapNoDataHint: t("account.heatmap.noDataHint"),
              heatmapLoading: t("account.heatmap.loading"),
              heatmapLoadingHint: t("account.heatmap.loadingHint"),
              heatmapRangeEmpty: t("account.heatmap.rangeEmpty"),
              heatmapRangeEmptyHint: t("account.heatmap.rangeEmptyHint"),
              heatmapAria: t("account.heatmap.aria"),
              heatmapRequests: t("account.heatmap.requests"),
              heatmapTokens: t("account.heatmap.tokens"),
              callLogsDayFilter: t("account.callLogs.dayFilter"),
              callLogsWeekFilter: t("account.callLogs.weekFilter"),
              callLogsClearDay: t("account.callLogs.clearDay"),
              callLogsDayEmpty: t("account.callLogs.dayEmpty"),
              heatmapDay: t("account.heatmap.day"),
              heatmapWeek: t("account.heatmap.week"),
              heatmapTotalTokens: t("account.heatmap.totalTokens"),
              heatmapActiveDays: t("account.heatmap.activeDays"),
              heatmapSessionsCount: t("account.heatmap.sessionsCount"),
              weeklyTitle: t("account.weeklyTitle"),
              loginHelpTitle: t("account.loginHelpTitle"),
              loginHelpBody: t("account.loginHelpBody"),
              loginTryDevice: t("account.loginTryDevice"),
              profiles: t("account.profiles"),
              profilesHint: t("account.profilesHint"),
              profilesEmpty: t("account.profilesEmpty"),
              profileSave: t("account.profileSave"),
              profileSwitch: t("account.profileSwitch"),
              profileRemove: t("account.profileRemove"),
              profileActive: t("account.profileActive"),
              manageAccounts: t("account.manageAccounts"),
              addAccount: t("account.addAccount"),
              importChat: t("account.importChat"),
              importChatHint: t("account.importChatHint"),
              importChatBtn: t("account.importChatBtn"),
              close: t("common.close"),
              quotaLoading: t("account.quota.loading"),
              quotaLoadingHint: t("account.quota.loadingHint"),
              quotaChipLoading: t("account.quota.chip.loading"),
              quotaChipUnknown: t("account.quota.chip.unknown"),
              quotaChipErrNetwork: t("account.quota.chip.err.network"),
              quotaChipErrAuth: t("account.quota.chip.err.auth"),
              quotaChipErrHostOnly: t("account.quota.chip.err.host_only"),
              quotaChipErrOther: t("account.quota.chip.err.other"),
              quotaErrNetwork: t("account.quota.err.network"),
              quotaErrNetworkHint: t("account.quota.err.networkHint"),
              quotaErrAuth: t("account.quota.err.auth"),
              quotaErrAuthHint: t("account.quota.err.authHint"),
              quotaErrHostOnly: t("account.quota.err.host_only"),
              quotaErrHostOnlyHint: t("account.quota.err.host_onlyHint"),
              quotaErrOther: t("account.quota.err.other"),
              quotaErrOtherHint: t("account.quota.err.otherHint"),
            }}
            loginHint={loginHint}
            savedAccounts={savedAccounts}
            activeAccountId={activeAccountId}
            onLoginOauth={onAccountLoginOauth}
            onLoginDevice={onAccountLoginDevice}
            onSubmitLoginCode={onAccountLoginSubmitCode}
            onCancelLogin={onCancelLogin}
            onLogout={onAccountLogout}
            onRefresh={onAccountRefresh}
            onManageUsage={onAccountManageUsage}
            onSubscribe={onAccountSubscribe}
            onSaveAccount={onSaveAccount}
            onAddAccount={onAddAccount}
            onSwitchAccount={onSwitchAccount}
            onRemoveAccount={onRemoveAccount}
            onImportChat={onImportChat}
            onImported={onCliSessionsImported}
            onOpenSession={onOpenCliSession}
          />
            )}
          </>
    </>
  );
}
