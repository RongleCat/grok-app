/**
 * Reliability / Observability center — aggregate long-task signals:
 * busy sessions, stall / end-of-turn stalls, recent error-deck cards.
 * Actions: export support bundle, open Doctor. No secrets from logs.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconActivity,
  IconAlertTriangle,
  IconClose,
  IconDoctor,
} from "@/components/icons";
import { createT, type Locale, type MessageKey } from "@/i18n";
import * as api from "@/lib/api";
import type {
  ReliabilityBusySession,
  ReliabilityCenterView,
  ReliabilityErrorEntry,
  ReliabilityStallSignal,
} from "@/lib/reliabilityCenter";

export type ReliabilityCenterModalProps = {
  open: boolean;
  onClose: () => void;
  locale: Locale;
  view: ReliabilityCenterView;
  onOpenDoctor: () => void;
  /** Jump to a busy session (optional). */
  onSelectSession?: (sessionId: string) => void;
};

function formatWhen(ms: number, locale: Locale): string {
  try {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(
      locale === "zh" || locale === "zh-TW" ? "zh-CN" : "en-US",
      { dateStyle: "short", timeStyle: "medium" },
    );
  } catch {
    return "";
  }
}

function busyStatusKey(status: ReliabilityBusySession["status"]): MessageKey {
  switch (status) {
    case "streaming":
      return "tasks.activity.streaming";
    case "awaiting_permission":
      return "tasks.activity.permission";
    case "connecting":
      return "tasks.activity.connecting";
    default:
      return "tasks.activity.other";
  }
}

function stallKindKey(kind: ReliabilityStallSignal["kind"]): MessageKey {
  switch (kind) {
    case "active":
      return "reliability.stall.kind.active";
    case "hard_end":
      return "reliability.stall.kind.hardEnd";
    case "terminal":
      return "reliability.stall.kind.terminal";
    case "end_of_turn":
      return "reliability.stall.kind.endOfTurn";
    default:
      return "reliability.stall.kind.terminal";
  }
}

