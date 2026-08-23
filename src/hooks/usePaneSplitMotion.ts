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
}): { paneMotionClass: string } {
  const [, setEpoch] = useState(0);
  const keyRef = useRef<string | null>(null);
  const tokenRef = useRef(0);
  const releaseRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<number | null>(null);

  const key = `${opts.sidebarCollapsed}:${opts.asideCollapsed}`;
  if (keyRef.current === null) {
    keyRef.current = key;
  } else if (keyRef.current !== key) {
    const colon = keyRef.current.indexOf(":");
    const sidebarChanged =
      keyRef.current.slice(0, colon) !== String(opts.sidebarCollapsed);
    const asideChanged =
      keyRef.current.slice(colon + 1) !== String(opts.asideCollapsed);
    const sidebarWidthChanged = sidebarChanged && !opts.sidebarOverlay;
    const asideOverlayChanged = asideChanged && !!opts.asideOverlay;
    keyRef.current = key;
    if (
      !opts.phoneLayout &&
      (sidebarWidthChanged || asideOverlayChanged) &&
      shouldStartPaneSplitMotion({
        reducedMotion: false,
        isFirstCommit: false,
        collapsedChanged: true,
      })
    ) {
      if (tokenRef.current) endPaneSplitMotion(tokenRef.current);
      tokenRef.current = beginPaneSplitMotion({
        cover: asideOverlayChanged,
        width: sidebarWidthChanged,
        sidebar: sidebarWidthChanged,
        aside: false,
      });
    }
  }

  useLayoutEffect(() => {
    const token = tokenRef.current;
    if (!token) return;

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
      if (!t.classList.contains("sidebar") && !t.classList.contains("aside")) {
        return;
      }
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
  ]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      releaseRef.current?.();
      releaseRef.current = null;
      if (tokenRef.current) endPaneSplitMotion(tokenRef.current);
    };
  }, []);

  const classes: string[] = [];
  if (isPaneSplitWidthMotionActive()) classes.push(PANE_SPLIT_MOTION_CLASS);
  if (isPaneSplitSidebarMotionActive()) {
    classes.push(PANE_SPLIT_SIDEBAR_MOTION_CLASS);
  }
  if (isPaneSplitAsideMotionActive()) classes.push(PANE_SPLIT_ASIDE_MOTION_CLASS);
  return { paneMotionClass: classes.length ? ` ${classes.join(" ")}` : "" };
}
