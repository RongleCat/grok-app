/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsModelProvider } from "@/providers/SettingsModelContext";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import type { SettingsViewModel } from "./types";

function buildModel(overrides: Partial<SettingsViewModel> = {}): SettingsViewModel {
  const base = {
    t: (k: string) => k,
    title: "Settings",
    activeTab: "interface",
    setSectionTab: vi.fn(),
    rowHighlight: () => "",
    sectionNav: {
      id: "appearance",
      icon: "appearance",
      labelKey: "settings.nav.appearance",
      group: "personal",
      tabs: [
        { id: "theme", labelKey: "settings.tab.theme" },
        { id: "interface", labelKey: "settings.tab.interface" },
      ],
    },
    composerEditor: "legacy",
    onComposerEditor: vi.fn(),
    zenMode: false,
    onZenMode: vi.fn(),
    welcomeMotionEnabled: true,
    onWelcomeMotionEnabled: vi.fn(),
    chatDensity: "comfortable",
    onChatDensity: vi.fn(),
    chatWidth: "medium",
    onChatWidth: vi.fn(),
    msgRailSide: "right",
    onMsgRailSide: vi.fn(),
    sidebarDensity: "comfortable",
    onSidebarDensity: vi.fn(),
    uiFontFamily: "",
    onUiFontFamily: vi.fn(),
    onResetUiFont: vi.fn(),
    terminalFontFamily: "",
    terminalFontSize: 13,
    onTerminalFontFamily: vi.fn(),
    onTerminalFontSize: vi.fn(),
    onResetTerminalFont: vi.fn(),
    chatFontScale: "md",
    onChatFontScale: vi.fn(),
    codeFontScale: "md",
    onCodeFontScale: vi.fn(),
    thinkingExpand: "auto-collapse",
    setThinkingExpand: vi.fn(),
    toolStepsAutoCollapse: true,
    setToolStepsAutoCollapse: vi.fn(),
    chatVirtualScroll: false,
    setChatVirtualScroll: vi.fn(),
    filePathCardBasename: true,
    setFilePathCardBasename: vi.fn(),
    transcriptFilter: "all",
    setTranscriptFilter: vi.fn(),
    messageActionsVisibility: "hover",
    onMessageActionsVisibility: vi.fn(),
    codeWrapDefault: false,
    setCodeWrapDefault: vi.fn(),
    codeLineNumbers: false,
    setCodeLineNumbers: vi.fn(),
    showReplyLength: false,
    onShowReplyLength: vi.fn(),
    backBottomAlways: false,
    setBackBottomAlways: vi.fn(),
    selectionToolbar: true,
    setSelectionToolbar: vi.fn(),
    showMessageTimestamps: true,
    onShowMessageTimestamps: vi.fn(),
    messageTimeFormat: "absolute",
    onMessageTimeFormat: vi.fn(),
    sidebarShowRelativeTime: true,
    onSidebarShowRelativeTime: vi.fn(),
    sessionSearchRank: "keyword",
    setSessionSearchRank: vi.fn(),
    confirmExternalLinks: true,
    setConfirmExternalLinks: vi.fn(),
    goalOrchUiEnabled: true,
    onGoalOrchUiEnabled: vi.fn(),
    replaceProviderBrandLogo: false,
    onReplaceProviderBrandLogo: vi.fn(),
    exportLogo: null,
    exportLogoInputRef: { current: null },
    onExportLogoFile: vi.fn(),
    onClearExportLogo: vi.fn(),
    mutedSessionCount: 0,
    unreadSessionCount: 0,
    onClearAllSessionMutes: vi.fn(),
    onClearAllSessionUnread: vi.fn(),
  };
  return { ...base, ...overrides } as unknown as SettingsViewModel;
}

function renderSection(model: SettingsViewModel) {
  return render(
    <SettingsModelProvider value={model}>
      <AppearanceSection />
    </SettingsModelProvider>,
  );
}

afterEach(cleanup);

describe("AppearanceSection output motion", () => {
  it("renders the row next to welcome motion and turns the pref off", () => {
    const onOutputMotionEnabled = vi.fn();
    renderSection(
      buildModel({ outputMotionEnabled: true, onOutputMotionEnabled }),
    );

    const row = document.getElementById("settings-anchor-outputMotion");
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("settings.outputMotion");

    const check = screen.getByRole("checkbox", {
      name: "settings.outputMotion",
    });
    expect(check.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(check);
    expect(onOutputMotionEnabled).toHaveBeenCalledWith(false);
  });

  it("reflects the disabled pref", () => {
    renderSection(
      buildModel({ outputMotionEnabled: false, onOutputMotionEnabled: vi.fn() }),
    );

    const check = screen.getByRole("checkbox", {
      name: "settings.outputMotion",
    });
    expect(check.getAttribute("aria-checked")).toBe("false");
  });
});
