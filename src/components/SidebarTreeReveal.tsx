/**
 * Keep a sidebar tree section mounted through its exit so expand/collapse
 * interpolates height. WKWebView only interpolates concrete inline px
 * (see treeReveal.ts). Stay on px after expand — settling to `auto` makes
 * the next close an auto→0 snap.
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
  TREE_REVEAL_CLOSE_MS,
  TREE_REVEAL_MS,
  TREE_REVEAL_PRESENCE_MS,
  treeRevealCloseSteps,
  treeRevealSizeStyle,
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
  const [size, setSize] = useState<number | null>(() => (open ? null : 0));

  const stopMotion = () => {
    endMotionRef.current?.();
    endMotionRef.current = null;
  };

  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box) {
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
      const next = open ? contentPx || visualPx : 0;
      applyTreeRevealSize(box, next);
      setSize(next);
      return;
    }

    stopMotion();
    endMotionRef.current = beginTreeRevealMotion();
    box.dataset.treeRevealMotion = "1";

    if (open) {
      applyTreeRevealSize(box, 0);
      setSize(0);
      animateOpenRef.current = true;
      return;
    }

    const { lockPx } = treeRevealCloseSteps(
      visualPx || contentPx || size || 0,
    );
    applyTreeRevealSize(box, lockPx);
    setSize(lockPx);
    animateCloseRef.current = true;
  }, [open, presence.mounted]);

  useEffect(() => {
    if (!presence.mounted) return;
    const box = boxRef.current;
    if (!box) return;
    let cancelled = false;

    const finish = (next: number) => {
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
          applyTreeRevealSize(box, h);
          setSize(h);
        });
      });
      const t = window.setTimeout(() => {
        const h = measureTreeRevealContent(innerRef.current);
        finish(h);
      }, TREE_REVEAL_MS + 32);
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
      const t = window.setTimeout(() => finish(0), TREE_REVEAL_CLOSE_MS + 32);
      return () => {
        cancelled = true;
        window.cancelAnimationFrame(id);
        window.clearTimeout(t);
      };
    }
  }, [open, presence.mounted]);

  useEffect(() => {
    if (!open || !presence.mounted) return;
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    const ro = new ResizeObserver(() => {
      if (box.dataset.treeRevealMotion) return;
      const h = measureTreeRevealContent(inner);
      if (h <= 0 || h === Math.round(box.getBoundingClientRect().height)) return;
      const prev = box.style.transition;
      box.style.transition = "none";
      applyTreeRevealSize(box, h);
      setSize(h);
      void box.getBoundingClientRect();
      box.style.transition = prev;
    });
    ro.observe(inner);
    return () => ro.disconnect();
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
      style={size == null ? undefined : treeRevealSizeStyle(size)}
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
