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
import { useOpenPresence, OPEN_PRESENCE_MS } from "@/lib/openPresence";
import { prefersReducedMotion } from "@/lib/paneSplitMotion";
import {
  applyTreeRevealSize,
  shouldAnimateTreeReveal,
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
  const presence = useOpenPresence(open, true, OPEN_PRESENCE_MS);
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const firstCommitRef = useRef(true);
  const animateOpenRef = useRef(false);
  const [size, setSize] = useState<TreeRevealSize>(() => (open ? "auto" : 0));

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
    const contentPx = inner?.scrollHeight ?? 0;
    animateOpenRef.current = false;

    if (!animate) {
      const next: TreeRevealSize = open ? "auto" : 0;
      applyTreeRevealSize(box, next);
      setSize(next);
      return;
    }

    if (open) {
      // Leave height at 0 for this paint. Promoting to px before paint
      // lets WKWebView skip the transition (same class of bug as 0fr/1fr).
      applyTreeRevealSize(box, 0);
      setSize(0);
      animateOpenRef.current = true;
      return;
    }

    const locked = contentPx || Math.round(box.getBoundingClientRect().height);
    applyTreeRevealSize(box, locked);
    void box.getBoundingClientRect();
    applyTreeRevealSize(box, 0);
    setSize(0);
  }, [open, presence.mounted]);

  useEffect(() => {
    if (!open || !presence.mounted || !animateOpenRef.current) return;
    const box = boxRef.current;
    if (!box) return;
    let cancelled = false;
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (cancelled) return;
        animateOpenRef.current = false;
        const h = innerRef.current?.scrollHeight ?? 0;
        if (h <= 0) {
          applyTreeRevealSize(box, "auto");
          setSize("auto");
          return;
        }
        applyTreeRevealSize(box, h);
        setSize(h);
      });
    });
    const t = window.setTimeout(() => {
      if (cancelled) return;
      applyTreeRevealSize(box, "auto");
      setSize("auto");
    }, OPEN_PRESENCE_MS + 32);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(id);
      window.clearTimeout(t);
    };
  }, [open, presence.mounted]);

  if (!presence.mounted) return null;

  return (
    <div
      ref={boxRef}
      className={"tree-reveal" + (className ? ` ${className}` : "")}
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
