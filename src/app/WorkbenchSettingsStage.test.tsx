/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkbenchSettingsStage } from "./WorkbenchSettingsStage";

const settingsPage = vi.hoisted(() => ({ shouldThrow: true }));

vi.mock("@/components/SettingsPage", () => ({
  SettingsPage: () => {
    if (settingsPage.shouldThrow) {
      throw new Error("transient settings render failure");
    }
    return <div>settings content</div>;
  },
}));

function tr(key: string): string {
  const messages: Record<string, string> = {
    "ui.errorBoundary.title": "This view hit a display error",
    "ui.errorBoundary.settingsBody":
      "Settings failed to render. Your saved settings are unchanged — retry or return to the workbench.",
    "ui.errorBoundary.retry": "Retry",
  };
  return messages[key] ?? key;
}

afterEach(() => {
  cleanup();
  settingsPage.shouldThrow = true;
  vi.restoreAllMocks();
});

describe("WorkbenchSettingsStage", () => {
  it("keeps Settings recoverable when a child render fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <WorkbenchSettingsStage
        tr={tr}
        settingsSection="remote_im"
        settingsTab="im"
        mutedSessionIds={new Set()}
        unreadSessionIds={new Set()}
        sessions={[]}
        projects={[]}
        session={{}}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This view hit a display error",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "transient settings render failure",
    );

    settingsPage.shouldThrow = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByText("settings content")).toBeInTheDocument();
  });

  it("resets a caught error when Settings navigates to another route", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const requiredProps = {
      tr,
      mutedSessionIds: new Set<string>(),
      unreadSessionIds: new Set<string>(),
      sessions: [],
      projects: [],
      session: {},
    };
    const { rerender } = render(
      <WorkbenchSettingsStage
        {...requiredProps}
        settingsSection="remote_im"
        settingsTab="im"
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    settingsPage.shouldThrow = false;
    rerender(
      <WorkbenchSettingsStage
        {...requiredProps}
        settingsSection="runtime"
        settingsTab="cli"
      />,
    );

    expect(await screen.findByText("settings content")).toBeInTheDocument();
  });
});
