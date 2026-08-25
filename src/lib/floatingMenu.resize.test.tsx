/**
 * @vitest-environment jsdom
 */

import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useFloatingMenu } from "./floatingMenu";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly targets: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  disconnect() {
    this.disconnected = true;
  }

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

it("observes a panel mounted after the first position pass", async () => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);

  let panelHeight = 120;
  function Harness({ open }: { open: boolean }) {
    const triggerRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const { pos } = useFloatingMenu({
      open,
      triggerRef,
      panelRef,
      onClose: () => undefined,
      placement: "up",
      width: 200,
      fitContent: false,
    });

    return (
      <>
        <div
          data-testid="trigger"
          ref={(node) => {
            triggerRef.current = node;
            if (!node) return;
            node.getBoundingClientRect = () =>
              ({
                top: 600,
                bottom: 636,
                left: 10,
                right: 210,
                width: 200,
                height: 36,
              }) as DOMRect;
          }}
        />
        {pos ? (
          <div
            data-testid="panel"
            ref={(node) => {
              panelRef.current = node;
              if (!node) return;
              Object.defineProperties(node, {
                offsetWidth: { configurable: true, get: () => 200 },
                offsetHeight: {
                  configurable: true,
                  get: () => panelHeight,
                },
              });
            }}
          />
        ) : null}
        <output data-testid="top">{pos?.top}</output>
      </>
    );
  }

  const view = render(<Harness open />);
  const trigger = screen.getByTestId("trigger");
  const panel = await screen.findByTestId("panel");
  const panelObserver = await waitFor(() => {
    const observer = FakeResizeObserver.instances.find((item) =>
      item.targets.includes(trigger) && item.targets.includes(panel),
    );
    expect(observer).toBeDefined();
    return observer!;
  });
  expect(screen.getByTestId("top").textContent).toBe("474");

  act(() => {
    panelHeight = 200;
    panelObserver.notify();
  });
  expect(screen.getByTestId("top").textContent).toBe("394");

  const openObservers = FakeResizeObserver.instances.slice();
  view.rerender(<Harness open={false} />);
  expect(openObservers.every((item) => item.disconnected)).toBe(true);

  view.rerender(<Harness open />);
  await screen.findByTestId("panel");
  const reopenedObservers = FakeResizeObserver.instances.filter(
    (item) => !item.disconnected,
  );
  view.unmount();
  expect(reopenedObservers.every((item) => item.disconnected)).toBe(true);
});
