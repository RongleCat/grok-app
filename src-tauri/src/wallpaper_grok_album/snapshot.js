(function () {
  try {
    var items = [];
    var seen = Object.create(null);

    function generatedMediaUrl(node) {
      var candidates = node && node.tagName === "VIDEO"
        ? [node.currentSrc, node.src, node.poster]
        : [node && (node.currentSrc || node.src)];
      for (var i = 0; i < candidates.length; i += 1) {
        var raw = candidates[i];
        if (!raw) continue;
        try {
          var text = String(raw);
          if (text.length > 4096) continue;
          var url = new URL(text, location.href);
          if (url.protocol === "https:" &&
              url.hostname === "assets.grok.com" &&
              (!url.port || url.port === "443") &&
              url.pathname.indexOf("/generated/") >= 0) {
            return url.href;
          }
        } catch (_) {}
      }
      return null;
    }

    function videoAssetUrl(video) {
      var candidates = [video && video.currentSrc, video && video.src];
      if (video && video.querySelectorAll) {
        Array.prototype.forEach.call(video.querySelectorAll("source[src]"), function (source) {
          candidates.push(source.src || source.getAttribute("src"));
        });
      }
      for (var i = 0; i < candidates.length; i += 1) {
        var clean = cleanUrl(candidates[i]);
        if (clean) return clean;
      }
      return null;
    }

    function isLocalBlobVideo(video) {
      try {
        var raw = String((video && (video.currentSrc || video.src)) || "");
        var url = new URL(raw, location.href);
        return url.protocol === "blob:" && url.origin === location.origin;
      } catch (_) {
        return false;
      }
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

    function cleanUrl(raw) {
      if (!raw) return null;
      try {
        var text = String(raw);
        if (text.length > 4096) return null;
        var url = new URL(text, location.href);
        if (url.protocol !== "https:" || url.hostname !== "assets.grok.com") return null;
        if (url.port && url.port !== "443") return null;
        if (url.pathname.indexOf("/generated/") < 0) return null;
        var clean = new URL(url.origin + url.pathname);
        url.searchParams.forEach(function (value, key) {
          var normalized = String(key).toLowerCase();
          var allowed =
            (normalized === "format" && /^[a-z0-9]{1,8}$/i.test(value)) ||
            ((normalized === "w" || normalized === "h" ||
              normalized === "width" || normalized === "height") &&
              /^\d{1,6}$/.test(value)) ||
            (normalized === "cache" && (value === "0" || value === "1"));
          if (allowed) clean.searchParams.append(normalized, value);
        });
        return clean.href.length <= 4096 ? clean.href : null;
      } catch (_) {
        return null;
      }
    }

    function postIdFor(node) {
      try {
        var link = node && node.closest ? node.closest('a[href]') : null;
        if (!link) return null;
        var path = new URL(link.href, location.href).pathname;
        var match = path.match(/\/(?:post|share)\/([A-Za-z0-9_-]{4,128})(?:\/|$)/);
        return match ? match[1] : null;
      } catch (_) {
        return null;
      }
    }

    function createdAtFor(node) {
      try {
        var scope = node && node.closest ? node.closest('a, article, [data-testid], div') : null;
        var time = scope && scope.querySelector ? scope.querySelector('time[datetime]') : null;
        var raw = (time && time.getAttribute('datetime')) ||
          (scope && scope.getAttribute && scope.getAttribute('data-created-at')) ||
          (node && node.getAttribute && node.getAttribute('data-created-at')) || "";
        return raw ? String(raw).slice(0, 64) : null;
      } catch (_) {
        return null;
      }
    }

    function mediaIdentity(raw) {
      try {
        var url = new URL(raw);
        return url.origin + url.pathname;
      } catch (_) {
        return null;
      }
    }

    function add(node, rawMedia, rawThumb, kind, webviewOnly) {
      if (items.length >= 320) return;
      var mediaUrl = cleanUrl(rawMedia);
      var identity = mediaIdentity(mediaUrl);
      if (!mediaUrl || !identity || seen[identity]) return;
      var thumbnailUrl = cleanUrl(rawThumb) || (kind === "image" ? mediaUrl : null);
      if (kind === "video" && !thumbnailUrl) return;
      seen[identity] = true;
      var width = Number((node && (node.videoWidth || node.naturalWidth || node.width)) || 0);
      var height = Number((node && (node.videoHeight || node.naturalHeight || node.height)) || 0);
      items.push({
        mediaUrl: mediaUrl,
        thumbnailUrl: thumbnailUrl,
        kind: kind,
        width: Number.isFinite(width) && width > 0 ? Math.round(width) : null,
        height: Number.isFinite(height) && height > 0 ? Math.round(height) : null,
        createdAt: createdAtFor(node),
        postId: postIdFor(node),
        webviewOnly: !!webviewOnly
      });
    }

    var mediaNodes = Array.prototype.filter.call(
      document.querySelectorAll('img, video'),
      function (node) { return !!generatedMediaUrl(node); }
    );
    var root = albumScrollRoot(mediaNodes);
    var albumNodes = mediaNodes.filter(function (node) {
      return root === document.scrollingElement || root === document.documentElement ||
        root === document.body || (root.contains && root.contains(node));
    });

    albumNodes.filter(function (node) { return node.tagName === "VIDEO"; }).forEach(function (video) {
      var media = videoAssetUrl(video);
      var poster = cleanUrl(video.poster);
      if (media) {
        add(video, media, poster, "video", false);
      } else if (poster && isLocalBlobVideo(video)) {
        // The opaque blob URL remains inside this isolated page. The Host uses
        // the allowlisted poster only as a lookup anchor when preview is asked.
        add(video, poster, poster, "video", true);
      }
    });
    albumNodes.filter(function (node) { return node.tagName === "IMG"; }).forEach(function (img) {
      add(img, img.currentSrc || img.src, img.currentSrc || img.src, "image", false);
    });

    var hasAppShell = !!document.querySelector('main');
    var hasChallengeSurface = !!document.querySelector(
      'iframe[src*="/cdn-cgi/challenge-platform/"], #challenge-stage, #challenge-running, #challenge-body-text, form#challenge-form, input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], [data-translate="challenge_headline"]'
    );
    var hasChallengeAsset = !!document.querySelector(
      'script[src*="/cdn-cgi/challenge-platform/"], link[href*="/cdn-cgi/styles/challenges.css"]'
    );
    var top = Number((root && root.scrollTop) || 0);
    var height = Number((root && root.scrollHeight) || 0);
    var viewport = Number((root && root.clientHeight) || window.innerHeight || 0);
    return JSON.stringify({
      version: 1,
      readyState: String(document.readyState || ""),
      hasAppShell: hasAppShell,
      hasSecurityChallenge: hasChallengeSurface || (!hasAppShell && hasChallengeAsset),
      recoveryState: String(window.__GROK_APP_SAVED_RECOVERY_STATE__ || "").slice(0, 32),
      pageEpoch: Number((window.__GROK_APP_SAVED_PAGE_STATE__ || {}).epoch || 0),
      items: items.slice(0, 320),
      scrollTop: top,
      scrollHeight: height,
      viewportHeight: viewport,
      atBottom: height > 0 && top + viewport >= height - 96
    });
  } catch (_) {
    return JSON.stringify({
      version: 1,
      readyState: "",
      hasAppShell: false,
      hasSecurityChallenge: false,
      recoveryState: "",
      items: [],
      bridgeError: true
    });
  }
})();
