/**
 * Local persistence for Remote IM channel instances + bridge config.
 * Host may replace with ~/.grok-app/remote/*.json later.
 */

import type {
  AclConfig,
  BridgeGlobalConfig,
  ChannelInstance,
  ChannelStatusTone,
  ProjectScope,
  PresenterMode,
  RemoteChannelId,
} from "./types";
import {
  defaultOptionsFor,
  getChannelSchema,
} from "./channelSchemas";
import { credentialsRefFor } from "./secretsApi";

const LS_CHANNELS = "grok-app.remoteIm.channels";
const LS_BRIDGE = "grok-app.remoteIm.bridge";

export function defaultAcl(): AclConfig {
  return {
    allowFrom: "*",
    allowChat: "",
    requireMention: true,
    groupOnly: false,
    adminFrom: "",
    shareSessionInChannel: false,
  };
}

/**
 * Spec §6.9: Weixin personal has no interactive cards — always force text menus.
 * Other channels keep requested auto/text_only (default auto).
 */
export function resolvePresenterForChannel(
  channel: RemoteChannelId,
  requested?: PresenterMode | null,
): PresenterMode {
  if (channel === "weixin") return "text_only";
  return requested === "text_only" ? "text_only" : "auto";
}

/** True when the UI must lock the presenter control (Weixin text-menu only). */
export function isPresenterLocked(channel: RemoteChannelId): boolean {
  return channel === "weixin";
}

export function createDefaultInstance(
  channel: RemoteChannelId,
  name = "default",
): ChannelInstance {
  const schema = getChannelSchema(channel);
  const id = `${channel}-default`;
  return {
    id,
    channel,
    name,
    enabled: false,
    credentialsRef: null,
    options: schema ? defaultOptionsFor(schema) : {},
    acl: defaultAcl(),
    projectScope: "all_trusted",
    presenter: resolvePresenterForChannel(channel),
    hasCredentials: false,
    lastError: null,
    status: "unconfigured",
  };
}

export function loadChannelInstances(): ChannelInstance[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(LS_CHANNELS);
    if (!raw) return [];
    const list = JSON.parse(raw) as ChannelInstance[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveChannelInstances(list: ChannelInstance[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_CHANNELS, JSON.stringify(list));
}

export function loadBridgeConfig(): BridgeGlobalConfig {
  try {
    if (typeof localStorage === "undefined") {
      return { enabled: false, lifecycle: "attached", allowRemoteYolo: false };
    }
    const raw = localStorage.getItem(LS_BRIDGE);
    if (!raw) {
      return { enabled: false, lifecycle: "attached", allowRemoteYolo: false };
    }
    const v = JSON.parse(raw) as BridgeGlobalConfig;
    return {
      enabled: !!v.enabled,
      lifecycle: v.lifecycle === "detached" ? "detached" : "attached",
      allowRemoteYolo: !!v.allowRemoteYolo,
    };
  } catch {
    return { enabled: false, lifecycle: "attached", allowRemoteYolo: false };
  }
}

export function saveBridgeConfig(cfg: BridgeGlobalConfig): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_BRIDGE, JSON.stringify(cfg));
}

export function upsertInstance(
  list: ChannelInstance[],
  inst: ChannelInstance,
): ChannelInstance[] {
  const i = list.findIndex((x) => x.id === inst.id);
  if (i < 0) return [...list, inst];
  const next = list.slice();
  next[i] = inst;
  return next;
}

export function removeInstance(
  list: ChannelInstance[],
  instanceId: string,
): ChannelInstance[] {
  return list.filter((x) => x.id !== instanceId);
}

/**
 * Full danger-zone delete: clear secrets vault entry, disconnect Bridge, drop instance.
 * Spec §5.3 — delete credentials → clear secrets + stop that instance connection.
 */
export async function deleteChannelInstance(input: {
  list: ChannelInstance[];
  instanceId: string;
  deleteSecrets?: (credentialsRef: string) => Promise<void>;
  disconnectInstance?: (instance: ChannelInstance) => Promise<void>;
}): Promise<{
  list: ChannelInstance[];
  deleted: ChannelInstance | null;
  secretsCleared: boolean;
  disconnected: boolean;
}> {
  const deleted =
    input.list.find((x) => x.id === input.instanceId) ?? null;
  if (!deleted) {
    return {
      list: input.list,
      deleted: null,
      secretsCleared: false,
      disconnected: false,
    };
  }

  let secretsCleared = false;
  const ref = deleted.credentialsRef;
  if (ref) {
    if (input.deleteSecrets) {
      await input.deleteSecrets(ref);
    } else {
      const { remoteImSecretsDelete } = await import("./secretsApi");
      await remoteImSecretsDelete(ref);
    }
    secretsCleared = true;
  }

  // Force Bridge to drop connection even if list no longer contains instance
  const disconnectPayload: ChannelInstance = {
    ...deleted,
    enabled: false,
    hasCredentials: false,
  };
  if (input.disconnectInstance) {
    await input.disconnectInstance(disconnectPayload);
  } else {
    const { bridgeReloadInstance } = await import("./bridgeClient");
    await bridgeReloadInstance(disconnectPayload);
  }

  return {
    list: removeInstance(input.list, input.instanceId),
    deleted,
    secretsCleared,
    disconnected: true,
  };
}

export function instancesForChannel(
  list: ChannelInstance[],
  channel: RemoteChannelId,
): ChannelInstance[] {
  return list.filter((x) => x.channel === channel);
}

/**
 * Sidebar / instance status light.
 * Never reports "connected" without Bridge running **and** this instance linked.
 * `bridgeLinked` defaults to false when omitted (honest soft-fail).
 */
export function deriveStatus(
  inst: ChannelInstance,
  bridgeRunning: boolean,
  bridgeLinked = false,
): ChannelStatusTone {
  if (inst.lastError) return "error";
  if (
    inst.hasCredentials &&
    inst.enabled &&
    bridgeRunning &&
    bridgeLinked
  ) {
    return "connected";
  }
  if (inst.hasCredentials) return "configured";
  return "unconfigured";
}

export function applySaveInstance(input: {
  channel: RemoteChannelId;
  instanceId: string;
  name: string;
  options: Record<string, unknown>;
  acl: AclConfig;
  projectScope: ProjectScope;
  presenter: PresenterMode;
  enabled: boolean;
  hasCredentials: boolean;
  existing?: ChannelInstance | null;
}): ChannelInstance {
  const ref =
    input.existing?.credentialsRef ??
    credentialsRefFor(input.channel, input.instanceId);
  const base: ChannelInstance = {
    id: input.instanceId,
    channel: input.channel,
    name: input.name,
    enabled: input.enabled,
    credentialsRef: input.hasCredentials ? ref : null,
    options: input.options,
    acl: input.acl,
    projectScope: input.projectScope,
    presenter: resolvePresenterForChannel(input.channel, input.presenter),
    hasCredentials: input.hasCredentials,
    lastError: null,
    status: "unconfigured",
  };
  base.status = deriveStatus(base, false, false);
  return base;
}
