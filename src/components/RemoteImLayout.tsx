/**
 * Settings → Remote IM secondary layout: sidebar (Bridge + channels) + panel.
 * Spec: docs/llm-wiki/remote-im.md §2
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createT, resolveLocale, type MessageKey } from "@/i18n";
import {
  CHANNEL_SCHEMAS,
  type BridgeStatus,
  type ChannelInstance,
  type ChannelSchema,
  type ChannelStatusTone,
  type RemoteChannelId,
  type RemoteImSelection,
  bridgeGetStatus,
  bridgeReloadInstance,
  bridgeRestart,
  bridgeSetConfig,
  bridgeStart,
  bridgeStop,
  bridgeTestConnection,
  createDefaultInstance,
  deleteChannelInstance,
  deriveStatus,
  filterActiveChannels,
  instancesForChannel,
  isRemoteChannelId,
  isRetiredChannel,
  loadChannelInstances,
  loadBridgeConfig,
  recordRimBridgeEvent,
  remoteImDeleteInstance,
  remoteImListInstances,
  saveBridgeConfig,
  saveChannelInstances,
  upsertInstance,
} from "@/lib/remoteIm";
import { RemoteImOverview } from "@/components/RemoteImOverview";
import { RemoteImChannelPanel } from "@/components/RemoteImChannelPanel";
import { GlassModal } from "@/components/GlassModal";
import { RimStatusDot } from "@/components/remoteIm/RimControls";
import { IconChat, IconPlug } from "@/components/icons";

export type TrustedProjectOption = {
  id: string;
  name: string;
  path: string;
};

export interface RemoteImLayoutProps {
  locale: string;
  /** App trusted projects only — no free path picker */
  trustedProjects?: TrustedProjectOption[];
}

/** Settings tab ids under remote_im — not channel ids. */
const REMOTE_CONTROL_TABS = new Set(["im", "mirror"]);

function parseHashSelection(): RemoteImSelection {
  if (typeof window === "undefined") return { kind: "bridge" };
  const raw = (window.location.hash || "").replace(/^#\/?/, "");
  // settings/remote_im[/im|mirror][/channel[/instance]]
  // Legacy: settings/remote_im/{channel}[/instance]
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] !== "settings" || parts[1] !== "remote_im") {
    return { kind: "bridge" };
  }
  let idx = 2;
  if (parts[2] && REMOTE_CONTROL_TABS.has(parts[2])) {
    // "mirror" tab has no IM channel selection; "im" may be followed by channel.
    if (parts[2] === "mirror") return { kind: "bridge" };
    idx = 3;
  }
  const channel = parts[idx];
  if (channel && isRemoteChannelId(channel)) {
    return {
      kind: "channel",
      channelId: channel,
      instanceId: parts[idx + 1],
    };
  }
  return { kind: "bridge" };
}

function writeHashSelection(sel: RemoteImSelection) {
  if (typeof window === "undefined") return;
  // Keep the IM tab segment so settings catalog tab stays on `im`.
  if (sel.kind === "bridge") {
    window.location.hash = "#/settings/remote_im/im";
    return;
  }
  const base = `#/settings/remote_im/im/${sel.channelId}`;
  window.location.hash = sel.instanceId ? `${base}/${sel.instanceId}` : base;
}

