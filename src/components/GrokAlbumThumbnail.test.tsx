/**
 * @vitest-environment jsdom
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const peekThumbnail = vi.hoisted(() => vi.fn());
const resolveThumbnail = vi.hoisted(() => vi.fn());
const forgetThumbnail = vi.hoisted(() => vi.fn());
const subscribeThumbnail = vi.hoisted(() => vi.fn());

vi.mock("@/lib/grokAlbumThumbnail", () => ({
  peekGrokAlbumThumbnail: peekThumbnail,
  resolveGrokAlbumThumbnail: resolveThumbnail,
  forgetGrokAlbumThumbnail: forgetThumbnail,
  subscribeGrokAlbumThumbnail: subscribeThumbnail,
}));

import { GrokAlbumThumbnail } from "./GrokAlbumThumbnail";

const URL =
  "https://assets.grok.com/users/test/generated/example/image.jpg?cache=1";
const DATA_URL = `data:image/jpeg;base64,${"A".repeat(64)}`;
let cachedThumbnail: string | null = null;
const cacheListeners = new Set<() => void>();

function publishThumbnail(value: string | null): void {
  cachedThumbnail = value;
  for (const listener of Array.from(cacheListeners)) listener();
}

beforeEach(() => {
  peekThumbnail.mockReset();
  resolveThumbnail.mockReset();
  forgetThumbnail.mockReset();
  subscribeThumbnail.mockReset();
  cachedThumbnail = null;
  cacheListeners.clear();
  peekThumbnail.mockImplementation(() => cachedThumbnail);
  subscribeThumbnail.mockImplementation(
    (_url: string, listener: () => void) => {
      cacheListeners.add(listener);
      return () => cacheListeners.delete(listener);
    },
  );
  forgetThumbnail.mockImplementation(() => publishThumbnail(null));
});

afterEach(() => cleanup());

describe("GrokAlbumThumbnail", () => {
  it("keeps a stable placeholder until the Host thumbnail is ready", async () => {
    let finishRequest: (() => void) | null = null;
    resolveThumbnail.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishRequest = () => {
            publishThumbnail(DATA_URL);
            resolve(DATA_URL);
          };
        }),
    );
    const view = render(
      <GrokAlbumThumbnail
        url={URL}
        alt="saved image"
        width={1920}
        height={1080}
      />,
    );

    expect(
      view.container.querySelector('[data-state="loading"]'),
    ).toBeTruthy();
    await act(async () => finishRequest?.());
    const image = await screen.findByRole("img", { name: "saved image" });
    expect(image.getAttribute("src")).toBe(DATA_URL);
  });

  it("shows a stable failed placeholder instead of deleting the card", async () => {
    resolveThumbnail.mockImplementation(async () => {
      publishThumbnail(DATA_URL);
      return DATA_URL;
    });
    const view = render(<GrokAlbumThumbnail url={URL} alt="saved image" />);
    const image = await screen.findByRole("img", { name: "saved image" });

    resolveThumbnail.mockResolvedValue(null);
    fireEvent.error(image);
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-state="failed"]'),
      ).toBeTruthy(),
    );
    expect(forgetThumbnail).toHaveBeenCalledWith(URL);
  });

  it("shows a thumbnail that a later background warmup adds to the cache", async () => {
    resolveThumbnail.mockResolvedValue(null);
    const view = render(<GrokAlbumThumbnail url={URL} alt="saved image" />);

    await waitFor(() =>
      expect(
        view.container.querySelector('[data-state="failed"]'),
      ).toBeTruthy(),
    );

    await act(async () => publishThumbnail(DATA_URL));

    const image = await screen.findByRole("img", { name: "saved image" });
    expect(image.getAttribute("src")).toBe(DATA_URL);
  });
});
