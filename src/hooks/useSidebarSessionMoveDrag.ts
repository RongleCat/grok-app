/**
 * Pointer-drag a sidebar session onto a project folder (or Other sessions).
 *
 * Chrome is pure DOM — no React setState during the gesture — so VirtualList
 * / Tip trees stay stable. Drop always goes through the confirmed move path.
 */
import { useEffect, useRef } from "react";
import type { SessionRow } from "@/lib/app/sidebarModels";
import {
  isSameProjectDrop,
  parseSessionDropId,
  sessionIdsForDrag,
} from "@/lib/sessionMoveProject";

const DRAG_THRESHOLD_PX = 4;
const SIDEBAR_MOVING = "sidebar--session-moving";
const ROW_DRAGGING = "tree-l3--dragging";
const DROP_TARGET = "is-session-drop";

/** Row-body move must not start from the attach grip or other row chrome. */
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
  ghost.className = "tree-l3 tree-l3--drag-ghost";
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

function dropNodeFromPoint(clientX: number, clientY: number): HTMLElement | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    if (!(el instanceof Element)) continue;
    if (el.classList.contains("tree-l3--drag-ghost")) continue;
    const hit = el.closest<HTMLElement>("[data-session-drop]");
    if (hit) return hit;
  }
  return null;
}

export function useSidebarSessionMoveDrag(opts: {
  enabled: boolean;
  sessions: SessionRow[];
  selectedIds: Set<string>;
  selectMode: boolean;
  formatGhost: (count: number, title: string) => string;
  onDrop: (rows: SessionRow[], targetProjectId: string | null) => void;
}): void {
  const { enabled, sessions, selectedIds, selectMode, formatGhost, onDrop } =
    opts;

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
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const sessionRef = useRef<{
    draggedId: string;
    rowIds: string[];
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    captureEl: HTMLElement | null;
    ghost: HTMLElement | null;
    ghostOffsetX: number;
    ghostOffsetY: number;
    drop: { hit: true; projectId: string | null } | { hit: false };
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
      if (!commit || !s?.active || !s.drop.hit) return;

      const rows = s.rowIds
        .map((id) => sessionsRef.current.find((x) => x.id === id))
        .filter((x): x is SessionRow => Boolean(x));
      if (!rows.length) return;
      if (isSameProjectDrop(rows, s.drop.projectId)) return;

      const blockClick = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        window.removeEventListener("click", blockClick, true);
      };
      window.addEventListener("click", blockClick, true);
      window.setTimeout(() => {
        window.removeEventListener("click", blockClick, true);
      }, 400);

      onDropRef.current(rows, s.drop.projectId);
    };

    const onDown = (e: PointerEvent) => {
      if (!enabledRef.current) return;
      if (e.button !== 0) return;
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
      try {
        row.setPointerCapture?.(pointerId);
      } catch {
        /* older WebView */
      }
      row.closest(".sidebar")?.classList.add(SIDEBAR_MOVING);

      sessionRef.current = {
        draggedId,
        rowIds,
        pointerId,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
        captureEl: row,
        ghost: null,
        ghostOffsetX: 0,
        ghostOffsetY: 0,
        drop: { hit: false },
      };

      const onMove = (ev: PointerEvent) => {
        const s = sessionRef.current;
        if (!s || ev.pointerId !== s.pointerId) return;
        const dx = ev.clientX - s.startX;
        const dy = ev.clientY - s.startY;
        if (!s.active) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          s.active = true;
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

        const node = dropNodeFromPoint(ev.clientX, ev.clientY);
        const parsed = parseSessionDropId(node?.dataset.sessionDrop);
        const rows = s.rowIds
          .map((id) => sessionsRef.current.find((x) => x.id === id))
          .filter((x): x is SessionRow => Boolean(x));
        const usable =
          parsed.hit && rows.length > 0 && !isSameProjectDrop(rows, parsed.projectId)
            ? parsed
            : ({ hit: false } as const);
        s.drop = usable;
        clearDropClasses();
        if (usable.hit && node) {
          node.classList.add(DROP_TARGET);
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

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      cleanupRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      };
    };

    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      endSession(false);
    };
  }, []);
}
