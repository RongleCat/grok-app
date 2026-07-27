/**
 * Phone mirror connect UI — QR + public URL + start/stop host.
 * - `modal`: legacy GlassModal (optional; settings uses inline).
 * - `inline`: settings card body (Remote control → Phone mirror tab).
 * Closing the UI does NOT stop the host — only 停止主机 does.
 */

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { GlassModal } from "@/components/GlassModal";
import { IconCopy, IconDeviceMobile } from "@/components/icons";
import type { MirrorPhase, MirrorStatus } from "@/lib/api";
import * as api from "@/lib/api";

export type MirrorConnectLabels = {
  title: string;
  close: string;
  start: string;
  stop: string;
  stopConfirmTitle: string;
  stopConfirmMessage: string;
  stopConfirmOk: string;
  cancel: string;
  copyLink: string;
  copied: string;
  clients: string;
  phaseStopped: string;
  phaseStarting: string;
  phaseLocal: string;
  phaseWaitingTunnel: string;
  phaseLive: string;
  phaseTunnelDead: string;
  phaseError: string;
  hint: string;
  warningToken: string;
  missingCloudflared: string;
  errorGeneric: string;
  qrAlt: string;
  linkLabel: string;
  rotate: string;
  rotateDone: string;
  allowWrite: string;
  readOnlyOn: string;
  readOnlyHint: string;
};


export type MirrorConnectPanelProps = {
  /**
   * `modal` — GlassModal dialog.
   * `inline` — embed in settings (no modal chrome).
   */
  variant?: "modal" | "inline";
  /**
   * Modal: panel open. Inline: when true (default), poll + auto-start while mounted.
   * Set false to pause without unmounting.
   */
  open?: boolean;
  onClose?: () => void;
  labels: MirrorConnectLabels;
  /** In-app confirm for stop (no window.confirm). */
  onConfirmStop: (opts: {
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  }) => void;
  showToast: (msg: string, ms?: number) => void;
  /**
   * Inline only: auto-start host when the panel becomes active (default true).
   * Modal always auto-starts on open.
   */
  autoStart?: boolean;
};

function phaseLabel(phase: MirrorPhase, labels: MirrorConnectLabels): string {
  switch (phase) {
    case "stopped":
      return labels.phaseStopped;
    case "starting":
      return labels.phaseStarting;
    case "local":
      return labels.phaseLocal;
    case "waiting_tunnel":
      return labels.phaseWaitingTunnel;
    case "live":
      return labels.phaseLive;
    case "tunnel_dead":
      return labels.phaseTunnelDead;
    case "error":
      return labels.phaseError;
    default:
      return phase;
  }
}

function emptyStatus(): MirrorStatus {
  return {
    running: false,
    publicUrl: null,
    localPort: null,
    token: null,
    tokenTail: null,
    clients: 0,
    phase: "stopped",
    error: null,
    readOnly: true,
  };
}

