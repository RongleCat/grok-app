/**
 * Phone mirror connect UI — QR + public URL + start/stop host.
 * - `modal`: legacy GlassModal (optional; settings uses inline).
 * - `inline`: settings card body (Remote control → Phone mirror tab).
 * Closing the UI does NOT stop the host — only 停止主机 does.
 *
 * Write-ACL audit (localStorage ring) records write enable/disable,
 * token rotate, and optional host start/stop — never stores secrets.
 *
 * Harden: write categories + broad warning, max clients, rotate confirm.
 * MIRROR-PRO: honest status pill, soft-fail tunnel diagnostics, error chips.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { GlassModal } from "@/components/GlassModal";
import { IconCopy, IconDeviceMobile } from "@/components/icons";
import type { MirrorStatus } from "@/lib/api";
import * as api from "@/lib/api";
import { formatListTimestamp } from "@/lib/formatDateTime";
import {
  clampMirrorMaxClients,
  formatMirrorClientCapLine,
  mirrorClientCapToneClass,
  resolveMirrorCapEmptyState,
  resolveMirrorClientCapState,
  type MirrorCapEmptyState,
  type MirrorClientCapKind,
  type MirrorClientCapState,
} from "@/lib/mirrorClientCapPro";
import {
  deriveMirrorHostStatus,
  isLoopbackMirrorUrl,
  mirrorCopyUrl,
  mirrorDiagnosticDisplay,
  mirrorHostPhaseClass,
  mirrorHostPhaseLabelField,
  shouldShowMirrorQr,
  type MirrorErrorKind,
  type MirrorHostConnectStatus,
} from "@/lib/mirrorStatus";
import {
  MIRROR_WRITE_AUDIT_CHANGE_EVENT,
  MIRROR_WRITE_AUDIT_STORAGE_KEY,
  clearMirrorWriteAudit,
  loadMirrorWriteAudit,
  recordMirrorWriteAudit,
  type MirrorWriteAuditEvent,
  type MirrorWriteAuditType,
} from "@/lib/mirrorWriteAudit";
import {
  MIRROR_DEFAULT_MAX_CLIENTS,
  MIRROR_MAX_CLIENTS_CAP,
  MIRROR_MIN_CLIENTS,
  MIRROR_WRITE_CATEGORIES,
  isBroadMirrorWriteSurface,
  type MirrorWriteCategoryId,
} from "@/lib/mirrorWriteSurface";

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
  /** Soft-fail: local host still up after tunnel failure. */
  phaseSoftLocal: string;
  hint: string;
  warningToken: string;
  missingCloudflared: string;
  errorGeneric: string;
  qrAlt: string;
  linkLabel: string;
  /** Loopback / soft-fail link label (never claim public tunnel). */
  linkLabelLocal: string;
  /** Same-LAN URL when allow-LAN is on. */
  linkLabelLan: string;
  allowLan: string;
  allowLanOn: string;
  allowLanHint: string;
  allowLanConfirmTitle: string;
  allowLanConfirmMessage: string;
  allowLanConfirmOk: string;
  lanHint: string;
  lanHintOn: string;
  lanIpUnknown: string;
  rotate: string;
  rotateDone: string;
  /** Confirm before regenerating the link (invalidates old QR). */
  rotateConfirmTitle: string;
  rotateConfirmMessage: string;
  rotateConfirmMessageClients: string;
  rotateConfirmOk: string;
  allowWrite: string;
  readOnlyOn: string;
  readOnlyHint: string;
  /** Confirm dialog when enabling phone writes. */
  writeConfirmTitle: string;
  writeConfirmMessage: string;
  writeConfirmOk: string;
  /** Persistent banner while phone write is enabled. */
  writeEnabledBanner: string;
  /** Soft-fail banner: tunnel failed but local host still serves. */
  softLocalBanner: string;
  /** Tunnel-dead continuity note (local still up). */
  softTunnelDeadBanner: string;
  /** Write-category section while write is on. */
  writeCategoriesTitle: string;
  writeCategoriesHint: string;
  writeBroadWarn: string;
  writeCategorySend: string;
  writeCategoryStop: string;
  writeCategorySessions: string;
  writeCategoryPermissions: string;
  writeCategoryAskUser: string;
  writeCategoryPlan: string;
  writeCategoryDelete: string;
  writeCategoryRename: string;
  /** Optional concurrent phone client cap. */
  maxClientsLabel: string;
  maxClientsHint: string;
  maxClientsValue: string;
  /** Live cap bar / chips (MIRROR-CLIENT-CAP-PRO). */
  capLine: string;
  capOk: string;
  capNearFull: string;
  capFull: string;
  capWriteOnWarn: string;
  capFullBanner: string;
  capFullHint: string;
  capNearFullHint: string;
  capWriteOnWarnHint: string;
  capOkHint: string;
  capEmptyStopped: string;
  capEmptyStoppedHint: string;
  capEmptyZero: string;
  capEmptyZeroHint: string;
  /** Collapsible local write-ACL audit log. */
  auditTitle: string;
  auditEmpty: string;
  auditClear: string;
  auditClearConfirmTitle: string;
  auditClearConfirmMessage: string;
  auditClearConfirmOk: string;
  auditTypeWriteEnabled: string;
  auditTypeWriteDisabled: string;
  auditTypeTokenRotated: string;
  auditTypeHostStarted: string;
  auditTypeHostStopped: string;
  /** MIRROR-PRO error kind chip labels. */
  errCloudflaredMissing: string;
  errTunnelTimeout: string;
  errTunnelSpawn: string;
  errTunnelNotRegistered: string;
  errTunnelDead: string;
  errPortBind: string;
  errDesktopOnly: string;
  errWsClosed: string;
  errWsTimeout: string;
  errRpcTimeout: string;
  errRpcUnsupported: string;
  errNotConnected: string;
  errClientsFull: string;
  errOther: string;
  /** Actionable hints under the diagnostic. */
  hintCloudflaredMissing: string;
  hintTunnelTimeout: string;
  hintTunnelSpawn: string;
  hintTunnelNotRegistered: string;
  hintTunnelDead: string;
  hintPortBind: string;
  hintDesktopOnly: string;
  hintWsClosed: string;
  hintWsTimeout: string;
  hintRpcTimeout: string;
  hintRpcUnsupported: string;
  hintNotConnected: string;
  hintClientsFull: string;
  hintOther: string;
};

