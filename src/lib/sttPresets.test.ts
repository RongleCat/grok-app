import { describe, expect, it } from "vitest";
import {
  applySttLanguageOption,
  applySttPreset,
  matchSttPreset,
  normalizeSttBaseUrl,
  resolveSttLanguageOption,
  resolveSttTemplateSelect,
  STT_PROVIDER_PRESETS,
  sttPresetById,
} from "./sttPresets";

describe("sttPresets", () => {
  it("catalog order is Local → Groq → OpenAI → Mistral", () => {
    const ids = STT_PROVIDER_PRESETS.map((p) => p.id);
    expect(ids).toEqual(["local", "groq", "openai", "mistral"]);
  });

  it("each provider ships its model list (first = default)", () => {
    expect(sttPresetById("local")?.models).toEqual([
      "tiny",
      "base",
      "small",
      "medium",
      "large-v3",
      "large-v3-turbo",
    ]);
    expect(sttPresetById("groq")?.models).toEqual([
      "whisper-large-v3-turbo",
      "whisper-large-v3",
      "distil-whisper-large-v3-en",
    ]);
    expect(sttPresetById("openai")?.models).toEqual([
      "whisper-1",
      "gpt-4o-mini-transcribe",
      "gpt-4o-transcribe",
      "gpt-transcribe",
    ]);
    expect(sttPresetById("mistral")?.models).toEqual([
      "voxtral-mini-latest",
      "voxtral-mini-2602",
    ]);
    // ElevenLabs' Scribe API is not OpenAI-compatible (native
    // /v1/speech-to-text + xi-api-key header) — intentionally no preset.
    expect(sttPresetById("elevenlabs")).toBeNull();
  });

  it("presetById returns null for custom/unknown ids", () => {
    expect(sttPresetById("custom")).toBeNull();
    expect(sttPresetById("nope")).toBeNull();
    // xAI is intentionally not a preset (official engine covers it).
    expect(sttPresetById("xai")).toBeNull();
  });

  it("matches stored base URLs to presets", () => {
    expect(matchSttPreset("http://127.0.0.1:8000/v1")).toBe("local");
    expect(matchSttPreset("https://api.groq.com/openai/v1")).toBe("groq");
    expect(matchSttPreset("https://api.openai.com/v1")).toBe("openai");
    expect(matchSttPreset("https://api.mistral.ai/v1")).toBe("mistral");
    expect(matchSttPreset("https://api.elevenlabs.io/v1")).toBe("custom");
  });

  it("matching ignores trailing slashes and whitespace", () => {
    expect(matchSttPreset("  http://127.0.0.1:8000/v1/  ")).toBe("local");
  });

  it("unknown or empty base URLs resolve to custom", () => {
    expect(matchSttPreset("")).toBe("custom");
    expect(matchSttPreset(null)).toBe("custom");
    expect(matchSttPreset(undefined)).toBe("custom");
    expect(matchSttPreset("https://api.example.com/v1")).toBe("custom");
  });

  it("applySttPreset fills base URL + default model for known presets", () => {
    expect(applySttPreset("local")).toEqual({
      baseUrl: "http://127.0.0.1:8000/v1",
      model: "tiny",
    });
    expect(applySttPreset("groq")).toEqual({
      baseUrl: "https://api.groq.com/openai/v1",
      model: "whisper-large-v3-turbo",
    });
    expect(applySttPreset("openai")).toEqual({
      baseUrl: "https://api.openai.com/v1",
      model: "whisper-1",
    });
    expect(applySttPreset("mistral")).toEqual({
      baseUrl: "https://api.mistral.ai/v1",
      model: "voxtral-mini-latest",
    });
  });

  it("applySttPreset returns null for custom/unknown ids", () => {
    expect(applySttPreset("custom")).toBeNull();
    expect(applySttPreset("")).toBeNull();
  });

  it("template select applies a chosen preset", () => {
    expect(resolveSttTemplateSelect("", "groq")).toEqual({
      baseUrl: "https://api.groq.com/openai/v1",
      model: "whisper-large-v3-turbo",
    });
    expect(resolveSttTemplateSelect("https://api.openai.com/v1", "mistral"))
      .toEqual({
        baseUrl: "https://api.mistral.ai/v1",
        model: "voxtral-mini-latest",
      });
  });

  it("selecting custom while a preset is active drops the preset base URL and model", () => {
    expect(
      resolveSttTemplateSelect("https://api.groq.com/openai/v1", "custom"),
    ).toEqual({ baseUrl: "", model: "" });
  });

  it("selecting custom while already free-form keeps the typed URL", () => {
    expect(
      resolveSttTemplateSelect("https://api.example.com/v1", "custom"),
    ).toBeNull();
    expect(resolveSttTemplateSelect("", "custom")).toBeNull();
  });

  it("template select returns null for unknown ids", () => {
    expect(resolveSttTemplateSelect("", "nope")).toBeNull();
  });

  it("normalizeSttBaseUrl trims and strips trailing slashes", () => {
    expect(normalizeSttBaseUrl(" https://x.ai/v1/ ")).toBe("https://x.ai/v1");
    expect(normalizeSttBaseUrl("")).toBe("");
    expect(normalizeSttBaseUrl(undefined)).toBe("");
  });
});

describe("sttPresets language options", () => {
  it("resolves stored language + script to a dropdown option", () => {
    expect(resolveSttLanguageOption("", "auto")).toBe("auto");
    expect(resolveSttLanguageOption("en", "auto")).toBe("en");
    expect(resolveSttLanguageOption("zh", "auto")).toBe("zh-CN");
    expect(resolveSttLanguageOption("zh", "simplified")).toBe("zh-CN");
    expect(resolveSttLanguageOption("zh", "traditional")).toBe("zh-TW");
    // zh-TW / zh-Hant hints imply traditional even without an explicit script.
    expect(resolveSttLanguageOption("zh-TW", "auto")).toBe("zh-TW");
    expect(resolveSttLanguageOption("zh-Hant", "auto")).toBe("zh-TW");
    // An explicit script steers the option even without a language hint.
    expect(resolveSttLanguageOption("", "traditional")).toBe("zh-TW");
    expect(resolveSttLanguageOption("", "simplified")).toBe("zh-CN");
  });

  it("unknown raw language codes stay selectable as legacy options", () => {
    expect(resolveSttLanguageOption("ja", "auto")).toBe("ja");
    expect(resolveSttLanguageOption("ko", "auto")).toBe("ko");
  });

  it("applies a dropdown option to language + script", () => {
    expect(applySttLanguageOption("auto")).toEqual({
      language: "",
      script: "auto",
    });
    expect(applySttLanguageOption("en")).toEqual({
      language: "en",
      script: "auto",
    });
    expect(applySttLanguageOption("zh-CN")).toEqual({
      language: "zh",
      script: "simplified",
    });
    expect(applySttLanguageOption("zh-TW")).toEqual({
      language: "zh",
      script: "traditional",
    });
    // Legacy raw codes keep working without script steering.
    expect(applySttLanguageOption("ja")).toEqual({
      language: "ja",
      script: "auto",
    });
  });

  it("round-trips through apply + resolve", () => {
    for (const id of ["auto", "en", "zh-CN", "zh-TW"]) {
      const applied = applySttLanguageOption(id);
      expect(resolveSttLanguageOption(applied.language, applied.script)).toBe(
        id,
      );
    }
  });
});
