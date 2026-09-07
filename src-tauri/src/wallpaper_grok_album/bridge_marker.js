(function () {
  try {
    // Album tracking must not alter identity-provider pages or embedded frames.
    if (location.protocol !== "https:" || location.hostname !== "grok.com" ||
        window.top !== window) return;

    var state = { epoch: 0, href: String(location.href || ""), main: null };
    Object.defineProperty(window, "__GROK_APP_SAVED_READ_ONLY__", {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });
    Object.defineProperty(window, "__GROK_APP_SAVED_PAGE_STATE__", {
      value: state,
      configurable: false,
      enumerable: false,
      writable: false
    });

    function markRoute() {
      try {
        var href = String(location.href || "");
        if (href !== state.href) {
          state.href = href;
          state.epoch += 1;
        }
      } catch (_) {}
    }

    ["pushState", "replaceState"].forEach(function (name) {
      try {
        var original = history[name];
        if (typeof original !== "function") return;
        history[name] = function () {
          var result = original.apply(this, arguments);
          markRoute();
          return result;
        };
      } catch (_) {}
    });
    window.addEventListener("popstate", markRoute);
    window.addEventListener("hashchange", markRoute);

    function inspectMain() {
      try {
        var next = document.querySelector("main");
        if (!state.main && next) {
          state.main = next;
        } else if (state.main && next !== state.main) {
          state.main = next;
          state.epoch += 1;
        }
      } catch (_) {}
    }
    if (typeof MutationObserver === "function") {
      new MutationObserver(inspectMain).observe(document, { childList: true, subtree: true });
    }
    document.addEventListener("DOMContentLoaded", inspectMain, { once: true });
  } catch (_) {}
})();