export type MirrorConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
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
  /** App locale, so the audit timestamps follow Settings and not the WebView. */
  locale: string | null;
  /**
   * In-app confirm for stop / enable-write (no window.confirm).
   * Prefer GlassModal / setAppDialog from the parent.
   */
  onRequestConfirm: (opts: MirrorConfirmRequest) => void;
  showToast: (msg: string, ms?: number) => void;
  /**
   * Inline only: auto-start host when the panel becomes active (default true).
   * Modal always auto-starts on open.
   */
  autoStart?: boolean;
};

function emptyStatus(): MirrorStatus {
  return {
    running: false,
    publicUrl: null,
    localPort: null,
    token: null,
    tokenTail: null,
    clients: 0,
    maxClients: MIRROR_DEFAULT_MAX_CLIENTS,
    phase: "stopped",
    error: null,
    readOnly: true,
    allowLan: false,
    lanUrl: null,
  };
}

function hostPhaseLabel(
  connect: MirrorHostConnectStatus,
  labels: MirrorConnectLabels,
): string {
  const field = mirrorHostPhaseLabelField(connect.phase);
  return labels[field];
}

function errorKindChipLabel(
  kind: MirrorErrorKind,
  labels: MirrorConnectLabels,
): string {
  switch (kind) {
    case "cloudflared_missing":
      return labels.errCloudflaredMissing;
    case "tunnel_timeout":
      return labels.errTunnelTimeout;
    case "tunnel_spawn":
      return labels.errTunnelSpawn;
    case "tunnel_not_registered":
      return labels.errTunnelNotRegistered;
    case "tunnel_dead":
      return labels.errTunnelDead;
    case "port_bind":
      return labels.errPortBind;
    case "desktop_only":
      return labels.errDesktopOnly;
    case "ws_closed":
      return labels.errWsClosed;
    case "ws_timeout":
      return labels.errWsTimeout;
    case "rpc_timeout":
      return labels.errRpcTimeout;
    case "rpc_unsupported":
      return labels.errRpcUnsupported;
    case "not_connected":
      return labels.errNotConnected;
    case "clients_full":
      return labels.errClientsFull;
    default:
      return labels.errOther;
  }
}

