/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";

vi.mock("@/providers/ThemeProvider", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/providers/SkinShareProvider", () => ({
  SkinShareProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/hooks/useAppearanceEditorModel", () => ({
  useAppearanceEditorModel: () => ({
    model: { t: (key: string) => key },
    toast: null,
  }),
}));
vi.mock("@/lib/api/settings", () => ({
  settingsGet: async () => ({ locale: "en" }),
}));
vi.mock("@/lib/wallpaperExportBake", () => ({
  watchWallpaperViewportAspect: async () => () => {},
}));
vi.mock("@/lib/themeEditorShell", () => ({
  readThemeEditorBootLocale: () => "en",
  applyThemeEditorHtmlLang: vi.fn(),
  OPEN_SETTINGS_FROM_EDITOR_EVENT: "open-settings",
}));
vi.mock("@/lib/imageSrc", () => ({
  resolveImageSrc: async (src: string) => src,
}));
vi.mock("@/lib/imageLightboxFit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/imageLightboxFit")>()),
  loadImageNaturalSize: async () => ({ width: 640, height: 360 }),
}));
vi.mock("@/components/settings/AppearanceSection", async () => {
  const { useImageViewerOptional } = await import(
    "@/components/ImageViewerContext"
  );
  return {
    AppearanceSection: () => {
      const viewer = useImageViewerOptional();
      return (
        <>
          <button
            onClick={() =>
              viewer.open([
                {
                  src: "https://media.example.test/video.mp4",
                  kind: "video",
                },
              ])
            }
          >
            Preview video
          </button>
          <button
            onClick={() =>
              viewer.open([
                {
                  src: "https://media.example.test/image.jpg",
                  kind: "image",
                },
              ])
            }
          >
            Preview image
          </button>
        </>
      );
    },
  };
});

import { ThemeEditorApp } from "./ThemeEditorApp";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("standalone theme editor media preview", () => {
  it.each(["video", "image"] as const)(
    "opens and closes a real %s lightbox",
    async (kind) => {
      vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
      vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
        () => {},
      );
      render(<ThemeEditorApp />);

      fireEvent.click(
        screen.getByRole("button", { name: `Preview ${kind}` }),
      );
      await waitFor(() => {
        expect(document.querySelector(".yarl__portal")).not.toBeNull();
      });
      if (kind === "video") {
        const video = document.querySelector<HTMLVideoElement>(
          ".yarl__portal video",
        );
        expect(video?.controls).toBe(true);
        expect(video?.querySelector("source")?.src).toBe(
          "https://media.example.test/video.mp4",
        );
      } else {
        expect(
          document.querySelector<HTMLImageElement>(
            '.yarl__portal img[src="https://media.example.test/image.jpg"]',
          ),
        ).not.toBeNull();
      }

      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() => {
        expect(document.querySelector(".yarl__portal")).toBeNull();
      });
    },
  );
});
