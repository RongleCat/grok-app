/**
 * Global media lightbox + open/copy helpers.
 * Images keep zoom/copy support; video slides use the lightbox video plugin.
 */

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createT, type Locale } from "@/i18n";
import { copyImageFromPath, copyImageFromSrc } from "@/lib/copyImage";
import {
  lightboxSlideDimensions,
  lightboxSlideRect,
  lightboxYarlSlideSize,
  loadImageNaturalSize,
} from "@/lib/imageLightboxFit";
import { resolveImageSrc } from "@/lib/imageSrc";
import {
  ImageViewerContext,
  type ImageSlideInput,
  type ImageViewerApi,
} from "./ImageViewerContext";

const ImageLightbox = lazy(async () => {
  const module = await import("./ImageLightbox");
  return { default: module.ImageLightbox };
});

interface ResolvedSlide {
  src: string;
  kind: "image" | "video";
  mime?: string;
  poster?: string;
  alt?: string;
  title?: string;
  onView?: ImageSlideInput["onView"];
  loadOriginal?: ImageSlideInput["loadOriginal"];
  originalErrorMessage?: ImageSlideInput["originalErrorMessage"];
  originalStatus?: "loading" | "error";
  originalError?: string;
  /** Original path/URL for copy and stale-result identity checks. */
  origin: string;
  width?: number;
  height?: number;
  srcSet?: Array<{ src: string; width: number; height: number }>;
}

interface ImageViewerProviderProps {
  children: ReactNode;
  locale: Locale;
}

function currentStageRect() {
  if (typeof window === "undefined") {
    return lightboxSlideRect(1920, 1080);
  }
  return lightboxSlideRect(window.innerWidth, window.innerHeight);
}

async function withLogicalImageSize(
  slide: ResolvedSlide,
  stage: ReturnType<typeof currentStageRect>,
  requireDecodedImage = false,
): Promise<ResolvedSlide> {
  if (slide.kind === "video") return slide;
  const natural = await loadImageNaturalSize(slide.src);
  if (!(natural.width > 0 && natural.height > 0)) {
    if (requireDecodedImage) throw new Error("original_decode_failed");
    return slide;
  }
  const logical = lightboxSlideDimensions(natural, stage);
  const sizeFields = lightboxYarlSlideSize(slide.src, logical);
  return sizeFields ? { ...slide, ...sizeFields } : slide;
}

