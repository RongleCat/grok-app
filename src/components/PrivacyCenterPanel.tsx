/**
 * Settings → Runtime → Privacy: honest Grok Build 0.2.117 privacy keys.
 * Independent agent-home: allowlisted read/write. Shared mode: read-only probe.
 * Coding-data / training is CLI `/privacy` only — never a fake App toggle.
 * Probe soft-fail is classified; unset keys never invent “off”.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import type { PrivacyConfigSnapshot } from "@/lib/api";
import { createT, type Locale, type MessageKey } from "@/i18n";
import {
  buildPrivacyPatch,
  classifyPrivacyProbeResult,
  CLI_PRIVACY_COMMAND,
  hasPrivacyChanges,
  privacyIsUnset,
  privacyKeyDefaultHintMessageKey,
  privacyKeyPresence,
  privacyPresenceMessageKey,
  privacyProbeErrorMessageKey,
  privacyProbeOutcomeMessageKey,
  privacyProbeToneClass,
  privacySummaryMessageKey,
  privacySummaryKind,
  privacyToggleChecked,
  resolvePrivacyProbeErrorCopy,
  summarizePrivacyValues,
  valuesFromPrivacySnapshot,
  type ClassifiedPrivacyProbe,
  type PrivacyTri,
  type PrivacyValues,
  type PrivacyWritableKey,
} from "@/lib/privacyConfig";
import {
  buildExternalOtelChecklist,
  evidenceFromExternalOtelConfigText,
  externalOtelSharedModeNoteKey,
  externalOtelStatusMessageKey,
  externalOtelStatusTone,
  externalOtelToneClass,
  formatExternalOtelEnvHints,
  mergeExternalOtelEvidence,
  resolveExternalOtelStatus,
} from "@/lib/externalOtelHonesty";
import { IconRefresh } from "@/components/icons";
import { UiCheck } from "@/components/settings/shared";

function PresenceBadge({
  value,
  t,
}: {
  value: PrivacyTri;
  t: (k: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  const p = privacyKeyPresence(value);
  const label = t(privacyPresenceMessageKey(p) as MessageKey);
  if (p === "unset") {
    return (
      <span className="ext-badge ext-badge--muted" title={label}>
        {label}
      </span>
    );
  }
  if (p === "set_on") {
    return <span className="ext-badge">{label}</span>;
  }
  return (
    <span className="ext-badge ext-badge--muted" title={label}>
      {label}
    </span>
  );
}

type RowKey = keyof PrivacyValues;

function PrivacyRow({
  id,
  labelKey,
  descKey,
  configKey,
  valueKey,
  value,
  disabled,
  onToggle,
  t,
}: {
  id: string;
  labelKey: MessageKey;
  descKey: MessageKey;
  configKey: string;
  valueKey: PrivacyWritableKey;
  value: PrivacyTri;
  disabled: boolean;
  onToggle: (next: boolean) => void;
  t: (k: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  const unset = privacyIsUnset(value);
  return (
    <div className="settings-row" id={id}>
      <div className="settings-row__text">
        <div className="settings-row__label">
          {t(labelKey)} <PresenceBadge value={value} t={t} />
        </div>
        <div className="settings-row__desc">{t(descKey)}</div>
        {unset ? (
          <div className="settings-row__hint settings-privacy__default-hint">
            {t(privacyKeyDefaultHintMessageKey(valueKey) as MessageKey)}
          </div>
        ) : null}
        <div className="settings-row__hint" title={configKey}>
          {configKey}
        </div>
      </div>
      <UiCheck
        checked={privacyToggleChecked(value)}
        disabled={disabled}
        onChange={onToggle}
        ariaLabel={t(labelKey)}
      />
    </div>
  );
}

export function PrivacyCenterPanel({
  locale,
  onSaved,
  onError,
}: {
  locale: Locale;
  onSaved?: () => void;
  onError?: (message: string) => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const t = useCallback(
    (k: MessageKey, vars?: Record<string, string | number>) => tr(k, vars),
    [tr],
  );

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [errorMessageKey, setErrorMessageKey] = useState<string | null>(null);
  const [snap, setSnap] = useState<PrivacyConfigSnapshot | null>(null);
  const [probe, setProbe] = useState<ClassifiedPrivacyProbe | null>(null);
  const [baseline, setBaseline] = useState<PrivacyValues>(
    valuesFromPrivacySnapshot({}),
  );
  const [draft, setDraft] = useState<PrivacyValues>(
    valuesFromPrivacySnapshot({}),
  );
  const [copied, setCopied] = useState(false);
  const [otelCopied, setOtelCopied] = useState(false);

  const applySnap = useCallback((s: PrivacyConfigSnapshot) => {
    setSnap(s);
    const classified = classifyPrivacyProbeResult(s);
    setProbe(classified);
    const vals = valuesFromPrivacySnapshot({
      telemetry: s.telemetry,
      traceUpload: s.traceUpload,
      mixpanelEnabled: s.mixpanelEnabled,
      disableCodebaseUpload: s.disableCodebaseUpload,
      disableWorkspaceTeleport: s.disableWorkspaceTeleport,
    });
    setBaseline(vals);
    setDraft(vals);
    setErrorDetail(null);
    setErrorMessageKey(null);
  }, []);

  const applySoftFail = useCallback(
    (err: unknown, available = true) => {
      const copy = resolvePrivacyProbeErrorCopy({ err });
      const classified = classifyPrivacyProbeResult(null, {
        available,
        invokeError: available ? copy.detail || String(err) : null,
      });
      setProbe(classified);
      setSnap(null);
      setErrorMessageKey(copy.messageKey);
      setErrorDetail(copy.detail || null);
      const toast = t(copy.messageKey as MessageKey);
      onError?.(toast);
    },
    [onError, t],
  );

  const load = useCallback(async () => {
    if (!api.isTauri()) {
      const classified = classifyPrivacyProbeResult(null, { available: false });
      setProbe(classified);
      setSnap(null);
      setErrorMessageKey(privacyProbeErrorMessageKey("host_only"));
      setErrorDetail(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorDetail(null);
    setErrorMessageKey(null);
    try {
      const res = await api.privacyConfigGet();
      applySnap(res);
    } catch (e) {
      applySoftFail(e, true);
    } finally {
      setLoading(false);
    }
  }, [applySnap, applySoftFail]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useMemo(
    () => buildPrivacyPatch(draft, baseline),
    [draft, baseline],
  );
  const dirty = hasPrivacyChanges(patch);
  const writable = !!snap?.writable;
  const disabled = !writable || busy || loading;

  const draftSummary = useMemo(() => summarizePrivacyValues(draft), [draft]);
  const draftSummaryKind = useMemo(
    () => privacySummaryKind(draft),
    [draft],
  );

  const setKey = (key: RowKey, next: boolean) => {
    setDraft((d) => ({ ...d, [key]: next }));
  };

  const save = async () => {
    if (!dirty || !writable || !api.isTauri()) return;
    setBusy(true);
    setErrorDetail(null);
    setErrorMessageKey(null);
    try {
      const res = await api.privacyConfigSet({
        telemetry: patch.telemetry ?? null,
        traceUpload: patch.traceUpload ?? null,
        mixpanelEnabled: patch.mixpanelEnabled ?? null,
        disableCodebaseUpload: patch.disableCodebaseUpload ?? null,
        disableWorkspaceTeleport: patch.disableWorkspaceTeleport ?? null,
      });
      applySnap(res);
      onSaved?.();
    } catch (e) {
      applySoftFail(e, true);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const reset = () => setDraft(baseline);

  const copyPrivacyCmd = async () => {
    const cmd = snap?.cliPrivacyCommand || CLI_PRIVACY_COMMAND;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore — clipboard may be blocked
    }
  };

  const copyOtelEnv = async () => {
    try {
      await navigator.clipboard.writeText(formatExternalOtelEnvHints());
      setOtelCopied(true);
      window.setTimeout(() => setOtelCopied(false), 1600);
    } catch {
      // ignore — clipboard may be blocked
    }
  };

  /**
   * Soft evidence only from privacy redacted preview (if any otel_* peers).
   * No host invent: missing preview → unknown dual-opt-in status.
   */
  const externalOtel = useMemo(() => {
    const fromPreview = evidenceFromExternalOtelConfigText(
      snap?.redactedPreview ?? null,
    );
    const evidence = mergeExternalOtelEvidence(fromPreview, {
      available: api.isTauri() ? true : false,
    });
    const status = resolveExternalOtelStatus(evidence);
    const tone = externalOtelStatusTone(status);
    const checklist = buildExternalOtelChecklist(evidence);
    return { evidence, status, tone, checklist };
  }, [snap?.redactedPreview]);

  const probeTone = probe ? privacyProbeToneClass(probe.tone) : "";
  const hardFail = probe != null && probe.outcome === "error" && !snap;

  return (
    <div
      className="settings-row settings-row--stack settings-privacy"
      id="settings-anchor-privacy"
    >
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.privacy")}</div>
        <div className="settings-row__desc">{t("settings.privacyDesc")}</div>
        {snap?.path ? (
          <div className="settings-row__hint" title={snap.path}>
            {t("settings.privacy.path", { path: snap.path })}
          </div>
        ) : null}
      </div>

      {loading && !snap ? (
        <p className="ext-field-hint">{t("settings.privacy.loading")}</p>
      ) : null}

      {probe && !loading ? (
        <div
          className={
            "settings-config-edit__badges settings-privacy__probe " + probeTone
          }
          role="status"
        >
          <span
            className={
              "ext-badge" +
              (probe.tone === "err"
                ? " ext-badge--danger"
                : probe.tone === "muted" || probe.tone === "info"
                  ? " ext-badge--muted"
                  : "")
            }
          >
            {t(privacyProbeOutcomeMessageKey(probe.outcome) as MessageKey)}
          </span>
          {snap ? (
            <span className="ext-badge ext-badge--muted">
              {t(privacySummaryMessageKey(draftSummaryKind) as MessageKey, {
                set: draftSummary.setCount,
                unset: draftSummary.unsetCount,
                total: draftSummary.total,
              })}
            </span>
          ) : null}
        </div>
      ) : null}

      {errorMessageKey ? (
        <div
          className={
            "ext-alert" +
            (hardFail || probe?.tone === "err"
              ? " ext-alert--error"
              : " ext-alert--warn")
          }
          role={hardFail || probe?.tone === "err" ? "alert" : "status"}
        >
          <div className="ext-alert__title">
            {t(errorMessageKey as MessageKey)}
          </div>
          {errorDetail &&
          errorDetail.trim() &&
          errorDetail !== t(errorMessageKey as MessageKey) ? (
            <p className="ext-alert__body">{errorDetail}</p>
          ) : null}
        </div>
      ) : null}

      {snap && !writable ? (
        <div className="ext-alert ext-alert--warn" role="status">
          <p className="ext-alert__body" style={{ margin: 0 }}>
            {t("settings.privacy.sharedWarning")}
          </p>
        </div>
      ) : null}

      {snap && draftSummary.allUnset ? (
        <div className="ext-alert ext-alert--info" role="status">
          <p className="ext-alert__body" style={{ margin: 0 }}>
            {t("settings.privacy.unsetNotOff")}
          </p>
        </div>
      ) : null}

      {snap ? (
        <>
          <div className="settings-config-edit__badges">
            <span className="ext-badge ext-badge--muted">
              {snap.mode === "shared"
                ? t("settings.privacy.mode.shared")
                : t("settings.privacy.mode.independent")}
            </span>
            {!snap.fileExists ? (
              <span className="ext-badge">
                {t("settings.privacy.missing")}
              </span>
            ) : null}
            {writable ? (
              <span className="ext-badge">
                {t("settings.privacy.writable")}
              </span>
            ) : (
              <span className="ext-badge">
                {t("settings.privacy.readOnly")}
              </span>
            )}
          </div>

          <div className="settings-config-edit__fields">
            <PrivacyRow
              id="settings-anchor-privacy-telemetry"
              labelKey="settings.privacy.telemetry"
              descKey="settings.privacy.telemetryDesc"
              configKey="[features] telemetry · GROK_TELEMETRY_ENABLED"
              valueKey="telemetry"
              value={draft.telemetry}
              disabled={disabled}
              onToggle={(next) => setKey("telemetry", next)}
              t={t}
            />
            <PrivacyRow
              id="settings-anchor-privacy-traceUpload"
              labelKey="settings.privacy.traceUpload"
              descKey="settings.privacy.traceUploadDesc"
              configKey="[telemetry] trace_upload · GROK_TELEMETRY_TRACE_UPLOAD"
              valueKey="traceUpload"
              value={draft.traceUpload}
              disabled={disabled}
              onToggle={(next) => setKey("traceUpload", next)}
              t={t}
            />
            <PrivacyRow
              id="settings-anchor-privacy-mixpanel"
              labelKey="settings.privacy.mixpanel"
              descKey="settings.privacy.mixpanelDesc"
              configKey="[telemetry] mixpanel_enabled · GROK_TELEMETRY_MIXPANEL_ENABLED"
              valueKey="mixpanelEnabled"
              value={draft.mixpanelEnabled}
              disabled={disabled}
              onToggle={(next) => setKey("mixpanelEnabled", next)}
              t={t}
            />
            <PrivacyRow
              id="settings-anchor-privacy-codebaseUpload"
              labelKey="settings.privacy.disableCodebaseUpload"
              descKey="settings.privacy.disableCodebaseUploadDesc"
              configKey="[harness] disable_codebase_upload"
              valueKey="disableCodebaseUpload"
              value={draft.disableCodebaseUpload}
              disabled={disabled}
              onToggle={(next) => setKey("disableCodebaseUpload", next)}
              t={t}
            />
            <PrivacyRow
              id="settings-anchor-privacy-workspaceTeleport"
              labelKey="settings.privacy.disableWorkspaceTeleport"
              descKey="settings.privacy.disableWorkspaceTeleportDesc"
              configKey="[harness] disable_workspace_teleport"
              valueKey="disableWorkspaceTeleport"
              value={draft.disableWorkspaceTeleport}
              disabled={disabled}
              onToggle={(next) => setKey("disableWorkspaceTeleport", next)}
              t={t}
            />
          </div>

          <div
            className="settings-row settings-row--stack"
            id="settings-anchor-privacy-codingData"
            style={{ marginTop: 12 }}
          >
            <div className="settings-row__text">
              <div className="settings-row__label">
                {t("settings.privacy.codingData")}
              </div>
              <div className="settings-row__desc">
                {t("settings.privacy.codingDataDesc")}
              </div>
              <div className="settings-row__hint">
                {t("settings.privacy.codingDataHint", {
                  cmd: snap.cliPrivacyCommand || CLI_PRIVACY_COMMAND,
                })}
              </div>
            </div>
            <div
              className="settings-row__actions"
            >
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void copyPrivacyCmd()}
              >
                {copied
                  ? t("settings.privacy.codingDataCopied")
                  : t("settings.privacy.codingDataCopy", {
                      cmd: snap.cliPrivacyCommand || CLI_PRIVACY_COMMAND,
                    })}
              </button>
            </div>
          </div>

          {snap.redactedPreview?.trim() ? (
            <div className="settings-config-edit__preview">
              <div className="settings-row__label">
                {t("settings.privacy.preview")}
              </div>
              <p className="ext-field-hint" style={{ marginTop: 4 }}>
                {t("settings.privacy.redactNote")}
              </p>
              <pre className="settings-config-edit__pre" tabIndex={0}>
                {snap.redactedPreview}
              </pre>
            </div>
          ) : (
            <p className="ext-field-hint">{t("settings.privacy.previewEmpty")}</p>
          )}

          {writable ? (
            <p className="ext-field-hint" style={{ marginTop: 8 }}>
              {t("settings.privacy.apply.softRespawn")}
            </p>
          ) : (
            <p className="ext-field-hint" style={{ marginTop: 8 }}>
              {t("settings.privacy.apply.independentOnly")}
            </p>
          )}

          <div
            className="settings-row__actions"
          >
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy || loading}
              onClick={() => void load()}
            >
              <IconRefresh size={14} />
              <span>{t("settings.privacy.refresh")}</span>
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!dirty || busy || loading}
              onClick={reset}
            >
              {t("settings.privacy.reset")}
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={!dirty || !writable || busy || loading}
              onClick={() => void save()}
            >
              {busy
                ? t("settings.privacy.saving")
                : t("settings.privacy.save")}
            </button>
          </div>
        </>
      ) : null}

      {/* External OTEL: always visible (env template + dual opt-in honesty). */}
      <div
        className={
          "settings-row settings-row--stack settings-privacy__external-otel " +
          externalOtelToneClass(externalOtel.tone)
        }
        id="settings-anchor-privacy-externalOtel"
        style={{ marginTop: 16 }}
      >
        <div className="settings-row__text">
          <div className="settings-row__label">
            {t("settings.privacy.externalOtel")}
          </div>
          <div className="settings-row__desc">
            {t("settings.privacy.externalOtelDesc")}
          </div>
        </div>

        <div
          className={
            "settings-config-edit__badges settings-privacy__probe " +
            externalOtelToneClass(externalOtel.tone)
          }
          role="status"
        >
          <span
            className={
              "ext-badge" +
              (externalOtel.tone === "warn"
                ? " ext-badge--danger"
                : externalOtel.tone === "muted" ||
                    externalOtel.tone === "info"
                  ? " ext-badge--muted"
                  : "")
            }
          >
            {t(
              externalOtelStatusMessageKey(externalOtel.status) as MessageKey,
            )}
          </span>
          <span className="ext-badge ext-badge--muted">
            {t("settings.privacy.externalOtel.dualOptIn")}
          </span>
        </div>

        {externalOtel.status === "unknown" ? (
          <div className="ext-alert ext-alert--info" role="status">
            <p className="ext-alert__body" style={{ margin: 0 }}>
              {t("settings.privacy.externalOtel.unknownNotOff")}
            </p>
          </div>
        ) : null}

        {externalOtel.status === "incomplete" ? (
          <div className="ext-alert ext-alert--warn" role="status">
            <p className="ext-alert__body" style={{ margin: 0 }}>
              {t("settings.privacy.externalOtel.incompleteHint")}
            </p>
          </div>
        ) : null}

        <div className="settings-privacy__otel-checklist" role="list">
          {externalOtel.checklist.map((step) => {
            const mark =
              step.done === true ? "✓" : step.done === false ? "✗" : "·";
            const markLabel =
              step.done === true
                ? t("settings.privacy.externalOtel.step.done")
                : step.done === false
                  ? t("settings.privacy.externalOtel.step.missing")
                  : t("settings.privacy.externalOtel.step.unknown");
            return (
              <div
                key={step.id}
                className="settings-row__hint"
                role="listitem"
                title={markLabel}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                }}
              >
                <span aria-hidden style={{ minWidth: "1em" }}>
                  {mark}
                </span>
                <span>{t(step.messageKey as MessageKey)}</span>
              </div>
            );
          })}
        </div>

        <p className="ext-field-hint" style={{ marginTop: 8 }}>
          {t("settings.privacy.externalOtel.contentFree")}
        </p>
        <p className="ext-field-hint">
          {t("settings.privacy.externalOtel.noSecrets")}
        </p>
        {snap && !writable ? (
          <p className="ext-field-hint">
            {t(externalOtelSharedModeNoteKey() as MessageKey)}
          </p>
        ) : null}

        <div
          className="settings-row__actions"
        >
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void copyOtelEnv()}
          >
            {otelCopied
              ? t("settings.privacy.externalOtel.copied")
              : t("settings.privacy.externalOtel.copyEnv")}
          </button>
        </div>

        <pre
          className="settings-config-edit__pre"
          tabIndex={0}
          style={{ marginTop: 8, maxHeight: 220, overflow: "auto" }}
        >
          {formatExternalOtelEnvHints()}
        </pre>
      </div>
    </div>
  );
}
