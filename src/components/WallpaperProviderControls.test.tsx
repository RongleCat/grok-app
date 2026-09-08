/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";

const api = vi.hoisted(() => ({
  secretsGetMasked: vi.fn(),
  secretsSet: vi.fn(),
}));

vi.mock("@/lib/api", () => api);
vi.mock("@/components/GlassModal", () => ({
  GlassModal: ({
    open,
    children,
    footer,
  }: {
    open: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) => (open ? <div role="dialog">{children}{footer}</div> : null),
}));

import { WallpaperProviderControls } from "./WallpaperProviderControls";

const t = (key: string) => key;

function renderControls({ invalidKey = false } = {}) {
  const onSaved = vi.fn();
  const search = vi.fn(async () => undefined);
  render(
    <WallpaperProviderControls
      source="pexels"
      query="aurora"
      busy={false}
      locked={false}
      invalidKey={invalidKey}
      t={t as never}
      setQuery={vi.fn()}
      search={search}
      cancel={vi.fn(async () => true)}
      onSaved={onSaved}
    />,
  );
  return { onSaved, search };
}

beforeEach(() => {
  api.secretsGetMasked.mockReset();
  api.secretsSet.mockReset();
});

afterEach(cleanup);

describe("WallpaperProviderControls", () => {
  it("searches Web without reading Pexels credentials", async () => {
    const search = vi.fn(async () => undefined);
    render(
      <WallpaperProviderControls
        source="web"
        query="misty forest"
        busy={false}
        locked={false}
        invalidKey={false}
        t={t as never}
        setQuery={vi.fn()}
        search={search}
        cancel={vi.fn(async () => true)}
        onSaved={vi.fn()}
      />,
    );

    expect(api.secretsGetMasked).not.toHaveBeenCalled();
    expect(
      screen.getByPlaceholderText("settings.wallpaperSource.web.placeholder"),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.search",
      }),
    );
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
  });

  it("uses the Openverse-specific search placeholder", () => {
    render(
      <WallpaperProviderControls
        source="openverse"
        query="alpine lake"
        busy={false}
        locked={false}
        invalidKey={false}
        t={t as never}
        setQuery={vi.fn()}
        search={vi.fn(async () => undefined)}
        cancel={vi.fn(async () => true)}
        onSaved={vi.fn()}
      />,
    );

    expect(api.secretsGetMasked).not.toHaveBeenCalled();
    expect(
      screen.getByPlaceholderText(
        "settings.wallpaperSource.openverse.placeholder",
      ),
    ).toBeTruthy();
  });

  it("keeps Pexels search disabled when credential status cannot be read", async () => {
    api.secretsGetMasked.mockRejectedValue(new Error("unavailable"));
    renderControls();

    await screen.findByRole("alert");
    const searchButton = screen.getByRole("button", {
      name: "settings.wallpaperSource.search",
    }) as HTMLButtonElement;
    expect(searchButton.disabled).toBe(true);
  });

  it("clears a saved key only after confirmation and disables search", async () => {
    api.secretsGetMasked.mockResolvedValue({ hasPexelsKey: true });
    api.secretsSet.mockResolvedValue(undefined);
    const { onSaved } = renderControls();

    await screen.findByText("settings.wallpaperSource.pexels.keySaved");
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.pexels.keyDelete",
      }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.pexels.keyDeleteConfirm",
      }),
    );

    await waitFor(() =>
      expect(api.secretsSet).toHaveBeenCalledWith({ pexelsApiKey: "" }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    const searchButton = screen.getByRole("button", {
      name: "settings.wallpaperSource.search",
    }) as HTMLButtonElement;
    expect(searchButton.disabled).toBe(true);
  });

  it("accepts a replacement key and clears the parent error state", async () => {
    api.secretsGetMasked.mockResolvedValue({ hasPexelsKey: true });
    api.secretsSet.mockResolvedValue(undefined);
    const { onSaved } = renderControls({ invalidKey: true });

    const input = await screen.findByLabelText(
      "settings.wallpaperSource.pexels.keyPlaceholder",
    );
    fireEvent.change(input, { target: { value: "replacement-test-key" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.pexels.keySave",
      }),
    );

    await waitFor(() =>
      expect(api.secretsSet).toHaveBeenCalledWith({
        pexelsApiKey: "replacement-test-key",
      }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed key removal after closing the confirmation", async () => {
    api.secretsGetMasked.mockResolvedValue({ hasPexelsKey: true });
    api.secretsSet.mockRejectedValue(new Error("write failed"));
    renderControls();

    await screen.findByText("settings.wallpaperSource.pexels.keySaved");
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.pexels.keyDelete",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.wallpaperSource.pexels.keyDeleteConfirm",
      }),
    );

    await screen.findByText(
      "settings.wallpaperSource.pexels.keyDeleteFailed",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
