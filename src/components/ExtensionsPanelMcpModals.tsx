/**
 * MCP modal farm for ExtensionsPanel: server add form, remove confirm,
 * doctor report, and the two OAuth wizards. Extracted verbatim from the
 * panel (WP: giant-component decomposition).
 */
import * as api from "@/lib/api";
import type { Locale, MessageKey } from "@/i18n";
import { createT } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import { shortPathLabel } from "@/lib/extensionsUi";
import { IconRefresh } from "@/components/icons";
import { McpOauthWizard } from "@/components/McpOauthWizard";
import {
  lookupServerStatus,
  indexDoctorServerStatuses,
  mcpStatusBadgeMod,
  mcpStatusLabelKey,
  mcpAuthGuidanceKey,
  redactMcpText,
  type McpStatusIndex,
  type McpServerStatus,
} from "@/lib/mcpStatus";
import {
  classifyMcpOauthFromStatus,
  mcpOauthActionLabelKey,
  type McpOauthAction,
} from "@/lib/mcpOauth";

type TFn = ReturnType<typeof createT>;

export type ExtensionsPanelMcpModalsProps = {
  addOpen: boolean;
  setAddOpen: (v: boolean) => void;
  addName: string;
  setAddName: (v: string) => void;
  addCommand: string;
  setAddCommand: (v: string) => void;
  addArgs: string;
  setAddArgs: (v: string) => void;
  addEnv: string;
  setAddEnv: (v: string) => void;
  submitAdd: () => Promise<void>;
  removeTarget: api.McpDto | null;
  setRemoveTarget: (v: api.McpDto | null) => void;
  confirmRemoveMcp: () => Promise<void>;
  doctorOpen: boolean;
  setDoctorOpen: (v: boolean) => void;
  runDoctor: (focus?: string | null) => void;
  doctorStatusIndex: McpStatusIndex;
  setDoctorStatusIndex: (
    v:
      | McpStatusIndex
      | ((prev: McpStatusIndex) => McpStatusIndex),
  ) => void;
  // Panel keeps this as `any` (raw host report json).
  doctorReport: any;
  setDoctorReport: (v: any) => void;
  doctorReportStatusIndex: McpStatusIndex;
  doctorLoading: boolean;
  setDoctorLoading: (v: boolean) => void;
  doctorError: string | null;
  setDoctorError: (v: string | null) => void;
  doctorFocus: string | null;
  setDoctorFocus: (v: string | null) => void;
  setDoctorLastAt: (v: number | null) => void;
  oauthWizardTarget: { action: McpOauthAction; status: McpServerStatus } | null;
  setOauthWizardTarget: (
    v: { action: McpOauthAction; status: McpServerStatus } | null,
  ) => void;
  openOauthWizard: (
    action: McpOauthAction | null,
    status: McpServerStatus,
  ) => void;

  tr: TFn;
  locale: Locale;
  actionBusy: string | null;
};

