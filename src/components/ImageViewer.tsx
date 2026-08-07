/**
 * Global image lightbox (yet-another-react-lightbox) + open/copy helpers.
 * Zoom, prev/next, counter; right-click on the active slide copies the image.
 *
 * Initial fit: always contain within the stage (upscale small images to fill,
 * downscale large ones). Logical slide width/height are inflated when the
 * natural bitmap is smaller than the stage so YARL's max-width cap and zoom
 * math do not leave a tiny thumbnail in the middle of the window.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Counter from "yet-another-react-lightbox/plugins/counter";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/counter.css";
import { resolveImageSrc, resolveImageSrcs } from "@/lib/imageSrc";
import { copyImageFromPath, copyImageFromSrc } from "@/lib/copyImage";
import {
  lightboxSlideDimensions,
  lightboxSlideRect,
  lightboxYarlSlideSize,
  loadImageNaturalSize,
} from "@/lib/imageLightboxFit";
import { createT, type Locale } from "@/i18n";

export interface ImageSlideInput {
  /** Local absolute path or already-viewable URL. */
  src: string;
  alt?: string;
  title?: string;
}

export interface ImageViewerApi {
  /** Open lightbox with slides (paths or URLs). Resolves local paths async. */
  open: (slides: ImageSlideInput[] | string[], index?: number) => void;
  close: () => void;
  /** Copy image at path/URL to clipboard. Returns true on success. */
  copyImage: (pathOrUrl: string) => Promise<boolean>;
}

const ImageViewerContext = createContext<ImageViewerApi | null>(null);

export function useImageViewer(): ImageViewerApi {
  const ctx = useContext(ImageViewerContext);
  if (!ctx) {
    throw new Error("useImageViewer must be used within ImageViewerProvider");
  }
  return ctx;
}

/** Safe hook when provider may be absent (returns no-ops). */
export function useImageViewerOptional(): ImageViewerApi {
  const ctx = useContext(ImageViewerContext);
  return (
    ctx ?? {
      open: () => {},
      close: () => {},
      copyImage: async () => false,
    }
  );
}

interface ResolvedSlide {
  src: string;
  alt?: string;
  title?: string;
  /** Original path/url for copy. */
  origin: string;
  /** Logical size for YARL fit + zoom (may exceed natural for small images). */
  width?: number;
  height?: number;
  /**
   * Same logical size as width/height — keeps Zoom imageRect ≥ stage fit so
   * drag-pan works after zoom-in (see lightboxYarlSlideSize).
   */
  srcSet?: Array<{ src: string; width: number; height: number }>;
}

interface ImageViewerProviderProps {
  children: ReactNode;
  locale: Locale;
}

/** Stage size from the current window (SSR-safe fallback). */
function currentStageRect() {
  if (typeof window === "undefined") {
    return lightboxSlideRect(1920, 1080);
  }
  return lightboxSlideRect(window.innerWidth, window.innerHeight);
}

