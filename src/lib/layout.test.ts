import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT,
  loadLayout,
  parseLayout,
  saveLayout,
  clampAsideWidth,
  clampSidebarDragWidth,
  clampSidebarWidth,
  resolveSidebarDragEnd,
  asideChromeSafeMin,
  asideSurfaceFromPreviewKind,
  suggestAsideWidth,
  mergeAsideWidth,
  requiredWorkbenchInnerWidth,
  ASIDE_WIDTH_MIN,
  MAIN_CHAT_MIN_WIDTH,
  SIDEBAR_COLLAPSE_THRESHOLD,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  WINDOW_CONTROLS_INSET,
  LAYOUT_STORAGE_KEY,
  withMirrorPhoneDrawerDefault,
  MIRROR_DRAWER_BREAKPOINT,
  isPhoneViewport,
  isMirrorPhoneLayout,
} from "./layout";

describe("layout prefs", () => {
  it("defaults right pane collapsed", () => {
    expect(DEFAULT_LAYOUT.asideCollapsed).toBe(true);
  });

  it("round-trips widths; right pane always starts collapsed", () => {
    const data: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => {
        data[k] = v;
      },
    };
    saveLayout(storage, {
      sidebarWidth: 280,
      asideWidth: 420,
      asideCollapsed: false,
      sidebarCollapsed: true,
    });
    expect(data[LAYOUT_STORAGE_KEY]).toBeTruthy();
    const loaded = loadLayout(storage);
    // Open state is not restored across app launches.
    expect(loaded.asideCollapsed).toBe(true);
    expect(loaded.sidebarWidth).toBe(280);
    expect(loaded.asideWidth).toBe(420);
    expect(loaded.sidebarCollapsed).toBe(true);
  });

  it("parseLayout falls back safely", () => {
    expect(parseLayout(null).asideCollapsed).toBe(true);
    expect(parseLayout(null).sidebarCollapsed).toBe(false);
  });

  it("clamps aside min only; no hard 720 max (chat floor via viewport)", () => {
    expect(clampAsideWidth(100)).toBe(ASIDE_WIDTH_MIN);
    // No viewport → no artificial ceiling
    expect(clampAsideWidth(9999)).toBe(9999);
    expect(clampAsideWidth(400)).toBe(400);
    // Wide viewport allows aside > historical ASIDE_WIDTH_MAX (720)
    expect(
      clampAsideWidth(900, { viewportWidth: 2000, sidebarOccupiedWidth: 0 }),
    ).toBe(900);
    // Still leaves ≥ MAIN_CHAT_MIN_WIDTH for chat
    expect(
      clampAsideWidth(9999, { viewportWidth: 1000, sidebarOccupiedWidth: 0 }),
    ).toBe(1000 - MAIN_CHAT_MIN_WIDTH);
  });

  it("clamps sidebar width to min / max and viewport room", () => {
    // Collapse before deformation: threshold == open min.
    expect(SIDEBAR_COLLAPSE_THRESHOLD).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(100)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_WIDTH_MAX);
    expect(clampSidebarWidth(280)).toBe(280);
    // 900 viewport, 360 chat, 320 aside → sidebar room 220 (above open min)
    const capped = clampSidebarWidth(400, {
      viewportWidth: 900,
      asideOccupiedWidth: 320,
    });
    expect(capped).toBe(900 - MAIN_CHAT_MIN_WIDTH - 320);
    // Tight frame: room below open min → floor at SIDEBAR_WIDTH_MIN
    expect(
      clampSidebarWidth(400, {
        viewportWidth: 800,
        asideOccupiedWidth: 320,
      }),
    ).toBe(SIDEBAR_WIDTH_MIN);
    // 1400 viewport, no aside → room plenty, still cap at SIDEBAR_WIDTH_MAX
    expect(
      clampSidebarWidth(500, { viewportWidth: 1400, asideOccupiedWidth: 0 }),
    ).toBe(SIDEBAR_WIDTH_MAX);
  });

  it("drag width never paints below open min", () => {
    expect(clampSidebarDragWidth(50)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarDragWidth(160)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarDragWidth(280)).toBe(280);
    expect(clampSidebarDragWidth(9999)).toBe(SIDEBAR_WIDTH_MAX);
  });

  it("resolveSidebarDragEnd collapses below min, else keeps/clamps", () => {
    expect(resolveSidebarDragEnd(100)).toEqual({
      action: "collapse",
      sidebarWidth: SIDEBAR_WIDTH_MIN,
    });
    expect(resolveSidebarDragEnd(SIDEBAR_WIDTH_MIN - 1)).toEqual({
      action: "collapse",
      sidebarWidth: SIDEBAR_WIDTH_MIN,
    });
    // At open min → stay open
    expect(resolveSidebarDragEnd(SIDEBAR_WIDTH_MIN)).toEqual({
      action: "open",
      sidebarWidth: SIDEBAR_WIDTH_MIN,
    });
    expect(resolveSidebarDragEnd(280)).toEqual({
      action: "open",
      sidebarWidth: 280,
    });
  });

  it("parseLayout clamps stored sidebarWidth", () => {
    expect(parseLayout({ sidebarWidth: 50 }).sidebarWidth).toBe(
      SIDEBAR_WIDTH_MIN,
    );
    expect(parseLayout({ sidebarWidth: 800 }).sidebarWidth).toBe(
      SIDEBAR_WIDTH_MAX,
    );
  });

  it("raises chrome-safe min when window controls are present", () => {
    const plain = asideChromeSafeMin();
    const withWin = asideChromeSafeMin({
      windowControlsInset: WINDOW_CONTROLS_INSET,
    });
    expect(withWin).toBeGreaterThan(plain);
    // Floor is ASIDE_WIDTH_MIN (400); chrome-safe can be higher with window inset.
    expect(withWin).toBeGreaterThanOrEqual(ASIDE_WIDTH_MIN);
    expect(plain).toBe(ASIDE_WIDTH_MIN);
    expect(
      clampAsideWidth(300, { windowControlsInset: WINDOW_CONTROLS_INSET }),
    ).toBe(withWin);
  });

  it("caps max by viewport so main chat keeps ≥ MAIN_CHAT_MIN_WIDTH", () => {
    const w = clampAsideWidth(700, { viewportWidth: 900 });
    // 900 - 360 chat min = 540
    expect(w).toBeLessThanOrEqual(900 - MAIN_CHAT_MIN_WIDTH);
    expect(w).toBe(900 - MAIN_CHAT_MIN_WIDTH);
    expect(w).toBeGreaterThanOrEqual(ASIDE_WIDTH_MIN);
  });

  it("subtracts open sidebar when capping aside so chat stays ≥ min", () => {
    // 1200 viewport, 268 sidebar, 360 chat → aside max 572
    const w = clampAsideWidth(700, {
      viewportWidth: 1200,
      sidebarOccupiedWidth: 268,
    });
    expect(w).toBeLessThanOrEqual(1200 - 268 - MAIN_CHAT_MIN_WIDTH);
    expect(w).toBe(1200 - 268 - MAIN_CHAT_MIN_WIDTH);
  });

  it("requiredWorkbenchInnerWidth sums open panes + chat floor", () => {
    expect(
      requiredWorkbenchInnerWidth({
        sidebarCollapsed: true,
        asideCollapsed: true,
      }),
    ).toBe(MAIN_CHAT_MIN_WIDTH);
    expect(
      requiredWorkbenchInnerWidth({
        sidebarCollapsed: false,
        sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
        asideCollapsed: true,
      }),
    ).toBe(SIDEBAR_DEFAULT_WIDTH + MAIN_CHAT_MIN_WIDTH);
    expect(
      requiredWorkbenchInnerWidth({
        sidebarCollapsed: false,
        sidebarWidth: 268,
        asideCollapsed: false,
        asideWidth: 400,
      }),
    ).toBe(268 + MAIN_CHAT_MIN_WIDTH + 400);
  });

  it("maps preview kinds to surfaces", () => {
    expect(asideSurfaceFromPreviewKind("markdown")).toBe("markdown");
    expect(asideSurfaceFromPreviewKind("code")).toBe("code");
    expect(asideSurfaceFromPreviewKind("docx")).toBe("office");
    expect(asideSurfaceFromPreviewKind("pdf")).toBe("pdf");
    expect(asideSurfaceFromPreviewKind(null)).toBe("empty");
  });

  it("suggests wider pane for code / video / tree split", () => {
    const empty = suggestAsideWidth({
      surface: "empty",
      treeVisible: false,
      tabCount: 0,
    });
    const code = suggestAsideWidth({
      surface: "code",
      treeVisible: false,
      tabCount: 1,
    });
    const codeTree = suggestAsideWidth({
      surface: "code",
      treeVisible: true,
      tabCount: 1,
    });
    const video = suggestAsideWidth({
      surface: "video",
      treeVisible: false,
      tabCount: 1,
    });
    expect(code).toBeGreaterThan(empty);
    expect(codeTree).toBeGreaterThan(code);
    expect(video).toBeGreaterThanOrEqual(code);
  });

  it("mergeAsideWidth soft-grows and never drops below chrome min", () => {
    expect(mergeAsideWidth(400, 500)).toBe(500);
    expect(mergeAsideWidth(560, 420)).toBe(560); // keep wider user size
    expect(
      mergeAsideWidth(200, 200, {
        windowControlsInset: WINDOW_CONTROLS_INSET,
      }),
    ).toBe(
      asideChromeSafeMin({ windowControlsInset: WINDOW_CONTROLS_INSET }),
    );
  });

  it("mirror phone viewport starts with drawer collapsed", () => {
    const open = { ...DEFAULT_LAYOUT, sidebarCollapsed: false };
    const at390 = withMirrorPhoneDrawerDefault(open, {
      isMirror: true,
      viewportWidth: 390,
    });
    expect(at390.sidebarCollapsed).toBe(true);

    const atBreakpoint = withMirrorPhoneDrawerDefault(open, {
      isMirror: true,
      viewportWidth: MIRROR_DRAWER_BREAKPOINT,
    });
    expect(atBreakpoint.sidebarCollapsed).toBe(true);

    const desktopMirror = withMirrorPhoneDrawerDefault(open, {
      isMirror: true,
      viewportWidth: MIRROR_DRAWER_BREAKPOINT + 1,
    });
    expect(desktopMirror.sidebarCollapsed).toBe(false);

    const nonMirror = withMirrorPhoneDrawerDefault(open, {
      isMirror: false,
      viewportWidth: 390,
    });
    expect(nonMirror.sidebarCollapsed).toBe(false);
  });

  it("isPhoneViewport / isMirrorPhoneLayout gate phone chrome", () => {
    expect(isPhoneViewport(MIRROR_DRAWER_BREAKPOINT)).toBe(true);
    expect(isPhoneViewport(MIRROR_DRAWER_BREAKPOINT + 1)).toBe(false);
    expect(isMirrorPhoneLayout({ isMirror: true, viewportWidth: 390 })).toBe(
      true,
    );
    expect(isMirrorPhoneLayout({ isMirror: true, viewportWidth: 900 })).toBe(
      false,
    );
  });

  it("squeezed non-maximized frame prefers chat floor over chrome min", () => {
    // sidebar 268 + chat 360 + preferred 400 = 1028 > 1000 viewport
    // → aside max = 1000 - 268 - 360 = 372 (< chrome min 400)
    const w = clampAsideWidth(400, {
      viewportWidth: 1000,
      sidebarOccupiedWidth: 268,
    });
    expect(w).toBe(1000 - 268 - MAIN_CHAT_MIN_WIDTH);
    expect(w).toBeLessThan(ASIDE_WIDTH_MIN);
    // Close control must still be reachable via main toggle when this happens;
    // clamp itself only guarantees chat floor, not chrome min.
    expect(w).toBeGreaterThan(0);
  });
});
