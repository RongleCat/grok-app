/**
 * Chat markdown — path/url → cards (image/video/file); open in resource pane.
 */

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import { ImageUi, imageUiLabels } from "@/components/ImageUi";
import { VideoUi, videoUiLabels } from "@/components/VideoUi";
import { FilePathCard } from "@/components/FilePathCard";
import type { ResourceOpenTarget } from "@/components/ResourceViewer";
import { HighlightedText } from "@/components/HighlightedText";
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
import { isExternalHttpUrl } from "@/lib/externalLinkPref";
import {
  createSoftBufferState,
  stepSoftBuffer,
  type SoftBufferState,
} from "@/lib/softStreamBuffer";
import { softCloseMarkdown } from "@/lib/softCloseMarkdown";
import { resolveStreamMarkdownParseMs } from "@/lib/streamRenderPolicy";
import { revealInOsLabel } from "@/lib/appPlatform";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";

/** Highlight string leaves for in-chat find (markdown-safe). */
function highlightChildren(
  children: ReactNode,
  query: string,
  activeOccurrence: number | null | undefined,
  counter: { n: number },
): ReactNode {
  const q = query.trim();
  if (!q) return children;
  if (typeof children === "string" || typeof children === "number") {
    const text = String(children);
    const base = counter.n;
    // Count matches in this leaf so subsequent leaves get correct indices.
    const lower = text.toLowerCase();
    const qLower = q.toLowerCase();
    let from = 0;
    let local = 0;
    while (from < lower.length) {
      const at = lower.indexOf(qLower, from);
      if (at < 0) break;
      local += 1;
      from = at + q.length;
    }
    const activeLocal =
      activeOccurrence != null &&
      activeOccurrence >= base &&
      activeOccurrence < base + local
        ? activeOccurrence - base
        : null;
    counter.n += local;
    if (local === 0) return text;
    return (
      <HighlightedText
        text={text}
        query={q}
        activeOccurrence={activeLocal}
      />
    );
  }
  if (Array.isArray(children)) {
    return children.map((c, i) => (
      <span key={i}>
        {highlightChildren(c, query, activeOccurrence, counter)}
      </span>
    ));
  }
  return children;
}

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

