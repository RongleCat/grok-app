/**
 * Pointer-drag a sidebar session onto a project folder (or Default workspace),
 * or onto the composer to attach it as chat context.
 *
 * Chrome is pure DOM — no React setState during the gesture — so VirtualList
 * / Tip trees stay stable. Capture and grab-cursor wait until the pointer
 * actually moves past the threshold, so a click cannot arm a drag.
 */
import { useEffect, useRef } from "react";
import type { SessionRow } from "@/lib/app/sidebarModels";
import {
  isSameProjectDrop,
  parseSessionDropId,
  sessionIdsForDrag,
} from "@/lib/sessionMoveProject";

/**
 * Vertical distance a press must travel before a session move drag arms.
 * Click jitter on trackpads often exceeds 8px; only a real pull should arm.
 */
export const SESSION_DRAG_VERTICAL_THRESHOLD_PX = 16;
/**
 * Horizontal wander allowed while pulling vertically. Rows live in a vertical
 * list, so a sideways swipe or trackpad jitter must never arm a move.
 */
export const SESSION_DRAG_MAX_HORIZONTAL_PX = 10;
/** First pointermove after down is often a synthetic jump; rebase, don't arm. */
export const SESSION_DRAG_HOLD_MS = 80;

export type SessionDragArm = "ignore" | "rebase" | "arm";

const SIDEBAR_MOVING = "sidebar--session-moving";
const ROW_DRAGGING = "tree-l3--dragging";
const DROP_TARGET = "is-session-drop";
const DRAG_GHOST = "tree-l3--drag-ghost";

export type SessionDragDrop =
  | { kind: "attach"; node: HTMLElement }
  | { kind: "move"; node: HTMLElement; projectId: string | null }
  | { kind: "none" };

type ArmedDrop =
  | { kind: "attach" }
  | { kind: "move"; projectId: string | null }
  | { kind: "none" };

/** Row-body move must not start from row chrome (pin / archive / menu / rename). */
export function isSessionMoveIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (
    target.closest(
      ".tree-l3__actions, .tree-l3__drag-handle, .tree-icon-btn, a, input, textarea, select, [data-no-session-move]",
    )
  ) {
    return true;
  }
  return false;
}

export function isPastSessionDragThreshold(dx: number, dy: number): boolean {
  return (
    Math.abs(dx) < SESSION_DRAG_MAX_HORIZONTAL_PX &&
    Math.abs(dy) >= SESSION_DRAG_VERTICAL_THRESHOLD_PX
  );
}

/** First click after the pet stole key is a select, not a drag. */
export function sessionDragShouldTrackPointer(windowFocused: boolean): boolean {
  return windowFocused;
}

/** Decide whether this sample should start drag chrome. */
export function sessionDragArmDecision(input: {
  dx: number;
  dy: number;
  elapsedMs: number;
  buttons: number;
  /** Window just became key mid-press (pet / activation remapped coords). */
  activationDuring?: boolean;
}): SessionDragArm {
  if (input.buttons === 0) return "ignore";

  // Early in the press the first pointermove is often a synthetic jump in any
  // direction (WKWebView / activation remap). Re-anchor on a sizeable move so
  // it can neither arm nor poison a later vertical pull.
  if (input.activationDuring || input.elapsedMs < SESSION_DRAG_HOLD_MS) {
    return Math.hypot(input.dx, input.dy) >= SESSION_DRAG_VERTICAL_THRESHOLD_PX
      ? "rebase"
      : "ignore";
  }

  // Only a deliberate vertical pull arms; horizontal wander keeps it a click.
  return isPastSessionDragThreshold(input.dx, input.dy) ? "arm" : "ignore";
}

/** Prefer composer attach over project-move when both appear in the hit stack. */
export function sessionDragDropFromElements(
  stack: ArrayLike<Element>,
): SessionDragDrop {
  let attach: HTMLElement | null = null;
  let move: HTMLElement | null = null;
  for (let i = 0; i < stack.length; i++) {
    const el = stack[i];
    if (!(el instanceof Element)) continue;
    if (el.classList.contains(DRAG_GHOST)) continue;
    if (!attach) {
      const hit = el.closest<HTMLElement>("[data-session-attach]");
      if (hit) attach = hit;
    }
    if (!move) {
      const hit = el.closest<HTMLElement>("[data-session-drop]");
      if (hit) move = hit;
    }
    if (attach && move) break;
  }
  if (attach) return { kind: "attach", node: attach };
  if (move) {
    const parsed = parseSessionDropId(move.dataset.sessionDrop);
    if (parsed.hit) {
      return { kind: "move", node: move, projectId: parsed.projectId };
    }
  }
  return { kind: "none" };
}

