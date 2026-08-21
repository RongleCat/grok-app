/**
 * Self-drawn window chrome for Windows / Linux (frameless) and other
 * non-mac platforms when decorations are disabled. macOS uses Overlay
 * traffic lights.
 */
import { useCallback, useEffect, useState } from "react";
import {
  IconClose,
  IconMaximize,
  IconMinimize,
  IconRestore,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { detectAppPlatform } from "@/lib/appPlatform";
import {
  CAPTION_BUTTON_TOGGLE_DEFER_MS,
  isFakeMaximized,
  scheduleCaptionButtonToggle,
  toggleMaximizeFromTitlebar,
  toggleMaximizeReliable,
} from "@/lib/windowChrome";

export {
  tauriDragRegion,
  toggleMaximizeFromTitlebar,
} from "@/lib/windowChrome";

type Props = {
  visible: boolean;
  labels: {
    minimize: string;
    maximize: string;
    restore: string;
    close: string;
  };
};

export function WindowControls({ visible, labels }: Props) {
  const [maximized, setMaximized] = useState(false);

  const refreshMaximized = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const os = await getCurrentWindow().isMaximized();
      setMaximized(os || isFakeMaximized());
    } catch {
      /* browser / no window API */
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void refreshMaximized();
    let unlistenResize: (() => void) | undefined;
    let unlistenMoved: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const w = getCurrentWindow();
        const sync = () => {
          void refreshMaximized();
        };
        unlistenResize = await w.onResized(sync);
        try {
          unlistenMoved = await w.onMoved(sync);
        } catch {
          /* older API */
        }
        if (cancelled) {
          unlistenResize?.();
          unlistenMoved?.();
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      unlistenResize?.();
      unlistenMoved?.();
    };
  }, [visible, refreshMaximized]);

  const winChrome = async (action: "minimize" | "toggleMaximize" | "close") => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      if (action === "minimize") await w.minimize();
      if (action === "toggleMaximize") {
        setMaximized(await toggleMaximizeReliable());
      }
      if (action === "close") await w.close();
    } catch {
      /* ignore */
    }
  };

  if (!visible) return null;

  const stopChromePointer = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
  };

  return (
    <>
      <div className="window-edge-n" aria-hidden="true" />
      <div
        className="window-controls"
        data-tauri-drag-region={undefined}
        onPointerDown={stopChromePointer}
      >
        <Tip label={labels.minimize}>
        <button
          type="button"
          className="window-controls__btn"
          aria-label={labels.minimize}
          onPointerDown={stopChromePointer}
          onClick={(e) => {
            e.stopPropagation();
            void winChrome("minimize");
          }}
        >
          <IconMinimize size={14} />
        </button>
        </Tip>
        <Tip label={maximized ? labels.restore : labels.maximize}>
        <button
          type="button"
          className="window-controls__btn"
          aria-label={maximized ? labels.restore : labels.maximize}
          onPointerDown={stopChromePointer}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            scheduleCaptionButtonToggle(() => {
              void winChrome("toggleMaximize");
            }, CAPTION_BUTTON_TOGGLE_DEFER_MS);
          }}
        >
          {maximized ? <IconRestore size={14} /> : <IconMaximize size={14} />}
        </button>
        </Tip>
        <Tip label={labels.close}>
        <button
          type="button"
          className="window-controls__btn window-controls__btn--close"
          aria-label={labels.close}
          onPointerDown={stopChromePointer}
          onClick={(e) => {
            e.stopPropagation();
            void winChrome("close");
          }}
        >
          <IconClose size={14} />
        </button>
        </Tip>
      </div>
    </>
  );
}

/** True when the event target is chrome that should not start window chrome actions. */
export function isTitlebarInteractiveTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  return !!el.closest(
    "button, a, input, textarea, select, [role='button'], [role='tab'], [role='menuitem'], [role='option'], [contenteditable='true']",
  );
}

/**
 * Props for titlebar / drag strips: maximize on double-click even when
 * `-webkit-app-region: drag` swallows the synthetic dblclick (mac Overlay).
 * Pair with `data-tauri-drag-region` for native drag.
 */
export function titlebarMaximizeHandlers(opts?: {
  enabled?: boolean;
}): {
  onDoubleClick: (e: { target: EventTarget | null; button?: number }) => void;
  onMouseDown: (e: {
    target: EventTarget | null;
    button: number;
    detail: number;
    preventDefault: () => void;
  }) => void;
} {
  // Windows: compositor caption dblclick maximizes (mouse is up). A JS
  // toggle on mousedown(detail=2) races Aero drag-to-restore.
  const enabled =
    opts?.enabled !== false && detectAppPlatform() !== "win";
  return {
    onDoubleClick: (e) => {
      if (!enabled) return;
      if (isTitlebarInteractiveTarget(e.target)) return;
      void toggleMaximizeFromTitlebar();
    },
    onMouseDown: (e) => {
      if (!enabled) return;
      if (e.button !== 0 || e.detail < 2) return;
      if (isTitlebarInteractiveTarget(e.target)) return;
      // Second click of a double-click pair.
      e.preventDefault();
      void toggleMaximizeFromTitlebar();
    },
  };
}
