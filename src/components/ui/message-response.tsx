/**
 * Streaming markdown body — Streamdown (AI Elements MessageResponse).
 * Media paths → image/video cards; other file paths & URLs → FilePathCard
 * (open in right resource pane).
 */

import { memo, useMemo, type ReactNode } from "react";
import { Streamdown } from "streamdown";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import { ImageUi, imageUiLabels } from "@/components/ImageUi";
import { VideoUi, videoUiLabels } from "@/components/VideoUi";
import { FilePathCard } from "@/components/FilePathCard";
import {
  isImagePath,
  isMediaPath,
  isPlausibleLocalMediaAbs,
  isVideoPath,
  pathBasename,
  resolveInlineMediaToken,
} from "@/lib/attachments";
import {
  fileSubtitle,
  isHttpUrl,
  isRealLocalAbsolutePath,
  isSiteRootAbsolutePath,
  looksLikeFilePath,
  normalizePathToken,
  resolveFileToken,
} from "@/lib/pathRefs";
import { parsePathLineCitation } from "@/lib/pathLineCitation";
import type { ResourceOpenTarget } from "@/components/ResourceViewer";
import { useSmoothStream } from "@/hooks/useSmoothStream";
import { revealInOsLabel } from "@/lib/appPlatform";
import { cn } from "@/lib/utils";

export type MessageResponseProps = {
  children: string;
  isAnimating?: boolean;
  className?: string;
  locale?: Locale;
  /** Media token → absolute path (images/videos attachments). */
  imagePathMap?: Record<string, string>;
  projectPath?: string | null;
  onOpenResource?: (target: ResourceOpenTarget) => void;
};

function textFromChildren(children: ReactNode): string {
  if (children == null || children === false) return "";
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(textFromChildren).join("");
  }
  return "";
}

