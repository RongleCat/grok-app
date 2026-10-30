import { describe, expect, it } from "vitest";
import {
  decodeMarkdownDisplayText,
  hardenUserLineBreaks,
  transformOutsideCode,
} from "./markdownSource";

describe("transformOutsideCode", () => {
  it("只对代码之外的片段调用 transform", () => {
    // Arrange
    const input = "a `x` b\n\n```js\nconst a = 1;\n```\n\nc";
    const seen: string[] = [];

    // Act
    const out = transformOutsideCode(input, (plain) => {
      seen.push(plain);
      return plain.toUpperCase();
    });

    // Assert
    expect(out).toContain("a ");
    expect(out).toContain(" B");
    expect(out).toContain("`x`");
    expect(out).toContain("```js\nconst a = 1;\n```");
    expect(seen.join("")).not.toContain("x");
  });
});

describe("decodeMarkdownDisplayText", () => {
  it("还原行首块级记号的防御性转义", () => {
    expect(decodeMarkdownDisplayText("\\# trending topic")).toBe(
      "# trending topic",
    );
    expect(decodeMarkdownDisplayText("1\\. 这不是清单")).toBe("1. 这不是清单");
    expect(decodeMarkdownDisplayText("\\- 今天去超市买菜")).toBe(
      "- 今天去超市买菜",
    );
    expect(decodeMarkdownDisplayText("\\> 不是引用")).toBe("> 不是引用");
    expect(decodeMarkdownDisplayText("\\---")).toBe("---");
    expect(decodeMarkdownDisplayText("\\===")).toBe("===");
    expect(decodeMarkdownDisplayText("\\| a |")).toBe("| a |");
  });

  it("还原 HTML 实体", () => {
    expect(decodeMarkdownDisplayText("&gt; 不是引用")).toBe("> 不是引用");
    expect(decodeMarkdownDisplayText("a &lt;b&gt; c")).toBe("a <b> c");
  });

  it("行内记号与普通文字保持原样", () => {
    expect(decodeMarkdownDisplayText("a _b_ c")).toBe("a _b_ c");
    expect(decodeMarkdownDisplayText("**测试**")).toBe("**测试**");
    expect(decodeMarkdownDisplayText("## **标题**")).toBe("## **标题**");
  });

  it("代码里的反斜杠保持原样", () => {
    const fenced = "```\nC:\\path\\to\\*file\n```";
    expect(decodeMarkdownDisplayText(fenced)).toBe(fenced);
    const inline = "run `a\\*b` now";
    expect(decodeMarkdownDisplayText(inline)).toBe(inline);
  });

  it("保留用户输入的其它反斜杠组合", () => {
    expect(decodeMarkdownDisplayText("C:\\Users\\soren")).toBe(
      "C:\\Users\\soren",
    );
    expect(decodeMarkdownDisplayText("\\n 是字面量")).toBe("\\n 是字面量");
  });
});

describe("hardenUserLineBreaks", () => {
  it("段内换行补成 CommonMark 硬换行", () => {
    // Arrange / Act / Assert
    expect(hardenUserLineBreaks("a\nb")).toBe("a  \nb");
  });

  it("空行分隔保持为空行", () => {
    expect(hardenUserLineBreaks("a\n\nb")).toBe("a  \n\nb");
  });

  it("围栏与行内代码保持原样", () => {
    // Arrange
    const fenced = "```js\na\nb\n```";
    const inline = "run `a\nb` now";

    // Act / Assert
    expect(hardenUserLineBreaks(fenced)).toBe(fenced);
    expect(hardenUserLineBreaks(inline)).toBe(inline);
  });
});
