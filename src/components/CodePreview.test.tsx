/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@/test/jsdomStubs";
import { CodePreview } from "./CodePreview";
import { CODE_PREVIEW_VIRTUALIZE_THRESHOLD } from "@/lib/codePreviewWindow";

afterEach(cleanup);

describe("CodePreview", () => {
  it("renders every line for a short file", () => {
    render(
      <CodePreview code={"const a = 1;\nconst b = 2;\n"} fileName="a.ts" />,
    );
    expect(document.querySelectorAll("[data-line]")).toHaveLength(2);
    expect(document.querySelector(".rp-code")?.getAttribute("data-virtualized")).toBe(
      "0",
    );
  });

  it("does not mount every row of a 5000-line file", () => {
    const code = Array.from(
      { length: 5000 },
      (_, i) => `const n${i} = ${i};`,
    ).join("\n");
    render(<CodePreview code={code} fileName="big.ts" />);
    const mounted = document.querySelectorAll("[data-line]").length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(CODE_PREVIEW_VIRTUALIZE_THRESHOLD);
    expect(document.querySelector(".rp-code")?.getAttribute("data-virtualized")).toBe(
      "1",
    );
  });
});
