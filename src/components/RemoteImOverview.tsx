/**
 * Remote IM Bridge overview — settings-card rows + project chrome controls.
 * Includes Remote security ops checklist (ACL · rate-limit · bridge · write).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createT, resolveLocale, type MessageKey } from "@/i18n";
import type {
  BridgeLifecycle,
  BridgeStatus,
  ChannelInstance,
  RemoteChannelId,
} from "@/lib/remoteIm";
import {
  classifyChannelsEmptyState,
  classifyRecoveryStatus,
  classifyTimelineEmptyState,
  clearRimEventTimeline,
  displayBridgeLastError,
  formatRimEventAt,
  getChannelSchema,
  loadRimEventTimeline,
  planBridgeReconnectAction,
  rateLimitPolicyFacts,
  rimBridgeEventTypeKey,
  RIM_EVENT_TIMELINE_CHANGE_EVENT,
  RIM_EVENT_TIMELINE_STORAGE_KEY,
  shouldShowResilienceHonestyNotes,
  type RimBridgeEvent,
} from "@/lib/remoteIm";
import {
  aggregateAllowFromSummary,
  allowFromSummaryKey,
  buildRemoteSecurityChecklist,
  checklistStatusTone,
  DANGEROUS_WRITE_CONFIRMS,
  formatRemoteSecuritySummaryText,
  remoteSecurityRiskKey,
  remoteSecurityRiskTone,
} from "@/lib/remoteSecurityOps";
import * as api from "@/lib/api";
import {
  RimBadge,
  RimChoiceRow,
  RimStatusDot,
  RimSwitch,
} from "@/components/remoteIm/RimControls";
import { GlassModal } from "@/components/GlassModal";
import {
  IconActivity,
  IconCopy,
  IconPlug,
  IconShieldCheck,
} from "@/components/icons";

export interface RemoteImOverviewProps {
  locale: string;
  bridge: BridgeStatus | null;
  busy: string | null;
  instances: ChannelInstance[];
  onStart: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  onRestart: () => void | Promise<void>;
  onToggleEnabled: (enabled: boolean) => void | Promise<void>;
  onLifecycle: (lifecycle: BridgeLifecycle) => void | Promise<void>;
  onAllowYolo: (allow: boolean) => void | Promise<void>;
  onOpenChannel: (channelId: RemoteChannelId) => void;
}

export function RemoteImOverview({
  locale,
  bridge,
  busy,
  instances,
  onStart,
  onStop,
  onRestart,
  onToggleEnabled,
  onLifecycle,
  onAllowYolo,
  onOpenChannel,
}: RemoteImOverviewProps) {
  const tr = useMemo(() => createT(resolveLocale(locale)), [locale]);
  const t = (k: string, vars?: Record<string, string | number>) =>
    tr(k as MessageKey, vars);

  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timeline, setTimeline] = useState<RimBridgeEvent[]>(() =>
    loadRimEventTimeline(),
  );
  const [clearConfirm, setClearConfirm] = useState(false);
  const [yoloConfirm, setYoloConfirm] = useState(false);
  const [mirrorWriteEnabled, setMirrorWriteEnabled] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");
  const [confirmsOpen, setConfirmsOpen] = useState(false);

  useEffect(() => {
    const refresh = () => setTimeline(loadRimEventTimeline());
    refresh();
    const onChange = () => refresh();
    window.addEventListener(RIM_EVENT_TIMELINE_CHANGE_EVENT, onChange);
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === RIM_EVENT_TIMELINE_STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(RIM_EVENT_TIMELINE_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Soft mirror write posture for security checklist (default read-only).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const st = await api.mirrorStatus();
        if (!cancelled) {
          setMirrorWriteEnabled(!!st.running && st.readOnly === false);
        }
      } catch {
        if (!cancelled) setMirrorWriteEnabled(false);
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const state = bridge?.state ?? "stopped";
  const enabled = bridge?.enabled ?? false;
  const lifecycle = bridge?.lifecycle ?? "attached";
  const yolo = bridge?.allowRemoteYolo ?? false;
  const connected = bridge?.connectedChannels ?? [];
  const configured = instances.filter((i) => i.hasCredentials);

  const recovery = useMemo(
    () =>
      classifyRecoveryStatus({
        state: bridge?.state,
        enabled: bridge?.enabled ?? false,
        restartAttempt: bridge?.restartAttempt,
        nextRetrySecs: bridge?.nextRetrySecs,
        lastError: bridge?.lastError,
        errorKind: bridge?.errorKind,
        rateLimited: bridge?.rateLimited,
      }),
    [bridge],
  );

  const reconnect = useMemo(
    () =>
      planBridgeReconnectAction({
        recovery,
        busy,
        state: bridge?.state,
      }),
    [recovery, busy, bridge?.state],
  );

  const ratePolicy = useMemo(() => rateLimitPolicyFacts(), []);

  const safeLastError = useMemo(
    () => displayBridgeLastError(bridge?.lastError, bridge?.errorKind),
    [bridge?.lastError, bridge?.errorKind],
  );

  const channelsEmpty = useMemo(
    () =>
      classifyChannelsEmptyState({
        connectedCount: connected.length,
        configuredCount: configured.length,
        recovery,
      }),
    [connected.length, configured.length, recovery],
  );

  const timelineEmpty = useMemo(
    () =>
      classifyTimelineEmptyState({
        eventCount: timeline.length,
        recovery,
      }),
    [timeline.length, recovery],
  );

  const showHonestyNotes = useMemo(
    () =>
      shouldShowResilienceHonestyNotes({
        enabled,
        recovery,
      }),
    [enabled, recovery],
  );

  const aclAgg = useMemo(
    () =>
      aggregateAllowFromSummary(
        instances.map((i) => ({
          enabled: i.enabled,
          hasCredentials: i.hasCredentials,
          allowFrom: i.acl?.allowFrom,
        })),
      ),
    [instances],
  );

  const security = useMemo(() => {
    const statusInput = {
      allowFromSummary: aclAgg.summary,
      openAclChannelCount: aclAgg.openCount,
      emptyAclChannelCount: aclAgg.emptyCount,
      bridgeEnabled: enabled,
      bridgeState: state,
      bridgeLinked: connected.length > 0,
      rateLimited: !!bridge?.rateLimited,
      inboundRateLimitActive: true,
      mirrorWriteEnabled,
      remoteYoloEnabled: yolo,
      bridgeErrorKind: bridge?.errorKind,
      lastError: bridge?.lastError,
      configuredChannelCount: configured.length,
      connectedChannelCount: connected.length,
    };
    const checklist = buildRemoteSecurityChecklist(statusInput);
    return {
      checklist,
      statusInput,
      summaryText: formatRemoteSecuritySummaryText({
        ...statusInput,
        checklist,
        locale,
      }),
    };
  }, [
    aclAgg,
    enabled,
    state,
    connected.length,
    bridge?.rateLimited,
    bridge?.errorKind,
    bridge?.lastError,
    mirrorWriteEnabled,
    yolo,
    configured.length,
    locale,
  ]);

  const openAclInstance = useMemo(() => {
    return (
      instances.find((i) => {
        if (!i.enabled && !i.hasCredentials) return false;
        const raw = String(i.acl?.allowFrom ?? "").trim();
        return !raw || raw === "*";
      }) ??
      instances.find((i) => i.hasCredentials) ??
      instances[0] ??
      null
    );
  }, [instances]);

  const copySecuritySummary = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(security.summaryText);
      setCopyState("ok");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("fail");
      window.setTimeout(() => setCopyState("idle"), 2500);
    }
  }, [security.summaryText]);

  const onYoloToggle = (v: boolean) => {
    if (v && !yolo) {
      setYoloConfirm(true);
      return;
    }
    void onAllowYolo(v);
  };

  const stateLabel =
    state === "running" || state === "listening"
      ? t("settings.remoteIm.bridge.listening")
      : state === "error"
        ? t("settings.remoteIm.bridge.error")
        : state === "starting"
          ? t("settings.remoteIm.bridge.starting")
          : state === "degraded"
            ? t("settings.remoteIm.bridge.degraded")
            : t("settings.remoteIm.bridge.stopped");

  const badgeTone =
    state === "running" || state === "listening"
      ? "ok"
      : state === "error" || state === "degraded" || recovery.phase === "rate_limited"
        ? "err"
        : recovery.phase === "backing_off" || recovery.phase === "restarting"
          ? "warn"
          : "neutral";

  return (
    <div className="rim-overview">
      <header className="rim-panel__header">
        <div className="rim-panel__header-text">
          <div className="rim-panel__title-row">
            <IconPlug size={18} />
            <h2 className="rim-panel__title">
              {t("settings.remoteIm.bridgeOverview")}
            </h2>
          </div>
          <p className="rim-panel__lead">{t("settings.remoteIm.bridge.lead")}</p>
        </div>
        <RimBadge tone={badgeTone}>
          <span className="rim-badge__inner">
            <RimStatusDot
              tone={
                state === "running" || state === "listening"
                  ? "connected"
                  : state === "error"
                    ? "error"
                    : "unconfigured"
              }
            />
            {stateLabel}
            {bridge?.mock ? ` · ${t("settings.remoteIm.bridge.mock")}` : ""}
          </span>
        </RimBadge>
      </header>

      <h3 className="settings-page__h2">{t("settings.remoteIm.bridge.actions")}</h3>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row__text">
            <div className="settings-row__label">
              {t("settings.remoteIm.bridge.enable")}
            </div>
            <div className="settings-row__desc">
              {t("settings.remoteIm.bridge.enableDesc")}
            </div>
          </div>
          <RimSwitch
            checked={enabled}
            disabled={!!busy}
            label={t("settings.remoteIm.bridge.enable")}
            onChange={(v) => void onToggleEnabled(v)}
          />
        </div>

        <div className="settings-row settings-row--stack">
          <div className="settings-row__text">
            <div className="settings-row__label">
              {t("settings.remoteIm.bridge.lifecycle")}
            </div>
            <div className="settings-row__desc">
              {t("settings.remoteIm.bridge.lifecycleDesc")}
            </div>
          </div>
          <RimChoiceRow
            value={lifecycle}
            disabled={!!busy}
            onChange={(v) => void onLifecycle(v as BridgeLifecycle)}
            options={[
              {
                value: "attached",
                label: t("settings.remoteIm.bridge.attached"),
              },
              {
                value: "detached",
                label: t("settings.remoteIm.bridge.detached"),
              },
            ]}
          />
        </div>

        <div className="settings-row">
          <div className="settings-row__text">
            <div className="settings-row__label">
              {t("settings.remoteIm.bridge.allowYolo")}
            </div>
            <div className="settings-row__desc">
              {t("settings.remoteIm.bridge.allowYoloDesc")}
            </div>
          </div>
          <RimSwitch
            checked={yolo}
            disabled={!!busy}
            label={t("settings.remoteIm.bridge.allowYolo")}
            onChange={onYoloToggle}
          />
        </div>

        <div className="settings-row settings-row--stack">
          <div className="settings-row__label">
            {t("settings.remoteIm.bridge.actions")}
          </div>
          <div className="rim-btn-row">
            <button
              type="button"
              className="btn btn--primary"
              disabled={
                !!busy ||
                state === "running" ||
                state === "listening" ||
                state === "starting"
              }
              onClick={() => void onStart()}
            >
              {t("settings.remoteIm.bridge.start")}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!!busy || state === "stopped"}
              onClick={() => void onStop()}
            >
              {t("settings.remoteIm.bridge.stop")}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!!busy}
              onClick={() => void onRestart()}
            >
              {t("settings.remoteIm.bridge.restart")}
            </button>
          </div>
        </div>
      </div>

      <h3 className="settings-page__h2">
        <IconActivity size={14} />
        {t("settings.remoteIm.bridge.connected")}
      </h3>
      <div className="settings-card" data-rim-channels-empty={channelsEmpty?.kind ?? "none"}>
        {connected.length === 0 && configured.length === 0 ? (
          <div className="settings-row settings-row--stack">
            <p
              className="settings-page__lead"
              style={{ margin: 0 }}
              role="status"
              data-rim-soft-fail={channelsEmpty?.softFail ? "1" : "0"}
            >
              {t(channelsEmpty?.messageKey ?? "settings.remoteIm.bridge.noneConnected")}
            </p>
          </div>
        ) : connected.length === 0 && channelsEmpty?.softFail ? (
          <div className="settings-row settings-row--stack">
            <p
              className="settings-page__lead"
              style={{ margin: 0 }}
              role="status"
              data-rim-soft-fail="1"
            >
              {t(channelsEmpty.messageKey)}
            </p>
            {configured.length > 0 ? (
              <ul className="rim-list">
                {configured.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      className="rim-list__link"
                      onClick={() => onOpenChannel(i.channel)}
                    >
                      <span className="rim-list__name">
                        {t(
                          getChannelSchema(i.channel)?.nameKey ??
                            "settings.remoteIm.channel.feishu",
                        )}
                        <span className="rim-list__meta">{i.name}</span>
                      </span>
                      <RimStatusDot tone="configured" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <ul className="rim-list">
            {connected.map((c) => (
              <li key={c.instanceId}>
                <button
                  type="button"
                  className="rim-list__link"
                  onClick={() => onOpenChannel(c.channel)}
                >
                  <span className="rim-list__name">
                    {t(
                      getChannelSchema(c.channel)?.nameKey ??
                        "settings.remoteIm.channel.feishu",
                    )}
                    <span className="rim-list__meta">{c.name}</span>
                  </span>
                  <RimStatusDot tone="connected" />
                </button>
              </li>
            ))}
            {configured
              .filter((i) => !connected.some((c) => c.instanceId === i.id))
              .map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    className="rim-list__link"
                    onClick={() => onOpenChannel(i.channel)}
                  >
                    <span className="rim-list__name">
                      {t(
                        getChannelSchema(i.channel)?.nameKey ??
                          "settings.remoteIm.channel.feishu",
                      )}
                      <span className="rim-list__meta">{i.name}</span>
                    </span>
                    <RimStatusDot tone="configured" />
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>

      {recovery.showCard ? (
        <div
          className={
            recovery.severity === "err"
              ? "rim-callout rim-callout--error"
              : "rim-callout rim-callout--warn"
          }
          role="status"
          data-rim-recovery={recovery.phase}
        >
          <div className="rim-callout__title">{t(recovery.titleKey)}</div>
          {recovery.bodyKey ? (
            <p className="rim-callout__body" style={{ margin: "0.35rem 0 0" }}>
              {t(recovery.bodyKey)}
            </p>
          ) : null}
          {recovery.errorKindKey ? (
            <p className="settings-row__desc" style={{ margin: "0.35rem 0 0" }}>
              {t("settings.remoteIm.resilience.errorKindLabel")}:{" "}
              {t(recovery.errorKindKey)}
            </p>
          ) : null}
          {recovery.showRetryMeta ? (
            <p className="settings-row__desc" style={{ margin: "0.35rem 0 0" }}>
              {t("settings.remoteIm.resilience.retryMeta", {
                attempt: recovery.attempt,
                secs: recovery.nextRetrySecs ?? 0,
              })}
            </p>
          ) : null}
          {safeLastError.text ? (
            <code className="rim-callout__code" style={{ marginTop: "0.5rem" }}>
              {safeLastError.redacted
                ? t(safeLastError.text)
                : safeLastError.text}
            </code>
          ) : null}
          {reconnect.show ? (
            <div className="rim-btn-row" style={{ marginTop: "0.65rem" }}>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={reconnect.disabled}
                title={reconnect.tipKey ? t(reconnect.tipKey) : undefined}
                data-rim-reconnect="1"
                onClick={() => void onRestart()}
              >
                {t(reconnect.labelKey)}
              </button>
              <span className="settings-row__desc" style={{ margin: 0 }}>
                {t("settings.remoteIm.resilience.reconnectHint")}
              </span>
            </div>
          ) : null}
        </div>
      ) : safeLastError.text ? (
        <div className="rim-callout rim-callout--error" role="alert">
          <div className="rim-callout__title">
            {t("settings.remoteIm.bridge.lastError")}
          </div>
          <code className="rim-callout__code">
            {safeLastError.redacted
              ? t(safeLastError.text)
              : safeLastError.text}
          </code>
        </div>
      ) : null}

      {showHonestyNotes ? (
        <div
          className="settings-card rim-resilience-notes"
          data-rim-resilience-notes="1"
        >
          <div className="settings-row settings-row--stack">
            <div className="settings-row__text">
              <div className="settings-row__label">
                {t("settings.remoteIm.resilience.notesTitle")}
              </div>
              <div className="settings-row__desc">
                {t("settings.remoteIm.resilience.notesLead")}
              </div>
            </div>
            <ul className="rim-help-list" aria-label={t("settings.remoteIm.resilience.notesTitle")}>
              <li>
                {t("settings.remoteIm.resilience.notes.rateLimit", {
                  perChat: ratePolicy.perChat,
                  global: ratePolicy.global,
                  windowSecs: ratePolicy.windowSecs,
                })}
              </li>
              <li>
                {t("settings.remoteIm.resilience.notes.backoff", {
                  capSecs: ratePolicy.backoffCapSecs,
                  baseSecs: ratePolicy.backoffBaseSecs,
                })}
              </li>
              <li>{t("settings.remoteIm.resilience.notes.noSilentDrop")}</li>
              <li>{t("settings.remoteIm.resilience.notes.crashRecovery")}</li>
            </ul>
          </div>
        </div>
      ) : null}

      {bridge && bridge.backend && bridge.backend !== "rust" ? (
        <div className="rim-callout rim-callout--warn">
          <p>{t("settings.remoteIm.bridge.remoteBridgeMissing")}</p>
        </div>
      ) : null}

      <h3 className="settings-page__h2">
        <IconShieldCheck size={14} />
        {t("settings.remoteIm.security.title")}
      </h3>
      <div className="settings-card rim-security" data-rim-security-risk={security.checklist.risk}>
        <div className="settings-row settings-row--stack">
          <div className="rim-security__head">
            <div className="settings-row__text">
              <div className="settings-row__label">
                {t("settings.remoteIm.security.subtitle")}
              </div>
              <div className="settings-row__desc">
                {t("settings.remoteIm.security.lead")}
              </div>
            </div>
            <RimBadge tone={remoteSecurityRiskTone(security.checklist.risk)}>
              {t(remoteSecurityRiskKey(security.checklist.risk))}
            </RimBadge>
          </div>
          <div className="rim-security__chips">
            <span className="rim-security__chip">
              {t("settings.remoteIm.security.aclLabel")}:{" "}
              {t(allowFromSummaryKey(aclAgg.summary))}
              {aclAgg.openCount > 0
                ? ` · ${t("settings.remoteIm.security.openCount", {
                    n: aclAgg.openCount,
                  })}`
                : ""}
            </span>
          </div>
          <ul
            className="rim-security__list"
            aria-label={t("settings.remoteIm.security.checklistAria")}
          >
            {security.checklist.items.map((item) => (
              <li key={item.id} className="rim-security__item">
                <RimBadge tone={checklistStatusTone(item.status)}>
                  {t(`settings.remoteIm.security.status.${item.status}`)}
                </RimBadge>
                <span className="rim-security__item-text">
                  <span className="rim-security__item-label">
                    {t(item.labelKey)}
                  </span>
                  {item.detailKey ? (
                    <span className="rim-security__item-detail">
                      {t(item.detailKey)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <div className="rim-btn-row">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => void copySecuritySummary()}
            >
              <IconCopy size={14} />
              {copyState === "ok"
                ? t("settings.remoteIm.security.copied")
                : copyState === "fail"
                  ? t("settings.remoteIm.security.copyFail")
                  : t("settings.remoteIm.security.copySummary")}
            </button>
            {openAclInstance ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => onOpenChannel(openAclInstance.channel)}
              >
                {t("settings.remoteIm.security.openAllowFrom")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              aria-expanded={confirmsOpen}
              onClick={() => setConfirmsOpen((v) => !v)}
            >
              {t("settings.remoteIm.security.confirmsToggle")}
            </button>
          </div>
          {confirmsOpen ? (
            <div className="rim-security__confirms">
              <p className="settings-row__desc" style={{ margin: 0 }}>
                {t("settings.remoteIm.security.confirmsLead")}
              </p>
              <ul className="rim-help-list">
                {DANGEROUS_WRITE_CONFIRMS.map((c) => (
                  <li key={c.id}>{t(c.labelKey)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="settings-row__desc" style={{ margin: 0 }}>
            {t("settings.remoteIm.security.honesty")}
          </p>
        </div>
      </div>

      <h3 className="settings-page__h2">
        {t("settings.remoteIm.timeline.title")}
      </h3>
      <div className="settings-card rim-timeline">
        <div className="rim-timeline__head">
          <button
            type="button"
            className="rim-timeline__toggle"
            aria-expanded={timelineOpen}
            onClick={() => setTimelineOpen((v) => !v)}
          >
            <span className="rim-timeline__chevron" aria-hidden>
              {timelineOpen ? "▾" : "▸"}
            </span>
            <span className="rim-timeline__title">
              {t("settings.remoteIm.timeline.subtitle")}
            </span>
            {timeline.length > 0 ? (
              <span className="rim-timeline__count">{timeline.length}</span>
            ) : null}
          </button>
          {timelineOpen && timeline.length > 0 ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setClearConfirm(true)}
            >
              {t("settings.remoteIm.timeline.clear")}
            </button>
          ) : null}
        </div>
        <p className="settings-row__desc rim-timeline__desc">
          {t("settings.remoteIm.timeline.desc")}
        </p>
        {timelineOpen ? (
          timeline.length === 0 ? (
            <p
              className="rim-timeline__empty"
              role="status"
              data-rim-soft-fail={timelineEmpty?.softFail ? "1" : "0"}
              data-rim-timeline-empty={timelineEmpty?.kind ?? "idle"}
            >
              {t(
                timelineEmpty?.messageKey ?? "settings.remoteIm.timeline.empty",
              )}
            </p>
          ) : (
            <ul
              className="rim-timeline__list"
              aria-label={t("settings.remoteIm.timeline.title")}
            >
              {timeline.map((e) => (
                <li key={e.id} className="rim-timeline__row">
                  <span className="rim-timeline__when" title={e.at}>
                    {formatRimEventAt(e.at)}
                  </span>
                  <span className="rim-timeline__label">
                    {t(rimBridgeEventTypeKey(e.type))}
                    {e.channel ? (
                      <span className="rim-timeline__meta">
                        {" "}
                        ·{" "}
                        {t(
                          getChannelSchema(e.channel as RemoteChannelId)
                            ?.nameKey ?? "settings.remoteIm.unknownChannel",
                        )}
                      </span>
                    ) : null}
                    {e.note ? (
                      <span className="rim-timeline__note"> — {e.note}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      <h3 className="settings-page__h2">
        {t("settings.remoteIm.bridge.commands")}
      </h3>
      <div className="settings-card">
        <div className="settings-row settings-row--stack">
          <div className="settings-row__desc">
            {t("settings.remoteIm.bridge.commandsDesc")}
          </div>
          <ul className="rim-help-list">
            <li>
              <code>/start</code> · <code>/help</code> —{" "}
              {t("settings.remoteIm.cmd.help")}
            </li>
            <li>
              <code>/p</code> — {t("settings.remoteIm.cmd.project")}
            </li>
            <li>
              <code>/r</code> — {t("settings.remoteIm.cmd.resume")}
            </li>
            <li>
              <code>/new</code> — {t("settings.remoteIm.cmd.new")}
            </li>
            <li>
              <code>/status</code> — {t("settings.remoteIm.cmd.status")}
            </li>
            <li>
              <code>/context</code> — {t("settings.remoteIm.cmd.context")}
            </li>
            <li>
              <code>/compact [note]</code> — {t("settings.remoteIm.cmd.compact")}
            </li>
            <li>
              <code>/account</code> · <code>/quota</code> —{" "}
              {t("settings.remoteIm.cmd.account")}
            </li>
            <li>
              <code>/account n</code> · <code>/switch n</code> —{" "}
              {t("settings.remoteIm.cmd.switch")}
            </li>
            <li>
              <code>/whoami</code> — {t("settings.remoteIm.cmd.whoami")}
            </li>
            <li>
              <code>/stop</code> — {t("settings.remoteIm.cmd.stop")}
            </li>
          </ul>
          <div className="settings-row__desc" style={{ marginTop: 8 }}>
            {t("settings.remoteIm.bridge.telegramNativeCommands")}
          </div>
        </div>
      </div>

      <GlassModal
        open={clearConfirm}
        onClose={() => setClearConfirm(false)}
        title={t("settings.remoteIm.timeline.clearTitle")}
        wrapBody
        footer={
          <div className="rim-modal__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setClearConfirm(false)}
            >
              {t("settings.remoteIm.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                setTimeline(clearRimEventTimeline());
                setClearConfirm(false);
              }}
            >
              {t("settings.remoteIm.timeline.clearConfirm")}
            </button>
          </div>
        }
      >
        <p className="rim-modal__body">
          {t("settings.remoteIm.timeline.clearBody")}
        </p>
      </GlassModal>

      <GlassModal
        open={yoloConfirm}
        onClose={() => setYoloConfirm(false)}
        title={t("settings.remoteIm.security.yoloConfirmTitle")}
        wrapBody
        footer={
          <div className="rim-modal__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setYoloConfirm(false)}
            >
              {t("settings.remoteIm.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={!!busy}
              onClick={() => {
                setYoloConfirm(false);
                void onAllowYolo(true);
              }}
            >
              {t("settings.remoteIm.security.yoloConfirmOk")}
            </button>
          </div>
        }
      >
        <p className="rim-modal__body">
          {t("settings.remoteIm.security.yoloConfirmBody")}
        </p>
      </GlassModal>
    </div>
  );
}
