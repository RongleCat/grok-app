// Keep context identity outside the provider's Fast Refresh boundary.
import { createContext, useContext } from "react";

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
  /** Synchronous layer ownership check for dialogs sharing Escape. */
  isOpen: () => boolean;
  /** Copy image at path/URL to clipboard. Returns true on success. */
  copyImage: (pathOrUrl: string) => Promise<boolean>;
}

export const ImageViewerContext = createContext<ImageViewerApi | null>(null);

export function useImageViewer(): ImageViewerApi {
  const ctx = useContext(ImageViewerContext);
  if (!ctx) {
    throw new Error("useImageViewer must be used within ImageViewerProvider");
  }
  return ctx;
}

const OPTIONAL_IMAGE_VIEWER: ImageViewerApi = {
  open: () => {},
  close: () => {},
  isOpen: () => false,
  copyImage: async () => false,
};

/** Safe hook when provider may be absent (returns stable no-ops). */
export function useImageViewerOptional(): ImageViewerApi {
  const ctx = useContext(ImageViewerContext);
  return ctx ?? OPTIONAL_IMAGE_VIEWER;
}
