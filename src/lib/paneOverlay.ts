/**
 * When a pane plus the chat floor would not fit, overlay it instead of
 * interpolating flex width (and growing the OS window).
 */

import { MAIN_CHAT_MIN_WIDTH } from "@/lib/layout";

export type WorkbenchPaneOverlay = {
  sidebarOverlay: boolean;
  asideOverlay: boolean;
};

export function resolveWorkbenchPaneOverlay(opts: {
  viewportWidth: number;
  sidebarOpen: boolean;
  sidebarWidth: number;
  asideOpen: boolean;
  asideWidth: number;
  chatMin?: number;
}): WorkbenchPaneOverlay {
  const vw = opts.viewportWidth;
  const chatMin = opts.chatMin ?? MAIN_CHAT_MIN_WIDTH;
  if (!(vw > 0) || !Number.isFinite(vw) || !Number.isFinite(chatMin)) {
    return { sidebarOverlay: false, asideOverlay: false };
  }
  const side = opts.sidebarOpen ? Math.max(0, opts.sidebarWidth) : 0;
  const aside = opts.asideOpen ? Math.max(0, opts.asideWidth) : 0;
  if (side + aside + chatMin <= vw) {
    return { sidebarOverlay: false, asideOverlay: false };
  }
  if (side > 0 && aside > 0) {
    if (side + chatMin <= vw) {
      return { sidebarOverlay: false, asideOverlay: true };
    }
    if (aside + chatMin <= vw) {
      return { sidebarOverlay: true, asideOverlay: false };
    }
    return { sidebarOverlay: true, asideOverlay: true };
  }
  return {
    sidebarOverlay: side > 0,
    asideOverlay: aside > 0,
  };
}
