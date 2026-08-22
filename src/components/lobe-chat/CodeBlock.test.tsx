/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@/test/jsdomStubs";
import { CodeBlock } from "./CodeBlock";

afterEach(cleanup);

describe("CodeBlock line gutter", () => {
  it("omits the gutter when line numbers are off", () => {
    render(
      <CodeBlock showLineNumbers={false}>{"a\nb"}</CodeBlock>,
    );
    expect(document.querySelector(".chat-code__gutter")).toBeNull();
    expect(document.querySelector(".chat-code--lines")).toBeNull();
  });

  it("renders a short fence as one gutter text node", () => {
    render(
      <CodeBlock showLineNumbers language="ts">
        {"const a = 1;\nconst b = 2;\n"}
      </CodeBlock>,
    );
    expect(document.querySelectorAll(".chat-code__ln")).toHaveLength(0);
    const gutter = document.querySelector(".chat-code__gutter");
    expect(gutter?.tagName).toBe("PRE");
    expect(gutter?.textContent).toBe("1\n2");
  });

  it("does not mount one node per line on a 5000-line fence", () => {
    const code = Array.from(
      { length: 5000 },
      (_, i) => `const n${i} = ${i};`,
    ).join("\n");
    render(
      <CodeBlock showLineNumbers language="ts">
        {code}
      </CodeBlock>,
    );
    expect(document.querySelectorAll(".chat-code__ln")).toHaveLength(0);
    const gutter = document.querySelector(".chat-code__gutter");
    expect(gutter?.childNodes).toHaveLength(1);
    expect(gutter?.textContent?.startsWith("1\n2\n")).toBe(true);
    expect(gutter?.textContent?.endsWith("\n4999\n5000")).toBe(true);
  });
});
