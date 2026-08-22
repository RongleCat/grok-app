/**
 * Inline video card for chat: session-relative / local paths.
 * Plays via Host loopback media HTTP (Range); right-click: open / reveal / copy path.
 *
 * Frame always reserves a non-zero size (default 16:9, then natural ratio)
 * so streaming remounts / metadata decode never collapse scrollHeight —
 * that thrash + stick-to-bottom follow was the chat flicker with video output.
 *
 * **Click-to-play**: do not attach `src` / fire media Range until the user
 * starts playback. Opening a long agent session with a large mp4 previously
 * auto-mounted the player and fan-out concurrent protocol workers, which
 * contributed to host SIGABRT crashes on WKURLSchemeTask respond paths.
 *
 * **Poster cover**: idle state shows a cached still (host ffmpeg or client
 * canvas after first play). Cache lives under ~/.grok-app/cache/video-posters
 * keyed by path+mtime+size so reopening a session never re-extracts.
 */

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import * as api from "@/lib/api";
import { pathToPreviewUrl } from "@/lib/filePreviewSrc";
import { IconCopy, IconExternalLink, IconFolder } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { createT, type Locale } from "@/i18n";
import { pathBasename } from "@/lib/attachments";
import { revealInOsLabel } from "@/lib/appPlatform";

export interface VideoUiLabels {
  open: string;
  reveal: string;
  copyPath: string;
  loadError?: string;
  /** Primary CTA on the idle poster (click-to-play). */
  play?: string;
}

interface VideoUiProps {
  /** Absolute filesystem path (preferred) or already-viewable URL. */
  src: string;
  /** Absolute path for open/reveal/copy (when known). */
  path?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
  labels: VideoUiLabels;
  extraMenu?: ReactNode;
}

/** Chat card outer caps (px). */
const CARD_MAX_W = 360;
const CARD_MAX_H = 240;
/** Placeholder ratio before metadata is known (most agent clips are 16:9). */
const DEFAULT_AR = 16 / 9;

/** Remember natural ratios so remounts keep the right box. */
const aspectCache = new Map<string, number>();
/** Remember resolved media URLs so remounts skip the loading→ready height flip. */
const srcCache = new Map<string, string>();
/** In-memory poster media URLs (absolute path → viewable URL). */
const posterUrlCache = new Map<string, string>();
/** In-flight poster resolves so many remounts share one invoke. */
const posterInflight = new Map<string, Promise<string | null>>();

