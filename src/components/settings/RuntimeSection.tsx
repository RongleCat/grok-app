/**
 * Settings → runtime section (consumes SettingsModel context).
 */
import { useSettingsModel } from "@/providers/SettingsModelContext";
import type { SettingsViewModel } from "./types";

import { Select } from "@/components/Select";
import { ProjectInspectPanel } from "@/components/ProjectInspectPanel";
import { GitPrHubPanel } from "@/components/GitPrHubPanel";
import { PrivacyCenterPanel } from "@/components/PrivacyCenterPanel";
import { ManagedSetupPanel } from "@/components/ManagedSetupPanel";
import { TraceHistoryList } from "@/components/TraceHistoryList";
import { ProcessBudgetPanel } from "@/components/ProcessBudgetPanel";
import { LeaderServePanel } from "@/components/LeaderServePanel";
import { CliWorktreeDbPanel } from "@/components/CliWorktreeDbPanel";
import { SdkConnectWizard } from "@/components/SdkConnectWizard";
import { CliUpdateRow } from "@/components/CliUpdateRow";
import { CostRollupPanel } from "@/components/CostRollupPanel";
import { StreamingMessagesJsonPanel } from "@/components/StreamingMessagesJsonPanel";
import { StreamingAcpNdjsonPanel } from "@/components/StreamingAcpNdjsonPanel";
import { WorkflowsDiscoveryBlock } from "@/components/WorkflowsSettingsBlock";
import { resolvePartialStreamBanner } from "@/lib/partialStreamHonesty";
import {
  isValidProxyUrl,
  manualProxyUrlSoftFail,
  normalizeProxyMode,
  proxySoftFailMessageKey,
} from "@/lib/networkProxy";
import { resolveProxyApplyHonesty } from "@/lib/networkProxyPro";
import { SettingsTabStrip, UiCheck } from "./shared";
import { IconArchive, IconDoctor } from "@/components/icons";
import { NetworkProbeField } from "./NetworkProbeField";
import { AcpServerField } from "./AcpServerField";
import { WslBackendField } from "./WslBackendField";
import { detectAppPlatform } from "@/lib/appPlatform";
import { resolveLocale, type MessageKey } from "@/i18n";
import {
  classifyCliVersionStatus,
  cliVersionStatusMessageKey,
} from "@/lib/cliVersionStatus";


