/**
 * Settings → remote_im section (consumes SettingsModel context).
 */
import { useSettingsModel } from "@/providers/SettingsModelContext";
import type { SettingsViewModel } from "./types";

import { RemoteImLayout } from "@/components/RemoteImLayout";
import { MirrorConnectPanel } from "@/components/MirrorConnectPanel";
import { SettingsTabStrip } from "./shared";
import * as api from "@/lib/api";


export function RemoteImSection() {
  const s = useSettingsModel() as SettingsViewModel & Record<string, any>;
  const {
    activeTab,
    title,
    locale,
    sectionNav,
    setMirrorConfirm,
    setSectionTab,
    showSettingsToast,
    t,
    trustedProjects,
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
            {activeTab === "im" && (
              <div
                className="settings-card settings-card--rim"
                id="settings-anchor-remote-im"
              >
                <RemoteImLayout
                  locale={locale}
                  trustedProjects={trustedProjects}
                />
              </div>
            )}
            {activeTab === "mirror" && (
              <div
                className="settings-card"
                id="settings-anchor-phone-mirror"
              >
                {api.isDesktopHost() ? (
                  <MirrorConnectPanel
                    variant="inline"
                    open
                    locale={locale}
                    labels={{
                      title: t("mirror.connectTitle"),
                      close: t("common.close"),
                      start: t("mirror.start"),
                      stop: t("mirror.stop"),
                      stopConfirmTitle: t("mirror.stopConfirmTitle"),
                      stopConfirmMessage: t("mirror.stopConfirmMessage"),
                      stopConfirmOk: t("mirror.stopConfirmOk"),
                      cancel: t("common.cancel"),
                      copyLink: t("mirror.copyLink"),
                      copied: t("mirror.copied"),
                      clients: t("mirror.clients"),
                      phaseStopped: t("mirror.phase.stopped"),
                      phaseStarting: t("mirror.phase.starting"),
                      phaseLocal: t("mirror.phase.local"),
                      phaseWaitingTunnel: t("mirror.phase.waiting_tunnel"),
                      phaseLive: t("mirror.phase.live"),
                      phaseTunnelDead: t("mirror.phase.tunnel_dead"),
                      phaseError: t("mirror.phase.error"),
                      phaseSoftLocal: t("mirror.phase.softLocal"),
                      hint: t("mirror.connectHint"),
                      warningToken: t("mirror.warningToken"),
                      missingCloudflared: t("mirror.missingCloudflared"),
                      errorGeneric: t("mirror.errorGeneric"),
                      qrAlt: t("mirror.qrAlt"),
                      linkLabel: t("mirror.linkLabel"),
                      linkLabelLocal: t("mirror.linkLabelLocal"),
                      linkLabelLan: t("mirror.linkLabelLan"),
                      allowLan: t("mirror.allowLan"),
                      allowLanOn: t("mirror.allowLanOn"),
                      allowLanHint: t("mirror.allowLanHint"),
                      allowLanConfirmTitle: t("mirror.allowLanConfirmTitle"),
                      allowLanConfirmMessage: t("mirror.allowLanConfirmMessage"),
                      allowLanConfirmOk: t("mirror.allowLanConfirmOk"),
                      lanHint: t("mirror.lanHint"),
                      lanHintOn: t("mirror.lanHintOn"),
                      lanIpUnknown: t("mirror.lanIpUnknown"),
                      rotate: t("mirror.rotate"),
                      rotateDone: t("mirror.rotateDone"),
                      rotateConfirmTitle: t("mirror.rotateConfirmTitle"),
                      rotateConfirmMessage: t("mirror.rotateConfirmMessage"),
                      rotateConfirmMessageClients: t(
                        "mirror.rotateConfirmMessageClients",
                      ),
                      rotateConfirmOk: t("mirror.rotateConfirmOk"),
                      allowWrite: t("mirror.allowWrite"),
                      readOnlyOn: t("mirror.readOnlyOn"),
                      readOnlyHint: t("mirror.readOnlyHint"),
                      writeConfirmTitle: t("mirror.writeConfirmTitle"),
                      writeConfirmMessage: t("mirror.writeConfirmMessage"),
                      writeConfirmOk: t("mirror.writeConfirmOk"),
                      writeEnabledBanner: t("mirror.writeEnabledBanner"),
                      softLocalBanner: t("mirror.softLocalBanner"),
                      softTunnelDeadBanner: t("mirror.softTunnelDeadBanner"),
                      writeCategoriesTitle: t("mirror.write.categoriesTitle"),
                      writeCategoriesHint: t("mirror.write.categoriesHint"),
                      writeBroadWarn: t("mirror.write.broadWarn"),
                      writeCategorySend: t("mirror.write.category.send"),
                      writeCategoryStop: t("mirror.write.category.stop"),
                      writeCategorySessions: t(
                        "mirror.write.category.sessions",
                      ),
                      writeCategoryPermissions: t(
                        "mirror.write.category.permissions",
                      ),
                      writeCategoryAskUser: t(
                        "mirror.write.category.askUser",
                      ),
                      writeCategoryPlan: t("mirror.write.category.plan"),
                      writeCategoryDelete: t("mirror.write.category.delete"),
                      writeCategoryRename: t("mirror.write.category.rename"),
                      maxClientsLabel: t("mirror.maxClients"),
                      maxClientsHint: t("mirror.maxClientsHint"),
                      maxClientsValue: t("mirror.maxClientsValue"),
                      capLine: t("mirror.cap.line"),
                      capOk: t("mirror.cap.ok"),
                      capNearFull: t("mirror.cap.nearFull"),
                      capFull: t("mirror.cap.full"),
                      capWriteOnWarn: t("mirror.cap.writeOnWarn"),
                      capFullBanner: t("mirror.cap.fullBanner"),
                      capFullHint: t("mirror.cap.fullHint"),
                      capNearFullHint: t("mirror.cap.nearFullHint"),
                      capWriteOnWarnHint: t("mirror.cap.writeOnWarnHint"),
                      capOkHint: t("mirror.cap.okHint"),
                      capEmptyStopped: t("mirror.cap.emptyStopped"),
                      capEmptyStoppedHint: t("mirror.cap.emptyStoppedHint"),
                      capEmptyZero: t("mirror.cap.emptyZero"),
                      capEmptyZeroHint: t("mirror.cap.emptyZeroHint"),
                      auditTitle: t("mirror.audit.title"),
                      auditEmpty: t("mirror.audit.empty"),
                      auditClear: t("mirror.audit.clear"),
                      auditClearConfirmTitle: t("mirror.audit.clearConfirmTitle"),
                      auditClearConfirmMessage: t(
                        "mirror.audit.clearConfirmMessage",
                      ),
                      auditClearConfirmOk: t("mirror.audit.clearConfirmOk"),
                      auditTypeWriteEnabled: t(
                        "mirror.audit.type.write_enabled",
                      ),
                      auditTypeWriteDisabled: t(
                        "mirror.audit.type.write_disabled",
                      ),
                      auditTypeTokenRotated: t(
                        "mirror.audit.type.token_rotated",
                      ),
                      auditTypeHostStarted: t(
                        "mirror.audit.type.host_started",
                      ),
                      auditTypeHostStopped: t(
                        "mirror.audit.type.host_stopped",
                      ),
                      errCloudflaredMissing: t("mirror.err.cloudflaredMissing"),
                      errTunnelTimeout: t("mirror.err.tunnelTimeout"),
                      errTunnelSpawn: t("mirror.err.tunnelSpawn"),
                      errTunnelNotRegistered: t("mirror.err.tunnelNotRegistered"),
                      errTunnelDead: t("mirror.err.tunnelDead"),
                      errPortBind: t("mirror.err.portBind"),
                      errDesktopOnly: t("mirror.err.desktopOnly"),
                      errWsClosed: t("mirror.err.wsClosed"),
                      errWsTimeout: t("mirror.err.wsTimeout"),
                      errRpcTimeout: t("mirror.err.rpcTimeout"),
                      errRpcUnsupported: t("mirror.err.rpcUnsupported"),
                      errNotConnected: t("mirror.err.notConnected"),
                      errClientsFull: t("mirror.err.clientsFull"),
                      errOther: t("mirror.err.other"),
                      hintCloudflaredMissing: t("mirror.hint.cloudflaredMissing"),
                      hintTunnelTimeout: t("mirror.hint.tunnelTimeout"),
                      hintTunnelSpawn: t("mirror.hint.tunnelSpawn"),
                      hintTunnelNotRegistered: t("mirror.hint.tunnelNotRegistered"),
                      hintTunnelDead: t("mirror.hint.tunnelDead"),
                      hintPortBind: t("mirror.hint.portBind"),
                      hintDesktopOnly: t("mirror.hint.desktopOnly"),
                      hintWsClosed: t("mirror.hint.wsClosed"),
                      hintWsTimeout: t("mirror.hint.wsTimeout"),
                      hintRpcTimeout: t("mirror.hint.rpcTimeout"),
                      hintRpcUnsupported: t("mirror.hint.rpcUnsupported"),
                      hintNotConnected: t("mirror.hint.notConnected"),
                      hintClientsFull: t("mirror.hint.clientsFull"),
                      hintOther: t("mirror.hint.other"),
                    }}
                    onRequestConfirm={(opts) => setMirrorConfirm(opts)}
                    showToast={showSettingsToast}
                  />
                ) : (
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <div className="settings-row__desc">
                        {t("mirror.desktopOnly")}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
    </>
  );
}