function MessageResponseImpl({
  children,
  isAnimating = false,
  className,
  locale = "en",
  imagePathMap,
  projectPath,
  onOpenResource,
}: MessageResponseProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const imageLabels = useMemo(() => imageUiLabels(locale), [locale]);
  const videoLabels = useMemo(() => videoUiLabels(locale), [locale]);
  const fileLabels = useMemo(
    () => ({
      open: tr("attach.open"),
      reveal: revealInOsLabel(tr),
      copyPath: tr("attach.copyPath"),
      openInPanel: tr("resources.openInPanel"),
      openExternal: tr("resources.openExternal"),
      details: tr("attach.details"),
      detailsTitle: tr("attach.detailsTitle"),
      detailsName: tr("attach.detailsName"),
      detailsType: tr("attach.detailsType"),
      detailsPath: tr("attach.detailsPath"),
      detailsResolved: tr("attach.detailsResolved"),
      detailsStatus: tr("attach.detailsStatus"),
      detailsMissing: tr("attach.detailsMissing"),
      detailsOk: tr("attach.detailsOk"),
      detailsClose: tr("attach.detailsClose"),
      typeFile: tr("attach.typeFile"),
      typeUrl: tr("attach.typeUrl"),
      typeDir: tr("attach.typeDir"),
      errNotFound: tr("resources.openErr.notFound"),
      errPathDenied: tr("resources.openErr.pathDenied"),
      errHostOnly: tr("resources.openErr.hostOnly"),
      errNoEditor: tr("resources.openErr.noEditor"),
      errCancelled: tr("resources.openErr.cancelled"),
      errOther: tr("resources.openErr.other"),
      errRevealOther: tr("resources.revealErr.other"),
    }),
    [tr],
  );
  const gallery = useMemo(() => {
    if (!imagePathMap) return undefined;
    return Array.from(new Set(Object.values(imagePathMap))).filter(isImagePath);
  }, [imagePathMap]);

  // Adaptive buffer: drip when chunks are sparse, catch up when model dumps.
  const smoothChildren = useSmoothStream(children, isAnimating);

  const renderPathOrUrl = (token: string, linkText?: string) => {
    const rawIn = token.trim().replace(/^<|>$/g, "");
    if (!rawIn) return null;
    // Strip path:line[:col] before path resolution (soft-fail keeps original).
    const citeIn = parsePathLineCitation(rawIn);
    const citeNorm = parsePathLineCitation(normalizePathToken(rawIn) || rawIn);
    const line = citeNorm.line ?? citeIn.line;
    const column = citeNorm.column ?? citeIn.column;
    const raw = normalizePathToken(citeNorm.path || citeIn.path || rawIn) || rawIn;
    const pathForLooks = citeNorm.path || citeIn.path || raw;

    if (isHttpUrl(rawIn) || isHttpUrl(raw)) {
      const url = isHttpUrl(rawIn) ? rawIn : raw;
      return (
        <FilePathCard
          path={url}
          kind="url"
          projectPath={projectPath}
          labels={fileLabels}
          onOpenInPanel={(t) => {
            if (t.type === "url" && t.url) {
              onOpenResource?.({ type: "url", url: t.url, title: t.title });
            }
          }}
        />
      );
    }

    if (isSiteRootAbsolutePath(rawIn) || isSiteRootAbsolutePath(raw)) {
      return null;
    }

    // Prefer media map (images/videos session paths) — multi-segment local only.
    const mediaAbs =
      resolveInlineMediaToken(raw, imagePathMap) ||
      resolveInlineMediaToken(pathForLooks, imagePathMap) ||
      resolveInlineMediaToken(rawIn, imagePathMap);
    if (
      mediaAbs &&
      isImagePath(mediaAbs) &&
      isRealLocalAbsolutePath(mediaAbs) &&
      isPlausibleLocalMediaAbs(mediaAbs)
    ) {
      return (
        <ImageUi
          className="md-body__img md-body__img--card"
          src={mediaAbs}
          alt={linkText || pathBasename(mediaAbs)}
          path={mediaAbs}
          gallery={gallery}
          labels={imageLabels}
        />
      );
    }
    if (
      mediaAbs &&
      isVideoPath(mediaAbs) &&
      isRealLocalAbsolutePath(mediaAbs) &&
      isPlausibleLocalMediaAbs(mediaAbs)
    ) {
      return (
        <VideoUi
          key={mediaAbs}
          src={mediaAbs}
          path={mediaAbs}
          title={linkText || pathBasename(mediaAbs)}
          labels={videoLabels}
        />
      );
    }

    if (
      !looksLikeFilePath(raw) &&
      !looksLikeFilePath(pathForLooks) &&
      !looksLikeFilePath(rawIn) &&
      !mediaAbs
    ) {
      return null;
    }

    // Verified absolute only (pathMap / absolute in text). Relative stays relative —
    // FilePathCard resolves via host smart open (no fake projectRoot joins).
    const resolved =
      mediaAbs ||
      resolveFileToken(raw, { projectPath, pathMap: imagePathMap }) ||
      resolveFileToken(pathForLooks, { projectPath, pathMap: imagePathMap }) ||
      resolveFileToken(rawIn, { projectPath, pathMap: imagePathMap });
    if (
      !resolved &&
      !looksLikeFilePath(raw) &&
      !looksLikeFilePath(pathForLooks) &&
      !looksLikeFilePath(rawIn)
    ) {
      return null;
    }

    const pathToken = resolved || raw || pathForLooks || rawIn;
    const asLocalMedia = (p: string | null | undefined, kind: "image" | "video") => {
      if (!p || !isRealLocalAbsolutePath(p) || !isPlausibleLocalMediaAbs(p)) {
        return null;
      }
      if (kind === "video" ? isVideoPath(p) : isImagePath(p)) return p;
      return null;
    };
    const imageAbs =
      asLocalMedia(resolved, "image") ||
      asLocalMedia(mediaAbs, "image") ||
      asLocalMedia(raw, "image") ||
      null;
    const videoAbs =
      asLocalMedia(resolved, "video") ||
      asLocalMedia(mediaAbs, "video") ||
      asLocalMedia(raw, "video") ||
      null;

    if (imageAbs && isImagePath(imageAbs)) {
      return (
        <ImageUi
          className="md-body__img md-body__img--card"
          src={imageAbs}
          alt={linkText || pathBasename(imageAbs)}
          path={imageAbs}
          gallery={gallery}
          labels={imageLabels}
        />
      );
    }
    if (videoAbs && isVideoPath(videoAbs)) {
      return (
        <VideoUi
          key={videoAbs}
          src={videoAbs}
          path={videoAbs}
          title={linkText || pathBasename(videoAbs)}
          labels={videoLabels}
        />
      );
    }

    if (
      isSiteRootAbsolutePath(pathToken) ||
      (isMediaPath(pathToken) &&
        !isRealLocalAbsolutePath(pathToken) &&
        !pathToken.includes("/"))
    ) {
      return null;
    }

    return (
      <FilePathCard
        path={pathToken}
        absolutePath={
          resolved && isRealLocalAbsolutePath(resolved) ? resolved : undefined
        }
        projectPath={projectPath}
        kind="file"
        line={line}
        column={column}
        subtitle={fileSubtitle(pathToken, locale)}
        labels={fileLabels}
        onOpenInPanel={(t) => {
          if (t.type === "file" && t.path) {
            onOpenResource?.({
              type: "file",
              path: t.path,
              title: t.title,
              line: t.line ?? line,
              column: t.column ?? column,
            });
          }
        }}
      />
    );
  };

  return (
    <Streamdown
      className={cn(
        "sd-body size-full min-w-0",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      parseIncompleteMarkdown={isAnimating}
      isAnimating={isAnimating}
      components={{
        a: ({ href, children: c }) => {
          const text = textFromChildren(c).trim();
          const hrefStr = typeof href === "string" ? href : "";
          // Try href first, then link text
          const card =
            (hrefStr && renderPathOrUrl(hrefStr, text)) ||
            (text && text !== hrefStr ? renderPathOrUrl(text) : null);
          if (card) return card;
          return (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {c}
            </a>
          );
        },
        code: ({ className: codeClass, children: c }) => {
          const inline = !codeClass;
          const raw = textFromChildren(c).replace(/\n$/, "").trim();
          if (inline && raw) {
            const card = renderPathOrUrl(raw);
            if (card) return card;
            return <code className="md-body__code-inline">{c}</code>;
          }
          return <code className={codeClass}>{c}</code>;
        },
        img: ({ src, alt }) => {
          if (!src || typeof src !== "string") return null;
          const card = renderPathOrUrl(src, typeof alt === "string" ? alt : undefined);
          if (card) return card;
          const mapped = resolveInlineMediaToken(src, imagePathMap) ?? src;
          const local =
            mapped.startsWith("/") || /^[A-Za-z]:[\\/]/.test(mapped)
              ? mapped
              : undefined;
          return (
            <ImageUi
              className="md-body__img md-body__img--card"
              src={mapped}
              alt={typeof alt === "string" ? alt : ""}
              path={local}
              gallery={gallery}
              labels={imageLabels}
            />
          );
        },
      }}
    >
      {smoothChildren || (isAnimating ? " " : "")}
    </Streamdown>
  );
}

export const MessageResponse = memo(
  MessageResponseImpl,
  (prev, next) =>
    prev.children === next.children &&
    prev.isAnimating === next.isAnimating &&
    prev.locale === next.locale &&
    prev.className === next.className &&
    prev.imagePathMap === next.imagePathMap &&
    prev.projectPath === next.projectPath &&
    prev.onOpenResource === next.onOpenResource,
);

MessageResponse.displayName = "MessageResponse";
