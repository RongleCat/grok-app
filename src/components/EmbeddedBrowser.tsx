/**
 * Built-in **in-app** browser for the resource pane / side workbench.
 *
 * Always uses a Tauri child Webview painted over this host element
 * (WKWebView / WebView2 / webkit2gtk). External Chrome processes are
 * intentionally not used — automation must target the same embedded surface.
 *
 * Stable label: `resource-browser` or `resource-browser-<instanceId>`
 * so host commands (`side_browser_*`) can drive navigate / eval / snapshot.
 *
 * Creation goes through host `side_browser_create` (not frontend `new Webview`)
 * so downloads get a native save dialog via wry/Tauri `on_download`.
 *
 * Lifecycle (perf):
 * - Create once per label; URL changes use `side_browser_navigate` (not recreate).
 * - Reload uses `side_browser_reload` (full document refresh without tear-down).
 * - Pane hide/show only toggles visibility; bounds re-apply only when the host
 *   rect actually moves (avoids open/close blocking on setPosition/setSize).
 *
 * Bounds: host ResizeObserver + ancestor observers + window resize, coalesced
 * through a trailing single-flight so setPosition/setSize never interleave
 * (sidebar drag used to jitter / leave a white gap).
 *
 * Non-Tauri (dev UI only): falls back to iframe + open-external affordance.
 */

import { useEffect, useRef, useState } from "react";
import {
  isTauri,
  sideBrowserClose,
  sideBrowserCreate,
  sideBrowserInstallDownloadHook,
  sideBrowserNavigate,
  sideBrowserReload,
} from "@/lib/api";
import type { SideBrowserDownloadEvent } from "@/lib/api";
import { createT, type Locale } from "@/i18n";
import { IconExternalLink, IconRefresh } from "@/components/icons";
import {
  applyFloatExcludeToBounds,
  getNativeWebviewFloatExclude,
  isNativeWebviewCovered,
  subscribeNativeWebviewCover,
  subscribeNativeWebviewFloatExclude,
} from "@/lib/nativeWebviewCover";
import {
  boundsNearlyEqual,
  clipHostRectAgainstLeftResizers,
  createTrailingSingleFlight,
  snapBounds,
  type BoundsPx,
  type HostRectPx,
} from "@/lib/nativeWebviewBounds";

/** Collect visible vertical pane resizers that may sit under this host. */
function leftPaneResizersNear(hostEl: HTMLElement): HostRectPx[] {
  const out: HostRectPx[] = [];
  const aside = hostEl.closest(".aside");
  if (!aside) return out;
  const nodes = aside.querySelectorAll(".aside-resizer");
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as HTMLElement;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
    } catch {
      continue;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    out.push({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    });
  }
  return out;
}

/** Keep the 1px aside border hairline visible under native child Webviews. */
const ASIDE_BROWSER_LEFT_INSET_PX = 1;

