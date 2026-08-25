/**
 * @vitest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useFloatingMenu } from "./floatingMenu";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly targets: Element[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  disconnect() {}

  notify() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

afterEach(() => {
  FakeResizeObserver.instances = [];
  vi.unstubAllGlobals();
});

it("remeasures a matched panel when its trigger width changes", () => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);

  let width = 208;
  const trigger = document.createElement("div");
  const panel = document.createElement("div");
  trigger.getBoundingClientRect = () =>
    ({
      top: 600,
      bottom: 636,
      left: 10,
      right: 10 + width,
      width,
      height: 36,
    }) as DOMRect;
  Object.defineProperties(panel, {
    offsetWidth: { value: 208 },
    offsetHeight: { value: 260 },
  });

  const { result } = renderHook(() =>
    useFloatingMenu({
      open: true,
      triggerRef: { current: trigger },
      panelRef: { current: panel },
      onClose: () => undefined,
      placement: "up",
      width: 0,
      fitContent: false,
      matchTriggerWidth: true,
    }),
  );

  const observer = FakeResizeObserver.instances.find((item) =>
    item.targets.includes(trigger),
  );
  expect(observer).toBeDefined();
  expect(result.current.style?.width).toBe(208);

  act(() => {
    width = 320;
    observer?.notify();
  });

  expect(result.current.style?.width).toBe(320);
});
