/**
 * @vitest-environment jsdom
 *
 * 分发器（ADR 0004）：按档位挂内置编辑器或 Markdown 编辑器；按 DOM 归属路由
 * 命令式 API。这里挂真实组件，断言两套编辑器确实换了挂载，且命令式接口不会被
 * 错档调用。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";
import { act, cleanup, render } from "@testing-library/react";
import {
  ComposerEditor,
  insertComposerRefAtom,
  ownsComposerDom,
  removeComposerQueryRange,
  serializeDom,
} from "@/components/composer";
import { composerEditorKind, setComposerEditorKind } from "@/components/composer/editorPref";

// EditorView.scrollToSelection → Range#getClientRects，jsdom 未实现。
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
}
if (typeof Range.prototype.getBoundingClientRect !== "function") {
  Range.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
}

afterEach(() => {
  cleanup();
  setComposerEditorKind(undefined);
});

function mount() {
  const onChange = vi.fn();
  return render(
    <ComposerEditor value="" onChange={onChange} aria-label="t" />,
  );
}

describe("composer 编辑器分发器", () => {
  it("缺省档是内置编辑器", () => {
    const { container } = mount();
    expect(composerEditorKind()).toBe("legacy");
    expect(container.querySelector(".composer-editor-wrap")).not.toBeNull();
    expect(container.querySelector(".composer-editor-tiptap")).toBeNull();
    expect(container.querySelector(".ProseMirror")).toBeNull();
  });

  it("档位切到 tiptap 后换挂 Markdown 编辑器", () => {
    const { container } = mount();
    act(() => setComposerEditorKind("tiptap"));
    expect(composerEditorKind()).toBe("tiptap");
    expect(container.querySelector(".composer-editor-tiptap")).not.toBeNull();
    expect(container.querySelector(".ProseMirror")).not.toBeNull();
  });

  it("非法档位值归一到内置编辑器", () => {
    setComposerEditorKind("nope");
    expect(composerEditorKind()).toBe("legacy");
  });

  it("ownsComposerDom 只认 Markdown 档托管的元素", () => {
    const { container } = mount();
    const legacyEl = container.querySelector(".composer-editor-wrap");
    expect(ownsComposerDom(null)).toBe(false);
    expect(ownsComposerDom(legacyEl as HTMLElement)).toBe(false);

    act(() => setComposerEditorKind("tiptap"));
    const pm = container.querySelector(".ProseMirror") as HTMLElement;
    expect(ownsComposerDom(pm)).toBe(true);
    // 未挂载 / 已卸载的元素一律不认。
    expect(ownsComposerDom(document.createElement("div"))).toBe(false);
  });

  it("serializeDom 按归属路由：内置档返回内置编辑器的序列化结果", () => {
    const { container } = mount();
    const el = container.querySelector(".composer-editor-wrap") as HTMLElement;
    expect(typeof serializeDom(el)).toBe("string");
  });

  it("Markdown 档下实例暂时查不到时不会退化成 textContent", () => {
    // Arrange —— HMR 重执行模块 / 编辑器正在重挂载时，注册表可能暂时查不到 DOM
    const { container } = mount();
    act(() => setComposerEditorKind("tiptap"));
    const pm = container.querySelector(".ProseMirror") as HTMLElement;
    expect(typeof serializeDom(pm)).toBe("string");

    const orphan = document.createElement("div");
    orphan.textContent = "# 字面量标题";

    // Act + Assert —— 抛错让调用方回退 getDraft()，而不是把纯文本当草稿
    expect(() => serializeDom(orphan)).toThrow();
  });

  it("命令式引用接口在内置档返回 false（引用 chip 是 Markdown 档独占）", () => {
    const { container } = mount();
    const el = container.querySelector(".composer-editor-wrap") as HTMLElement;
    expect(
      insertComposerRefAtom(el, { from: 0, to: 0, kind: "file", value: "a.ts" }),
    ).toBe(false);
    expect(removeComposerQueryRange(el, { from: 0, to: 1 })).toBe(false);
  });
});
