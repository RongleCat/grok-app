/**
 * Structured Doctor health UI — checks with ok/warn/fail, re-run, copy,
 * support zip, reset app data, and Grok Build CLI `doctor --json` section.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconClose,
  IconCopy,
  IconDoctor,
  IconRefresh,
} from "@/components/icons";
import { createT, type Locale, type MessageKey } from "@/i18n";
import * as api from "@/lib/api";
import type { DoctorCheck, DoctorLevel, DoctorReport } from "@/lib/api";
import {
  CLI_DOCTOR_FACT_KEYS,
  formatFactValue,
  hasAnySafeFact,
  parseCliDoctorEnvelope,
  type CliDoctorSafeFacts,
  type CliDoctorView,
} from "@/lib/cliDoctor";
import { redact } from "@/lib/redact";

export type DoctorModalProps = {
  open: boolean;
  onClose: () => void;
  locale: Locale;
  /**
   * App-level confirm dialog (no window.confirm).
   * Used for the two-step reset flow.
   */
  onConfirm?: (opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  }) => void;
  /** After a successful reset — reload lists / hard refresh. */
  onResetDone?: () => void;
};

const CHECK_TITLE_KEYS: Record<string, MessageKey> = {
  cli: "doctor.check.cli",
  auth: "doctor.check.auth",
  workspace: "doctor.check.workspace",
  backend: "doctor.check.backend",
  logs: "doctor.check.logs",
};

function levelLabelKey(level: DoctorLevel): MessageKey {
  if (level === "warn") return "doctor.level.warn";
  if (level === "fail") return "doctor.level.fail";
  return "doctor.level.ok";
}

function checkTitle(
  check: DoctorCheck,
  t: ReturnType<typeof createT>,
): string {
  const key = CHECK_TITLE_KEYS[check.id];
  return key ? t(key) : check.title;
}

function formatGeneratedAt(iso: string, locale: Locale): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(locale === "zh" || locale === "zh-TW" ? "zh-CN" : "en-US", {
      dateStyle: "medium",
      timeStyle: "medium",
    });
  } catch {
    return iso;
  }
}

function LevelIcon({ level }: { level: DoctorLevel }) {
  if (level === "fail") {
    return <IconClose size={14} className="doctor-check__icon" />;
  }
  if (level === "warn") {
    return <IconAlertTriangle size={14} className="doctor-check__icon" />;
  }
  return <IconCheck size={14} className="doctor-check__icon" />;
}

const FACT_LABEL_KEYS: Record<
  (typeof CLI_DOCTOR_FACT_KEYS)[number],
  MessageKey
> = {
  terminal: "doctor.cliDoctorFact.terminal",
  clipboard: "doctor.cliDoctorFact.clipboard",
  color: "doctor.cliDoctorFact.color",
  multiplexer: "doctor.cliDoctorFact.multiplexer",
  ssh: "doctor.cliDoctorFact.ssh",
  voice: "doctor.cliDoctorFact.voice",
};

function factEntries(
  facts: CliDoctorSafeFacts,
): Array<{ key: (typeof CLI_DOCTOR_FACT_KEYS)[number]; value: string }> {
  const out: Array<{
    key: (typeof CLI_DOCTOR_FACT_KEYS)[number];
    value: string;
  }> = [];
  for (const key of CLI_DOCTOR_FACT_KEYS) {
    const raw = facts[key];
    if (raw === undefined || raw === null || raw === "") continue;
    out.push({ key, value: formatFactValue(key, raw) });
  }
  return out;
}

