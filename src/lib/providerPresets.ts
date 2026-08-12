/**
 * Built-in custom-provider presets (add-provider gallery).
 * Values align with upstream docs; App stores them in agent-home config.toml.
 */

import type { ProviderEffortEntry, ProviderModelEntry } from "@/lib/api";

/** Known brand marks with dedicated logos (see ProviderBrandIcon). */
export type ProviderBrandId =
  | "deepseek"
  | "amux"
  | "opencode-go"
  | "volcano-ark";

export type ProviderPreset = {
  id: string;
  /** Channel display name (provider card / group). */
  name: string;
  /** Suggested config section id. */
  suggestedId: string;
  baseUrl: string;
  /**
   * When true, store Base URL as typed (no auto `/v1`).
   * Needed for Volcengine Ark Coding Plan roots like `…/api/plan/v3`.
   */
  baseUrlFullPath?: boolean;
  apiBackend: "responses" | "chat_completions" | "messages";
  models: ProviderModelEntry[];
  efforts: ProviderEffortEntry[];
  /** Optional short blurb for the gallery chip. */
  blurbKey?: string;
  /** Where to obtain an API key (opened from the form). */
  apiKeyUrl?: string;
  /** Brand logo key when available (Yun API has none yet). */
  brandId?: ProviderBrandId;
};

/**
 * Default reasoning tiers for custom Grok-compatible channels:
 * low · medium · high · max (max maps to the 极高 UI slot via `tier4` kind).
 */
export const GROK_CHANNEL_EFFORTS: ProviderEffortEntry[] = [
  { id: "low", name: "low" },
  { id: "medium", name: "medium", isDefault: true },
  { id: "high", name: "high" },
  { id: "max", name: "max" },
];

/**
 * DeepSeek thinking-mode efforts (OpenAI `reasoning_effort` mapping table):
 * low / high / xhigh / max — see
 * https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
 */
export const DEEPSEEK_EFFORTS: ProviderEffortEntry[] = [
  { id: "low", name: "low" },
  { id: "high", name: "high", isDefault: true },
  { id: "xhigh", name: "xhigh" },
  { id: "max", name: "max" },
];

export const DEEPSEEK_MODELS: ProviderModelEntry[] = [
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
];

/** Amux OpenAI-compatible relay (official Grok catalog ids). */
export const AMUX_MODELS: ProviderModelEntry[] = [
  { id: "grok-4.6", name: "Grok 4.6" },
  { id: "grok-4.5", name: "Grok 4.5" },
];

/** Yun API (云驿 yunyi) OpenAI-compatible relay. */
export const YUN_API_MODELS: ProviderModelEntry[] = [
  { id: "grok-4.6", name: "Grok 4.6" },
  { id: "grok-4.5", name: "Grok 4.5" },
];

/**
 * Volcengine Ark (火山方舟) Coding Plan — OpenAI-compatible chat_completions
 * at a non-`/v1` full path root (requires baseUrlFullPath).
 */
