/**
 * Overlay chrome: living mark + task bubbles + in-window menu.
 * Pet settings opens the same Settings → 宠物 hash as the settings nav item.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PetMark } from "./PetMark";
import { PetTaskBubbles } from "./PetTaskBubbles";
import { ContextMenu } from "@/components/ContextMenu";
import { createT, type Locale } from "@/i18n";
import {
  clampPetMarkHitRadius,
  hitChromeCssScale,
  isPetColor,
  isPetShape,
  normalizePetEyeColor,
  PET_BUBBLE_WIDTH,
  PET_DRAG_SLOP,
  petBubbleViewportHeight,
  petBubblesEnabled,
  petDoneTaskIds,
  PET_DBLCLICK_MS,
  normalizePetBubbleShape,
  normalizePetBubbleStyle,
  petMarkClickIntent,
  petProgressBarEnabled,
  petDragPassedSlop,
  petOverlayExtent,
  petOverlayWidth,
  petPointerStep,
  petSettingsHash,
  petShouldManualDrag,
  petVerbFor,
  placePetContextMenu,
  scaleHitLen,
  shouldTriggerPetSpin,
  type PetFocus,
  type PetTask,
} from "@/lib/pet";
import {
  petFocusSession,
  petHide,
  petNudge,
  petOpenSettings,
  petPrefsSet,
  petReadBubbleOffset,
  petReadOverlayFrame,
  petSetDragging,
  petSetHitChrome,
  petSetIgnoreCursor,
  petSetMenuOpen,
  petHideMain,
  petShowMain,
  petStartDragging,
  petSyncOverlaySize,
  PET_OVERLAY_POLICY_FULL,
  type PetOverlayPolicy,
} from "@/lib/api/pet";
import type { PetPrefs } from "@/lib/api/pet";

export { petSettingsHash };

const MENU_W = 148;
const MENU_H = 188;

export function PetOverlay({
  focus,
  tasks = [],
  prefs,
  locale = "en",
  policy = PET_OVERLAY_POLICY_FULL,
}: {
  focus: PetFocus;
  tasks?: readonly PetTask[];
  prefs: PetPrefs;
  locale?: Locale;
  policy?: PetOverlayPolicy;
}) {
  const t = useMemo(() => createT(locale), [locale]);
  const shape = isPetShape(prefs.shape) ? prefs.shape : "hex";
  const color = isPetColor(prefs.color) ? prefs.color : "green";
  const eyeColor = normalizePetEyeColor(prefs.eyeColor);
  const verb = petVerbFor(focus.kind, focus.toolTitle);
  const sizePx = prefs.sizePx || 128;
  const bubblesOn = petBubblesEnabled(prefs);
  const bubbleShape = normalizePetBubbleShape(prefs.bubbleShape);
  const bubbleStyle = normalizePetBubbleStyle(prefs.bubbleStyle);
  const progressBar = petProgressBarEnabled(prefs);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuOpen = menu != null;
  const [dragging, setDragging] = useState(false);
  const [bubbleDx, setBubbleDx] = useState(0);
  const [spinSignal, setSpinSignal] = useState(0);
  const [emoteSignal, setEmoteSignal] = useState(0);
  const spinWatchRef = useRef<{
    primed: boolean;
    kind: PetFocus["kind"] | null;
    done: Set<string>;
  }>({ primed: false, kind: null, done: new Set() });
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const lastScreenRef = useRef({ x: 0, y: 0 });
  const accumRef = useRef({ x: 0, y: 0 });
  const draggedRef = useRef(false);
  const manualDrag = petShouldManualDrag(policy);
  const hugMark =
    policy.compactIdle && !menuOpen && !(bubblesOn && tasks.length > 0);
  const overlaySize = petOverlayExtent({
    sizePx,
    bubbles: bubblesOn,
    compactIdle: policy.compactIdle,
    expanded: !hugMark,
  });
  const pendingClickRef = useRef<number | null>(null);
  const openedAtRef = useRef<number | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const markRef = useRef<HTMLDivElement | null>(null);
  const stackRef = useRef<HTMLDivElement | null>(null);

  const statusLabel = useMemo(() => {
    switch (focus.kind) {
      case "needs_you":
        return t("pet.status.needsYou");
      case "error":
        return t("pet.status.error");
      case "ready":
        return t("pet.status.ready");
      case "working":
        return t("pet.status.working");
      case "connecting":
        return t("pet.status.connecting");
      default:
        return t("pet.status.idle");
    }
  }, [focus.kind, t]);

  const title = [statusLabel, focus.title, focus.toolTitle]
    .filter(Boolean)
    .join(" · ");

  const reportHitChrome = useCallback(() => {
    const overlay = overlayRef.current;
    const mark = markRef.current;
    if (!overlay || !mark) return;
    const o = overlay.getBoundingClientRect();
    const m = mark.getBoundingClientRect();
    const b = stackRef.current?.getBoundingClientRect();
    const css = hitChromeCssScale(o.width, petOverlayWidth(sizePx, bubblesOn));
    const markR = clampPetMarkHitRadius(
      scaleHitLen(Math.max(m.width, m.height) * 0.52, css),
      sizePx,
    );
    void petSetHitChrome({
      markCx: scaleHitLen(m.left + m.width / 2 - o.left, css),
      markCy: scaleHitLen(m.top + m.height / 2 - o.top, css),
      markR,
      bubbleX: b ? scaleHitLen(b.left - o.left, css) : 0,
      bubbleY: b ? scaleHitLen(b.top - o.top, css) : 0,
      bubbleW: b ? scaleHitLen(b.width, css) : 0,
      bubbleH: b ? scaleHitLen(b.height, css) : 0,
      windowW: scaleHitLen(o.width, css),
      windowH: scaleHitLen(o.height, css),
    });
  }, [bubblesOn, sizePx]);

  const refreshBubbleOffset = useCallback(async () => {
    if (!bubblesOn) {
      reportHitChrome();
      return;
    }
    const max = Math.max(0, (petOverlayWidth(sizePx, true) - PET_BUBBLE_WIDTH) / 2 - 8);
    const dx = await petReadBubbleOffset(max);
    setBubbleDx((prev) => (Math.abs(prev - dx) < 1 ? prev : dx));
    reportHitChrome();
  }, [bubblesOn, sizePx, reportHitChrome]);

  useLayoutEffect(() => {
    void petSyncOverlaySize(overlaySize.w, overlaySize.h).then(() => {
      void refreshBubbleOffset();
    });
  }, [overlaySize.h, overlaySize.w, refreshBubbleOffset]);

  useLayoutEffect(() => {
    reportHitChrome();
  }, [tasks, reportHitChrome]);

  useEffect(() => {
    if (dragging) return;
    let gone = false;
    let unlisten: (() => void) | undefined;
    let timer: number | null = null;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        unlisten = await win.onMoved(() => {
          if (gone) return;
          if (timer != null) window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            if (!gone) void refreshBubbleOffset();
          }, 80);
        });
      } catch {
        /* not Tauri */
      }
    })();
    return () => {
      gone = true;
      if (timer != null) window.clearTimeout(timer);
      unlisten?.();
    };
  }, [dragging, refreshBubbleOffset]);

  useEffect(() => {
    return () => {
      if (pendingClickRef.current != null) {
        window.clearTimeout(pendingClickRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const nextDone = new Set(petDoneTaskIds(tasks));
    const prev = spinWatchRef.current;
    if (
      shouldTriggerPetSpin({
        primed: prev.primed,
        prevKind: prev.kind,
        nextKind: focus.kind,
        prevDoneIds: prev.done,
        nextDoneIds: nextDone,
      })
    ) {
      setSpinSignal((n) => n + 1);
    }
    spinWatchRef.current = { primed: true, kind: focus.kind, done: nextDone };
  }, [focus.kind, tasks]);

  const closeMenu = useCallback(() => {
    setMenu(null);
    void petSetMenuOpen(false);
  }, []);

  const openTask = useCallback((sessionId: string) => {
    if (pendingClickRef.current != null) {
      window.clearTimeout(pendingClickRef.current);
      pendingClickRef.current = null;
    }
    void petFocusSession(sessionId);
  }, []);

  const openMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const clickX = e.clientX;
    const clickY = e.clientY;
    const overlayW = window.innerWidth;
    const overlayH = window.innerHeight;
    const local = placePetContextMenu({
      overlayW,
      overlayH,
      clickX,
      clickY,
      menuW: MENU_W,
      menuH: MENU_H,
      winX: 0,
      winY: 0,
      work: { x: 0, y: 0, w: overlayW, h: overlayH },
    });
    setMenu({ x: local.left, y: local.top });
    void petSetIgnoreCursor(false);
    void petSetMenuOpen(true);
    void (async () => {
      const frame = await petReadOverlayFrame();
      if (!frame) return;
      const pos = placePetContextMenu({
        overlayW: frame.overlayW,
        overlayH: frame.overlayH,
        clickX,
        clickY,
        menuW: MENU_W,
        menuH: MENU_H,
        winX: frame.winX,
        winY: frame.winY,
        work: frame.work,
      });
      setMenu((prev) => {
        if (!prev) return prev;
        if (prev.x === pos.left && prev.y === pos.top) return prev;
        return { x: pos.left, y: pos.top };
      });
    })();
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement | null)?.closest?.(".context-menu, .pet-bubbles")) {
        return;
      }
      if (menuOpen) {
        closeMenu();
        return;
      }
      originRef.current = { x: e.screenX, y: e.screenY };
      lastScreenRef.current = { x: e.screenX, y: e.screenY };
      accumRef.current = { x: 0, y: 0 };
      draggedRef.current = false;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture unsupported */
      }
    },
    [closeMenu, menuOpen],
  );

  const finishDrag = useCallback(() => {
    const moved = draggedRef.current;
    originRef.current = null;
    draggedRef.current = false;
    setDragging(false);
    void petSetDragging(false);
    if (!moved) return;
    void petSyncOverlaySize(overlaySize.w, overlaySize.h).then(() => {
      void refreshBubbleOffset();
    });
  }, [overlaySize.h, overlaySize.w, refreshBubbleOffset]);

  useEffect(() => {
    const end = () => {
      // Only an in-progress OS drag. A click still has originRef but must
      // reach onPointerUp so double-click / open-session still works.
      if (!draggedRef.current) return;
      finishDrag();
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
    };
  }, [finishDrag]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!originRef.current) return;
      const step = petPointerStep(e, lastScreenRef.current);
      lastScreenRef.current = step.nextScreen;
      accumRef.current = {
        x: accumRef.current.x + step.dx,
        y: accumRef.current.y + step.dy,
      };
      if (!draggedRef.current) {
        if (!petDragPassedSlop(accumRef.current.x, accumRef.current.y, PET_DRAG_SLOP)) {
          return;
        }
        draggedRef.current = true;
        setDragging(true);
        void petSetIgnoreCursor(false);
        void petSetDragging(true);
        if (!manualDrag) {
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* capture was not held */
          }
          void petStartDragging().catch(() => {
            /* startDragging unavailable outside Tauri */
          });
        }
      }
      if (manualDrag && draggedRef.current && (step.dx || step.dy)) {
        void petNudge(step.dx, step.dy);
      }
    },
    [manualDrag],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const start = originRef.current;
      const moved = draggedRef.current;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      finishDrag();
      if (moved) return;
      if (!start) return;
      if (petDragPassedSlop(e.screenX - start.x, e.screenY - start.y)) return;
      const intent = petMarkClickIntent({
        pendingSingle: pendingClickRef.current != null,
        openedAt: openedAtRef.current,
        now: Date.now(),
      });
      if (intent === "hide-double" || intent === "hide-peek") {
        if (pendingClickRef.current != null) {
          window.clearTimeout(pendingClickRef.current);
          pendingClickRef.current = null;
        }
        openedAtRef.current = null;
        void petHideMain();
        return;
      }
      pendingClickRef.current = window.setTimeout(() => {
        pendingClickRef.current = null;
        setEmoteSignal((n) => n + 1);
        if (focus.sessionId) void petFocusSession(focus.sessionId);
        else void petShowMain();
        openedAtRef.current = Date.now();
      }, PET_DBLCLICK_MS);
    },
    [finishDrag, focus.sessionId],
  );

  return (
    <div
      ref={overlayRef}
      className={
        "pet-overlay" +
        (dragging ? " is-dragging" : "") +
        (bubblesOn && tasks.length ? " has-bubbles" : "")
      }
      onContextMenu={openMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        finishDrag();
      }}
    >
      {bubblesOn ? (
        <div
          className="pet-bubbles-slot"
          style={{
            transform: `translateX(${bubbleDx}px)`,
            height: petBubbleViewportHeight(),
          }}
        >
          <PetTaskBubbles
            tasks={tasks}
            t={t}
            onOpen={openTask}
            listRef={stackRef}
            bubbleShape={bubbleShape}
            bubbleStyle={bubbleStyle}
            progressBar={progressBar}
          />
        </div>
      ) : null}
      <div ref={markRef} className="pet-overlay__hit">
        <PetMark
          shape={shape}
          color={color}
          eyeColor={eyeColor}
          verb={verb}
          sizePx={sizePx}
          title={title}
          dragging={dragging}
          spinSignal={spinSignal}
          emoteSignal={emoteSignal}
        />
      </div>
      <ContextMenu
        open={menuOpen}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={closeMenu}
        estimatedWidth={MENU_W}
        estimatedHeight={MENU_H}
        items={[
          {
            id: "pet-spin",
            label: t("pet.menu.spin"),
            onClick: () => {
              setSpinSignal((n) => n + 1);
            },
          },
          {
            id: "pet-emote",
            label: t("pet.menu.emote"),
            onClick: () => {
              setEmoteSignal((n) => n + 1);
            },
          },
          { id: "pet-sep-spin", separator: true },
          {
            id: "pet-settings",
            label: t("pet.menu.settings"),
            onClick: () => {
              void petOpenSettings();
            },
          },
          {
            id: "pet-bubbles",
            label: bubblesOn
              ? t("pet.menu.hideBubbles")
              : t("pet.menu.showBubbles"),
            onClick: () => {
              void petPrefsSet({ ...prefs, bubblesEnabled: !bubblesOn });
            },
          },
          { id: "pet-sep", separator: true },
          {
            id: "pet-hide",
            label: t("pet.menu.hide"),
            onClick: () => {
              void petHide();
            },
          },
        ]}
      />
    </div>
  );
}
