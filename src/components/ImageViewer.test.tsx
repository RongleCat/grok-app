/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageViewerProvider } from "./ImageViewer";
import { useImageViewer, type ImageViewerApi } from "./ImageViewerContext";

const resolveImage = vi.hoisted(() =>
  vi.fn(async (src: string): Promise<string | null> => src),
);
const naturalSize = vi.hoisted(() => vi.fn(async () => ({ width: 640, height: 480 })));
const renderedLightbox = vi.hoisted(() => vi.fn());
vi.mock("@/lib/imageSrc", () => ({
  resolveImageSrc: resolveImage,
}));
vi.mock("@/lib/copyImage", () => ({
  copyImageFromPath: vi.fn(async () => ({ ok: true })),
  copyImageFromSrc: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/imageLightboxFit", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/imageLightboxFit")>(),
  loadImageNaturalSize: naturalSize,
}));
vi.mock("./ImageLightbox", () => ({
  ImageLightbox: (props: {
    open: boolean;
    slides: Array<{ src: string; originalStatus?: string }>;
    index: number;
    onView: (index: number) => void;
    onRetryOriginal: () => void;
  }) => {
    renderedLightbox(props);
    return (
      <div data-testid="viewer" data-open={String(props.open)}>
        {props.slides[props.index]?.src}
        <button
          type="button"
          aria-label="next"
          onClick={() => props.onView(props.index + 1)}
        />
        <button
          type="button"
          aria-label="retry"
          onClick={props.onRetryOriginal}
        />
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup() {
  let api!: ImageViewerApi;
  function Consumer() {
    api = useImageViewer();
    return null;
  }
  const view = render(<ImageViewerProvider locale="en"><Consumer /></ImageViewerProvider>);
  return { ...view, get api() { return api; } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function deferredOriginals(count: number) {
  return Array.from({ length: count }, (_, itemIndex) => {
    const pending = deferred<{ src: string; kind: "image" }>();
    const loadOriginal = vi.fn(() => pending.promise);
    return {
      slide: {
        src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
        loadOriginal,
      },
      loadOriginal,
      finish: () =>
        pending.resolve({
          src: "original-" + itemIndex + ".jpg",
          kind: "image",
        }),
      fail: () => pending.reject(new Error("download_failed")),
    };
  });
}

describe("ImageViewer lifecycle", () => {
  it("reports whether the lightbox currently owns the preview layer", async () => {
    const view = setup();
    expect(view.api.isOpen()).toBe(false);
    act(() => view.api.open(["image.jpg"]));
    await waitFor(() => expect(view.api.isOpen()).toBe(true));
    act(() => view.api.close());
    expect(view.api.isOpen()).toBe(false);
    view.unmount();
    expect(view.api.isOpen()).toBe(false);
  });

  it("does not reopen when path resolution completes after close", async () => {
    const pending = deferred<string | null>();
    resolveImage.mockReturnValueOnce(pending.promise);
    const view = setup();
    act(() => view.api.open(["old.jpg"]));
    act(() => view.api.close());
    await act(async () => pending.resolve("old.jpg"));
    expect(screen.queryByTestId("viewer")).toBeNull();
  });

  it("does not reopen when image dimensions complete after close", async () => {
    const pending = deferred<{ width: number; height: number }>();
    naturalSize.mockReturnValueOnce(pending.promise);
    const view = setup();
    act(() => view.api.open(["old.jpg"]));
    await waitFor(() => expect(naturalSize).toHaveBeenCalled());
    act(() => view.api.close());
    await act(async () => pending.resolve({ width: 640, height: 480 }));
    expect(screen.queryByTestId("viewer")).toBeNull();
  });

  it("keeps the newer gallery when an earlier open finishes last", async () => {
    const pending = deferred<string | null>();
    resolveImage.mockReturnValueOnce(pending.promise);
    const view = setup();
    act(() => view.api.open(["old.jpg"]));
    act(() => view.api.open(["new.jpg"]));
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("new.jpg"));
    await act(async () => pending.resolve("old.jpg"));
    expect(screen.getByTestId("viewer").textContent).toBe("new.jpg");
  });

  it("delivers open=false to the mounted lightbox so exit cleanup can run", async () => {
    const view = setup();
    act(() => view.api.open(["image.jpg"]));
    await waitFor(() => expect(screen.getByTestId("viewer").getAttribute("data-open")).toBe("true"));
    act(() => view.api.close());
    expect(screen.getByTestId("viewer").getAttribute("data-open")).toBe("false");
    act(() => view.api.open(["next.jpg"]));
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("next.jpg"));
    expect(screen.getByTestId("viewer").getAttribute("data-open")).toBe("true");
  });

  it("does not affect a new provider when an unmounted request completes", async () => {
    const pending = deferred<string | null>();
    resolveImage.mockReturnValueOnce(pending.promise);
    const old = setup();
    act(() => old.api.open(["old.jpg"]));
    old.unmount();
    const next = setup();
    act(() => next.api.open(["new.jpg"]));
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("new.jpg"));
    await act(async () => pending.resolve("old.jpg"));
    expect(screen.getByTestId("viewer").textContent).toBe("new.jpg");
  });

  it("opens a video slide without image decoding", async () => {
    const view = setup();
    act(() =>
      view.api.open([
        {
          src: "clip.mp4",
          kind: "video",
          mime: "video/mp4",
        },
      ]),
    );
    await waitFor(() => expect(view.api.isOpen()).toBe(true));
    const props = renderedLightbox.mock.calls.at(-1)?.[0] as {
      slides: Array<{ kind: string; mime?: string }>;
    };
    expect(props.slides[0]).toMatchObject({
      kind: "video",
      mime: "video/mp4",
    });
    expect(naturalSize).not.toHaveBeenCalled();
  });

  it("limits original downloads and starts only the latest queued slide", async () => {
    const originals = deferredOriginals(5);
    const view = setup();
    act(() => view.api.open(originals.map((entry) => entry.slide)));

    await waitFor(() =>
      expect(originals[0]?.loadOriginal).toHaveBeenCalledTimes(1),
    );
    for (let itemIndex = 1; itemIndex < originals.length; itemIndex += 1) {
      fireEvent.click(screen.getByRole("button", { name: "next" }));
    }
    expect(
      originals.map((entry) => entry.loadOriginal.mock.calls.length),
    ).toEqual([1, 1, 0, 0, 0]);

    await act(async () => originals[0]?.finish());
    await waitFor(() =>
      expect(originals[4]?.loadOriginal).toHaveBeenCalledTimes(1),
    );
    expect(originals[2]?.loadOriginal).not.toHaveBeenCalled();
    expect(originals[3]?.loadOriginal).not.toHaveBeenCalled();

    await act(async () => {
      originals[1]?.finish();
      originals[4]?.finish();
    });
    await waitFor(() =>
      expect(screen.getByTestId("viewer").textContent).toContain(
        "original-4.jpg",
      ),
    );
  });

  it("discards a queued original when the viewer closes", async () => {
    const originals = deferredOriginals(3);
    const view = setup();
    act(() => view.api.open(originals.map((entry) => entry.slide)));

    await waitFor(() =>
      expect(originals[0]?.loadOriginal).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    expect(originals[2]?.loadOriginal).not.toHaveBeenCalled();

    act(() => view.api.close());
    await act(async () => {
      originals[0]?.finish();
      originals[1]?.finish();
    });
    expect(originals[2]?.loadOriginal).not.toHaveBeenCalled();
  });

  it("ignores an original that settles after another gallery opens", async () => {
    const pending = deferred<{ src: string; kind: "image" }>();
    const loadOriginal = vi.fn(() => pending.promise);
    const view = setup();
    act(() => view.api.open([{ src: "thumbnail.jpg", loadOriginal }]));
    await waitFor(() => expect(loadOriginal).toHaveBeenCalledTimes(1));

    act(() => view.api.close());
    act(() => view.api.open(["new-gallery.jpg"]));
    await waitFor(() =>
      expect(screen.getByTestId("viewer").textContent).toContain(
        "new-gallery.jpg",
      ),
    );
    await act(async () =>
      pending.resolve({ src: "late-original.jpg", kind: "image" }),
    );
    expect(screen.getByTestId("viewer").textContent).toContain(
      "new-gallery.jpg",
    );
    expect(screen.getByTestId("viewer").textContent).not.toContain(
      "late-original.jpg",
    );
  });

  it("keeps the requested index when lazy slides share a placeholder", async () => {
    const firstOriginal = vi.fn(async () => ({
      src: "first-original.jpg",
      kind: "image" as const,
    }));
    const secondOriginal = vi.fn(async () => ({
      src: "second-original.jpg",
      kind: "image" as const,
    }));
    const placeholder =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    const view = setup();
    act(() =>
      view.api.open(
        [
          { src: placeholder, loadOriginal: firstOriginal },
          { src: placeholder, loadOriginal: secondOriginal },
        ],
        1,
      ),
    );

    await waitFor(() => expect(secondOriginal).toHaveBeenCalledTimes(1));
    expect(firstOriginal).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("viewer").textContent).toContain(
        "second-original.jpg",
      ),
    );
  });

  it("retains a thumbnail after failure and retries the original explicitly", async () => {
    const loadOriginal = vi
      .fn()
      .mockRejectedValueOnce(new Error("private upstream detail"))
      .mockResolvedValueOnce({ src: "original.jpg", kind: "image" as const });
    const view = setup();
    act(() =>
      view.api.open([
        {
          src: "thumbnail.jpg",
          loadOriginal,
          originalErrorMessage: () => "Friendly error",
        },
      ]),
    );

    await waitFor(() => {
      const props = renderedLightbox.mock.calls.at(-1)?.[0] as {
        slides: Array<{
          src: string;
          originalStatus?: string;
          originalError?: string;
        }>;
      };
      expect(props.slides[0]).toMatchObject({
        src: "thumbnail.jpg",
        originalStatus: "error",
        originalError: "Friendly error",
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    await waitFor(() => {
      const props = renderedLightbox.mock.calls.at(-1)?.[0] as {
        slides: Array<{ src: string; originalStatus?: string }>;
      };
      expect(props.slides[0]).toMatchObject({ src: "original.jpg" });
      expect(props.slides[0].originalStatus).toBeUndefined();
    });
    expect(loadOriginal).toHaveBeenCalledTimes(2);
  });
});
