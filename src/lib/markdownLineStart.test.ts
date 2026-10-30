import { describe, expect, it } from "vitest";
import {
  escapeMarkdownLineStart,
  looksLikeMarkdownBlockSource,
} from "./markdownLineStart";

describe("looksLikeMarkdownBlockSource", () => {
  it("单行普通文字不算块级源码", () => {
    expect(looksLikeMarkdownBlockSource("# trending topic")).toBe(false);
    expect(looksLikeMarkdownBlockSource("- 今天去超市买菜")).toBe(false);
    expect(looksLikeMarkdownBlockSource("1. 这不是清单")).toBe(false);
    expect(looksLikeMarkdownBlockSource("> 不是引用")).toBe(false);
    expect(looksLikeMarkdownBlockSource("---")).toBe(false);
    expect(looksLikeMarkdownBlockSource("a _b_ c")).toBe(false);
  });

  it("多行普通段落不算块级源码", () => {
    expect(looksLikeMarkdownBlockSource("第一行\n第二行")).toBe(false);
  });

  it("多行含块级记号按源码处理", () => {
    expect(looksLikeMarkdownBlockSource("# 标题\n正文")).toBe(true);
    expect(looksLikeMarkdownBlockSource("- 一项\n- 二项")).toBe(true);
    expect(looksLikeMarkdownBlockSource("```js\nconst a = 1;\n```")).toBe(true);
    expect(looksLikeMarkdownBlockSource("| a | b |\n| --- | --- |")).toBe(true);
    expect(looksLikeMarkdownBlockSource("标题\n===")).toBe(true);
    expect(looksLikeMarkdownBlockSource(">引用\n正文")).toBe(true);
  });
});

describe("escapeMarkdownLineStart", () => {
  it("转义行首块级记号", () => {
    expect(escapeMarkdownLineStart("# 标题")).toBe("\\# 标题");
    expect(escapeMarkdownLineStart("```js")).toBe("\\```js");
    expect(escapeMarkdownLineStart("> 引用")).toBe("\\> 引用");
    expect(escapeMarkdownLineStart("- 一项")).toBe("\\- 一项");
    expect(escapeMarkdownLineStart("+ 一项")).toBe("\\+ 一项");
    expect(escapeMarkdownLineStart("| a | b |")).toBe("\\| a | b |");
    expect(escapeMarkdownLineStart("---")).toBe("\\---");
    expect(escapeMarkdownLineStart("===")).toBe("\\===");
    expect(escapeMarkdownLineStart("***")).toBe("\\*\\*\\*");
    expect(escapeMarkdownLineStart("_ _ _")).toBe("\\_ \\_ \\_");
  });

  it("有序列表转义分隔符", () => {
    expect(escapeMarkdownLineStart("1. 一项")).toBe("1\\. 一项");
    expect(escapeMarkdownLineStart("12) 一项")).toBe("12\\) 一项");
  });

  it("保留行首缩进", () => {
    expect(escapeMarkdownLineStart("  - 一项")).toBe("  \\- 一项");
  });

  it("普通文字、小数与已转义的行保持不变", () => {
    expect(escapeMarkdownLineStart("普通文字")).toBe("普通文字");
    expect(escapeMarkdownLineStart("1.5 倍")).toBe("1.5 倍");
    expect(escapeMarkdownLineStart("+5 元")).toBe("+5 元");
    expect(escapeMarkdownLineStart("\\# 已转义")).toBe("\\# 已转义");
  });
});