function BusyRow({
  row,
  t,
  onSelect,
}: {
  row: ReliabilityBusySession;
  t: ReturnType<typeof createT>;
  onSelect?: (sessionId: string) => void;
}) {
  return (
    <li className="reliab-card__row">
      <div className="reliab-card__row-main">
        <span
          className={
            "reliab-card__dot" +
            (row.status === "awaiting_permission"
              ? " reliab-card__dot--warn"
              : " reliab-card__dot--busy")
          }
          aria-hidden
        />
        <span className="reliab-card__name" title={row.title}>
          {row.title}
          {row.isCurrent ? (
            <span className="reliab-card__tag">
              {" "}
              {t("tasks.activity.current")}
            </span>
          ) : null}
        </span>
        <span className="reliab-card__meta">{t(busyStatusKey(row.status))}</span>
      </div>
      {row.liveToolTitle ? (
        <div className="reliab-card__sub" title={row.liveToolTitle}>
          {row.liveToolTitle}
        </div>
      ) : null}
      {!row.isCurrent && onSelect ? (
        <div className="reliab-card__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onSelect(row.sessionId)}
          >
            {t("tasks.activity.open")}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function StallRow({
  signal,
  t,
  locale,
}: {
  signal: ReliabilityStallSignal;
  t: ReturnType<typeof createT>;
  locale: Locale;
}) {
  const when = formatWhen(signal.at, locale);
  const secs =
    signal.stallSeconds != null
      ? t("reliability.stall.seconds", {
          seconds: String(signal.stallSeconds),
        })
      : null;
  return (
    <li className="reliab-card__row">
      <div className="reliab-card__row-main">
        <span className="reliab-card__dot reliab-card__dot--warn" aria-hidden />
        <span className="reliab-card__name" title={signal.title ?? undefined}>
          {signal.title || t("reliability.stall.unknownSession")}
        </span>
        <span className="reliab-card__meta">{t(stallKindKey(signal.kind))}</span>
      </div>
      <div className="reliab-card__sub">
        {[secs, signal.tier, when].filter(Boolean).join(" · ")}
      </div>
    </li>
  );
}

function ErrorRow({
  entry,
  locale,
}: {
  entry: ReliabilityErrorEntry;
  locale: Locale;
}) {
  const when = formatWhen(entry.at, locale);
  return (
    <li className="reliab-card__row">
      <div className="reliab-card__row-main">
        <span className="reliab-card__dot reliab-card__dot--err" aria-hidden />
        <span className="reliab-card__name" title={entry.problem}>
          {entry.problem}
        </span>
        {entry.code ? (
          <span className="reliab-card__meta reliab-card__code">{entry.code}</span>
        ) : null}
      </div>
      {entry.cause ? (
        <div className="reliab-card__sub" title={entry.cause}>
          {entry.cause}
        </div>
      ) : null}
      <div className="reliab-card__sub reliab-card__sub--muted">
        {[entry.title, when].filter(Boolean).join(" · ")}
      </div>
    </li>
  );
}

export function ReliabilityCenterModal({
  open,
  onClose,
  locale,
  view,
  onOpenDoctor,
  onSelectSession,
}: ReliabilityCenterModalProps) {
  const t = useMemo(() => createT(locale), [locale]);
  const [busy, setBusy] = useState<"zip" | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatusMsg(null);
    setErrorMsg(null);
    setBusy(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const onSupportZip = useCallback(async () => {
    setBusy("zip");
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await api.exportSupportBundle(null);
      setStatusMsg(`${t("doctor.supportZipDone")}: ${res.path}`);
    } catch (e) {
      setErrorMsg(`${t("doctor.supportZipFail")}: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }, [t]);

  const openDoctor = () => {
    onClose();
    onOpenDoctor();
  };

  if (!open) return null;

  return (
    <div
      className="overlay doctor-modal-overlay reliab-modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal doctor-modal reliab-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reliab-modal-title"
      >
        <header className="doctor-modal__head">
          <div className="doctor-modal__title-row">
            <IconActivity size={18} />
            <h2 id="reliab-modal-title">{t("reliability.title")}</h2>
          </div>
          <button
            type="button"
            className="icon-btn modal-close doctor-modal__close"
            onClick={onClose}
            aria-label={t("reliability.close")}
          >
            <IconClose size={16} />
          </button>
        </header>

        <p className="reliab-modal__lead">{t("reliability.lead")}</p>

        {(statusMsg || errorMsg) && (
          <div className="doctor-modal__summary" aria-live="polite">
            {statusMsg ? (
              <p className="doctor-modal__status" role="status">
                {statusMsg}
              </p>
            ) : null}
            {errorMsg ? (
              <p className="doctor-modal__status doctor-modal__status--error">
                {errorMsg}
              </p>
            ) : null}
          </div>
        )}

        <div className="doctor-modal__body reliab-modal__body">
          {view.empty ? (
            <div className="reliab-empty" role="status">
              <IconAlertTriangle size={20} className="reliab-empty__icon" />
              <p className="reliab-empty__title">{t("reliability.empty.title")}</p>
              <p className="reliab-empty__body">{t("reliability.empty.body")}</p>
            </div>
          ) : null}

          <section className="reliab-card" aria-labelledby="reliab-busy-title">
            <header className="reliab-card__head">
              <h3 id="reliab-busy-title" className="reliab-card__title">
                {t("reliability.busy.title")}
              </h3>
              <span className="reliab-card__count">
                {t("reliability.busy.count", { count: view.busy.count })}
              </span>
            </header>
            {view.hasBusy ? (
              <ul className="reliab-card__list">
                {view.busy.sessions.map((row) => (
                  <BusyRow
                    key={row.sessionId}
                    row={row}
                    t={t}
                    onSelect={onSelectSession}
                  />
                ))}
              </ul>
            ) : (
              <p className="reliab-card__empty">{t("reliability.busy.empty")}</p>
            )}
          </section>

          <section className="reliab-card" aria-labelledby="reliab-stall-title">
            <header className="reliab-card__head">
              <h3 id="reliab-stall-title" className="reliab-card__title">
                {t("reliability.stalls.title")}
              </h3>
              <span className="reliab-card__count">
                {t("reliability.stalls.count", { count: view.stalls.count })}
              </span>
            </header>
            {view.hasStalls ? (
              <ul className="reliab-card__list">
                {view.stalls.signals.map((s) => (
                  <StallRow key={s.id} signal={s} t={t} locale={locale} />
                ))}
              </ul>
            ) : (
              <p className="reliab-card__empty">{t("reliability.stalls.empty")}</p>
            )}
          </section>

          <section className="reliab-card" aria-labelledby="reliab-err-title">
            <header className="reliab-card__head">
              <h3 id="reliab-err-title" className="reliab-card__title">
                {t("reliability.errors.title")}
              </h3>
              <span className="reliab-card__count">
                {t("reliability.errors.count", { count: view.errors.count })}
              </span>
            </header>
            {view.hasErrors ? (
              <ul className="reliab-card__list">
                {view.errors.entries.map((e) => (
                  <ErrorRow key={e.id} entry={e} locale={locale} />
                ))}
              </ul>
            ) : (
              <p className="reliab-card__empty">{t("reliability.errors.empty")}</p>
            )}
          </section>
        </div>

        <footer className="doctor-modal__foot reliab-modal__foot">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!!busy}
            onClick={() => void onSupportZip()}
            title={t("doctor.supportZipHint")}
          >
            {busy === "zip" ? "…" : t("doctor.supportZip")}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={openDoctor}
          >
            <IconDoctor size={14} />
            {t("reliability.openDoctor")}
          </button>
          <span className="doctor-modal__foot-spacer" />
          <button
            type="button"
            className="btn btn--solid btn--sm"
            onClick={onClose}
          >
            {t("common.close")}
          </button>
        </footer>
      </div>
    </div>
  );
}
