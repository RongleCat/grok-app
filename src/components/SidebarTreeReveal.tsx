/**
 * Keep a sidebar tree section mounted through its exit so expand/collapse
 * interpolates height. WKWebView only interpolates concrete inline px
 * (see treeReveal.ts) — CSS 0fr/1fr snaps.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useOpenPresence } from "@/lib/openPresence";
import { prefersReducedMotion } from "@/lib/paneSplitMotion";
import {
  applyTreeRevealSize,
  beginTreeRevealMotion,
  measureTreeRevealContent,
  shouldAnimateTreeReveal,
  TREE_REVEAL_MS,
  TREE_REVEAL_PRESENCE_MS,
  treeRevealCloseSteps,
  treeRevealSizeStyle,
  type TreeRevealSize,
} from "@/lib/treeReveal";

type SidebarTreeRevealProps = {
  open: boolean;
  className?: string;
  children: ReactNode;
};

function readReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return prefersReducedMotion(
    window.matchMedia("(prefers-reduced-motion: reduce)"),
  );
}

export function SidebarTreeReveal({
  open,
  className,
  children,
}: SidebarTreeRevealProps) {
  const presence = useOpenPresence(open, true, TREE_REVEAL_PRESENCE_MS);
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const firstCommitRef = useRef(true);
  const animateOpenRef = useRef(false);
  const animateCloseRef = useRef(false);
  const endMotionRef = useRef<(() => void) | null>(null);
  const [size, setSize] = useState<TreeRevealSize>(() => (open ? "auto" : 0));

  const stopMotion = () => {
    endMotionRef.current?.();
    endMotionRef.current = null;
  };

  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box) {
      // Collapsed first paint returns null — the next expand must animate.
      firstCommitRef.current = false;
      return;
    }

    const isFirstCommit = firstCommitRef.current;
    firstCommitRef.current = false;
    const reduced = readReducedMotion();
    const animate = shouldAnimateTreeReveal({
      isFirstCommit,
      reducedMotion: reduced,
    });
    const visualPx = Math.round(box.getBoundingClientRect().height);
    const contentPx = measureTreeRevealContent(inner);
    animateOpenRef.current = false;
    animateCloseRef.current = false;

    if (!animate) {
      const next: TreeRevealSize = open ? "auto" : 0;
      applyTreeRevealSize(box, next);
      setSize(next);
      return;
    }

    stopMotion();
    endMotionRef.current = beginTreeRevealMotion();
    box.dataset.treeRevealMotion = "1";

    if (open) {
      // Leave height at 0 for this paint. Promoting to px before paint
      // lets WKWebView skip the transition (same class of bug as 0fr/1fr).
      applyTreeRevealSize(box, 0);
      setSize(0);
      animateOpenRef.current = true;
      return;
    }

    // Leave height locked for this paint. auto→0 in one commit snaps.
    const { lockPx } = treeRevealCloseSteps(visualPx || contentPx);
    applyTreeRevealSize(box, lockPx);
    setSize(lockPx);
    animateCloseRef.current = true;
  }, [open, presence.mounted]);

  useEffect(() => {
    if (!presence.mounted) return;
    const box = boxRef.current;
    if (!box) return;
    let cancelled = false;

    const settle = (next: TreeRevealSize) => {
      if (cancelled) return;
      applyTreeRevealSize(box, next);
      setSize(next);
      delete box.dataset.treeRevealMotion;
      stopMotion();
    };

    if (open && animateOpenRef.current) {
      const id = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (cancelled) return;
          animateOpenRef.current = false;
          const h = measureTreeRevealContent(innerRef.current);
          if (h <= 0) {
            // Stay at 0 and retry once — snapping to auto flashes the list.
            const retry = window.requestAnimationFrame(() => {
              const again = measureTreeRevealContent(innerRef.current);
              if (again <= 0) {
                settle("auto");
                return;
              }
              applyTreeRevealSize(box, again);
              setSize(again);
            });
            if (cancelled) window.cancelAnimationFrame(retry);
            return;
          }
          applyTreeRevealSize(box, h);
          setSize(h);
        });
      });
      const t = window.setTimeout(() => settle("auto"), TREE_REVEAL_MS + 32);
      return () => {
        cancelled = true;
        window.cancelAnimationFrame(id);
        window.clearTimeout(t);
      };
    }

    if (!open && animateCloseRef.current) {
      const id = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (cancelled) return;
          animateCloseRef.current = false;
          applyTreeRevealSize(box, 0);
          setSize(0);
        });
      });
      const t = window.setTimeout(() => settle(0), TREE_REVEAL_MS + 32);
      return () => {
        cancelled = true;
        window.cancelAnimationFrame(id);
        window.clearTimeout(t);
      };
    }
  }, [open, presence.mounted]);

  useEffect(() => stopMotion, []);

  if (!presence.mounted) return null;

  return (
    <div
      ref={boxRef}
      className={
        "tree-reveal" +
        (!open ? " is-closing" : "") +
        (className ? ` ${className}` : "")
      }
      style={size === "auto" ? undefined : treeRevealSizeStyle(size)}
      data-testid="tree-reveal"
      aria-hidden={!open || undefined}
      inert={!open || undefined}
    >
      <div ref={innerRef} className="tree-reveal__inner">
        {children}
      </div>
    </div>
  );
}