export function RuntimeSection() {
  const s = useSettingsModel() as SettingsViewModel & Record<string, any>;
  const {
    title,
    acpServerAddr,
    activeTab,
    agentIdleMinutes,
    allowUnverifiedCliInstall,
    auditLedgerRetentionDays,
    cliInfo,
    cliAgentSkewRepairing,
    onCliRepairAgentSidecar,
    onCliInfoRefresh,
    costRollupProjects,
    costRollupSessions,
    includePartialMessages,
    lastCliChecksumVerified,
    lastProcessLimit,
    locale,
    manualCliPath,
    maxConcurrentAgents,
    navigateTo,
    onAcpServerAddr,
    onAcpServerBlur,
    onAgentIdleMinutes,
    onAllowUnverifiedCliInstall,
    onAuditLedgerRetentionDays,
    onCliBlur,
    onDoctor,
    onIncludePartialMessages,
    onManualCliPath,
    onMaxConcurrentAgents,
    onOpenBatchAgents,
    onOpenReliability,
    onProxyMode,
    onProxyNoProxy,
    onProxyUrl,
    onStreamStallSeconds,
    onWorkflowsEnabled,
    prHubHighlightPr,
    projectPath,
    proxyMode,
    proxyNoProxy,
    proxyUrl = "",
    rowHighlight,
    sectionNav,
    setSectionTab,
    showSettingsToast,
    streamStallSeconds,
    t,
    useLeader,
    workflowsEnabled,
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
            {activeTab === "cli" && (
              <div
                className={"settings-card" + rowHighlight("settings-anchor-cliPath")}
                id="settings-anchor-cliPath"
              >
                <div className="settings-row settings-row--stack">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.cliPath")}{" "}
                      {cliInfo.found
                        ? `(${cliInfo.source || "ok"})`
                        : t("settings.cliNotFound")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.cliPathDesc")}
                    </div>
                  </div>
                  <input
                    className="settings-input"
                    value={manualCliPath}
                    placeholder={cliInfo.path || "e.g. ~/.grok/bin/grok"}
                    onChange={(e) => onManualCliPath(e.target.value)}
                    onBlur={(e) => onCliBlur(e.target.value.trim())}
                  />
                  {cliInfo.version && (
                    <div className="settings-row__hint">
                      {cliInfo.version}
                      {cliInfo.path ? ` · ${cliInfo.path}` : ""}
                      {cliInfo.cliAuthPresent
                        ? ` · ${t("account.cliAuthOk")}`
                        : ` · ${t("account.cliAuthMissing")}`}
                      {lastCliChecksumVerified === true
                        ? ` · ${t("settings.cliChecksumVerified")}`
                        : lastCliChecksumVerified === false
                          ? ` · ${t("settings.cliChecksumUnverified")}`
                          : ""}
                    </div>
                  )}
                  {(() => {
                    const status = classifyCliVersionStatus(cliInfo);
                    const key = cliVersionStatusMessageKey(status);
                    return (
                      <div
                        className={
                          "settings-row__hint" +
                          (status === "too_old" || status === "below_recommended"
                            ? " settings-row__hint--warn"
                            : status === "recommended"
                              ? " settings-row__hint--ok"
                              : "")
                        }
                        id="settings-anchor-cliVersionStatus"
                      >
                        {t(key, {
                          version: cliInfo.version || "—",
                          recommended:
                            cliInfo.recommendedVersion || "1.0.0",
                          min: cliInfo.minVersion || "0.2.112",
                        })}
                      </div>
                    );
                  })()}
                  {cliInfo.agentBinarySkew ? (
                    <div className="settings-row settings-row--stack settings-row--compact">
                      <div className="settings-row__hint settings-row__hint--warn">
                        {t("settings.cliAgentSkew", {
                          version: cliInfo.version || "—",
                          agentVersion: cliInfo.agentVersion || "—",
                        })}
                      </div>
                      {onCliRepairAgentSidecar ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={!!cliAgentSkewRepairing}
                          onClick={() => {
                            void (async () => {
                              try {
                                const r = await onCliRepairAgentSidecar();
                                if (!r) return;
                                if (r.ok) {
                                  showSettingsToast?.(
                                    t("settings.cliAgentSkewRepaired", {
                                      agentVersion: r.agentVersion || "—",
                                    }),
                                    3200,
                                  );
                                } else {
                                  showSettingsToast?.(
                                    t("settings.cliAgentSkewRepairFailed", {
                                      error: r.error || "unknown",
                                    }),
                                    4500,
                                  );
                                }
                              } catch (e) {
                                showSettingsToast?.(
                                  t("settings.cliAgentSkewRepairFailed", {
                                    error:
                                      e instanceof Error
                                        ? e.message
                                        : String(e),
                                  }),
                                  4500,
                                );
                              }
                            })();
                          }}
                        >
                          {cliAgentSkewRepairing
                            ? t("settings.cliAgentSkewRepairing")
                            : t("settings.cliAgentSkewRepair")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {cliInfo.acpAgentVersionSkew ? (
                    <div
                      className="settings-row__hint settings-row__hint--warn"
                      id="settings-anchor-cliAcpVersionSkew"
                    >
                      {t("settings.cliAcpVersionSkew", {
                        version: cliInfo.version || "—",
                        acpVersion: cliInfo.acpAgentVersion || "—",
                      })}
                    </div>
                  ) : null}
                </div>
                {detectAppPlatform() === "win" ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-wslBackend")
                    }
                  >
                    <WslBackendField
                      t={t}
                      onSaved={() => {
                        // Refresh the top CLI path card so source/version match backend.
                        void (async () => {
                          try {
                            const mod = await import("@/lib/api");
                            const probed = await mod.probeCli(
                              manualCliPath || undefined,
                            );
                            onCliInfoRefresh?.(probed);
                          } catch {
                            /* soft-fail — WslBackendField still shows its own probe */
                          }
                        })();
                      }}
                    />
                  </div>
                ) : null}
                {onAllowUnverifiedCliInstall ? (
                  <div
                    className={
                      "settings-row" +
                      rowHighlight("settings-anchor-allowUnverifiedCli")
                    }
                    id="settings-anchor-allowUnverifiedCli"
                  >
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("settings.allowUnverifiedCli")}
                      </div>
                      <div className="settings-row__desc">
                        {t("settings.allowUnverifiedCliDesc")}
                      </div>
                    </div>
                    <UiCheck
                      checked={!!allowUnverifiedCliInstall}
                      onChange={() =>
                        onAllowUnverifiedCliInstall(!allowUnverifiedCliInstall)
                      }
                      ariaLabel={t("settings.allowUnverifiedCli")}
                    />
                  </div>
                ) : null}
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-cliUpdate")
                  }
                  id="settings-anchor-cliUpdate"
                >
                  <CliUpdateRow
                    t={t}
                    cliFound={cliInfo.found}
                    autoCheck
                  />
                </div>
              </div>
            )}
            {activeTab === "cli" && (
              <div
                className={
                  "settings-block-gap" +
                  rowHighlight("settings-anchor-cliWorktreeDb")
                }
              >
                <CliWorktreeDbPanel t={t} />
              </div>
            )}
            {activeTab === "connection" && (
              <>
                <div
                  className={"settings-card" + rowHighlight("settings-anchor-acpServer")}
                  id="settings-anchor-acpServer"
                >
                  <AcpServerField
                    value={acpServerAddr}
                    onChange={onAcpServerAddr}
                    onBlurCommit={onAcpServerBlur}
                    onOpenAgentServe={() =>
                      navigateTo(
                        "runtime",
                        "connection",
                        "settings-anchor-agentServe",
                      )
                    }
                    t={t}
                  />
                </div>
                <h2 className="settings-page__h2">{t("settings.leader.title")}</h2>
                <div className={rowHighlight("settings-anchor-leaderServe")}>
                  <LeaderServePanel
                    t={t}
                    useLeader={!!useLeader}
                    onOpenUseLeader={() =>
                      navigateTo("general", "agent", "settings-anchor-useLeader")
                    }
                  />
                </div>
                <h2 className="settings-page__h2">{t("settings.sdkConnect.title")}</h2>
                <div
                  className={
                    rowHighlight("settings-anchor-sdkConnect") +
                    " " +
                    rowHighlight("settings-anchor-agentServe")
                  }
                >
                  <SdkConnectWizard t={t} />
                </div>
              </>
            )}
            {activeTab === "network" && (
              <div
                className={
                  "settings-card" + rowHighlight("settings-anchor-proxy")
                }
                id="settings-anchor-proxy"
              >
                <div className="settings-row settings-row--stack">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.proxyMode")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.proxyModeDesc")}
                    </div>
                  </div>
                  <Select
                    className="settings-select"
                    aria-label={t("settings.proxyMode")}
                    value={normalizeProxyMode(proxyMode)}
                    onChange={(v) => onProxyMode?.(normalizeProxyMode(v))}
                    options={[
                      {
                        value: "system",
                        label: t("settings.proxyModeSystem"),
                      },
                      {
                        value: "manual",
                        label: t("settings.proxyModeManual"),
                      },
                      {
                        value: "none",
                        label: t("settings.proxyModeNone"),
                      },
                    ]}
                  />
                  {(() => {
                    const applyHonesty = resolveProxyApplyHonesty({
                      mode: proxyMode,
                      url: proxyUrl,
                    });
                    return (
                      <ul className="settings-proxy-apply" role="list">
                        {applyHonesty.lines.map((line) => (
                          <li
                            key={line.scope}
                            className={
                              "settings-row__hint" +
                              (line.tone === "danger" ? " is-danger" : "")
                            }
                          >
                            {t(line.messageKey as MessageKey)}
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                </div>
                {normalizeProxyMode(proxyMode) === "manual" && (
                  <>
                    <div className="settings-row settings-row--stack">
                      <div className="settings-row__text">
                        <div className="settings-row__label">
                          {t("settings.proxyUrl")}
                        </div>
                        <div className="settings-row__desc">
                          {t("settings.proxyUrlDesc")}
                        </div>
                      </div>
                      {(() => {
                        const urlSoft = manualProxyUrlSoftFail(
                          proxyMode,
                          proxyUrl,
                        );
                        const softKey = proxySoftFailMessageKey(
                          proxyMode,
                          proxyUrl,
                        );
                        const showInvalid =
                          proxyUrl.trim() !== "" && !isValidProxyUrl(proxyUrl);
                        const showEmptyManual =
                          proxyUrl.trim() === "" && urlSoft === "empty";
                        return (
                          <>
                            <input
                              className={
                                "settings-input" +
                                (showInvalid || showEmptyManual
                                  ? " is-invalid"
                                  : "")
                              }
                              value={proxyUrl}
                              placeholder="http://127.0.0.1:7890"
                              autoComplete="off"
                              spellCheck={false}
                              aria-invalid={
                                showInvalid || showEmptyManual
                                  ? true
                                  : undefined
                              }
                              aria-describedby={
                                softKey
                                  ? "settings-proxy-url-softfail"
                                  : undefined
                              }
                              onChange={(e) => onProxyUrl?.(e.target.value)}
                            />
                            {softKey ? (
                              <div
                                id="settings-proxy-url-softfail"
                                className="settings-row__hint is-danger"
                                role="alert"
                              >
                                {t(softKey as MessageKey)}
                              </div>
                            ) : null}
                          </>
                        );
                      })()}
                    </div>
                    <div className="settings-row settings-row--stack">
                      <div className="settings-row__text">
                        <div className="settings-row__label">
                          {t("settings.proxyNoProxy")}
                        </div>
                        <div className="settings-row__desc">
                          {t("settings.proxyNoProxyDesc")}
                        </div>
                      </div>
                      <input
                        className="settings-input"
                        value={proxyNoProxy}
                        placeholder="internal.example.com,10.0.0.0/8"
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => onProxyNoProxy?.(e.target.value)}
                      />
                    </div>
                  </>
                )}
                <NetworkProbeField t={t} />
              </div>
            )}
            {activeTab === "pool" && (
              <div className="settings-card">
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-maxConcurrentAgents")
                  }
                  id="settings-anchor-maxConcurrentAgents"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.maxConcurrentAgents")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.maxConcurrentAgentsDesc")}
                    </div>
                  </div>
                  <input
                    className="settings-input"
                    type="number"
                    min={1}
                    max={32}
                    step={1}
                    value={maxConcurrentAgents}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      onMaxConcurrentAgents?.(
                        Math.min(32, Math.max(1, Math.round(n))),
                      );
                    }}
                  />
                </div>
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-processBudget")
                  }
                  id="settings-anchor-processBudget"
                >
                  <ProcessBudgetPanel
                    locale={resolveLocale(locale)}
                    active={activeTab === "pool"}
                    variant="settings"
                    lastProcessLimit={lastProcessLimit}
                    id="settings-process-budget"
                  />
                </div>
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-agentIdleMinutes")
                  }
                  id="settings-anchor-agentIdleMinutes"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.agentIdleMinutes")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.agentIdleMinutesDesc")}
                    </div>
                  </div>
                  <input
                    className="settings-input"
                    type="number"
                    min={1}
                    max={1440}
                    step={1}
                    value={agentIdleMinutes}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      onAgentIdleMinutes?.(
                        Math.min(1440, Math.max(1, Math.round(n))),
                      );
                    }}
                  />
                </div>
                <div
                  className={
                    "settings-row settings-row--stack" +
                    rowHighlight("settings-anchor-streamStallSeconds")
                  }
                  id="settings-anchor-streamStallSeconds"
                >
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.streamStallSeconds")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.streamStallSecondsDesc")}
                    </div>
                  </div>
                  <input
                    className="settings-input"
                    type="number"
                    min={15}
                    max={900}
                    step={15}
                    value={streamStallSeconds}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      onStreamStallSeconds?.(
                        Math.min(900, Math.max(15, Math.round(n))),
                      );
                    }}
                  />
                </div>
                {onIncludePartialMessages ? (
                  <div
                    className={
                      "settings-row" +
                      rowHighlight("settings-anchor-includePartialMessages")
                    }
                    id="settings-anchor-includePartialMessages"
                  >
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("settings.includePartialMessages")}
                      </div>
                      <div className="settings-row__desc">
                        {t("settings.includePartialMessagesDesc")}
                      </div>
                      {(() => {
                        // Settings note describes the headless Remote IM path.
                        // ACP in-app chat is a separate streaming path (never
                        // invent token deltas from this toggle alone).
                        const banner = resolvePartialStreamBanner({
                          enabled: includePartialMessages,
                          cliVersion: cliInfo.version,
                          isHeadlessPath: true,
                        });
                        if (!banner) return null;
                        return (
                          <div
                            className={
                              "settings-row__hint" +
                              (banner.severity === "warn" ? " is-danger" : "")
                            }
                            style={{ marginTop: 6 }}
                            role="status"
                          >
                            {t(banner.messageKey, banner.vars)}
                          </div>
                        );
                      })()}
                    </div>
                    <UiCheck
                      checked={!!includePartialMessages}
                      onChange={() =>
                        onIncludePartialMessages(!includePartialMessages)
                      }
                      ariaLabel={t("settings.includePartialMessages")}
                    />
                  </div>
                ) : null}
              </div>
            )}
            {activeTab === "tools" && (
              <>
                {onWorkflowsEnabled ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-workflows")
                    }
                    id="settings-anchor-workflows"
                  >
                    <div className="settings-row">
                      <div className="settings-row__text">
                        <div className="settings-row__label">
                          {t("settings.workflows")}
                        </div>
                        <div className="settings-row__desc">
                          {t("settings.workflowsDesc")}
                        </div>
                      </div>
                      <UiCheck
                        checked={!!workflowsEnabled}
                        onChange={() => onWorkflowsEnabled(!workflowsEnabled)}
                        ariaLabel={t("settings.workflows")}
                      />
                    </div>
                    <div className="settings-row settings-row--stack">
                      <div className="settings-row__text">
                        <div className="settings-row__desc">
                          {t("settings.workflowsHonesty")}
                        </div>
                      </div>
                      <WorkflowsDiscoveryBlock
                        locale={resolveLocale(locale)}
                        projectPath={projectPath}
                        showToast={showSettingsToast}
                      />
                    </div>
                  </div>
                ) : null}
                <div
                  className={"settings-card" + rowHighlight("settings-anchor-doctor")}
                  id="settings-anchor-doctor"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        <IconDoctor size={16} />
                        {t("doctor.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("settings.doctorDesc")}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost settings-row__action"
                      onClick={onDoctor}
                    >
                      {t("settings.runDoctor")}
                    </button>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" + rowHighlight("settings-anchor-traces")
                  }
                  id="settings-anchor-traces"
                >
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        <IconArchive size={16} />
                        {t("session.tracesTitle")}
                      </div>
                      <div className="settings-row__desc">
                        {t("session.tracesDesc")}
                      </div>
                    </div>
                  </div>
                  <div className="trace-history-settings">
                    <TraceHistoryList
                      labels={{
                        empty: t("session.tracesEmpty"),
                        emptyFilter: t("session.tracesEmptyFilter"),
                        reveal: t("session.tracesReveal"),
                        copyPath: t("session.tracesCopyPath"),
                        copied: t("session.tracesCopied"),
                        remove: t("session.tracesRemove"),
                        clearAll: t("session.tracesClearAll"),
                        clearConfirmTitle: t("session.tracesClearConfirmTitle"),
                        clearConfirmMessage: t(
                          "session.tracesClearConfirmMessage",
                        ),
                        clearConfirmAction: t(
                          "session.tracesClearConfirmAction",
                        ),
                        cancel: t("common.cancel"),
                        searchPlaceholder: t("session.tracesSearch"),
                        listAria: t("session.tracesTitle"),
                        uploadedBadge: t("session.tracesUploadedBadge"),
                      }}
                      onCopied={() =>
                        showSettingsToast(t("session.tracesCopied"), 2000)
                      }
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-reliability")
                  }
                  id="settings-anchor-reliability"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("reliability.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("reliability.settingsDesc")}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost settings-row__action"
                      onClick={() => onOpenReliability?.()}
                      disabled={!onOpenReliability}
                    >
                      {t("reliability.openFromSettings")}
                    </button>
                  </div>
                </div>
                {onAuditLedgerRetentionDays ? (
                  <div
                    className={
                      "settings-card" +
                      rowHighlight("settings-anchor-auditRetention")
                    }
                    id="settings-anchor-auditRetention"
                  >
                    <div className="settings-row settings-row--stack">
                      <div className="settings-row__text">
                        <div className="settings-row__label">
                          {t("reliability.audit.retention")}
                        </div>
                        <div className="settings-row__desc">
                          {t("reliability.audit.retentionDesc")}
                        </div>
                      </div>
                      <div
                        className="settings-seg"
                        role="radiogroup"
                        aria-label={t("reliability.audit.retentionAria")}
                        data-testid="settings-audit-retention"
                      >
                        {(
                          [
                            { days: 7, key: "reliability.audit.retention.7" as const },
                            { days: 30, key: "reliability.audit.retention.30" as const },
                            { days: 90, key: "reliability.audit.retention.90" as const },
                            {
                              days: 0,
                              key: "reliability.audit.retention.unlimited" as const,
                            },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.days}
                            type="button"
                            role="radio"
                            aria-checked={
                              (auditLedgerRetentionDays === 7 ||
                              auditLedgerRetentionDays === 30 ||
                              auditLedgerRetentionDays === 90
                                ? auditLedgerRetentionDays
                                : 0) === opt.days
                            }
                            className={
                              "settings-seg__btn" +
                              ((auditLedgerRetentionDays === 7 ||
                              auditLedgerRetentionDays === 30 ||
                              auditLedgerRetentionDays === 90
                                ? auditLedgerRetentionDays
                                : 0) === opt.days
                                ? " is-on"
                                : "")
                            }
                            data-testid={`settings-audit-retention-${opt.days}`}
                            onClick={() => onAuditLedgerRetentionDays(opt.days)}
                          >
                            {t(opt.key)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-batch-agents")
                  }
                  id="settings-anchor-batch-agents"
                >
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("batchAgents.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("batchAgents.settingsDesc")}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost settings-row__action"
                      onClick={() => onOpenBatchAgents?.()}
                      disabled={!onOpenBatchAgents}
                    >
                      {t("batchAgents.openFromSettings")}
                    </button>
                  </div>
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-cost-rollup")
                  }
                  id="settings-anchor-cost-rollup"
                >
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("costRollup.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("costRollup.settingsDesc")}
                      </div>
                    </div>
                  </div>
                  <CostRollupPanel
                    locale={resolveLocale(locale)}
                    sessions={costRollupSessions}
                    projects={costRollupProjects}
                    embedded
                    onToast={(msg, ms) => showSettingsToast(msg, ms ?? 2000)}
                  />
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-smj")
                  }
                  id="settings-anchor-smj"
                >
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("smj.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("smj.settingsDesc")}
                      </div>
                    </div>
                  </div>
                  <StreamingMessagesJsonPanel
                    locale={resolveLocale(locale)}
                    cliVersion={cliInfo.version}
                    onToast={(msg, ms) => showSettingsToast(msg, ms ?? 2000)}
                  />
                </div>
                <div
                  className={
                    "settings-card" +
                    rowHighlight("settings-anchor-stream-acp-ndjson")
                  }
                  id="settings-anchor-stream-acp-ndjson"
                >
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("streamAcpNdjson.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("streamAcpNdjson.settingsDesc")}
                      </div>
                    </div>
                  </div>
                  <StreamingAcpNdjsonPanel
                    locale={resolveLocale(locale)}
                    manualCliPath={manualCliPath}
                    projectPath={projectPath}
                    showToast={showSettingsToast}
                  />
                </div>
                <div
                  className={
                    "settings-card pi-settings-block" +
                    rowHighlight("settings-anchor-inspect")
                  }
                  id="settings-anchor-inspect"
                >
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("inspect.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("inspect.desc")}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost settings-row__action"
                      onClick={() => navigateTo("extensions", "plugins")}
                    >
                      {t("settings.inspect.manageInExtensions")}
                    </button>
                  </div>
                  {/* Flat body — no nested settings-card */}
                  <div className="pi-settings-body">
                    <ProjectInspectPanel
                      locale={resolveLocale(locale)}
                      projectPath={projectPath}
                      cliFound={cliInfo.found}
                      hideHeader
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card pi-settings-block" +
                    rowHighlight("settings-anchor-prHub")
                  }
                  id="settings-anchor-prHub"
                >
                  <div className="settings-row settings-row--stack">
                    <div className="settings-row__text">
                      <div className="settings-row__label">
                        {t("prHub.title")}
                      </div>
                      <div className="settings-row__desc">
                        {t("prHub.desc")}
                      </div>
                    </div>
                  </div>
                  <div className="pi-settings-body">
                    <GitPrHubPanel
                      locale={resolveLocale(locale)}
                      projectPath={projectPath}
                      hideHeader
                      highlightPrNumber={prHubHighlightPr}
                    />
                  </div>
                </div>
                <div
                  className={
                    "settings-card pi-settings-block" +
                    rowHighlight("settings-anchor-managedSetup")
                  }
                  id="settings-anchor-managedSetup"
                >
                  <ManagedSetupPanel
                    locale={resolveLocale(locale)}
                    cliFound={cliInfo.found}
                    onOpenAccount={() => navigateTo("account", "official")}
                  />
                </div>
              </>
            )}
            {activeTab === "privacy" && (
              <div
                className={
                  "settings-card" + rowHighlight("settings-anchor-privacy")
                }
                id="settings-anchor-privacy-card"
              >
                <PrivacyCenterPanel
                  locale={resolveLocale(locale)}
                  onError={(msg) => showSettingsToast(msg, 4000)}
                  onSaved={() =>
                    showSettingsToast(t("settings.privacy.saved"), 2200)
                  }
                />
              </div>
            )}
          </>
    </>
  );
}
