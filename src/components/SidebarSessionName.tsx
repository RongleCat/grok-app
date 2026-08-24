import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

type Props = {
  title: string;
};

/** Gap between duplicated title copies in the seamless loop (px). */
const MARQUEE_GAP_PX = 28;

/**
 * Sidebar session title: ellipsis at rest; on row hover, if text overflows
 * (including space reserved for the action buttons), marquee-scroll left continuously
 * (one-way seamless loop — never reverse).
 */
export function SidebarSessionName({ title }: Props) {
  const outerRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [loopPx, setLoopPx] = useState(0);
  const [scrollable, setScrollable] = useState(false);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const measure = measureRef.current;
    if (!outer || !measure) return;

    const run = () => {
      const contentW = measure.scrollWidth;
      const visible = Math.max(8, outer.clientWidth);
      const overflow = contentW - visible;
      const needsScroll = overflow > 2;
      setScrollable(needsScroll);
      // Seamless loop distance = one copy + gap (second copy aligns at 0).
      setLoopPx(needsScroll ? Math.ceil(contentW + MARQUEE_GAP_PX) : 0);
    };

    run();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(run);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [title]);

  return (
    <span
      ref={outerRef}
      className={
        "tree-l3__name" + (scrollable ? " tree-l3__name--scrollable" : "")
      }
      style={
        scrollable
          ? ({
              "--marquee-shift": `-${loopPx}px`,
              "--marquee-gap": `${MARQUEE_GAP_PX}px`,
            } as CSSProperties)
          : undefined
      }
    >
      {/* Off-flow natural-width probe (ellipsis would clamp scrollWidth). */}
      <span ref={measureRef} className="tree-l3__name-measure" aria-hidden>
        {title}
      </span>
      <span className="tree-l3__name-text">
        <span className="tree-l3__name-seg">{title}</span>
        {/* Second copy only used while marquee runs (shown via CSS on hover). */}
        {scrollable ? (
          <span className="tree-l3__name-loop" aria-hidden>
            <span className="tree-l3__name-gap" />
            <span className="tree-l3__name-seg">{title}</span>
          </span>
        ) : null}
      </span>
    </span>
  );
}
