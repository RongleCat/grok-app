import { createContext, useContext } from "react";

export interface ImageSlideSource {
  /** Local absolute path or already-viewable URL. */
  src: string;
  kind?: "image" | "video";
  mime?: string;
  poster?: string;
}

export interface ImageSlideInput extends ImageSlideSource {
  alt?: string;
  title?: string;
  /** Notify the owning gallery when this slide becomes current. */
  onView?: () => void;
  /** Upgrade a viewable placeholder to a local original on first navigation. */
  loadOriginal?: (signal: AbortSignal) => Promise<ImageSlideSource | null>;
  /** Return localized copy only; raw Host errors are never rendered. */
  originalErrorMessage?: (error: unknown) => string;
}

export interface ImageViewerApi {
  /** Open lightbox with slides (paths or URLs). Resolves local paths async. */
  open: (slides: ImageSlideInput[] | string[], index?: number) => void;
  close: () => void;
  /** Synchronous layer ownership check for dialogs sharing Escape. */
  isOpen: () => boolean;
  /** Copy image at path/URL to clipboard. Returns true on success. */
  copyImage: (pathOrUrl: string) => Promise<boolean>;
}

/**
 * Keep context identity outside the provider's Fast Refresh boundary so
 * mounted providers and refreshed consumers retain the same context.
 */
export const ImageViewerContext = createContext<ImageViewerApi | null>(null);

export function useImageViewer(): ImageViewerApi {
  const context = useContext(ImageViewerContext);
  if (!context) {
    throw new Error("useImageViewer must be used within ImageViewerProvider");
  }
  return context;
}

const OPTIONAL_IMAGE_VIEWER: ImageViewerApi = {
  open: () => {},
  close: () => {},
  isOpen: () => false,
  copyImage: async () => false,
};

/** Safe hook when provider may be absent (returns stable no-ops). */
export function useImageViewerOptional(): ImageViewerApi {
  return useContext(ImageViewerContext) ?? OPTIONAL_IMAGE_VIEWER;
}
