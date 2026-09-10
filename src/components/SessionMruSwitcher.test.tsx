/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import "@/test/jsdomStubs";
import { cleanup, render, screen, within } from "@testing-library/react";
import { SessionMruSwitcher } from "./SessionMruSwitcher";
import { sessionLiveMapStore } from "@/lib/sessionLiveMapStore";
import { setSessionMruPanelState } from "@/lib/sessionMruPanelStore";
import { projectHostIntoLiveMap } from "@/lib/sessionLiveStore";

afterEach(() => {
  cleanup();
  setSessionMruPanelState(null);
  sessionLiveMapStore.resetForTests();
});

function showPanel() {
  setSessionMruPanelState({
    index: 1,
    rows: [
      { id: "b", title: "Beta", projectName: "App" },
      { id: "a", title: "Alpha", projectName: "" },
    ],
  });
}

describe("SessionMruSwitcher", () => {
  it("renders nothing when idle", () => {
    render(<SessionMruSwitcher locale="en" />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("lists chats and marks the highlighted row", () => {
    showPanel();
    render(<SessionMruSwitcher locale="en" />);
    expect(
      screen.getByRole("listbox", { name: "Recently used chats" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Release Ctrl to open")).toBeInTheDocument();
    const beta = screen.getByRole("option", { name: /Beta/ });
    const alpha = screen.getByRole("option", { name: /Alpha/ });
    expect(beta).toHaveAttribute("aria-selected", "false");
    expect(beta).not.toHaveClass("is-active");
    expect(alpha).toHaveAttribute("aria-selected", "true");
    expect(alpha).toHaveClass("is-active");
    expect(screen.getByText("App")).toBeInTheDocument();
  });

  it("shows the sidebar working spinner for a busy chat", () => {
    sessionLiveMapStore.setMap((prev) =>
      projectHostIntoLiveMap(prev, {
        sessionId: "a",
        state: "streaming",
      }),
    );
    showPanel();
    render(<SessionMruSwitcher locale="en" />);
    expect(
      within(screen.getByRole("option", { name: /Alpha/ })).getByLabelText(
        "Working…",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("option", { name: /Beta/ })).queryByLabelText(
        "Working…",
      ),
    ).not.toBeInTheDocument();
  });
});
