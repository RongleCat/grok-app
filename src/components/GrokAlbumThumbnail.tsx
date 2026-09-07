import { useEffect, useMemo, useState } from "react";
import {
  forgetGrokAlbumThumbnail,
  peekGrokAlbumThumbnail,
  resolveGrokAlbumThumbnail,
  subscribeGrokAlbumThumbnail,
} from "@/lib/grokAlbumThumbnail";

export type GrokAlbumThumbnailProps = {
  url: string;
  alt: string;
  width?: number | null;
  height?: number | null;
  itemId?: string;
  onUnavailable?: (id: string) => void;
};

export function GrokAlbumThumbnail({
  url,
  alt,
  width,
  height,
  itemId,
  onUnavailable,
}: GrokAlbumThumbnailProps) {
  const [src, setSrc] = useState<string | null>(() =>
    peekGrokAlbumThumbnail(url),
  );
  const [failed, setFailed] = useState(false);
  const aspectRatio = useMemo(() => {
    const w = Number(width);
    const h = Number(height);
    return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
      ? `${w} / ${h}`
      : "16 / 9";
  }, [height, width]);

  useEffect(() => {
    const update = () => setSrc(peekGrokAlbumThumbnail(url));
    update();
    return subscribeGrokAlbumThumbnail(url, update);
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (src) {
      return () => {
        cancelled = true;
      };
    }

    void resolveGrokAlbumThumbnail(url).then((next) => {
      if (cancelled) return;
      setSrc(next);
      setFailed(!next);
      if (!next && itemId) onUnavailable?.(itemId);
    });
    return () => {
      cancelled = true;
    };
  }, [src, url, itemId, onUnavailable]);

  if (!src) {
    return (
      <span
        className="wallpaper-masonry__thumb-placeholder"
        data-state={failed ? "failed" : "loading"}
        style={{ aspectRatio }}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="wallpaper-masonry__img"
      loading="lazy"
      onError={() => {
        forgetGrokAlbumThumbnail(url);
        setFailed(true);
        if (itemId) onUnavailable?.(itemId);
      }}
    />
  );
}
