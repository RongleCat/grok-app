/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  forgetFleetAutoOpen,
  setBackgroundTasksOpen,
  setFleetChatContext,
} from "@/lib/backgroundTasksStore";
import { BackgroundTasksToggle } from "./BackgroundTasksToggle";

afterEach(() => {
  cleanup();
  forgetFleetAutoOpen();
  setFleetChatContext("chat", false);
  setBackgroundTasksOpen(false);
  setFleetChatContext(null, false);
});

describe("BackgroundTasksToggle", () => {
  it("sits in the title-bar chrome and opens or closes the pane", () => {
    setFleetChatContext("chat", false);
    render(<BackgroundTasksToggle locale="en" />);
    const button = screen.getByTestId("background-tasks-toggle");
    expect(button.className).toContain("chrome-btn");
    expect(button.className).toContain("main__pane-toggle");
    expect(button.getAttribute("aria-label")).toBe("Show background tasks");
    expect(button.getAttribute("aria-controls")).toBe("chat-fleet-pane");
    expect(button.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(button);
    const open = screen.getByTestId("background-tasks-toggle");
    expect(open.getAttribute("aria-label")).toBe("Hide background tasks");
    expect(open.className).toContain("is-on");

    fireEvent.click(open);
    expect(screen.getByTestId("background-tasks-toggle").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});
