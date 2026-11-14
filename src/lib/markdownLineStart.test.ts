import { describe, expect, it } from "vitest";
import {
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