export const VOLCANO_ARK_MODELS: ProviderModelEntry[] = [
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
];

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    suggestedId: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    apiBackend: "chat_completions",
    models: DEEPSEEK_MODELS,
    efforts: DEEPSEEK_EFFORTS,
    blurbKey: "prov.preset.deepseek.blurb",
    apiKeyUrl: "https://platform.deepseek.com/",
    brandId: "deepseek",
  },
  {
    id: "amux",
    name: "Amux",
    suggestedId: "amux",
    baseUrl: "https://api.amux.ai/v1",
    apiBackend: "responses",
    models: AMUX_MODELS,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.amux.blurb",
    apiKeyUrl: "https://api.amux.ai/register?aff=Vccp",
    brandId: "amux",
  },
  {
    id: "yun-api",
    name: "Yun API",
    suggestedId: "yun-api",
    baseUrl: "https://api.yunyi.ai/v1",
    apiBackend: "responses",
    models: YUN_API_MODELS,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.yunApi.blurb",
    apiKeyUrl: "https://api.yunyi.ai/register/?aff_code=W0iw",
    // No logo yet
  },
  /**
   * OpenCode Zen Go gateway. DeepSeek-class models on this host must use
   * `chat_completions` — their Responses stream emits non-standard events
   * (`ping`, deltas without `sequence_number`) that crash Grok Build CLI.
   */
  {
    id: "opencode-go",
    name: "OpenCode Go",
    suggestedId: "opencode-go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    apiBackend: "chat_completions",
    models: [
      { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" },
      { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
    ],
    efforts: DEEPSEEK_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.opencodeGo.blurb",
    apiKeyUrl: "https://opencode.ai/",
    brandId: "opencode-go",
  },
  /**
   * Volcengine Ark (火山方舟) Coding Plan.
   * Full-path root — do not auto-append `/v1` (app_base_url_full_path).
   */
  {
    id: "volcano-ark",
    name: "火山方舟",
    suggestedId: "volcano-ark",
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    baseUrlFullPath: true,
    apiBackend: "chat_completions",
    models: VOLCANO_ARK_MODELS,
    efforts: GROK_CHANNEL_EFFORTS.map((e) => ({ ...e })),
    blurbKey: "prov.preset.volcanoArk.blurb",
    apiKeyUrl: "https://console.volcengine.com/ark",
    brandId: "volcano-ark",
  },
];

export function findProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

function matchPreset(opts: {
  providerId?: string | null;
  baseUrl?: string | null;
}): ProviderPreset | undefined {
  const pid = opts.providerId?.trim().toLowerCase() ?? "";
  if (pid) {
    const byId = PROVIDER_PRESETS.find(
      (p) => p.id === pid || p.suggestedId === pid,
    );
    if (byId) return byId;
    // Legacy local ids that still map to a known brand (e.g. huo-shan → 火山方舟).
    if (
      pid === "huo-shan" ||
      pid === "huoshan" ||
      pid === "volcengine-ark" ||
      pid === "volcengine" ||
      pid === "ark"
    ) {
      const ark = PROVIDER_PRESETS.find((p) => p.id === "volcano-ark");
      if (ark) return ark;
    }
  }
  let host = "";
  try {
    host = new URL(opts.baseUrl?.trim() || "").host.toLowerCase();
  } catch {
    host = "";
  }
  if (!host) return undefined;
  // Volcengine Ark hosts: ark.*.volces.com / *.volcengineapi.com
  if (
    host.includes("volces.com") ||
    host.includes("volcengineapi.com") ||
    host.endsWith("volcengine.com")
  ) {
    if (host.startsWith("ark.") || host.includes(".ark.") || host.includes("ark")) {
      const ark = PROVIDER_PRESETS.find((p) => p.id === "volcano-ark");
      if (ark) return ark;
    }
  }
  for (const p of PROVIDER_PRESETS) {
    try {
      if (new URL(p.baseUrl).host.toLowerCase() === host) return p;
    } catch {
      /* skip */
    }
  }
  for (const p of PROVIDER_PRESETS) {
    try {
      const ph = new URL(p.baseUrl).host.toLowerCase();
      if (host === ph || host.endsWith(`.${ph}`) || ph.endsWith(`.${host}`)) {
        return p;
      }
    } catch {
      /* skip */
    }
  }
  return undefined;
}

/** Resolve API-key signup URL for a form (by preset id or base URL host). */
export function resolveProviderApiKeyUrl(opts: {
  providerId?: string | null;
  baseUrl?: string | null;
}): string | null {
  return matchPreset(opts)?.apiKeyUrl ?? null;
}

/** Resolve brand logo key for UI avatars (null when no mark). */
export function resolveProviderBrandId(opts: {
  providerId?: string | null;
  baseUrl?: string | null;
}): ProviderBrandId | null {
  return matchPreset(opts)?.brandId ?? null;
}

/** Default efforts when creating a blank custom channel (Grok-compatible). */
export function defaultCustomChannelEfforts(): ProviderEffortEntry[] {
  return GROK_CHANNEL_EFFORTS.map((e) => ({ ...e }));
}
