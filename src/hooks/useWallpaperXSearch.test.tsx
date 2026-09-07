/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useWallpaperXSearch, type WallpaperXSearchClient } from "./useWallpaperXSearch";
import type { WallpaperSearchResult } from "@/lib/wallpaperSource";
import type { WallpaperXSearchProgress, WallpaperXSearchBatch } from "@/lib/wallpaperXSearch";

afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  let emitBatch!: (event: WallpaperXSearchBatch) => void;
  let emit!: (event: WallpaperXSearchProgress) => void;
  const unlisten = vi.fn();
  const client: WallpaperXSearchClient = {
    listenBatch: vi.fn(async (handler) => { emitBatch = handler; return () => {}; }),
    search: vi.fn(), cancel: vi.fn(async () => true),
    listenProgress: vi.fn(async (handler) => { emit = handler; return unlisten; }),
  };
  let nextId = 0;
  const hook = renderHook(() => useWallpaperXSearch(client, () => String(++nextId)));
  return { client, hook, unlisten, emitBatch: (event: WallpaperXSearchBatch) => emitBatch(event), emit: (event: WallpaperXSearchProgress) => emit(event) };
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

function batch(requestId: string, batchIndex: number, ids: string[], done = false): WallpaperXSearchBatch {
  return { requestId, batchIndex, done, accumulatedCount: ids.length,
    items: ids.map(id => ({ id, source: "x", kind: "image", fullUrl: `https://pbs.twimg.com/media/${id}.jpg`, thumbUrl: `https://pbs.twimg.com/media/${id}.jpg` })) };
}

it("shows out-of-order batches once and ignores foreign, malformed and cancelled batches", async () => {
  const h = harness();
  const pending = deferred<WallpaperSearchResult>();
  vi.mocked(h.client.search).mockReturnValue(pending.promise);
  let result!: Promise<WallpaperSearchResult | null>;
  act(() => { result = h.hook.result.current.search("sky", "top"); });
  act(() => {
    h.emitBatch(batch("other", 1, ["foreign"]));
    h.emitBatch({ ...batch("1", 1, ["bad"]), batchIndex: -1 });
    h.emitBatch(batch("1", 2, ["b", "shared"]));
    h.emitBatch(batch("1", 2, ["duplicate-event"]));
    h.emitBatch(batch("1", 1, ["a", "shared"], true));
  });
  expect(h.hook.result.current.progressiveItems.map(item => item.id)).toEqual(["b", "shared", "a"]);
  expect(h.hook.result.current.busy).toBe(true);
  await act(async () => { await h.hook.result.current.cancel(); });
  act(() => h.emitBatch(batch("1", 3, ["late"], true)));
  expect(h.hook.result.current.progressiveItems).toEqual([]);
  await act(async () => { pending.resolve({ items: [] }); expect(await result).toBeNull(); });
});

it("resets batches for replacement and trusts the final invoke result", async () => {
  const h = harness();
  const first = deferred<WallpaperSearchResult>();
  const second = deferred<WallpaperSearchResult>();
  vi.mocked(h.client.search).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  let a!: Promise<WallpaperSearchResult | null>;
  let b!: Promise<WallpaperSearchResult | null>;
  act(() => { a = h.hook.result.current.search("sky", "top"); });
  act(() => h.emitBatch(batch("1", 1, ["old"])));
  act(() => { b = h.hook.result.current.search("sea", "top"); });
  expect(h.hook.result.current.progressiveItems).toEqual([]);
  act(() => { h.emitBatch(batch("1", 2, ["late"])); h.emitBatch(batch("2", 1, ["preview"])); });
  const final = { items: batch("2", 1, ["final"]).items };
  await act(async () => { first.resolve({ items: [] }); second.resolve(final); expect(await a).toBeNull(); expect(await b).toEqual(final); });
  expect(h.hook.result.current.busy).toBe(false);
  act(() => h.emitBatch(batch("2", 2, ["too-late"])));
  expect(h.hook.result.current.progressiveItems.map(item => item.id)).toEqual(["preview"]);
});
