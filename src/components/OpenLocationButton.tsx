/**
 * Codex-style split “打开位置” control:
 * - Leading app icon of last-used target + label
 * - Primary click opens path with that target
 * - Caret opens menu (each option has a real app icon)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as api from "@/lib/api";
import { useFloatingMenu } from "@/lib/floatingMenu";
import {
  dirForGitProbe,
  filterEditorsForGitContext,
  isGitGuiEditorId,
} from "@/lib/openApps";
import {
  IconChevronDown,
  IconCopy,
  IconExternalLink,
  IconFolder,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";

export type OpenLocationTarget = string; // finder | explorer | system | editor id

export interface OpenLocationButtonProps {
  /** Absolute path to open (project root or file). Hidden when null/empty. */
  path: string | null | undefined;
  /**
   * Optional 1-based line for editor `-g path:line` when opening a code editor.
   * Soft-fail / ignored for Finder / system default.
   */
  line?: number | null;
  /** Last selected target id (persisted by parent). */
  target: OpenLocationTarget;
  /** Called when user picks a menu item (parent should persist). */
  onTargetChange: (target: OpenLocationTarget) => void;
  /** Optional: after open success / always after attempt. */
  onOpenError?: (err: string) => void;
  /** Optional toast/feedback after path is copied. */
  onCopied?: () => void;
  platform?: "mac" | "win" | "linux" | "other";
  labels: {
    openLocation: string;
    openHint: string;
    openMenu: string;
    finder: string;
    systemDefault: string;
    /** Last menu item — copy absolute path. */
    copyPath: string;
  };
  className?: string;
  /** Compact: icon + caret only (no label). */
  compact?: boolean;
  disabled?: boolean;
}

function normalizeTarget(t: string | undefined | null): string {
  const v = (t || "finder").trim().toLowerCase();
  return v || "finder";
}

