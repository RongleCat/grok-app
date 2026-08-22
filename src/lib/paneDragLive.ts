/**
 * In-flow split drag writes the pane box on the element.
 * React layout state commits on pointer-up so AppWorkbench does not
 * reconcile every pointermove.
 */

export type WorkbenchSplitPane = "sidebar" | "aside";

export function queryWorkbenchSplitPane(
  which: WorkbenchSplitPane,
  root: ParentNode = document,
): HTMLElement | null {
  return root.querySelector(
    which === "sidebar" ? ".workbench > .sidebar" : ".workbench > .aside",
  );
}

/** Same tuple as `paneSplitSizeStyle(n, "x")`. */
export function applyLiveSplitWidth(
  el: HTMLElement | null,
  sizePx: number,
): number {
  const n = Math.max(0, Math.round(sizePx));
  if (!el) return n;
  const px = `${n}px`;
  el.style.width = px;
  el.style.minWidth = px;
  el.style.maxWidth = px;
  el.style.flexBasis = px;
  return n;
}
