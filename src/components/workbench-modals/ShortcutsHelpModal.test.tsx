/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import "@/test/jsdomStubs";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShortcutsHelpModal } from "./ShortcutsHelpModal";

afterEach(cleanup);

function renderHelp(
  over: Partial<Parameters<typeof ShortcutsHelpModal>[0]> = {},
) {
  const onClose = vi.fn();
  render(
    <ShortcutsHelpModal
      locale="en"
      open
      platform="win"
      composerSendKeyPref="enter"
      shortcutRemaps={{}}
      voiceHotkeyEnabled
      onClose={onClose}
      {...over}
    />,
  );
  return { onClose };
}

describe("ShortcutsHelpModal", () => {
  it("lists catalog groups including zoom and composer rows", async () => {
    renderHelp();
    expect(
      await screen.findByRole("heading", { name: "Keyboard shortcuts" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Workbench" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "View" })).toBeInTheDocument();
    expect(screen.getByText("Zoom in")).toBeInTheDocument();
    expect(screen.getByText("New line")).toBeInTheDocument();
    expect(screen.getByText("Previous / next prompt")).toBeInTheDocument();
    expect(screen.getByText("Type to focus composer")).toBeInTheDocument();
    expect(screen.getByText("Ctrl +")).toBeInTheDocument();
    expect(screen.getByText("Shift Enter")).toBeInTheDocument();
  });

  it("filters by label and shows an empty state", async () => {
    const user = userEvent.setup();
    renderHelp();
    const filter = await screen.findByRole("searchbox");
    await user.type(filter, "doctor");
    expect(screen.getByText("Doctor")).toBeInTheDocument();
    expect(screen.queryByText("Zoom in")).not.toBeInTheDocument();
    await user.clear(filter);
    await user.type(filter, "no-such-shortcut-xyz");
    expect(
      screen.getByText("No shortcuts match this filter."),
    ).toBeInTheDocument();
  });

  it("focuses the filter when opened", async () => {
    renderHelp();
    const filter = await screen.findByRole("searchbox");
    await waitFor(() => expect(filter).toHaveFocus());
  });

  it("patches newline from the send-key preference", async () => {
    renderHelp({ composerSendKeyPref: "mod-enter" });
    expect(await screen.findByText("New line")).toBeInTheDocument();
    const row = screen.getByText("New line").closest("li");
    expect(row).toHaveTextContent("Enter");
  });
});
