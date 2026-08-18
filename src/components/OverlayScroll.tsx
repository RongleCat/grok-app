/**
 * Custom overlay scrollbar: native bars fully hidden; floating thumb only
 * (no track). Appears on hover / while scrolling when content overflows.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type UIEvent,
} from "react";
import { runAfterPaneSplitMotion } from "@/lib/paneSplitMotion";

type OverlayScrollProps = {
  children: ReactNode;
  className?: string;
  /** Extra class on the scrolling viewport (keeps layout classes like messages). */
  viewportClassName?: string;
  style?: CSSProperties;
  /** Forward scroll events */
  onScroll?: (e: UIEvent<HTMLDivElement>) => void;
  /** Optional external ref to the scrolling viewport element. */
  viewportRef?: Ref<HTMLDivElement | null>;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else (ref as { current: T }).current = value;
}

export function OverlayScroll({
  children,
  className = "",
  viewportClassName = "",
  style,
  onScroll,
  viewportRef: viewportRefProp,
}: OverlayScrollProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const hideTimer = useRef<number | null>(null);

  const setViewportNode = useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef.current = node;
      assignRef(viewportRefProp, node);
    },
    [viewportRefProp],
  );
  const [thumb, setThumb] = useState({
    top: 0,
    height: 0,
    needed: false,
  });
  const [active, setActive] = useState(false);

  const measure = useCallback(() => {
    if (runAfterPaneSplitMotion(measure)) return;
    const el = viewportRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const needed = scrollHeight > clientHeight + 1;
    if (!needed) {
      setThumb((t) => (t.needed ? { top: 0, height: 0, needed: false } : t));
      return;
    }
    const inset = 6; // top/bottom padding inside rail
    const track = Math.max(clientHeight - inset * 2, 1);
    const ratio = clientHeight / scrollHeight;
    const height = Math.max(28, Math.round(track * ratio));
    const maxTop = track - height;
    const top =
      maxTop <= 0
        ? inset
        : Math.round((scrollTop / (scrollHeight - clientHeight)) * maxTop) +
          inset;
    setThumb({ top, height, needed: true });
  }, []);

  useEffect(() => {
    measure();
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, children]);

  const flash = () => {
    setActive(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setActive(false), 900);
  };

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    measure();
    flash();
    onScroll?.(e);
  };

  return (
    <div
      className={
        "overlay-scroll" +
        (active ? " is-scrolling" : "") +
        (className ? ` ${className}` : "")
      }
      style={style}
      onMouseEnter={() => {
        measure();
        setActive(true);
      }}
      onMouseLeave={() => {
        if (hideTimer.current) window.clearTimeout(hideTimer.current);
        setActive(false);
      }}
    >
      <div
        ref={setViewportNode}
        className={
          "overlay-scroll__viewport" +
          (viewportClassName ? ` ${viewportClassName}` : "")
        }
        onScroll={handleScroll}
      >
        {children}
      </div>
      {thumb.needed && (
        <div className="overlay-scroll__rail" aria-hidden>
          <div
            className="overlay-scroll__thumb"
            style={{ top: thumb.top, height: thumb.height }}
          />
        </div>
      )}
    </div>
  );
}
