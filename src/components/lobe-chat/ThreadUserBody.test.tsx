/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { UserMessageBody } from "./ThreadUserBody";

afterEach(cleanup);

function renderBody(content: string): HTMLElement {
  const { container } = render(
    <UserMessageBody
      content={content}
      scheduledLabel="Scheduled"
      remoteImLabel="Remote IM"
      locale="en"
    />,
  );
  return container;
}

describe("user bubble renders like the composer", () => {
  it("renders stored escapes as the characters the user typed", () => {
    // Arrange —— journal 里就是这样的源码
    const content = "\\# trending topic\n\n1\\. 这不是清单\n\n&gt; 不是引用";

    // Act
    const root = renderBody(content);

    // Assert
    expect(root.textContent).toContain("# trending topic");
    expect(root.textContent).toContain("1. 这不是清单");
    expect(root.textContent).toContain("> 不是引用");
    expect(root.textContent).not.toContain("\\");
    expect(root.textContent).not.toContain("&gt;");
  });

  it("renders headings, bold and fenced code as blocks", () => {
    // Arrange
    const content = "## **标题**\n\n正文\n\n```js\nconst a = 1;\n```";

    // Act
    const root = renderBody(content);

    // Assert
    const heading = root.querySelector("h2");
    expect(heading?.textContent).toBe("标题");
    expect(heading?.querySelector("strong")).not.toBeNull();
    expect(root.textContent).toContain("正文");
    expect(root.querySelector("pre code")?.textContent).toContain(
      "const a = 1;",
    );
  });

  it("renders literal escaped marks without formatting", () => {
    // Arrange —— 粘贴字面量 `a *b* c` 时 draft 会保留防御性转义
    const content = "a \\*b\\* c";

    // Act
    const root = renderBody(content);

    // Assert
    expect(root.textContent).toBe("a *b* c");
    expect(root.querySelector("em")).toBeNull();
  });

  it("renders hard-break continuation lines as literal text", () => {
    // Arrange —— 段内 Shift+Enter 换行在 journal 里只隔一个换行
    const content = [
      "\\# trending topic",
      "1\\. 这不是清单",
      "\\- 今天去超市买菜",
      "&gt; 不是引用",
      "\\## \\*\\*标题\\*\\*",
      "\\---",
    ].join("\n");

    // Act
    const root = renderBody(content);

    // Assert —— 不再提升成列表 / 标题 / 分隔线
    expect(root.querySelector("ol")).toBeNull();
    expect(root.querySelector("ul")).toBeNull();
    expect(root.querySelector("h1")).toBeNull();
    expect(root.querySelector("h2")).toBeNull();
    expect(root.querySelector("hr")).toBeNull();
    expect(root.textContent).toContain("# trending topic");
    expect(root.textContent).toContain("1. 这不是清单");
    expect(root.textContent).toContain("- 今天去超市买菜");
    expect(root.textContent).toContain("> 不是引用");
    expect(root.textContent).toContain("## **标题**");
    expect(root.textContent).toContain("---");
    expect(root.textContent).not.toContain("\\");
  });

  it("renders every input newline as a visible line break", () => {
    // Arrange —— 输入框里每个换行都是硬换行；气泡需要渲染出同样的 5 个换行
    const content = [
      "\\- 今天去超市买菜",
      "&gt; 不是引用",
      "a \\_b\\_ c",
      "**测试**",
      "\\## \\*\\*标题\\*\\*",
    ].join("\n");

    // Act
    const root = renderBody(content);

    // Assert —— 段内换行渲染成 `<br>`，而不是被 HTML 折叠成空格
    expect(root.querySelectorAll("p br")).toHaveLength(4);
  });

  it("keeps blank lines as paragraph breaks and fenced code intact", () => {
    // Arrange —— 与发送后的新消息同形：段落、空行、分隔线、围栏（12 行 → 默认折叠）
    const content = [
      "\\# trending topic",
      "",
      "1\\. 这不是清单",
      "",
      "\\- 今天去超市买菜",
      "&gt; 不是引用",
      "",
      "---",
      "",
      "```js",
      "const a = 1;",
      "```",
    ].join("\n");

    // Act
    const root = renderBody(content);
    const foldable = root.querySelector(".lobe-chat-user-body-wrap--foldable");
    expect(foldable?.querySelectorAll("p br").length).toBeGreaterThan(0);
    fireEvent.click(foldable as HTMLElement);

    // Assert —— 展开后：三段正文、一个段内换行、围栏都在（`hr` 在气泡里隐藏）
    expect(root.querySelectorAll("p")).toHaveLength(3);
    expect(root.querySelectorAll("p br")).toHaveLength(1);
    expect(root.querySelector("h1")).toBeNull();
    expect(root.querySelector("h2")).toBeNull();
    expect(root.querySelector("pre code")?.textContent).toContain(
      "const a = 1;",
    );
  });

  it("keeps mermaid fences as code and hides the copy button", () => {
    // Arrange —— 编辑器里 ```mermaid 就是代码块，气泡保持一致
    const content = [
      "```mermaid",
      "graph TD;",
      "A-->B;",
      "```",
      "",
      "```js",
      "const a = 1;",
      "```",
    ].join("\n");

    // Act
    const root = renderBody(content);

    // Assert
    expect(root.querySelector(".chat-mermaid")).toBeNull();
    expect(root.textContent).toContain("graph TD;");
    expect(root.querySelectorAll(".chat-code__bar-actions button")).toHaveLength(
      2,
    );
    expect(root.querySelectorAll("pre code")).toHaveLength(2);
  });

  it("highlights find matches inside rendered Markdown", () => {
    // Arrange
    const { container } = render(
      <UserMessageBody
        content="**测试** 与普通文字"
        scheduledLabel="Scheduled"
        remoteImLabel="Remote IM"
        locale="en"
        findQuery="测试"
      />,
    );

    // Assert
    expect(container.querySelector("mark")?.textContent).toBe("测试");
  });
});
