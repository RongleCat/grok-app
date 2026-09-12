import { describe, expect, it } from "vitest";
import { resolveAskUserOptionsLayout } from "./askUserOptionsLayout";

describe("resolveAskUserOptionsLayout", () => {
  it("rows short labels with no descriptions (Yes / No)", () => {
    expect(
      resolveAskUserOptionsLayout([
        { label: "Yes" },
        { label: "No" },
      ]),
    ).toBe("row");
  });

  it("rows short CJK labels (是 / 否)", () => {
    expect(
      resolveAskUserOptionsLayout([{ label: "是" }, { label: "否" }]),
    ).toBe("row");
  });

  it("rows up to four short chips", () => {
    expect(
      resolveAskUserOptionsLayout([
        { label: "A" },
        { label: "B" },
        { label: "C" },
        { label: "D" },
      ]),
    ).toBe("row");
  });

  it("rows when descriptions only repeat the label (CLI echo)", () => {
    expect(
      resolveAskUserOptionsLayout([
        { label: "Yes", description: "Yes" },
        { label: "No", description: "No" },
      ]),
    ).toBe("row");
    expect(
      resolveAskUserOptionsLayout([
        { label: "不破坏 API", description: "不破坏 API" },
        { label: "补测试", description: "补测试" },
        { label: "最小 diff", description: "最小 diff" },
      ]),
    ).toBe("row");
  });

  it("stacks when any option has a real description", () => {
    expect(
      resolveAskUserOptionsLayout([
        { label: "Yes", description: "Continue with the change." },
        { label: "No" },
      ]),
    ).toBe("stack");
  });

  it("stacks a long label that would wrap in a row", () => {
    expect(
      resolveAskUserOptionsLayout([
        {
          label: "Ship a carefully reviewed production hotfix",
        },
        { label: "No" },
      ]),
    ).toBe("stack");
  });

  it("rows five tiny chips when they still fit the width budget", () => {
    expect(
      resolveAskUserOptionsLayout([
        { label: "1" },
        { label: "2" },
        { label: "3" },
        { label: "4" },
        { label: "5" },
      ]),
    ).toBe("row");
  });

  it("stacks an empty list", () => {
    expect(resolveAskUserOptionsLayout([])).toBe("stack");
  });
});
