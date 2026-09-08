import { describe, expect, it } from "vitest";
import {
  IMAGE_LIGHTBOX_PORTAL_Z_INDEX,
  ImageLightbox,
  toLightboxSlides,
} from "./ImageLightbox";

const labels = {
  next: "Next",
  prev: "Previous",
  close: "Close",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
};

describe("ImageLightbox", () => {
  it("maps image and video slides to their proper renderer", () => {
    const slides = toLightboxSlides([
      {
        kind: "image",
        src: "https://example.test/wallpaper.jpg",
        alt: "wallpaper",
        width: 1920,
        height: 1080,
      },
      {
        kind: "video",
        src: "http://127.0.0.1/media/clip",
        mime: "video/mp4; charset=binary",
      },
      {
        kind: "video",
        src: "https://example.test/clip.webm?cache=1",
      },
    ]);

    expect(slides[0]).toEqual(
      expect.objectContaining({
        type: "image",
        src: "https://example.test/wallpaper.jpg",
        alt: "wallpaper",
        width: 1920,
        height: 1080,
      }),
    );
    expect(slides[1]).toEqual({
      type: "video",
      poster: undefined,
      sources: [
        { src: "http://127.0.0.1/media/clip", type: "video/mp4" },
      ],
    });
    expect(slides[2]).toEqual({
      type: "video",
      poster: undefined,
      sources: [
        {
          src: "https://example.test/clip.webm?cache=1",
          type: "video/webm",
        },
      ],
    });
  });

  it("hides the app origin and keeps the portal above application modals", () => {
    const rendered = ImageLightbox({
      open: true,
      close: () => undefined,
      index: 0,
      slides: [
        { kind: "image", src: "https://cdn.example.test/photo.jpg" },
      ],
      onView: () => undefined,
      labels,
    });
    const props = rendered.props as {
      carousel: { imageProps: { referrerPolicy?: string } };
      styles: { root: Record<`--yarl__${string}`, string | number> };
    };

    expect(props.carousel.imageProps.referrerPolicy).toBe("no-referrer");
    expect(props.styles.root["--yarl__portal_zindex"]).toBe(
      IMAGE_LIGHTBOX_PORTAL_Z_INDEX,
    );
    expect(IMAGE_LIGHTBOX_PORTAL_Z_INDEX).toBeGreaterThan(12_000);
  });
});
