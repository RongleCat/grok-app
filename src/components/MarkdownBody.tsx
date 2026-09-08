/**
 * Assistant / file-preview markdown — GFM with safe defaults.
 * Images open the global lightbox; videos play inline; right-click menus.
 * Path links/code become media cards when imagePathMap is set.
 * http(s) links open the OS default browser (Tauri `target=_blank` is a no-op).
 */

import { useMemo, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { createT, type Locale } from "@/i18n";
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
} from "@/lib/markdownMath";
import { ImageUi, imageUiLabels } from "@/components/ImageUi";
import { VideoUi, videoUiLabels } from "@/components/VideoUi";
import { MermaidBlock } from "@/components/lobe-chat/MermaidBlock";
import { isMermaidLanguage } from "@/lib/mermaidRender";
import {
  isImagePath,
  isPlausibleLocalMediaAbs,
  isVideoPath,
  pathBasename,
  resolveInlineMediaToken,
  resolveMediaHref,
} from "@/lib/attachments";
import {
  isExternalHttpUrl,
  openExternalHttpUrl,
} from "@/lib/externalLinkPref";
import {
  isRealLocalAbsolutePath,
  isSiteRootAbsolutePath,
  normalizeLocalPathToken,
} from "@/lib/pathNormalize";

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

export function MarkdownBody({
  children,
  streaming,
  locale = "en",
  imagePathMap,
  onOpenExternalLink,
}: {
  children: string;
  streaming?: boolean;
  locale?: Locale;
  imagePathMap?: Record<string, string>;
  /**
   * When set, http(s) links call this instead of the default OS-browser open.
   * Preview / plan surfaces omit it so Host `open_external_url` runs.
   */
  onOpenExternalLink?: (url: string) => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const imageLabels = useMemo(() => imageUiLabels(locale), [locale]);
  const videoLabels = useMemo(() => videoUiLabels(locale), [locale]);
  const gallery = useMemo(() => {
    if (!imagePathMap) return undefined;
    return Array.from(new Set(Object.values(imagePathMap))).filter(isImagePath);
  }, [imagePathMap]);

  const renderMedia = (abs: string, alt?: string) => {
    // Real multi-segment local abs only — never site-root or `/file.mp4` tails.
    if (!isRealLocalAbsolutePath(abs) || !isPlausibleLocalMediaAbs(abs)) {
      return null;
    }
    if (isVideoPath(abs)) {
      return (
        <VideoUi
          key={abs}
          src={abs}
          path={abs}
          title={alt || pathBasename(abs)}
          labels={videoLabels}
        />
      );
    }
    return (
      <ImageUi
        className="md-body__img md-body__img--card"
        src={abs}
        alt={alt || pathBasename(abs)}
        path={abs}
        gallery={gallery}
        labels={imageLabels}
      />
    );
  };

  return (
    <div
      className={
        "md-body" + (streaming ? " md-body--streaming" : "")
      }
    >
      <ReactMarkdown
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
        components={{
          a: ({ href, children: c }) => {
            const text = textFromChildren(c).trim();
            const abs = resolveMediaHref(href, text, imagePathMap);
            if (abs) return renderMedia(abs, text || pathBasename(abs));
            const hrefStr = typeof href === "string" ? href : "";
            if (isExternalHttpUrl(hrefStr)) {
              const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
                e.preventDefault();
                if (onOpenExternalLink) {
                  onOpenExternalLink(hrefStr);
                  return;
                }
                openExternalHttpUrl(hrefStr);
              };
              return (
                <a
                  className="md-body__link"
                  href={hrefStr}
                  rel="noreferrer noopener"
                  onClick={onClick}
                >
                  {c}
                </a>
              );
            }
            return (
              <a href={href} rel="noreferrer noopener">
                {c}
              </a>
            );
          },
          pre: ({ children: c }) => <pre className="md-body__pre">{c}</pre>,
          code: ({ className, children: c }) => {
            const inline = !className;
            if (inline) {
              const raw = textFromChildren(c).replace(/\n$/, "").trim();
              if (isSiteRootAbsolutePath(raw)) {
                return <code className="md-body__code-inline">{c}</code>;
              }
              const abs = resolveInlineMediaToken(raw, imagePathMap);
              if (abs) {
                const media = renderMedia(abs, pathBasename(abs));
                if (media) return media;
              }
              return <code className="md-body__code-inline">{c}</code>;
            }
            const match =
              typeof className === "string"
                ? /language-([\w#+-]+)/.exec(className)
                : null;
            if (isMermaidLanguage(match?.[1])) {
              return (
                <MermaidBlock
                  streaming={Boolean(streaming)}
                  copyLabel={tr("message.copy")}
                  sourceLabel={tr("chat.mermaidSource")}
                  diagramLabel={tr("chat.mermaidDiagram")}
                  loadingLabel={tr("chat.mermaidLoading")}
                  errorLabel={tr("chat.mermaidError")}
                >
                  {c}
                </MermaidBlock>
              );
            }
            return <code className={className}>{c}</code>;
          },
          img: ({ src, alt }) => {
            if (!src) return null;
            if (isSiteRootAbsolutePath(src)) return null;
            const mapped =
              resolveInlineMediaToken(src, imagePathMap) ??
              normalizeLocalPathToken(src) ??
              src;
            if (isSiteRootAbsolutePath(mapped)) return null;
            if (
              isVideoPath(mapped) &&
              isRealLocalAbsolutePath(mapped) &&
              isPlausibleLocalMediaAbs(mapped)
            ) {
              return renderMedia(
                mapped,
                typeof alt === "string" ? alt : pathBasename(mapped),
              );
            }
            // Remote http(s) images still render; local only when real multi-seg abs.
            const local =
              isRealLocalAbsolutePath(mapped) &&
              (!isImagePath(mapped) || isPlausibleLocalMediaAbs(mapped))
                ? mapped
                : undefined;
            if (!local && !/^https?:\/\//i.test(mapped) && !mapped.startsWith("data:")) {
              return null;
            }
            return (
              <ImageUi
                className="md-body__img md-body__img--card"
                src={mapped}
                alt={alt ?? ""}
                path={local}
                gallery={gallery}
                labels={imageLabels}
              />
            );
          },
          table: ({ children: c }) => (
            <div className="md-body__table-wrap">
              <table>{c}</table>
            </div>
          ),
        }}
      >
        {children || (streaming ? " " : "")}
      </ReactMarkdown>
    </div>
  );
}
