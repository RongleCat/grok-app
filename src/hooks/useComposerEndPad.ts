import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  measureComposerEndPadPx,
  nextComposerFloatPad,
} from "@/lib/composerEndPad";

/**
 * Measure the floating composer against the chat stage and write the pad.
 * Orchestration only enables this while the main pane is chat.
 */
export function useComposerEndPad(
  wrapRef: RefObject<HTMLElement | null>,
  setPad: Dispatch<SetStateAction<number>>,
  enabled: boolean,
  layoutKey: string,
): void {
  useEffect(() => {
    if (!enabled) return;
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const h = measureComposerEndPadPx(el);
      if (h == null) return;
      setPad((prev) => nextComposerFloatPad(prev, h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, layoutKey, setPad, wrapRef]);
}