export function sessionDragDropFromPoint(
  clientX: number,
  clientY: number,
): SessionDragDrop {
  return sessionDragDropFromElements(document.elementsFromPoint(clientX, clientY));
}

function removeGhost(ghost: HTMLElement | null) {
  if (!ghost) return;
  try {
    ghost.remove();
  } catch {
    /* ignore */
  }
}

function clearDropClasses() {
  document.querySelectorAll(`.${DROP_TARGET}`).forEach((el) => {
    el.classList.remove(DROP_TARGET);
  });
}

function clearDraggingClasses() {
  document.querySelectorAll(`.${ROW_DRAGGING}`).forEach((el) => {
    el.classList.remove(ROW_DRAGGING);
  });
  document.querySelectorAll(`.${SIDEBAR_MOVING}`).forEach((el) => {
    el.classList.remove(SIDEBAR_MOVING);
  });
}

function moveGhost(
  ghost: HTMLElement,
  clientX: number,
  clientY: number,
  offsetX: number,
  offsetY: number,
) {
  ghost.style.left = `${clientX - offsetX}px`;
  ghost.style.top = `${clientY - offsetY}px`;
}

function createSessionDragGhost(
  label: string,
  clientX: number,
  clientY: number,
): { ghost: HTMLElement; offsetX: number; offsetY: number } {
  const ghost = document.createElement("div");
  ghost.className = `tree-l3 ${DRAG_GHOST}`;
  ghost.setAttribute("aria-hidden", "true");
  ghost.textContent = label;
  const offsetX = 16;
  const offsetY = 12;
  ghost.style.position = "fixed";
  ghost.style.left = `${clientX - offsetX}px`;
  ghost.style.top = `${clientY - offsetY}px`;
  ghost.style.zIndex = "80";
  ghost.style.pointerEvents = "none";
  document.body.appendChild(ghost);
  return { ghost, offsetX, offsetY };
}

