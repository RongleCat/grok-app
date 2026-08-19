import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { SettingsModelProvider } from "@/providers/SettingsModelContext";
import { GeneralSection } from "@/components/settings/GeneralSection";
import type { SettingsViewModel } from "./types";

function buildModel(overrides: Partial<SettingsViewModel> = {}): SettingsViewModel {
  const base = {
    t: (k: string) => k,
    title: "Settings",
    activeTab: "app",
    setSectionTab: vi.fn(),
    rowHighlight: () => "",
    sectionNav: {
      id: "general",
      icon: "settings",
      labelKey: "settings.section.general",
      group: "personal",
      tabs: [{ id: "app", labelKey: "settings.section.general" }],
    },
    voiceId: "eve",
    onVoiceId: vi.fn(),
    voiceDictationAutoSend: false,
    onVoiceDictationAutoSend: vi.fn(),
    voiceKeepAgentsOnEnd: true,
    onVoiceKeepAgentsOnEnd: vi.fn(),
    voiceHotkeyEnabled: true,
    setVoiceHotkeyEnabled: vi.fn(),
    notifyQuietHours: { enabled: false },
    onNotifyQuietHours: vi.fn(),
    sttEngine: "official",
    onSttEngine: vi.fn(),
    sttCustomBaseUrl: "",
    onSttCustomBaseUrl: vi.fn(),
    sttCustomModel: "",
    onSttCustomModel: vi.fn(),
    sttCustomLanguage: "",
    onSttCustomLanguage: vi.fn(),
    sttZhScript: "auto",
    onSttZhScript: vi.fn(),
    sttCustomProvider: "custom",
    onSttCustomProvider: vi.fn(),
  };
  return { ...base, ...overrides } as unknown as SettingsViewModel;
}

function renderSection(model: SettingsViewModel): string {
  return renderToString(
    <SettingsModelProvider value={model}>
      <GeneralSection />
    </SettingsModelProvider>,
  );
}

describe("GeneralSection voice — custom STT", () => {
  it("shows the engine selector in the voice card", () => {
    const html = renderSection(buildModel());
    expect(html).toContain("settings.sttEngine");
    expect(html).toContain("settings.sttEngineOfficial");
  });

  it("hides custom fields unless the custom engine is selected", () => {
    const html = renderSection(buildModel({ sttEngine: "official" }));
    expect(html).not.toContain("settings.sttCustomBaseUrlPlaceholder");
  });

  it("renders custom endpoint fields when the custom engine is selected", () => {
    const html = renderSection(
      buildModel({
        sttEngine: "custom",
        sttCustomBaseUrl: "https://api.example.com/v1",
        sttCustomModel: "my-model",
        sttCustomLanguage: "zh",
      }),
    );
    // Free-form endpoint → every field is an editable input.
    expect(html).toContain("settings.sttCustomBaseUrlPlaceholder");
    expect(html).toContain("settings.sttCustomApiKeyPlaceholder");
    expect(html).toContain("settings.sttCustomModelPlaceholder");
    expect(html).toContain("api.example.com/v1");
    expect(html).toContain('value="my-model"');
    // zh + auto script → Simplified Chinese language option.
    expect(html).toContain('c-select__value">settings.sttLanguage.zhCN');
  });

  it("key field ships a show/hide reveal button (same as provider keys)", () => {
    const html = renderSection(buildModel({ sttEngine: "custom" }));
    // Default state is hidden → the reveal button offers "show" (shared label
    // with the big-model key rows in the Providers panel).
    expect(html).toContain("prov.keyShow");
    expect(html).toContain('type="password"');
  });

  it("shows provider templates with the matching preset selected", () => {
    const html = renderSection(
      buildModel({
        sttEngine: "custom",
        sttCustomBaseUrl: "https://api.groq.com/openai/v1",
        sttCustomModel: "whisper-large-v3-turbo",
      }),
    );
    // Compact inline label + template select; no prose blocks.
    expect(html).toContain("settings.sttProvider");
    expect(html).not.toContain("settings.sttProviderDesc");
    // The stored base URL round-trips to the Groq preset (selected label).
    expect(html).toContain('c-select__value">settings.sttProvider.groq');
    // A preset provider turns the model field into a model dropdown.
    expect(html).toContain('c-select__value">whisper-large-v3-turbo');
    expect(html).not.toContain("settings.sttCustomModelPlaceholder");
  });

  it("preset model dropdown keeps a stored custom model visible", () => {
    const html = renderSection(
      buildModel({
        sttEngine: "custom",
        sttCustomBaseUrl: "https://api.openai.com/v1",
        sttCustomModel: "some-custom-model",
      }),
    );
    expect(html).toContain('c-select__value">settings.sttProvider.openai');
    // Stored model is not in the OpenAI list — keep it as the selected option.
    expect(html).toContain('c-select__value">some-custom-model');
  });

  it("preset model dropdown uses the provider default when no model set", () => {
    const html = renderSection(
      buildModel({
        sttEngine: "custom",
        sttCustomBaseUrl: "https://api.mistral.ai/v1",
      }),
    );
    expect(html).toContain('c-select__value">settings.sttProvider.mistral');
    expect(html).toContain('c-select__value">voxtral-mini-latest');
  });

  it("falls back to the custom template when the base URL matches nothing", () => {
    const html = renderSection(
      buildModel({
        sttEngine: "custom",
        sttCustomBaseUrl: "https://api.example.com/v1",
      }),
    );
    expect(html).toContain('c-select__value">settings.sttProvider.custom');
    // Custom template keeps the free-text model input.
    expect(html).toContain("settings.sttCustomModelPlaceholder");
  });

  it("hides the provider templates unless the custom engine is selected", () => {
    const html = renderSection(buildModel({ sttEngine: "official" }));
    expect(html).not.toContain("settings.sttProvider");
    expect(html).not.toContain("settings.sttLanguage.en");
  });

  it("language dropdown defaults to auto when nothing is stored", () => {
    const html = renderSection(buildModel({ sttEngine: "custom" }));
    expect(html).toContain('c-select__value">settings.sttLanguage.auto');
  });

  it("language dropdown reflects stored English", () => {
    const html = renderSection(
      buildModel({ sttEngine: "custom", sttCustomLanguage: "en" }),
    );
    expect(html).toContain('c-select__value">settings.sttLanguage.en');
  });

  it("language dropdown folds the script choice into 简体/繁體", () => {
    const simplified = renderSection(
      buildModel({
        sttEngine: "custom",
        sttCustomLanguage: "zh",
        sttZhScript: "simplified",
      }),
    );
    expect(simplified).toContain('c-select__value">settings.sttLanguage.zhCN');

    const traditional = renderSection(
      buildModel({ sttEngine: "custom", sttZhScript: "traditional" }),
    );
    expect(traditional).toContain('c-select__value">settings.sttLanguage.zhTW');
  });
});