export function OpenLocationButton({
  path,
  line = null,
  target,
  onTargetChange,
  onOpenError,
  onCopied,
  platform = "mac",
  labels,
  className = "",
  compact = false,
  disabled = false,
}: OpenLocationButtonProps) {
  const [open, setOpen] = useState(false);
  const [editors, setEditors] = useState<api.DetectedEditor[]>([]);
  const [finderIcon, setFinderIcon] = useState<string | null>(null);
  const [systemIcon, setSystemIcon] = useState<string | null>(null);
  /** Path is inside a git work tree — gates Fork / SourceTree / GitHub Desktop. */
  const [isGitRepo, setIsGitRepo] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { pos, style } = useFloatingMenu({
    open,
    triggerRef: rootRef,
    panelRef,
    onClose: () => setOpen(false),
    placement: "down",
    fitContent: true,
    estHeight: 340,
    gap: 6,
  });

  const loadIcons = useCallback(() => {
    if (!api.isTauri()) return;
    void api
      .editorsList()
      .then((r) => {
        setEditors((r.editors ?? []).filter((e) => e.available));
        setFinderIcon(r.finderIcon ?? null);
        setSystemIcon(r.systemIcon ?? null);
      })
      .catch(() => {
        setEditors([]);
        setFinderIcon(null);
        setSystemIcon(null);
      });
  }, []);

  // Prefetch so the pill shows the real app icon immediately.
  useEffect(() => {
    loadIcons();
  }, [loadIcons]);

  // Host finishes a background full scan (icons + new apps) → refresh menu.
  useEffect(() => {
    if (!api.isTauri()) return;
    let unlisten: (() => void) | undefined;
    void api
      .listen<api.EditorsListResult>("editors://updated", (payload) => {
        setEditors((payload.editors ?? []).filter((e) => e.available));
        setFinderIcon(payload.finderIcon ?? null);
        setSystemIcon(payload.systemIcon ?? null);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      unlisten?.();
    };
  }, []);

  // Probe whether `path` is a git work tree (Fork / SourceTree / GitHub Desktop).
  useEffect(() => {
    if (!api.isTauri() || !path) {
      setIsGitRepo(false);
      return;
    }
    const probeDir = dirForGitProbe(path);
    if (!probeDir) {
      setIsGitRepo(false);
      return;
    }
    let cancelled = false;
    void api
      .gitStatus(probeDir)
      .then((r) => {
        if (!cancelled) setIsGitRepo(!!r.available);
      })
      .catch(() => {
        if (!cancelled) setIsGitRepo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const visibleEditors = useMemo(
    () => filterEditorsForGitContext(editors, isGitRepo),
    [editors, isGitRepo],
  );

  const finderTarget = platform === "win" ? "explorer" : "finder";
  // linux/other also use path_reveal; target id stays "finder" for persistence.

  const active = normalizeTarget(target);
  // If last-used target was a git GUI but this project is not a repo, fall back.
  const effectiveActive = useMemo(() => {
    if (isGitGuiEditorId(active) && !isGitRepo) return finderTarget;
    if (
      active !== "finder" &&
      active !== "explorer" &&
      active !== "system" &&
      active !== "default" &&
      !visibleEditors.some((e) => e.id === active)
    ) {
      return finderTarget;
    }
    return active;
  }, [active, isGitRepo, finderTarget, visibleEditors]);

  const currentIcon = useMemo(() => {
    if (effectiveActive === "finder" || effectiveActive === "explorer") {
      return finderIcon;
    }
    if (effectiveActive === "system" || effectiveActive === "default") {
      return systemIcon;
    }
    return (
      visibleEditors.find((e) => e.id === effectiveActive)?.iconDataUrl ?? null
    );
  }, [effectiveActive, finderIcon, systemIcon, visibleEditors]);

  const openWith = useCallback(
    async (raw: string, remember: boolean) => {
      if (!path || disabled) return;
      let t = normalizeTarget(raw);
      if (isGitGuiEditorId(t) && !isGitRepo) {
        t = finderTarget;
      }
      if (remember) onTargetChange(t);
      const gotoLine =
        line != null && Number.isInteger(line) && line >= 1 ? line : undefined;
      try {
        if (t === "finder" || t === "explorer") {
          await api.pathReveal(path);
        } else if (t === "system" || t === "default") {
          await api.pathOpen(path);
        } else {
          await api.openInEditor({ path, editor: t, line: gotoLine });
        }
      } catch (e) {
        onOpenError?.(String(e));
      }
    },
    [path, line, disabled, onTargetChange, onOpenError, isGitRepo, finderTarget],
  );

  if (!path) return null;

  const menu =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            className="menu-panel open-loc-menu"
            role="menu"
            style={style}
          >
            <button
              type="button"
              role="menuitem"
              className={
                "open-loc-menu__item" +
                (effectiveActive === "finder" || effectiveActive === "explorer"
                  ? " is-active"
                  : "")
              }
              onClick={() => {
                setOpen(false);
                void openWith(finderTarget, true);
              }}
            >
              <span className="open-loc-menu__ico" aria-hidden>
                {finderIcon ? (
                  <img src={finderIcon} alt="" />
                ) : (
                  <IconFolder size={16} />
                )}
              </span>
              <span>{labels.finder}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={
                "open-loc-menu__item" +
                (effectiveActive === "system" || effectiveActive === "default"
                  ? " is-active"
                  : "")
              }
              onClick={() => {
                setOpen(false);
                void openWith("system", true);
              }}
            >
              <span className="open-loc-menu__ico" aria-hidden>
                {systemIcon ? (
                  <img src={systemIcon} alt="" />
                ) : (
                  <IconExternalLink size={16} />
                )}
              </span>
              <span>{labels.systemDefault}</span>
            </button>
            {visibleEditors.length > 0 && (
              <div className="open-loc-menu__sep" aria-hidden />
            )}
            {visibleEditors.map((ed) => (
              <button
                key={ed.id}
                type="button"
                role="menuitem"
                className={
                  "open-loc-menu__item" +
                  (effectiveActive === ed.id ? " is-active" : "")
                }
                onClick={() => {
                  setOpen(false);
                  void openWith(ed.id, true);
                }}
              >
                <span className="open-loc-menu__ico" aria-hidden>
                  {ed.iconDataUrl ? (
                    <img src={ed.iconDataUrl} alt="" />
                  ) : (
                    <IconExternalLink size={16} />
                  )}
                </span>
                <span>{ed.label}</span>
              </button>
            ))}
            <div className="open-loc-menu__sep" aria-hidden />
            <button
              type="button"
              role="menuitem"
              className="open-loc-menu__item"
              onClick={() => {
                setOpen(false);
                if (!path) return;
                void navigator.clipboard
                  .writeText(path)
                  .then(() => onCopied?.())
                  .catch((e) => onOpenError?.(String(e)));
              }}
            >
              <span className="open-loc-menu__ico" aria-hidden>
                <IconCopy size={16} />
              </span>
              <span>{labels.copyPath}</span>
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={rootRef}
      className={
        "open-loc" +
        (open ? " is-open" : "") +
        (compact ? " open-loc--compact" : "") +
        (disabled ? " is-disabled" : "") +
        (className ? ` ${className}` : "")
      }
    >
      <Tip label={labels.openHint} disabled={disabled}>
        <button
          type="button"
          className="open-loc__main"
          disabled={disabled}
          onClick={() => void openWith(effectiveActive, false)}
        >
          <span className="open-loc__app-ico" aria-hidden>
            {currentIcon ? (
              <img src={currentIcon} alt="" />
            ) : (
              <IconExternalLink size={15} />
            )}
          </span>
          {!compact && (
            <span className="open-loc__label">{labels.openLocation}</span>
          )}
        </button>
      </Tip>
      <Tip label={labels.openMenu} disabled={disabled}>
        <button
          type="button"
          className="open-loc__caret"
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => {
              const next = !v;
              if (next) loadIcons();
              return next;
            });
          }}
        >
          <IconChevronDown size={12} />
        </button>
      </Tip>
      {menu}
    </div>
  );
}