function isLocalFsPath(path: string | undefined): path is string {
  if (!path) return false;
  if (path.startsWith("http://") || path.startsWith("https://")) return false;
  if (path.startsWith("data:") || path.startsWith("blob:")) return false;
  if (path.startsWith("asset:") || path.includes("asset.localhost")) return false;
  if (path.startsWith("media:") || path.includes("media.localhost")) return false;
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function isViewableVideoSrc(src: string): boolean {
  return (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:") ||
    src.startsWith("blob:") ||
    src.startsWith("asset:") ||
    src.startsWith("media:") ||
    src.includes("asset.localhost") ||
    src.includes("media.localhost")
  );
}

function cacheKey(src: string, path?: string): string {
  return path || src;
}

function readCachedAr(src: string, path?: string): number | null {
  const k = cacheKey(src, path);
  return aspectCache.get(k) ?? aspectCache.get(src) ?? null;
}

function readCachedSrc(src: string): string | null {
  if (isViewableVideoSrc(src)) return src;
  return srcCache.get(src) ?? null;
}

/** Fit natural ratio into max box; returns width px + aspect ratio. */
function fitCardBox(ar: number): { widthPx: number; ar: number } {
  const ratio = ar > 0 && Number.isFinite(ar) ? ar : DEFAULT_AR;
  let widthPx = CARD_MAX_W;
  let heightPx = widthPx / ratio;
  if (heightPx > CARD_MAX_H) {
    heightPx = CARD_MAX_H;
    widthPx = heightPx * ratio;
  }
  return { widthPx, ar: ratio };
}

/**
 * Resolve a poster URL for a local video path (disk cache + optional ffmpeg).
 * Dedupes concurrent callers; never throws.
 */
async function resolvePosterUrl(localPath: string): Promise<string | null> {
  const hit = posterUrlCache.get(localPath);
  if (hit) return hit;
  const pending = posterInflight.get(localPath);
  if (pending) return pending;

  const work = (async () => {
    if (!api.isTauri() || !api.hasHost()) return null;
    try {
      const res = await api.mediaVideoPoster(localPath);
      if (!res?.posterPath) return null;
      const url = await pathToPreviewUrl(res.posterPath, "image");
      if (url) posterUrlCache.set(localPath, url);
      return url;
    } catch {
      // ffmpeg missing / path denied — idle card keeps flat poster.
      return null;
    } finally {
      posterInflight.delete(localPath);
    }
  })();
  posterInflight.set(localPath, work);
  return work;
}

/** Grab one frame from a playing/ready video element as JPEG base64 (no prefix). */
function captureVideoFrameJpeg(
  video: HTMLVideoElement,
  maxEdge = 720,
): string | null {
  try {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!(vw > 0 && vh > 0)) return null;
    let w = vw;
    let h = vh;
    if (w > maxEdge || h > maxEdge) {
      if (w >= h) {
        h = Math.round((h * maxEdge) / w);
        w = maxEdge;
      } else {
        w = Math.round((w * maxEdge) / h);
        h = maxEdge;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    const m = /^data:image\/jpeg;base64,(.+)$/i.exec(dataUrl);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export const VideoUi = memo(function VideoUi({
  src,
  path,
  title = "",
  className,
  style,
  labels,
  extraMenu,
}: VideoUiProps) {
  const localPath = isLocalFsPath(path)
    ? path
    : isLocalFsPath(src)
      ? src
      : undefined;

  /** User has asked to play — only then resolve media HTTP and mount <video>. */
  const [started, setStarted] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number>(
    () => readCachedAr(src, path) ?? DEFAULT_AR,
  );
  const [posterUrl, setPosterUrl] = useState<string | null>(() =>
    localPath ? (posterUrlCache.get(localPath) ?? null) : null,
  );
  const posterSavedRef = useRef(false);
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  const applyNaturalSize = useCallback(
    (nw: number, nh: number) => {
      if (!(nw > 0 && nh > 0)) return;
      const ar = nw / nh;
      aspectCache.set(cacheKey(src, path), ar);
      aspectCache.set(src, ar);
      if (localPath) aspectCache.set(localPath, ar);
      setAspectRatio(ar);
    },
    [src, path, localPath],
  );

  // Reset play state when the underlying path changes (stream remount / new card).
  useEffect(() => {
    setStarted(false);
    setResolvedSrc(null);
    setError(false);
    posterSavedRef.current = false;
    const cachedAr = readCachedAr(src, path);
    if (cachedAr != null) setAspectRatio(cachedAr);
    else setAspectRatio(DEFAULT_AR);
    if (localPath) {
      setPosterUrl(posterUrlCache.get(localPath) ?? null);
    } else {
      setPosterUrl(null);
    }
  }, [src, path, localPath]);

  // Load cached / extract poster without mounting the full video player.
  useEffect(() => {
    if (!localPath || !api.isTauri()) return;
    let cancelled = false;
    void resolvePosterUrl(localPath).then((url) => {
      if (!cancelled && url) setPosterUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [localPath]);

  // Resolve media URL only after click-to-play (or if already viewable & started).
  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    setError(false);

    if (isViewableVideoSrc(src)) {
      setResolvedSrc(src);
      return;
    }
    const cached = readCachedSrc(src);
    if (cached) {
      setResolvedSrc(cached);
      return;
    }
    void pathToPreviewUrl(src, "video").then((url) => {
      if (cancelled) return;
      if (url) {
        srcCache.set(src, url);
        setResolvedSrc(url);
      } else {
        setResolvedSrc(null);
        setError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [started, src]);

  // Pause when the window is backgrounded so WebKit cancels fewer in-flight
  // media Range tasks (focus-away → focus-back used to race WKURLSchemeTask
  // respond and SIGABRT the host on older builds).
  useEffect(() => {
    if (!started || !resolvedSrc) return;
    const onVis = () => {
      if (document.visibilityState !== "hidden") return;
      const v = videoElRef.current;
      if (!v || v.paused) return;
      try {
        v.pause();
      } catch {
        /* ignore */
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [started, resolvedSrc]);

  const trySaveClientPoster = useCallback(
    (video: HTMLVideoElement) => {
      if (!localPath || posterSavedRef.current || !api.isTauri()) return;
      if (posterUrlCache.has(localPath)) {
        posterSavedRef.current = true;
        return;
      }
      // Do not seek (would jump playback). Wait for natural progress so we
      // avoid a pure black first frame when possible.
      const shoot = () => {
        if (posterSavedRef.current) return;
        const b64 = captureVideoFrameJpeg(video);
        if (!b64) return;
        posterSavedRef.current = true;
        void api
          .mediaVideoPosterSave(localPath, b64)
          .then(async (res) => {
            if (!res?.posterPath) return;
            const url = await pathToPreviewUrl(res.posterPath, "image");
            if (url) {
              posterUrlCache.set(localPath, url);
              setPosterUrl(url);
            }
          })
          .catch(() => {
            posterSavedRef.current = false;
          });
      };
      if (video.currentTime >= 0.2) {
        shoot();
        return;
      }
      const onTime = () => {
        if (video.currentTime >= 0.25) {
          video.removeEventListener("timeupdate", onTime);
          shoot();
        }
      };
      video.addEventListener("timeupdate", onTime);
      window.setTimeout(() => {
        video.removeEventListener("timeupdate", onTime);
        shoot();
      }, 1500);
    },
    [localPath],
  );

  const startPlayback = () => {
    setError(false);
    setStarted(true);
  };

  const openExternal = async () => {
    if (!localPath || !api.isTauri()) return;
    try {
      await api.pathOpen(localPath);
    } catch (e) {
      console.error(e);
    }
  };

  const revealPath = async () => {
    if (!localPath || !api.isTauri()) return;
    try {
      await api.pathReveal(localPath);
    } catch (e) {
      console.error(e);
    }
  };

  const copyPath = async () => {
    if (!localPath) return;
    try {
      await navigator.clipboard.writeText(localPath);
    } catch {
      /* ignore */
    }
  };

  const displayTitle = title || (localPath ? pathBasename(localPath) : "");
  const playLabel = labels.play || "Play";

  const menuItems: ContextMenuItem[] = [];
  if (localPath) {
    menuItems.push(
      {
        id: "open",
        label: labels.open,
        icon: <IconExternalLink size={16} />,
        onClick: () => {
          void openExternal();
        },
      },
      {
        id: "reveal",
        label: labels.reveal,
        icon: <IconFolder size={16} />,
        onClick: () => {
          void revealPath();
        },
      },
      {
        id: "copy-path",
        label: labels.copyPath,
        icon: <IconCopy size={16} />,
        onClick: () => {
          void copyPath();
        },
      },
    );
  }

  const ar =
    aspectRatio > 0 && Number.isFinite(aspectRatio) ? aspectRatio : DEFAULT_AR;
  const box = fitCardBox(ar);
  // Size the outer card; aspect-ratio lives on the stage so caption height
  // does not fight the reserved media box during stream remounts.
  const cardStyle: CSSProperties = {
    ...style,
    width: box.widthPx,
    maxWidth: "100%",
  };
  const stageStyle: CSSProperties = {
    aspectRatio: `${box.ar}`,
  };

  const stateClass = error
    ? "is-error"
    : started && resolvedSrc
      ? "is-ready"
      : started
        ? "is-pending"
        : "is-idle";

  const onVideoMeta = (e: SyntheticEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    applyNaturalSize(el.videoWidth, el.videoHeight);
    // If host had no ffmpeg, seed disk cache from the first decoded frame.
    trySaveClientPoster(el);
  };

  return (
    <>
      <div
        className={
          "md-body__video-card " +
          stateClass +
          (className ? " " + className : "")
        }
        style={cardStyle}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <div className="md-body__video-card__stage" style={stageStyle}>
          {error ? (
            <div className="md-body__video-card__error">
              <span>{labels.loadError || "Failed to load video"}</span>
              <div className="md-body__video-card__actions">
                <button
                  type="button"
                  className="md-body__video-card__btn"
                  onClick={startPlayback}
                >
                  {playLabel}
                </button>
                {localPath && (
                  <button
                    type="button"
                    className="md-body__video-card__btn"
                    onClick={() => void openExternal()}
                  >
                    {labels.open}
                  </button>
                )}
              </div>
            </div>
          ) : started && resolvedSrc ? (
            <video
              ref={videoElRef}
              className="md-body__video-card__el"
              src={resolvedSrc}
              controls
              playsInline
              // metadata only — full Range fan-out waits for user seek/play
              preload="metadata"
              autoPlay
              onLoadedMetadata={onVideoMeta}
              onError={() => setError(true)}
            />
          ) : (
            <button
              type="button"
              className={
                "md-body__video-card__poster" +
                (posterUrl ? " has-cover" : "")
              }
              onClick={startPlayback}
              aria-label={playLabel}
            >
              {posterUrl ? (
                <img
                  className="md-body__video-card__cover"
                  src={posterUrl}
                  alt=""
                  draggable={false}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                      applyNaturalSize(img.naturalWidth, img.naturalHeight);
                    }
                  }}
                />
              ) : null}
              <span className="md-body__video-card__poster-shade" aria-hidden />
              <span className="md-body__video-card__play" aria-hidden>
                ▶
              </span>
              <span className="md-body__video-card__name">
                {displayTitle || playLabel}
              </span>
              <span className="md-body__video-card__hint">{playLabel}</span>
            </button>
          )}
        </div>
        {displayTitle ? (
          <Tip label={localPath || displayTitle}>
            <div className="md-body__video-card__caption">{displayTitle}</div>
          </Tip>
        ) : null}
      </div>
      <ContextMenu
        open={!!menu}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
        items={menuItems}
        extra={extraMenu}
      />
    </>
  );
});

const videoLabelsCache = new Map<Locale, VideoUiLabels>();

export function videoUiLabels(locale: Locale): VideoUiLabels {
  let cached = videoLabelsCache.get(locale);
  if (!cached) {
    const tr = createT(locale);
    cached = {
      open: tr("attach.open"),
      reveal: revealInOsLabel(tr),
      copyPath: tr("attach.copyPath"),
      loadError: tr("video.loadError"),
      play: tr("video.play"),
    };
    videoLabelsCache.set(locale, cached);
  }
  return cached;
}
