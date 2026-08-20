/**
 * Workbench pane layout + zen + transcript filter + phone chrome flag.
 * Extracted from AppWorkbench (P1). Resize / open-aside stay in the shell.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  WINDOW_CONTROLS_INSET,
  isMirrorPhoneLayout,
  loadLayout,
  saveLayout,
  withMirrorPhoneDrawerDefault,
  type LayoutPrefs,
} from "@/lib/layout";
import { isMirrorClient } from "@/lib/mirrorTransport";
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

export function useWorkbenchLayout() {
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
    setLayout((l) => {
      const n = {
        ...l,
        sidebarCollapsed: nextCollapse.sidebarCollapsed,
        asideCollapsed: nextCollapse.asideCollapsed,
      };
      saveLayout(localStorage, n);
      return n;
    });
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

  return {
    layout,
    setLayout,
    layoutRef,
    zenMode,
    zenModeRef,
    setZenModeEnabled,
    transcriptFilter,
    setTranscriptFilterMode,
    toggleTranscriptFilter,
    phoneLayout,
    setPhoneLayout,
  };
}
