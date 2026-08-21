/**
 * Full-bleed wallpaper media with pan/zoom focus (+ optional video clip).
 *
 * Layout is absolute (not object-fit alone) so focus works for video without
 * re-encoding. Video in/out is applied by seeking — source never truncated.
 *
 * Flash avoidance: prefer intrinsicSize from meta; stay invisible until layout
 * is ready (no cover→absolute jump).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { WallpaperClip, WallpaperKind } from "@/lib/themeSkin";
import {
  DEFAULT_WALLPAPER_FOCUS,
  enforceVideoClip,
  normalizeWallpaperFocus,
  wallpaperMediaLayout,
  type WallpaperFocus,
} from "@/lib/themeSkin";
import {
  readStreamPerfFlag,
  shouldPlayWallpaperVideo,
} from "@/lib/streamRenderPolicy";

export type WallpaperMediaSize = { w: number; h: number };

export type WallpaperMediaLayerProps = {
  url: string;
  kind: WallpaperKind;
  focus?: WallpaperFocus | null;
  /** Video in/out (seconds). Omitted / null = full loop. */
  clip?: WallpaperClip | null;
  /**
   * Known natural size from wallpaper meta. When present, focus layout is
   * computed immediately — critical for video to avoid a proportion flash.
   */
  intrinsicSize?: WallpaperMediaSize | null;
  className?: string;
  mediaClassName?: string;
  /** Fired once when natural size is first measured (for meta backfill). */
  onIntrinsicSize?: (size: WallpaperMediaSize) => void;
};

function validSize(s: WallpaperMediaSize | null | undefined): s is WallpaperMediaSize {
  return !!s && s.w > 0 && s.h > 0 && Number.isFinite(s.w) && Number.isFinite(s.h);
}

