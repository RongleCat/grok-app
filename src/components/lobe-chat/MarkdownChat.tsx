/**
 * Chat markdown — path/url → cards (image/video/file); open in resource pane.
 */

import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  isVideoPath,
  pathBasename,
  resolveInlineMediaToken,
} from "@/lib/attachments";
import {
  classifyPathRef,
  fileSubtitle,
  isAbsoluteFsPath,
  isHttpUrl,
  looksLikeFilePath,
  normalizePathToken,
  resolveFileToken,
} from "@/lib/pathRefs";
import { isExternalHttpUrl } from "@/lib/externalLinkPref";
import { useSmoothStream } from "@/hooks/useSmoothStream";
import {
  createSoftBufferState,
  stepSoftBuffer,
  type SoftBufferState,
} from "@/lib/softStreamBuffer";
import {
  shouldUsePlainStreamBody,
  STREAM_MARKDOWN_PARSE_MS,
} from "@/lib/streamRenderPolicy";
import { revealInOsLabel } from "@/lib/appPlatform";
import { cn } from "@/lib/utils";

const CodeBlock = lazy(() =>
  import("./CodeBlock").then((m) => ({ default: m.CodeBlock })),
);

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

function softCloseMarkdown(src: string, streaming: boolean): string {
  if (!streaming || !src) return src;
  let s = src;
  const fenceCount = (s.match(/^```/gm) || []).length;
  if (fenceCount % 2 === 1) s += "\n```";
  return s;
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

  const buffered = streaming ? softDisplayed : children || "";
  const longStream = shouldUsePlainStreamBody(
    (buffered || children || "").length,
    streaming,
  );
  const smoothChildren = useSmoothStream(
    buffered,
    streaming && !!buffered && !longStream,
  );
  const liveText =
    (longStream ? buffered : smoothChildren) || (streaming ? " " : "");
  const source = softCloseMarkdown(liveText, streaming);

  /**
   * Throttle ReactMarkdown input while streaming so we re-parse ~6×/s instead
   * of every smooth-stream tick. Final (non-streaming) content always syncs.
   */
  const [mdSource, setMdSource] = useState(source);
  useEffect(() => {
    if (!streaming) {
      setMdSource(source);
      return;
    }
    if (longStream) return;
    const id = window.setTimeout(() => {
      setMdSource(source);
    }, STREAM_MARKDOWN_PARSE_MS);
    return () => window.clearTimeout(id);
  }, [source, streaming, longStream]);

  const renderPathOrUrl = (token: string, linkText?: string) => {
    const rawIn = token.trim().replace(/^<|>$/g, "");
    if (!rawIn) return null;
    // Prefer ellipsis-stripped form for open/search; keep original for display map
    const raw = normalizePathToken(rawIn) || rawIn;

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
          onOpenInPanel={(t) => {
            if (t.type === "url" && t.url) {
              onOpenResource?.({ type: "url", url: t.url, title: t.title });
            }
          }}
        />
      );
    }

    const mediaAbs =
      resolveInlineMediaToken(raw, imagePathMap) ||
      resolveInlineMediaToken(rawIn, imagePathMap);
    if (mediaAbs && isImagePath(mediaAbs)) {
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
    if (mediaAbs && isVideoPath(mediaAbs)) {
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

    if (!looksLikeFilePath(rawIn) && !looksLikeFilePath(raw) && !mediaAbs) {
      return null;
    }

    // No naive projectRoot+relative join — FilePathCard uses host smart open.
    const resolved =
      mediaAbs ||
      resolveFileToken(raw, { projectPath, pathMap: imagePathMap }) ||
      resolveFileToken(rawIn, { projectPath, pathMap: imagePathMap });
    if (
      !resolved &&
      !looksLikeFilePath(raw) &&
      !looksLikeFilePath(rawIn)
    ) {
      return null;
    }

    // Prefer multi-segment relative after ellipsis strip for smart open
    const pathToken = resolved || raw || rawIn;
    const kind = classifyPathRef(pathToken);
    // Video/image by extension on any candidate — history reload often has
    // absolute paths in prose without a populated pathMap; never demote those
    // to a generic document FilePathCard.
    const videoAbs =
      (resolved && isAbsoluteFsPath(resolved) && isVideoPath(resolved) && resolved) ||
      (mediaAbs && isVideoPath(mediaAbs) && mediaAbs) ||
      (isAbsoluteFsPath(rawIn) && isVideoPath(rawIn) && rawIn.replace(/\\/g, "/")) ||
      (isAbsoluteFsPath(raw) && isVideoPath(raw) && raw) ||
      null;
    const imageAbs =
      (resolved && isAbsoluteFsPath(resolved) && isImagePath(resolved) && resolved) ||
      (mediaAbs && isImagePath(mediaAbs) && mediaAbs) ||
      (isAbsoluteFsPath(rawIn) && isImagePath(rawIn) && rawIn.replace(/\\/g, "/")) ||
      (isAbsoluteFsPath(raw) && isImagePath(raw) && raw) ||
      null;

    if (imageAbs || (kind === "image" && resolved && isImagePath(resolved))) {
      const src = imageAbs || resolved!;
      if (isAbsoluteFsPath(src) && isImagePath(src)) {
        return (
          <ImageUi
            className="md-body__img md-body__img--card"
            src={src}
            alt={linkText || pathBasename(src)}
            path={src}
            gallery={gallery}
            labels={imageLabels}
          />
        );
      }
    }
    if (videoAbs || (kind === "video" && resolved && isVideoPath(resolved))) {
      const src = videoAbs || resolved!;
      if (isVideoPath(src)) {
        // Absolute preferred; relative still shows a video card (poster / play)
        // so history never falls back to a document chip for .mp4/.webm/…
        return (
          <VideoUi
            key={src}
            src={src}
            path={isAbsoluteFsPath(src) ? src : undefined}
            title={linkText || pathBasename(src)}
            labels={videoLabels}
          />
        );
      }
    }

    return (
      <FilePathCard
        path={pathToken}
        absolutePath={
          resolved && isAbsoluteFsPath(resolved) ? resolved : undefined
        }
        projectPath={projectPath}
        kind="file"
        subtitle={fileSubtitle(pathToken, locale === "en" ? "en" : "zh")}
        labels={fileLabels}
        onOpenInPanel={(t) => {
          if (t.type === "file" && t.path) {
            onOpenResource?.({ type: "file", path: t.path, title: t.title });
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

  // Long streaming bodies: plain pre-wrap (no remark parse) until the turn
  // settles — one full markdown pass on done. Prevents O(n) parse storms.
  if (longStream) {
    return (
      <div
        className={cn(
          "chat-md",
          "chat-md--streaming",
          "chat-md--plain-stream",
          muted && "chat-md--muted",
          className,
        )}
        data-stream-mode="plain"
      >
        <pre className="chat-md__plain-stream">{liveText}</pre>
      </div>
    );
  }

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
              <Suspense
                fallback={
                  <pre className="chat-code__pre">
                    <code>{c as ReactNode}</code>
                  </pre>
                }
              >
                <CodeBlock
                  language={match?.[1] || "text"}
                  wrapLabel={tr("chat.codeWrap")}
                  unwrapLabel={tr("chat.codeUnwrap")}
                  copyLabel={tr("message.copy")}
                >
                  {c as ReactNode}
                </CodeBlock>
              </Suspense>
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
            return (
              <ImageUi
                className="md-body__img md-body__img--card"
                src={src}
                alt={typeof alt === "string" ? alt : ""}
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
