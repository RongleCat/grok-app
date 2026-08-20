import { describe, expect, it } from "vitest";
import {
  SETTINGS_NESTED_ESCAPE_SELECTOR,
  isSettingsEscapeOwnedByNestedLayer,
  shouldEscapeCloseSettings,
  shouldEscapeStopGeneration,
  type EscapeStopOpts,
} from "./escapeStop";

const free: EscapeStopOpts = {
  streamingOrBusy: true,
  overlayOpen: false,
  permOpen: false,
  askUserOpen: false,
  chatFindOpen: false,
  slashOrMenuOpen: false,
  promptHistoryOpen: false,
  voiceStealsEscape: false,
};

describe("shouldEscapeStopGeneration", () => {
  it("stops when streaming and nothing owns Escape", () => {
    expect(shouldEscapeStopGeneration(free)).toBe(true);
  });

  it("does not stop when idle / not busy", () => {
    expect(
      shouldEscapeStopGeneration({ ...free, streamingOrBusy: false }),
    ).toBe(false);
  });

  it("defers to voice dictation", () => {
    expect(
      shouldEscapeStopGeneration({ ...free, voiceStealsEscape: true }),
    ).toBe(false);
  });

  it("defers to overlays (search, dialog, doctor, shortcuts, export)", () => {
    expect(shouldEscapeStopGeneration({ ...free, overlayOpen: true })).toBe(
      false,
    );
  });

  it("defers to permission bar (Esc → deny)", () => {
    expect(shouldEscapeStopGeneration({ ...free, permOpen: true })).toBe(
      false,
    );
  });

  it("defers to ask-user modal", () => {
    expect(shouldEscapeStopGeneration({ ...free, askUserOpen: true })).toBe(
      false,
    );
  });

  it("defers to chat find", () => {
    expect(shouldEscapeStopGeneration({ ...free, chatFindOpen: true })).toBe(
      false,
    );
  });

  it("defers to slash / composer menus", () => {
    expect(
      shouldEscapeStopGeneration({ ...free, slashOrMenuOpen: true }),
    ).toBe(false);
  });

  it("defers to prompt history picker", () => {
    expect(
      shouldEscapeStopGeneration({ ...free, promptHistoryOpen: true }),
    ).toBe(false);
  });

  it("treats missing optional flags as not open", () => {
    expect(
      shouldEscapeStopGeneration({
        streamingOrBusy: true,
        overlayOpen: false,
        permOpen: false,
        askUserOpen: false,
        chatFindOpen: false,
        slashOrMenuOpen: false,
      }),
    ).toBe(true);
  });

  it("does not stop while Settings is open (Esc leaves settings)", () => {
    expect(
      shouldEscapeStopGeneration({ ...free, settingsOpen: true }),
    ).toBe(false);
  });
});

const settingsFree = {
  settingsOpen: true,
  overlayOpen: false,
  permOpen: false,
  askUserOpen: false,
  chatFindOpen: false,
  slashOrMenuOpen: false,
  promptHistoryOpen: false,
  voiceStealsEscape: false,
  nestedLayerOpen: false,
};

describe("shouldEscapeCloseSettings", () => {
  it("closes settings when the page is open and nothing else owns Escape", () => {
    expect(shouldEscapeCloseSettings(settingsFree)).toBe(true);
  });

  it("does not close when settings are not open", () => {
    expect(
      shouldEscapeCloseSettings({ ...settingsFree, settingsOpen: false }),
    ).toBe(false);
  });

  it("defers to voice, overlays, menus, and nested dialogs / selects", () => {
    expect(
      shouldEscapeCloseSettings({ ...settingsFree, voiceStealsEscape: true }),
    ).toBe(false);
    expect(
      shouldEscapeCloseSettings({ ...settingsFree, overlayOpen: true }),
    ).toBe(false);
    expect(
      shouldEscapeCloseSettings({ ...settingsFree, permOpen: true }),
    ).toBe(false);
    expect(
      shouldEscapeCloseSettings({ ...settingsFree, askUserOpen: true }),
    ).toBe(false);
    expect(
      shouldEscapeCloseSettings({ ...settingsFree, chatFindOpen: true }),
    ).toBe(false);
    expect(
      shouldEscapeCloseSettings({ ...settingsFree, slashOrMenuOpen: true }),
    ).toBe(false);
    expect(
      shouldEscapeCloseSettings({ ...settingsFree, promptHistoryOpen: true }),
    ).toBe(false);
    expect(
      shouldEscapeCloseSettings({ ...settingsFree, nestedLayerOpen: true }),
    ).toBe(false);
  });
});

describe("isSettingsEscapeOwnedByNestedLayer", () => {
  it("is false for missing roots or no matching node", () => {
    expect(isSettingsEscapeOwnedByNestedLayer(null)).toBe(false);
    expect(
      isSettingsEscapeOwnedByNestedLayer({
        querySelector: () => null,
      } as unknown as ParentNode),
    ).toBe(false);
  });

  it("is true when querySelector finds a nested layer", () => {
    const seen: string[] = [];
    expect(
      isSettingsEscapeOwnedByNestedLayer({
        querySelector: (sel: string) => {
          seen.push(sel);
          return {} as Element;
        },
      } as unknown as ParentNode),
    ).toBe(true);
    expect(seen).toEqual([SETTINGS_NESTED_ESCAPE_SELECTOR]);
    expect(SETTINGS_NESTED_ESCAPE_SELECTOR).toContain(".overlay .modal");
    expect(SETTINGS_NESTED_ESCAPE_SELECTOR).toContain(".c-select__menu");
  });
});