function errorKindHintLabel(
  kind: MirrorErrorKind,
  labels: MirrorConnectLabels,
): string {
  switch (kind) {
    case "cloudflared_missing":
      return labels.hintCloudflaredMissing;
    case "tunnel_timeout":
      return labels.hintTunnelTimeout;
    case "tunnel_spawn":
      return labels.hintTunnelSpawn;
    case "tunnel_not_registered":
      return labels.hintTunnelNotRegistered;
    case "tunnel_dead":
      return labels.hintTunnelDead;
    case "port_bind":
      return labels.hintPortBind;
    case "desktop_only":
      return labels.hintDesktopOnly;
    case "ws_closed":
      return labels.hintWsClosed;
    case "ws_timeout":
      return labels.hintWsTimeout;
    case "rpc_timeout":
      return labels.hintRpcTimeout;
    case "rpc_unsupported":
      return labels.hintRpcUnsupported;
    case "not_connected":
      return labels.hintNotConnected;
    case "clients_full":
      return labels.hintClientsFull;
    default:
      return labels.hintOther;
  }
}

function categoryLabel(
  id: MirrorWriteCategoryId,
  labels: MirrorConnectLabels,
): string {
  switch (id) {
    case "send":
      return labels.writeCategorySend;
    case "stop":
      return labels.writeCategoryStop;
    case "sessions":
      return labels.writeCategorySessions;
    case "permissions":
      return labels.writeCategoryPermissions;
    case "askUser":
      return labels.writeCategoryAskUser;
    case "plan":
      return labels.writeCategoryPlan;
    case "delete":
      return labels.writeCategoryDelete;
    case "rename":
      return labels.writeCategoryRename;
    default:
      return id;
  }
}

function capKindChipLabel(
  kind: MirrorClientCapKind,
  labels: MirrorConnectLabels,
): string {
  switch (kind) {
    case "full":
      return labels.capFull;
    case "near_full":
      return labels.capNearFull;
    case "write_on_warn":
      return labels.capWriteOnWarn;
    case "ok":
    default:
      return labels.capOk;
  }
}

function capKindHintLabel(
  kind: MirrorClientCapKind,
  labels: MirrorConnectLabels,
): string {
  switch (kind) {
    case "full":
      return labels.capFullHint;
    case "near_full":
      return labels.capNearFullHint;
    case "write_on_warn":
      return labels.capWriteOnWarnHint;
    case "ok":
    default:
      return labels.capOkHint;
  }
}

