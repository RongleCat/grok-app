/**
 * File / folder card for chat history and composer.
 * Images: square thumb, click → lightbox, context menu includes copy image.
 * Other files: click → OS open; right-click → context menu.
 *
 * Preview honesty (ATTACHMENTS-PRO): never claim a ready thumb after onError;
 * missing/broken states surface via title + placeholder (no invented image).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Attachment } from "@/lib/attachments";
import { isImagePath } from "@/lib/attachments";
import {
  attachPreviewMessageKey,
  deriveAttachPreviewPhase,
} from "@/lib/attachmentsPro";
import * as api from "@/lib/api";
import { ensureMediaEndpoint } from "@/lib/imageSrc";
import {
  chatCardFirstPaintSrc,
  nextChatCardDisplaySrc,
  resolveChatImageThumb,
} from "@/lib/imageThumbClient";
import { copyImageFromPath } from "@/lib/copyImage";
import { useImageViewerOptional } from "@/components/ImageViewer";
import {
  IconClose,
  IconCopy,
  IconExternalLink,
  IconFileText,
  IconFolder,
  IconPaperclip,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";

export interface AttachmentCardLabels {
  open: string;
  reveal: string;
  copyPath: string;
  copyImage: string;
  addToComposer: string;
  remove?: string;
  viewImage?: string;
  /** Honest copy when image thumb fails to load. */
  previewBroken?: string;
  /** Honest copy when path is known missing on disk. */
  previewMissing?: string;
  /** Loading thumb (optional; falls back to path tip). */
  previewPending?: string;
}

interface AttachmentCardProps {
  attachment: Attachment;
  labels: AttachmentCardLabels;
  /** Compact chip-style (composer) vs message card */
  variant?: "card" | "chip";
  onAddToComposer?: (a: Attachment) => void;
  onRemove?: (a: Attachment) => void;
  /**
   * Sibling image paths for lightbox prev/next.
   * When omitted, only the current image is shown.
   */
  galleryPaths?: string[];
}

