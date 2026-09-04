/**
 * Transcript quote-toolbar placement + commit policy.
 * Drag-select must not setState ConversationThread on every selectionchange.
 */

export type TranscriptSelectionBar = {
  x: number;
  y: number;
  text: string;
  sourceMessageId?: string;
};

export type TranscriptSelectionRead = {
  text: string;
  sourceMessageId?: string;
  rect: { left: number; width: number; bottom: number } | null;
};

export type SelectionRoot = {
  contains(node: Node | null): boolean;
};

export function eventTargetElement(
  target: EventTarget | null,
): HTMLElement | null {
  if (target == null) return null;
  if (typeof HTMLElement !== "undefined" && target instanceof HTMLElement) {
    return target;
  }
  if (typeof Node !== "undefined" && target instanceof Node) {
    return target.parentElement;
  }
  return null;
}

/** Skip React commits while the primary button is down (drag-select). */
export function shouldCommitSelectionChange(opts: {
  primaryPointerDown: boolean;
}): boolean {
  return !opts.primaryPointerDown;
}

/** Pointer-up commits only if the gesture started in the transcript. */
export function shouldCommitPointerUp(opts: {
  startedInTranscript: boolean;
}): boolean {
  return opts.startedInTranscript;
}

export function isSelectionInsideTranscript(
  anchor: Node | null | undefined,
  focus: Node | null | undefined,
  root: SelectionRoot | null | undefined,
): boolean {
  if (!root) return false;
  return (
    (anchor != null && root.contains(anchor)) ||
    (focus != null && root.contains(focus))
  );
}

export function selectionBarFromRead(
  next: TranscriptSelectionRead,
): TranscriptSelectionBar {
  const x = next.rect ? next.rect.left + next.rect.width / 2 - 140 : 24;
  const y = next.rect ? next.rect.bottom + 8 : 24;
  return {
    x,
    y,
    text: next.text,
    sourceMessageId: next.sourceMessageId,
  };
}

export function selectionBarsEqual(
  a: TranscriptSelectionBar | null,
  b: TranscriptSelectionBar | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.text === b.text &&
    a.sourceMessageId === b.sourceMessageId &&
    Math.abs(a.x - b.x) < 1 &&
    Math.abs(a.y - b.y) < 1
  );
}

/**
 * Focusing the comment box collapses the native selection — keep the bar.
 * Equal placement/text keeps the previous object so React can skip.
 */
export function reduceSelectionBar(
  prev: TranscriptSelectionBar | null,
  next: TranscriptSelectionBar | null,
): TranscriptSelectionBar | null {
  if (!next) return prev;
  if (selectionBarsEqual(prev, next)) return prev;
  return next;
}

function messageIdFromAnchor(
  anchor: Node | null,
  root: HTMLElement,
): string | undefined {
  let node: Node | null = anchor;
  while (node && node !== root) {
    if (node instanceof HTMLElement) {
      const id = node.getAttribute("data-message-id");
      if (id) return id;
    }
    node = node.parentNode;
  }
  return undefined;
}

/** Inside-check before toString / getBoundingClientRect. */
export function readTranscriptSelection(
  sel: Selection | null,
  root: HTMLElement | null,
): TranscriptSelectionRead | null {
  if (!sel || sel.isCollapsed || !root) return null;
  if (!isSelectionInsideTranscript(sel.anchorNode, sel.focusNode, root)) {
    return null;
  }
  const text = sel.toString().replace(/\u00a0/g, " ").trim();
  if (!text) return null;
  const sourceMessageId = messageIdFromAnchor(sel.anchorNode, root);
  let rect: TranscriptSelectionRead["rect"] = null;
  if (sel.rangeCount > 0) {
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (r.width || r.height) {
      rect = { left: r.left, width: r.width, bottom: r.bottom };
    }
  }
  return { text, sourceMessageId, rect };
}