export const MarkdownChat = memo(function MarkdownChat({
  children,
  streaming = false,
  locale = "en",
  className,
  muted,
  /**
   * When false, links/paths stay as plain text / normal anchors (no FilePathCard).
   * Used for thinking blocks; assistant body keeps the default cards.
   */
  pathCards = true,
  imagePathMap,
  projectPath,
  onOpenResource,
  onOpenError,
  onOpenExternalLink,
  findQuery = "",
  findActiveOccurrence = null,
  findOccurrenceBase = 0,
}: {
  children: string;
  streaming?: boolean;
  locale?: Locale;
  className?: string;
  muted?: boolean;
  /** Default true. Thinking passes false so URLs/paths render as original text. */
  pathCards?: boolean;
  imagePathMap?: Record<string, string>;
  projectPath?: string | null;
  onOpenResource?: (target: ResourceOpenTarget) => void;
  /** Soft-fail when a file card cannot resolve / open (missing, denied). */
  onOpenError?: (message: string) => void;
  /**
   * When set, http(s) markdown links call this instead of target=_blank /
   * URL path cards. Parent may confirm then open via desktop shell.
   */
  onOpenExternalLink?: (url: string) => void;
  /** In-chat find query — highlights string leaves in markdown. */
  findQuery?: string;
  findActiveOccurrence?: number | null;
  /** Starting occurrence index for multi-segment assistant bodies. */
  findOccurrenceBase?: number;
}) {
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

  // Soft first-paint buffer (pure text) then adaptive drip reveal.
  const softStateRef = useRef<SoftBufferState>(createSoftBufferState());
  const [softDisplayed, setSoftDisplayed] = useState(children || "");
  useEffect(() => {
    if (!streaming) {
      softStateRef.current = createSoftBufferState();
      setSoftDisplayed(children || "");
      return;
    }
    const now = Date.now();
    const r = stepSoftBuffer({
      state: softStateRef.current,
      raw: children || "",
      streaming: true,
      nowMs: now,
    });
    softStateRef.current = r.state;
    setSoftDisplayed(r.displayed);
    // Poll max-wait while still holding
    if (!r.state.bypassed && (children || "").trim()) {
      const t = window.setTimeout(() => {
        const r2 = stepSoftBuffer({
          state: softStateRef.current,
          raw: children || "",
          streaming: true,
          nowMs: Date.now(),
        });
        softStateRef.current = r2.state;
        setSoftDisplayed(r2.displayed);
      }, 100);
      return () => window.clearTimeout(t);
    }
  }, [children, streaming]);

  // Soft buffer only — no character-drip rAF (was a major Intel Retina cost).
  // Store-level content notify throttle + markdown parse throttle pace paints.
  const buffered = streaming ? softDisplayed : children || "";
  const liveText = buffered || (streaming ? " " : "");
  const source = softCloseMarkdown(liveText, streaming);
  const parseMs = resolveStreamMarkdownParseMs(source.length, streaming);

  /**
   * Throttle ReactMarkdown input while streaming so we re-parse ~4–8×/s instead
   * of every soft-buffer tick. Longer bodies use a slower cadence; final
   * (non-streaming) content always syncs immediately. Always keep markdown
   * rendering (no plain-pre bare-syntax fallback).
   */
  const [mdSource, setMdSource] = useState(source);
  useEffect(() => {
    if (!streaming || parseMs <= 0) {
      setMdSource(source);
      return;
    }
    const id = window.setTimeout(() => {
      setMdSource(source);
    }, parseMs);
    return () => window.clearTimeout(id);
  }, [source, streaming, parseMs]);

  const renderPathOrUrl = (token: string, linkText?: string) => {
    const rawIn = token.trim().replace(/^<|>$/g, "");
    if (!rawIn) return null;
    // Strip path:line[:col] before path resolution (soft-fail keeps original).
    const citeIn = parsePathLineCitation(rawIn);
    const citeNorm = parsePathLineCitation(normalizePathToken(rawIn) || rawIn);
    const line = citeNorm.line ?? citeIn.line;
    const column = citeNorm.column ?? citeIn.column;
    // Prefer ellipsis-stripped + shell-unescaped form for open/search.
    const raw =
      normalizePathToken(citeNorm.path || citeIn.path || rawIn) || rawIn;
    const pathForLooks = citeNorm.path || citeIn.path || raw;

    // Thinking: keep URL/path as original text (no FilePathCard). Media still
    // handled below when pathCards is on; when off, skip cards entirely.
    if (!pathCards) {
      return null;
    }

    if (isHttpUrl(rawIn) || isHttpUrl(raw)) {
      const url = isHttpUrl(rawIn) ? rawIn : raw;
      return (
        <FilePathCard
          path={url}
          kind="url"
          projectPath={projectPath}
          labels={fileLabels}
          onOpenError={onOpenError}
          onOpenInPanel={(t) => {
            if (t.type === "url" && t.url) {
              onOpenResource?.({ type: "url", url: t.url, title: t.title });
            }
          }}
        />
      );
    }

    // CMS site-root paths stay plain code — never fake ImageUi.
    if (isSiteRootAbsolutePath(rawIn) || isSiteRootAbsolutePath(raw)) {
      return null;
    }

    const mediaAbs =
      resolveInlineMediaToken(raw, imagePathMap) ||
      resolveInlineMediaToken(pathForLooks, imagePathMap) ||
      resolveInlineMediaToken(rawIn, imagePathMap);
    // Real multi-segment local abs only (pathMap verified in resolveInlineMediaToken).
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
      !looksLikeFilePath(rawIn) &&
      !looksLikeFilePath(raw) &&
      !looksLikeFilePath(pathForLooks) &&
      !mediaAbs
    ) {
      return null;
    }

    // No naive projectRoot+relative join — FilePathCard uses host smart open.
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

    // Prefer multi-segment relative after ellipsis strip for smart open.
    // Display token: keep short relative when we only have that; abs is for open.
    const pathToken = resolved || raw || pathForLooks || rawIn;
    // Video/image only when we have a real multi-segment local absolute.
    // Never promote site-root, single-segment tails, or unresolved relative media.
    const asLocalMedia = (p: string | null | undefined, kind: "image" | "video") => {
      if (!p || !isRealLocalAbsolutePath(p) || !isPlausibleLocalMediaAbs(p)) {
        return null;
      }
      if (kind === "video" ? isVideoPath(p) : isImagePath(p)) return p;
      return null;
    };
    const videoAbs =
      asLocalMedia(resolved, "video") ||
      asLocalMedia(mediaAbs, "video") ||
      asLocalMedia(raw, "video") ||
      asLocalMedia(
        isRealLocalAbsolutePath(rawIn) ? normalizePathToken(rawIn) : null,
        "video",
      ) ||
      null;
    const imageAbs =
      asLocalMedia(resolved, "image") ||
      asLocalMedia(mediaAbs, "image") ||
      asLocalMedia(raw, "image") ||
      asLocalMedia(
        isRealLocalAbsolutePath(rawIn) ? normalizePathToken(rawIn) : null,
        "image",
      ) ||
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
    // Unresolved bare media / site roots: leave as plain code (no dead FilePathCard).
    const tokenForCard = pathToken;
    if (
      isSiteRootAbsolutePath(tokenForCard) ||
      (isMediaPath(tokenForCard) &&
        !isRealLocalAbsolutePath(tokenForCard) &&
        !tokenForCard.includes("/"))
    ) {
      return null;
    }
    // FilePathCard only mounts interactive chrome after Host confirms a real
    // path; unresolved / missing tokens render as plain inline code.

    return (
      <FilePathCard
        path={tokenForCard}
        absolutePath={
          resolved && isRealLocalAbsolutePath(resolved) ? resolved : undefined
        }
        projectPath={projectPath}
        kind="file"
        line={line}
        column={column}
        subtitle={fileSubtitle(tokenForCard, locale === "en" ? "en" : "zh")}
        labels={fileLabels}
        onOpenError={onOpenError}
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

  // Fresh counter each render so occurrence indices stay stable for the mark.
  const findCounter = { n: findOccurrenceBase };
  const qFind = findQuery.trim();
  const paint = (node: ReactNode) =>
    qFind
      ? highlightChildren(node, qFind, findActiveOccurrence, findCounter)
      : node;

  return (
    <div
      className={cn(
        "chat-md",
        muted && "chat-md--muted",
        streaming && "chat-md--streaming",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children: c }) => <p>{paint(c)}</p>,
          li: ({ children: c }) => <li>{paint(c)}</li>,
          strong: ({ children: c }) => <strong>{paint(c)}</strong>,
          em: ({ children: c }) => <em>{paint(c)}</em>,
          h1: ({ children: c }) => <h1>{paint(c)}</h1>,
          h2: ({ children: c }) => <h2>{paint(c)}</h2>,
          h3: ({ children: c }) => <h3>{paint(c)}</h3>,
          h4: ({ children: c }) => <h4>{paint(c)}</h4>,
          blockquote: ({ children: c }) => (
            <blockquote>{paint(c)}</blockquote>
          ),
          td: ({ children: c }) => <td>{paint(c)}</td>,
          th: ({ children: c }) => <th>{paint(c)}</th>,
          a: ({ href, children: c }) => {
            const text = textFromChildren(c).trim();
            const hrefStr = typeof href === "string" ? href : "";
            // Prefer app-controlled external open (Tauri shell + optional confirm)
            // over path cards / target=_blank for absolute http(s) links.
            if (onOpenExternalLink && isExternalHttpUrl(hrefStr)) {
              return (
                <a
                  className="chat-md__link"
                  href={hrefStr}
                  rel="noreferrer noopener"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenExternalLink(hrefStr);
                  }}
                >
                  {paint(c)}
                </a>
              );
            }
            const card =
              (hrefStr && renderPathOrUrl(hrefStr, text)) ||
              (text && text !== hrefStr ? renderPathOrUrl(text) : null);
            if (card) return card;
            return (
              <a
                className="chat-md__link"
                href={href}
                target="_blank"
                rel="noreferrer noopener"
              >
                {paint(c)}
              </a>
            );
          },
          pre: ({ children: c }) => <>{c}</>,
          code: ({ className: cnCode, children: c }) => {
            const match =
              typeof cnCode === "string"
                ? /language-([\w#+-]+)/.exec(cnCode)
                : null;
            const block = Boolean(match) || String(c).includes("\n");
            if (!block) {
              const raw = textFromChildren(c).replace(/\n$/, "").trim();
              const card = renderPathOrUrl(raw);
              if (card) return card;
              return (
                <code className="chat-md__inline-code">{paint(c)}</code>
              );
            }
            return (
              <CodeBlock
                language={match?.[1] || "text"}
                wrapLabel={tr("chat.codeWrap")}
                unwrapLabel={tr("chat.codeUnwrap")}
                copyLabel={tr("message.copy")}
              >
                {c as ReactNode}
              </CodeBlock>
            );
          },
          table: ({ children: c }) => (
            <div className="chat-md__table-wrap">
              <table>{c}</table>
            </div>
          ),
          hr: () => null,
          img: ({ src, alt }) => {
            if (!src || typeof src !== "string") return null;
            const card = renderPathOrUrl(
              src,
              typeof alt === "string" ? alt : undefined,
            );
            if (card) return card;
            // Unresolved relative / site-root: never mount a dead ImageUi
            // (that painted the alt as an empty 150px card and never recovered).
            const viewable =
              isHttpUrl(src) ||
              src.startsWith("data:") ||
              (isRealLocalAbsolutePath(src) && isPlausibleLocalMediaAbs(src));
            if (!viewable) return null;
            return (
              <ImageUi
                className="md-body__img md-body__img--card"
                src={src}
                alt={typeof alt === "string" ? alt : ""}
                path={
                  isRealLocalAbsolutePath(src) && isPlausibleLocalMediaAbs(src)
                    ? src
                    : undefined
                }
                labels={imageLabels}
              />
            );
          },
        }}
      >
        {mdSource}
      </ReactMarkdown>
    </div>
  );
});
