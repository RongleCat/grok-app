import React, { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createT } from "@/i18n";
import { makeQueuedSend, type QueuedSend } from "@/lib/sendQueue";
import { ComposerQueue, type ComposerQueueProps } from "./ComposerQueue";

const item = makeQueuedSend({
  storedDisplay: "Use the existing component",
  attachments: [],
  goalMode: false,
  now: 123,
});

function queueProps(
  overrides: Partial<ComposerQueueProps> = {},
): ComposerQueueProps {
  return {
    items: [item],
    flushHold: false,
    guidingItemId: null,
    canGuide: true,
    tr: createT("en"),
    onClear: () => {},
    onRemove: () => {},
    onGuide: () => {},
    onRetry: () => {},
    ...overrides,
  };
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> {
  if (isValidElement<Record<string, unknown>>(node)) {
    if (predicate(node)) return node;
    const children = node.props.children;
    const childNodes = Array.isArray(children) ? children : [children];
    for (const child of childNodes) {
      try {
        return findElement(child as ReactNode, predicate);
      } catch {
        // Keep searching sibling branches.
      }
    }
  }
  throw new Error("matching element not found");
}

function renderQueue(overrides: Partial<ComposerQueueProps> = {}) {
  return ComposerQueue(queueProps(overrides));
}

function guideButton(overrides: Partial<ComposerQueueProps> = {}) {
  return findElement(
    renderQueue(overrides),
    (element) => element.props["data-testid"] === "queue-guide",
  );
}

describe("ComposerQueue", () => {
  it("keeps follow-ups above the composer and exposes a Steer action", () => {
    const html = renderToString(
      React.createElement(ComposerQueue, queueProps()),
    );

    expect(html).toContain('data-testid="composer-queue"');
    expect(html).toContain("Use the existing component");
    expect(html).toContain('data-testid="queue-guide"');
    expect(html).toContain("Steer");
    expect(html).not.toContain("queued-guidance");
  });

  it("shows the retry action while queue flushing is held", () => {
    const html = renderToString(
      React.createElement(ComposerQueue, queueProps({ flushHold: true })),
    );

    expect(html).toContain('class="composer__queue-hold"');
    expect(html).toContain('class="composer__queue-hold-retry"');
    expect(html).toContain("Retry");
  });

  it("disables Steer and explains why outside active generation", () => {
    const button = guideButton({ canGuide: false });

    expect(button.props.disabled).toBe(true);
    expect(button.props.title).toBe(
      "Steer is available only while the agent is generating",
    );
    expect(button.props["aria-label"]).toBe(
      "Steer is available only while the agent is generating",
    );
  });

  it("disables Steer while another queue item is being guided", () => {
    const button = guideButton({ guidingItemId: item.id });

    expect(button.props.disabled).toBe(true);
    expect(button.props.title).toBe("Steering…");
    expect(button.props.children).toBe("Steering…");
  });

  it("invokes onGuide with the clicked queue item", () => {
    const onGuide = vi.fn<(guidedItem: QueuedSend) => void>();
    const button = guideButton({ onGuide });
    const onClick = button.props.onClick as () => void;

    onClick();

    expect(onGuide).toHaveBeenCalledOnce();
    expect(onGuide).toHaveBeenCalledWith(item);
  });
});