export function ImageViewerProvider({
  children,
  locale,
}: ImageViewerProviderProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [slides, setSlides] = useState<ResolvedSlide[]>([]);
  const isOpenRef = useRef(false);
  const slidesRef = useRef(slides);
  const generationRef = useRef(0);
  const originalLoadsRef = useRef(new Map<string, AbortController>());
  const pendingOriginalLoadRef = useRef<(() => void) | null>(null);
  slidesRef.current = slides;

  const abortOriginalLoads = useCallback(() => {
    for (const controller of originalLoadsRef.current.values()) {
      controller.abort();
    }
    originalLoadsRef.current.clear();
    pendingOriginalLoadRef.current = null;
  }, []);

  const close = useCallback(() => {
    generationRef.current += 1;
    abortOriginalLoads();
    isOpenRef.current = false;
    setIsOpen(false);
  }, [abortOriginalLoads]);

  const viewerIsOpen = useCallback(() => isOpenRef.current, []);

  useEffect(
    () => () => {
      generationRef.current += 1;
      abortOriginalLoads();
      isOpenRef.current = false;
    },
    [abortOriginalLoads],
  );

  const openViewer = useCallback(
    (input: ImageSlideInput[] | string[], startIndex = 0) => {
      const normalized: ImageSlideInput[] = input.map((item) =>
        typeof item === "string" ? { src: item } : item,
      );
      if (!normalized.length) return;

      void (async () => {
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        abortOriginalLoads();
        const resolved = (
          await Promise.all(
            normalized.map(async (slide, inputIndex) => {
              const src = await resolveImageSrc(slide.src);
              return src
                ? { path: slide.src, src, input: slide, inputIndex }
                : null;
            }),
          )
        ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        if (!resolved.length) return;

        const next: ResolvedSlide[] = resolved.map(
          ({ path, src, input: slide }) => {
            const kind = slide.kind === "video" ? "video" : "image";
            return {
              src,
              origin: path,
              kind,
              ...(kind === "video"
                ? { mime: slide.mime, poster: slide.poster }
                : {}),
              alt: slide.alt ?? slide.title,
              title: slide.title,
              onView: slide.onView,
              loadOriginal: slide.loadOriginal,
              originalErrorMessage: slide.originalErrorMessage,
            };
          },
        );

        const requestedInputIndex = Math.min(
          Math.max(Number.isFinite(startIndex) ? Math.trunc(startIndex) : 0, 0),
          normalized.length - 1,
        );
        let nextIndex = resolved.findIndex(
          (entry) => entry.inputIndex === requestedInputIndex,
        );
        if (nextIndex < 0) nextIndex = 0;

        // Open lazy placeholders immediately. Eager images only wait for the
        // selected slide's dimensions; siblings hydrate when viewed.
        const selected = next[nextIndex];
        if (selected && !selected.loadOriginal) {
          next[nextIndex] = await withLogicalImageSize(
            selected,
            currentStageRect(),
          );
        }

        if (generationRef.current !== generation) return;
        setSlides(next);
        setIndex(nextIndex);
        isOpenRef.current = true;
        setIsOpen(true);
      })();
    },
    [abortOriginalLoads],
  );

  const copyImage = useCallback(async (pathOrUrl: string) => {
    const fromPath = await copyImageFromPath(pathOrUrl);
    if (fromPath.ok) return true;
    const src = await resolveImageSrc(pathOrUrl);
    if (!src) return false;
    return (await copyImageFromSrc(src)).ok;
  }, []);

  const hydrateSlideAt = useCallback(
    function hydrateSlideAt(
      targetIndex: number,
      force = false,
      retryOriginal = false,
    ) {
      if (!isOpenRef.current) return;
      const slide = slidesRef.current[targetIndex];
      if (!slide) return;

      const generation = generationRef.current;
      const expectedOrigin = slide.origin;
      const expectedSrc = slide.src;

      if (slide.loadOriginal) {
        if (slide.originalStatus === "error" && !retryOriginal) return;
        const loadKey = `${generation}:${targetIndex}:${expectedOrigin}`;
        if (originalLoadsRef.current.has(loadKey)) return;

        const updateSlide = (updated: ResolvedSlide) => {
          if (generationRef.current !== generation) return;
          const previous = slidesRef.current[targetIndex];
          if (
            previous?.origin !== expectedOrigin ||
            previous.src !== expectedSrc
          ) {
            return;
          }
          const next = slidesRef.current.slice();
          next[targetIndex] = updated;
          slidesRef.current = next;
          setSlides(next);
        };

        updateSlide({
          ...slide,
          originalStatus: "loading",
          originalError: undefined,
        });

        // Keep at most two Host downloads active and retain only the latest
        // navigation request waiting for a slot.
        if (originalLoadsRef.current.size >= 2) {
          pendingOriginalLoadRef.current = () => {
            if (generationRef.current === generation) {
              hydrateSlideAt(targetIndex, force, retryOriginal);
            }
          };
          return;
        }

        const controller = new AbortController();
        originalLoadsRef.current.set(loadKey, controller);
        void (async () => {
          try {
            const loaded = await slide.loadOriginal?.(controller.signal);
            if (generationRef.current !== generation) return;
            if (!loaded) throw new Error("original_unavailable");

            const loadedSrc = await resolveImageSrc(loaded.src);
            if (generationRef.current !== generation) return;
            if (!loadedSrc) throw new Error("original_unavailable");

            const upgraded: ResolvedSlide = {
              ...slide,
              src: loadedSrc,
              origin: loaded.src,
              kind: loaded.kind === "video" ? "video" : "image",
              mime: loaded.mime,
              poster: loaded.poster ?? slide.poster,
              loadOriginal: undefined,
              originalStatus: undefined,
              originalError: undefined,
              width: undefined,
              height: undefined,
              srcSet: undefined,
            };
            updateSlide(
              await withLogicalImageSize(
                upgraded,
                currentStageRect(),
                true,
              ),
            );
          } catch (error) {
            if (controller.signal.aborted) return;
            let originalError: string | undefined;
            try {
              originalError = slide.originalErrorMessage?.(error);
            } catch {
              originalError = undefined;
            }
            // Preserve the thumbnail. Retry only after an explicit action.
            updateSlide({
              ...slide,
              originalStatus: "error",
              originalError,
            });
          } finally {
            if (originalLoadsRef.current.get(loadKey) === controller) {
              originalLoadsRef.current.delete(loadKey);
              const pending = pendingOriginalLoadRef.current;
              pendingOriginalLoadRef.current = null;
              pending?.();
            }
          }
        })();
        return;
      }

      if (slide.kind === "video" || (!force && slide.width && slide.height)) {
        return;
      }
      void withLogicalImageSize(slide, currentStageRect()).then((updated) => {
        if (generationRef.current !== generation) return;
        setSlides((current) => {
          if (
            current[targetIndex]?.origin !== expectedOrigin ||
            current[targetIndex]?.src !== expectedSrc
          ) {
            return current;
          }
          const previous = current[targetIndex];
          if (
            previous?.width === updated.width &&
            previous.height === updated.height
          ) {
            return current;
          }
          const next = current.slice();
          next[targetIndex] = updated;
          return next;
        });
      });
    },
    [],
  );

  const handleView = useCallback(
    (nextIndex: number) => {
      pendingOriginalLoadRef.current = null;
      setIndex(nextIndex);
      slidesRef.current[nextIndex]?.onView?.();
      hydrateSlideAt(nextIndex);
    },
    [hydrateSlideAt],
  );

  useEffect(() => {
    if (isOpen) hydrateSlideAt(index);
  }, [hydrateSlideAt, index, isOpen]);

  const api = useMemo<ImageViewerApi>(
    () => ({
      open: openViewer,
      close,
      isOpen: viewerIsOpen,
      copyImage,
    }),
    [close, copyImage, openViewer, viewerIsOpen],
  );

  useEffect(() => {
    if (!isOpen) return;
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.(".yarl__root")) return;
      const image = target.closest("img") as HTMLImageElement | null;
      const src = image?.currentSrc || image?.src;
      if (!src) return;
      event.preventDefault();
      event.stopPropagation();
      void copyImageFromSrc(src);
    };
    document.addEventListener("contextmenu", onContextMenu, true);
    return () => document.removeEventListener("contextmenu", onContextMenu, true);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!cancelled) hydrateSlideAt(index, true);
      }, 120);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [hydrateSlideAt, index, isOpen]);

  return (
    <ImageViewerContext.Provider value={api}>
      {children}
      {slides.length > 0 ? (
        <Suspense fallback={null}>
          <ImageLightbox
            open={isOpen}
            close={close}
            index={index}
            slides={slides}
            onView={handleView}
            onRetryOriginal={() => hydrateSlideAt(index, false, true)}
            labels={{
              next: tr("image.next"),
              prev: tr("image.prev"),
              close: tr("image.close"),
              zoomIn: tr("image.zoomIn"),
              zoomOut: tr("image.zoomOut"),
              loadingOriginal: tr("image.loadingOriginal"),
              originalFailed: tr("image.originalFailed"),
              retry: tr("ui.errorBoundary.retry"),
            }}
          />
        </Suspense>
      ) : null}
    </ImageViewerContext.Provider>
  );
}
