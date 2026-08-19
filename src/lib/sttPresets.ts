/**
 * Preset templates for the custom STT engine (Settings → Voice).
 *
 * The custom engine accepts any OpenAI-compatible `/audio/transcriptions`
 * endpoint. Instead of asking users to recall each vendor's Base URL + model
 * id, we ship a small catalog of common providers: picking one pre-fills the
 * Base URL and offers that provider's model ids, so only the API key (and
 * optionally the language) is left to the user. `custom` means "fill in
 * everything yourself".
 *
 * Providers are OpenAI-compatible only. xAI stays on the official engine and
 * is intentionally not listed here. ElevenLabs' Scribe API is a native
 * `POST /v1/speech-to-text` endpoint authenticated with the `xi-api-key`
 * header — it is NOT OpenAI-compatible (`/audio/transcriptions` with
 * `Authorization: Bearer`), so it cannot work through this client and is
 * intentionally not listed as a preset.
 *
 * Pure data + helpers — no I/O, so tests drive matching/apply logic directly.
 */

export type SttPresetId =
  | "local"
  | "groq"
  | "openai"
  | "mistral"
  | "custom";

export type SttProviderPreset = {
  id: Exclude<SttPresetId, "custom">;
  /** Base URL pre-filled into the Base URL field. */
  baseUrl: string;
  /** Ordered model ids for this provider; the first is the default. */
  models: readonly string[];
};

/** Ordered provider catalog (excluding the free-form `custom` option). */
export const STT_PROVIDER_PRESETS: readonly SttProviderPreset[] = [
  {
    id: "local",
    baseUrl: "http://127.0.0.1:8000/v1",
    models: ["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"],
  },
  {
    id: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: [
      "whisper-large-v3-turbo",
      "whisper-large-v3",
      "distil-whisper-large-v3-en",
    ],
  },
  {
    id: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: [
      "whisper-1",
      "gpt-4o-mini-transcribe",
      "gpt-4o-transcribe",
      "gpt-transcribe",
    ],
  },
  {
    id: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    models: ["voxtral-mini-latest", "voxtral-mini-2602"],
  },
];

/** Look up a preset by id; `null` for unknown ids (incl. `custom`). */
export function sttPresetById(id: string): SttProviderPreset | null {
  return STT_PROVIDER_PRESETS.find((p) => p.id === id) ?? null;
}

/** Approximate download sizes for the local whisper.cpp models (button copy). */
export const LOCAL_MODEL_SIZES: Record<string, string> = {
  tiny: "约 75 MB",
  base: "约 140 MB",
  small: "约 460 MB",
  medium: "约 1.5 GB",
  "large-v3": "约 3 GB",
  "large-v3-turbo": "约 1.6 GB",
};

/** GGML file name a local model id downloads to / loads from. */
export function localModelFileName(model: string): string {
  const m = model.trim();
  if (["tiny", "base", "small", "medium"].includes(m)) return `ggml-${m}.bin`;
  if (m === "large-v3") return "ggml-large-v3.bin";
  return "ggml-large-v3-turbo.bin";
}

/** The local model id actually in effect (dropdown default = first preset). */
export function effectiveLocalModel(
  selected: string | null | undefined,
): string {
  const preset = sttPresetById("local");
  const models = preset?.models ?? [];
  const s = (selected ?? "").trim();
  return s && models.includes(s) ? s : (models[0] ?? "large-v3-turbo");
}

/** Normalize a Base URL for preset matching (trim + drop trailing slash). */
export function normalizeSttBaseUrl(
  baseUrl: string | null | undefined,
): string {
  return (baseUrl ?? "").trim().replace(/\/+$/, "");
}

/**
 * Which preset a stored Base URL matches, for round-tripping the Select.
 * Only the Base URL participates — users may change the model within a
 * provider. Returns `"custom"` when nothing matches (free-form endpoint).
 */
export function matchSttPreset(baseUrl: string | null | undefined): SttPresetId {
  const normalized = normalizeSttBaseUrl(baseUrl);
  if (!normalized) return "custom";
  const hit = STT_PROVIDER_PRESETS.find(
    (p) => normalizeSttBaseUrl(p.baseUrl) === normalized,
  );
  return hit ? hit.id : "custom";
}

/**
 * Field values a preset contributes. Applying a preset always overwrites
 * Base URL + model (that is the point of a template); the API key and
 * language hint are left untouched.
 */
export function applySttPreset(id: string): {
  baseUrl: string;
  model: string;
} | null {
  const preset = sttPresetById(id);
  if (!preset) return null;
  return { baseUrl: preset.baseUrl, model: preset.models[0] };
}

/**
 * What selecting an option in the provider dropdown should do, given the
 * current Base URL.
 *
 * - Preset option → apply it (Base URL + default model).
 * - `custom` while a preset URL is in the field → drop the preset's Base URL
 *   and model so the fields genuinely become free-form (this is how the user
 *   escapes a preset). `custom` while already free-form → no-op, keep what
 *   was typed.
 */
export function resolveSttTemplateSelect(
  currentBaseUrl: string | null | undefined,
  selected: string,
): { baseUrl: string; model?: string } | null {
  if (selected === "custom") {
    return matchSttPreset(currentBaseUrl) !== "custom"
      ? { baseUrl: "", model: "" }
      : null;
  }
  return applySttPreset(selected);
}

/**
 * Language dropdown option ids for the custom STT engine. The simplified /
 * traditional Chinese split folds in the `stt_zh_script` steering — both map
 * to API language `zh`, only the Whisper `prompt` differs.
 */
export type SttLanguageOptionId = "auto" | "en" | "zh-CN" | "zh-TW";

/**
 * Map the stored (language hint, script) pair to the dropdown option.
 * A Chinese language hint or an explicit script resolves to a script option,
 * so the dropdown honestly reflects the output script. Unknown raw codes
 * (ja, ko, …) are returned as-is and stay selectable as legacy options.
 */
export function resolveSttLanguageOption(
  language: string | null | undefined,
  script: string | null | undefined,
): string {
  const lang = (language ?? "").trim().toLowerCase();
  const scr = (script ?? "auto").trim().toLowerCase();
  const isZh =
    lang.startsWith("zh") || lang === "chinese" || lang === "cmn";
  const scriptTraditional =
    scr === "traditional" || lang.includes("tw") || lang.includes("hant");
  if (lang === "en") return "en";
  if (isZh || scr === "simplified" || scr === "traditional") {
    return scriptTraditional ? "zh-TW" : "zh-CN";
  }
  if (!lang) return "auto";
  return lang;
}

/**
 * Field values a language dropdown option contributes: the STT language hint
 * plus the Chinese script steering (简体/繁体). The `auto` option sends no
 * language hint and lets the script follow the app UI locale.
 */
export function applySttLanguageOption(id: string): {
  language: string;
  script: string;
} {
  switch (id) {
    case "en":
      return { language: "en", script: "auto" };
    case "zh-CN":
      return { language: "zh", script: "simplified" };
    case "zh-TW":
      return { language: "zh", script: "traditional" };
    case "auto":
      return { language: "", script: "auto" };
    default:
      // Legacy raw language codes (ja, ko, …) keep working, no script steering.
      return { language: id, script: "auto" };
  }
}
