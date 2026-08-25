/**
 * Workbench pane layout: prefs, zen, phone chrome, overlay fit, open/close,
 * window grow, and splitter drag. Domain owns persistence; callers get verbs.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ASIDE_WIDTH_MIN,
  DEFAULT_LAYOUT,
  WINDOW_CONTROLS_INSET,
  clampAsideWidth,
  clampSidebarDragWidth,
  clampSidebarWidth,
  isMirrorPhoneLayout,
  loadLayout,
  resolveSidebarDragEnd,
  saveLayout,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_WIDTH_MIN,
  withMirrorPhoneDrawerDefault,
  type LayoutPrefs,
} from "@/lib/layout";
import { isMirrorClient } from "@/lib/mirrorTransport";
import { detectAppPlatform, usesCustomWindowChrome } from "@/lib/appPlatform";
import {
  TRANSCRIPT_FILTER_CHANGE_EVENT,
  loadTranscriptFilterPref,
  saveTranscriptFilterPref,
  type TranscriptFilterMode,
} from "@/lib/transcriptFilterPref";
import {
  ZEN_MODE_CHANGE_EVENT,
  applyZenModeLayoutTransition,
  clearZenModePrior,
  loadZenMode,
  loadZenModePrior,
  saveZenMode,
  saveZenModePrior,
} from "@/lib/zenMode";
import { resolveWorkbenchPaneOverlay } from "@/lib/paneOverlay";
import {
  applyLiveSplitWidth,
  queryWorkbenchSplitPane,
} from "@/lib/paneDragLive";
import {
  ensureWindowFitsLayout,
  isWindowFitSuppressed,
} from "@/lib/windowFit";
import { isDesktopHost } from "@/lib/api";
import {
  bumpPaneSplitMotion,
  isPaneSplitMotionActive,
  runAfterPaneSplitMotion,
} from "@/lib/paneSplitMotion";

function initialLayout(): LayoutPrefs {
  const ua =
    typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
  const winChrome =
    ua.includes("win") ||
    (!ua.includes("mac") && typeof navigator !== "undefined");
  const clampOpts =
    typeof window !== "undefined"
      ? {
          windowControlsInset: winChrome ? WINDOW_CONTROLS_INSET : 0,
          viewportWidth: window.innerWidth,
        }
      : undefined;
  let base = loadLayout(localStorage, clampOpts);
  if (loadZenMode(localStorage)) {
    base = {
      ...base,
      sidebarCollapsed: true,
      asideCollapsed: true,
    };
  }
  if (typeof window !== "undefined" && isMirrorClient()) {
    return withMirrorPhoneDrawerDefault(base, {
      isMirror: true,
      viewportWidth: window.innerWidth,
    });
  }
  return base;
}

function persist(n: LayoutPrefs): LayoutPrefs {
  saveLayout(localStorage, n);
  return n;
}

export function useWorkbenchLayout(opts?: { onAsideClose?: () => void }) {
  const onAsideCloseRef = useRef(opts?.onAsideClose);
  onAsideCloseRef.current = opts?.onAsideClose;

  const windowControlsInset = usesCustomWindowChrome(detectAppPlatform())
    ? WINDOW_CONTROLS_INSET
    : 0;

  const [layout, setLayout] = useState(initialLayout);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const [zenMode, setZenModeState] = useState(() => loadZenMode(localStorage));
  const zenModeRef = useRef(zenMode);
  zenModeRef.current = zenMode;

  const [transcriptFilter, setTranscriptFilter] =
    useState<TranscriptFilterMode>(() => loadTranscriptFilterPref());

  const [phoneLayout, setPhoneLayout] = useState(() =>
    typeof window !== "undefined"
      ? isMirrorPhoneLayout({
          isMirror: isMirrorClient(),
          viewportWidth: window.innerWidth,
        })
      : false,
  );

  const [resizingAside, setResizingAside] = useState(false);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280,
  );

  const asideFitGenRef = useRef(0);
  const sidebarFitGenRef = useRef(0);
  const sidebarResizeStartRef = useRef<{ x: number; width: number } | null>(
    null,
  );
  const liveSidebarWidthRef = useRef(
    layout.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
  );
  const liveAsideWidthRef = useRef(
    Math.max(
      layout.asideWidth || 0,
      DEFAULT_LAYOUT.asideWidth,
      ASIDE_WIDTH_MIN,
    ),
  );

  const sidebarOpenW = layout.sidebarWidth || SIDEBAR_DEFAULT_WIDTH;
  const asideOpenW = Math.max(
    layout.asideWidth || 0,
    DEFAULT_LAYOUT.asideWidth,
    ASIDE_WIDTH_MIN,
  );
  const sidebarOverlay =
    !phoneLayout &&
    resolveWorkbenchPaneOverlay({
      viewportWidth,
      sidebarOpen: true,
      sidebarWidth: sidebarOpenW,
      asideOpen: !layout.asideCollapsed,
      asideWidth: asideOpenW,
    }).sidebarOverlay;

  const setZenModeEnabled = useCallback((enabled: boolean) => {
    if (zenModeRef.current === enabled) return;
    const cur = layoutRef.current;
    const prior = enabled ? null : loadZenModePrior(localStorage);
    const { layout: nextCollapse, nextPrior } = applyZenModeLayoutTransition(
      enabled,
      {
        sidebarCollapsed: cur.sidebarCollapsed,
        asideCollapsed: cur.asideCollapsed,
      },
      prior,
    );
    if (enabled) {
      if (nextPrior) saveZenModePrior(nextPrior, localStorage);
    } else {
      clearZenModePrior(localStorage);
    }
    setLayout((l) =>
      persist({
        ...l,
        sidebarCollapsed: nextCollapse.sidebarCollapsed,
        asideCollapsed: nextCollapse.asideCollapsed,
      }),
    );
    zenModeRef.current = enabled;
    setZenModeState(enabled);
    saveZenMode(enabled, localStorage);
  }, []);

  const setTranscriptFilterMode = useCallback((mode: TranscriptFilterMode) => {
    const next: TranscriptFilterMode =
      mode === "conversation" ? "conversation" : "all";
    setTranscriptFilter(next);
    saveTranscriptFilterPref(next);
  }, []);

  const toggleTranscriptFilter = useCallback(() => {
    setTranscriptFilterMode(
      transcriptFilter === "conversation" ? "all" : "conversation",
    );
  }, [transcriptFilter, setTranscriptFilterMode]);

  const asideClampOpts = useCallback((): {
    windowControlsInset: number;
    viewportWidth?: number;
    sidebarOccupiedWidth?: number;
  } => {
    const sidebarOpen =
      !layout.sidebarCollapsed && !phoneLayout && !sidebarOverlay;
    return {
      windowControlsInset,
      viewportWidth:
        typeof window !== "undefined" ? window.innerWidth : undefined,
      sidebarOccupiedWidth: sidebarOpen
        ? layout.sidebarWidth || SIDEBAR_DEFAULT_WIDTH
        : 0,
    };
  }, [
    windowControlsInset,
    layout.sidebarCollapsed,
    layout.sidebarWidth,
    phoneLayout,
    sidebarOverlay,
  ]);

  const fitWindowThenClampAside = useCallback(
    async (projected: {
      sidebarCollapsed: boolean;
      sidebarWidth: number;
      asideCollapsed: boolean;
      asideWidth: number;
    }) => {
      if (phoneLayout) return projected.asideWidth;
      const preferredAside = projected.asideCollapsed
        ? projected.asideWidth
        : Math.max(
            projected.asideWidth || 0,
            DEFAULT_LAYOUT.asideWidth,
            ASIDE_WIDTH_MIN,
          );
      const target = {
        ...projected,
        sidebarWidth: projected.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
        asideWidth: preferredAside,
      };
      await ensureWindowFitsLayout(target);
      if (projected.asideCollapsed) return projected.asideWidth;
      const opts = {
        ...asideClampOpts(),
        viewportWidth:
          typeof window !== "undefined" ? window.innerWidth : undefined,
        sidebarOccupiedWidth: projected.sidebarCollapsed
          ? 0
          : target.sidebarWidth,
      };
      return clampAsideWidth(preferredAside, opts);
    },
    [asideClampOpts, phoneLayout],
  );

  const openAsidePane = useCallback(() => {
    if (phoneLayout) {
      setLayout((l) => {
        if (!l.asideCollapsed) return l;
        return persist({ ...l, asideCollapsed: false });
      });
      return;
    }
    const cur = layoutRef.current;
    const preferredAside = Math.max(
      cur.asideWidth || 0,
      DEFAULT_LAYOUT.asideWidth,
      ASIDE_WIDTH_MIN,
    );
    const vw =
      typeof window !== "undefined" ? window.innerWidth : viewportWidth;
    const overlay = resolveWorkbenchPaneOverlay({
      viewportWidth: vw,
      sidebarOpen: !cur.sidebarCollapsed,
      sidebarWidth: cur.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
      asideOpen: true,
      asideWidth: preferredAside,
    });
    const syncWidth = overlay.asideOverlay
      ? preferredAside
      : clampAsideWidth(preferredAside, {
          ...asideClampOpts(),
          viewportWidth: vw,
          sidebarOccupiedWidth:
            cur.sidebarCollapsed || overlay.sidebarOverlay
              ? 0
              : cur.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
        });
    const paintWidth = overlay.asideOverlay
      ? preferredAside
      : syncWidth > 0
        ? syncWidth
        : Math.min(preferredAside, ASIDE_WIDTH_MIN);
    setLayout((l) => {
      if (!l.asideCollapsed && (l.asideWidth || 0) === paintWidth) return l;
      return persist({
        ...l,
        asideCollapsed: false,
        asideWidth: paintWidth,
      });
    });
    const projected = {
      sidebarCollapsed: cur.sidebarCollapsed,
      sidebarWidth: cur.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
      asideCollapsed: false as const,
      asideWidth: preferredAside,
    };
    if (overlay.asideOverlay) return;
    const fitGen = ++asideFitGenRef.current;
    void fitWindowThenClampAside(projected).then((width) => {
      if (asideFitGenRef.current !== fitGen) return;
      setLayout((l) => {
        if (l.asideCollapsed) return l;
        if (l.asideWidth === width) return l;
        if (isPaneSplitMotionActive()) bumpPaneSplitMotion();
        return persist({ ...l, asideWidth: width });
      });
    });
  }, [asideClampOpts, fitWindowThenClampAside, phoneLayout, viewportWidth]);

  const closeAsidePane = useCallback(() => {
    asideFitGenRef.current += 1;
    onAsideCloseRef.current?.();
    setLayout((l) => {
      if (l.asideCollapsed) return l;
      return persist({ ...l, asideCollapsed: true });
    });
  }, []);

  /** Persist aside collapsed without the user-close extras (plan abandon). */
  const collapseAsidePersisted = useCallback(() => {
    setLayout((l) => {
      if (l.asideCollapsed) return l;
      return persist({ ...l, asideCollapsed: true });
    });
  }, []);

  /** Secondary window chrome: collapse rails without writing main prefs. */
  const collapseChromeEphemeral = useCallback(() => {
    setLayout((l) => {
      if (l.sidebarCollapsed && l.asideCollapsed) return l;
      return { ...l, sidebarCollapsed: true, asideCollapsed: true };
    });
  }, []);

  const openSidebarPane = useCallback(() => {
    if (phoneLayout) {
      setLayout((l) => {
        if (!l.sidebarCollapsed) return l;
        return persist({ ...l, sidebarCollapsed: false });
      });
      return;
    }
    const cur = layoutRef.current;
    if (!cur.sidebarCollapsed) return;
    const vw =
      typeof window !== "undefined" ? window.innerWidth : viewportWidth;
    const asideW = Math.max(
      cur.asideWidth || 0,
      DEFAULT_LAYOUT.asideWidth,
      ASIDE_WIDTH_MIN,
    );
    const overlay = resolveWorkbenchPaneOverlay({
      viewportWidth: vw,
      sidebarOpen: true,
      sidebarWidth: cur.sidebarWidth || SIDEBAR_WIDTH_MIN,
      asideOpen: !cur.asideCollapsed,
      asideWidth: asideW,
    });
    const openWidth = clampSidebarWidth(cur.sidebarWidth || SIDEBAR_WIDTH_MIN, {
      viewportWidth: vw,
      asideOccupiedWidth:
        cur.asideCollapsed || overlay.asideOverlay ? 0 : cur.asideWidth || 0,
    });
    setLayout((l) => {
      if (!l.sidebarCollapsed && (l.sidebarWidth || 0) === openWidth) return l;
      return persist({
        ...l,
        sidebarCollapsed: false,
        sidebarWidth: openWidth,
      });
    });
    const projected = {
      sidebarCollapsed: false as const,
      sidebarWidth: openWidth,
      asideCollapsed: cur.asideCollapsed,
      asideWidth: cur.asideCollapsed
        ? cur.asideWidth
        : Math.max(cur.asideWidth || 0, DEFAULT_LAYOUT.asideWidth),
    };
    if (overlay.sidebarOverlay || overlay.asideOverlay) return;
    const fitGen = ++sidebarFitGenRef.current;
    void fitWindowThenClampAside(projected).then((width) => {
      if (sidebarFitGenRef.current !== fitGen) return;
      setLayout((l) => {
        if (l.sidebarCollapsed) return l;
        if (projected.asideCollapsed || l.asideWidth === width) return l;
        if (isPaneSplitMotionActive()) bumpPaneSplitMotion();
        return persist({ ...l, asideWidth: width });
      });
    });
  }, [fitWindowThenClampAside, phoneLayout, viewportWidth]);

  const closeSidebarPane = useCallback(() => {
    sidebarFitGenRef.current += 1;
    setLayout((l) => {
      if (l.sidebarCollapsed) return l;
      return persist({ ...l, sidebarCollapsed: true });
    });
  }, []);

  const closePhoneDrawer = closeSidebarPane;
  const openPhoneDrawer = useCallback(() => {
    setLayout((l) => {
      if (!l.sidebarCollapsed) return l;
      return persist({ ...l, sidebarCollapsed: false });
    });
  }, []);

  const beginSidebarResize = useCallback((clientX: number, width: number) => {
    sidebarResizeStartRef.current = { x: clientX, width };
    liveSidebarWidthRef.current = width;
    setResizingSidebar(true);
  }, []);

  const beginAsideResize = useCallback((width: number) => {
    liveAsideWidthRef.current = width;
    setResizingAside(true);
  }, []);

  const openAsidePaneRef = useRef(openAsidePane);
  openAsidePaneRef.current = openAsidePane;

  useEffect(() => {
    const onPref = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (detail === "all" || detail === "conversation") {
        setTranscriptFilter(detail);
      } else {
        setTranscriptFilter(loadTranscriptFilterPref());
      }
    };
    window.addEventListener(TRANSCRIPT_FILTER_CHANGE_EVENT, onPref);
    return () =>
      window.removeEventListener(TRANSCRIPT_FILTER_CHANGE_EVENT, onPref);
  }, []);

  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<boolean>).detail;
      const next =
        typeof detail === "boolean" ? detail : loadZenMode(localStorage);
      setZenModeEnabled(next);
    };
    window.addEventListener(ZEN_MODE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(ZEN_MODE_CHANGE_EVENT, onChange);
  }, [setZenModeEnabled]);

  useEffect(() => {
    if (!isMirrorClient()) {
      setPhoneLayout(false);
      return;
    }
    const sync = () => {
      setPhoneLayout(
        isMirrorPhoneLayout({
          isMirror: true,
          viewportWidth: window.innerWidth,
        }),
      );
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    const sync = () => setViewportWidth(window.innerWidth);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    if (phoneLayout) return;
    let resizeTimer: number | null = null;
    let cancelled = false;
    const applyResizeClamp = () => {
      if (cancelled || isWindowFitSuppressed()) return;
      if (runAfterPaneSplitMotion(applyResizeClamp)) return;
      const opts = asideClampOpts();
      setLayout((l) => {
        if (l.asideCollapsed) return l;
        const next = clampAsideWidth(l.asideWidth, opts);
        if (next === l.asideWidth) return l;
        return persist({ ...l, asideWidth: next });
      });
    };
    const onResize = () => {
      if (isWindowFitSuppressed()) return;
      if (resizeTimer != null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        applyResizeClamp();
      }, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      if (resizeTimer != null) window.clearTimeout(resizeTimer);
    };
  }, [asideClampOpts, phoneLayout]);

  useEffect(() => {
    if (phoneLayout || !isDesktopHost()) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      const l = layoutRef.current;
      if (l.asideCollapsed) return;
      const opts = {
        ...asideClampOpts(),
        viewportWidth:
          typeof window !== "undefined" ? window.innerWidth : undefined,
        sidebarOccupiedWidth: l.sidebarCollapsed
          ? 0
          : l.sidebarWidth || SIDEBAR_DEFAULT_WIDTH,
      };
      const width = clampAsideWidth(l.asideWidth, opts);
      if (width === l.asideWidth) return;
      setLayout((prev) => {
        if (prev.asideCollapsed || prev.asideWidth === width) return prev;
        return persist({ ...prev, asideWidth: width });
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only cold clamp
  }, [phoneLayout]);

  useEffect(() => {
    if (!resizingAside) return;
    const clampOpts = () => ({
      ...asideClampOpts(),
      viewportWidth: window.innerWidth,
    });
    const pane = queryWorkbenchSplitPane("aside");
    liveAsideWidthRef.current = clampAsideWidth(
      layoutRef.current.asideWidth,
      clampOpts(),
    );
    applyLiveSplitWidth(pane, liveAsideWidthRef.current);
    const onMove = (e: PointerEvent) => {
      if (isWindowFitSuppressed()) return;
      const desired = Math.round(window.innerWidth - e.clientX);
      const next = clampAsideWidth(desired, clampOpts());
      if (next === liveAsideWidthRef.current) return;
      liveAsideWidthRef.current = next;
      applyLiveSplitWidth(pane, next);
    };
    const onUp = () => {
      setResizingAside(false);
      const width = clampAsideWidth(liveAsideWidthRef.current, clampOpts());
      setLayout((l) =>
        persist({
          ...l,
          asideCollapsed: false,
          asideWidth: width,
        }),
      );
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [asideClampOpts, resizingAside]);

  useEffect(() => {
    if (!resizingSidebar) return;
    const clampOpts = () => {
      const cur = layoutRef.current;
      return {
        viewportWidth: window.innerWidth,
        asideOccupiedWidth: cur.asideCollapsed ? 0 : cur.asideWidth || 0,
      };
    };
    const endResizeChrome = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    const pane = queryWorkbenchSplitPane("sidebar");
    liveSidebarWidthRef.current =
      layoutRef.current.sidebarWidth || SIDEBAR_DEFAULT_WIDTH;
    applyLiveSplitWidth(pane, liveSidebarWidthRef.current);
    const applyCollapseLive = () => {
      const cur = layoutRef.current;
      const n = persist({
        ...cur,
        sidebarCollapsed: true,
        sidebarWidth: SIDEBAR_WIDTH_MIN,
      });
      setLayout(n);
      sidebarResizeStartRef.current = null;
      setResizingSidebar(false);
      endResizeChrome();
    };
    const onMove = (e: PointerEvent) => {
      if (isWindowFitSuppressed()) return;
      const start = sidebarResizeStartRef.current;
      if (!start) return;
      const desired = Math.round(start.width + (e.clientX - start.x));
      if (desired < SIDEBAR_WIDTH_MIN) {
        applyCollapseLive();
        return;
      }
      const next = clampSidebarDragWidth(desired, clampOpts());
      if (next === liveSidebarWidthRef.current) return;
      liveSidebarWidthRef.current = next;
      applyLiveSplitWidth(pane, next);
    };
    const onUp = () => {
      if (
        !sidebarResizeStartRef.current &&
        layoutRef.current.sidebarCollapsed
      ) {
        setResizingSidebar(false);
        endResizeChrome();
        return;
      }
      setResizingSidebar(false);
      sidebarResizeStartRef.current = null;
      const cur = layoutRef.current;
      if (cur.sidebarCollapsed) {
        endResizeChrome();
        return;
      }
      const resolved = resolveSidebarDragEnd(
        liveSidebarWidthRef.current || SIDEBAR_DEFAULT_WIDTH,
        clampOpts(),
      );
      const n =
        resolved.action === "collapse"
          ? persist({
              ...cur,
              sidebarCollapsed: true,
              sidebarWidth: resolved.sidebarWidth,
            })
          : persist({
              ...cur,
              sidebarCollapsed: false,
              sidebarWidth: resolved.sidebarWidth,
            });
      setLayout(n);
      endResizeChrome();
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizingSidebar]);

  useLayoutEffect(() => {
    if (resizingSidebar) {
      applyLiveSplitWidth(
        queryWorkbenchSplitPane("sidebar"),
        liveSidebarWidthRef.current,
      );
    }
    if (resizingAside) {
      applyLiveSplitWidth(
        queryWorkbenchSplitPane("aside"),
        liveAsideWidthRef.current,
      );
    }
  }, [resizingSidebar, resizingAside]);

  return {
    layout,
    layoutRef,
    zenMode,
    zenModeRef,
    setZenModeEnabled,
    transcriptFilter,
    setTranscriptFilterMode,
    toggleTranscriptFilter,
    phoneLayout,
    setPhoneLayout,
    viewportWidth,
    sidebarOpenW,
    asideOpenW,
    sidebarOverlay,
    resizingAside,
    resizingSidebar,
    openAsidePane,
    openAsidePaneRef,
    closeAsidePane,
    collapseAsidePersisted,
    collapseChromeEphemeral,
    openSidebarPane,
    closeSidebarPane,
    closePhoneDrawer,
    openPhoneDrawer,
    beginSidebarResize,
    beginAsideResize,
  };
}
