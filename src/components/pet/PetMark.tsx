/**
 * Living mark — bloub BotEngine (radial morph, mask-hole eyes, measured states).
 * Overlay chrome (drag, bubbles, menu) stays outside this renderer.
 *
 * Per-frame data bypasses React: the paint loop writes attributes through refs
 * (fixed element pools), so a 30fps overlay never re-reconciles the SVG. React
 * only owns the static shell and prop-driven bits (size, colors, title).
 */
import { useEffect, useId, useRef } from "react";
import { listen } from "@/lib/api/host";
import { petReadOverlayFrame, type PetOverlayFrame } from "@/lib/api/pet";
import type { PetColor, PetEyeColor, PetShape, PetVerb } from "@/lib/pet";
import { isPetColor, resolvePetBodyInk, resolvePetEyeInk } from "@/lib/pet";
import {
  BotEngine,
  DEMI_VIEWBOX,
  POSES,
  RAYON,
  mixHex,
  type BotFrame,
} from "@/lib/pet/bloub";
import {
  bloubExpressionOf,
  bloubLookAtPointer,
  bloubNotifFill,
  bloubShapeRadii,
  bloubShouldLoop,
  bloubStateDuration,
  normalizePetExpression,
  resolveBloubPlay,
} from "@/lib/pet/bloubPlay";
import { pickRestEmote, resolveLivingMood } from "@/lib/pet/petMood";
import { petLookIsNear, petPaintMinMs } from "@/lib/pet/petMarkPaint";
import {
  petMarkScreenCenter,
  petNormXOnWorkArea,
  petShouldMirrorFace,
  petShouldMirrorFromOverlay,
} from "@/lib/pet/petFaceMirror";
import { MARK_CENTER, verbToMarkState } from "@/lib/pet/markTables";
import { createMarkOrbit } from "@/lib/pet/markOrbit";
import {
  beginPetSpin,
  petSpinWantsBurst,
  pickPetSpinKind,
  stepPetSpin,
  type PetSpinKind,
  type PetSpinRun,
} from "@/lib/pet/markSpin";
import { clamp } from "@/lib/pet/markMath";

/** Pool sizes cover the worst engine blend: orbit(6)+comet(4) arcs,
 * particles(5)+particles(5) dots, always 2 eyes and 3 gradient stops. */
const EYE_SLOTS = 2;
const ARC_SLOTS = 12;
const DOT_SLOTS = 16;

function dotFill(dot: { color?: string; depth?: number }, ink: string, paper: string): string {
  return dot.color ?? (dot.depth === undefined ? ink : mixHex(paper, ink, dot.depth));
}

/** Per-element attribute cache: the paint loop runs at 20-30fps and most slots
 * stay empty or unchanged, so skip every redundant setAttribute (each one can
 * invalidate SVG layout/paint in WebView2). React owns the initial JSX values;
 * the cache only needs to track what this loop last wrote. */
type CachedEl = Element & { _petAttrs?: Record<string, number | string> };

function setAttrNum(el: CachedEl | null, name: string, value: number): void {
  if (!el) return;
  const cache = el._petAttrs ?? (el._petAttrs = {});
  if (cache[name] === value) return;
  cache[name] = value;
  el.setAttribute(name, String(value));
}

function setAttrStr(el: CachedEl | null, name: string, value: string): void {
  if (!el) return;
  const cache = el._petAttrs ?? (el._petAttrs = {});
  if (cache[name] === value) return;
  cache[name] = value;
  el.setAttribute(name, value);
}

