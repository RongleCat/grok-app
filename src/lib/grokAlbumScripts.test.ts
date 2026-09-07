import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import bridgeMarkerScript from "../../src-tauri/src/wallpaper_grok_album/bridge_marker.js?raw";
import scrollRestoreScript from "../../src-tauri/src/wallpaper_grok_album/scroll_restore.js?raw";
import signedOutRecoveryScript from "../../src-tauri/src/wallpaper_grok_album/signed_out_recovery.js?raw";
import snapshotScript from "../../src-tauri/src/wallpaper_grok_album/snapshot.js?raw";

function runBridgeMarker(href: string, subframe = false) {
  const location = new URL(href);
  const pushState = vi.fn();
  const replaceState = vi.fn();
  const history = { pushState, replaceState };
  const observe = vi.fn();
  const page = { addEventListener: vi.fn(), top: null as object | null };
  page.top = subframe ? {} : page;
  const document = { addEventListener: vi.fn(), querySelector: vi.fn() };
  runInNewContext(bridgeMarkerScript, {
    document,
    history,
    location,
    window: page,
    MutationObserver: class {
      observe = observe;
    },
  });
  return { document, history, location, observe, page, pushState, replaceState };
}

function runSnapshot(options: {
  appShell?: boolean;
  challengeAsset?: boolean;
  challengeSurface?: boolean;
}) {
  const root = {
    scrollTop: 0,
    scrollHeight: 900,
    clientHeight: 900,
  };
  const document = {
    readyState: "complete",
    scrollingElement: root,
    documentElement: root,
    body: root,
    querySelectorAll: () => [],
    querySelector: (selector: string) => {
      if (selector === "main") return options.appShell ? {} : null;
      if (selector.includes("script[src*")) {
        return options.challengeAsset ? {} : null;
      }
      if (selector.includes("#challenge-stage")) {
        return options.challengeSurface ? {} : null;
      }
      return null;
    },
  };
  const page = { innerHeight: 900 };
  const raw = runInNewContext(snapshotScript, {
    URL,
    document,
    getComputedStyle: () => ({ overflowY: "visible" }),
    location: { href: "https://grok.com/imagine/saved" },
    window: page,
  });
  return JSON.parse(String(raw)) as {
    hasAppShell: boolean;
    hasSecurityChallenge: boolean;
  };
}

function runSignedOutRecovery(options: {
  appShell?: boolean;
  challengeAsset?: boolean;
  challengeSurface?: boolean;
  subframe?: boolean;
}) {
  const replace = vi.fn();
  let now = 0;
  let nextTimerId = 1;
  let descendants = 4;
  const timers = new Map<
    number,
    { callback: () => void; dueAt: number }
  >();
  const body = {
    childElementCount: 1,
    firstElementChild: {
      tagName: "DIV",
      childElementCount: 2,
    },
    getElementsByTagName: () => ({ length: descendants }),
  };
  const document = {
    readyState: "complete",
    body,
    documentElement: { scrollHeight: 900 },
    addEventListener: vi.fn(),
    querySelector: (selector: string) => {
      if (selector === "main") return options.appShell ? {} : null;
      if (selector.includes("script[src*")) {
        return options.challengeAsset ? {} : null;
      }
      if (selector.includes("#challenge-stage")) {
        return options.challengeSurface ? {} : null;
      }
      return null;
    },
  };
  const location = {
    protocol: "https:",
    hostname: "grok.com",
    pathname: "/imagine/saved",
    replace,
  };
  const page = {
    top: null as object | null,
    addEventListener: vi.fn(),
    clearTimeout: (timerId: number) => timers.delete(timerId),
    performance: { now: () => now },
    setTimeout: (callback: () => void, delay = 0) => {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, { callback, dueAt: now + delay });
      return timerId;
    },
  };
  page.top = options.subframe ? {} : page;
  runInNewContext(signedOutRecoveryScript, {
    document,
    location,
    window: page,
  });

  const advanceTo = (target: number) => {
    while (true) {
      const pending = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!pending) break;
      const [timerId, timer] = pending;
      timers.delete(timerId);
      now = timer.dueAt;
      timer.callback();
    }
    now = target;
  };

  return {
    advanceTo,
    replace,
    setDescendants(value: number) {
      descendants = value;
    },
    state: () =>
      Object.getOwnPropertyDescriptor(
        page,
        "__GROK_APP_SAVED_RECOVERY_STATE__",
      )?.get?.call(page) as string | undefined,
  };
}

