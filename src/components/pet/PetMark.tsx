/**
 * Living mark — port of Grok Bot / Sand `$_t` renderer:
 * clip-path body, --fg/--bg eyes, spring pose, 25 eye topologies, state table.
 */
import { useEffect, useId, useRef } from "react";
import { listen } from "@/lib/api/host";
import type { PetColor, PetEyeColor, PetShape, PetVerb } from "@/lib/pet";
import { PET_INK, petEyeFill } from "@/lib/pet";
import shapes from "@/lib/pet/data/shapes.json";
import eyes from "@/lib/pet/data/eyes.json";
import {
  MARK_CENTER as Re,
  MARK_VIEWBOX,
  STATE_BLINK,
  STATE_TOPO_HOLD,
  STATE_TOPOLOGIES,
  verbToMarkState,
} from "@/lib/pet/markTables";
import {
  clamp,
  gazeFromDelta,
  gazeFromPointer,
  lerpPts,
  polyPath,
  randBetween,
  spring,
  stepSpring,
  type Spring,
} from "@/lib/pet/markMath";

type ShapeRec = {
  path: string;
  face: { x: number; y: number; sx: number; sy: number; eye: number; leftDX?: number };
  top: number;
  bottom: number;
};

const SHAPES = shapes as Record<string, ShapeRec>;
const EYES = eyes as number[][][][];

function applyPose(state: string, tSec: number, age: number, pose: {
  turn: Spring;
  tilt: Spring;
  bob: Spring;
  scale: Spring;
  lid: Spring;
}) {
  const mt = tSec;
  const Dt = age;
  let lid = 1;
  switch (state) {
    case "sleeping":
      pose.turn.t = 4 + Math.sin(mt * 0.25) * 2;
      pose.tilt.t = -2;
      pose.bob.t = 8 + Math.sin(mt * 0.55) * 3;
      pose.scale.t = 1 + Math.sin(mt * 0.55) * 0.016;
      lid = 0.08;
      break;
    case "waking":
      if (Dt < 0.5) {
        lid = 0.07;
        pose.bob.t = 6;
      } else if (Dt < 1.2) {
        lid = 1;
        pose.bob.t = -5;
        pose.tilt.t = 0;
        pose.scale.t = 1.04;
      } else {
        pose.bob.t = Math.sin(mt * 0.9) * 2;
        pose.scale.t = 1;
        lid = 1;
      }
      break;
    case "idle":
      pose.turn.t = Math.sin(mt * 0.5) * 1.5 + Math.sin(mt * 0.17) * 0.6;
      pose.tilt.t = Math.sin(mt * 0.27) * 1;
      pose.bob.t = Math.sin(mt * 0.85) * 1.2;
      pose.scale.t = 1 + Math.sin(mt * 0.85) * 0.007;
      break;
    case "listening":
      pose.turn.t = 8 + Math.sin(mt * 0.5) * 1.5;
      pose.tilt.t = 2;
      pose.bob.t = -2 + Math.sin(mt * 0.8) * 0.8;
      pose.scale.t = 1.015;
      break;
    case "thinking":
      pose.turn.t = -9 + Math.sin(mt * 0.35) * 5;
      pose.tilt.t = Math.sin(mt * 0.3) * 5;
      pose.bob.t = Math.sin(mt * 0.6) * 2.5;
      pose.scale.t = 1;
      break;
    case "searching": {
      const w = Math.sin(mt * 1.3);
      pose.turn.t = w * 13;
      pose.tilt.t = w * 7;
      pose.bob.t = Math.sin(mt * 1.7) * 3;
      pose.scale.t = 1;
      break;
    }
    case "working": {
      const w = Math.sin(mt * Math.PI * 2 * 1.6);
      pose.turn.t = 4 + w * 2.5;
      pose.tilt.t = 3;
      pose.bob.t = 1.5 + Math.max(0, w) * 3;
      pose.scale.t = 1 - Math.max(0, w) * 0.02;
      break;
    }
    case "sad":
      pose.turn.t = 3 + Math.sin(mt * 0.3) * 2;
      pose.tilt.t = Math.sin(mt * 0.25) * 1.5;
      pose.bob.t = 7 + Math.sin(mt * 0.4);
      pose.scale.t = 0.97;
      lid = 0.7;
      break;
    case "notifying":
      pose.turn.t = 3;
      pose.tilt.t = 2;
      pose.bob.t = -1;
      pose.scale.t = 1 + 0.05 * Math.exp(-Dt * 3);
      break;
    case "dragging":
      pose.turn.t = Math.sin(mt * 2.6) * 6;
      pose.tilt.t = 16;
      pose.bob.t = Math.sin(mt * 1.4) * 2;
      pose.scale.t = 1;
      break;
    default:
      pose.turn.t = Math.sin(mt * 0.5) * 1.5;
      pose.tilt.t = Math.sin(mt * 0.27);
      pose.bob.t = Math.sin(mt * 0.85) * 1.2;
      pose.scale.t = 1 + Math.sin(mt * 0.85) * 0.007;
  }
  pose.lid.t = lid;
}