export function PetMark({
  shape = "hex",
  color = "green",
  verb = "idle",
  sizePx = 128,
  title,
  paused = false,
  spinSignal = 0,
  emoteSignal = 0,
  dragging = false,
  eyeColor = "auto",
  expression = "neutre",
  restOnly = false,
}: {
  shape?: PetShape | string;
  color?: PetColor;
  eyeColor?: PetEyeColor;
  verb?: PetVerb | string;
  sizePx?: number;
  title?: string;
  paused?: boolean;
  dragging?: boolean;
  spinSignal?: number;
  emoteSignal?: number;
  expression?: string;
  /** Settings picker: selected rest face only — no hover / idle bursts. */
  restOnly?: boolean;
}) {
  const fill = resolvePetBodyInk(isPetColor(color) ? color : "green");
  const eyeInk = resolvePetEyeInk(isPetColor(color) ? color : "green", eyeColor);
  const restExpr = normalizePetExpression(expression);
  const uid = useId().replace(/:/g, "");
  const maskId = `pet-mask-${uid}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const bodySpinRef = useRef<SVGGElement>(null);
  const orbitBackRef = useRef<SVGGElement>(null);
  const orbitFrontRef = useRef<SVGGElement>(null);
  const engineRef = useRef<BotEngine | null>(null);
  const clockRef = useRef(0);
  const verbRef = useRef(verb);
  const shapeRef = useRef(shape);
  const restRef = useRef(restExpr);
  const pausedRef = useRef(paused);
  const draggingRef = useRef(dragging);
  const restOnlyRef = useRef(restOnly);
  const wantSpinRef = useRef(0);
  const playedSpinRef = useRef(0);
  const wantEmoteRef = useRef(0);
  const playedEmoteRef = useRef(0);
  const applyFrameRef = useRef<(frame: BotFrame) => void>(() => {});
  const maskBodyRef = useRef<SVGPathElement | null>(null);
  const eyeRefs = useRef<(SVGPathElement | null)[]>([]);
  const notchRef = useRef<SVGCircleElement | null>(null);
  const gradRefs = useRef<(SVGGradientElement | SVGStopElement | null)[][]>([]);
  const arcBackRefs = useRef<(SVGPathElement | null)[]>([]);
  const arcFrontRefs = useRef<(SVGPathElement | null)[]>([]);
  const dotBackCircles = useRef<(SVGCircleElement | null)[]>([]);
  const dotBackPaths = useRef<(SVGPathElement | null)[]>([]);
  const dotFrontCircles = useRef<(SVGCircleElement | null)[]>([]);
  const dotFrontPaths = useRef<(SVGPathElement | null)[]>([]);
  const dotsBehindRef = useRef(false);
  const bodyAlphaRef = useRef<SVGGElement | null>(null);
  const bodyFillRef = useRef<SVGPathElement | null>(null);
  const notifRef = useRef<SVGCircleElement | null>(null);
  verbRef.current = verb;
  shapeRef.current = shape;
  restRef.current = restExpr;
  pausedRef.current = paused;
  draggingRef.current = dragging;
  restOnlyRef.current = restOnly;
  if (spinSignal > 0) wantSpinRef.current = spinSignal;
  if (emoteSignal > 0) wantEmoteRef.current = emoteSignal;

  applyFrameRef.current = (frame: BotFrame) => {
    setAttrStr(maskBodyRef.current as CachedEl | null, "d", frame.bodyPath);
    setAttrStr(bodyFillRef.current as CachedEl | null, "d", frame.bodyPath);
    setAttrNum(bodyAlphaRef.current as CachedEl | null, "opacity", frame.bodyAlpha);
    for (let i = 0; i < EYE_SLOTS; i++) {
      const el = eyeRefs.current[i] as CachedEl | null;
      if (!el) continue;
      const eye = frame.eyes[i];
      if (!eye) {
        setAttrNum(el, "opacity", 0);
        continue;
      }
      setAttrStr(el, "d", eye.d);
      setAttrStr(el, "transform", eye.matrix);
      setAttrNum(el, "opacity", eye.alpha);
    }
    const notch = notchRef.current as CachedEl | null;
    if (notch) {
      const n = frame.notch;
      setAttrNum(notch, "cx", n?.x ?? 0);
      setAttrNum(notch, "cy", n?.y ?? 0);
      setAttrNum(notch, "r", n?.r ?? 0);
      setAttrNum(notch, "opacity", n ? 1 : 0);
    }
    for (let i = 0; i < ARC_SLOTS; i++) {
      const back = arcBackRefs.current[i] as CachedEl | null;
      const front = arcFrontRefs.current[i] as CachedEl | null;
      if (!back || !front) continue;
      const arc = frame.arcs[i];
      if (!arc) {
        setAttrNum(back, "opacity", 0);
        setAttrNum(front, "opacity", 0);
        continue;
      }
      const pool = gradRefs.current[i];
      const grad = pool?.[0] as CachedEl | null;
      if (grad) {
        setAttrNum(grad, "x1", arc.grad.x1);
        setAttrNum(grad, "y1", arc.grad.y1);
        setAttrNum(grad, "x2", arc.grad.x2);
        setAttrNum(grad, "y2", arc.grad.y2);
        for (let j = 0; j < 3; j++) {
          setAttrStr((pool?.[j + 1] ?? null) as CachedEl | null, "stop-color", arc.grad.stops[j] ?? "#fff");
        }
      }
      setAttrStr(back, "d", arc.back);
      setAttrNum(back, "stroke-width", arc.width);
      setAttrNum(back, "opacity", arc.opacity);
      setAttrStr(front, "d", arc.front);
      setAttrNum(front, "stroke-width", arc.width);
      setAttrNum(front, "opacity", arc.opacity);
    }
    // Dots swap between the behind/front groups only when the flag flips.
    if (dotsBehindRef.current !== frame.dotsBehind) {
      dotsBehindRef.current = frame.dotsBehind;
      const idle = frame.dotsBehind ? [dotFrontCircles.current, dotFrontPaths.current] : [dotBackCircles.current, dotBackPaths.current];
      for (const nodes of idle) {
        for (const node of nodes) setAttrNum(node as CachedEl | null, "opacity", 0);
      }
    }
    const circles = frame.dotsBehind ? dotBackCircles.current : dotFrontCircles.current;
    const paths = frame.dotsBehind ? dotBackPaths.current : dotFrontPaths.current;
    for (let i = 0; i < DOT_SLOTS; i++) {
      const circ = circles[i] as CachedEl | null;
      const path = paths[i] as CachedEl | null;
      if (!circ || !path) continue;
      const dot = frame.dots[i];
      if (!dot) {
        setAttrNum(circ, "opacity", 0);
        setAttrNum(path, "opacity", 0);
        continue;
      }
      const fill = dotFill(dot, ink, paper);
      setAttrNum(circ, "cx", dot.x);
      setAttrNum(circ, "cy", dot.y);
      setAttrNum(circ, "r", dot.r);
      setAttrStr(circ, "fill", fill);
      setAttrStr(path, "transform", `translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${RAYON})`);
      setAttrStr(path, "fill", fill);
      if (dot.d) {
        setAttrStr(path, "d", dot.d);
        setAttrNum(path, "opacity", dot.opacity);
        setAttrNum(circ, "opacity", 0);
      } else {
        setAttrNum(circ, "opacity", dot.opacity);
        setAttrNum(path, "opacity", 0);
      }
    }
    const notif = notifRef.current as CachedEl | null;
    if (notif) {
      const n = frame.notif;
      setAttrNum(notif, "cx", n?.x ?? 0);
      setAttrNum(notif, "cy", n?.y ?? 0);
      setAttrNum(notif, "r", n?.r ?? 0);
      setAttrNum(notif, "opacity", n ? 1 : 0);
    }
  };

  useEffect(() => {
    const hadEngine = engineRef.current != null;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const engine =
      engineRef.current ??
      new BotEngine(
        RAYON,
        "idle",
        bloubShapeRadii(shapeRef.current),
        bloubExpressionOf(restRef.current),
      );
    engineRef.current = engine;
    if (!hadEngine) {
      const play0 = resolveBloubPlay(verbToMarkState(verbRef.current), restRef.current);
      engine.setState(play0.state, 0);
      engine.setExpression(bloubExpressionOf(play0.expression), 0);
      applyFrameRef.current(
        engine.sample(pausedRef.current ? (POSES[play0.state] ?? 1) : 0),
      );
    }

    const look = { dx: 0, dy: 0, localR: 48, at: 0, fromScreen: false };
    let unlistenCursor: (() => void) | undefined;
    let aiming = false;
    let mirrored = false;
    let markBox: DOMRect | null = null;
    let markBoxAt = 0;
    let overlayFrame: PetOverlayFrame | null = null;
    let overlayFrameBusy = false;
    const pullOverlayFrame = () => {
      if (overlayFrameBusy || restOnlyRef.current) return;
      overlayFrameBusy = true;
      void petReadOverlayFrame().then((frame) => {
        overlayFrameBusy = false;
        if (frame) overlayFrame = frame;
      });
    };
    const measureMark = () => {
      const now = performance.now();
      if (!markBox || now - markBoxAt > 500) {
        markBox = svgRef.current?.getBoundingClientRect() ?? null;
        markBoxAt = now;
      }
      return markBox;
    };
    const syncFaceMirror = () => {
      const svg = svgRef.current;
      if (!svg || typeof window === "undefined") return;
      if (restOnlyRef.current) {
        svg.style.transform = "";
        mirrored = false;
        return;
      }
      if (draggingRef.current) {
        markBox = svg.getBoundingClientRect();
        markBoxAt = performance.now();
        pullOverlayFrame();
      }
      const box = measureMark();
      if (!box) return;
      if (overlayFrame) {
        mirrored = petShouldMirrorFromOverlay({
          winX: overlayFrame.winX,
          markLeft: box.left,
          markWidth: box.width,
          workX: overlayFrame.work.x,
          workW: overlayFrame.work.w,
        });
      } else {
        const { cx } = petMarkScreenCenter({
          screenX: window.screenX,
          screenY: window.screenY,
          rect: box,
        });
        const nx = petNormXOnWorkArea({
          cx,
          left: 0,
          width: window.screen.availWidth || window.innerWidth || 1,
        });
        mirrored = petShouldMirrorFace(nx);
      }
      svg.style.transform = mirrored ? "scaleX(-1)" : "";
      svg.style.transformOrigin = "center center";
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (look.fromScreen && performance.now() - look.at < 180) return;
      look.dx = e.clientX;
      look.dy = e.clientY;
      look.localR = 0;
      look.fromScreen = false;
      look.at = performance.now();
    };
    const onPointerLeave = () => {
      if (!look.fromScreen) look.at = 0;
    };

    let unlistenMoved: (() => void) | undefined;
    if (!pausedRef.current && !reduce && !restOnlyRef.current) {
      pullOverlayFrame();
      void (async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          unlistenMoved = await getCurrentWindow().onMoved(() => {
            pullOverlayFrame();
          });
        } catch {
          /* browser / tests */
        }
      })();
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("pointerleave", onPointerLeave);
      void listen<{ dx?: number; dy?: number; localR?: number }>(
        "pet://cursor",
        (p) => {
          if (p == null || typeof p.dx !== "number" || typeof p.dy !== "number") {
            return;
          }
          look.dx = p.dx;
          look.dy = p.dy;
          look.localR =
            typeof p.localR === "number" && p.localR > 0 ? p.localR : 64;
          look.fromScreen = true;
          look.at = performance.now();
        },
      ).then((u) => {
        unlistenCursor = u;
      });
    }

    let raf = 0;
    let hoverSince = 0;
    let emoteMood = "";
    let emoteUntil = 0;
    let idleBurstMood = "";
    let idleBurstUntil = 0;
    let idleBurstNextAt = 0;
    let lastPlayState = engine.state;
    let stateSince = clockRef.current;
    let spin: PetSpinRun | null = null;
    let lastSpinKind: PetSpinKind | null = null;
    const orbit = createMarkOrbit({
      back: orbitBackRef.current,
      front: orbitFrontRef.current,
      idPrefix: uid,
      reduceMotion: reduce,
      radius: () => MARK_CENTER,
    });

    const resolvePlay = (nowMs: number) => {
      const session = verbToMarkState(verbRef.current);
      if (wantEmoteRef.current !== playedEmoteRef.current) {
        playedEmoteRef.current = wantEmoteRef.current;
        emoteMood = pickRestEmote(emoteMood);
        emoteUntil = nowMs + 2600;
      }
      if (restOnlyRef.current) {
        return resolveBloubPlay(session, restRef.current);
      }
      const nearMark = petLookIsNear({
        fromScreen: look.fromScreen,
        at: look.at,
        now: nowMs,
        dx: look.dx,
        dy: look.dy,
        localR: look.localR || 64,
      });
      const trackingLook =
        nearMark &&
        session !== "sleeping" &&
        session !== "dragging" &&
        !draggingRef.current;
      if (trackingLook && session === "idle") {
        if (!hoverSince) hoverSince = nowMs;
      } else {
        hoverSince = 0;
      }
      if (session === "idle" && !draggingRef.current && emoteUntil <= nowMs) {
        if (!idleBurstNextAt) {
          idleBurstNextAt = nowMs + 8000 + Math.random() * 8000;
        } else if (nowMs >= idleBurstNextAt) {
          idleBurstMood = pickRestEmote(idleBurstMood);
          idleBurstUntil = nowMs + 2200 + Math.random() * 1800;
          idleBurstNextAt = idleBurstUntil + 8000 + Math.random() * 8000;
        }
      }
      const mood = resolveLivingMood({
        sessionVerb: session,
        now: nowMs,
        dragging: draggingRef.current,
        hovering: hoverSince > 0,
        hoverMs: hoverSince > 0 ? nowMs - hoverSince : 0,
        emoteMood,
        emoteUntil,
        idleBurstMood,
        idleBurstUntil,
      });
      return resolveBloubPlay(mood, restRef.current);
    };

    const paint = (clock: number, dt: number) => {
      const nowMs = performance.now();
      if (wantSpinRef.current !== playedSpinRef.current) {
        playedSpinRef.current = wantSpinRef.current;
        if (!pausedRef.current && !reduce) {
          const kind = pickPetSpinKind(lastSpinKind);
          lastSpinKind = kind;
          spin = beginPetSpin(kind, nowMs);
          if (petSpinWantsBurst(kind)) orbit.burst(16, 0.95, 0.3);
        }
      }
      const play = resolvePlay(nowMs);
      engine.setShape(bloubShapeRadii(shapeRef.current), clock);
      engine.setExpression(bloubExpressionOf(play.expression), clock);
      if (play.state !== lastPlayState) {
        engine.setState(play.state, clock);
        lastPlayState = play.state;
        stateSince = clock;
      } else if (
        bloubShouldLoop(play.state) &&
        clock - stateSince >= bloubStateDuration(play.state)
      ) {
        engine.reset(play.state, clock);
        stateSince = clock;
      }
      const frozen = pausedRef.current || reduce;
      const t = frozen ? (POSES[play.state] ?? 1) : clock;
      syncFaceMirror();
      const baseFace =
        play.state === "idle" || play.state === "swirl";
      const fresh = petLookIsNear({
        fromScreen: look.fromScreen,
        at: look.at,
        now: nowMs,
        dx: look.dx,
        dy: look.dy,
        localR: look.localR || 64,
      });
      if (!baseFace || !fresh || restOnlyRef.current) {
        if (aiming) {
          engine.setLook(null, clock);
          aiming = false;
        }
      } else {
        const box = measureMark();
        let nx = 0;
        let ny = 0;
        if (look.fromScreen) {
          const r = look.localR || 64;
          nx = look.dx / Math.max(1, r);
          ny = look.dy / Math.max(1, r);
        } else if (box && box.width > 0 && box.height > 0) {
          nx = (look.dx - (box.left + box.width / 2)) / Math.max(1, box.width);
          ny = (look.dy - (box.top + box.height / 2)) / Math.max(1, box.height);
        }
        if (Number.isFinite(nx) && Number.isFinite(ny)) {
          engine.setLook(
            bloubLookAtPointer(mirrored ? -nx : nx, ny, true),
            clock,
          );
          aiming = true;
        }
      }
      applyFrameRef.current(engine.sample(t));

      let spinAngle = 0;
      let extraRot = 0;
      let wobbleTurn = 0;
      let wobbleTilt = 0;
      let wobbleBob = 0;
      let bounceY = 0;
      let wideStyle = false;
      if (spin) {
        const sw = stepPetSpin(spin, nowMs, dt);
        if (sw.done) {
          spin = null;
        } else {
          spinAngle = sw.spinAngle;
          extraRot = sw.bodyRotDeg;
          wobbleTurn = sw.wobbleTurn;
          wobbleTilt = sw.wobbleTilt;
          wobbleBob = sw.wobbleBob;
          bounceY = sw.bounceY;
          wideStyle = sw.wideStyle;
        }
      }
      if (bodySpinRef.current) {
        const rot = extraRot + wobbleTurn;
        const tx = wobbleTilt;
        const ty = wobbleBob + bounceY;
        setAttrStr(
          bodySpinRef.current as CachedEl,
          "transform",
          `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) rotate(${rot.toFixed(2)})`,
        );
      }
      const markPx = measureMark()?.width ?? 128;
      const sizeScale = clamp((340 / Math.max(markPx, 1)) ** 0.7, 1, 2.6);
      orbit.update(nowMs, dt, {
        spinAngle,
        sizeScale,
        wideStyle,
        sustainBelts: false,
      });
    };

    if (pausedRef.current || reduce) {
      paint(clockRef.current, 0);
      return () => {
        orbit.clear();
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerleave", onPointerLeave);
        unlistenCursor?.();
      };
    }

    let lastPaint = 0;
    let idleSince = performance.now();
    const tick = (ms: number) => {
      const nowMs = performance.now();
      const trackingLook = petLookIsNear({
        fromScreen: look.fromScreen,
        at: look.at,
        now: nowMs,
        dx: look.dx,
        dy: look.dy,
        localR: look.localR || 64,
      });
      const morphing =
        wantSpinRef.current !== playedSpinRef.current ||
        clockRef.current - stateSince < 1.2;
      if (trackingLook || spin || morphing || draggingRef.current) {
        idleSince = nowMs;
      }
      const minMs = petPaintMinMs({
        spinning: spin != null || wantSpinRef.current !== playedSpinRef.current,
        morphing,
        trackingLook: trackingLook || draggingRef.current,
        idleMs: nowMs - idleSince,
      });
      if (lastPaint && ms - lastPaint < minMs) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const dt = lastPaint ? Math.min((ms - lastPaint) / 1000, 0.064) : 0;
      lastPaint = ms;
      clockRef.current += dt;
      paint(clockRef.current, dt);
      raf = requestAnimationFrame(tick);
    };
    const startTick = () => {
      if (raf) return;
      lastPaint = 0;
      raf = requestAnimationFrame(tick);
    };
    const stopTick = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
      orbit.clear();
    };
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.hidden) stopTick();
      else startTick();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    if (typeof document === "undefined" || !document.hidden) startTick();
    return () => {
      stopTick();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      unlistenCursor?.();
      unlistenMoved?.();
    };
  }, [paused, uid]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const play = resolveBloubPlay(verbToMarkState(verb), restExpr);
    engine.setShape(bloubShapeRadii(shape), clockRef.current);
    engine.setExpression(bloubExpressionOf(play.expression), clockRef.current);
    if (paused) {
      engine.reset(play.state, 0);
      applyFrameRef.current(engine.sample(POSES[play.state] ?? 1));
    }
  }, [paused, shape, verb, restExpr]);

  const paper = eyeInk;
  const ink = fill;
  const notifFill = bloubNotifFill(ink);
  const vb = DEMI_VIEWBOX;

  return (
    <svg
      ref={svgRef}
      className="pet-mark"
      width={sizePx}
      height={sizePx}
      viewBox={`${-vb} ${-vb} ${vb * 2} ${vb * 2}`}
      role="img"
      aria-label={title}
      data-state={verbToMarkState(verb)}
      xmlns="http://www.w3.org/2000/svg"
      style={{
        display: "block",
        overflow: "visible",
        userSelect: "none",
        ["--pet-ink" as string]: fill,
      }}
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x={-vb}
          y={-vb}
          width={vb * 2}
          height={vb * 2}
        >
          <path ref={maskBodyRef} d="" fill="#fff" />
          {Array.from({ length: EYE_SLOTS }, (_, i) => (
            <path
              key={i}
              ref={(el) => {
                eyeRefs.current[i] = el;
              }}
              d=""
              transform=""
              opacity={0}
              fill="#000"
            />
          ))}
          <circle ref={notchRef} cx={0} cy={0} r={0} opacity={0} fill="#000" />
        </mask>
        {Array.from({ length: ARC_SLOTS }, (_, i) => (
          <linearGradient
            key={i}
            ref={(el) => {
              gradRefs.current[i] = [
                el,
                ...(gradRefs.current[i]?.slice(1) ?? []),
              ];
            }}
            id={`${uid}-arc${i}`}
            gradientUnits="userSpaceOnUse"
            x1={0}
            y1={0}
            x2={0}
            y2={0}
          >
            {[0, 0.5, 1].map((offset, j) => (
              <stop
                key={j}
                ref={(el) => {
                  const pool = gradRefs.current[i] ?? [];
                  pool[j + 1] = el;
                  gradRefs.current[i] = pool;
                }}
                offset={offset}
                stopColor="#fff"
              />
            ))}
          </linearGradient>
        ))}
      </defs>
      <g
        ref={orbitBackRef}
        aria-hidden="true"
        transform={`translate(${-MARK_CENTER} ${-MARK_CENTER})`}
      />
      <g ref={bodySpinRef}>
        <g fill="none" strokeLinecap="round">
          {Array.from({ length: ARC_SLOTS }, (_, i) => (
            <path
              key={i}
              ref={(el) => {
                arcBackRefs.current[i] = el;
              }}
              d=""
              stroke={`url(#${uid}-arc${i})`}
              strokeWidth={0}
              opacity={0}
            />
          ))}
        </g>
        <g aria-hidden="true">
          {Array.from({ length: DOT_SLOTS }, (_, i) => (
            <g key={i}>
              <circle
                ref={(el) => {
                  dotBackCircles.current[i] = el;
                }}
                cx={0}
                cy={0}
                r={0}
                opacity={0}
                fill={ink}
              />
              <path
                ref={(el) => {
                  dotBackPaths.current[i] = el;
                }}
                d=""
                transform=""
                opacity={0}
                fill={ink}
              />
            </g>
          ))}
        </g>
        <g ref={bodyAlphaRef} opacity={1}>
          <path ref={bodyFillRef} d="" fill={paper} />
          <g mask={`url(#${maskId})`}>
            <rect x={-vb} y={-vb} width={vb * 2} height={vb * 2} fill={ink} />
          </g>
        </g>
        <g aria-hidden="true">
          {Array.from({ length: DOT_SLOTS }, (_, i) => (
            <g key={i}>
              <circle
                ref={(el) => {
                  dotFrontCircles.current[i] = el;
                }}
                cx={0}
                cy={0}
                r={0}
                opacity={0}
                fill={ink}
              />
              <path
                ref={(el) => {
                  dotFrontPaths.current[i] = el;
                }}
                d=""
                transform=""
                opacity={0}
                fill={ink}
              />
            </g>
          ))}
        </g>
        <circle ref={notifRef} cx={0} cy={0} r={0} opacity={0} fill={notifFill} />
        <g fill="none" strokeLinecap="round">
          {Array.from({ length: ARC_SLOTS }, (_, i) => (
            <path
              key={i}
              ref={(el) => {
                arcFrontRefs.current[i] = el;
              }}
              d=""
              stroke={`url(#${uid}-arc${i})`}
              strokeWidth={0}
              opacity={0}
            />
          ))}
        </g>
      </g>
      <g
        ref={orbitFrontRef}
        aria-hidden="true"
        transform={`translate(${-MARK_CENTER} ${-MARK_CENTER})`}
      />
    </svg>
  );
}
