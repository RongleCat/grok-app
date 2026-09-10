// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const prepare = vi.hoisted(() => vi.fn());
vi.mock("./host", () => ({ invoke, listen: vi.fn() }));
vi.mock("../wallpaperVideoImage", () => ({ prepareWallpaperVideoImage: prepare }));
import {
  wallpaperImageEdit,
  wallpaperImaginePendingRecoveries,
  wallpaperImagineRecoverCatalog,
  wallpaperImportImage,
  wallpaperImageToVideo,
  wallpaperImageToVideoCancel,
} from "./wallpaper";

afterEach(() => vi.resetAllMocks());

describe("wallpaper video API", () => {
  it("passes only the opaque recovery id back to the Host", async () => {
    invoke.mockResolvedValue({ items: [] });
    await wallpaperImagineRecoverCatalog("recovery-id");
    expect(invoke).toHaveBeenCalledWith(
      "wallpaper_imagine_recover_catalog",
      { recoveryId: "recovery-id" },
    );

    await wallpaperImaginePendingRecoveries();
    expect(invoke).toHaveBeenLastCalledWith(
      "wallpaper_imagine_pending_recoveries",
    );
  });

  it("passes the actual source and edit prompt to the editing command", async () => {
    prepare.mockResolvedValue("PNG");
    invoke.mockResolvedValue({ items: [] });
    await wallpaperImageEdit("/image.avif", "Replace the sky", "16:9", "edit-1");
    expect(invoke).toHaveBeenCalledWith("wallpaper_image_edit", {
      sourcePath: "/image.avif", sourcePngBase64: "PNG", prompt: "Replace the sky", aspectRatio: "16:9", requestId: "edit-1",
    });
  });

  it("imports uploads through the Host with normalized pixels", async () => {
    prepare.mockResolvedValue("PNG");
    await wallpaperImportImage("/upload.avif");
    expect(invoke).toHaveBeenCalledWith("wallpaper_import_image", { sourcePath: "/upload.avif", sourcePngBase64: "PNG" });
  });

  it("cancels edits during source conversion before starting the Host", async () => {
    let resolve!: (value: string) => void;
    prepare.mockReturnValue(new Promise<string>((r) => { resolve = r; }));
    const edit = wallpaperImageEdit("/source.avif", "New sky", "auto", "edit-2");
    const rejection = expect(edit).rejects.toThrow();
    await wallpaperImageToVideoCancel("edit-2");
    resolve("late pixels");
    await rejection;
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("wallpaper_image_to_video_cancel", { requestId: "edit-2" });
  });
  it("passes converted pixels with the original selected path and options", async () => {
    prepare.mockResolvedValue("encoded PNG");
    invoke.mockResolvedValue({ items: [] });
    await wallpaperImageToVideo("/wallpapers/selected.avif", " orbit ", 10, "720p", "request-1");
    expect(invoke).toHaveBeenCalledWith("wallpaper_image_to_video", {
      sourcePath: "/wallpapers/selected.avif", sourcePngBase64: "encoded PNG",
      motionPrompt: "orbit", duration: 10, resolutionName: "720p", requestId: "request-1",
    });
  });

  it("never starts the Host generation after cancellation during conversion", async () => {
    let resolve!: (value: string) => void;
    prepare.mockReturnValue(new Promise<string>((r) => { resolve = r; }));
    invoke.mockResolvedValue(true);
    const result = wallpaperImageToVideo("/source.avif", "", 6, "480p", "request-2");
    const rejection = expect(result).rejects.toThrow();
    await wallpaperImageToVideoCancel("request-2");
    expect(prepare.mock.calls[0][1].aborted).toBe(true);
    resolve("late conversion");
    await rejection;
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("wallpaper_image_to_video_cancel", { requestId: "request-2" });
  });

  it("does not invoke generation when image decoding fails", async () => {
    prepare.mockRejectedValue(new Error("imagine_source_invalid"));
    await expect(wallpaperImageToVideo("/broken.avif", "", 6, "480p", "request-3"))
      .rejects.toThrow("imagine_source_invalid");
    expect(invoke).not.toHaveBeenCalled();
  });
});