export function ImageViewerProvider({
  children,
  locale,
}: ImageViewerProviderProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [slides, setSlides] = useState<ResolvedSlide[]>([]);
  const slidesRef = useRef(slides);
  slidesRef.current = slides;

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const openViewer = useCallback(
    (input: ImageSlideInput[] | string[], startIndex = 0) => {
      const normalized: ImageSlideInput[] = input.map((item) =>
        typeof item === "string" ? { src: item } : item,
      );
      if (!normalized.length) return;

      void (async () => {
        const paths = normalized.map((s) => s.src);
        const resolved = await resolveImageSrcs(paths);
        if (!resolved.length) return;

        const meta = new Map(normalized.map((s) => [s.src, s] as const));
        const stage = currentStageRect();

        // Resolve natural sizes so we can declare logical slide dims that
        // allow small images to fill the stage at zoom=1.
        const next: ResolvedSlide[] = await Promise.all(
          resolved.map(async ({ path, src }) => {
            const m = meta.get(path);
            const natural = await loadImageNaturalSize(src);
            const logical =
              natural.width > 0 && natural.height > 0
                ? lightboxSlideDimensions(natural, stage)
                : { width: 0, height: 0 };
            const sizeFields = lightboxYarlSlideSize(src, logical);
            return {
              src,
              origin: path,
              alt: m?.alt ?? m?.title,
              title: m?.title,
              ...(sizeFields ?? {}),
            };
          }),
        );

        const want =
          normalized[Math.min(startIndex, normalized.length - 1)]?.src;
        let idx = next.findIndex((s) => s.origin === want);
        if (idx < 0) idx = 0;

        setSlides(next);
        setIndex(idx);
        setIsOpen(true);
      })();
    },
    [],
  );

  const copyImage = useCallback(async (pathOrUrl: string) => {
    // Prefer Host path write for absolute files; then URL/fetch path.
    const r = await copyImageFromPath(pathOrUrl);
    if (r.ok) return true;
    const src = await resolveImageSrc(pathOrUrl);
    if (!src) return false;
    return (await copyImageFromSrc(src)).ok;
  }, []);

  const api = useMemo<ImageViewerApi>(
    () => ({
      open: openViewer,
      close,
      copyImage,
    }),
    [openViewer, close, copyImage],
  );

  // Right-click inside lightbox → copy current image (keeps Zoom plugin intact).
  useEffect(() => {
    if (!isOpen) return;
    const onCtx = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.(".yarl__root")) return;
      const img = target.closest("img") as HTMLImageElement | null;
      if (!img) return;
      const src = img.currentSrc || img.src;
      if (!src) return;
      e.preventDefault();
      e.stopPropagation();
      void copyImageFromSrc(src);
    };
    document.addEventListener("contextmenu", onCtx, true);
    return () => document.removeEventListener("contextmenu", onCtx, true);
  }, [isOpen]);

  // Recompute logical dims on resize so small images still fill a larger stage.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const stage = currentStageRect();
        const current = slidesRef.current;
        if (!current.length) return;
        void (async () => {
          const updated = await Promise.all(
            current.map(async (s) => {
              const natural = await loadImageNaturalSize(s.src);
              if (!(natural.width > 0 && natural.height > 0)) return s;
              const logical = lightboxSlideDimensions(natural, stage);
              const sizeFields = lightboxYarlSlideSize(s.src, logical);
              if (
                !sizeFields ||
                (s.width === sizeFields.width &&
                  s.height === sizeFields.height)
              ) {
                return s;
              }
              return { ...s, ...sizeFields };
            }),
          );
          if (cancelled) return;
          setSlides((prev) => {
            if (
              prev.length !== updated.length ||
              prev.some((p, i) => p.src !== updated[i]?.src)
            ) {
              return prev;
            }
            const changed = prev.some(
              (p, i) =>
                p.width !== updated[i]?.width ||
                p.height !== updated[i]?.height,
            );
            return changed ? updated : prev;
          });
        })();
      }, 120);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [isOpen]);

  return (
    <ImageViewerContext.Provider value={api}>
      {children}
      <Lightbox
        open={isOpen}
        close={close}
        index={index}
        slides={slides.map((s) => ({
          src: s.src,
          alt: s.alt ?? s.title,
          title: s.title,
          width: s.width,
          height: s.height,
          // Critical for drag-pan: srcSet logical size beats naturalWidth
          // overwrite inside Zoom's useZoomImageRect (Math.max).
          ...(s.srcSet?.length ? { srcSet: s.srcSet } : {}),
        }))}
        on={{
          view: ({ index: i }) => setIndex(i),
        }}
        plugins={[Zoom, Counter]}
        zoom={{
          // Relative to logical slide size (fit-to-stage at zoom=1).
          // After zoom-in, built-in pointer drag pans (offsetX/Y).
          maxZoomPixelRatio: 4,
          scrollToZoom: true,
        }}
        carousel={{
          finite: slides.length <= 1,
          preload: 2,
          imageFit: "contain",
          // Force fill of the stage with object-fit contain so small bitmaps
          // actually paint at the logical (upscaled) size — YARL's default
          // only sets max-width/max-height which never upscales.
          imageProps: {
            style: {
              maxWidth: "100%",
              maxHeight: "100%",
              width: "100%",
              height: "100%",
              objectFit: "contain",
            },
            draggable: false,
          },
        }}
        controller={{
          closeOnBackdropClick: true,
        }}
        styles={{
          // z-index via .yarl__portal in app.css (above GlassModal 12000)
          container: { backgroundColor: "rgba(0, 0, 0, 0.92)" },
        }}
        labels={{
          Next: tr("image.next"),
          Previous: tr("image.prev"),
          Close: tr("image.close"),
          "Zoom in": tr("image.zoomIn"),
          "Zoom out": tr("image.zoomOut"),
        }}
      />
    </ImageViewerContext.Provider>
  );
}
