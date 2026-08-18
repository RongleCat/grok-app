import { describe, expect, it } from "vitest";
import {
  ATTACH_DRAG_CLICK_GUARD_MS,
  armAttachDragClickBlocker,
  classifySessionAttachDrop,
  createAttachDragClickGuard,
  isSessionAttachDropTarget,
  isSessionAttachPointerStartTarget,
  sessionAttachDragPastThreshold,
  sessionAttachDropReadyFromPoint,
} from "./sessionAttachDrag";

describe("sessionAttachDragPastThreshold", () => {
  it("ignores tiny movement (click)", () => {
    expect(sessionAttachDragPastThreshold(2, 2)).toBe(false);
    expect(sessionAttachDragPastThreshold(0, 0)).toBe(false);
  });

  it("starts after 6px", () => {
    expect(sessionAttachDragPastThreshold(6, 0)).toBe(true);
    expect(sessionAttachDragPastThreshold(0, -6)).toBe(true);
    expect(sessionAttachDragPastThreshold(4, 5)).toBe(true);
  });
});

describe("isSessionAttachDropTarget", () => {
  it("only the composer is a drop target", () => {
    expect(
      isSessionAttachDropTarget({ overComposer: true, zone: "sidebar" }),
    ).toBe(true);
    expect(
      isSessionAttachDropTarget({ overComposer: false, zone: "main" }),
    ).toBe(false);
    expect(
      isSessionAttachDropTarget({ overComposer: false, zone: "sidebar" }),
    ).toBe(false);
    expect(
      classifySessionAttachDrop({ overComposer: false, zone: "sidebar" }),
    ).toBe("sidebar");
    expect(
      classifySessionAttachDrop({ overComposer: false, zone: "main" }),
    ).toBe("miss");
  });
});

describe("isSessionAttachPointerStartTarget", () => {
  it("only accepts the grip handle", () => {
    if (typeof document === "undefined") return;
    const handle = document.createElement("button");
    handle.className = "tree-icon-btn tree-l3__drag-handle";
    const icon = document.createElement("span");
    handle.appendChild(icon);
    const row = document.createElement("div");
    row.className = "tree-l3";
    row.appendChild(handle);
    expect(isSessionAttachPointerStartTarget(icon)).toBe(true);
    expect(isSessionAttachPointerStartTarget(handle)).toBe(true);
    expect(isSessionAttachPointerStartTarget(row)).toBe(false);
    expect(isSessionAttachPointerStartTarget(null)).toBe(false);
  });
});

describe("createAttachDragClickGuard", () => {
  it("consumes the first click then later clicks are false", () => {
    const guard = createAttachDragClickGuard(400);
    guard.arm(1_000);
    expect(guard.consume(1_100)).toBe(true);
    expect(guard.consume(1_101)).toBe(false);
    expect(guard.consume(1_200)).toBe(false);
  });

  it("does not consume after the deadline (leftover flag cannot stick)", () => {
    const guard = createAttachDragClickGuard(400);
    guard.arm(1_000);
    expect(guard.consume(1_400)).toBe(false);
    expect(guard.consume(1_401)).toBe(false);
  });

  it("does not consume when never armed", () => {
    const guard = createAttachDragClickGuard(400);
    expect(guard.consume(1_000)).toBe(false);
  });
});

describe("armAttachDragClickBlocker", () => {
  it("prevents one click then lets the next through", () => {
    const guard = createAttachDragClickGuard(400);
    const listeners = new Set<(ev: Event) => void>();
    const timeouts: Array<() => void> = [];
    const host = {
      add: (_type: "click", fn: (ev: Event) => void) => {
        listeners.add(fn);
      },
      remove: (_type: "click", fn: (ev: Event) => void) => {
        listeners.delete(fn);
      },
      timeout: (fn: () => void) => {
        timeouts.push(fn);
      },
    };
    armAttachDragClickBlocker(guard, 1_000, host, 400);
    expect(ATTACH_DRAG_CLICK_GUARD_MS).toBe(400);

    const first = {
      prevented: false,
      stopped: false,
      preventDefault() {
        this.prevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
    };
    for (const fn of [...listeners]) fn(first as unknown as Event);
    expect(first.prevented).toBe(true);
    expect(first.stopped).toBe(true);

    const second = {
      prevented: false,
      stopped: false,
      preventDefault() {
        this.prevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
    };
    for (const fn of [...listeners]) fn(second as unknown as Event);
    expect(second.prevented).toBe(false);
    expect(second.stopped).toBe(false);
  });
});

describe("sessionAttachDropReadyFromPoint", () => {
  it("uses the hit node, not the pointer-capture target", () => {
    const hit = { id: "composer-child" } as unknown as Element;
    const composer = { contains: (n: Node) => n === (hit as Node) };
    expect(
      sessionAttachDropReadyFromPoint(10, 10, {
        composerEl: composer,
        zone: "sidebar",
        hit,
      }),
    ).toBe(true);
    expect(
      sessionAttachDropReadyFromPoint(10, 10, {
        composerEl: composer,
        zone: "sidebar",
        hit: { id: "elsewhere" } as unknown as Element,
      }),
    ).toBe(false);
  });
});
