/**
 * Plugins modal farm for ExtensionsPanel: recommended install, path
 * install + validate, install confirm, plugin details + row menu,
 * sources management, uninstall confirm, and validate result.
 * Extracted verbatim from the panel (WP: giant-component decomposition).
 */
import * as api from "@/lib/api";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { PluginPathInstallCard } from "@/components/PluginPathInstallCard";
import { ExtensionsBuildExtras } from "@/components/ExtensionsBuildExtras";
import { PluginMcpAuthWizard } from "@/components/PluginMcpAuthWizard";
import { pluginInitials, type PluginCardModel } from "@/lib/pluginCard";
import {
  formatPluginValidateMessages,
  pluginValidateBadgeTone,
  pluginValidateHint,
  pluginValidateKindLabel,
  type PluginValidatePresentation,
} from "@/lib/pluginValidate";
import { pluginDisplayName } from "@/lib/pluginRecommended";
import { invalidatePluginsListCache } from "@/lib/pluginsListCache";
import {
  CHATCUT_CODEX_INSTALL_SOURCE,
  X_API_INSTALL_SOURCE,
} from "@/lib/pluginRecommended";
import type {
  AvailablePluginDetailModel,
  AvailablePluginLike,
  PluginComponentBadgeKind,
} from "@/lib/pluginMarketplace";

type TFn = ReturnType<typeof createT>;

export type ExtensionsPanelPluginsModalsProps = {
  projectPath: string | null;
  cliFound: boolean;
  onOpenRuntime: () => void;
  cliMissing: boolean;
  plugins: api.PluginDto[];
  recommendedInstall: "chatcut" | "x-api" | null;
  setRecommendedInstall: (v: "chatcut" | "x-api" | null) => void;
  installRecommended: (kind: "chatcut" | "x-api") => Promise<void>;
  installAvailableDirect: (target: AvailablePluginLike) => Promise<void>;
  installSource: string;
  pathInstallOpen: boolean;
  setPathInstallOpen: (v: boolean) => void;
  pathInstallError: string | null;
  setPathInstallError: (v: string | null) => void;
  setPathValidate: (v: PluginValidatePresentation | null) => void;
  setInstallSource: (v: string) => void;
  openPathInstall: () => void;
  browsePluginFolder: () => Promise<void>;
  pathInstallInputRef: React.RefObject<HTMLInputElement | null>;
  pathValidate: PluginValidatePresentation | null;
  validatePathInstall: () => Promise<void>;
  requestPathInstall: () => void;
  installConfirmSource: string | null;
  setInstallConfirmSource: (v: string | null) => void;
  confirmPathInstall: () => Promise<void>;
  detailCard: PluginCardModel | null;
  setDetailCard: (v: PluginCardModel | null) => void;
  menuPlugin: api.PluginDto | null;
  setMenuPlugin: (v: api.PluginDto | null) => void;
  setDetailsModel: (v: AvailablePluginDetailModel | null) => void;
  setDetailRawAvailable: (v: AvailablePluginLike | null) => void;
  setDetailRawInstalled: (v: api.PluginDto | null) => void;
  showDetails: (p: api.PluginDto) => Promise<void>;
  setDetailsOpen: (v: boolean) => void;
  detailsOpen: boolean;
  detailsTitle: string;
  detailsBody: string;
  detailsLoading: boolean;
  detailsModel: AvailablePluginDetailModel | null;
  detailRawAvailable: AvailablePluginLike | null;
  detailRawInstalled: api.PluginDto | null;
  togglePlugin: (p: api.PluginDto) => void;
  badgeLabel: (kind: PluginComponentBadgeKind, count?: number | null) => string;
  metaByName: Map<
    string,
    {
      displayName?: string | null;
      description?: string | null;
      longDescription?: string | null;
      version?: string | null;
      category?: string | null;
      author?: string | null;
      homepage?: string | null;
      repository?: string | null;
      license?: string | null;
      logoUrl?: string | null;
      keywords?: string[];
    }
  >;
  uninstallTarget: api.PluginDto | null;
  setUninstallTarget: (v: api.PluginDto | null) => void;
  confirmUninstall: () => Promise<void>;
  sourcesModalOpen: boolean;
  setSourcesModalOpen: (v: boolean) => void;
  validateModal: {
    open: boolean;
    presentation: PluginValidatePresentation | null;
    pluginName: string | null;
  };
  setValidateModal: (
    v:
      | {
          open: boolean;
          presentation: PluginValidatePresentation | null;
          pluginName: string | null;
        }
      | ((
          prev: {
            open: boolean;
            presentation: PluginValidatePresentation | null;
            pluginName: string | null;
          },
        ) => {
          open: boolean;
          presentation: PluginValidatePresentation | null;
          pluginName: string | null;
        }),
  ) => void;
  pluginValidateKindLabels: Record<string, string>;
  pluginValidateKindHints: Record<string, string>;
  setPluginAuthStatus: (
    v:
      | Record<string, api.PluginMcpAuthStatus>
      | ((
          prev: Record<string, api.PluginMcpAuthStatus>,
        ) => Record<string, api.PluginMcpAuthStatus>),
  ) => void;
  pluginAuthServer: string | null;
  setPluginAuthServer: (v: string | null) => void;
  refresh: (opts?: { forcePlugins?: boolean }) => Promise<void>;

  tr: TFn;
  locale: Locale;
  actionBusy: string | null;
};

