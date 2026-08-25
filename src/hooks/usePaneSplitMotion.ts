/**
 * Cover native child Webviews while aside width interpolates.
 * Width itself is the React inline style (0 vs open px) + CSS transition —
 * the same property drag mutates. Motion class is applied in the same render
 * as the size change so overflow/cover do not lag one frame.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { acquireNativeWebviewCover } from "@/lib/nativeWebviewCover";
import {
  PANE_SPLIT_ASIDE_MOTION_CLASS,
  PANE_SPLIT_MOTION_CLASS,
  PANE_SPLIT_MOTION_TIMEOUT_MS,
  PANE_SPLIT_SIDEBAR_MOTION_CLASS,
  beginPaneSplitMotion,
  endPaneSplitMotion,
  isPaneSplitAsideMotionActive,
  isPaneSplitCoverActive,
  isPaneSplitSidebarMotionActive,
  isPaneSplitWidthMotionActive,
  shouldStartPaneSplitMotion,
  subscribePaneSplitMotionBump,
} from "@/lib/paneSplitMotion";

export function usePaneSplitMotion(opts: {
  sidebarCollapsed: boolean;
  asideCollapsed: boolean;
  phoneLayout?: boolean;
  /** Left pane is an overlay drawer — its transform already owns the motion. */
  sidebarOverlay?: boolean;
  /** Right pane is an overlay drawer — cover native webviews during transform. */
  asideOverlay?: boolean;
  /** Right pane participates in the workbench width split. */
  asideInFlow: boolean;
  /** Right pane occupies all space not used by the left sidebar. */
  sideExpanded: boolean;
}): { paneMotionClass: string } {
  const [, setEpoch] = useState(0);
  const keyRef = useRef<string | null>(null);
  const asideOverlayRef = useRef(Boolean(opts.asideOverlay));
  const asideInFlowRef = useRef(opts.asideInFlow);
  const sideExpandedRef = useRef(opts.sideExpanded);
  const sideExpandMotionRef = useRef(false);
  const tokenRef = useRef(0);
  const releaseRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<number | null>(null);

  const key = `${opts.sidebarCollapsed}:${opts.asideCollapsed}`;
  const asideOverlay = Boolean(opts.asideOverlay);
  const asideOverlayModeChanged =
    !opts.asideCollapsed && asideOverlayRef.current !== asideOverlay;
  const asideOverlayMotionChanged =
    asideOverlayModeChanged && (asideOverlay || opts.asideInFlow);
  const sideExpandedChanged = sideExpandedRef.current !== opts.sideExpanded;
  if (keyRef.current === null) {
    keyRef.current = key;
  } else if (
    keyRef.current !== key ||
    asideOverlayMotionChanged ||
    sideExpandedChanged
  ) {
    const colon = keyRef.current.indexOf(":");
    const sidebarChanged =
      keyRef.current.slice(0, colon) !== String(opts.sidebarCollapsed);
    const asideChanged =
      keyRef.current.slice(colon + 1) !== String(opts.asideCollapsed);
    const sidebarWidthChanged = sidebarChanged && !opts.sidebarOverlay;
    const asideWidthChanged =
      sideExpandedChanged ||
      (asideChanged && opts.asideInFlow && asideInFlowRef.current);
    const asideOverlayChanged =
      asideChanged &&
      (asideOverlay || opts.asideInFlow) &&
      (asideOverlayRef.current || asideOverlay);
    const coverChanged =
      asideWidthChanged || asideOverlayChanged || asideOverlayMotionChanged;
    keyRef.current = key;
    if (
      !opts.phoneLayout &&
      (sidebarWidthChanged || coverChanged) &&
      shouldStartPaneSplitMotion({
        reducedMotion: false,
        isFirstCommit: false,
        collapsedChanged: true,
      })
    ) {
      if (tokenRef.current) endPaneSplitMotion(tokenRef.current);
      if (sideExpandedChanged) sideExpandMotionRef.current = true;
      tokenRef.current = beginPaneSplitMotion({
        cover: coverChanged,
        width: sidebarWidthChanged || asideWidthChanged,
        sidebar: sidebarWidthChanged,
        aside: asideWidthChanged,
      });
    }
  }
  asideOverlayRef.current = asideOverlay;
  asideInFlowRef.current = opts.asideInFlow;
  sideExpandedRef.current = opts.sideExpanded;

  useLayoutEffect(() => {
    const token = tokenRef.current;
    if (!token) {
      if (releaseRef.current && !isPaneSplitCoverActive()) {
        releaseRef.current();
        releaseRef.current = null;
      }
      return;
    }
    const finishOnSidebarWidth = isPaneSplitSidebarMotionActive();
    const finishOnAsideWidth = isPaneSplitAsideMotionActive();
    const pendingWidthPanes = new Set<"sidebar" | "aside">();
    if (finishOnSidebarWidth) pendingWidthPanes.add("sidebar");
    if (finishOnAsideWidth) pendingWidthPanes.add("aside");

    if (isPaneSplitCoverActive() && !releaseRef.current) {
      releaseRef.current = acquireNativeWebviewCover();
    } else if (!isPaneSplitCoverActive() && releaseRef.current) {
      releaseRef.current();
      releaseRef.current = null;
    }

    const finish = () => {
      if (tokenRef.current !== token) return;
      releaseRef.current?.();
      releaseRef.current = null;
      endPaneSplitMotion(token);
      tokenRef.current = 0;
      sideExpandMotionRef.current = false;
      setEpoch((n) => n + 1);
    };

    const arm = () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(finish, PANE_SPLIT_MOTION_TIMEOUT_MS);
    };
    arm();

    const onEnd = (e: TransitionEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (e.propertyName !== "width") return;
      const pane = t.classList.contains("sidebar")
        ? "sidebar"
        : t.classList.contains("aside")
          ? "aside"
          : null;
      if (!pane || !pendingWidthPanes.delete(pane)) return;
      if (pendingWidthPanes.size) return;
      finish();
    };
    document.addEventListener("transitionend", onEnd);
    const unsubBump = subscribePaneSplitMotionBump(arm);
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      document.removeEventListener("transitionend", onEnd);
      unsubBump();
    };
  }, [
    opts.sidebarCollapsed,
    opts.asideCollapsed,
    opts.phoneLayout,
    opts.sidebarOverlay,
    opts.asideOverlay,
    opts.asideInFlow,
    opts.sideExpanded,
  ]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      releaseRef.current?.();
      releaseRef.current = null;
      sideExpandMotionRef.current = false;
      if (tokenRef.current) endPaneSplitMotion(tokenRef.current);
    };
  }, []);

  const classes: string[] = [];
  if (isPaneSplitWidthMotionActive()) classes.push(PANE_SPLIT_MOTION_CLASS);
  if (isPaneSplitSidebarMotionActive()) {
    classes.push(PANE_SPLIT_SIDEBAR_MOTION_CLASS);
  }
  if (isPaneSplitAsideMotionActive()) classes.push(PANE_SPLIT_ASIDE_MOTION_CLASS);
  if (sideExpandMotionRef.current && isPaneSplitAsideMotionActive()) {
    classes.push("workbench--side-expand-motion");
  }
  return { paneMotionClass: classes.length ? ` ${classes.join(" ")}` : "" };
}
