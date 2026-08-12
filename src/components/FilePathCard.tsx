/**
 * Compact file / URL card for chat paths.
 *
 * Policy: only render the interactive card chrome when the Host can resolve a
 * real on-disk path (or the token is a URL). Unresolved / missing paths stay
 * as plain inline code so dead cards never appear in the transcript.
 *
 * Card: basename only. Path lives in details modal + right-click copy.
 * Click → open in right resource pane.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import * as api from "@/lib/api";
import { pathBasename, pathExt } from "@/lib/attachments";
import {
  isHomeRelativePath,
  isHttpUrl,
  isRealLocalAbsolutePath,
  normalizePathToken,
} from "@/lib/pathRefs";
import {
  isSiteRootAbsolutePath,
  normalizeLocalPathToken,
} from "@/lib/pathNormalize";
import {
  resolveOpenEditorError,
  resolveRevealError,
} from "@/lib/openEditorHonesty";
import {
  getCachedFileResolve,
  setCachedFileResolve,
} from "@/lib/filePathResolveCache";
import {
  IconClose,
  IconCopy,
  IconExternalLink,
  IconFileText,
  IconFolder,
  IconInfo,
} from "@/components/icons";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";

export type FilePathCardKind = "file" | "url" | "dir";

export interface FilePathCardLabels {
  open: string;
  reveal: string;
  copyPath: string;
  openInPanel?: string;
  openExternal?: string;
  details?: string;
  detailsTitle?: string;
  detailsName?: string;
  detailsType?: string;
  detailsPath?: string;
  detailsResolved?: string;
  detailsStatus?: string;
  detailsMissing?: string;
  detailsOk?: string;
  detailsClose?: string;
  typeFile?: string;
  typeUrl?: string;
  typeDir?: string;
  /** Soft-fail copy for open/reveal (classified honesty). */
  errNotFound?: string;
  errPathDenied?: string;
  errHostOnly?: string;
  errNoEditor?: string;
  errCancelled?: string;
  errOther?: string;
  errRevealOther?: string;
}

export interface FilePathCardProps {
  /** Absolute path, relative display path, or URL. */
  path: string;
  /**
   * Optional absolute path hint. Only used as a search token if it is absolute;
   * host still verifies existence (fake monorepo joins are discarded).
   */
  absolutePath?: string;
  kind?: FilePathCardKind;
  /** Project root for monorepo suffix search. */
  projectPath?: string | null;
  subtitle?: string;
  /**
   * 1-based line from a `path:line` citation.
   * Used for side preview scroll + open_in_editor `-g`. Soft-fail if invalid.
   */
  line?: number | null;
  /** Optional 1-based column (open_in_editor when supported). */
  column?: number | null;
  labels: FilePathCardLabels;
  onOpenInPanel?: (target: {
    type: "file" | "url";
    path?: string;
    url?: string;
    title?: string;
    line?: number | null;
    column?: number | null;
  }) => void;
  /** Optional toast / banner when open-external or reveal soft-fails. */
  onOpenError?: (message: string) => void;
}

function kindLabel(path: string, kind: FilePathCardKind): string {
  if (kind === "url") return "URL";
  if (kind === "dir") return "DIR";
  const ext = pathExt(path).toUpperCase() || "FILE";
  return ext;
}

function relativeToken(path: string): string | null {
  // Strip agent ellipsis (`.../a/b.jpg` → `a/b.jpg`) before open/search
  const t = normalizePathToken(path);
  if (!t || isHttpUrl(t) || isRealLocalAbsolutePath(t)) return null;
  if (isSiteRootAbsolutePath(t)) return null;
  if (!(t.includes("/") || t.includes("\\"))) return null;
  return t;
}

function filePathCardErrLabel(
  labels: FilePathCardLabels,
  kind:
    | "no_editor"
    | "not_found"
    | "path_denied"
    | "host_only"
    | "cancelled"
    | "other",
  forReveal = false,
): string {
  switch (kind) {
    case "no_editor":
      return labels.errNoEditor || "No code editor available";
    case "not_found":
      return labels.errNotFound || "File not found";
    case "path_denied":
      return labels.errPathDenied || "Path denied";
    case "host_only":
      return labels.errHostOnly || "Desktop app required";
    case "cancelled":
      return labels.errCancelled || "";
    case "other":
    default:
      return forReveal
        ? labels.errRevealOther || labels.errOther || "Could not reveal"
        : labels.errOther || "Could not open";
  }
}