export function AttachmentCard({
  attachment,
  labels,
  variant = "card",
  onAddToComposer,
  onRemove,
  galleryPaths,
}: AttachmentCardProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const isImg = !attachment.isDir && isImagePath(attachment.path);
  const [thumbSrc, setThumbSrc] = useState<string | null>(() =>
    isImg
      ? chatCardFirstPaintSrc(attachment.path, attachment.path, "card")
      : null,
  );
  /** Once decode fails, stay broken — do not re-claim readiness on re-render. */
  const [thumbFailed, setThumbFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewer = useImageViewerOptional();

  useEffect(() => {
    if (!isImg) {
      setThumbSrc(null);
      setThumbFailed(false);
      return;
    }
    // Same thumb path as chat ImageUi (#675). Full originals in a 36px
    // <img> make WKWebView hitch / flash when a long virtualized thread
    // remounts the row (paste screenshots in history).
    const first = chatCardFirstPaintSrc(
      attachment.path,
      attachment.path,
      "card",
    );
    setThumbSrc((prev) => nextChatCardDisplaySrc(prev, { displaySrc: first }));
    setThumbFailed(false);
    let cancelled = false;
    void (async () => {
      try {
        await ensureMediaEndpoint();
        const r = await resolveChatImageThumb(
          attachment.path,
          attachment.path,
        );
        if (cancelled) return;
        const display = nextChatCardDisplaySrc(first, r);
        if (display) {
          setThumbSrc(display);
          setThumbFailed(false);
        }
      } catch {
        /* keep first paint; do not invent a working thumb */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment.path, isImg]);

  const previewPhase = useMemo(
    () =>
      deriveAttachPreviewPhase({
        isImage: isImg,
        hasSrc: !!thumbSrc && !thumbFailed,
        loadFailed: thumbFailed,
        isDir: attachment.isDir,
      }),
    [attachment.isDir, isImg, thumbFailed, thumbSrc],
  );

  const previewTip = useMemo(() => {
    const key = attachPreviewMessageKey(previewPhase);
    if (key === "attach.preview.broken" && labels.previewBroken) {
      return labels.previewBroken;
    }
    if (key === "attach.preview.missing" && labels.previewMissing) {
      return labels.previewMissing;
    }
    if (key === "attach.preview.pending" && labels.previewPending) {
      return labels.previewPending;
    }
    return attachment.path;
  }, [
    attachment.path,
    labels.previewBroken,
    labels.previewMissing,
    labels.previewPending,
    previewPhase,
  ]);

  const showThumb = isImg && !!thumbSrc && !thumbFailed;

  const openPath = async () => {
    try {
      if (api.isTauri()) await api.pathOpen(attachment.path);
    } catch (e) {
      console.error(e);
    }
  };

  const revealPath = async () => {
    try {
      if (api.isTauri()) await api.pathReveal(attachment.path);
    } catch (e) {
      console.error(e);
    }
  };

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(attachment.path);
    } catch {
      /* ignore */
    }
  };

  const copyImage = async () => {
    await copyImageFromPath(attachment.path);
  };

  const openInViewer = () => {
    const gallery =
      galleryPaths && galleryPaths.length > 0
        ? galleryPaths
        : [attachment.path];
    const idx = Math.max(0, gallery.indexOf(attachment.path));
    viewer.open(
      gallery.map((p) => ({ src: p, title: p.split(/[/\\]/).pop() })),
      idx,
    );
  };

  const onPrimaryClick = () => {
    if (isImg) openInViewer();
    else void openPath();
  };

  const menuItems: ContextMenuItem[] = [
    {
      id: "open",
      label: isImg && labels.viewImage ? labels.viewImage : labels.open,
      icon: isImg ? <IconFileText size={16} /> : <IconExternalLink size={16} />,
      onClick: () => {
        if (isImg) openInViewer();
        else void openPath();
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
  ];
  if (isImg) {
    menuItems.push({
      id: "copy-image",
      label: labels.copyImage,
      icon: <IconCopy size={16} />,
      onClick: () => {
        void copyImage();
      },
    });
  }
  menuItems.push({
    id: "copy-path",
    label: labels.copyPath,
    icon: <IconCopy size={16} />,
    onClick: () => {
      void copyPath();
    },
  });
  if (onAddToComposer) {
    menuItems.push({
      id: "add",
      label: labels.addToComposer,
      icon: <IconPaperclip size={16} />,
      onClick: () => onAddToComposer(attachment),
    });
  }

  if (variant === "chip") {
    return (
      <Tip label={previewTip}>
        <span
          ref={rootRef as unknown as React.RefObject<HTMLSpanElement>}
          className={
            "attach-chip" +
            (attachment.isDir ? " attach-chip--dir" : "") +
            (isImg ? " attach-chip--image" : "") +
            (previewPhase === "broken" || previewPhase === "missing"
              ? " attach-chip--preview-fail"
              : "")
          }
          data-preview-phase={isImg ? previewPhase : undefined}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          <button
            type="button"
            className="attach-chip__main"
            onClick={onPrimaryClick}
            title={previewTip}
            aria-label={
              isImg && (previewPhase === "broken" || previewPhase === "missing")
                ? `${attachment.name} — ${previewTip}`
                : undefined
            }
          >
            {showThumb ? (
              <img
                className="attach-chip__thumb"
                src={thumbSrc!}
                alt={attachment.name}
                draggable={false}
                loading="eager"
                decoding="async"
                onError={() => {
                  setThumbFailed(true);
                  setThumbSrc(null);
                }}
              />
            ) : (
              <>
                <span className="attach-chip__icon" aria-hidden>
                  {attachment.isDir ? (
                    <IconFolder size={14} />
                  ) : (
                    <IconFileText size={14} />
                  )}
                </span>
                <span className="attach-chip__name">{attachment.name}</span>
              </>
            )}
          </button>
          {onRemove && labels.remove ? (
            <Tip label={labels.remove}>
              <button
                type="button"
                className="attach-chip__x"
                aria-label={labels.remove}
                onClick={() => onRemove(attachment)}
              >
                <IconClose size={11} />
              </button>
            </Tip>
          ) : onRemove ? (
            <button
              type="button"
              className="attach-chip__x"
              aria-label={labels.remove}
              onClick={() => onRemove(attachment)}
            >
              <IconClose size={11} />
            </button>
          ) : null}
          <ContextMenu
            open={!!menu}
            x={menu?.x ?? 0}
            y={menu?.y ?? 0}
            onClose={() => setMenu(null)}
            items={menuItems}
          />
        </span>
      </Tip>
    );
  }

  return (
    <Tip label={previewTip}>
    <div
      ref={rootRef}
      className={
        "att-card" +
        (attachment.isDir ? " att-card--dir" : "") +
        (isImg ? " att-card--image" : "") +
        (previewPhase === "broken" || previewPhase === "missing"
          ? " att-card--preview-fail"
          : "")
      }
      data-preview-phase={isImg ? previewPhase : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <button
        type="button"
        className={"att-card__btn" + (isImg ? " att-card__btn--image" : "")}
        onClick={onPrimaryClick}
        title={previewTip}
        aria-label={
          isImg && (previewPhase === "broken" || previewPhase === "missing")
            ? `${attachment.name} — ${previewTip}`
            : undefined
        }
      >
        {isImg ? (
          showThumb ? (
            <img
              className="att-card__thumb"
              src={thumbSrc!}
              alt={attachment.name}
              draggable={false}
              loading="eager"
              decoding="async"
              onError={() => {
                setThumbFailed(true);
                setThumbSrc(null);
              }}
            />
          ) : (
            <span
              className={
                "att-card__thumb att-card__thumb--placeholder" +
                (previewPhase === "broken" || previewPhase === "missing"
                  ? " att-card__thumb--fail"
                  : "")
              }
              title={previewTip}
            >
              <IconPaperclip size={18} />
            </span>
          )
        ) : (
          <>
            <span className="att-card__icon" aria-hidden>
              {attachment.isDir ? (
                <IconFolder size={14} />
              ) : (
                <IconFileText size={14} />
              )}
            </span>
            <span className="att-card__meta">
              <span className="att-card__name">
                {attachment.name}
              </span>
            </span>
          </>
        )}
      </button>
      <ContextMenu
        open={!!menu}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
        items={menuItems}
      />
    </div>
    </Tip>
  );
}
