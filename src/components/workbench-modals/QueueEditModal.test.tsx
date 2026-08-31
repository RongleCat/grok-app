/**
 * @vitest-environment jsdom
 */
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  nativeWebviewCoverDepth,
  resetNativeWebviewCoverForTests,
} from "@/lib/nativeWebviewCover";
import { QueueEditModal } from "./QueueEditModal";

beforeEach(() => {
  resetNativeWebviewCoverForTests();
});

afterEach(() => {
  cleanup();
  resetNativeWebviewCoverForTests();
});

function modalProps(open: boolean) {
  return {
    locale: "en" as const,
    open,
    text: "queued message",
    textareaRef: createRef<HTMLTextAreaElement>(),
    onTextChange: vi.fn(),
    onClose: vi.fn(),
    onSave: vi.fn(),
  };
}

describe("QueueEditModal native webview cover", () => {
  it("covers the native browser only while the queue editor is open", () => {
    const { rerender } = render(<QueueEditModal {...modalProps(false)} />);
    expect(nativeWebviewCoverDepth()).toBe(0);

    rerender(<QueueEditModal {...modalProps(true)} />);
    expect(nativeWebviewCoverDepth()).toBe(1);

    rerender(<QueueEditModal {...modalProps(false)} />);
    expect(nativeWebviewCoverDepth()).toBe(0);
  });

  it("keeps the browser covered until the last stacked editor unmounts", () => {
    const { rerender, unmount } = render(
      <>
        <QueueEditModal {...modalProps(true)} />
        <QueueEditModal {...modalProps(true)} />
      </>,
    );
    expect(nativeWebviewCoverDepth()).toBe(2);

    rerender(
      <>
        <QueueEditModal {...modalProps(false)} />
        <QueueEditModal {...modalProps(true)} />
      </>,
    );
    expect(nativeWebviewCoverDepth()).toBe(1);

    unmount();
    expect(nativeWebviewCoverDepth()).toBe(0);
  });
});
