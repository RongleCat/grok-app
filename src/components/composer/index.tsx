/**
 * composer 输入框编辑器的**分发器**（ADR 0004）。
 *
 * 两套实现并存：
 * - `legacy`：上游内置编辑器（`src/components/ComposerEditor.tsx`），默认档，逐字节未改；
 * - `tiptap`：我们迁移的 Markdown 编辑器（`./tiptap/`），可选，实验性。
 *
 * 消费方（挂载薄岛、send / dictation 钩子、workbench）只依赖本模块。按 DOM 元素
 * 寻址的 API 用「这个 DOM 是否由 TipTap 托管」路由；模块级的光标请求按当前档位
 * 路由（同一时刻只有一套编辑器挂载）。
 */

import { useSyncExternalStore } from "react";
import * as legacy from "@/components/ComposerEditor";
import type { ComposerEditorProps } from "./tiptap/ComposerEditorTiptap";
import * as tiptap from "./tiptap/ComposerEditorTiptap";
import { composerEditorKind, subscribeComposerEditorKind } from "./editorPref";

/** 当前档位（消费方按档位分流时读它；订阅用 `useSyncExternalStore` 或本模块的组件分支）。 */
export { composerEditorKind };

export type { ComposerEditorProps };

/** 当前档位；档位变化触发重渲染（切换 = 换挂另一套编辑器）。 */
export function useComposerEditorKind() {
  return useSyncExternalStore(
    subscribeComposerEditorKind,
    composerEditorKind,
    composerEditorKind,
  );
}

/**
 * 内置编辑器的 props 是我们这套的子集：这里显式丢掉只有 Markdown 档认识的属性，
 * 其余原样透传 —— 让类型检查站住这条边界，而不是 `as` 断言（多传少传都会在此报错）。
 */
function LegacyComposerEditor({
  onAtQueryChange: _onAtQueryChange,
  ...rest
}: ComposerEditorProps) {
  return <legacy.ComposerEditor {...rest} />;
}

/** 按档位挂载对应的编辑器。 */
export function ComposerEditor(props: ComposerEditorProps) {
  const kind = useComposerEditorKind();
  return kind === "tiptap" ? (
    <tiptap.ComposerEditor {...props} />
  ) : (
    <LegacyComposerEditor {...props} />
  );
}

/** 草稿 → 存储态文本（发送 / 落盘用）。 */
export function serializeDom(el: HTMLElement): string {
  // 档位是 Markdown 时，实例暂时查不到（销毁 / 重挂载窗口）也走 Markdown 序列化：
  // 它会抛错，调用方回退到 `getDraft()`。内置编辑器的 textContent 不含 Markdown，
  // 拿它落盘会让字面量 `#` 在气泡与回退后变成标题。
  return owns(el) || composerEditorKind() === "tiptap"
    ? tiptap.serializeDom(el)
    : legacy.serializeDom(el);
}

/** 光标在「编辑器文本空间」的偏移（听写用）。 */
export function getComposerCaretOffset(
  el: HTMLElement | null | undefined,
): number | null {
  return owns(el)
    ? tiptap.getComposerCaretOffset(el)
    : legacy.getComposerCaretOffset(el);
}

/** 输入框高度自适应（两套各自实现，行为对齐）。 */
export function resizeComposerInput(el: HTMLElement): void {
  if (owns(el)) tiptap.resizeComposerInput(el);
  else legacy.resizeComposerInput(el);
}

/** 请求把光标落到下一次投影后的指定位置（模块级 pending，按档位路由）。 */
export function requestComposerStoredCaret(at: number | "end"): void {
  if (composerEditorKind() === "tiptap") tiptap.requestComposerStoredCaret(at);
  else legacy.requestComposerStoredCaret(at);
}

/**
 * 在文档位置 `[from, to)` 处插入引用 chip。**仅 Markdown 档有效** —— 内置档走
 * 上游原行为（`@` 选中的文件进附件条），因此这里返回 `false`。
 */
export function insertComposerRefAtom(
  el: HTMLElement | null | undefined,
  insert: Parameters<typeof tiptap.insertComposerRefAtom>[1],
): boolean {
  return owns(el) ? tiptap.insertComposerRefAtom(el, insert) : false;
}

/** 删除文档位置 `[from, to)`（引用不可 token 化时回退附件用）。仅 Markdown 档。 */
export function removeComposerQueryRange(
  el: HTMLElement | null | undefined,
  range: { from: number; to: number },
): boolean {
  return owns(el) ? tiptap.removeComposerQueryRange(el, range) : false;
}

/** 是否由 TipTap 那套托管（未挂载 / 内置档时恒 false）。 */
export function ownsComposerDom(el: HTMLElement | null | undefined): boolean {
  return owns(el);
}

/** 是否由 TipTap 那套托管（未挂载 / 内置档时恒 false）。 */
function owns(el: HTMLElement | null | undefined): boolean {
  return tiptap.ownsComposerDom(el);
}
