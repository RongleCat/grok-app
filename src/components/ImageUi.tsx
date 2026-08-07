/**
 * Shared image UI: click → lightbox; right-click menu aligned with AttachmentCard
 * (view, reveal, copy image, copy path when a local path is known).
 *
 * Chat cards use a **fixed height** (150px) with width from natural ratio.
 * Aspect ratios are cached in memory + localStorage (`imageAspectCache`) so
 * virtual-list remounts and next app launch paint the correct card width
 * immediately — no decode-time width thrash while scrolling.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import * as api from "@/lib/api";
import { isTauri } from "@/lib/api";
import {
  copyImageFromHtmlImage,
  copyImageFromPath,
  copyImageFromSrc,
} from "@/lib/copyImage";
import {
  ensureMediaEndpoint,
  isMediaEndpointReady,
  isViewableSrc,
  resolveImageSrc,
  resolveImageSrcSync,
} from "@/lib/imageSrc";
import {
  mediaLoadErrorLabelMap,
  resolveMediaSrcFailure,
  type MediaLoadErrorKind,
} from "@/lib/mediaLoadPro";
import {
  getImageAspect,
  setImageAspect,
} from "@/lib/imageAspectCache";
import {
  canUseImageThumb,
  resolveChatImageThumb,
} from "@/lib/imageThumbClient";
import { useImageViewerOptional } from "@/components/ImageViewer";
import { IconCopy, IconExternalLink, IconFolder } from "@/components/icons";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { createT, type Locale } from "@/i18n";
import { revealInOsLabel } from "@/lib/appPlatform";

export interface ImageUiLabels {
  viewImage: string;
  copyImage: string;
  /** Reveal in OS file manager (Finder / Explorer / Files). */
  reveal: string;
  /** Copy path — same copy as attach.copyPath */
  copyPath: string;
  open?: string;
  /**
   * Honest copy when image fails to resolve/load (generic fallback).
   * Prefer `loadFailedByKind` when available.
   */
  loadFailed?: string;
  /** Classified media.err.* labels keyed by MediaLoadErrorKind. */
  loadFailedByKind?: Partial<Record<MediaLoadErrorKind, string>>;
}

/**
 * - `card` — chat inline cards (max height 150px, ratio-aware).
 * - `pane` — resource sidebar: full pane width, natural ratio, no chat caps.
 */
export type ImageUiLayout = "card" | "pane";

interface ImageUiProps {
  src: string;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  /**
   * Absolute filesystem path when known (local previews / attachments).
   * Enables Reveal + Copy path. Remote/data URLs omit these items.
   */
  path?: string;
  /** Sibling sources for gallery prev/next */
  gallery?: string[];
  labels: ImageUiLabels;
  /** Optional extra menu items at the end */
  extraMenu?: ReactNode;
  draggable?: boolean;
  /**
   * Sizing mode. Defaults to `card` for chat; resource pane must pass `pane`.
   */
  layout?: ImageUiLayout;
}

/**
 * Chat card outer caps (px). Height stays ≤150 so multi-image turns do not
 * dominate the virtual list / stick-to-bottom; width follows natural ratio.
 * Exported for virtual-row height estimates (must stay in sync with CSS).
 */
export const CHAT_IMAGE_CARD_MAX_W = 240;
export const CHAT_IMAGE_CARD_MAX_H = 150;
/** Placeholder ratio before natural size is known (no disk cache hit). */
const DEFAULT_AR = 4 / 3;

