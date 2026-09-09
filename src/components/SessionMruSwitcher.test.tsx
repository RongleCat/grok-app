/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import "@/test/jsdomStubs";
import { cleanup, render, screen } from "@testing-library/react";
import { SessionMruSwitcher } from "./SessionMruSwitcher";
import { setSessionMruPanelState } from "@/lib/sessionMruPanelStore";

afterEach(() => {
  cleanup();
  setSessionMruPanelState(null);
});

describe("SessionMruSwitcher", () => {
  it("renders nothing when idle", () => {
    render(<SessionMruSwitcher locale="en" />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("lists chats and marks the highlighted row", () => {
    setSessionMruPanelState({
      index: 1,
      rows: [
        { id: "b", title: "Beta", projectName: "App" },
        { id: "a", title: "Alpha", projectName: "" },
      ],
    });
    render(<SessionMruSwitcher locale="en" />);
    expect(
      screen.getByRole("listbox", { name: "Recently used chats" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Release Ctrl to open")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Beta/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("option", { name: /Alpha/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("App")).toBeInTheDocument();
  });
});