export function ExtensionsPanelMcpModals(p: ExtensionsPanelMcpModalsProps) {
  const {
    addOpen,
    setAddOpen,
    addName,
    setAddName,
    addCommand,
    setAddCommand,
    addArgs,
    setAddArgs,
    addEnv,
    setAddEnv,
    submitAdd,
    removeTarget,
    setRemoveTarget,
    confirmRemoveMcp,
    doctorOpen,
    setDoctorOpen,
    runDoctor,
    doctorStatusIndex,
    setDoctorStatusIndex,
    doctorReportStatusIndex,
    doctorLoading,
    setDoctorLoading,
    doctorError,
    setDoctorError,
    doctorReport,
    setDoctorReport,
    doctorFocus,
    setDoctorFocus,
    setDoctorLastAt,
    oauthWizardTarget,
    setOauthWizardTarget,
    openOauthWizard,
    tr,
    locale,
    actionBusy,
  } = p;
  return (
    <>
      <GlassModal
        open={addOpen}
        onClose={() => {
          if (actionBusy !== "mcp:add") setAddOpen(false);
        }}
        title={tr("ext.mcp.addTitle")}
        size="md"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={actionBusy === "mcp:add"}
              onClick={() => setAddOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={
                actionBusy === "mcp:add" ||
                !addName.trim() ||
                !addCommand.trim()
              }
              onClick={() => void submitAdd()}
            >
              {actionBusy === "mcp:add"
                ? tr("ext.mcp.addWorking")
                : tr("ext.mcp.addSubmit")}
            </button>
          </>
        }
      >
        <form
          className="app-dialog__form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitAdd();
          }}
        >
          <label className="field">
            <span>{tr("ext.mcp.name")}</span>
            <input
              className="app-dialog__input"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder={tr("ext.mcp.namePlaceholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={actionBusy === "mcp:add"}
            />
          </label>
          <label className="field">
            <span>{tr("ext.mcp.command")}</span>
            <input
              className="app-dialog__input"
              value={addCommand}
              onChange={(e) => setAddCommand(e.target.value)}
              placeholder={tr("ext.mcp.commandPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={actionBusy === "mcp:add"}
            />
          </label>
          <label className="field">
            <span>{tr("ext.mcp.args")}</span>
            <input
              className="app-dialog__input"
              value={addArgs}
              onChange={(e) => setAddArgs(e.target.value)}
              placeholder={tr("ext.mcp.argsPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              disabled={actionBusy === "mcp:add"}
            />
            <span className="ext-field-hint">{tr("ext.mcp.argsHint")}</span>
          </label>
          <label className="field">
            <span>{tr("ext.mcp.env")}</span>
            <textarea
              className="app-dialog__input ext-env-textarea"
              value={addEnv}
              onChange={(e) => setAddEnv(e.target.value)}
              placeholder={tr("ext.mcp.envPlaceholder")}
              rows={3}
              spellCheck={false}
              disabled={actionBusy === "mcp:add"}
            />
            <span className="ext-field-hint">{tr("ext.mcp.envHint")}</span>
          </label>
        </form>
      </GlassModal>

      <GlassModal
        open={!!removeTarget}
        onClose={() => {
          if (!actionBusy) setRemoveTarget(null);
        }}
        title={tr("ext.mcp.removeTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!!actionBusy}
              onClick={() => setRemoveTarget(null)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={!!actionBusy}
              onClick={() => void confirmRemoveMcp()}
            >
              {tr("ext.mcp.remove")}
            </button>
          </>
        }
      >
        <p className="app-dialog__msg">
          {tr("ext.mcp.removeConfirm", {
            name: removeTarget?.name ?? "",
          })}
        </p>
      </GlassModal>

      <GlassModal
        open={doctorOpen}
        onClose={() => {
          if (!doctorLoading) setDoctorOpen(false);
        }}
        title={
          doctorFocus
            ? `${tr("ext.mcp.doctorTitle")} · ${doctorFocus}`
            : tr("ext.mcp.doctorTitle")
        }
        size="lg"
        closeLabel={tr("common.close")}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={doctorLoading}
              onClick={() => void runDoctor(doctorFocus)}
            >
              <IconRefresh size={14} />
              <span>{tr("ext.mcp.doctorRerun")}</span>
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={doctorLoading}
              onClick={() => setDoctorOpen(false)}
            >
              {tr("common.close")}
            </button>
          </>
        }
      >
        {doctorLoading && (
          <p className="ext-empty">{tr("ext.mcp.doctorRunning")}</p>
        )}
        {!doctorLoading && doctorError && (
          <div className="ext-alert ext-alert--error" role="alert">
            <p className="ext-alert__body">{doctorError}</p>
          </div>
        )}
        {!doctorLoading && doctorReport && (
          <div className="ext-doctor">
            <p className="ext-doctor__summary">
              {tr("ext.mcp.doctorSummary", {
                healthy: doctorReport.summary.healthy,
                unhealthy: doctorReport.summary.unhealthy,
                total: doctorReport.summary.total,
              })}
            </p>
            {(doctorReport.sources?.length ?? 0) > 0 ? (
              <div className="ext-doctor__sources">
                <div className="ext-doctor__section-title">
                  {tr("ext.mcp.doctorSources")}
                </div>
                <ul className="ext-doctor__source-list">
                  {doctorReport.sources.map((src: any) => (
                    <li key={src.path}>
                      <code>{src.path}</code>
                      <span className="ext-badge ext-badge--muted">
                        {src.status}
                        {src.serverCount != null
                          ? ` · ${src.serverCount}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {(doctorReport.servers?.length ?? 0) === 0 ? (
              <p className="ext-empty">
                {redactMcpText(doctorReport.rawText)?.trim() ||
                  tr("ext.mcp.doctorEmpty")}
              </p>
            ) : (
              <ul className="ext-list ext-doctor__servers">
                {doctorReport.servers.map((s: any) => {
                  const st =
                    lookupServerStatus(doctorReportStatusIndex, s.name) ??
                    lookupServerStatus(doctorStatusIndex, s.name);
                  const badgeMod = st
                    ? mcpStatusBadgeMod(st.tone)
                    : s.healthy
                      ? "ok"
                      : "fail";
                  const label = st
                    ? tr(mcpStatusLabelKey(st.tone) as MessageKey)
                    : s.healthy
                      ? tr("ext.mcp.doctorHealthy")
                      : tr("ext.mcp.doctorUnhealthy");
                  const guidanceKey = st
                    ? mcpAuthGuidanceKey(st.tone)
                    : null;
                  const oauthAction = st
                    ? classifyMcpOauthFromStatus(st)
                    : null;
                  return (
                    <li
                      key={s.name}
                      className={
                        "ext-item" + (s.healthy ? "" : " ext-item--off")
                      }
                    >
                      <div className="ext-item__head">
                        <strong className="ext-item__name">{s.name}</strong>
                        <span
                          className={
                            "ext-mcp-status ext-mcp-status--" + badgeMod
                          }
                        >
                          <span
                            className="ext-mcp-status__lamp"
                            aria-hidden
                          />
                          <span
                            className={"ext-badge ext-badge--" + badgeMod}
                          >
                            {label}
                          </span>
                        </span>
                        {s.transport ? (
                          <span className="ext-badge ext-badge--muted">
                            {s.transport}
                          </span>
                        ) : null}
                      </div>
                      {s.target ? (
                        <p className="ext-item__desc" title={s.target}>
                          {shortPathLabel(s.target, 72) || s.target}
                        </p>
                      ) : null}
                      {st?.needsAuthRefresh && guidanceKey ? (
                        <div className="ext-mcp-auth-row">
                          <p className="ext-mcp-auth-hint">
                            {tr(guidanceKey as MessageKey)}
                          </p>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => openOauthWizard(oauthAction, st)}
                          >
                            {tr(
                              (oauthAction
                                ? mcpOauthActionLabelKey(oauthAction.kind)
                                : "ext.mcp.auth.howToRefresh") as MessageKey,
                            )}
                          </button>
                        </div>
                      ) : null}
                      {Array.isArray(s.checks) && s.checks.length > 0 ? (
                        <ul className="ext-doctor__checks">
                          {s.checks.map((c: any, i: any) => (
                            <li
                              key={`${s.name}:${c.label}:${i}`}
                              className={
                                "ext-doctor__check" +
                                (c.passed ? " is-pass" : " is-fail")
                              }
                            >
                              <span className="ext-doctor__check-label">
                                {c.passed ? "✓" : "✗"} {c.label}
                              </span>
                              {c.detail ? (
                                <span className="ext-doctor__check-detail">
                                  {redactMcpText(c.detail)}
                                </span>
                              ) : null}
                              {c.hint ? (
                                <span className="ext-doctor__check-hint">
                                  {tr("ext.mcp.doctorHint", {
                                    hint: redactMcpText(c.hint),
                                  })}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {doctorReport.rawText ? (
              <pre className="ext-details-pre">
                {redactMcpText(doctorReport.rawText)}
              </pre>
            ) : null}
          </div>
        )}
      </GlassModal>

      <McpOauthWizard
        open={!!oauthWizardTarget}
        locale={locale}
        action={oauthWizardTarget?.action ?? null}
        statusReason={oauthWizardTarget?.status.reason ?? null}
        onClose={() => setOauthWizardTarget(null)}
        onRefreshDoctor={async (serverName) => {
          // Keep doctor modal closed when refreshing from wizard; still update index.
          if (!api.isTauri()) {
            return { report: null, error: tr("ext.needTauri") };
          }
          setDoctorLoading(true);
          setDoctorError(null);
          setDoctorFocus(serverName?.trim() || null);
          try {
            const report = await api.mcpDoctor(serverName?.trim() || null);
            setDoctorReport(report);
            setDoctorLastAt(Date.now());
            const next = indexDoctorServerStatuses(report);
            setDoctorStatusIndex((prev) => {
              if (!serverName?.trim()) return next;
              const merged = new Map(prev);
              for (const [k, v] of next) merged.set(k, v);
              return merged;
            });
            return { report, error: null };
          } catch (e) {
            const error = String(e);
            setDoctorError(error);
            return { report: null, error };
          } finally {
            setDoctorLoading(false);
          }
        }}
      />

    </>
  );
}
