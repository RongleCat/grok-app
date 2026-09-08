/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createT } from "@/i18n";
import type {
  WallpaperGalleryItem,
  WallpaperSearchResult,
} from "@/lib/wallpaperSource";
import { useWallpaperImagineController } from "./useWallpaperImagineController";

const wallpaperImagine = vi.hoisted(() => vi.fn());
const wallpaperImageEdit = vi.hoisted(() => vi.fn());
const pickAttachFiles = vi.hoisted(() => vi.fn());
const wallpaperImportImage = vi.hoisted(() => vi.fn());
const wallpaperImageToVideo = vi.hoisted(() => vi.fn());
const wallpaperImageToVideoCancel = vi.hoisted(() => vi.fn(async () => true));
const ensureLocalWallpaperMedia = vi.hoisted(() => vi.fn());
const cancelRemoteWallpaperMediaRequests = vi.hoisted(() =>
  vi.fn(async () => undefined),
);
const cancelGrokAlbumMediaRequests = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  isDesktopHost: () => true,
  wallpaperImagine,
  wallpaperImageEdit,
  pickAttachFiles,
  wallpaperImportImage,
  wallpaperImageToVideo,
  wallpaperImageToVideoCancel,
}));

vi.mock("@/lib/wallpaperSourceMedia", () => ({
  ensureLocalWallpaperMedia,
  cancelRemoteWallpaperMediaRequests,
  cancelGrokAlbumMediaRequests,
}));

vi.mock("@/lib/grokAlbumThumbnail", () => ({
  peekGrokAlbumThumbnail: () => null,
}));

