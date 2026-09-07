/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageViewerProvider } from "./ImageViewer";
import { useImageViewer, type ImageViewerApi } from "./ImageViewerContext";

const resolveImages = vi.hoisted(() => vi.fn(async (paths: string[]) =>
  paths.map((path) => ({ path, src: path })),
));
const naturalSize = vi.hoisted(() => vi.fn(async () => ({ width: 640, height: 480 })));
vi.mock("@/lib/imageSrc", () => ({
  resolveImageSrcs: resolveImages,
  resolveImageSrc: vi.fn(async (src: string) => src),
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
  ImageLightbox: ({ open, slides }: { open: boolean; slides: { src: string }[] }) => (
    <div data-testid="viewer" data-open={String(open)}>{slides[0]?.src}</div>
  ),
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
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

describe("ImageViewer lifecycle", () => {
  it("does not reopen when path resolution completes after close", async () => {
    const pending = deferred<Awaited<ReturnType<typeof resolveImages>>>();
    resolveImages.mockReturnValueOnce(pending.promise);
    const view = setup();
    act(() => view.api.open(["old.jpg"]));
    act(() => view.api.close());
    await act(async () => pending.resolve([{ path: "old.jpg", src: "old.jpg" }]));
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
    const pending = deferred<Awaited<ReturnType<typeof resolveImages>>>();
    resolveImages.mockReturnValueOnce(pending.promise);
    const view = setup();
    act(() => view.api.open(["old.jpg"]));
    act(() => view.api.open(["new.jpg"]));
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("new.jpg"));
    await act(async () => pending.resolve([{ path: "old.jpg", src: "old.jpg" }]));
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
    const pending = deferred<Awaited<ReturnType<typeof resolveImages>>>();
    resolveImages.mockReturnValueOnce(pending.promise);
    const old = setup();
    act(() => old.api.open(["old.jpg"]));
    old.unmount();
    const next = setup();
    act(() => next.api.open(["new.jpg"]));
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("new.jpg"));
    await act(async () => pending.resolve([{ path: "old.jpg", src: "old.jpg" }]));
    expect(screen.getByTestId("viewer").textContent).toBe("new.jpg");
  });
});
