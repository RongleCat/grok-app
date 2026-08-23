/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedControl } from "./SegmentedControl";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SegmentedControl", () => {
  it("keeps radio semantics and reports numeric values", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value={2}
        ariaLabel="Rows"
        options={[
          { value: 1, label: "One" },
          { value: 2, label: "Two", testId: "two" },
        ]}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("radiogroup", { name: "Rows" })).toBeInTheDocument();
    expect(screen.getByTestId("two")).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "One" }));
    expect(onChange).toHaveBeenCalledWith(1, expect.anything());
  });

  it("supports tab semantics and disabled options", () => {
    render(
      <SegmentedControl
        value="current"
        role="tablist"
        options={[
          { value: "current", label: "Current" },
          { value: "recent", label: "Recent", disabled: true },
        ]}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByRole("tab", { name: "Current" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Recent" })).toBeDisabled();
  });

  it("uses roving focus and keyboard selection while skipping disabled options", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SegmentedControl
        value="current"
        role="tablist"
        options={[
          { value: "first", label: "First" },
          { value: "current", label: "Current" },
          { value: "disabled", label: "Disabled", disabled: true },
          { value: "last", label: "Last" },
        ]}
        onChange={onChange}
      />,
    );

    const current = screen.getByRole("tab", { name: "Current" });
    const last = screen.getByRole("tab", { name: "Last" });
    const first = screen.getByRole("tab", { name: "First" });
    expect(current).toHaveAttribute("tabindex", "0");
    expect(last).toHaveAttribute("tabindex", "-1");

    current.focus();
    await user.keyboard("{ArrowRight}");
    expect(last).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith("last", expect.anything());

    await user.keyboard("{Home}");
    expect(first).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith("first", expect.anything());
  });

  it("measures the selected button instead of assuming equal widths", () => {
    const activationOrder: Array<[string | null, string | null]> = [];
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockReturnValue(41);
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockReturnValue(7);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        if (this.getAttribute("role") === "radiogroup") {
          activationOrder.push([
            this.getAttribute("data-segmented-ready"),
            this.getAttribute("data-segmented-animate"),
          ]);
        }
        return 83;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(28);
    render(
      <SegmentedControl
        value="long"
        options={[
          { value: "short", label: "A" },
          { value: "long", label: "A translated label" },
        ]}
        onChange={() => undefined}
      />,
    );

    const group = screen.getByRole("radiogroup");
    expect(group).toHaveClass("settings-seg--sliding");
    expect(group).toHaveAttribute("data-segmented-ready", "1");
    expect(group).toHaveAttribute("data-segmented-animate", "1");
    expect(activationOrder).toEqual([["1", null]]);
    expect(group).toHaveStyle({
      "--seg-x": "41px",
      "--seg-y": "7px",
      "--seg-width": "83px",
      "--seg-height": "28px",
    });
  });
});