vi.mock("@/lib/remoteWallpaperThumbnail", () => ({
  peekRemoteWallpaperThumbnail: () => "data:image/jpeg;base64,preview",
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function imageItem(
  id: string,
  extra: Partial<WallpaperGalleryItem> = {},
): WallpaperGalleryItem {
  return {
    id,
    thumbUrl: `https://images.example.test/${id}.jpg`,
    fullUrl: `https://images.example.test/${id}.jpg`,
    kind: "image",
    source: "web",
    ...extra,
  };
}

function videoResult(id = "generated-video"): WallpaperSearchResult {
  return {
    items: [
      {
        id,
        thumbUrl: `file:///wallpapers/${id}.mp4`,
        fullUrl: `file:///wallpapers/${id}.mp4`,
        kind: "video",
        source: "imagine",
        localPath: `C:\\wallpapers\\${id}.mp4`,
      },
    ],
  };
}

function renderController(t: ReturnType<typeof createT> = translate) {
  const setters = {
    setItems: vi.fn(),
    setHasSearched: vi.fn(),
    setSelectedId: vi.fn(),
    setError: vi.fn(),
    setErrorCode: vi.fn(),
    setStatusHint: vi.fn(),
    setGalleryFilter: vi.fn(),
    setKindFilter: vi.fn(),
  };
  const hook = renderHook(() =>
    useWallpaperImagineController({
      open: true,
      enabled: true,
      t,
      ...setters,
    }),
  );
  return { ...hook, setters };
}

const translate = ((key: string, vars?: Record<string, unknown>) =>
  vars?.context ? `${key}:${vars.context}` : key) as never;

describe("useWallpaperImagineController", () => {
  it("reuses the saved prompt without generating or changing edit/video drafts", () => {
    const { result, setters } = renderController();
    act(() => result.current.beginEditFromItem(imageItem("source", { localPath: "/source.png" })));
    act(() => result.current.setPrompt("Edit draft"));
    act(() => result.current.setMode("video"));
    act(() => result.current.setPrompt("Motion draft"));
    act(() => result.current.reuseImagePrompt(imageItem("saved", {
      prompt: "Fallback", metadata: { prompt: "Recorded prompt", generation: { aspectRatio: "9:16" } } as never,
    })));
    expect(result.current.mode).toBe("image");
    expect(result.current.prompt).toBe("Recorded prompt");
    expect(result.current.aspect).toBe("9:16");
    act(() => result.current.setMode("edit"));
    expect(result.current.prompt).toBe("Edit draft");
    expect(result.current.videoSourcePath).toBe("/source.png");
    act(() => result.current.setMode("video"));
    expect(result.current.prompt).toBe("Motion draft");
    expect(wallpaperImagine).not.toHaveBeenCalled();
    expect(wallpaperImageEdit).not.toHaveBeenCalled();
    expect(wallpaperImageToVideo).not.toHaveBeenCalled();
    expect(setters.setItems).not.toHaveBeenCalled();
  });

  it("uses auto for unknown recorded ratios and ignores empty prompts", () => {
    const { result } = renderController();
    act(() => result.current.reuseImagePrompt(imageItem("old", {
      prompt: "Historical prompt", metadata: { generation: { aspectRatio: "unsupported" } } as never,
    })));
    expect(result.current.prompt).toBe("Historical prompt");
    expect(result.current.aspect).toBe("auto");
    act(() => result.current.setMode("edit"));
    act(() => result.current.setPrompt("Keep draft"));
    act(() => result.current.reuseImagePrompt(imageItem("empty", { prompt: "  " })));
    expect(result.current.mode).toBe("edit");
    expect(result.current.prompt).toBe("Keep draft");
  });

  it("does not replace the prompt while generation or cancellation is pending", async () => {
    const pending = deferred<WallpaperSearchResult>();
    wallpaperImagine.mockReturnValueOnce(pending.promise);
    const { result } = renderController();
    act(() => result.current.setPrompt("Running prompt"));
    let job!: Promise<void>;
    act(() => { job = result.current.generate(); });
    act(() => result.current.reuseImagePrompt(imageItem("reuse", { prompt: "New prompt" })));
    expect(result.current.prompt).toBe("Running prompt");
    await act(async () => result.current.cancelGeneration());
    act(() => result.current.reuseImagePrompt(imageItem("reuse", { prompt: "New prompt" })));
    expect(result.current.prompt).toBe("Running prompt");
    await act(async () => { pending.resolve({ items: [] }); await job; });
  });

  it.each((["image", "edit", "video"] as const).flatMap((mode) =>
    (["imagine_rate_limited", "imagine_network_failed"] as const).map((code) => ({ mode, code })),
  ))("keeps $mode inputs and existing results after $code without automatic retry", async ({ mode, code }) => {
    const generate = mode === "image" ? wallpaperImagine : mode === "edit" ? wallpaperImageEdit : wallpaperImageToVideo;
    generate.mockResolvedValueOnce({ items: [], errorCode: code, message: "private upstream diagnostic" });
    const t = createT("zh");
    const { result, setters } = renderController(t);
    const source = imageItem("selected", { localPath: "/selected.png" });
    if (mode === "edit") act(() => result.current.beginEditFromItem(source));
    if (mode === "video") act(() => result.current.beginVideoFromItem(source));
    act(() => {
      result.current.setPrompt("Selected instructions");
      result.current.setAspect("9:16");
      result.current.setVideoDuration(10);
      result.current.setVideoResolution("720p");
    });
    await act(async () => result.current.generate());
    expect(generate).toHaveBeenCalledTimes(1);
    expect(setters.setError).toHaveBeenLastCalledWith(t(`settings.wallpaperSource.err.${code}`));
    expect(setters.setItems).not.toHaveBeenCalled();
    expect(result.current.prompt).toBe("Selected instructions");
    expect(result.current.aspect).toBe("9:16");
    expect(result.current.videoDuration).toBe(10);
    expect(result.current.videoResolution).toBe("720p");
    if (mode !== "image") expect(result.current.videoSourcePath).toBe("/selected.png");
    expect(result.current.busy).toBe(false);
    const requestIndex = mode === "image" ? 2 : mode === "edit" ? 3 : 4;
    const firstRequestId = generate.mock.calls[0][requestIndex];
    const saved = mode === "video" ? videoResult() : { items: [imageItem("saved")] };
    generate.mockResolvedValueOnce(saved);
    await act(async () => result.current.generate());
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][requestIndex]).not.toBe(firstRequestId);
    expect(setters.setItems).toHaveBeenCalledWith(saved.items);
    expect(setters.setError).toHaveBeenLastCalledWith(null);
  });

  it("cancels a plain image request and discards its late result", async () => {
    const pending = deferred<WallpaperSearchResult>();
    wallpaperImagine.mockReturnValue(pending.promise);
    const { result, setters } = renderController();
    act(() => result.current.setPrompt("A mountain lake"));
    let job!: Promise<void>;
    act(() => { job = result.current.generate(); });
    const requestId = wallpaperImagine.mock.calls[0][2];
    expect(requestId).toEqual(expect.any(String));
    await act(async () => result.current.cancelGeneration());
    expect(wallpaperImageToVideoCancel).toHaveBeenCalledWith(requestId);
    await act(async () => { pending.resolve({ items: [imageItem("late")] }); await job; });
    expect(setters.setItems).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
    expect(result.current.prompt).toBe("A mountain lake");
  });

  it("cancels plain image work when leaving the source", async () => {
    const pending = deferred<WallpaperSearchResult>();
    wallpaperImagine.mockReturnValue(pending.promise);
    const { result, setters } = renderController();
    act(() => result.current.setPrompt("A mountain lake"));
    let job!: Promise<void>;
    act(() => { job = result.current.generate(); });
    act(() => result.current.cancelAll());
    expect(wallpaperImageToVideoCancel).toHaveBeenCalledWith(wallpaperImagine.mock.calls[0][2]);
    await act(async () => { pending.resolve({ items: [imageItem("late")] }); await job; });
    expect(setters.setItems).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it("prepares an album image and returns edited images to the gallery", async () => {
    ensureLocalWallpaperMedia.mockResolvedValue({ path: "/wallpapers/original.png", mime: "image/png" });
    const edited = imageItem("edited", { source: "imagine", localPath: "/wallpapers/edited.png" });
    wallpaperImageEdit.mockResolvedValue({ items: [edited] });
    const { result, setters } = renderController();
    act(() => result.current.beginEditFromItem(imageItem("album", { source: "grok_album" })));
    await waitFor(() => expect(result.current.videoSourceStatus).toBe("ready"));
    expect(result.current.mode).toBe("edit");
    await act(async () => result.current.generate());
    expect(wallpaperImageEdit).not.toHaveBeenCalled();
    act(() => result.current.setPrompt("Change the background"));
    await act(async () => result.current.generate());
    expect(wallpaperImageEdit).toHaveBeenCalledWith("/wallpapers/original.png", "Change the background", "16:9", expect.any(String));
    expect(setters.setItems).toHaveBeenCalledWith([edited]);
    expect(wallpaperImagine).not.toHaveBeenCalled();
  });

  it.each(["edit", "video"] as const)("uploads a local image for %s", async (mode) => {
    pickAttachFiles.mockResolvedValue(["C:/Pictures/source.avif"]);
    wallpaperImportImage.mockResolvedValue({ path: "/wallpapers/uploads/source.png", mime: "image/png", name: "source.png" });
    const { result } = renderController();
    act(() => result.current.setMode(mode));
    await act(async () => result.current.controls.onUploadSource());
    expect(result.current.mode).toBe(mode);
    expect(result.current.videoSourcePath).toBe("/wallpapers/uploads/source.png");
    expect(result.current.videoSourceStatus).toBe("ready");
    expect(result.current.busy).toBe(false);
  });

  it("ignores an upload completed after switching modes", async () => {
    const upload = deferred<{ path: string; mime: string; name: string }>();
    pickAttachFiles.mockResolvedValue(["C:/Pictures/source.png"]);
    wallpaperImportImage.mockReturnValue(upload.promise);
    const { result } = renderController();
    act(() => result.current.setMode("edit"));
    act(() => { void result.current.controls.onUploadSource(); });
    await waitFor(() => expect(wallpaperImportImage).toHaveBeenCalled());
    act(() => result.current.setMode("image"));
    await act(async () => upload.resolve({ path: "/late.png", mime: "image/png", name: "late.png" }));
    expect(result.current.mode).toBe("image");
    expect(result.current.videoSourcePath).toBeNull();
  });

  it("rejects invalid uploads and retains the selected source", async () => {
    pickAttachFiles.mockResolvedValue(["C:/document.pdf"]);
    wallpaperImportImage.mockRejectedValue(new Error("imagine_source_invalid"));
    const { result, setters } = renderController();
    act(() => result.current.beginEditFromItem(imageItem("original", { localPath: "/original.png" })));
    await act(async () => result.current.controls.onUploadSource());
    expect(setters.setErrorCode).toHaveBeenCalledWith("imagine_source_invalid");
    expect(result.current.videoSourcePath).toBe("/original.png");
    expect(result.current.busy).toBe(false);
  });

  it("cancels an edit and discards its late result", async () => {
    const edit = deferred<WallpaperSearchResult>();
    wallpaperImageEdit.mockReturnValue(edit.promise);
    const { result, setters } = renderController();
    act(() => result.current.beginEditFromItem(imageItem("original", { localPath: "/original.png" })));
    act(() => result.current.setPrompt("Change the light"));
    let job!: Promise<void>;
    act(() => { job = result.current.generate(); });
    await act(async () => result.current.cancelGeneration());
    expect(wallpaperImageToVideoCancel).toHaveBeenCalledWith(wallpaperImageEdit.mock.calls[0][3]);
    await act(async () => { edit.resolve({ items: [imageItem("late")] }); await job; });
    expect(setters.setItems).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });
  it("prefills an editable prompt and refreshes it for each source", () => {
    const { result } = renderController();
    const first = imageItem("first-local", {
      source: "imagine",
      localPath: "C:\\wallpapers\\first.jpg",
      prompt: "Moonlit mountain lake",
    });
    const second = imageItem("second-local", {
      source: "library",
      localPath: "C:\\wallpapers\\second.jpg",
      textPreview: "second.jpg",
    });

    act(() => result.current.setPrompt("image generation prompt"));
    act(() => result.current.beginVideoFromItem(first));
    expect(result.current.prompt).toBe(
      "settings.wallpaperSource.videoPromptDefaultWithContext:Moonlit mountain lake",
    );

    act(() => result.current.setPrompt("user-edited camera orbit"));
    expect(result.current.prompt).toBe("user-edited camera orbit");
    act(() => result.current.beginVideoFromItem(second));
    expect(result.current.prompt).toBe(
      "settings.wallpaperSource.videoPromptDefault",
    );

    act(() => result.current.setMode("image"));
    expect(result.current.prompt).toBe("image generation prompt");
    act(() => result.current.setMode("video"));
    expect(result.current.prompt).toBe(
      "settings.wallpaperSource.videoPromptDefault",
    );
    expect(ensureLocalWallpaperMedia).not.toHaveBeenCalled();
  });

  it("clears the automatic prompt when its source is removed", () => {
    const { result } = renderController();

    act(() =>
      result.current.beginVideoFromItem(
        imageItem("clear-local", {
          source: "library",
          localPath: "C:\\wallpapers\\clear.jpg",
        }),
      ),
    );
    expect(result.current.prompt).toBe(
      "settings.wallpaperSource.videoPromptDefault",
    );

    act(() => result.current.clearVideoSource());
    expect(result.current.videoSource).toBeNull();
    expect(result.current.prompt).toBe("");
  });

  it("materializes a remote source before starting real video generation", async () => {
    ensureLocalWallpaperMedia.mockResolvedValue({
      path: "C:\\wallpapers\\web\\source.jpg",
      name: "source.jpg",
      mime: "image/jpeg",
    });
    wallpaperImageToVideo.mockResolvedValue(videoResult());
    const { result, setters } = renderController();
    const source = imageItem("source");

    act(() => result.current.beginVideoFromItem(source));
    await waitFor(() => expect(result.current.videoSourceStatus).toBe("ready"));
    expect(ensureLocalWallpaperMedia).toHaveBeenCalledWith(source);
    expect(result.current.videoSourcePreview).toBe(
      "data:image/jpeg;base64,preview",
    );
    expect(cancelRemoteWallpaperMediaRequests).not.toHaveBeenCalled();

    act(() => {
      result.current.setPrompt("slow camera push");
      result.current.setVideoDuration(10);
      result.current.setVideoResolution("720p");
    });
    await act(async () => result.current.generate());

    expect(wallpaperImageToVideo).toHaveBeenCalledWith(
      "C:\\wallpapers\\web\\source.jpg",
      "slow camera push",
      10,
      "720p",
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(setters.setItems).toHaveBeenCalledWith(videoResult().items);
    expect(setters.setSelectedId).toHaveBeenLastCalledWith("generated-video");
  });

  it("cancels an active video request and ignores its late result", async () => {
    const generation = deferred<WallpaperSearchResult>();
    wallpaperImageToVideo.mockReturnValue(generation.promise);
    const { result, setters } = renderController();

    act(() =>
      result.current.beginVideoFromItem(
        imageItem("local", {
          source: "library",
          localPath: "C:\\wallpapers\\local.jpg",
          fullUrl: "file:///wallpapers/local.jpg",
        }),
      ),
    );
    act(() => {
      void result.current.generate();
    });
    await waitFor(() => expect(result.current.generating).toBe(true));
    const requestId = wallpaperImageToVideo.mock.calls[0]?.[4] as string;

    await act(async () => result.current.cancelGeneration());
    expect(wallpaperImageToVideoCancel).toHaveBeenCalledWith(requestId);
    expect(result.current.cancelling).toBe(true);

    await act(async () => generation.resolve(videoResult("late-video")));
    await waitFor(() => expect(result.current.generating).toBe(false));
    expect(setters.setItems).not.toHaveBeenCalled();
    expect(setters.setError).toHaveBeenLastCalledWith(null);
  });

  it("ignores a late cancel error after leaving the Imagine source", async () => {
    const generation = deferred<WallpaperSearchResult>();
    const cancellation = deferred<boolean>();
    wallpaperImageToVideo.mockReturnValue(generation.promise);
    wallpaperImageToVideoCancel.mockReturnValue(cancellation.promise);
    const { result, setters } = renderController();

    act(() =>
      result.current.beginVideoFromItem(
        imageItem("local-switch", {
          source: "library",
          localPath: "C:\\wallpapers\\local-switch.jpg",
          fullUrl: "file:///wallpapers/local-switch.jpg",
        }),
      ),
    );
    act(() => {
      void result.current.generate();
    });
    await waitFor(() => expect(result.current.generating).toBe(true));

    let cancelAttempt: Promise<void> | null = null;
    act(() => {
      cancelAttempt = result.current.cancelGeneration();
    });
    await waitFor(() => expect(result.current.cancelling).toBe(true));
    act(() => result.current.cancelAll());
    expect(result.current.cancelling).toBe(false);
    setters.setError.mockClear();
    setters.setErrorCode.mockClear();

    await act(async () => {
      cancellation.reject(new Error("cancel transport failed"));
      await cancelAttempt;
    });

    expect(setters.setError).not.toHaveBeenCalled();
    expect(setters.setErrorCode).not.toHaveBeenCalled();
    await act(async () => generation.resolve(videoResult("late-after-switch")));
    expect(setters.setItems).not.toHaveBeenCalled();
  });

  it("cancels active generation without setting state after unmount", async () => {
    const generation = deferred<WallpaperSearchResult>();
    wallpaperImageToVideo.mockReturnValue(generation.promise);
    const { result, setters, unmount } = renderController();

    act(() =>
      result.current.beginVideoFromItem(
        imageItem("local-unmount", {
          source: "library",
          localPath: "C:\\wallpapers\\local-unmount.jpg",
          fullUrl: "file:///wallpapers/local-unmount.jpg",
        }),
      ),
    );
    act(() => {
      void result.current.generate();
    });
    await waitFor(() => expect(result.current.generating).toBe(true));
    const requestId = wallpaperImageToVideo.mock.calls[0]?.[4] as string;

    unmount();
    expect(wallpaperImageToVideoCancel).toHaveBeenCalledWith(requestId);
    await act(async () => generation.resolve(videoResult("late-unmounted")));
    expect(setters.setItems).not.toHaveBeenCalled();
  });

  it("cancels active source preparation on unmount", async () => {
    const preparation = deferred<{ path: string; mime: string }>();
    ensureLocalWallpaperMedia.mockReturnValue(preparation.promise);
    const { result, unmount } = renderController();

    act(() => result.current.beginVideoFromItem(imageItem("preparing")));
    await waitFor(() =>
      expect(ensureLocalWallpaperMedia).toHaveBeenCalledTimes(1),
    );
    unmount();

    expect(cancelRemoteWallpaperMediaRequests).toHaveBeenCalled();
    await act(async () =>
      preparation.resolve({
        path: "C:\\wallpapers\\preparing.jpg",
        mime: "image/jpeg",
      }),
    );
  });

  it("does not let an older source download replace a newer selection", async () => {
    const first = deferred<{ path: string; mime: string }>();
    const second = deferred<{ path: string; mime: string }>();
    ensureLocalWallpaperMedia
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderController();

    act(() => result.current.beginVideoFromItem(imageItem("first")));
    await waitFor(() => expect(ensureLocalWallpaperMedia).toHaveBeenCalledTimes(1));
    act(() => result.current.beginVideoFromItem(imageItem("second")));
    await waitFor(() => expect(ensureLocalWallpaperMedia).toHaveBeenCalledTimes(2));

    await act(async () =>
      second.resolve({ path: "C:\\wallpapers\\second.jpg", mime: "image/jpeg" }),
    );
    await waitFor(() =>
      expect(result.current.videoSourcePath).toBe(
        "C:\\wallpapers\\second.jpg",
      ),
    );
    await act(async () =>
      first.resolve({ path: "C:\\wallpapers\\first.jpg", mime: "image/jpeg" }),
    );
    expect(result.current.videoSourcePath).toBe(
      "C:\\wallpapers\\second.jpg",
    );
  });
});