function MirrorConnectBody({
  labels,
  status,
  busy,
  err,
  qrDataUrl,
  onCopy,
  onStart,
  onStop,
  onRotate,
  onToggleReadOnly,
}: {
  labels: MirrorConnectLabels;
  status: MirrorStatus;
  busy: boolean;
  err: string | null;
  qrDataUrl: string | null;
  onCopy: () => void;
  onStart: () => void;
  onStop: () => void;
  onRotate: () => void;
  onToggleReadOnly: () => void;
}) {
  const phase = status.phase;
  const showQr = !!status.publicUrl && (phase === "live" || phase === "local");

  return (
    <>
      <p className="mirror-connect__hint">{labels.hint}</p>

      <div
        className={
          "mirror-connect__phase" +
          (phase === "live" || phase === "local"
            ? " mirror-connect__phase--ok"
            : phase === "error" || phase === "tunnel_dead"
              ? " mirror-connect__phase--err"
              : "")
        }
        role="status"
      >
        <span className="mirror-connect__phase-dot" aria-hidden />
        {phaseLabel(phase, labels)}
        {status.running && status.clients > 0 ? (
          <span className="mirror-connect__clients">
            · {labels.clients.replace("{n}", String(status.clients))}
          </span>
        ) : null}
      </div>

      {(err || status.error) && (
        <div className="mirror-connect__error" role="alert">
          {(err || status.error || "").includes("cloudflared")
            ? labels.missingCloudflared
            : err || status.error}
        </div>
      )}

      {showQr && qrDataUrl ? (
        <div className="mirror-connect__qr-wrap">
          <img
            className="mirror-connect__qr"
            src={qrDataUrl}
            width={220}
            height={220}
            alt={labels.qrAlt}
          />
        </div>
      ) : (
        <div className="mirror-connect__qr-placeholder" aria-hidden>
          {busy || phase === "starting" || phase === "waiting_tunnel"
            ? "…"
            : null}
        </div>
      )}

      {status.publicUrl ? (
        <div className="mirror-connect__link-row">
          <label className="mirror-connect__link-label">{labels.linkLabel}</label>
          <div className="mirror-connect__link-box">
            <code className="mirror-connect__url" title={status.publicUrl}>
              {status.publicUrl}
            </code>
            <button
              type="button"
              className="btn btn--ghost mirror-connect__copy"
              onClick={() => void onCopy()}
              title={labels.copyLink}
            >
              <IconCopy size={16} />
              {labels.copyLink}
            </button>
          </div>
          <p className="mirror-connect__warn">{labels.warningToken}</p>
        </div>
      ) : null}

      <div className="mirror-connect__footer">
        {status.running ? (
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={onStop}
          >
            {labels.stop}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={onStart}
          >
            {labels.start}
          </button>
        )}
        {status.running ? (
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={onRotate}
            >
              {labels.rotate}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={onToggleReadOnly}
            >
              {status.readOnly ? labels.allowWrite : labels.readOnlyOn}
            </button>
          </>
        ) : null}
      </div>
      {status.running && status.readOnly ? (
        <p className="mirror-connect__hint">{labels.readOnlyHint}</p>
      ) : null}
    </>
  );
}