export function RemoteImLayout({
  locale,
  trustedProjects = [],
}: RemoteImLayoutProps) {
  const tr = useMemo(() => createT(resolveLocale(locale)), [locale]);
  const t = useCallback((k: string, vars?: Record<string, string | number>) => {
    return tr(k as MessageKey, vars);
  }, [tr]);

  const [selection, setSelection] = useState<RemoteImSelection>(() =>
    parseHashSelection(),
  );
  const [instances, setInstances] = useState<ChannelInstance[]>(() =>
    loadChannelInstances(),
  );
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [danger, setDanger] = useState<{
    instanceId: string;
    channel: RemoteChannelId;
  } | null>(null);

  const refreshBridge = useCallback(async () => {
    const st = await bridgeGetStatus();
    setBridge(st);
    return st;
  }, []);

  useEffect(() => {
    void refreshBridge();
  }, [refreshBridge]);

  // While recovering / backing off, poll status so nextRetrySecs + recovery card stay honest.
  useEffect(() => {
    const st = bridge?.state;
    const recovering =
      !!bridge?.enabled &&
      st !== "listening" &&
      st !== "running" &&
      st !== "stopped";
    const rateLimited = !!bridge?.rateLimited;
    if (!recovering && !rateLimited) return;
    const id = window.setInterval(() => {
      void refreshBridge();
    }, 3000);
    return () => window.clearInterval(id);
  }, [
    bridge?.enabled,
    bridge?.state,
    bridge?.rateLimited,
    bridge?.nextRetrySecs,
    refreshBridge,
  ]);

  // Prefer host-persisted instances when Tauri available; auto-start Bridge if
  // channels are bound but connectors are stopped (e.g. after tauri dev reload).
  useEffect(() => {
    void (async () => {
      const host = await remoteImListInstances();
      if (host && host.length > 0) {
        setInstances(host);
        saveChannelInstances(host);
      }
      const list = host && host.length > 0 ? host : loadChannelInstances();
      const ready = list.some((i) => i.enabled && i.hasCredentials);
      const st = await bridgeGetStatus();
      setBridge(st);
      if (ready && st.state !== "running" && st.state !== "listening") {
        try {
          const started = await bridgeStart();
          setBridge(started);
          const cfg = loadBridgeConfig();
          if (!cfg.enabled) {
            saveBridgeConfig({ ...cfg, enabled: true });
          }
        } catch {
          // Host may already be starting from setup auto-start.
          void refreshBridge();
        }
      }
    })();
  }, [refreshBridge]);

  useEffect(() => {
    const onHash = () => setSelection(parseHashSelection());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const select = useCallback((sel: RemoteImSelection) => {
    setSelection(sel);
    writeHashSelection(sel);
  }, []);

  const channelStatus = useCallback(
    (schema: ChannelSchema): ChannelStatusTone => {
      const list = instancesForChannel(instances, schema.id);
      if (list.length === 0) return "unconfigured";
      const running =
        bridge?.state === "running" || bridge?.state === "listening";
      const linkedIds = new Set(
        (bridge?.connectedChannels ?? []).map((c) => c.instanceId),
      );
      const tones = list.map((i) =>
        deriveStatus(
          { ...i, status: i.status },
          !!running,
          linkedIds.has(i.id),
        ),
      );
      if (tones.includes("error")) return "error";
      if (tones.includes("connected")) return "connected";
      if (tones.includes("configured")) return "configured";
      return "unconfigured";
    },
    [instances, bridge],
  );

  const persistInstances = useCallback((list: ChannelInstance[]) => {
    setInstances(list);
    saveChannelInstances(list);
  }, []);

  const activeInstance = useMemo(() => {
    if (selection.kind !== "channel") return null;
    const list = instancesForChannel(instances, selection.channelId);
    if (selection.instanceId) {
      return list.find((i) => i.id === selection.instanceId) ?? list[0] ?? null;
    }
    return list[0] ?? null;
  }, [selection, instances]);

  const onSaveInstance = useCallback(
    async (inst: ChannelInstance) => {
      // Soft-retired channels: no new bind / save-connect
      if (isRetiredChannel(inst.channel)) return;
      setBusy("save");
      try {
        let saved = { ...inst };
        if (inst.enabled && inst.hasCredentials) {
          const cfg = loadBridgeConfig();
          if (!cfg.enabled) {
            saveBridgeConfig({ ...cfg, enabled: true });
          }
          const st = await bridgeReloadInstance(inst);
          setBridge(st);
          const linked = st.connectedChannels.some(
            (c) => c.instanceId === inst.id,
          );
          saved = {
            ...saved,
            status: deriveStatus(
              saved,
              st.state === "running" || st.state === "listening",
              linked,
            ),
          };
          recordRimBridgeEvent({
            type:
              saved.status === "connected"
                ? "channel_connected"
                : "channel_reloaded",
            channel: inst.channel,
            instanceId: inst.id,
          });
        } else {
          recordRimBridgeEvent({
            type: "channel_reloaded",
            channel: inst.channel,
            instanceId: inst.id,
            note: inst.enabled ? undefined : "disabled",
          });
        }
        persistInstances(upsertInstance(instances, saved));
        await refreshBridge();
      } finally {
        setBusy(null);
      }
    },
    [instances, persistInstances, refreshBridge],
  );

  const onTestConnection = useCallback(
    async (channel: RemoteChannelId, instanceId: string, hasCreds: boolean) => {
      setBusy("test");
      try {
        const result = await bridgeTestConnection({
          channel,
          instanceId,
          hasCredentials: hasCreds,
        });
        recordRimBridgeEvent({
          type: result.ok ? "test_ok" : "test_fail",
          channel,
          instanceId,
          note: result.ok ? undefined : "failed",
        });
        return result;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const onDeleteInstance = useCallback(async () => {
    if (!danger) return;
    setBusy("delete");
    try {
      await remoteImDeleteInstance(danger.instanceId);
      const result = await deleteChannelInstance({
        list: instances,
        instanceId: danger.instanceId,
      });
      recordRimBridgeEvent({
        type: "channel_disconnected",
        channel: danger.channel,
        instanceId: danger.instanceId,
        note: "deleted",
      });
      persistInstances(result.list);
      setDanger(null);
      select({ kind: "channel", channelId: danger.channel });
      await refreshBridge();
    } finally {
      setBusy(null);
    }
  }, [danger, instances, persistInstances, refreshBridge, select]);

  const groups: Array<{
    key: "domestic" | "overseas" | "other";
    labelKey: string;
  }> = [
    { key: "domestic", labelKey: "settings.remoteIm.group.domestic" },
    { key: "overseas", labelKey: "settings.remoteIm.group.overseas" },
    { key: "other", labelKey: "settings.remoteIm.group.other" },
  ];

  return (
    <div className="rim-layout">
      <aside className="rim-sidebar" aria-label={t("settings.remoteIm.sidebarAria")}>
        <button
          type="button"
          className={
            "rim-sidebar__item" +
            (selection.kind === "bridge" ? " is-active" : "")
          }
          onClick={() => select({ kind: "bridge" })}
        >
          <span className="rim-sidebar__icon" aria-hidden>
            <IconPlug size={16} />
          </span>
          <span className="rim-sidebar__label">
            {t("settings.remoteIm.bridgeOverview")}
          </span>
          <RimStatusDot
            tone={
              bridge?.state === "running" || bridge?.state === "listening"
                ? "connected"
                : bridge?.state === "degraded" || bridge?.state === "error"
                  ? "error"
                  : "unconfigured"
            }
            title={bridge?.state ?? "stopped"}
          />
        </button>

        {groups.map((g) => {
          // Hide soft-retired WPS channels by default; re-show when legacy instances exist.
          const channels = filterActiveChannels(
            CHANNEL_SCHEMAS.filter((c) => c.group === g.key),
            { includeRetiredWithInstances: true, instances },
          );
          if (channels.length === 0) return null;
          return (
            <div key={g.key} className="rim-sidebar__group">
              <div className="rim-sidebar__group-label">{t(g.labelKey)}</div>
              {channels.map((ch) => {
                const tone = channelStatus(ch);
                const active =
                  selection.kind === "channel" &&
                  selection.channelId === ch.id;
                const count = instancesForChannel(instances, ch.id).filter(
                  (i) => i.hasCredentials,
                ).length;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    className={
                      "rim-sidebar__item" + (active ? " is-active" : "")
                    }
                    data-channel={ch.id}
                    onClick={() =>
                      select({ kind: "channel", channelId: ch.id })
                    }
                  >
                    <span className="rim-sidebar__icon" aria-hidden>
                      <IconChat size={15} />
                    </span>
                    <span className="rim-sidebar__label">{t(ch.nameKey)}</span>
                    {count > 0 ? (
                      <span className="rim-sidebar__badge">{count}</span>
                    ) : null}
                    <RimStatusDot tone={tone} />
                  </button>
                );
              })}
            </div>
          );
        })}
      </aside>

      <div className="rim-panel">
        {selection.kind === "bridge" ? (
          <RemoteImOverview
            locale={locale}
            bridge={bridge}
            busy={busy}
            instances={instances}
            onStart={async () => {
              setBusy("start");
              try {
                setBridge(await bridgeStart());
                recordRimBridgeEvent({ type: "bridge_started" });
              } finally {
                setBusy(null);
              }
            }}
            onStop={async () => {
              setBusy("stop");
              try {
                setBridge(await bridgeStop());
                recordRimBridgeEvent({ type: "bridge_stopped" });
              } finally {
                setBusy(null);
              }
            }}
            onRestart={async () => {
              setBusy("restart");
              try {
                setBridge(await bridgeRestart());
                recordRimBridgeEvent({ type: "bridge_restarted" });
              } finally {
                setBusy(null);
              }
            }}
            onToggleEnabled={async (enabled) => {
              setBusy("cfg");
              try {
                setBridge(await bridgeSetConfig({ enabled }));
                recordRimBridgeEvent({
                  type: "bridge_config",
                  note: enabled ? "enabled" : "disabled",
                });
              } finally {
                setBusy(null);
              }
            }}
            onLifecycle={async (lifecycle) => {
              setBusy("cfg");
              try {
                setBridge(await bridgeSetConfig({ lifecycle }));
                recordRimBridgeEvent({
                  type: "bridge_config",
                  note: lifecycle,
                });
              } finally {
                setBusy(null);
              }
            }}
            onAllowYolo={async (allowRemoteYolo) => {
              setBusy("cfg");
              try {
                setBridge(await bridgeSetConfig({ allowRemoteYolo }));
                recordRimBridgeEvent({
                  type: "bridge_config",
                  note: allowRemoteYolo ? "yolo_on" : "yolo_off",
                });
              } finally {
                setBusy(null);
              }
            }}
            onOpenChannel={(channelId) =>
              select({ kind: "channel", channelId })
            }
          />
        ) : (
          <RemoteImChannelPanel
            locale={locale}
            channelId={selection.channelId}
            instance={
              activeInstance ?? createDefaultInstance(selection.channelId)
            }
            instances={instancesForChannel(instances, selection.channelId)}
            trustedProjects={trustedProjects}
            busy={busy}
            bridgeRunning={
              bridge?.state === "running" || bridge?.state === "listening"
            }
            bridgeLinked={
              !!activeInstance &&
              (bridge?.connectedChannels ?? []).some(
                (c) => c.instanceId === activeInstance.id,
              )
            }
            onSave={onSaveInstance}
            onTest={onTestConnection}
            onRequestDelete={(instanceId) =>
              setDanger({ instanceId, channel: selection.channelId })
            }
            onSelectInstance={(instanceId) =>
              select({
                kind: "channel",
                channelId: selection.channelId,
                instanceId,
              })
            }
            onAddInstance={() => {
              // Soft-retired channels: no new binds / instances
              if (isRetiredChannel(selection.channelId)) return;
              const n = instancesForChannel(instances, selection.channelId)
                .length;
              const inst = createDefaultInstance(
                selection.channelId,
                n === 0 ? "default" : `instance-${n + 1}`,
              );
              inst.id = `${selection.channelId}-${Date.now().toString(36)}`;
              persistInstances(upsertInstance(instances, inst));
              select({
                kind: "channel",
                channelId: selection.channelId,
                instanceId: inst.id,
              });
            }}
          />
        )}
      </div>

      <GlassModal
        open={!!danger}
        onClose={() => setDanger(null)}
        title={t("settings.remoteIm.danger.deleteTitle")}
        wrapBody
        footer={
          <div className="rim-modal__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setDanger(null)}
            >
              {t("settings.remoteIm.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy === "delete"}
              onClick={() => void onDeleteInstance()}
            >
              {t("settings.remoteIm.danger.deleteConfirm")}
            </button>
          </div>
        }
      >
        <p className="rim-modal__body">
          {t("settings.remoteIm.danger.deleteBody")}
        </p>
      </GlassModal>
    </div>
  );
}
