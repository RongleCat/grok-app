/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";

const cancelSearch = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/hooks/useWallpaperXSearch", () => ({
  useWallpaperXSearch: () => ({
    busy: true,
    requestId: "request-active",
    stage: "validating",
    search: vi.fn(),
    cancel: cancelSearch,
  }),
}));

vi.mock("@/lib/api", () => ({
  isDesktopHost: () => true,
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
