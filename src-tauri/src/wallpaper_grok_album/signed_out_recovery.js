(function () {
  try {
    if (window.top !== window || location.protocol !== "https:" || location.hostname !== "grok.com" ||
        location.pathname.indexOf("/imagine/saved") !== 0) return;

    var phase = "waiting";
    var startedAt = monotonicNow();
    var stableSince = 0;
    var stableSamples = 0;
    var lastShellSignature = "";
    var timer = 0;
    var observer = null;
    var SAMPLE_INTERVAL_MS = 500;
    var MIN_PAGE_AGE_MS = 12000;
    var MIN_STABLE_AGE_MS = 3000;
    var MIN_STABLE_SAMPLES = 6;

    Object.defineProperty(window, "__GROK_APP_SAVED_RECOVERY_STATE__", {
      get: function () { return phase; },
      configurable: false,
      enumerable: false
    });

    function monotonicNow() {
      try {
        if (window.performance && typeof window.performance.now === "function") {
          return window.performance.now();
        }
      } catch (_) {}
      return Date.now();
    }

    function isSavedRoute() {
      try {
        return location.protocol === "https:" && location.hostname === "grok.com" &&
          location.pathname.indexOf("/imagine/saved") === 0;
      } catch (_) {
        return false;
      }
    }

    function hasAppShell() {
      try {
        return !!document.querySelector("main");
      } catch (_) {
        return false;
      }
    }

    function hasSecurityChallenge() {
      try {
        var surface = document.querySelector(
          'iframe[src*="/cdn-cgi/challenge-platform/"], #challenge-stage, #challenge-running, #challenge-body-text, form#challenge-form, input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], [data-translate="challenge_headline"]'
        );
        var asset = document.querySelector(
          'script[src*="/cdn-cgi/challenge-platform/"], link[href*="/cdn-cgi/styles/challenges.css"]'
        );
        return !!surface || (!hasAppShell() && !!asset);
      } catch (_) {
        return false;
      }
    }

    function shellSignature() {
      try {
        var body = document.body;
        if (!body) return "";
        var root = body.firstElementChild;
        var descendants = body.getElementsByTagName("*").length;
        var height = document.documentElement ? document.documentElement.scrollHeight : 0;
        return [
          body.childElementCount,
          root ? root.tagName : "",
          root ? root.childElementCount : 0,
          descendants,
          height
        ].join(":");
      } catch (_) {
        return "";
      }
    }

    function resetStability() {
      stableSince = 0;
      stableSamples = 0;
      lastShellSignature = "";
    }

    function stopWatching() {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }

    function scheduleSample() {
      if (timer) return;
      timer = window.setTimeout(function () {
        timer = 0;
        samplePage();
      }, SAMPLE_INTERVAL_MS);
    }

    function samplePage() {
      try {
        if (!isSavedRoute()) {
          stopWatching();
          return;
        }
        if (hasAppShell()) {
          phase = "ready";
          stopWatching();
          return;
        }
        if (hasSecurityChallenge()) {
          phase = "challenge";
          resetStability();
          scheduleSample();
          return;
        }

        phase = "waiting";
        if (document.readyState !== "complete" || !document.body) {
          resetStability();
          scheduleSample();
          return;
        }

        var now = monotonicNow();
        var signature = shellSignature();
        if (!signature || signature !== lastShellSignature) {
          lastShellSignature = signature;
          stableSince = now;
          stableSamples = 1;
        } else {
          stableSamples += 1;
        }

        var pageAge = now - startedAt;
        var stableAge = stableSince > 0 ? now - stableSince : 0;
        if (pageAge >= MIN_PAGE_AGE_MS && stableAge >= MIN_STABLE_AGE_MS &&
            stableSamples >= MIN_STABLE_SAMPLES) {
          phase = "redirecting";
          stopWatching();
          location.replace("https://grok.com/");
          return;
        }
      } catch (_) {}
      scheduleSample();
    }

    if (typeof MutationObserver === "function") {
      observer = new MutationObserver(function () {
        try {
          if (!isSavedRoute()) {
            stopWatching();
          } else if (hasAppShell()) {
            phase = "ready";
            stopWatching();
          } else if (hasSecurityChallenge()) {
            phase = "challenge";
            resetStability();
          }
        } catch (_) {}
      });
      observer.observe(document, { childList: true, subtree: true });
    }
    document.addEventListener("DOMContentLoaded", scheduleSample, { once: true });
    window.addEventListener("load", scheduleSample, { once: true });
    scheduleSample();
  } catch (_) {}
})();
