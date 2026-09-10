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

/**
 * Click/shortcut paint: write used size + hidden class before React commit.
 * Overlay keeps the open width (transform owns the motion).
 */
export function paintSidebarRail(
  el: HTMLElement | null,
  opts: { collapsed: boolean; openWidth: number; overlay: boolean },
): void {
  if (!el) return;
  el.classList.toggle("sidebar--hidden", opts.collapsed);
  el.classList.toggle("sidebar--collapsed", opts.collapsed);
  if (opts.overlay) {
    if (!opts.collapsed) applyLiveSplitWidth(el, opts.openWidth);
    return;
  }
  applyLiveSplitWidth(el, opts.collapsed ? 0 : opts.openWidth);
}
