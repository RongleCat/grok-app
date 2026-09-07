(function () {
  try {
    function generatedMediaUrl(node) {
      var candidates = node && node.tagName === "VIDEO"
        ? [node.currentSrc, node.src, node.poster]
        : [node && (node.currentSrc || node.src)];
      return candidates.some(function (raw) {
        if (!raw) return false;
        try {
          var text = String(raw);
          if (text.length > 4096) return false;
          var url = new URL(text, location.href);
          return url.protocol === "https:" && url.hostname === "assets.grok.com" &&
            (!url.port || url.port === "443") && url.pathname.indexOf("/generated/") >= 0;
        } catch (_) {
          return false;
        }
      });
    }

    function albumScrollRoot(nodes) {
      var counts = new Map();
      nodes.forEach(function (node) {
        var current = node && node.parentElement;
        while (current) {
          try {
            var style = getComputedStyle(current);
            var scrollable = (style.overflowY === "auto" || style.overflowY === "scroll") &&
              current.clientHeight > 0 && current.scrollHeight > current.clientHeight + 1;
            if (scrollable) counts.set(current, (counts.get(current) || 0) + 1);
          } catch (_) {}
          current = current.parentElement;
        }
      });
      var best = null;
      var bestCount = 0;
      var bestRange = -1;
      counts.forEach(function (count, node) {
        var range = Number(node.scrollHeight || 0) - Number(node.clientHeight || 0);
        if (count > bestCount || (count === bestCount && range > bestRange)) {
          best = node;
          bestCount = count;
          bestRange = range;
        }
      });
      return best || document.scrollingElement || document.documentElement || document.body;
    }

    var mediaNodes = Array.prototype.filter.call(
      document.querySelectorAll('img, video'),
      generatedMediaUrl
    );
    var root = albumScrollRoot(mediaNodes);
    var restore = window.__GROK_APP_ALBUM_SCROLL_RESTORE__;
    if (!restore || restore.root !== root) {
      window.__GROK_APP_ALBUM_SCROLL_RESTORE__ = {
        root: root,
        top: Number((root && root.scrollTop) || 0)
      };
    }
    var height = Number((root && root.scrollHeight) || 0);
    if (root && typeof root.scrollTo === "function") {
      root.scrollTo({ top: height, left: 0, behavior: "auto" });
    } else if (root) {
      root.scrollTop = height;
    }
    return "ok";
  } catch (_) {
    return "blocked";
  }
})();