function MirrorClientCapStrip({
  labels,
  cap,
  empty,
  running,
}: {
  labels: MirrorConnectLabels;
  cap: MirrorClientCapState;
  empty: MirrorCapEmptyState | null;
  running: boolean;
}) {
  const toneClass = mirrorClientCapToneClass(cap.tone);
  const line = formatMirrorClientCapLine(cap, labels.capLine);
  const chip = capKindChipLabel(cap.kind, labels);

  return (
    <div
      className={"mirror-connect__cap" + (toneClass ? ` ${toneClass}` : "")}
      role="status"
      aria-live="polite"
    >
      <div className="mirror-connect__cap-head">
        <span className="mirror-connect__cap-line">{line}</span>
        {running ? (
          <span
            className={
              "mirror-connect__cap-chip" +
              (cap.kind === "full"
                ? " mirror-connect__cap-chip--full"
                : cap.tone === "warn"
                  ? " mirror-connect__cap-chip--warn"
                  : cap.tone === "ok"
                    ? " mirror-connect__cap-chip--ok"
                    : "")
            }
          >
            {chip}
          </span>
        ) : null}
        {running && cap.showWriteOnWarn && cap.kind !== "write_on_warn" ? (
          <span className="mirror-connect__cap-chip mirror-connect__cap-chip--warn">
            {labels.capWriteOnWarn}
          </span>
        ) : null}
      </div>

      {running ? (
        <div
          className="mirror-connect__cap-bar"
          aria-hidden
          title={line}
        >
          <div
            className="mirror-connect__cap-bar-fill"
            style={{ width: `${cap.fillPercent}%` }}
          />
        </div>
      ) : null}

      {empty ? (
        <div className="mirror-connect__cap-empty">
          <div className="mirror-connect__cap-empty-title">
            {empty.kind === "host_stopped"
              ? labels.capEmptyStopped
              : labels.capEmptyZero}
          </div>
          <div className="mirror-connect__cap-empty-hint">
            {empty.kind === "host_stopped"
              ? labels.capEmptyStoppedHint
              : labels.capEmptyZeroHint}
          </div>
        </div>
      ) : null}

      {cap.showFullBanner ? (
        <div className="mirror-connect__cap-full-banner" role="status">
          <div className="mirror-connect__cap-full-banner-title">
            {labels.capFullBanner}
          </div>
          <div className="mirror-connect__cap-full-banner-hint">
            {labels.capFullHint}
          </div>
        </div>
      ) : running && (cap.kind === "near_full" || cap.kind === "write_on_warn") ? (
        <p className="mirror-connect__cap-hint">
          {capKindHintLabel(cap.kind, labels)}
        </p>
      ) : null}
    </div>
  );
}

function auditTypeLabel(
  type: MirrorWriteAuditType,
  labels: MirrorConnectLabels,
): string {
  switch (type) {
    case "write_enabled":
      return labels.auditTypeWriteEnabled;
    case "write_disabled":
      return labels.auditTypeWriteDisabled;
    case "token_rotated":
      return labels.auditTypeTokenRotated;
    case "host_started":
      return labels.auditTypeHostStarted;
    case "host_stopped":
      return labels.auditTypeHostStopped;
    default:
      return type;
  }
}

