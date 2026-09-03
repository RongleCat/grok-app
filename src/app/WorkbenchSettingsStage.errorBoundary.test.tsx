/**
 * @vitest-environment jsdom
 *
 * Settings render errors must stay inside the Settings stage (#1006), not
 * blank the whole React root the way an uncaught SettingsPage throw would.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

let throwOnRender = true;
let renderCount = 0;

vi.mock("@/components/SettingsPage", () => ({
  SettingsPage: () => {
    renderCount += 1;
    if (throwOnRender) {
      throw new Error("boom-settings-render");
    }
    return <div data-testid="settings-page-ok">settings ok</div>;
  },
}));

import { WorkbenchSettingsStage } from "./WorkbenchSettingsStage";

afterEach(() => {
  cleanup();
  throwOnRender = true;
  renderCount = 0;
});

beforeEach(() => {
  // React 18 logs boundary errors to console.error; keep the suite quiet.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function stageProps(overrides: Record<string, unknown> = {}) {
  const tr = (key: string) => key;
  // WorkbenchSettingsStage evaluates SettingsPage props eagerly (e.g. .size /
  // .map) before the child renders, so those values must be real even when
  // SettingsPage itself is mocked to throw.
  return new Proxy(
    {
      tr,
      settingsSection: "general",
      settingsTab: "main",
      navigateSettings: vi.fn(),
      navigateWorkbench: vi.fn(),
      mutedSessionIds: new Set<string>(),
      unreadSessionIds: new Set<string>(),
      archivedGroups: [],
      projects: [],
      sessions: [],
      availableModels: [],
      savedAccounts: [],
      wallpaperRecord: { width: 0, height: 0 },
      cliInfo: { path: "" },
      session: { sessionId: null },
      activeProject: null,
      account: null,
      ...overrides,
    } as Record<string, unknown>,
    {
      get(target, prop, receiver) {
        if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
        if (prop in target) return target[prop];
        // Most SettingsPage handlers are unused when SettingsPage is mocked.
        return vi.fn();
      },
    },
  );
}

describe("WorkbenchSettingsStage error boundary", () => {
  it("contains a SettingsPage render throw and offers Retry", () => {
    render(<WorkbenchSettingsStage {...(stageProps() as any)} />);

    expect(screen.getByTestId("settings-stage")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("ui.errorBoundary.title")).toBeInTheDocument();
    expect(
      screen.getByText("ui.errorBoundary.settingsBody"),
    ).toBeInTheDocument();
    expect(screen.getByText(/boom-settings-render/)).toBeInTheDocument();
    expect(screen.queryByTestId("settings-page-ok")).toBeNull();
  });

  it("Retry remounts Settings after a transient fault", () => {
    render(<WorkbenchSettingsStage {...(stageProps() as any)} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    throwOnRender = false;
    fireEvent.click(screen.getByRole("button", { name: "ui.errorBoundary.retry" }));

    expect(screen.getByTestId("settings-page-ok")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(renderCount).toBeGreaterThan(1);
  });

  it("navigating to another Settings route resets the boundary", () => {
    const { rerender } = render(
      <WorkbenchSettingsStage
        {...(stageProps({ settingsSection: "general", settingsTab: "main" }) as any)}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    throwOnRender = false;
    rerender(
      <WorkbenchSettingsStage
        {...(stageProps({
          settingsSection: "account",
          settingsTab: "providers",
        }) as any)}
      />,
    );

    expect(screen.getByTestId("settings-page-ok")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
