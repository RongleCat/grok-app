/**
 * 回归护栏：`@` 补全面板的文件名必须能被完整看到，真被截断时要有省略号。
 *
 * 缺陷现象：`vite.config.ts` 显示成 `vite.confi`，看起来像文件名少了几个字符。
 * 根因是结构 + 样式两处叠加：
 * 1. 省略号（`text-overflow`）挂在内层 `.composer-plus__title-text` 上，而
 *    `ComposerAtPanel` 只渲染了外层 `.composer-plus__title`；外层是
 *    `overflow: hidden` 的硬裁，于是尾巴被无声切掉。
 * 2. 外层还带 `max-width: 70%`——当该行没有目录描述时，标题是整行唯一内容，
 *    这个上限白白吃掉 30% 宽度并把本可完整显示的文件名压缩到截断。
 *
 * 这是 DOM 结构与 CSS 的不变量，组件测试断言不到，沿用仓库既有的 guard 范式。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const components = join(__dirname, "../components");
const styles = join(__dirname, "../styles");
const atPanel = readFileSync(join(components, "ComposerAtPanel.tsx"), "utf8");
const plusPanel = readFileSync(join(components, "ComposerPlusPanel.tsx"), "utf8");
const css = readFileSync(join(styles, "chat.part4.css"), "utf8");

describe("composer @ panel file names", () => {
  it("wraps the name in the element that carries the ellipsis", () => {
    // Arrange / Act / Assert — 省略号在内层，外层只有 overflow:hidden
    expect(css).toMatch(
      /\.composer-plus__title-text\s*\{[^}]*text-overflow:\s*ellipsis/s,
    );
    expect(atPanel).toMatch(
      /composer-plus__title-text">\s*\{entry\.name\}/s,
    );
    // 与 plus 面板保持同一套结构，避免两处再次分叉
    expect(plusPanel).toMatch(/composer-plus__title-text/);
  });

  it("drops the 70% cap on rows with no directory description", () => {
    // Arrange / Act / Assert
    expect(atPanel).toMatch(/composer-plus__title--solo/);
    expect(css).toMatch(
      /\.composer-plus__title--solo\s*\{[^}]*max-width:\s*100%/s,
    );
    // 上限本身保留：有描述时它负责给目录留位置
    expect(css).toMatch(/\.composer-plus__title\s*\{[^}]*max-width:\s*70%/s);
  });
});
