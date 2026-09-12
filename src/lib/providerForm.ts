/**
 * Custom-provider form mapping: ProviderModelEntry / CustomProvider /
 * ProviderPreset → the panel's FormState, plus small label helpers.
 * Pure functions extracted from ProvidersPanel so the mapping is testable
 * without rendering the panel.
 */
import * as api from "@/lib/api";
import type { MessageKey } from "@/i18n";
import {
  alignGrokPresetEfforts,
  applyPresetEndpoint,
  defaultCustomChannelEfforts,
  type ProviderPreset,
} from "@/lib/providerPresets";

export type FormEffort = {
  id: string;
  name: string;
  isDefault: boolean;
};

export type FormModel = {
  /** Upstream request body model id. */
  id: string;
  /** Display name shown on composer chip / menu. */
  name: string;
  contextWindow?: number | null;
  supportsVision?: boolean;
  supportsVideo?: boolean;
  efforts?: FormEffort[];
};

export function toFormEfforts(
  list?: Array<{ id: string; name?: string; isDefault?: boolean }>,
): FormEffort[] | undefined {
  if (!list?.length) return list ? [] : undefined;
  return list.map((e) => ({
    id: e.id,
    name: e.name?.trim() || e.id,
    isDefault: !!e.isDefault,
  }));
}

export function asFormModel(m: api.ProviderModelEntry): FormModel {
  return {
    id: m.id,
    name: m.name,
    contextWindow: m.contextWindow ?? null,
    supportsVision: m.supportsVision,
    supportsVideo: m.supportsVideo,
    efforts: toFormEfforts(m.efforts),
  };
}

export type FormState = {
  id: string;
  name: string;
  baseUrl: string;
  /** When true, host keeps baseUrl as-is (no auto `/v1`). */
  baseUrlFullPath: boolean;
  apiKey: string;
  apiBackend: string;
  providerMode: "generic" | "grok_build_proxy";
  models: FormModel[];
  efforts: FormEffort[];
  /** Extra rules appended to the system prompt on this channel. */
  appendPrompt: string;
  /** Explicit: this relay accepts image pixels. */
  supportsVision: boolean;
  /** External signup URL for “Get API Key” (from preset). */
  apiKeyUrl: string | null;
  extraHeaders: { name: string; value: string }[];
  /** Prefill / keep per-channel context_window. Null = omit on create. */
  contextWindow: number | null;
};

export type RightMode = "empty" | "pick" | "create" | "edit" | "official";
export type Selection = null | "official" | string;

export const emptyForm = (): FormState => ({
  id: "",
  name: "",
  baseUrl: "",
  baseUrlFullPath: false,
  apiKey: "",
  apiBackend: "responses",
  providerMode: "generic",
  appendPrompt: "",
  supportsVision: false,
  models: [],
  efforts: defaultCustomChannelEfforts().map((e) => ({
    id: e.id,
    name: e.name || e.id,
    isDefault: !!e.isDefault,
  })),
  apiKeyUrl: null,
  extraHeaders: [],
  contextWindow: null,
});

export function modelsFromProvider(p: api.CustomProvider): FormModel[] {
  if (p.models?.length) {
    return p.models.map((m) => ({
      id: m.id,
      name: m.name?.trim() || m.id,
      contextWindow: m.contextWindow ?? null,
      supportsVision: m.supportsVision,
      supportsVideo: m.supportsVideo,
      efforts: m.efforts?.map((e) => ({
        id: e.id,
        name: e.name?.trim() || e.id,
        isDefault: !!e.isDefault,
      })),
    }));
  }
  const id = p.model?.trim() ?? "";
  if (!id) return [];
  return [{ id, name: id }];
}

export function effortsFromProvider(p: api.CustomProvider): FormEffort[] {
  const aligned = alignGrokPresetEfforts({
    providerId: p.id,
    baseUrl: p.baseUrl,
    efforts: p.efforts,
  });
  const source = aligned ?? p.efforts;
  if (source?.length) {
    return source.map((e) => ({
      id: e.id,
      name: e.name?.trim() || e.id,
      isDefault: !!e.isDefault,
    }));
  }
  return defaultCustomChannelEfforts().map((e) => ({
    id: e.id,
    name: e.name || e.id,
    isDefault: !!e.isDefault,
  }));
}

export function formFromPreset(preset: ProviderPreset, endpointId?: string): FormState {
  const applied = applyPresetEndpoint(
    preset,
    endpointId ?? preset.defaultEndpointId,
  );
  return {
    id: preset.suggestedId,
    name: preset.name,
    baseUrl: applied.baseUrl,
    // Most presets ship with `/v1`; Volcengine Ark / Zhipu roots are already complete.
    baseUrlFullPath: applied.baseUrlFullPath,
    apiKey: "",
    apiBackend: preset.apiBackend,
    providerMode: "generic",
    // Presets carry no channel rules — opt-in per provider.
    appendPrompt: "",
    supportsVision: !!preset.supportsVision,
    models: preset.models.map((m) => ({
      id: m.id,
      name: m.name || m.id,
      contextWindow: m.contextWindow ?? preset.contextWindow ?? null,
      supportsVision: m.supportsVision ?? preset.supportsVision,
      supportsVideo: m.supportsVideo,
      efforts: (m.efforts?.length ? m.efforts : preset.efforts).map((e) => ({
        id: e.id,
        name: e.name || e.id,
        isDefault: !!e.isDefault,
      })),
    })),
    efforts: preset.efforts.map((e) => ({
      id: e.id,
      name: e.name || e.id,
      isDefault: !!e.isDefault,
    })),
    apiKeyUrl: applied.apiKeyUrl,
    extraHeaders: [],
    contextWindow:
      preset.contextWindow && preset.contextWindow > 0
        ? preset.contextWindow
        : null,
  };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export function ccSwitchStatusKey(status: string): MessageKey {
  switch (status) {
    case "importable":
      return "prov.ccSwitch.status.importable";
    case "official":
      return "prov.ccSwitch.status.official";
    case "missing_key":
      return "prov.ccSwitch.status.missing_key";
    case "proxy_managed":
      return "prov.ccSwitch.status.proxy_managed";
    case "exists":
      return "prov.ccSwitch.status.exists";
    case "invalid":
    default:
      return "prov.ccSwitch.status.invalid";
  }
}
