(function () {
  try {
    var restore = window.__GROK_APP_ALBUM_SCROLL_RESTORE__;
    delete window.__GROK_APP_ALBUM_SCROLL_RESTORE__;
    if (!restore || !restore.root) return "empty";
    var root = restore.root;
    var top = Number(restore.top || 0);
    if (!Number.isFinite(top) || top < 0) top = 0;
    if (typeof root.scrollTo === "function") {
      root.scrollTo({ top: top, left: 0, behavior: "auto" });
    } else {
      root.scrollTop = top;
    }
    return "ok";
  } catch (_) {
    try { delete window.__GROK_APP_ALBUM_SCROLL_RESTORE__; } catch (_) {}
    return "blocked";
  }
})();