export function PetMark({
  shape = "hex",
  color = "green",
  eyeColor = "auto",
  verb = "idle",
  sizePx = 128,
  title,
  paused = false,
}: {
  shape?: PetShape | string;
  color?: PetColor;
  eyeColor?: PetEyeColor | string;
  verb?: PetVerb | string;
  sizePx?: number;
  title?: string;
  paused?: boolean;
}) {
  const rec = SHAPES[shape] ?? SHAPES.hex;
  const ink = PET_INK[color] ?? PET_INK.green;
  const eyeFill = petEyeFill(eyeColor, color);
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const eye0Ref = useRef<SVGPathElement>(null);
  const eye1Ref = useRef<SVGPathElement>(null);
  const clipRef = useRef<SVGPathElement>(null);
  const stateRef = useRef(verbToMarkState(verb));
  const shapeRef = useRef(shape);
  const pausedRef = useRef(paused);
  const startedRef = useRef(0);
  stateRef.current = verbToMarkState(verb);
  shapeRef.current = shape;
  pausedRef.current = paused;

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || pausedRef.current) return;

    const pose = {
      turn: spring(0),
      tilt: spring(0),
      bob: spring(0),
      scale: spring(1),
      lid: spring(1),
    };
    const morph = spring(1);
    const gazeX = spring(0);
    const gazeY = spring(0);
    const look = { dx: 0, dy: 0, localR: 48, at: 0, fromScreen: false };
    let unlistenCursor: (() => void) | undefined;

    const onPointerMove = (e: PointerEvent) => {
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
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);
    void listen<{ dx?: number; dy?: number; localR?: number }>("pet://cursor", (p) => {
      if (p == null || typeof p.dx !== "number" || typeof p.dy !== "number") return;
      look.dx = p.dx;
      look.dy = p.dy;
      look.localR = typeof p.localR === "number" && p.localR > 0 ? p.localR : 64;
      look.fromScreen = true;
      look.at = performance.now();
    }).then((u) => {
      unlistenCursor = u;
    });

    let topoIdx = 0;
    let fromEyes = [EYES[0][0], EYES[0][1]] as number[][][];
    let toEyes = fromEyes;
    let nextTopoAt = 0;
    let nextBlinkAt = 0;
    let blinkingUntil = 0;
    let gazeUntil = 0;
    let raf = 0;
    let last = performance.now();
    startedRef.current = last;
    let lastState = "";

    const pickTopo = (state: string, hop = false) => {
      const list = STATE_TOPOLOGIES[state] ?? STATE_TOPOLOGIES.idle;
      if (hop) {
        topoIdx = (topoIdx + 1 + Math.floor(Math.random() * Math.max(1, list.length - 1))) % list.length;
      } else {
        topoIdx = 0;
      }
      const id = list[topoIdx] ?? 0;
      const pair = EYES[id] ?? EYES[0];
      const t = Math.min(Math.max(morph.x, 0), 1);
      fromEyes = [lerpPts(fromEyes[0], toEyes[0], t), lerpPts(fromEyes[1], toEyes[1], t)];
      toEyes = [pair[0], pair[1]];
      morph.x = 0;
      morph.v = 0;
      morph.t = 1;
    };

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const state = stateRef.current;
      const age = (now - startedRef.current) / 1000;
      if (state !== lastState) {
        lastState = state;
        startedRef.current = now;
        pickTopo(state, false);
        const hold = STATE_TOPO_HOLD[state] ?? [4000, 8000];
        nextTopoAt = now + randBetween(hold[0], hold[1]);
        const blink = STATE_BLINK[state];
        nextBlinkAt = blink ? now + randBetween(blink[0], blink[1]) : Number.POSITIVE_INFINITY;
        blinkingUntil = 0;
      }

      applyPose(state, now / 1000, age, pose);

      if (now >= nextTopoAt) {
        pickTopo(state, true);
        const hold = STATE_TOPO_HOLD[state] ?? [4000, 8000];
        nextTopoAt = now + randBetween(hold[0], hold[1]);
      }
      if (now >= nextBlinkAt) {
        blinkingUntil = now + 160;
        const blink = STATE_BLINK[state];
        nextBlinkAt = blink ? now + randBetween(blink[0], blink[1]) : Number.POSITIVE_INFINITY;
      }
      if (now < blinkingUntil) {
        const u = 1 - (blinkingUntil - now) / 160;
        pose.lid.t = u < 0.45 ? 0.06 : pose.lid.t;
      }
      const tracking =
        look.at > 0 && now - look.at < 280 && state !== "sleeping" && state !== "dragging";
      if (tracking) {
        const g = look.fromScreen
          ? gazeFromDelta(look.dx, look.dy, look.localR)
          : svgRef.current
            ? gazeFromPointer(look.dx, look.dy, svgRef.current.getBoundingClientRect())
            : { x: 0, y: 0 };
        gazeX.t = g.x;
        gazeY.t = g.y;
        pose.turn.t = g.x * 0.32;
        pose.tilt.t = g.y * 0.22;
        gazeUntil = now + 640;
      } else if (now >= gazeUntil) {
        gazeX.t = randBetween(-0.4, 0.4) * 15;
        gazeY.t = randBetween(-0.3, 0.3) * 9;
        gazeUntil = now + randBetween(1800, 4200);
      }

      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        stepSpring(morph, 7, 1, h);
        stepSpring(pose.turn, 5, 0.9, h);
        stepSpring(pose.tilt, 3.5, 1, h);
        stepSpring(pose.bob, 4, 1, h);
        stepSpring(pose.scale, 10, 0.8, h);
        stepSpring(pose.lid, 26, 1, h);
        stepSpring(gazeX, tracking ? 16 : 13, 1, h);
        stepSpring(gazeY, tracking ? 16 : 13, 1, h);
      }

      const recNow = SHAPES[shapeRef.current] ?? SHAPES.hex;
      const t = clamp(morph.x, 0, 1);
      const e0 = lerpPts(fromEyes[0], toEyes[0], t);
      const e1 = lerpPts(fromEyes[1], toEyes[1], t);
      const face = recNow.face;
      const lid = clamp(pose.lid.x, 0.04, 1.2);
      const eyeS = face.eye * (8 / 9);
      const lookAmp = tracking ? 1 : 0.35;
      const place = (pts: number[][], side: 0 | 1) => {
        const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
        const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        const dx = (cx - Re) * face.sx + gazeX.x * lookAmp + (side === 0 ? (face.leftDX ?? 0) : 0);
        const dy = (cy - Re) * face.sy + gazeY.x * lookAmp;
        return pts.map(([x, y]) => [
          Re + face.x + (x - cx) * eyeS + dx,
          Re + face.y + (y - cy) * eyeS * lid + dy,
        ]);
      };
      eye0Ref.current?.setAttribute("d", polyPath(place(e0, 0)));
      eye1Ref.current?.setAttribute("d", polyPath(place(e1, 1)));
      pathRef.current?.setAttribute("d", recNow.path);
      clipRef.current?.setAttribute("d", recNow.path);

      if (bodyRef.current) {
        const tx = pose.tilt.x;
        const ty = pose.bob.x;
        const rot = pose.turn.x;
        const sc = pose.scale.x;
        bodyRef.current.setAttribute(
          "transform",
          `translate(${(Re + tx).toFixed(2)} ${(Re + ty).toFixed(2)}) rotate(${rot.toFixed(2)}) scale(${sc.toFixed(4)} ${sc.toFixed(4)}) translate(${-Re} ${-Re})`,
        );
      }

      if (!pausedRef.current) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      unlistenCursor?.();
    };
  }, [shape, verb, paused]);

  const fill = `light-dark(${ink.light}, ${ink.dark})`;

  return (
    <svg
      ref={svgRef}
      className="pet-mark"
      width={sizePx}
      height={sizePx}
      viewBox={MARK_VIEWBOX}
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
        <clipPath id={`pet-clip-${uid}`}>
          <path ref={clipRef} d={rec.path} />
        </clipPath>
      </defs>
      <g ref={bodyRef}>
        <path ref={pathRef} d={rec.path} fill={fill} />
        <g clipPath={`url(#pet-clip-${uid})`}>
          <path ref={eye0Ref} d={polyPath(EYES[0][0])} fill={eyeFill} />
          <path ref={eye1Ref} d={polyPath(EYES[0][1])} fill={eyeFill} />
        </g>
      </g>
    </svg>
  );
}
