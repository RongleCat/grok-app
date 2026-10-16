import { detectAppPlatform } from "@/lib/appPlatform";

let restoring = false;

/**
 * WebView2 can keep DOM focus while Windows TSF loses the renderer's IME
 * context after selecting transcript text or moving between webview children.
 * Reassert native webview focus before the next composition begins.
 */
export function restoreWindowsImeFocus(): void {
  if (
    typeof window === "undefined" ||
    detectAppPlatform() !== "win" ||
    !("__TAURI_INTERNALS__" in window) ||
    restoring
  ) {
    return;
  }
  restoring = true;
  void import("@tauri-apps/api/webview")
    .then(({ getCurrentWebview }) => {
      if (document.hasFocus()) return getCurrentWebview().setFocus();
    })
    .catch(() => {
      // A failed native focus attempt must not interrupt typing.
    })
    .finally(() => {
      restoring = false;
    });
}