function MirrorWriteAuditSection({
  labels,
  locale,
  onRequestConfirm,
}: {
  labels: MirrorConnectLabels;
  locale: string | null;
  onRequestConfirm: (opts: MirrorConfirmRequest) => void;
}) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<MirrorWriteAuditEvent[]>(() =>
    loadMirrorWriteAudit(),
  );

  useEffect(() => {
    const refresh = () => setEvents(loadMirrorWriteAudit());
    refresh();
    const onChange = () => refresh();
    window.addEventListener(MIRROR_WRITE_AUDIT_CHANGE_EVENT, onChange);
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === MIRROR_WRITE_AUDIT_STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(MIRROR_WRITE_AUDIT_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const handleClear = () => {
    onRequestConfirm({
      title: labels.auditClearConfirmTitle,
      message: labels.auditClearConfirmMessage,
      confirmLabel: labels.auditClearConfirmOk,
      onConfirm: () => {
        setEvents(clearMirrorWriteAudit());
      },
    });
  };

  return (
    <div className="mirror-connect__audit">
      <div className="mirror-connect__audit-head">
        <button
          type="button"
          className="mirror-connect__audit-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="mirror-connect__audit-chevron" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          <span className="mirror-connect__audit-title">{labels.auditTitle}</span>
          {events.length > 0 ? (
            <span className="mirror-connect__audit-count">{events.length}</span>
          ) : null}
        </button>
        {open && events.length > 0 ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm mirror-connect__audit-clear"
            onClick={handleClear}
          >
            {labels.auditClear}
          </button>
        ) : null}
      </div>
      {open ? (
        events.length === 0 ? (
          <p className="mirror-connect__audit-empty" role="status">
            {labels.auditEmpty}
          </p>
        ) : (
          <ul className="mirror-connect__audit-list" aria-label={labels.auditTitle}>
            {events.map((e) => (
              <li key={e.id} className="mirror-connect__audit-row">
                <span className="mirror-connect__audit-when" title={e.at}>
                  {formatListTimestamp(e.at, locale)}
                </span>
                <span className="mirror-connect__audit-label">
                  {auditTypeLabel(e.type, labels)}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function MirrorWriteCategories({ labels }: { labels: MirrorConnectLabels }) {
  const broad = isBroadMirrorWriteSurface();
  return (
    <div className="mirror-connect__write-surface" role="region" aria-label={labels.writeCategoriesTitle}>
      <div className="mirror-connect__write-surface-head">
        <span className="mirror-connect__write-surface-title">
          {labels.writeCategoriesTitle}
        </span>
        {broad ? (
          <span className="mirror-connect__write-surface-broad" role="status">
            {labels.writeBroadWarn}
          </span>
        ) : null}
      </div>
      <p className="mirror-connect__write-surface-hint">{labels.writeCategoriesHint}</p>
      <ul className="mirror-connect__write-cats">
        {MIRROR_WRITE_CATEGORIES.map((c) => (
          <li key={c.id} className="mirror-connect__write-cat">
            {categoryLabel(c.id, labels)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MirrorConnectBody({
  labels,
  locale,
  status,
  connect,
  busy,
  err,
  qrDataUrl,
  maxClientsDraft,
  onMaxClientsChange,
  onMaxClientsCommit,
  onCopy,
  onStart,
  onStop,
  onRotate,
  onToggleReadOnly,
  onToggleAllowLan,
  onRequestConfirm,
}: {
  labels: MirrorConnectLabels;
  locale: string | null;
  status: MirrorStatus;
  connect: MirrorHostConnectStatus;
  busy: boolean;
  err: string | null;
  qrDataUrl: string | null;
  maxClientsDraft: number;
  onMaxClientsChange: (n: number) => void;
  onMaxClientsCommit: () => void;
  onCopy: () => void;
  onStart: () => void;
  onStop: () => void;
  onRotate: () => void;
  onToggleReadOnly: () => void;
  onToggleAllowLan: () => void;
  onRequestConfirm: (opts: MirrorConfirmRequest) => void;
}) {
  const phaseMod = mirrorHostPhaseClass(connect.tone);
  const copyUrl = mirrorCopyUrl(status);
  const lanOn = !!status.allowLan;
  const showQr = shouldShowMirrorQr(status, connect);
  const showLiveLanRow =
    lanOn &&
    !!status.lanUrl &&
    connect.phase === "live" &&
    status.lanUrl !== status.publicUrl;
  const writeOn = status.running && status.readOnly === false;
  const cap = resolveMirrorClientCapState({
    connected: status.running ? status.clients : 0,
    max: status.maxClients ?? maxClientsDraft,
    writeEnabled: writeOn,
  });
  const capEmpty = resolveMirrorCapEmptyState({
    running: status.running,
    connected: status.running ? status.clients : 0,
  });
  // Prefer live cap-full honesty over a generic error chip when at limit.
  const showClientsFullChip =
    cap.atLimit || connect.errorKind === "clients_full";
  const diagnosticText =
    connect.showDiagnostic || err || status.error
      ? mirrorDiagnosticDisplay({
          errorKind: connect.errorKind,
          safeMessage: connect.safeMessage,
          missingCloudflaredLabel: labels.missingCloudflared,
          genericLabel: labels.errorGeneric,
        })
      : null;

  return (
    <>
      <p className="mirror-connect__hint">{labels.hint}</p>

      <div
        className={"mirror-connect__phase" + (phaseMod ? ` ${phaseMod}` : "")}
        role="status"
      >
        <span className="mirror-connect__phase-dot" aria-hidden />
        {hostPhaseLabel(connect, labels)}
        {status.running && status.clients > 0 ? (
          <span className="mirror-connect__clients">
            · {labels.clients.replace("{n}", String(status.clients))}
          </span>
        ) : null}
        {showClientsFullChip ? (
          <span
            className="mirror-connect__err-chip mirror-connect__err-chip--warn"
            title={labels.capFullHint}
          >
            {labels.errClientsFull}
          </span>
        ) : connect.errorKind && connect.tone !== "ok" ? (
          <span
            className={
              "mirror-connect__err-chip" +
              (connect.tone === "err"
                ? " mirror-connect__err-chip--err"
                : " mirror-connect__err-chip--warn")
            }
            title={errorKindHintLabel(connect.errorKind, labels)}
          >
            {errorKindChipLabel(connect.errorKind, labels)}
          </span>
        ) : null}
      </div>

      <MirrorClientCapStrip
        labels={labels}
        cap={cap}
        empty={capEmpty}
        running={status.running}
      />

      {connect.showSoftLocal ? (
        <div
          className="mirror-connect__soft-banner"
          role="status"
          aria-live="polite"
        >
          {connect.phase === "tunnel_dead"
            ? labels.softTunnelDeadBanner
            : labels.softLocalBanner}
        </div>
      ) : null}

      {diagnosticText ? (
        <div
          className={
            "mirror-connect__error" +
            (connect.showSoftLocal || connect.tone === "warn"
              ? " mirror-connect__error--soft"
              : "")
          }
          role={connect.showSoftLocal ? "status" : "alert"}
        >
          <div className="mirror-connect__error-msg">{diagnosticText}</div>
          {connect.errorKind ? (
            <div className="mirror-connect__error-hint">
              {errorKindHintLabel(connect.errorKind, labels)}
            </div>
          ) : null}
        </div>
      ) : null}

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
          {busy ||
          connect.phase === "starting" ||
          connect.phase === "waiting_tunnel"
            ? "…"
            : null}
        </div>
      )}

      {copyUrl ? (
        <div className="mirror-connect__link-row">
          <label className="mirror-connect__link-label">
            {connect.phase === "live"
              ? labels.linkLabel
              : lanOn && !isLoopbackMirrorUrl(copyUrl)
                ? labels.linkLabelLan
                : labels.linkLabelLocal}
          </label>
          <div className="mirror-connect__link-box">
            <code className="mirror-connect__url" title={copyUrl}>
              {copyUrl}
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
          {isLoopbackMirrorUrl(copyUrl) ? (
            <p className="mirror-connect__warn">{labels.lanHint}</p>
          ) : lanOn ? (
            <p className="mirror-connect__warn">{labels.lanHintOn}</p>
          ) : null}
          {lanOn && !status.lanUrl ? (
            <p className="mirror-connect__warn">{labels.lanIpUnknown}</p>
          ) : null}
        </div>
      ) : null}

      {showLiveLanRow && status.lanUrl ? (
        <div className="mirror-connect__link-row">
          <label className="mirror-connect__link-label">
            {labels.linkLabelLan}
          </label>
          <div className="mirror-connect__link-box">
            <code className="mirror-connect__url" title={status.lanUrl}>
              {status.lanUrl}
            </code>
          </div>
        </div>
      ) : null}

      <div className="mirror-connect__max-clients">
        <label className="mirror-connect__max-clients-label" htmlFor="mirror-max-clients">
          {labels.maxClientsLabel}
        </label>
        <div className="mirror-connect__max-clients-row">
          <input
            id="mirror-max-clients"
            className="mirror-connect__max-clients-input"
            type="number"
            min={MIRROR_MIN_CLIENTS}
            max={MIRROR_MAX_CLIENTS_CAP}
            step={1}
            disabled={busy}
            value={maxClientsDraft}
            onChange={(e) => {
              const n = clampMirrorMaxClients(e.target.value);
              onMaxClientsChange(n);
            }}
            onBlur={() => onMaxClientsCommit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onMaxClientsCommit();
                (e.target as HTMLInputElement).blur();
              }
            }}
            aria-describedby="mirror-max-clients-hint"
          />
          <span className="mirror-connect__max-clients-value" aria-hidden>
            {labels.maxClientsValue
              .replace("{n}", String(maxClientsDraft))
              .replace("{max}", String(MIRROR_MAX_CLIENTS_CAP))}
          </span>
        </div>
        <p id="mirror-max-clients-hint" className="mirror-connect__max-clients-hint">
          {labels.maxClientsHint}
        </p>
      </div>

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
              className={
                "btn btn--ghost" +
                (status.readOnly ? "" : " mirror-connect__write-toggle--on")
              }
              disabled={busy}
              onClick={onToggleReadOnly}
              aria-pressed={!status.readOnly}
            >
              {status.readOnly ? labels.allowWrite : labels.readOnlyOn}
            </button>
          </>
        ) : null}
        <button
          type="button"
          className={
            "btn btn--ghost" +
            (lanOn ? " mirror-connect__write-toggle--on" : "")
          }
          disabled={busy}
          onClick={onToggleAllowLan}
          aria-pressed={lanOn}
          title={labels.allowLanHint}
        >
          {lanOn ? labels.allowLanOn : labels.allowLan}
        </button>
      </div>
      {status.running && status.readOnly ? (
        <p className="mirror-connect__hint">{labels.readOnlyHint}</p>
      ) : null}
      {writeOn ? (
        <>
          <div
            className="mirror-connect__write-banner"
            role="status"
            aria-live="polite"
          >
            <span className="mirror-connect__write-banner-chip" aria-hidden>
              !
            </span>
            <span className="mirror-connect__write-banner-text">
              {labels.writeEnabledBanner}
            </span>
          </div>
          <MirrorWriteCategories labels={labels} />
        </>
      ) : null}

      <MirrorWriteAuditSection
        labels={labels}
        locale={locale}
        onRequestConfirm={onRequestConfirm}
      />
    </>
  );
}

export function MirrorConnectPanel({
  variant = "modal",
  open = true,
  onClose,
  labels,
  locale,
  onRequestConfirm,
  showToast,
  autoStart = true,
}: MirrorConnectPanelProps) {
  const [status, setStatus] = useState<MirrorStatus>(emptyStatus);
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [maxClientsDraft, setMaxClientsDraft] = useState(
    MIRROR_DEFAULT_MAX_CLIENTS,
  );

  const active = variant === "inline" ? open !== false : !!open;

  /** Update status/error. Optionally sync max-clients draft (not on poll — would clobber edits). */
  const applyStatus = useCallback(
    (st: MirrorStatus, opts?: { syncMaxClients?: boolean }) => {
      setStatus(st);
      setErr(st.error);
      if (opts?.syncMaxClients) {
        setMaxClientsDraft(
          clampMirrorMaxClients(st.maxClients ?? MIRROR_DEFAULT_MAX_CLIENTS),
        );
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    try {
      const st = await api.mirrorStatus();
      // Poll: keep status.clients/phase fresh; leave maxClientsDraft alone.
      applyStatus(st);
    } catch (e) {
      setErr(String(e));
    }
  }, [applyStatus]);

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
          applyStatus(st, { syncMaxClients: true });
        } else {
          try {
            const st = await api.mirrorStatus();
            if (!cancelled) applyStatus(st, { syncMaxClients: true });
          } catch (e) {
            if (!cancelled) setErr(String(e));
          }
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
  }, [active, autoStart, refresh, applyStatus]);

  // QR encodes the phone-facing URL — never a loopback address.
  const copyUrl = mirrorCopyUrl(status);
  useEffect(() => {
    if (!copyUrl || isLoopbackMirrorUrl(copyUrl)) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(copyUrl, {
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
  }, [copyUrl]);

  const doRotate = () => {
    void (async () => {
      try {
        const st = await api.mirrorRotateToken();
        applyStatus(st, { syncMaxClients: true });
        // Never log token/URL — type only.
        recordMirrorWriteAudit({ type: "token_rotated" });
      } catch (e) {
        setErr(String(e));
      }
    })();
  };

  const handleRotate = () => {
    // Regenerating the link invalidates every phone session — confirm in-app.
    const n = status.clients ?? 0;
    const message =
      n > 0
        ? labels.rotateConfirmMessageClients.replace("{n}", String(n))
        : labels.rotateConfirmMessage;
    onRequestConfirm({
      title: labels.rotateConfirmTitle,
      message,
      confirmLabel: labels.rotateConfirmOk,
      onConfirm: doRotate,
    });
  };

  const applyReadOnly = (readOnly: boolean) => {
    void (async () => {
      try {
        const st = await api.mirrorSetReadOnly(readOnly);
        applyStatus(st, { syncMaxClients: true });
        recordMirrorWriteAudit({
          type: readOnly ? "write_disabled" : "write_enabled",
        });
      } catch (e) {
        setErr(String(e));
      }
    })();
  };

  const handleToggleReadOnly = () => {
    // Enabling write is a high-risk action — always confirm in-app (never window.confirm).
    if (status.readOnly) {
      onRequestConfirm({
        title: labels.writeConfirmTitle,
        message: labels.writeConfirmMessage,
        confirmLabel: labels.writeConfirmOk,
        onConfirm: () => applyReadOnly(false),
      });
      return;
    }
    // Reverting to read-only is safe; no confirm.
    applyReadOnly(true);
  };

  const handleMaxClientsCommit = () => {
    const next = clampMirrorMaxClients(maxClientsDraft);
    setMaxClientsDraft(next);
    const current = clampMirrorMaxClients(
      status.maxClients ?? MIRROR_DEFAULT_MAX_CLIENTS,
    );
    if (next === current) return;
    void (async () => {
      try {
        const st = await api.mirrorSetMaxClients(next);
        applyStatus(st, { syncMaxClients: true });
      } catch (e) {
        setErr(String(e));
        setMaxClientsDraft(current);
      }
    })();
  };

  const applyAllowLan = (allowLan: boolean) => {
    void (async () => {
      setBusy(true);
      try {
        const st = await api.mirrorSetAllowLan(allowLan);
        applyStatus(st, { syncMaxClients: true });
      } catch (e) {
        setErr(String(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  const handleToggleAllowLan = () => {
    if (!status.allowLan) {
      onRequestConfirm({
        title: labels.allowLanConfirmTitle,
        message: labels.allowLanConfirmMessage,
        confirmLabel: labels.allowLanConfirmOk,
        onConfirm: () => applyAllowLan(true),
      });
      return;
    }
    applyAllowLan(false);
  };

  const handleCopy = async () => {
    const url = mirrorCopyUrl(status);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      showToast(labels.errorGeneric, 3000);
    }
  };

  const handleStart = () => {
    setBusy(true);
    void api
      .mirrorStart()
      .then((st) => {
        applyStatus(st, { syncMaxClients: true });
        // Explicit user start only (auto-start on open does not audit).
        if (st.running) {
          recordMirrorWriteAudit({ type: "host_started" });
        }
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  };

  const handleStop = () => {
    onRequestConfirm({
      title: labels.stopConfirmTitle,
      message: labels.stopConfirmMessage,
      confirmLabel: labels.stopConfirmOk,
      onConfirm: () => {
        setBusy(true);
        void api
          .mirrorStop()
          .then((st) => {
            applyStatus(st, { syncMaxClients: true });
            setErr(null);
            recordMirrorWriteAudit({ type: "host_stopped" });
          })
          .catch((e) => setErr(String(e)))
          .finally(() => setBusy(false));
      },
    });
  };

  const connect = useMemo(
    () =>
      deriveMirrorHostStatus({
        phase: status.phase,
        running: status.running,
        publicUrl: status.publicUrl,
        localPort: status.localPort,
        clients: status.clients,
        maxClients: status.maxClients,
        error: status.error,
        uiError: err,
        readOnly: status.readOnly,
      }),
    [status, err],
  );

  const body = (
    <MirrorConnectBody
      labels={labels}
      locale={locale}
      status={status}
      connect={connect}
      busy={busy}
      err={err}
      qrDataUrl={qrDataUrl}
      maxClientsDraft={maxClientsDraft}
      onMaxClientsChange={setMaxClientsDraft}
      onMaxClientsCommit={handleMaxClientsCommit}
      onCopy={() => void handleCopy()}
      onStart={handleStart}
      onStop={handleStop}
      onRotate={handleRotate}
      onToggleReadOnly={handleToggleReadOnly}
      onToggleAllowLan={handleToggleAllowLan}
      onRequestConfirm={onRequestConfirm}
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
      {/* Shared body with inline (MIRROR-PRO status / soft-fail / actions). */}
      {body}
    </GlassModal>
  );
}