export function DoctorModal({
  open,
  onClose,
  locale,
  onConfirm,
  onResetDone,
}: DoctorModalProps) {
  const t = useMemo(() => createT(locale), [locale]);
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"zip" | "reset" | null>(null);
  const [keepSecrets, setKeepSecrets] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    setStatusMsg(null);
    try {
      const next = await api.doctorReport();
      setReport(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void run();
  }, [open, run]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onCopy = async () => {
    if (!report) return;
    const payload = report.raw ?? report;
    const text = redact(JSON.stringify(payload, null, 2));
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError(t("doctor.error"));
    }
  };

  const onSupportZip = async () => {
    setBusy("zip");
    setStatusMsg(null);
    setError(null);
    try {
      const payload = report ? JSON.stringify(report.raw ?? report, null, 2) : null;
      const res = await api.exportSupportBundle(payload);
      setStatusMsg(`${t("doctor.supportZipDone")}: ${res.path}`);
    } catch (e) {
      setError(`${t("doctor.supportZipFail")}: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const doReset = async () => {
    setBusy("reset");
    setError(null);
    try {
      await api.resetAppData(keepSecrets);
      setStatusMsg(t("doctor.resetDone"));
      onResetDone?.();
      // Hard reload so in-memory session/project state is dropped.
      window.setTimeout(() => {
        window.location.reload();
      }, 600);
    } catch (e) {
      setError(`${t("doctor.resetFail")}: ${String(e)}`);
      setBusy(null);
    }
  };

  const onResetClick = () => {
    const start = () => {
      if (onConfirm) {
        onConfirm({
          title: t("doctor.resetConfirmTitle"),
          message: t("doctor.resetConfirmBody"),
          confirmLabel: t("doctor.reset"),
          danger: true,
          onConfirm: () => {
            onConfirm({
              title: t("doctor.resetConfirm2Title"),
              message: t("doctor.resetConfirm2Body"),
              confirmLabel: t("common.confirm"),
              danger: true,
              onConfirm: () => {
                void doReset();
              },
            });
          },
        });
      } else {
        // Fallback for isolated stories — still no window.confirm.
        void doReset();
      }
    };
    start();
  };

  const cliDoctor: CliDoctorView | null = useMemo(() => {
    if (!report) return null;
    return parseCliDoctorEnvelope(report.cliDoctor ?? null);
  }, [report]);

  if (!open) return null;

  const summary = report?.summary;
  const checks = report?.checks ?? [];
  const cliFacts = cliDoctor ? factEntries(cliDoctor.facts) : [];

  return (
    <div
      className="overlay doctor-modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal doctor-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="doctor-modal-title"
      >
        <header className="doctor-modal__head">
          <div className="doctor-modal__title-row">
            <IconDoctor size={18} />
            <h2 id="doctor-modal-title">{t("doctor.title")}</h2>
          </div>
          <button
            type="button"
            className="icon-btn modal-close doctor-modal__close"
            onClick={onClose}
            aria-label={t("doctor.close")}
          >
            <IconClose size={16} />
          </button>
        </header>

        {summary && !loading && (
          <div className="doctor-modal__summary" aria-live="polite">
            <span
              className={`doctor-summary-pill doctor-summary-pill--ok${
                summary.ok ? " is-active" : ""
              }`}
            >
              {summary.ok} {t("doctor.level.ok")}
            </span>
            <span
              className={`doctor-summary-pill doctor-summary-pill--warn${
                summary.warn ? " is-active" : ""
              }`}
            >
              {summary.warn} {t("doctor.level.warn")}
            </span>
            <span
              className={`doctor-summary-pill doctor-summary-pill--fail${
                summary.fail ? " is-active" : ""
              }`}
            >
              {summary.fail} {t("doctor.level.fail")}
            </span>
            {report?.generatedAt && (
              <span className="doctor-modal__ts">
                {t("doctor.generatedAt", {
                  time: formatGeneratedAt(report.generatedAt, locale),
                })}
              </span>
            )}
          </div>
        )}

        <div className="doctor-modal__body">
          {loading && (
            <p className="doctor-modal__status">{t("doctor.loading")}</p>
          )}
          {!loading && error && (
            <p className="doctor-modal__status doctor-modal__status--error">
              {t("doctor.error")}: {error}
            </p>
          )}
          {!loading && statusMsg && (
            <p className="doctor-modal__status" role="status">
              {statusMsg}
            </p>
          )}
          {!loading && !error && checks.length === 0 && (
            <p className="doctor-modal__status">{t("doctor.empty")}</p>
          )}
          {!loading && checks.length > 0 && (
            <ul className="doctor-checks">
              {checks.map((c) => (
                <li
                  key={c.id}
                  className={`doctor-check doctor-check--${c.level}`}
                >
                  <div className="doctor-check__badge" aria-hidden>
                    <LevelIcon level={c.level} />
                  </div>
                  <div className="doctor-check__main">
                    <div className="doctor-check__row">
                      <span className="doctor-check__title">
                        {checkTitle(c, t)}
                      </span>
                      <span
                        className={`doctor-check__level doctor-check__level--${c.level}`}
                      >
                        {t(levelLabelKey(c.level))}
                      </span>
                    </div>
                    <p className="doctor-check__detail">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!loading && cliDoctor && (
            <section
              className="doctor-cli-section"
              aria-label={t("doctor.cliDoctor")}
            >
              <div className="doctor-cli-section__head">
                <h3 className="doctor-cli-section__title">
                  {t("doctor.cliDoctor")}
                </h3>
                <p className="doctor-cli-section__hint">
                  {t("doctor.cliDoctorHint")}
                </p>
              </div>

              {!cliDoctor.available && (
                <p className="doctor-modal__status doctor-modal__status--error">
                  {t("doctor.cliDoctorMissing")}
                  {cliDoctor.error ? `: ${cliDoctor.error}` : ""}
                </p>
              )}

              {cliDoctor.available && cliDoctor.checks.length > 0 && (
                <ul className="doctor-checks">
                  {cliDoctor.checks.map((c) => (
                    <li
                      key={c.id}
                      className={`doctor-check doctor-check--${c.level}`}
                    >
                      <div className="doctor-check__badge" aria-hidden>
                        <LevelIcon level={c.level} />
                      </div>
                      <div className="doctor-check__main">
                        <div className="doctor-check__row">
                          <span className="doctor-check__title">
                            {c.id === "cli-doctor-clean"
                              ? t("doctor.cliDoctorEmpty")
                              : c.title}
                          </span>
                          <span
                            className={`doctor-check__level doctor-check__level--${c.level}`}
                          >
                            {t(levelLabelKey(c.level))}
                          </span>
                        </div>
                        {c.detail && c.id !== "cli-doctor-clean" ? (
                          <p className="doctor-check__detail">{c.detail}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {cliDoctor.available &&
                hasAnySafeFact(cliDoctor.facts) &&
                cliFacts.length > 0 && (
                  <details className="doctor-cli-facts">
                    <summary className="doctor-cli-facts__summary">
                      {t("doctor.cliDoctorFacts")}
                    </summary>
                    <dl className="doctor-cli-facts__list">
                      {cliFacts.map(({ key, value }) => (
                        <div key={key} className="doctor-cli-facts__row">
                          <dt>{t(FACT_LABEL_KEYS[key])}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}

              {cliDoctor.available && cliDoctor.probeNotes.length > 0 && (
                <details className="doctor-cli-facts">
                  <summary className="doctor-cli-facts__summary">
                    {t("doctor.cliDoctorProbeNotes", {
                      count: cliDoctor.probeNotes.length,
                    })}
                  </summary>
                  <ul className="doctor-cli-probes">
                    {cliDoctor.probeNotes.map((n) => (
                      <li key={n.probe} className="doctor-cli-probes__item">
                        <span className="doctor-cli-probes__name">{n.probe}</span>
                        <span className="doctor-cli-probes__status">
                          {n.status}
                        </span>
                        {n.message ? (
                          <span className="doctor-cli-probes__msg">
                            {n.message}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}

          <section className="doctor-advanced" aria-label={t("doctor.advanced")}>
            <h3 className="doctor-advanced__title">{t("doctor.advanced")}</h3>
            <div className="doctor-advanced__row">
              <div className="doctor-advanced__text">
                <div className="doctor-advanced__label">{t("doctor.supportZip")}</div>
                <p className="doctor-advanced__hint">{t("doctor.supportZipHint")}</p>
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!!busy || loading}
                onClick={() => void onSupportZip()}
              >
                {busy === "zip" ? "…" : t("doctor.supportZip")}
              </button>
            </div>
            <div className="doctor-advanced__row doctor-advanced__row--danger">
              <div className="doctor-advanced__text">
                <div className="doctor-advanced__label">{t("doctor.reset")}</div>
                <p className="doctor-advanced__hint">{t("doctor.resetHint")}</p>
                <label className="doctor-advanced__check">
                  <input
                    type="checkbox"
                    checked={keepSecrets}
                    onChange={(e) => setKeepSecrets(e.target.checked)}
                    disabled={!!busy}
                  />
                  <span>{t("doctor.resetKeepSecrets")}</span>
                </label>
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--sm doctor-advanced__danger-btn"
                disabled={!!busy || loading}
                onClick={onResetClick}
              >
                {busy === "reset" ? "…" : t("doctor.reset")}
              </button>
            </div>
          </section>
        </div>

        <footer className="doctor-modal__foot">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void run()}
            disabled={loading || !!busy}
          >
            <IconRefresh size={14} />
            {t("doctor.rerun")}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void onCopy()}
            disabled={!report || loading || !!busy}
          >
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            {copied ? t("doctor.copied") : t("doctor.copy")}
          </button>
          <span className="doctor-modal__foot-spacer" />
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onClose}
            disabled={!!busy}
          >
            {t("doctor.close")}
          </button>
        </footer>
      </div>
    </div>
  );
}