/** True when path looks like a local absolute path we can reveal/copy. */
function isLocalFsPath(path: string | undefined): path is string {
  if (!path) return false;
  if (path.startsWith("http://") || path.startsWith("https://")) return false;
  if (path.startsWith("data:") || path.startsWith("blob:")) return false;
  if (path.startsWith("asset:") || path.includes("asset.localhost")) return false;
  if (path.startsWith("media:") || path.includes("media.localhost")) return false;
  // Unix absolute or Windows drive
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function initialResolvedSrc(src: string): string | null {
  if (isViewableSrc(src)) return src;
  return resolveImageSrcSync(src);
}

function readCachedAr(src: string, path?: string): number | null {
  return getImageAspect(src, path);
}

/**
 * Fit natural ratio into the chat card box.
 * Height is **always** MAX_H so row measure stays stable across decode;
 * width follows ratio (capped at MAX_W). Letterbox via object-fit:contain.
 */
function fitCardBox(ar: number): {
  widthPx: number;
  heightPx: number;
  ar: number;
} {
  const ratio = ar > 0 && Number.isFinite(ar) ? ar : DEFAULT_AR;
  const heightPx = CHAT_IMAGE_CARD_MAX_H;
  const widthPx = Math.min(CHAT_IMAGE_CARD_MAX_W, heightPx * ratio);
  return { widthPx, heightPx, ar: ratio };
}

function resolveLayout(
  layout: ImageUiLayout | undefined,
  className: string | undefined,
): ImageUiLayout {
  if (layout === "pane" || layout === "card") return layout;
  // Resource pane legacy class names
  if (
    className &&
    (/\brp-preview__img\b/.test(className) ||
      /\brv-preview__img\b/.test(className))
  ) {
    return "pane";
  }
  return "card";
}

function frameClassName(
  className: string | undefined,
  state: "pending" | "ready" | "broken",
  layout: ImageUiLayout,
): string {
  const base = (className || "").replace(/\bmd-body__img\b/g, "").trim();
  const layoutClass =
    layout === "pane"
      ? "md-body__img-frame--pane"
      : "md-body__img-frame--card";
  const parts = [
    "md-body__img-frame",
    layoutClass,
    state === "pending" ? "is-pending" : "",
    state === "broken" ? "is-broken" : "",
    state === "ready" ? "is-ready" : "",
    base,
  ];
  return parts.filter(Boolean).join(" ");
}

export function ImageUi({
  src,
  alt = "",
  className,
  style,
  path,
  gallery,
  labels,
  extraMenu,
  draggable = false,
  layout: layoutProp,
}: ImageUiProps) {
  const layout = resolveLayout(layoutProp, className);
  const viewer = useImageViewerOptional();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(() =>
    initialResolvedSrc(src),
  );
  /** Once load fails, keep a stable broken state — never re-fetch on re-render. */
  const [loadFailed, setLoadFailed] = useState(false);
  /** Classified reason when resolve or decode fails (MEDIA-LOAD-PRO). */
  const [failKind, setFailKind] = useState<MediaLoadErrorKind | null>(null);
  /**
   * Natural width/height ratio. Seeded from disk/memory cache so scroll
   * remounts and cold start paint the correct card width immediately.
   */
  const [aspectRatio, setAspectRatio] = useState<number>(
    () => readCachedAr(src, path) ?? DEFAULT_AR,
  );
  const [ratioKnown, setRatioKnown] = useState(
    () => readCachedAr(src, path) != null,
  );
  /** Once we painted from cache or decode, freeze width unless AR shifts a lot. */
  const lockedArRef = useRef<number | null>(readCachedAr(src, path));

  const localPath = isLocalFsPath(path)
    ? path
    : isLocalFsPath(src)
      ? src
      : undefined;

  const applyNaturalSize = useCallback(
    (nw: number, nh: number) => {
      if (!(nw > 0 && nh > 0)) return;
      const ar = nw / nh;
      if (!(ar > 0) || !Number.isFinite(ar)) return;
      // Persist for scroll remounts + next launch (path / media URL aliases).
      setImageAspect(src, path || localPath, ar, localPath ? [localPath] : []);
      const locked = lockedArRef.current;
      // Cached / already-shown size: ignore tiny decode differences (no reflow).
      if (
        locked != null &&
        Math.abs(locked - ar) / Math.max(locked, ar, 0.01) < 0.03
      ) {
        setRatioKnown(true);
        return;
      }
      lockedArRef.current = ar;
      setAspectRatio((prev) =>
        Math.abs(prev - ar) / Math.max(prev, ar, 0.01) < 0.01 ? prev : ar,
      );
      setRatioKnown(true);
    },
    [src, path, localPath],
  );

  useEffect(() => {
    let cancelled = false;
    const next = initialResolvedSrc(src);
    setResolvedSrc(next);
    setLoadFailed(false);
    setFailKind(null);
    const cached = readCachedAr(src, path);
    if (cached != null) {
      lockedArRef.current = cached;
      setAspectRatio(cached);
      setRatioKnown(true);
    } else {
      // Height is fixed for chat cards — AR only affects width. Default is fine
      // until decode; avoid flashing a different height (that was the jitter).
      lockedArRef.current = null;
      setAspectRatio(DEFAULT_AR);
      setRatioKnown(false);
    }

    const useThumb = layout === "card" && canUseImageThumb(src, path);

    if (useThumb) {
      // Chat cards: Host disk thumb (≤480px) + session URL cache — not full original.
      void resolveChatImageThumb(src, path)
        .then((r) => {
          if (cancelled) return;
          if (r?.displaySrc) {
            setResolvedSrc(r.displaySrc);
            setLoadFailed(false);
            setFailKind(null);
            if (r.width > 0 && r.height > 0) {
              applyNaturalSize(r.width, r.height);
            }
          } else {
            setResolvedSrc(null);
            const fail = resolveMediaSrcFailure({
              pathOrUrl: path || src,
              resolvedSrc: null,
              isTauri: isTauri(),
              mediaEndpointReady: isMediaEndpointReady(),
            });
            setFailKind(fail.kind);
          }
        })
        .catch(() => {
          if (cancelled) return;
          // Soft fallback: full resolve path.
          void ensureMediaEndpoint()
            .then(() => resolveImageSrc(path || src))
            .then((url) => {
              if (cancelled) return;
              if (url) {
                setResolvedSrc(url);
                setLoadFailed(false);
                setFailKind(null);
              }
            });
        });
      return () => {
        cancelled = true;
      };
    }

    // Pane / non-thumb: ensure loopback HTTP, then re-resolve full asset.
    if (!isViewableSrc(src) || !next?.startsWith("http://127.0.0.1")) {
      void ensureMediaEndpoint()
        .then(() => resolveImageSrc(src))
        .then((url) => {
          if (cancelled) return;
          if (url) {
            if (url !== next) setResolvedSrc(url);
            setLoadFailed(false);
            setFailKind(null);
          } else {
            setResolvedSrc(null);
            const r = resolveMediaSrcFailure({
              pathOrUrl: path || src,
              resolvedSrc: null,
              isTauri: isTauri(),
              mediaEndpointReady: isMediaEndpointReady(),
            });
            setFailKind(r.kind);
          }
        })
        .catch(() => {
          /* keep sync resolve — soft-fail, never crash */
          if (cancelled || next) return;
          const r = resolveMediaSrcFailure({
            pathOrUrl: path || src,
            resolvedSrc: null,
            isTauri: isTauri(),
            mediaEndpointReady: isMediaEndpointReady(),
          });
          setFailKind(r.kind);
        });
    } else if (!next) {
      const r = resolveMediaSrcFailure({
        pathOrUrl: path || src,
        resolvedSrc: null,
        isTauri: isTauri(),
        mediaEndpointReady: isMediaEndpointReady(),
      });
      setFailKind(r.kind);
    }
    return () => {
      cancelled = true;
    };
  }, [src, path, layout, applyNaturalSize]);

  // Recover size if decode finished before onLoad bound (disk cache).
  useEffect(() => {
    const el = imgRef.current;
    if (!el || !resolvedSrc || loadFailed) return;
    if (el.complete && el.naturalWidth > 0 && el.naturalHeight > 0) {
      applyNaturalSize(el.naturalWidth, el.naturalHeight);
    }
  }, [resolvedSrc, loadFailed, applyNaturalSize]);

  const openViewer = () => {
    // Lightbox prefers original local path / full src — not the chat thumb JPEG.
    const full =
      localPath ||
      (isViewableSrc(src) && !src.includes("127.0.0.1") ? src : null) ||
      resolvedSrc;
    if (!full) return;
    const slides =
      gallery && gallery.length > 0
        ? gallery
        : localPath
          ? [localPath]
          : [full];
    const want = localPath ?? full;
    const idx = Math.max(
      0,
      slides.findIndex(
        (s) => s === want || s === resolvedSrc || s === localPath || s === src,
      ),
    );
    viewer.open(
      slides.map((s) => ({
        src: s,
        alt,
        title: alt || (isLocalFsPath(s) ? s.split(/[/\\]/).pop() : undefined),
      })),
      idx >= 0 ? idx : 0,
    );
  };

  const copyImage = async () => {
    // Prefer painted <img> + Host file path (WebView ClipboardItem / fetch often fail).
    const el = imgRef.current;
    if (el && el.naturalWidth > 0) {
      const r = await copyImageFromHtmlImage(el, { localPath });
      if (r.ok) return;
      console.warn("[ImageUi] copy from img failed:", r.reason, {
        localPath,
        resolvedSrc,
      });
    }
    if (localPath) {
      const r = await copyImageFromPath(localPath);
      if (r.ok) return;
    }
    if (!resolvedSrc) return;
    const r = await copyImageFromSrc(resolvedSrc);
    if (!r.ok) {
      console.warn("[ImageUi] copy image failed:", r.reason, {
        localPath,
        resolvedSrc,
      });
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

  const revealPath = async () => {
    if (!localPath || !api.isTauri()) return;
    try {
      await api.pathReveal(localPath);
    } catch (e) {
      console.error(e);
    }
  };

  const menuItems: ContextMenuItem[] = [
    {
      id: "view",
      label: labels.viewImage,
      icon: <IconExternalLink size={16} />,
      onClick: () => openViewer(),
      disabled: !resolvedSrc || loadFailed,
    },
  ];
  if (localPath) {
    menuItems.push({
      id: "reveal",
      label: labels.reveal,
      icon: <IconFolder size={16} />,
      onClick: () => {
        void revealPath();
      },
    });
  }
  menuItems.push({
    id: "copy-image",
    label: labels.copyImage,
    icon: <IconCopy size={16} />,
    onClick: () => {
      void copyImage();
    },
    disabled: !resolvedSrc || loadFailed,
  });
  if (localPath) {
    menuItems.push({
      id: "copy-path",
      label: labels.copyPath,
      icon: <IconCopy size={16} />,
      onClick: () => {
        void copyPath();
      },
    });
  }

  const state: "pending" | "ready" | "broken" = loadFailed || (!resolvedSrc && failKind)
    ? "broken"
    : resolvedSrc && ratioKnown
      ? "ready"
      : "pending";

  const brokenLabel = (() => {
    if (failKind && labels.loadFailedByKind?.[failKind]) {
      return labels.loadFailedByKind[failKind]!;
    }
    if (labels.loadFailed) return labels.loadFailed;
    return alt || "image";
  })();

  const ar =
    aspectRatio > 0 && Number.isFinite(aspectRatio)
      ? aspectRatio
      : DEFAULT_AR;

  // Chat cards: fixed height 150px (width from ratio). Explicit px height so
  // max-width shrinks (scrollbar / narrow chat) do not change vertical size.
  // Resource pane: fill width, natural ratio.
  const frameStyle: CSSProperties =
    layout === "pane"
      ? {
          ...style,
          width: "100%",
          maxWidth: "100%",
          height: "auto",
          maxHeight: "none",
          aspectRatio: `${ar}`,
          ["--img-ar" as string]: String(ar),
        }
      : (() => {
          const box = fitCardBox(ar);
          return {
            ...style,
            width: box.widthPx,
            height: box.heightPx,
            maxWidth: "100%",
            maxHeight: CHAT_IMAGE_CARD_MAX_H,
            // Prefer explicit height over aspect-ratio so width clamps don't
            // reflow scrollHeight (virtual list + stick thrash).
            aspectRatio: "unset",
            ["--img-ar" as string]: String(box.ar),
          };
        })();

  return (
    <>
      <span
        className={frameClassName(className, state, layout)}
        style={frameStyle}
        role={state === "broken" ? "img" : undefined}
        aria-label={state === "broken" ? brokenLabel : undefined}
        title={
          state === "broken"
            ? brokenLabel
            : undefined
        }
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {loadFailed || (!resolvedSrc && failKind) ? (
          <span className="md-body__img-frame__fallback">
            {brokenLabel}
          </span>
        ) : resolvedSrc ? (
          <img
            ref={imgRef}
            className="md-body__img-frame__el"
            src={resolvedSrc}
            alt={alt}
            draggable={draggable}
            // Allow canvas read for copy when media is loopback HTTP (CORS-enabled).
            crossOrigin={
              /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(resolvedSrc)
                ? "anonymous"
                : undefined
            }
            // Eager: lazy + nested chat scroller unloads/reloads and collapses
            // height mid-scroll (especially WKWebView / Tauri).
            loading="eager"
            decoding="async"
            onLoad={(e) => {
              const el = e.currentTarget;
              applyNaturalSize(el.naturalWidth, el.naturalHeight);
            }}
            onError={() => {
              setLoadFailed(true);
              const r = resolveMediaSrcFailure({
                pathOrUrl: path || src,
                resolvedSrc,
                loadFailed: true,
                isTauri: isTauri(),
                mediaEndpointReady: isMediaEndpointReady(),
              });
              setFailKind(r.kind);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openViewer();
            }}
          />
        ) : (
          <span className="md-body__img-frame__fallback" aria-hidden>
            {alt || ""}
          </span>
        )}
      </span>
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
}

/** Build image UI labels from locale (OS-aware reveal label). */
export function imageUiLabels(locale: Locale): ImageUiLabels {
  const tr = createT(locale);
  return {
    viewImage: tr("image.view"),
    copyImage: tr("image.copy"),
    reveal: revealInOsLabel(tr),
    copyPath: tr("attach.copyPath"),
    loadFailed: tr("media.err.other"),
    loadFailedByKind: mediaLoadErrorLabelMap(tr),
  };
}
