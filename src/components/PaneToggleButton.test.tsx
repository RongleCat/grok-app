/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaneToggleButton } from "./PaneToggleButton";

afterEach(cleanup);

const base = {
  side: "left" as const,
  open: false,
  unread: false,
  label: "Show sidebar",
  unreadLabel: "New activity",
  onToggle: () => {},
};

describe("PaneToggleButton", () => {
  it("is pinned by default and wires the controlled pane", () => {
    render(<PaneToggleButton {...base} controlsId="pane-x" testId="toggle" />);
    const button = screen.getByTestId("toggle");
    expect(button.className).toContain("pane-toggle--pinned");
    expect(button.className).toContain("pane-toggle--left");
    expect(button.getAttribute("aria-controls")).toBe("pane-x");
  });

  it("shows unread only while closed and keeps it in the accessible label", () => {
    const { rerender } = render(
      <PaneToggleButton {...base} unread testId="toggle" />,
    );
    const button = () => screen.getByTestId("toggle");
    expect(button().querySelector(".pane-toggle__dot")).not.toBeNull();
    expect(button().getAttribute("aria-label")).toBe(
      "Show sidebar · New activity",
    );

    rerender(<PaneToggleButton {...base} unread open testId="toggle" />);
    expect(button().querySelector(".pane-toggle__dot")).toBeNull();
    expect(button().getAttribute("aria-expanded")).toBe("true");
  });

  it("supports the in-flow phone variant and delegates the toggle", () => {
    const onToggle = vi.fn();
    render(
      <PaneToggleButton
        {...base}
        pinned={false}
        onToggle={onToggle}
        icon={<svg data-testid="custom-icon" />}
        testId="toggle"
      />,
    );
    const button = screen.getByTestId("toggle");
    expect(button.className).not.toContain("pane-toggle--pinned");
    expect(screen.getByTestId("custom-icon")).toBeTruthy();
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});

describe("pinned pane-toggle CSS contract", () => {
  const css = readFileSync(
    resolve(__dirname, "../styles/chat.part6.css"),
    "utf8",
  );

  it("keeps desktop buttons outside pane layout at fixed corners", () => {
    expect(css).toMatch(
      /\.pane-toggle--pinned\s*\{[^}]*position:\s*absolute[^}]*z-index:\s*45/s,
    );
    expect(css).toMatch(
      /\.platform-mac \.pane-toggle--left\.pane-toggle--pinned\s*\{[^}]*left:\s*var\(--titlebar-safe-left, 96px\)/s,
    );
    expect(css).toMatch(
      /\.pane-toggle--right\.pane-toggle--pinned\s*\{[^}]*right:\s*12px/s,
    );
  });

  it("draws the unread dot from theme tokens without intercepting input", () => {
    const dot = css.slice(css.indexOf(".pane-toggle__dot"));
    expect(dot).toMatch(/background:\s*var\(--accent/);
    expect(dot).toMatch(/pointer-events:\s*none/);
  });
});