export function MirrorConnectPanel({
  variant = "modal",
  open = true,
  onClose,
  labels,
  onConfirmStop,
  showToast,
  autoStart = true,
}: MirrorConnectPanelProps) {
  const [status, setStatus] = useState<MirrorStatus>(emptyStatus);
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const active = variant === "inline" ? open !== false : !!open;

  const refresh = useCallback(async () => {
    try {
      const st = await api.mirrorStatus();
      setStatus(st);
      setErr(st.error);
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  // When active: optionally auto-start, then poll status.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setBusy(true);
    setErr(null);
    void (async () => {
      try {
        if (autoStart) {
          const st = await api.mirrorStart();
          if (cancelled) return;
          setStatus(st);
          setErr(st.error);
        } else {
          await refresh();
        }
      } catch (e) {
        if (!cancelled) {
          setErr(String(e));
          await refresh();
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    const id = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active, autoStart, refresh]);

  // Render QR whenever public URL is available.
  useEffect(() => {
    const url = status.publicUrl;
    if (!url) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(url, {
      width: 220,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#111111", light: "#ffffff" },
    })
      .then((data) => {
        if (!cancelled) setQrDataUrl(data);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [status.publicUrl]);

  
  const handleRotate = () => {
    void (async () => {
      try {
        const st = await api.mirrorRotateToken();
        setStatus(st);
        showToast?.(labels.rotateDone);
      } catch (e) {
        setErr(String(e));
      }
    })();
  };

  const handleToggleReadOnly = () => {
    void (async () => {
      try {
        const st = await api.mirrorSetReadOnly(!status.readOnly);
        setStatus(st);
      } catch (e) {
        setErr(String(e));
      }
    })();
  };

const handleCopy = async () => {
    const url = status.publicUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast(labels.copied, 1800);
    } catch {
      showToast(labels.errorGeneric, 3000);
    }
  };

  const handleStart = () => {
    setBusy(true);
    void api
      .mirrorStart()
      .then((st) => {
        setStatus(st);
        setErr(st.error);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  };

  const handleStop = () => {
    onConfirmStop({
      title: labels.stopConfirmTitle,
      message: labels.stopConfirmMessage,
      confirmLabel: labels.stopConfirmOk,
      onConfirm: () => {
        setBusy(true);
        void api
          .mirrorStop()
          .then((st) => {
            setStatus(st);
            setErr(null);
            showToast(labels.phaseStopped, 2000);
          })
          .catch((e) => setErr(String(e)))
          .finally(() => setBusy(false));
      },
    });
  };

  const body = (
    <MirrorConnectBody
      labels={labels}
      status={status}
      busy={busy}
      err={err}
      qrDataUrl={qrDataUrl}
      onCopy={() => void handleCopy()}
      onStart={handleStart}
      onStop={handleStop}
      onRotate={handleRotate}
      onToggleReadOnly={handleToggleReadOnly}
    />
  );

  if (variant === "inline") {
    if (!active) return null;
    // No second page title — settings shell already has h1 + tab strip.
    return <div className="mirror-connect mirror-connect--inline">{body}</div>;
  }

  return (
    <GlassModal
      open={!!open}
      onClose={onClose ?? (() => {})}
      title={
        <span className="mirror-connect__title">
          <IconDeviceMobile size={18} />
          {labels.title}
        </span>
      }
      size="md"
      closeLabel={labels.close}
      wrapBody
      bodyClassName="mirror-connect"
      footer={
        <div className="mirror-connect__footer">
          {status.running ? (
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy}
              onClick={handleStop}
            >
              {labels.stop}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={handleStart}
            >
              {labels.start}
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
          >
            {labels.close}
          </button>
        </div>
      }
    >
      {/* Footer owns actions in modal; body omits duplicate footer via split — reuse hint block only */}
      <p className="mirror-connect__hint">{labels.hint}</p>

      <div
        className={
          "mirror-connect__phase" +
          (status.phase === "live" || status.phase === "local"
            ? " mirror-connect__phase--ok"
            : status.phase === "error" || status.phase === "tunnel_dead"
              ? " mirror-connect__phase--err"
              : "")
        }
        role="status"
      >
        <span className="mirror-connect__phase-dot" aria-hidden />
        {phaseLabel(status.phase, labels)}
        {status.running && status.clients > 0 ? (
          <span className="mirror-connect__clients">
            · {labels.clients.replace("{n}", String(status.clients))}
          </span>
        ) : null}
      </div>

      {(err || status.error) && (
        <div className="mirror-connect__error" role="alert">
          {(err || status.error || "").includes("cloudflared")
            ? labels.missingCloudflared
            : err || status.error}
        </div>
      )}

      {!!status.publicUrl &&
      (status.phase === "live" || status.phase === "local") &&
      qrDataUrl ? (
        <div className="mirror-connect__qr-wrap">
          <img
            className="mirror-connect__qr"
            src={qrDataUrl}
            width={220}
            height={220}
            alt={labels.qrAlt}
          />
        </div>
      ) : (
        <div className="mirror-connect__qr-placeholder" aria-hidden>
          {busy ||
          status.phase === "starting" ||
          status.phase === "waiting_tunnel"
            ? "…"
            : null}
        </div>
      )}

      {status.publicUrl ? (
        <div className="mirror-connect__link-row">
          <label className="mirror-connect__link-label">{labels.linkLabel}</label>
          <div className="mirror-connect__link-box">
            <code className="mirror-connect__url" title={status.publicUrl}>
              {status.publicUrl}
            </code>
            <button
              type="button"
              className="btn btn--ghost mirror-connect__copy"
              onClick={() => void handleCopy()}
              title={labels.copyLink}
            >
              <IconCopy size={16} />
              {labels.copyLink}
            </button>
          </div>
          <p className="mirror-connect__warn">{labels.warningToken}</p>
        </div>
      ) : null}
    </GlassModal>
  );
}
