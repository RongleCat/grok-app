/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWallpaperXSearch, type WallpaperXSearchClient } from "./useWallpaperXSearch";
import type { WallpaperSearchResult } from "@/lib/wallpaperSource";
import type { WallpaperXSearchProgress } from "@/lib/wallpaperXSearch";

afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  let emit!: (event: WallpaperXSearchProgress) => void;
  const unlisten = vi.fn();
  const client: WallpaperXSearchClient = {
    search: vi.fn(), cancel: vi.fn(async () => true),
    listenProgress: vi.fn(async (handler) => { emit = handler; return unlisten; }),
  };
  let nextId = 0;
  const hook = renderHook(() => useWallpaperXSearch(client, () => String(++nextId)));
  return { client, hook, unlisten, emit: (event: WallpaperXSearchProgress) => emit(event) };
}

it("accepts progress only for the active request and ignores late success after cancel", async () => {
  const h = harness();
  const pending = deferred<WallpaperSearchResult>();
  vi.mocked(h.client.search).mockReturnValue(pending.promise);
  let result!: Promise<WallpaperSearchResult | null>;
  act(() => { result = h.hook.result.current.search("sky", "top"); });
  act(() => h.emit({ requestId: "other", stage: "validating" }));
  expect(h.hook.result.current.stage).toBe("preparing");
  act(() => h.emit({ requestId: "1", stage: "validating" }));
  expect(h.hook.result.current.stage).toBe("validating");
  await act(async () => { await h.hook.result.current.cancel(); });
  expect(h.hook.result.current.busy).toBe(false);
  await act(async () => { pending.resolve({ items: [] }); expect(await result).toBeNull(); });
  expect(h.client.cancel).toHaveBeenCalledWith("1");
});

it("starts replacements without waiting for cancel and rejects their late errors", async () => {
  const h = harness();
  const calls = [deferred<WallpaperSearchResult>(), deferred<WallpaperSearchResult>(), deferred<WallpaperSearchResult>()];
  const cancelAck = deferred<boolean>();
  vi.mocked(h.client.cancel).mockReturnValue(cancelAck.promise);
  calls.forEach(call => vi.mocked(h.client.search).mockReturnValueOnce(call.promise));
  const results: Promise<WallpaperSearchResult | null>[] = [];
  act(() => { for (let i = 0; i < 3; i++) results.push(h.hook.result.current.search(String(i), "top")); });
  expect(h.client.search).toHaveBeenCalledTimes(3);
  await act(async () => {
    calls[0].reject(new Error("old failure")); calls[1].resolve({ items: [] });
    expect(await results[0]).toBeNull(); expect(await results[1]).toBeNull();
  });
  expect(h.hook.result.current.busy).toBe(true);
  await act(async () => { calls[2].resolve({ items: [] }); expect(await results[2]).toEqual({ items: [] }); cancelAck.resolve(true); });
  expect(h.hook.result.current.busy).toBe(false);
});

it("unmount cancels the Host and late listener registration cleans itself up", async () => {
  const h = harness();
  const pending = deferred<WallpaperSearchResult>();
  vi.mocked(h.client.search).mockReturnValue(pending.promise);
  let result!: Promise<WallpaperSearchResult | null>;
  act(() => { result = h.hook.result.current.search("sky", "top"); });
  h.hook.unmount();
  expect(h.client.cancel).toHaveBeenCalledWith("1");
  pending.resolve({ items: [] });
  expect(await result).toBeNull();
  await Promise.resolve();
  expect(h.unlisten).toHaveBeenCalledTimes(1);
});