export function WallpaperMediaLayer({
  url,
  kind,
  focus,
  clip = null,
  intrinsicSize = null,
  className = "app-wallpaper-media",
  mediaClassName = "app-wallpaper-media__el",
  onIntrinsicSize,
}: WallpaperMediaLayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const reportedSizeRef = useRef<string | null>(null);
  const clipRef = useRef<WallpaperClip | null>(clip);

  const [view, setView] = useState<WallpaperMediaSize>({ w: 0, h: 0 });
  const [media, setMedia] = useState<WallpaperMediaSize>(() =>
    validSize(intrinsicSize) ? { w: intrinsicSize.w, h: intrinsicSize.h } : { w: 0, h: 0 },
  );

  const f = normalizeWallpaperFocus(focus ?? DEFAULT_WALLPAPER_FOCUS);
  clipRef.current = clip ?? null;

  // Seed / refresh from meta when the source changes.
  useLayoutEffect(() => {
    if (validSize(intrinsicSize)) {
      setMedia({ w: intrinsicSize.w, h: intrinsicSize.h });
    } else {
      setMedia({ w: 0, h: 0 });
    }
    reportedSizeRef.current = null;
  }, [url, intrinsicSize?.w, intrinsicSize?.h]);

  // Measure container before paint to avoid a 0→real view flash.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const apply = (w: number, h: number) => {
      setView((prev) => {
        if (Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5) return prev;
        return { w, h };
      });
    };
    apply(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      apply(cr.width, cr.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const publishSize = useCallback(
    (w: number, h: number) => {
      if (!(w > 0 && h > 0)) return;
      setMedia((prev) => {
        if (prev.w === w && prev.h === h) return prev;
        return { w, h };
      });
      const key = `${w}x${h}`;
      if (reportedSizeRef.current === key) return;
      reportedSizeRef.current = key;
      if (
        !validSize(intrinsicSize) ||
        intrinsicSize.w !== w ||
        intrinsicSize.h !== h
      ) {
        onIntrinsicSize?.({ w, h });
      }
    },
    [intrinsicSize, onIntrinsicSize],
  );

  const onReady = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el instanceof HTMLVideoElement) {
      publishSize(el.videoWidth, el.videoHeight);
      const c = clipRef.current;
      if (c && Number.isFinite(c.start)) {
        try {
          el.currentTime = c.start;
        } catch {
          /* ignore */
        }
      }
      return;
    }
    publishSize(el.naturalWidth, el.naturalHeight);
  }, [publishSize]);

  useLayoutEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el instanceof HTMLVideoElement) {
      if (el.readyState >= 1 && el.videoWidth > 0) {
        publishSize(el.videoWidth, el.videoHeight);
      }
      return;
    }
    if (el.complete && el.naturalWidth > 0) {
      publishSize(el.naturalWidth, el.naturalHeight);
    }
  }, [url, publishSize]);

  // Clip loop: disable native loop when a range is set; seek on timeupdate.
  useEffect(() => {
    if (kind !== "video") return;
    const el = mediaRef.current;
    if (!(el instanceof HTMLVideoElement)) return;

    const c = clip;
    el.loop = !c;

    if (c) {
      const startAt = () => {
        try {
          if (el.currentTime < c.start - 0.05 || el.currentTime >= c.end) {
            el.currentTime = c.start;
          }
        } catch {
          /* ignore */
        }
      };
      startAt();
      const onTime = () => enforceVideoClip(el, c);
      const onEnded = () => {
        try {
          el.currentTime = c.start;
          void el.play().catch(() => {});
        } catch {
          /* ignore */
        }
      };
      el.addEventListener("timeupdate", onTime);
      el.addEventListener("ended", onEnded);
      return () => {
        el.removeEventListener("timeupdate", onTime);
        el.removeEventListener("ended", onEnded);
      };
    }

    return undefined;
  }, [kind, clip, url]);

  // Pause wallpaper video while hidden or while stream-perf is on (live turn).
  useEffect(() => {
    if (kind !== "video") return;
    const apply = () => {
      const el = mediaRef.current;
      if (!(el instanceof HTMLVideoElement)) return;
      const play = shouldPlayWallpaperVideo({
        visibilityState: document.visibilityState,
        streamPerf: readStreamPerfFlag(document.documentElement.dataset),
      });
      if (play) {
        void el.play().catch(() => {});
        return;
      }
      try {
        if (!el.paused) el.pause();
      } catch {
        /* ignore */
      }
    };
    apply();
    document.addEventListener("visibilitychange", apply);
    const root = document.documentElement;
    const obs = new MutationObserver(apply);
    obs.observe(root, {
      attributes: true,
      attributeFilter: ["data-stream-perf"],
    });
    return () => {
      document.removeEventListener("visibilitychange", apply);
      obs.disconnect();
    };
  }, [kind, url]);

  const layout =
    media.w > 0 && media.h > 0 && view.w > 0 && view.h > 0
      ? wallpaperMediaLayout(media.w, media.h, view.w, view.h, f)
      : null;

  const ready = layout !== null;

  const style: CSSProperties = layout
    ? {
        position: "absolute",
        width: layout.width,
        height: layout.height,
        left: layout.left,
        top: layout.top,
        maxWidth: "none",
        objectFit: "fill",
        opacity: 1,
      }
    : {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        opacity: 0,
      };

  return (
    <div
      ref={rootRef}
      className={className + (ready ? " is-ready" : "")}
      aria-hidden
    >
      {kind === "video" ? (
        <video
          ref={(el) => {
            mediaRef.current = el;
          }}
          className={mediaClassName}
          src={url}
          autoPlay
          muted
          loop={!clip}
          playsInline
          disablePictureInPicture
          preload="auto"
          style={style}
          onLoadedMetadata={onReady}
          onLoadedData={onReady}
        />
      ) : (
        <img
          ref={(el) => {
            mediaRef.current = el;
          }}
          className={mediaClassName}
          src={url}
          alt=""
          draggable={false}
          style={style}
          onLoad={onReady}
        />
      )}
    </div>
  );
}
