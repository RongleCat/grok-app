/**
 * yet-another-react-lightbox, loaded only when a gallery opens.
 */

import Lightbox, { type Slide } from "yet-another-react-lightbox";
import Counter from "yet-another-react-lightbox/plugins/counter";
import Video from "yet-another-react-lightbox/plugins/video";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import { IconRefresh } from "./icons";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/counter.css";

export const IMAGE_LIGHTBOX_PORTAL_Z_INDEX = 14_000;

export type ImageLightboxSlide = {
  src: string;
  kind: "image" | "video";
  mime?: string;
  poster?: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
  srcSet?: Array<{ src: string; width: number; height: number }>;
  originalStatus?: "loading" | "error";
  originalError?: string;
};

function videoMime(slide: ImageLightboxSlide): string {
  const explicit = slide.mime?.split(";", 1)[0]?.trim().toLowerCase();
  if (explicit?.startsWith("video/")) return explicit;
  const path = slide.src.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  return path.endsWith(".webm") ? "video/webm" : "video/mp4";
}

export function toLightboxSlides(slides: ImageLightboxSlide[]): Slide[] {
  return slides.map((slide) =>
    slide.kind === "video"
      ? {
          type: "video",
          poster: slide.poster,
          sources: [{ src: slide.src, type: videoMime(slide) }],
        }
      : {
          type: "image",
          src: slide.src,
          alt: slide.alt ?? slide.title,
          title: slide.title,
          width: slide.width,
          height: slide.height,
          ...(slide.srcSet?.length ? { srcSet: slide.srcSet } : {}),
        },
  );
}

export function ImageLightbox({
  open,
  close,
  index,
  slides,
  onView,
  onRetryOriginal,
  labels,
}: {
  open: boolean;
  close: () => void;
  index: number;
  slides: ImageLightboxSlide[];
  onView: (index: number) => void;
  onRetryOriginal?: () => void;
  labels: {
    next: string;
    prev: string;
    close: string;
    zoomIn: string;
    zoomOut: string;
    loadingOriginal?: string;
    originalFailed?: string;
    retry?: string;
  };
}) {
  const originalStatus = slides[index]?.originalStatus;

  return (
    <Lightbox
      open={open}
      close={close}
      index={index}
      slides={toLightboxSlides(slides)}
      toolbar={{
        buttons: [
          ...(originalStatus
            ? [
                <div
                  key="original-status"
                  className="image-original-status"
                  role="status"
                  aria-live="polite"
                >
                  <span>
                    {originalStatus === "loading"
                      ? labels.loadingOriginal
                      : slides[index]?.originalError || labels.originalFailed}
                  </span>
                  {originalStatus === "error" && onRetryOriginal ? (
                    <button
                      type="button"
                      className="yarl__button"
                      title={labels.retry}
                      aria-label={labels.retry}
                      onClick={onRetryOriginal}
                    >
                      <IconRefresh size={22} />
                    </button>
                  ) : null}
                </div>,
              ]
            : []),
          "close",
        ],
      }}
      on={{
        view: ({ index: nextIndex }) => onView(nextIndex),
      }}
      plugins={[Video, Zoom, Counter]}
      video={{
        autoPlay: true,
        controls: true,
        loop: true,
        muted: true,
        playsInline: true,
        preload: "metadata",
      }}
      zoom={{
        maxZoomPixelRatio: 4,
        scrollToZoom: true,
      }}
      carousel={{
        finite: slides.length <= 1,
        preload: 2,
        imageFit: "contain",
        imageProps: {
          style: {
            maxWidth: "100%",
            maxHeight: "100%",
            width: "100%",
            height: "100%",
            objectFit: "contain",
          },
          draggable: false,
          referrerPolicy: "no-referrer",
        },
      }}
      controller={{
        closeOnBackdropClick: true,
      }}
      styles={{
        root: {
          "--yarl__portal_zindex": IMAGE_LIGHTBOX_PORTAL_Z_INDEX,
        },
        container: { backgroundColor: "rgba(0, 0, 0, 0.92)" },
      }}
      labels={{
        Next: labels.next,
        Previous: labels.prev,
        Close: labels.close,
        "Zoom in": labels.zoomIn,
        "Zoom out": labels.zoomOut,
      }}
    />
  );
}
