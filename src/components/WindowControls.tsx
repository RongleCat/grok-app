/**
 * Self-drawn window chrome for Windows / Linux (frameless) and other
 * non-mac platforms when decorations are disabled. macOS uses Overlay
 * traffic lights.
 */
import { useCallback, useEffect, useState } from "react";
import { IconClose, IconMaximize, IconMinimize } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import {
  isFakeMaximized,
  toggleMaximizeFromTitlebar,
  toggleMaximizeReliable,
} from "@/lib/windowChrome";

export { toggleMaximizeFromTitlebar } from "@/lib/windowChrome";

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
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const w = getCurrentWindow();
        unlisten = await w.onResized(() => {
          void refreshMaximized();
        });
        if (cancelled && unlisten) unlisten();
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
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

  return (
    <div className="window-controls" data-tauri-drag-region={undefined}>
      <Tip label={labels.minimize}>
        <button
          type="button"
          className="window-controls__btn"
          aria-label={labels.minimize}
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
          onClick={(e) => {
            e.stopPropagation();
            void winChrome("toggleMaximize");
          }}
        >
          <IconMaximize size={14} />
        </button>
      </Tip>
      <Tip label={labels.close}>
        <button
          type="button"
          className="window-controls__btn window-controls__btn--close"
          aria-label={labels.close}
          onClick={(e) => {
            e.stopPropagation();
            void winChrome("close");
          }}
        >
          <IconClose size={14} />
        </button>
      </Tip>
    </div>
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
  const enabled = opts?.enabled !== false;
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