describe("Grok album fixed page scripts", () => {
  it.each([
    "https://accounts.x.ai/sign-in",
    "https://accounts.google.com/",
    "https://appleid.apple.com/auth/authorize",
    "https://x.com/i/oauth2/authorize",
    "https://challenges.cloudflare.com/",
    "https://grok.com.example.org/imagine/saved",
    "http://grok.com/imagine/saved",
  ])("leaves non-Grok page APIs untouched: %s", (href) => {
    const marker = runBridgeMarker(href);
    expect(marker.history.pushState).toBe(marker.pushState);
    expect(marker.history.replaceState).toBe(marker.replaceState);
    expect(marker.page.addEventListener).not.toHaveBeenCalled();
    expect(marker.document.addEventListener).not.toHaveBeenCalled();
    expect(marker.observe).not.toHaveBeenCalled();
    expect("__GROK_APP_SAVED_PAGE_STATE__" in marker.page).toBe(false);
  });

  it("leaves subframes untouched even on the Grok origin", () => {
    const marker = runBridgeMarker("https://grok.com/imagine/saved", true);
    expect(marker.history.pushState).toBe(marker.pushState);
    expect(marker.history.replaceState).toBe(marker.replaceState);
    expect(marker.observe).not.toHaveBeenCalled();
    expect("__GROK_APP_SAVED_PAGE_STATE__" in marker.page).toBe(false);
  });

  it("tracks top-level Grok routes while preserving history calls", () => {
    const marker = runBridgeMarker("https://grok.com/");
    const state = Object.getOwnPropertyDescriptor(
      marker.page,
      "__GROK_APP_SAVED_PAGE_STATE__",
    )?.value as { epoch: number; href: string };
    expect(state).toMatchObject({ epoch: 0, href: "https://grok.com/" });
    expect(marker.observe).toHaveBeenCalledOnce();
    marker.pushState.mockImplementation(() => {
      marker.location.href = "https://grok.com/imagine/saved";
    });
    marker.history.pushState({}, "", "/imagine/saved");
    expect(marker.pushState).toHaveBeenCalledWith({}, "", "/imagine/saved");
    expect(state).toMatchObject({
      epoch: 1,
      href: "https://grok.com/imagine/saved",
    });
    marker.history.replaceState({}, "", "/imagine/saved");
    expect(marker.replaceState).toHaveBeenCalledWith({}, "", "/imagine/saved");
    expect(state.epoch).toBe(1);
  });

  it("restores and clears the saved scroll offset", () => {
    const scrollTo = vi.fn();
    const root = { scrollTop: 0, scrollTo };
    const page = {
      __GROK_APP_ALBUM_SCROLL_RESTORE__: { root, top: 137 },
    };

    runInNewContext(scrollRestoreScript, { window: page });

    expect(scrollTo).toHaveBeenCalledWith({
      top: 137,
      left: 0,
      behavior: "auto",
    });
    expect("__GROK_APP_ALBUM_SCROLL_RESTORE__" in page).toBe(false);
  });

  it("falls back to scrollTop and clamps an invalid offset", () => {
    const root = { scrollTop: 99 };
    const page = {
      __GROK_APP_ALBUM_SCROLL_RESTORE__: { root, top: -10 },
    };

    runInNewContext(scrollRestoreScript, { window: page });

    expect(root.scrollTop).toBe(0);
    expect("__GROK_APP_ALBUM_SCROLL_RESTORE__" in page).toBe(false);
  });

  it("recognizes a full-page Cloudflare challenge from its bundled assets", () => {
    expect(runSnapshot({ challengeAsset: true })).toMatchObject({
      hasAppShell: false,
      hasSecurityChallenge: true,
    });
  });

  it("does not treat a normal Grok shell as a full-page challenge", () => {
    expect(
      runSnapshot({ appShell: true, challengeAsset: true }),
    ).toMatchObject({
      hasAppShell: true,
      hasSecurityChallenge: false,
    });
  });

  it("keeps recognizing explicit challenge surfaces", () => {
    expect(
      runSnapshot({ appShell: true, challengeSurface: true }),
    ).toMatchObject({
      hasAppShell: true,
      hasSecurityChallenge: true,
    });
  });

  it("redirects only after the completed signed-out Saved shell stays stable", () => {
    const signedOut = runSignedOutRecovery({});
    signedOut.advanceTo(11_999);
    expect(signedOut.replace).not.toHaveBeenCalled();
    expect(signedOut.state()).toBe("waiting");

    signedOut.advanceTo(12_000);
    expect(signedOut.replace).toHaveBeenCalledOnce();
    expect(signedOut.replace).toHaveBeenCalledWith("https://grok.com/");
    expect(signedOut.state()).toBe("redirecting");

    const signedIn = runSignedOutRecovery({ appShell: true });
    signedIn.advanceTo(20_000);
    expect(signedIn.replace).not.toHaveBeenCalled();
    expect(signedIn.state()).toBe("ready");
  });

  it("restarts the stability window when the signed-out shell changes", () => {
    const recovery = runSignedOutRecovery({});
    recovery.advanceTo(9_999);
    recovery.setDescendants(5);
    recovery.advanceTo(12_999);
    expect(recovery.replace).not.toHaveBeenCalled();

    recovery.advanceTo(13_000);
    expect(recovery.replace).toHaveBeenCalledOnce();
  });

  it("does not redirect Cloudflare challenge pages", () => {
    const assetChallenge = runSignedOutRecovery({ challengeAsset: true });
    assetChallenge.advanceTo(20_000);
    expect(assetChallenge.replace).not.toHaveBeenCalled();
    expect(assetChallenge.state()).toBe("challenge");

    const surfaceChallenge = runSignedOutRecovery({ challengeSurface: true });
    surfaceChallenge.advanceTo(20_000);
    expect(surfaceChallenge.replace).not.toHaveBeenCalled();
    expect(surfaceChallenge.state()).toBe("challenge");
  });

  it("does not redirect or watch a Saved subframe", () => {
    const recovery = runSignedOutRecovery({ subframe: true });
    recovery.advanceTo(20_000);
    expect(recovery.replace).not.toHaveBeenCalled();
    expect(recovery.state()).toBeUndefined();
  });
});