export function ExtensionsPanelPluginsModals(p: ExtensionsPanelPluginsModalsProps) {
  const {
    projectPath,
    cliFound,
    onOpenRuntime,
    cliMissing,
    plugins,
    recommendedInstall,
    setRecommendedInstall,
    installRecommended,
    installAvailableDirect,
    installSource,
    pathInstallOpen,
    setPathInstallOpen,
    pathInstallError,
    setPathInstallError,
    setPathValidate,
    setInstallSource,
    openPathInstall,
    browsePluginFolder,
    pathInstallInputRef,
    pathValidate,
    validatePathInstall,
    requestPathInstall,
    installConfirmSource,
    setInstallConfirmSource,
    confirmPathInstall,
    detailCard,
    setDetailCard,
    menuPlugin,
    setMenuPlugin,
    setDetailsModel,
    setDetailRawAvailable,
    setDetailRawInstalled,
    showDetails,
    setDetailsOpen,
    detailsOpen,
    detailsTitle,
    detailsBody,
    detailsLoading,
    detailsModel,
    detailRawAvailable,
    detailRawInstalled,
    togglePlugin,
    badgeLabel,
    metaByName,
    uninstallTarget,
    setUninstallTarget,
    confirmUninstall,
    sourcesModalOpen,
    setSourcesModalOpen,
    validateModal,
    setValidateModal,
    pluginValidateKindLabels,
    pluginValidateKindHints,
    setPluginAuthStatus,
    pluginAuthServer,
    setPluginAuthServer,
    refresh,
    tr,
    locale,
    actionBusy,
  } = p;
  return (
    <>
      <GlassModal
        open={!!recommendedInstall}
        onClose={() => {
          const busy =
            actionBusy === "install:chatcut" || actionBusy === "install:x-api";
          if (!busy) setRecommendedInstall(null);
        }}
        title={
          recommendedInstall === "x-api"
            ? tr("ext.plugins.recommended.xApiInstallTitle")
            : tr("ext.plugins.recommended.installTitle")
        }
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={
                actionBusy === "install:chatcut" ||
                actionBusy === "install:x-api"
              }
              onClick={() => setRecommendedInstall(null)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={
                actionBusy === "install:chatcut" ||
                actionBusy === "install:x-api" ||
                cliMissing ||
                !recommendedInstall
              }
              onClick={() => {
                if (recommendedInstall) void installRecommended(recommendedInstall);
              }}
            >
              {actionBusy === "install:chatcut" ||
              actionBusy === "install:x-api"
                ? tr("ext.plugins.installing")
                : tr("ext.plugins.recommended.install")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">
          {recommendedInstall === "x-api"
            ? tr("ext.plugins.recommended.xApiInstallConfirm", {
                source: X_API_INSTALL_SOURCE,
              })
            : tr("ext.plugins.recommended.installConfirm", {
                source: CHATCUT_CODEX_INSTALL_SOURCE,
              })}
        </p>
        <p className="ext-field-hint">{tr("ext.market.installTrustNote")}</p>
      </GlassModal>

      <PluginMcpAuthWizard
        open={!!pluginAuthServer}
        locale={locale}
        serverName={pluginAuthServer ?? ""}
        onClose={() => setPluginAuthServer(null)}
        onChanged={(st) => {
          setPluginAuthStatus((prev) => ({ ...prev, [st.server]: st }));
        }}
      />

      <GlassModal
        open={pathInstallOpen}
        onClose={() => setPathInstallOpen(false)}
        title={tr("ext.plugins.advancedInstall")}
        size="lg"
        closeLabel={tr("common.close")}
        wrapBody
        initialFocus={() => pathInstallInputRef.current}
      >
        <PluginPathInstallCard
          locale={locale}
          source={installSource}
          onSourceChange={(next) => {
            setInstallSource(next);
            setPathInstallError(null);
            setPathValidate(null);
          }}
          disabled={!!actionBusy || cliMissing}
          installing={actionBusy === "install"}
          validating={actionBusy === "validate-path"}
          formError={pathInstallError}
          validatePresentation={pathValidate}
          kindLabels={pluginValidateKindLabels}
          kindHints={pluginValidateKindHints}
          onBrowse={() => void browsePluginFolder()}
          onValidate={() => void validatePathInstall()}
          onInstall={requestPathInstall}
          inputRef={pathInstallInputRef}
        />
      </GlassModal>

      <GlassModal
        open={!!installConfirmSource}
        onClose={() => {
          if (actionBusy === "install") return;
          setInstallConfirmSource(null);
          setPathInstallOpen(true);
        }}
        title={tr("ext.plugins.installConfirmTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={actionBusy === "install"}
              onClick={() => {
                setInstallConfirmSource(null);
                setPathInstallOpen(true);
              }}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={actionBusy === "install" || cliMissing}
              onClick={() => void confirmPathInstall()}
            >
              {actionBusy === "install"
                ? tr("ext.plugins.installing")
                : tr("ext.plugins.install")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">
          {tr("ext.plugins.installConfirm", {
            source: installConfirmSource ?? "",
          })}
        </p>
        <p className="ext-field-hint">{tr("ext.market.installTrustNote")}</p>
      </GlassModal>

      <GlassModal
        open={!!detailCard}
        onClose={() => {
          setDetailCard(null);
          setDetailRawAvailable(null);
          setDetailRawInstalled(null);
        }}
        title={detailCard?.displayName ?? tr("ext.market.detailTitle")}
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setDetailCard(null);
                setDetailRawAvailable(null);
                setDetailRawInstalled(null);
              }}
            >
              {tr("common.close")}
            </button>
            {detailRawAvailable && !detailCard?.installed ? (
              <button
                type="button"
                className="btn btn--solid"
                disabled={
                  !!actionBusy ||
                  cliMissing ||
                  actionBusy === `inst:${detailRawAvailable.name}`
                }
                onClick={() => {
                  const t = detailRawAvailable;
                  setDetailCard(null);
                  setDetailRawAvailable(null);
                  void installAvailableDirect(t);
                }}
              >
                {actionBusy === `inst:${detailRawAvailable.name}`
                  ? tr("ext.market.installing")
                  : tr("ext.market.install")}
              </button>
            ) : null}
            {detailRawInstalled ? (
              <button
                type="button"
                className="btn btn--solid"
                onClick={() => {
                  togglePlugin(detailRawInstalled);
                  setDetailCard(null);
                  setDetailRawInstalled(null);
                }}
              >
                {detailRawInstalled.enabled
                  ? tr("ext.plugins.disable")
                  : tr("ext.plugins.enable")}
              </button>
            ) : null}
          </>
        }
      >
        {detailCard ? (
          <div className="ext-market-detail">
            <div
              style={{
                display: "flex",
                gap: 14,
                alignItems: "flex-start",
                marginBottom: 12,
              }}
            >
              <div className="ext-ref-featured__icon" aria-hidden>
                {detailCard.iconUrl ? (
                  <img src={detailCard.iconUrl} alt="" />
                ) : (
                  <span className="ext-ref-icon__glyph">
                    {pluginInitials(detailCard.displayName)}
                  </span>
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="ext-ref-featured__title">
                  {detailCard.displayName}
                </div>
                <div className="ext-ref-featured__desc">
                  {detailCard.description || "—"}
                </div>
              </div>
            </div>
            {(() => {
              const meta = metaByName.get(
                detailCard.name.trim().toLowerCase(),
              );
              const clean: Array<[string, string]> = [];
              clean.push([
                tr("ext.market.field.marketplace"),
                detailCard.marketplace?.trim() || "—",
              ]);
              clean.push([
                tr("ext.market.field.version"),
                String(detailCard.version || meta?.version || "—"),
              ]);
              if (meta?.category || detailCard.categoryLabel) {
                clean.push([
                  detailCard.categoryLabel || "Category",
                  meta?.category || detailCard.categoryLabel || "—",
                ]);
              }
              if (meta?.author) clean.push(["Author", meta.author]);
              if (meta?.homepage) clean.push(["Homepage", meta.homepage]);
              if (meta?.repository) clean.push(["Repository", meta.repository]);
              if (meta?.license) clean.push(["License", meta.license]);
              if (detailCard.providesLine) {
                clean.push([
                  tr("ext.market.componentsLabel"),
                  detailCard.providesLine,
                ]);
              }
              if (meta?.keywords && meta.keywords.length > 0) {
                clean.push(["Keywords", meta.keywords.join(", ")]);
              }
              if (detailRawInstalled?.path) {
                clean.push(["Path", detailRawInstalled.path]);
              }
              if (detailRawInstalled?.source) {
                clean.push([
                  tr("ext.market.field.source"),
                  detailRawInstalled.source,
                ]);
              }
              return (
                <dl className="ext-market-detail__meta">
                  {clean.map(([k, v]) => (
                    <div key={k} className="ext-market-detail__row">
                      <dt>{k}</dt>
                      <dd title={v}>{v}</dd>
                    </div>
                  ))}
                </dl>
              );
            })()}
            {(() => {
              const meta = metaByName.get(
                detailCard.name.trim().toLowerCase(),
              );
              const long =
                meta?.longDescription?.trim() ||
                detailCard.description ||
                "";
              if (!long) return null;
              return (
                <p className="ext-field-hint" style={{ marginTop: 12 }}>
                  {long}
                </p>
              );
            })()}
            {!detailCard.installed ? (
              <p className="ext-field-hint" style={{ marginTop: 8 }}>
                {tr("ext.market.installTrustNote")}
              </p>
            ) : null}
          </div>
        ) : null}
      </GlassModal>

      <GlassModal
        open={!!menuPlugin}
        onClose={() => setMenuPlugin(null)}
        title={
          pluginDisplayName(
            menuPlugin,
            tr("ext.plugins.recommended.chatcutName"),
          )
        }
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setMenuPlugin(null)}
          >
            {tr("common.close")}
          </button>
        }
      >
        {menuPlugin ? (
          <div className="ext-ref-stack" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn--ghost"
              style={{ justifyContent: "flex-start" }}
              onClick={() => {
                togglePlugin(menuPlugin);
                setMenuPlugin(null);
              }}
            >
              {menuPlugin.enabled
                ? tr("ext.plugins.disable")
                : tr("ext.plugins.enable")}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              style={{ justifyContent: "flex-start" }}
              onClick={() => {
                void showDetails(menuPlugin);
                setMenuPlugin(null);
              }}
            >
              {tr("ext.plugins.details")}
            </button>
            <button
              type="button"
              className="btn btn--ghost ext-item__danger"
              style={{ justifyContent: "flex-start" }}
              onClick={() => {
                setUninstallTarget(menuPlugin);
                setMenuPlugin(null);
              }}
            >
              {tr("ext.plugins.uninstall")}
            </button>
          </div>
        ) : null}
      </GlassModal>

      <GlassModal
        open={sourcesModalOpen}
        onClose={() => setSourcesModalOpen(false)}
        title={tr("ext.plugins.sourcesModalTitle")}
        size="lg"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={openPathInstall}
            >
              {tr("ext.plugins.advancedInstall")}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setSourcesModalOpen(false)}
            >
              {tr("common.close")}
            </button>
          </>
        }
      >
        <p className="ext-ref-block__lead" style={{ marginBottom: 12 }}>
          {tr("ext.plugins.sourcesModalLead")}
        </p>
        <div className="ext-ref-block" style={{ marginBottom: 16 }}>
          <div className="ext-ref-block__head">
            <h3 className="ext-ref-block__title">
              {tr("ext.plugins.sourcesListTitle")}
            </h3>
          </div>
          {/* Reuse market block for sources management only (non-embedded shows sources). */}
          <ExtensionsBuildExtras
            locale={locale}
            projectPath={projectPath}
            cliFound={cliFound && !cliMissing}
            mode="market"
            embedded
            sourcesOnly
            installedPlugins={plugins.map((p) => ({
              name: p.name,
              marketplace: p.marketplace,
              path: p.path,
              source: p.source,
              repoKey: p.repoKey,
            }))}
            onOpenRuntime={onOpenRuntime}
            onPluginsChanged={() => {
              invalidatePluginsListCache();
              void refresh({ forcePlugins: true });
            }}
          />
        </div>
      </GlassModal>

      <GlassModal
        open={!!uninstallTarget}
        onClose={() => {
          if (!actionBusy) setUninstallTarget(null);
        }}
        title={tr("ext.plugins.uninstallTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!!actionBusy}
              onClick={() => setUninstallTarget(null)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={!!actionBusy}
              onClick={() => void confirmUninstall()}
            >
              {tr("ext.plugins.uninstall")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">
          {tr("ext.plugins.uninstallConfirm", {
            name: uninstallTarget?.name ?? "",
          })}
        </p>
      </GlassModal>

      <GlassModal
        open={validateModal.open && !!validateModal.presentation}
        onClose={() =>
          setValidateModal((prev) => ({ ...prev, open: false }))
        }
        title={
          validateModal.pluginName
            ? tr("ext.plugins.validate.resultTitleNamed", {
                name: validateModal.pluginName,
              })
            : tr("ext.plugins.validate.resultTitle")
        }
        size="lg"
        closeLabel={tr("common.close")}
        wrapBody
        bodyClassName="ext-plugin-result-modal"
        footer={
          <button
            type="button"
            className="btn btn--solid"
            onClick={() =>
              setValidateModal((prev) => ({ ...prev, open: false }))
            }
          >
            {tr("common.close")}
          </button>
        }
      >
        {validateModal.presentation ? (
          <div className="ext-plugin-result">
            <div className="ext-plugin-result__meta">
              <span
                className={
                  "ext-badge ext-badge--" +
                  pluginValidateBadgeTone(validateModal.presentation.severity)
                }
              >
                {pluginValidateKindLabel(
                  validateModal.presentation.kind,
                  pluginValidateKindLabels,
                )}
              </span>
              {validateModal.presentation.softFail ? (
                <span className="ext-badge ext-badge--muted">
                  {tr("ext.plugins.validate.softFail")}
                </span>
              ) : null}
              {validateModal.presentation.ok ? (
                <span className="ext-badge ext-badge--ok">
                  {tr("ext.plugins.validateOk")}
                </span>
              ) : null}
            </div>
            <p
              className={
                "ext-plugin-result__summary" +
                (validateModal.presentation.severity === "ok"
                  ? " ext-plugin-result__summary--ok"
                  : validateModal.presentation.severity === "err"
                    ? " ext-plugin-result__summary--err"
                    : " ext-plugin-result__summary--warn")
              }
            >
              {validateModal.presentation.summary}
            </p>
            {pluginValidateHint(
              validateModal.presentation.kind,
              pluginValidateKindHints,
            ) ? (
              <p className="ext-plugin-result__hint">
                {pluginValidateHint(
                  validateModal.presentation.kind,
                  pluginValidateKindHints,
                )}
              </p>
            ) : null}
            {validateModal.presentation.detail &&
            validateModal.presentation.detail !==
              validateModal.presentation.summary ? (
              <pre className="ext-plugin-result__detail">
                {validateModal.presentation.detail}
              </pre>
            ) : validateModal.presentation.messages.length > 1 ? (
              <pre className="ext-plugin-result__detail">
                {formatPluginValidateMessages(
                  validateModal.presentation.messages,
                )}
              </pre>
            ) : null}
            {validateModal.presentation.reason ? (
              <p className="ext-plugin-result__reason">
                <span className="ext-plugin-result__label">
                  {tr("ext.plugins.validate.reason")}
                </span>
                <code>{validateModal.presentation.reason}</code>
              </p>
            ) : null}
            {validateModal.presentation.path ? (
              <p
                className="ext-plugin-result__path"
                title={validateModal.presentation.path}
              >
                <span className="ext-plugin-result__label">
                  {tr("ext.plugins.validate.path")}
                </span>
                <code>{validateModal.presentation.path}</code>
              </p>
            ) : null}
          </div>
        ) : null}
      </GlassModal>

      <GlassModal
        open={detailsOpen}
        onClose={() => {
          setDetailsOpen(false);
          setDetailsModel(null);
        }}
        title={tr("ext.plugins.detailsTitle", { name: detailsTitle })}
        size="lg"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setDetailsOpen(false);
              setDetailsModel(null);
            }}
          >
            {tr("common.close")}
          </button>
        }
      >
        {detailsModel ? (
          <div className="ext-market-detail">
            <dl className="ext-market-detail__meta">
              <div className="ext-market-detail__row">
                <dt>{tr("ext.market.field.marketplace")}</dt>
                <dd>
                  {detailsModel.marketplace?.trim() ||
                    tr("ext.market.field.unknown")}
                </dd>
              </div>
              <div className="ext-market-detail__row">
                <dt>{tr("ext.market.field.version")}</dt>
                <dd>
                  {detailsModel.versionLabel
                    ? `v${detailsModel.versionLabel}`
                    : tr("ext.market.field.unknown")}
                </dd>
              </div>
            </dl>
            {detailsModel.badges.length > 0 ? (
              <div
                className="ext-component-badges ext-component-badges--detail"
                aria-label={tr("ext.market.componentsLabel")}
              >
                {detailsModel.badges.map((b) => (
                  <span
                    key={b.kind}
                    className={
                      "ext-badge ext-badge--component ext-badge--component-" +
                      b.kind
                    }
                  >
                    {badgeLabel(b.kind, b.count)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {detailsLoading ? (
          <p className="ext-empty">{tr("ext.plugins.detailsLoading")}</p>
        ) : (
          <pre className="ext-details-pre">{detailsBody}</pre>
        )}
      </GlassModal>
    </>
  );
}
