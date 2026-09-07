/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";

const progressive = vi.hoisted(() => ({ items: [] as Array<{ id: string; source: string; kind: string; fullUrl: string; thumbUrl: string; textPreview: string }> }));
const cancelSearch = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/hooks/useWallpaperXSearch", () => ({
  useWallpaperXSearch: () => ({
    progressiveItems: progressive.items,
    busy: true,
    requestId: "request-active",
    stage: "validating",
    search: vi.fn(),
    cancel: cancelSearch,
  }),
}));

vi.mock("@/lib/api", () => ({
  wallpaperRemoteSearch: vi.fn(),
  wallpaperRemoteSearchMore: vi.fn(),
  wallpaperRemoteSearchCancel: vi.fn(async () => true),
  listenWallpaperRemoteSearchProgress: vi.fn(async () => () => {}),
  listenWallpaperRemoteSearchBatch: vi.fn(async () => () => {}),
  wallpaperRemoteCancelMediaRequests: vi.fn(async () => 0),
  wallpaperGrokAlbumCancelRequests: vi.fn(async () => 0),
  wallpaperGrokAlbumCancelAllRequests: vi.fn(async () => 0),
  isDesktopHost: () => true,
  settingsGet: vi.fn(async () => ({ wallpaperXSearchMode: "cli" })),
  settingsSet: vi.fn(async () => ({})),
  wallpaperFetchMedia: vi.fn(),
  wallpaperImagine: vi.fn(),
  wallpaperLibraryList: vi.fn(),
  wallpaperLibraryDelete: vi.fn(),
  openExternalUrl: vi.fn(),
}));

vi.mock("@/components/ImageViewerContext", () => ({
  useImageViewerOptional: () => ({ open: vi.fn() }),
}));

vi.mock("@/components/Select", () => ({
  Select: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock("@/components/GlassModal", () => ({
  GlassModal: ({
    open,
    onClose,
    children,
    footer,
  }: {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    open ? (
      <div>
        <button type="button" onClick={onClose}>
          modal-close
        </button>
        {children}
        {footer}
      </div>
    ) : null,
}));

import { WallpaperSourceModal } from "./WallpaperSourceModal";

afterEach(() => {
  cleanup();
  cancelSearch.mockClear();
  progressive.items = [];
});

describe("WallpaperSourceModal X search lifecycle", () => {
  const t = (key: string) => key;

  it("shows real progress and exposes an explicit cancel-search action", () => {
    render(
      <WallpaperSourceModal
        open
        t={t as never}
        onClose={vi.fn()}
        onPickFile={vi.fn()}
      />,
    );

    expect(
      screen.getByText("settings.wallpaperSource.progress.validating"),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.cancelSearch",
      }),
    );
    expect(cancelSearch).toHaveBeenCalledTimes(1);
  });

  it("cancels an active X search when switching tabs or closing", () => {
    const onClose = vi.fn();
    render(
      <WallpaperSourceModal
        open
        t={t as never}
        onClose={onClose}
        onPickFile={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("tab", { name: "settings.wallpaperImagine" }),
    );
    expect(cancelSearch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "modal-close" }));
    expect(cancelSearch).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

it("renders validated batches while the request is still running", () => {
  progressive.items = [{ id: "early", source: "x", kind: "image", fullUrl: "https://pbs.twimg.com/media/early.jpg", thumbUrl: "https://pbs.twimg.com/media/early.jpg", textPreview: "Early mountain image" }];
  render(<WallpaperSourceModal open t={((key: string) => key) as never} onClose={vi.fn()} onPickFile={vi.fn()} />);
  expect(screen.getByRole("list").getAttribute("aria-busy")).toBe("true");
  expect(screen.getByRole("img").getAttribute("src")).toBe("https://pbs.twimg.com/media/early.jpg");
});
