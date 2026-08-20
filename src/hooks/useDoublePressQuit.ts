/**
 * Window-capture Ctrl+Q: first press toasts, second within the window quits.
 * Runs on `window` so it beats the document-level catalog handler.
 */

import { useEffect, useRef } from "react";
import {
  nextQuitPress,
  shouldConsumeQuitShortcut,
} from "@/lib/doublePressQuit";
import { isShortcutRecordingActive } from "@/lib/shortcutRemap";

export function useDoublePressQuit(opts: {
  enabled: boolean;
  onArm: () => void;
  onQuit: () => void;
}): void {
  const onArmRef = useRef(opts.onArm);
  const onQuitRef = useRef(opts.onQuit);
  onArmRef.current = opts.onArm;
  onQuitRef.current = opts.onQuit;
  const armedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!opts.enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        !shouldConsumeQuitShortcut({
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          isComposing: e.isComposing,
          recordingShortcut: isShortcutRecordingActive(),
          target: e.target,
        })
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const next = nextQuitPress(Date.now(), armedAtRef.current);
      armedAtRef.current = next.armedAt;
      if (next.action === "arm") onArmRef.current();
      else onQuitRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [opts.enabled]);
}