export function FilePathCard({
  path,
  absolutePath,
  kind = "file",
  projectPath,
  subtitle: _subtitle,
  line = null,
  column = null,
  labels,
  onOpenInPanel,
  onOpenError,
}: FilePathCardProps) {
  void _subtitle; // callers may pass; card no longer shows path/subtitle
  const focusLine =
    line != null && Number.isInteger(line) && line >= 1 ? line : null;
  const focusColumn =
    column != null && Number.isInteger(column) && column >= 1 ? column : null;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isUrl = kind === "url" || isHttpUrl(path);
  /**
   * Seed from session resolve cache so virtual-list remounts do not flash
   * plain code → card (layout thrash while scrolling).
   */
  const seedResolve = (): {
    abs: string | null;
    missing: boolean;
    skipProbe: boolean;
  } => {
    if (isUrl) return { abs: null, missing: false, skipProbe: true };
    if (absolutePath && isRealLocalAbsolutePath(absolutePath)) {
      const cached = getCachedFileResolve(absolutePath, projectPath);
      if (cached === null) return { abs: null, missing: true, skipProbe: true };
      if (typeof cached === "string") {
        return { abs: cached, missing: false, skipProbe: true };
      }
      // Optimistic abs hint — still verify once, but paint card-sized chrome.
      return { abs: absolutePath, missing: false, skipProbe: false };
    }
    const cached = getCachedFileResolve(path, projectPath);
    if (cached === null) return { abs: null, missing: true, skipProbe: true };
    if (typeof cached === "string") {
      return { abs: cached, missing: false, skipProbe: true };
    }
    return { abs: null, missing: false, skipProbe: false };
  };
  const seed = seedResolve();
  /** Only set after host confirms a real on-disk path (or cache hit). */
  const [resolvedAbs, setResolvedAbs] = useState<string | null>(seed.abs);
  /** True after resolve finished with no openable file (render plain code). */
  const [missing, setMissing] = useState(seed.missing);
  const [busy, setBusy] = useState(false);
  /** Card title only: basename, or host for URLs — never the full path. */
  const name = (() => {
    if (!isUrl) return pathBasename(resolvedAbs || path);
    try {
      const u = new URL(path);
      return u.hostname || path;
    } catch {
      return path;
    }
  })();

  /**
   * Resolve a real on-disk absolute path (metadata only — never full file read).
   * Prefer absolute tokens first; relative uses host smart resolve without body.
   */
  const resolveAbsolute = useCallback(async (): Promise<string | null> => {
    if (isUrl) return null;
    if (resolvedAbs) return resolvedAbs;

    // CMS/site roots are never local files — do not probe the host.
    if (isSiteRootAbsolutePath(path) || isSiteRootAbsolutePath(absolutePath || "")) {
      setMissing(true);
      return null;
    }

    const pathNorm = normalizeLocalPathToken(path) || path.trim();
    const absHint =
      absolutePath && isRealLocalAbsolutePath(absolutePath)
        ? normalizeLocalPathToken(absolutePath) || absolutePath
        : null;

    if (!api.isTauri()) {
      // Browser preview: only absolute-looking tokens; no host smart open.
      if (absHint) {
        setCachedFileResolve(path, projectPath, absHint);
        setResolvedAbs(absHint);
        setMissing(false);
        return absHint;
      }
      if (isRealLocalAbsolutePath(pathNorm) || isHomeRelativePath(pathNorm)) {
        setCachedFileResolve(path, projectPath, pathNorm);
        setResolvedAbs(pathNorm);
        setMissing(false);
        return pathNorm;
      }
      setCachedFileResolve(path, projectPath, null);
      setMissing(true);
      return null;
    }

    // Bare basenames without an abs hint almost never uniquely resolve and
    // force a full monorepo walk — leave as plain code (pathMap should have
    // upgraded them already when a real file was tool-touched).
    const multiSeg =
      pathNorm.includes("/") ||
      pathNorm.includes("\\") ||
      isHomeRelativePath(pathNorm) ||
      isRealLocalAbsolutePath(pathNorm);
    if (!absHint && !multiSeg) {
      setCachedFileResolve(path, projectPath, null);
      setMissing(true);
      return null;
    }

    // Prefer absolute paths first (most reliable), then relative tokens.
    // Relative like `知识库/wiki/...` is resolved by host against project
    // and project parent (sibling folders such as a shared knowledge base).
    const tokens: string[] = [];
    if (absHint) tokens.push(absHint);
    if (isRealLocalAbsolutePath(pathNorm) || isHomeRelativePath(pathNorm)) {
      tokens.push(pathNorm);
    }
    const rel = relativeToken(path);
    if (rel) tokens.push(rel);
    // Multi-segment relative only — bare basenames are last-resort and often
    // OSS names (manycore.png) that do not exist as project files.
    if (
      pathNorm &&
      !tokens.includes(pathNorm) &&
      (pathNorm.includes("/") || pathNorm.includes("\\")) &&
      !isSiteRootAbsolutePath(pathNorm)
    ) {
      tokens.push(pathNorm);
    }
    // Bare basename only as companion of multi-segment (not alone).
    if (multiSeg) {
      const bare = pathBasename(pathNorm);
      if (bare && !tokens.includes(bare) && bare !== pathNorm) {
        tokens.push(bare);
      }
    }

    const seen = new Set<string>();
    for (const token of tokens) {
      if (!token || seen.has(token)) continue;
      if (isSiteRootAbsolutePath(token)) continue;
      seen.add(token);

      // Absolute: cheap classify (stat only) before smart resolve.
      if (isRealLocalAbsolutePath(token)) {
        try {
          const list = await api.pathsClassify([token]);
          const e = list?.[0];
          if (e?.exists && !e.isDir && e.path) {
            setCachedFileResolve(path, projectPath, e.path);
            setResolvedAbs(e.path);
            setMissing(false);
            return e.path;
          }
        } catch {
          /* fall through to smart resolve */
        }
      }

      // Metadata-only smart resolve — never fsOpenPath (full body) for cards.
      try {
        const r = await api.fsResolvePath(token, projectPath ?? null);
        if (r.absolutePath && !r.isDir) {
          setCachedFileResolve(path, projectPath, r.absolutePath);
          setResolvedAbs(r.absolutePath);
          setMissing(false);
          return r.absolutePath;
        }
      } catch {
        /* try next token */
      }
    }
    setCachedFileResolve(path, projectPath, null);
    setMissing(true);
    return null;
  }, [absolutePath, isUrl, path, projectPath, resolvedAbs]);

  // Verify once per token; cache makes scroll remounts instant (no plain→card).
  useEffect(() => {
    if (isUrl) return;
    if (missing) return;
    // Cache hit (incl. known-missing) — do not re-probe on every remount.
    const cached = getCachedFileResolve(
      absolutePath && isRealLocalAbsolutePath(absolutePath)
        ? absolutePath
        : path,
      projectPath,
    );
    if (cached === null) {
      setMissing(true);
      setResolvedAbs(null);
      return;
    }
    if (typeof cached === "string") {
      setResolvedAbs(cached);
      setMissing(false);
      return;
    }
    if (resolvedAbs) return;
    let cancelled = false;
    void resolveAbsolute().then((abs) => {
      if (cancelled) return;
      if (abs) setResolvedAbs(abs);
      else setMissing(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, projectPath, absolutePath, kind]);

  useEffect(() => {
    if (!detailsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detailsOpen]);

  const openInPanel = async () => {
    if (isUrl) {
      onOpenInPanel?.({ type: "url", url: path, title: name });
      return;
    }
    // Card chrome only mounts after a verified abs; re-resolve if stale.
    if (busy) return;
    setBusy(true);
    try {
      const abs = resolvedAbs || (await resolveAbsolute());
      if (!abs) {
        setMissing(true);
        setResolvedAbs(null);
        onOpenError?.(filePathCardErrLabel(labels, "not_found"));
        return;
      }
      onOpenInPanel?.({
        type: "file",
        path: abs,
        title: name,
        line: focusLine,
        column: focusColumn,
      });
    } finally {
      setBusy(false);
    }
  };

  const openExternal = async () => {
    if (isUrl) {
      window.open(path, "_blank", "noopener,noreferrer");
      return;
    }
    if (!api.isTauri()) {
      onOpenError?.(filePathCardErrLabel(labels, "host_only"));
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const abs = resolvedAbs || (await resolveAbsolute());
      if (!abs) {
        setMissing(true);
        onOpenError?.(filePathCardErrLabel(labels, "not_found"));
        return;
      }
      // path:line citations jump in the default editor when line is known.
      if (focusLine != null) {
        await api.openInEditor({ path: abs, line: focusLine });
      } else {
        await api.pathOpen(abs);
      }
    } catch (e) {
      // path_open shares reveal-like Host phrases; open classifier is a superset.
      const resolved = resolveOpenEditorError(e);
      if (resolved.silent) return;
      // Prefer classified label over raw Error dumps (never String(e)).
      onOpenError?.(filePathCardErrLabel(labels, resolved.kind));
    } finally {
      setBusy(false);
    }
  };

  const reveal = async () => {
    if (isUrl) return;
    if (!api.isTauri()) {
      onOpenError?.(filePathCardErrLabel(labels, "host_only"));
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const abs = resolvedAbs || (await resolveAbsolute());
      if (!abs) {
        setMissing(true);
        onOpenError?.(filePathCardErrLabel(labels, "not_found"));
        return;
      }
      await api.pathReveal(abs);
    } catch (e) {
      const resolved = resolveRevealError(e);
      if (resolved.silent) return;
      onOpenError?.(filePathCardErrLabel(labels, resolved.kind, true));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      const abs = resolvedAbs || (await resolveAbsolute());
      await navigator.clipboard.writeText(abs || path);
    } catch {
      /* ignore */
    }
  };

  const typeLabel = isUrl
    ? labels.typeUrl || "URL"
    : kind === "dir"
      ? labels.typeDir || "Folder"
      : labels.typeFile || "File";

  // Prefer resolved abs in details; fall back to original token.
  const detailsPath = resolvedAbs || path;

  // Gate: no real path yet (or proven missing) → plain inline code, not a card.
  // URLs always render as cards. Pending resolve also stays plain (no flash).
  if (!isUrl && !resolvedAbs) {
    return (
      <code className="chat-md__inline-code" title={path}>
        {path}
      </code>
    );
  }

  const menuItems: ContextMenuItem[] = [
    {
      id: "open-panel",
      label: labels.openInPanel || labels.open,
      icon: <IconFileText size={16} />,
      onClick: () => {
        void openInPanel();
      },
    },
    {
      id: "open-external",
      label: labels.openExternal || labels.open,
      icon: <IconExternalLink size={16} />,
      onClick: () => {
        void openExternal();
      },
    },
  ];
  if (!isUrl) {
    menuItems.push({
      id: "reveal",
      label: labels.reveal,
      icon: <IconFolder size={16} />,
      onClick: () => {
        void reveal();
      },
    });
  }
  menuItems.push(
    {
      id: "copy-path",
      label: labels.copyPath,
      icon: <IconCopy size={16} />,
      onClick: () => {
        void copy();
      },
    },
    {
      id: "details",
      label: labels.details || "Details",
      icon: <IconInfo size={16} />,
      onClick: () => setDetailsOpen(true),
    },
  );

  return (
    <>
      <div
        className={
          "file-path-card" +
          (isUrl ? " file-path-card--url" : "") +
          (kind === "dir" ? " file-path-card--dir" : "")
        }
        title={resolvedAbs || path || name}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <button
          type="button"
          className="file-path-card__main"
          onClick={() => void openInPanel()}
          disabled={busy}
        >
          <span className="file-path-card__icon" aria-hidden>
            {kind === "dir" ? (
              <IconFolder size={16} />
            ) : isUrl ? (
              <IconExternalLink size={16} />
            ) : (
              <IconFileText size={16} />
            )}
          </span>
          <span className="file-path-card__meta">
            <span className="file-path-card__name">{name}</span>
          </span>
        </button>
      </div>

      <ContextMenu
        open={!!menu}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
        items={menuItems}
      />

      {detailsOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="overlay file-path-details-overlay"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setDetailsOpen(false);
            }}
          >
            <div
              className="modal file-path-details"
              role="dialog"
              aria-modal="true"
              aria-labelledby="file-path-details-title"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <header className="modal-head file-path-details__head">
                <h2 id="file-path-details-title" className="modal-title">
                  {labels.detailsTitle || labels.details || "Details"}
                </h2>
                <button
                  type="button"
                  className="icon-btn modal-close"
                  aria-label={labels.detailsClose || "Close"}
                  onClick={() => setDetailsOpen(false)}
                >
                  <IconClose size={16} />
                </button>
              </header>
              <div className="file-path-details__body">
                <div className="file-path-details__row">
                  <span className="file-path-details__label">
                    {labels.detailsName || "Name"}
                  </span>
                  <span className="file-path-details__value" title={name}>
                    {name}
                  </span>
                </div>
                <div className="file-path-details__row">
                  <span className="file-path-details__label">
                    {labels.detailsType || "Type"}
                  </span>
                  <span className="file-path-details__value">
                    {typeLabel}
                    {!isUrl && kind !== "dir"
                      ? ` · ${kindLabel(path, kind)}`
                      : ""}
                  </span>
                </div>
                <div className="file-path-details__row">
                  <span className="file-path-details__label">
                    {labels.detailsPath || "Path"}
                  </span>
                  <code className="file-path-details__value file-path-details__mono">
                    {detailsPath}
                  </code>
                </div>
                {!isUrl && resolvedAbs && path !== resolvedAbs ? (
                  <div className="file-path-details__row">
                    <span className="file-path-details__label">
                      {labels.detailsResolved || "Original"}
                    </span>
                    <code className="file-path-details__value file-path-details__mono">
                      {path}
                    </code>
                  </div>
                ) : null}
                {!isUrl ? (
                  <div className="file-path-details__row">
                    <span className="file-path-details__label">
                      {labels.detailsStatus || "Status"}
                    </span>
                    <span
                      className={
                        "file-path-details__value" +
                        (missing && !resolvedAbs
                          ? " file-path-details__value--warn"
                          : "")
                      }
                    >
                      {missing && !resolvedAbs
                        ? labels.detailsMissing || "Not found"
                        : labels.detailsOk || "OK"}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="modal-actions file-path-details__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    void copy();
                  }}
                >
                  {labels.copyPath}
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setDetailsOpen(false)}
                >
                  {labels.detailsClose || "Close"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
