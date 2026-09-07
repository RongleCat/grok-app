/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageKey } from "@/i18n";
import { GrokAlbumSourcePanel } from "./GrokAlbumSourcePanel";

afterEach(cleanup);

describe("GrokAlbumSourcePanel", () => {
  it("shows only the contextual actions for each official-page state", () => {
    const props = {
      t: (key: MessageKey) => key,
      busy: false,
      syncing: false,
      cachedCount: 0,
      visibleCount: 0,
      errorCode: null,
      onOpen: vi.fn(),
      onSync: vi.fn(),
      onRefresh: vi.fn(),
    };
    const view = render(
      <GrokAlbumSourcePanel {...props} status="other_page" />,
    );

    expect(
      screen.queryByText("settings.wallpaperSource.grokAlbum.beta"),
    ).toBeNull();
    expect(
      screen.getByLabelText("settings.wallpaperSource.grokAlbum.privacy"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "settings.wallpaperSource.grokAlbum.sync",
      }),
    ).toBeNull();
    const backToSaved = screen.getByRole("button", {
      name: "settings.wallpaperSource.grokAlbum.backToSaved",
    }) as HTMLButtonElement;
    expect(backToSaved.disabled).toBe(false);
    fireEvent.click(backToSaved);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(props.onOpen).not.toHaveBeenCalled();

    view.rerender(<GrokAlbumSourcePanel {...props} status="verification" />);
    expect(
      screen.getByText(
        "settings.wallpaperSource.grokAlbum.status.verification",
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.grokAlbum.viewSaved",
      }),
    );
    expect(props.onOpen).toHaveBeenCalledTimes(1);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);

    view.rerender(
      <GrokAlbumSourcePanel
        {...props}
        status="ready"
        cachedCount={48}
        visibleCount={20}
      />,
    );
    expect(
      screen.getByRole("status", {
        name:
          "settings.wallpaperSource.grokAlbum.status.ready · " +
          "settings.wallpaperSource.grokAlbum.count",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByText("settings.wallpaperSource.grokAlbum.status.ready"),
    ).toBeNull();
    expect(
      screen.getByText("settings.wallpaperSource.grokAlbum.count"),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "settings.wallpaperSource.grokAlbum.sync",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.grokAlbum.viewSaved",
      }),
    ).toBeTruthy();
  });
});