function hostRectForWebview(hostEl: HTMLElement): HostRectPx {
  const rect = hostEl.getBoundingClientRect();
  let base: HostRectPx = {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
  base = clipHostRectAgainstLeftResizers(base, leftPaneResizersNear(hostEl));
  // Side-pane browser only: shrink 1px from the left so the divider line shows.
  if (hostEl.closest(".aside") && base.width > ASIDE_BROWSER_LEFT_INSET_PX) {
    base = {
      ...base,
      left: base.left + ASIDE_BROWSER_LEFT_INSET_PX,
      width: base.width - ASIDE_BROWSER_LEFT_INSET_PX,
    };
  }
  return base;
}

const WEBVIEW_LABEL_DEFAULT = "resource-browser";
const DOWNLOAD_EVENT = "side-browser://download";
const CREATE_TIMEOUT_MS = 15_000;
const CLOSE_GRACE_MS = 150;

// React StrictMode and quick pane remounts run effect cleanup immediately
// before mounting the same label again. Closing the native WebView in that
// gap can overlap the next WebView2 add_child call on Windows. Delay the close
// briefly and cancel it when the same label is mounted again.
const pendingCloseTimers = new Map<string, number>();

function cancelPendingClose(label: string) {
  const timer = pendingCloseTimers.get(label);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  pendingCloseTimers.delete(label);
}

function scheduleClose(label: string) {
  cancelPendingClose(label);
  const timer = window.setTimeout(() => {
    if (pendingCloseTimers.get(label) !== timer) return;
    pendingCloseTimers.delete(label);
    void sideBrowserClose(label).catch((e) => {
      console.warn("[EmbeddedBrowser] delayed close failed", e);
    });
  }, CLOSE_GRACE_MS);
  pendingCloseTimers.set(label, timer);
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer = 0;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

/** How many parent elements to observe so pane/splitter moves re-sync position. */
const ANCESTOR_OBSERVE_DEPTH = 6;

type DpiMod = typeof import("@tauri-apps/api/dpi");

let dpiModPromise: Promise<DpiMod> | null = null;

function loadDpi(): Promise<DpiMod> {
  if (!dpiModPromise) {
    dpiModPromise = import("@tauri-apps/api/dpi");
  }
  return dpiModPromise;
}

export interface EmbeddedBrowserProps {
  url: string;
  title?: string;
  locale?: Locale;
  /** When false, native webview is hidden (inactive tab / collapsed pane). */
  active?: boolean;
  className?: string;
  /**
   * Unique webview label suffix per browser tab (multi-instance).
   * Full label = `resource-browser-${instanceId}`.
   */
  instanceId?: string;
  /**
   * Bump to force a full document reload without changing `url`
   * (address-bar Enter on same URL / explicit refresh).
   */
  reloadKey?: number;
}

/** Public label scheme for automation / host commands. */
export function sideBrowserWebviewLabel(instanceId?: string | null): string {
  if (!instanceId) return WEBVIEW_LABEL_DEFAULT;
  return sanitizeLabel(`resource-browser-${instanceId}`);
}

function sanitizeLabel(s: string): string {
  return s.replace(/[^a-zA-Z0-9\-_:/]/g, "-").slice(0, 64) || "resource-browser";
}

async function openExternalUrl(url: string) {
  try {
    if (isTauri()) {
      const api = await import("@/lib/api");
      await api.openExternalUrl(url);
      return;
    }
  } catch {
    /* fall through */
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function EmbeddedBrowser({
  url,
  title,
  locale = "en",
  active = true,
  className = "",
  instanceId,
  reloadKey = 0,
}: EmbeddedBrowserProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Dynamic import type — keep loose to avoid hard coupling on Tauri version.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webviewRef = useRef<any>(null);
  const currentUrlRef = useRef<string>("");
  const bootUrlRef = useRef(url.trim());
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /** Short status for download save result (host event). */
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  /** DOM overlays (floating menus) that must paint above native Webviews. */
  const [covered, setCovered] = useState(() => isNativeWebviewCovered());
  const tr = createT(locale);
  const webviewLabel = sideBrowserWebviewLabel(instanceId);
  const activeRef = useRef(active);
  const coveredRef = useRef(covered);
  const lastBoundsRef = useRef<BoundsPx | null>(null);
  /** Last applied visibility — skip redundant hide/show IPC on every RO tick. */
  const lastVisibleRef = useRef<boolean | null>(null);
  const scheduleRef = useRef<ReturnType<typeof createTrailingSingleFlight> | null>(
    null,
  );
  const applyBoundsRef = useRef<() => Promise<void>>(async () => undefined);
  const roRafRef = useRef(0);
  const downloadStatusTimerRef = useRef(0);
  const injectTimersRef = useRef<number[]>([]);
  /** Last reloadKey we already applied (skip 0 / initial). */
  const appliedReloadKeyRef = useRef(0);
  activeRef.current = active;
  coveredRef.current = covered;
  bootUrlRef.current = url.trim();

  const flashDownloadStatus = (msg: string) => {
    setDownloadStatus(msg);
    window.clearTimeout(downloadStatusTimerRef.current);
    downloadStatusTimerRef.current = window.setTimeout(() => {
      setDownloadStatus(null);
    }, 4200);
  };

  const clearInjectTimers = () => {
    for (const id of injectTimersRef.current) window.clearTimeout(id);
    injectTimersRef.current = [];
  };

  const scheduleDownloadHookInject = () => {
    clearInjectTimers();
    // Non-blocking reinject after paint (host eval no longer waits 15s).
    // ChatCut is a slow SPA — reinject a few times until hooks stick.
    const injectHook = () => {
      void sideBrowserInstallDownloadHook(webviewLabel).catch(() => undefined);
    };
    injectTimersRef.current = [
      window.setTimeout(injectHook, 500),
      window.setTimeout(injectHook, 2000),
      window.setTimeout(injectHook, 5000),
    ];
  };

  const setWebviewVisible = async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wv: any,
    wantShow: boolean,
  ) => {
    if (lastVisibleRef.current === wantShow) return;
    try {
      if (wantShow) await wv.show();
      else await wv.hide();
      lastVisibleRef.current = wantShow;
    } catch {
      /* ignore — leave lastVisible so next tick can retry */
    }
  };

  /**
   * Apply host rect → native webview. Always re-reads DOM at start so trailing
   * coalesced runs pick up the latest sidebar/window size.
   */
  applyBoundsRef.current = async () => {
    const el = hostRef.current;
    const wv = webviewRef.current;
    if (!el || !wv || !isTauri()) return;

    // Clip past left-edge pane resizers first (native webviews paint above DOM).
    const rect = hostRectForWebview(el);
    if (rect.width < 2 || rect.height < 2) {
      lastBoundsRef.current = null;
      await setWebviewVisible(wv, false);
      return;
    }

    const clipped = applyFloatExcludeToBounds(
      {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      getNativeWebviewFloatExclude(),
      10,
    );

    if (clipped.width < 2 || clipped.height < 2) {
      lastBoundsRef.current = null;
      await setWebviewVisible(wv, false);
      return;
    }

    const next = snapBounds({
      x: clipped.left,
      y: clipped.top,
      width: clipped.width,
      height: clipped.height,
    });

    const wantShow = activeRef.current && !coveredRef.current;
    const boundsSame = boundsNearlyEqual(lastBoundsRef.current, next, 0.5);

    if (boundsSame) {
      await setWebviewVisible(wv, wantShow);
      return;
    }

    try {
      const { LogicalPosition, LogicalSize } = await loadDpi();
      // Position then size — one pair per apply; single-flight prevents interleave.
      // When hidden (pane closed), still update bounds so the next show is correct
      // without a second full apply — but skip show/hide thrash via lastVisibleRef.
      await wv.setPosition(new LogicalPosition(next.x, next.y));
      await wv.setSize(new LogicalSize(next.width, next.height));
      lastBoundsRef.current = next;
      await setWebviewVisible(wv, wantShow);
    } catch (e) {
      console.error("[EmbeddedBrowser] syncBounds", e);
    }
  };

  // Stable flight controller for this mount lifetime (always calls latest apply).
  if (!scheduleRef.current) {
    scheduleRef.current = createTrailingSingleFlight(() =>
      applyBoundsRef.current(),
    );
  }

  const scheduleSync = () => {
    scheduleRef.current?.schedule();
  };

  const scheduleSyncRaf = () => {
    cancelAnimationFrame(roRafRef.current);
    roRafRef.current = requestAnimationFrame(() => {
      scheduleSync();
    });
  };

  useEffect(() => {
    return subscribeNativeWebviewCover(setCovered);
  }, []);

  // Floating composer moved / sized — re-clip native webview without full hide.
  useEffect(() => {
    return subscribeNativeWebviewFloatExclude(() => {
      scheduleSyncRaf();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Download status from host on_download (save dialog + finish).
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const off = await listen<SideBrowserDownloadEvent>(
          DOWNLOAD_EVENT,
          (ev) => {
            const p = ev.payload;
            if (!p || p.label !== webviewLabel) return;
            if (p.phase === "requested") {
              const name = p.fileName || "file";
              flashDownloadStatus(
                tr("resources.browserDownloadStarted", { name }),
              );
            } else if (p.phase === "finished") {
              if (p.success) {
                const name =
                  p.fileName ||
                  (p.path ? p.path.split(/[/\\]/).pop() : "") ||
                  "file";
                flashDownloadStatus(
                  tr("resources.browserDownloadSaved", { name }),
                );
              } else {
                flashDownloadStatus(tr("resources.browserDownloadFailed"));
              }
            } else if (p.phase === "cancelled") {
              flashDownloadStatus(tr("resources.browserDownloadCancelled"));
            }
          },
        );
        if (cancelled) off();
        else unlisten = off;
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
      window.clearTimeout(downloadStatusTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webviewLabel, locale]);

  // Create once per label. URL changes navigate in-place (do not tear down WKWebView).
  useEffect(() => {
    if (!isTauri()) return;
    const initialUrl = bootUrlRef.current;
    if (!initialUrl) return;

    let cancelled = false;
    let resizeObs: ResizeObserver | null = null;
    let io: IntersectionObserver | null = null;

    lastBoundsRef.current = null;
    lastVisibleRef.current = null;

    const boot = async () => {
      cancelPendingClose(webviewLabel);
      setError(null);
      setReady(false);
      try {
        // Warm dpi module before create so first drag frames don't pay import cost.
        void loadDpi();
        const { Webview } = await import("@tauri-apps/api/webview");
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const { LogicalPosition, LogicalSize } = await loadDpi();
        const win = getCurrentWindow();

        // Do not close before create. The host reuses a live label, which avoids
        // overlapping WebView2 controller teardown with a new add_child call.
        webviewRef.current = null;
        currentUrlRef.current = "";
        lastVisibleRef.current = null;
        if (cancelled) return;

        const el = hostRef.current;
        const rect = el ? hostRectForWebview(el) : null;
        const x = Math.round(rect?.left ?? 0);
        const y = Math.round(rect?.top ?? 0);
        const w = Math.max(Math.round(rect?.width ?? 320), 40);
        const h = Math.max(Math.round(rect?.height ?? 240), 40);

        // Use latest desired URL in case props changed while we awaited imports.
        const target = bootUrlRef.current || initialUrl;

        await withTimeout(
          sideBrowserCreate({
            label: webviewLabel,
            url: target,
            windowLabel: win.label,
            x,
            y,
            width: w,
            height: h,
          }),
          CREATE_TIMEOUT_MS,
          `side browser create timed out after ${CREATE_TIMEOUT_MS / 1000}s (${webviewLabel})`,
        );

        if (cancelled) {
          try {
            await sideBrowserClose(webviewLabel);
          } catch {
            /* ignore */
          }
          return;
        }

        const webview = await Webview.getByLabel(webviewLabel);
        if (!webview) {
          throw new Error("side browser webview missing after create");
        }

        webviewRef.current = webview;
        currentUrlRef.current = target;
        lastBoundsRef.current = { x, y, width: w, height: h };
        await webview.setPosition(new LogicalPosition(x, y));
        await webview.setSize(new LogicalSize(w, h));
        const wantShow = activeRef.current && !coveredRef.current;
        if (wantShow) await webview.show();
        else await webview.hide();
        lastVisibleRef.current = wantShow;
        setReady(true);

        scheduleDownloadHookInject();

        // Layout may have changed while we awaited create — apply latest once.
        scheduleSync();

        // If URL changed during boot, navigate once (no recreate).
        const latest = bootUrlRef.current;
        if (latest && latest !== target) {
          try {
            await sideBrowserNavigate(webviewLabel, latest);
            currentUrlRef.current = latest;
            scheduleDownloadHookInject();
          } catch (e) {
            console.error("[EmbeddedBrowser] post-boot navigate", e);
          }
        }

        if (hostRef.current && typeof ResizeObserver !== "undefined") {
          resizeObs = new ResizeObserver(() => {
            scheduleSyncRaf();
          });
          // Host + ancestors: sidebar/aside width is often applied on a parent;
          // host size may lag a frame, and position-only moves need parent RO.
          let node: HTMLElement | null = hostRef.current;
          for (let i = 0; i < ANCESTOR_OBSERVE_DEPTH && node; i++) {
            resizeObs.observe(node);
            node = node.parentElement;
          }
        }
        if (hostRef.current && typeof IntersectionObserver !== "undefined") {
          io = new IntersectionObserver(
            (entries) => {
              const vis = entries.some(
                (e) => e.isIntersecting && e.intersectionRatio > 0.05,
              );
              const wv = webviewRef.current;
              if (!wv) return;
              if (!vis || !activeRef.current) {
                if (lastVisibleRef.current !== false) {
                  lastVisibleRef.current = false;
                  void wv.hide().catch(() => undefined);
                }
              } else {
                scheduleSyncRaf();
              }
            },
            { threshold: [0, 0.05, 0.5, 1] },
          );
          io.observe(hostRef.current);
        }
        window.addEventListener("resize", onResize);
      } catch (e) {
        if (!cancelled) {
          console.error("[EmbeddedBrowser] create failed", e);
          setError(String(e));
          setReady(false);
        }
      }
    };

    const onResize = () => {
      scheduleSyncRaf();
    };

    void boot();

    return () => {
      cancelled = true;
      cancelAnimationFrame(roRafRef.current);
      clearInjectTimers();
      resizeObs?.disconnect();
      io?.disconnect();
      window.removeEventListener("resize", onResize);
      webviewRef.current = null;
      currentUrlRef.current = "";
      lastBoundsRef.current = null;
      lastVisibleRef.current = null;
      // Single delayed host close path (do not also call frontend Webview.close).
      // A same-label remount cancels this timer and reuses the existing WebView.
      if (isTauri()) {
        scheduleClose(webviewLabel);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webviewLabel]);

  // In-place navigate when URL changes (keeps process / session / caches warm).
  useEffect(() => {
    if (!isTauri() || !ready) return;
    const target = url.trim();
    if (!target) return;
    if (target === currentUrlRef.current) return;
    if (!webviewRef.current) return;

    let cancelled = false;
    void (async () => {
      try {
        await sideBrowserNavigate(webviewLabel, target);
        if (cancelled) return;
        currentUrlRef.current = target;
        setError(null);
        scheduleDownloadHookInject();
        scheduleSync();
      } catch (e) {
        if (!cancelled) {
          console.error("[EmbeddedBrowser] navigate failed", e);
          setError(String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ready, webviewLabel]);

  // Explicit reload (refresh button / Enter on same URL).
  useEffect(() => {
    if (!isTauri() || !ready) return;
    if (!reloadKey || reloadKey === appliedReloadKeyRef.current) return;
    appliedReloadKeyRef.current = reloadKey;
    if (!webviewRef.current) return;

    let cancelled = false;
    void (async () => {
      try {
        await sideBrowserReload(webviewLabel);
        if (cancelled) return;
        setError(null);
        scheduleDownloadHookInject();
        scheduleSync();
      } catch (e) {
        if (!cancelled) {
          console.error("[EmbeddedBrowser] reload failed", e);
          setError(String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, ready, webviewLabel]);

  // Visibility only — do NOT null bounds (avoids open/close setPosition thrash).
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !isTauri()) return;
    scheduleSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, covered]);

  // Dispose flight only on unmount (not on url change — shared scheduleRef).
  useEffect(() => {
    return () => {
      scheduleRef.current?.dispose();
      scheduleRef.current = null;
      clearInjectTimers();
    };
  }, []);

  const openExternal = () => {
    void openExternalUrl(url);
  };

  const reload = () => {
    if (!isTauri()) return;
    if (!webviewRef.current) return;
    void (async () => {
      try {
        setError(null);
        await sideBrowserReload(webviewLabel);
        scheduleDownloadHookInject();
        scheduleSync();
      } catch (e) {
        setError(String(e));
      }
    })();
  };

  if (!isTauri()) {
    return (
      <div className={"embedded-browser " + className}>
        <div className="embedded-browser__bar">
          <span className="embedded-browser__url" title={url}>
            {url}
          </span>
          <button
            type="button"
            className="chrome-btn"
            onClick={openExternal}
            title={tr("resources.openExternal")}
          >
            <IconExternalLink size={14} />
          </button>
        </div>
        <iframe
          key={`${url}::${reloadKey}`}
          className="rp-preview__frame rp-preview__frame--browser"
          title={title || url}
          src={url}
          referrerPolicy="no-referrer"
          allow="fullscreen"
        />
        <div className="embedded-browser__hint">
          {tr("resources.browserIframeHint")}
        </div>
      </div>
    );
  }

  return (
    <div
      className={"embedded-browser embedded-browser--native " + className}
      data-webview-label={webviewLabel}
    >
      <div className="embedded-browser__bar">
        <span className="embedded-browser__url" title={url}>
          {url}
        </span>
        {downloadStatus ? (
          <span
            className="embedded-browser__download-status"
            role="status"
            title={downloadStatus}
          >
            {downloadStatus}
          </span>
        ) : null}
        <button
          type="button"
          className="chrome-btn"
          onClick={reload}
          title={tr("resources.browserReload")}
        >
          <IconRefresh size={14} />
        </button>
        <button
          type="button"
          className="chrome-btn"
          onClick={openExternal}
          title={tr("resources.openExternal")}
        >
          <IconExternalLink size={14} />
        </button>
      </div>
      <div
        ref={hostRef}
        className="embedded-browser__host"
        data-native-webview-host=""
        data-webview-label={webviewLabel}
        data-ready={ready ? "1" : "0"}
        data-webview-covered={covered ? "1" : "0"}
        aria-label={title || url}
      >
        {error ? (
          <div className="rp-preview__msg" role="alert">
            <p>{tr("resources.browserFailed")}</p>
            <p className="embedded-browser__err">{error}</p>
            <button
              type="button"
              className="btn btn--primary"
              onClick={openExternal}
            >
              {tr("resources.openExternal")}
            </button>
          </div>
        ) : !ready ? (
          <div className="rp-preview__msg">{tr("resources.loading")}</div>
        ) : (
          <div className="embedded-browser__host-fill" aria-hidden />
        )}
      </div>
    </div>
  );
}
