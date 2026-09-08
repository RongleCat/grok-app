/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";
import type { WallpaperLibraryPage } from "@/lib/api/wallpaper";

const mocks = vi.hoisted(() => ({
  page: vi.fn(),
  preview: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  wallpaperLibraryPage: mocks.page,
  wallpaperLibraryDelete: vi.fn(),
  wallpaperRemoteSearch: vi.fn(),
  wallpaperRemoteSearchMore: vi.fn(),
  wallpaperRemoteSearchCancel: vi.fn(async () => true),
  listenWallpaperRemoteSearchProgress: vi.fn(async () => () => {}),
  listenWallpaperRemoteSearchBatch: vi.fn(async () => () => {}),
  wallpaperRemoteCancelMediaRequests: vi.fn(async () => 0),
  wallpaperGrokAlbumCancelRequests: vi.fn(async () => 0),
  wallpaperGrokAlbumCancelAllRequests: vi.fn(async () => 0),
  isDesktopHost: () => true,
  isTauri: () => false,
  settingsGet: vi.fn(async () => ({ wallpaperXSearchMode: "cli" })),
  settingsSet: vi.fn(async () => ({})),
  wallpaperXSearch: vi.fn(),
  wallpaperXSearchMore: vi.fn(),
  wallpaperXSearchCancel: vi.fn(async () => true),
  listenWallpaperXSearchProgress: vi.fn(async () => () => {}),
  listenWallpaperXSearchBatch: vi.fn(async () => () => {}),
  wallpaperFetchMedia: vi.fn(),
  wallpaperImagine: vi.fn(),
  openExternalUrl: vi.fn(),
}));

vi.mock("@/components/ImageViewerContext", () => ({
  useImageViewerOptional: () => ({ open: mocks.preview }),
}));

vi.mock("@/components/Select", () => ({
  Select: ({
    value,
    options,
    onChange,
    "aria-label": ariaLabel,
  }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("@/components/GlassModal", () => ({
  GlassModal: ({
    open,
    children,
    footer,
  }: {
    open: boolean;
    children: ReactNode;
    footer?: ReactNode;
  }) => (open ? <div>{children}{footer}</div> : null),
}));

import { WallpaperSourceModal } from "./WallpaperSourceModal";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function page(name: string, nextCursor: string | null = null): WallpaperLibraryPage {
  return {
    items: [
      {
        path: `C:/wallpapers/${name}.png`,
        name,
        source: "library",
        kind: "image",
        bytes: 100,
        modifiedMs: 1,
      },
    ],
    nextCursor,
    total: 2,
    kindCounts: { all: 2, image: 2, video: 0 },
  };
}

const t = (key: string) => key;
const cards = () =>
  screen.getAllByRole("button", {
    name: "settings.wallpaperSource.openPreview",
  });

function renderLibrary() {
  return render(
    <WallpaperSourceModal
      open
      initialTab="library"
      t={t as never}
      onClose={vi.fn()}
      onPickFile={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WallpaperSourceModal library paging", () => {
  it("keeps loaded cards selectable while the next page is pending", async () => {
    const pending = deferred<WallpaperLibraryPage>();
    mocks.page
      .mockResolvedValueOnce(page("first", "cursor-1"))
      .mockReturnValueOnce(pending.promise);
    renderLibrary();

    const loadMore = await screen.findByRole("button", {
      name: "settings.wallpaperSource.loadMore",
    });
    fireEvent.click(loadMore);
    await waitFor(() => expect(mocks.page).toHaveBeenCalledTimes(2));

    expect((cards()[0] as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(cards()[0]);
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));

    pending.resolve(page("second"));
    await waitFor(() => expect(cards()).toHaveLength(2));
  });

  it("sends text, kind, and collection filters to the Host", async () => {
    mocks.page.mockResolvedValue(page("result"));
    renderLibrary();
    await waitFor(() =>
      expect(mocks.page).toHaveBeenCalledWith({ query: "", kind: "all" }),
    );

    fireEvent.change(
      screen.getByPlaceholderText("settings.wallpaperSource.filterPlaceholder"),
      { target: { value: "mountain" } },
    );
    await waitFor(() =>
      expect(mocks.page).toHaveBeenCalledWith({
        query: "mountain",
        kind: "all",
      }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /settings\.wallpaperSource\.kind\.image/,
      }),
    );
    await waitFor(() =>
      expect(mocks.page).toHaveBeenCalledWith({
        query: "mountain",
        kind: "image",
      }),
    );

    fireEvent.change(
      screen.getByLabelText("settings.wallpaperSource.library.collection"),
      { target: { value: "favorites" } },
    );
    await waitFor(() =>
      expect(mocks.page).toHaveBeenCalledWith({
        query: "mountain",
        kind: "image",
        purpose: "favorites",
      }),
    );
  });
});
