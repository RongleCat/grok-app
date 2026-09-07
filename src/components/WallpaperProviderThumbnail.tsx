import type { MessageKey } from "@/i18n";
import { useEffect, useState } from "react";
import type { WallpaperGalleryItem } from "@/lib/wallpaperSource";
import {
  forgetRemoteWallpaperThumbnail,
  peekRemoteWallpaperThumbnail,
  resolveRemoteWallpaperThumbnail,
  subscribeRemoteWallpaperThumbnail,
} from "@/lib/remoteWallpaperThumbnail";

type Props = {
  item: WallpaperGalleryItem;
  t: (key: MessageKey) => string;
};

export function WallpaperProviderThumbnail({ item, t }: Props) {
  const [src, setSrc] = useState(() => peekRemoteWallpaperThumbnail(item));
  const [pending, setPending] = useState(() => !src);

  useEffect(() => {
    let active = true;
    const cached = peekRemoteWallpaperThumbnail(item);
    setPending(!cached);
    setSrc(cached);
    const unsubscribe = subscribeRemoteWallpaperThumbnail(item, () => {
      if (active) setSrc(peekRemoteWallpaperThumbnail(item));
    });
    void resolveRemoteWallpaperThumbnail(item).then(
      (value) => {
        if (active) {
          setSrc(value);
          setPending(false);
        }
      },
      () => {
        if (active) setPending(false);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [item.source, item.thumbUrl, item.fullUrl]);

  if (src) {
    return (
      <img
        src={src}
        alt={item.textPreview || ""}
        className="wallpaper-masonry__img"
        loading="lazy"
        onError={() => {
          forgetRemoteWallpaperThumbnail(item);
          setSrc(null);
          setPending(false);
        }}
      />
    );
  }

  return (
    <span
      className="wallpaper-provider-thumbnail-placeholder"
      aria-busy={pending}
    >
      {t(
        pending
          ? "settings.wallpaperSource.loadingOriginal"
          : "settings.wallpaperSource.err.download_failed",
      )}
    </span>
  );
}
