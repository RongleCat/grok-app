/**
 * yet-another-react-lightbox — loaded only when a gallery opens.
 */

import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Counter from "yet-another-react-lightbox/plugins/counter";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/counter.css";

export type ImageLightboxSlide = {
  src: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
  srcSet?: Array<{ src: string; width: number; height: number }>;
};

export function ImageLightbox({
  open,
  close,
  index,
  slides,
  onView,
  labels,
}: {
  open: boolean;
  close: () => void;
  index: number;
  slides: ImageLightboxSlide[];
  onView: (index: number) => void;
  labels: {
    next: string;
    prev: string;
    close: string;
    zoomIn: string;
    zoomOut: string;
  };
}) {
  return (
    <Lightbox
      open={open}
      close={close}
      index={index}
      slides={slides.map((s) => ({
        src: s.src,
        alt: s.alt ?? s.title,
        title: s.title,
        width: s.width,
        height: s.height,
        ...(s.srcSet?.length ? { srcSet: s.srcSet } : {}),
      }))}
      on={{
        view: ({ index: i }) => onView(i),
      }}
      plugins={[Zoom, Counter]}
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
        },
      }}
      controller={{
        closeOnBackdropClick: true,
      }}
      styles={{
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
