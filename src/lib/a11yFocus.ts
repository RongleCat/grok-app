/**
 * Small focus helpers for dialogs / permission bars (T15).
 * No React dependency — unit-testable.
 */

const FOCUSABLE_SEL = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Visible, enabled focus targets inside `root`. */
export function listFocusable(root: ParentNode | null | undefined): HTMLElement[] {
  if (!root || typeof (root as Element).querySelectorAll !== "function") {
    return [];
  }
  const nodes = Array.from(
    (root as Element).querySelectorAll<HTMLElement>(FOCUSABLE_SEL),
  );
  return nodes.filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    // offsetParent null for display:none (except fixed); still allow fixed.
    const style =
      typeof window !== "undefined" ? window.getComputedStyle(el) : null;
    if (style && (style.visibility === "hidden" || style.display === "none")) {
      return false;
    }
    return true;
  });
}

/** Focus the first focusable control; returns it or null. */
export function focusFirst(
  root: ParentNode | null | undefined,
): HTMLElement | null {
  const list = listFocusable(root);
  const el = list[0] ?? null;
  el?.focus();
  return el;
}

/**
 * Keep Tab / Shift+Tab cycling inside `root` (basic focus trap).
 * Call from keydown when the dialog is open.
 */
export function trapTabKey(
  e: { key: string; shiftKey: boolean; preventDefault: () => void },
  root: ParentNode | null | undefined,
): void {
  if (e.key !== "Tab") return;
  const list = listFocusable(root);
  if (list.length === 0) {
    e.preventDefault();
    return;
  }
  const first = list[0]!;
  const last = list[list.length - 1]!;
  const active =
    typeof document !== "undefined"
      ? (document.activeElement as HTMLElement | null)
      : null;

  if (e.shiftKey) {
    if (!active || active === first || !rootContains(root, active)) {
      e.preventDefault();
      last.focus();
    }
  } else if (!active || active === last || !rootContains(root, active)) {
    e.preventDefault();
    first.focus();
  }
}

function rootContains(
  root: ParentNode | null | undefined,
  el: Node | null,
): boolean {
  if (!root || !el) return false;
  if (root === el) return true;
  return typeof (root as Node).contains === "function"
    ? (root as Node).contains(el)
    : false;
}

/** Prefer primary allow / solid button when focusing a permission bar. */
export function preferPermissionFocus(
  root: ParentNode | null | undefined,
): HTMLElement | null {
  if (!root || typeof (root as Element).querySelector !== "function") {
    return focusFirst(root);
  }
  const allow = (root as Element).querySelector<HTMLElement>(
    ".perm-bar__btn--allow, .perm-bar__btn--session, .btn--primary, .btn--solid",
  );
  if (allow && !allow.hasAttribute("disabled")) {
    allow.focus();
    return allow;
  }
  return focusFirst(root);
}