export function useSidebarSessionMoveDrag(opts: {
  enabled: boolean;
  sessions: SessionRow[];
  selectedIds: Set<string>;
  selectMode: boolean;
  formatGhost: (count: number, title: string) => string;
  onDrop: (rows: SessionRow[], targetProjectId: string | null) => void;
  onAttach?: (rows: SessionRow[]) => void;
}): void {
  const {
    enabled,
    sessions,
    selectedIds,
    selectMode,
    formatGhost,
    onDrop,
    onAttach,
  } = opts;

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  const selectModeRef = useRef(selectMode);
  selectModeRef.current = selectMode;
  const formatGhostRef = useRef(formatGhost);
  formatGhostRef.current = formatGhost;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const onAttachRef = useRef(onAttach);
  onAttachRef.current = onAttach;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const sessionRef = useRef<{
    draggedId: string;
    rowIds: string[];
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
    active: boolean;
    activationDuring: boolean;
    captureEl: HTMLElement | null;
    ghost: HTMLElement | null;
    ghostOffsetX: number;
    ghostOffsetY: number;
    drop: ArmedDrop;
  } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const endSession = (commit: boolean) => {
      const s = sessionRef.current;
      sessionRef.current = null;
      cleanupRef.current?.();
      cleanupRef.current = null;
      removeGhost(s?.ghost ?? null);
      clearDropClasses();
      clearDraggingClasses();
      if (s?.captureEl) {
        try {
          if (s.captureEl.hasPointerCapture?.(s.pointerId)) {
            s.captureEl.releasePointerCapture(s.pointerId);
          }
        } catch {
          /* ignore */
        }
      }
      if (!s?.active) return;

      // A real drag must not open the row via the trailing click.
      const blockClick = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        window.removeEventListener("click", blockClick, true);
      };
      window.addEventListener("click", blockClick, true);
      window.setTimeout(() => {
        window.removeEventListener("click", blockClick, true);
      }, 400);

      if (!commit) return;

      const rows = s.rowIds
        .map((id) => sessionsRef.current.find((x) => x.id === id))
        .filter((x): x is SessionRow => Boolean(x));
      if (!rows.length) return;

      if (s.drop.kind === "attach") {
        onAttachRef.current?.(rows);
        return;
      }
      if (s.drop.kind !== "move") return;
      if (isSameProjectDrop(rows, s.drop.projectId)) return;
      onDropRef.current(rows, s.drop.projectId);
    };

    const onDown = (e: PointerEvent) => {
      if (!enabledRef.current) return;
      if (e.button !== 0) return;
      if (sessionRef.current) return;
      if (
        !sessionDragShouldTrackPointer(
          typeof document.hasFocus === "function" ? document.hasFocus() : true,
        )
      ) {
        return;
      }
      if (isSessionMoveIgnoredTarget(e.target)) return;
      const raw = e.target;
      if (!(raw instanceof Element)) return;
      if (!raw.closest(".sidebar")) return;
      const row = raw.closest<HTMLElement>(".tree-l3[data-session-id]");
      if (!row) return;
      const draggedId = row.dataset.sessionId?.trim() || "";
      if (!draggedId) return;

      const rowIds = sessionIdsForDrag({
        draggedId,
        selectedIds: [...selectedRef.current],
        selectMode: selectModeRef.current,
      });
      const pointerId = e.pointerId;

      // Do not capture or paint grab-cursor until the pointer actually moves.
      // Immediate capture + a distance-only threshold still armed drags on the
      // first click (synthetic pointermove / trackpad press jump).
      sessionRef.current = {
        draggedId,
        rowIds,
        pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startTime: e.timeStamp,
        active: false,
        activationDuring: false,
        captureEl: row,
        ghost: null,
        ghostOffsetX: 0,
        ghostOffsetY: 0,
        drop: { kind: "none" },
      };

      const onMove = (ev: PointerEvent) => {
        const s = sessionRef.current;
        if (!s || ev.pointerId !== s.pointerId) return;
        const dx = ev.clientX - s.startX;
        const dy = ev.clientY - s.startY;
        if (!s.active) {
          const decision = sessionDragArmDecision({
            dx,
            dy,
            elapsedMs: ev.timeStamp - s.startTime,
            buttons: ev.buttons,
            activationDuring: s.activationDuring,
          });
          if (decision === "ignore") return;
          if (decision === "rebase") {
            s.startX = ev.clientX;
            s.startY = ev.clientY;
            s.startTime = ev.timeStamp;
            s.activationDuring = false;
            return;
          }
          s.active = true;
          try {
            row.setPointerCapture?.(pointerId);
          } catch {
            /* older WebView */
          }
          row.closest(".sidebar")?.classList.add(SIDEBAR_MOVING);
          try {
            ev.preventDefault();
          } catch {
            /* ignore */
          }
          const first = sessionsRef.current.find((x) => x.id === s.draggedId);
          const label = formatGhostRef.current(
            s.rowIds.length,
            (first?.title || "").trim() || "…",
          );
          try {
            const built = createSessionDragGhost(label, ev.clientX, ev.clientY);
            s.ghost = built.ghost;
            s.ghostOffsetX = built.offsetX;
            s.ghostOffsetY = built.offsetY;
          } catch {
            s.ghost = null;
          }
          row.classList.add(ROW_DRAGGING);
        } else {
          try {
            ev.preventDefault();
          } catch {
            /* ignore */
          }
          if (s.ghost) {
            moveGhost(
              s.ghost,
              ev.clientX,
              ev.clientY,
              s.ghostOffsetX,
              s.ghostOffsetY,
            );
          }
        }

        const hit = sessionDragDropFromPoint(ev.clientX, ev.clientY);
        clearDropClasses();
        if (hit.kind === "attach") {
          s.drop = { kind: "attach" };
          hit.node.classList.add(DROP_TARGET);
        } else if (hit.kind === "move") {
          const rows = s.rowIds
            .map((id) => sessionsRef.current.find((x) => x.id === id))
            .filter((x): x is SessionRow => Boolean(x));
          const usable =
            rows.length > 0 && !isSameProjectDrop(rows, hit.projectId);
          s.drop = usable
            ? { kind: "move", projectId: hit.projectId }
            : { kind: "none" };
          if (usable) hit.node.classList.add(DROP_TARGET);
        } else {
          s.drop = { kind: "none" };
        }
      };

      const onUp = (ev: PointerEvent) => {
        const s = sessionRef.current;
        if (!s || ev.pointerId !== s.pointerId) return;
        endSession(s.active);
      };

      const onCancel = (ev: PointerEvent) => {
        const s = sessionRef.current;
        if (!s || ev.pointerId !== s.pointerId) return;
        endSession(false);
      };

      const onWinFocus = () => {
        const s = sessionRef.current;
        if (!s || s.active) return;
        s.activationDuring = true;
      };

      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onCancel, true);
      window.addEventListener("focus", onWinFocus);
      cleanupRef.current = () => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onCancel, true);
        window.removeEventListener("focus", onWinFocus);
      };
    };

    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      endSession(false);
    };
  }, []);
}
