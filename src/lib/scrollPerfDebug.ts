/**
 * Diagnostic telemetry logger for chat transcript scroll performance.
 * Accurately tracks two separate interaction phases:
 * 1. Active Input Phase (跟手阶段: while user fingers/wheel are actively moving)
 * 2. Momentum/Inertia Phase (离手抛滑阶段: coasting deceleration until physics fully settle)
 *
 * Collects FPS, frame delta histograms, long tasks, layout recomputes, and DOM mounts.
 */

interface FrameRecord {
  timestamp: number;
  delta: number;
  isMomentum: boolean;
}

interface ScrollSessionMetrics {
  startTime: number;
  lastInputTime: number;
  lastMotionTime: number;
  endTime: number;
  startScrollTop: number;
  releaseScrollTop: number;
  endScrollTop: number;
  frames: FrameRecord[];
  recomputeTimes: number[];
  nodeRailSyncTimes: number[];
  rowMountCount: number;
  rowRenderCount: number;
  virtualWindowSnapshots: Array<{
    start: number;
    end: number;
    total: number;
    scrollTop: number;
    scrollHeight: number;
    paddingTop: number;
    paddingBottom: number;
  }>;
  longTasks: Array<{ duration: number; startTime: number }>;
}

let activeSession: ScrollSessionMetrics | null = null;
let rafId: number | null = null;
let lastRafTime = 0;
let lastObservedScrollTop = 0;

let perfObserver: PerformanceObserver | null = null;
if (typeof window !== "undefined" && typeof PerformanceObserver !== "undefined") {
  try {
    perfObserver = new PerformanceObserver((list) => {
      if (!activeSession) return;
      for (const entry of list.getEntries()) {
        activeSession.longTasks.push({
          duration: entry.duration,
          startTime: entry.startTime,
        });
      }
    });
    perfObserver.observe({ entryTypes: ["longtask"] });
  } catch {
    /* longtask not supported in all webviews */
  }
}

function getActiveScrollElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return (
    document.querySelector<HTMLElement>(".lobe-chat__scroll") ||
    document.querySelector<HTMLElement>(".lobe-chat") ||
    (document.scrollingElement as HTMLElement | null)
  );
}

function readCurrentScrollTop(): number {
  const el = getActiveScrollElement();
  return el ? el.scrollTop : (typeof window !== "undefined" ? window.scrollY : 0);
}

function onRaf(now: number) {
  if (!activeSession) return;

  const currentScrollTop = readCurrentScrollTop();
  const scrollDelta = Math.abs(currentScrollTop - lastObservedScrollTop);
  if (scrollDelta > 0.5) {
    activeSession.lastMotionTime = now;
    lastObservedScrollTop = currentScrollTop;
  }

  // If user hasn't provided physical input in >100ms, mark current frames as Momentum Coasting
  const isMomentum = (now - activeSession.lastInputTime) > 100;
  if (isMomentum && activeSession.releaseScrollTop === 0) {
    activeSession.releaseScrollTop = currentScrollTop;
  }

  if (lastRafTime > 0) {
    const delta = now - lastRafTime;
    activeSession.frames.push({
      timestamp: now,
      delta,
      isMomentum,
    });
  }
  lastRafTime = now;

  // Physics settlement check:
  // User input ended > 350ms ago AND scroll position has been static for > 300ms
  const inputIdle = (now - activeSession.lastInputTime) > 350;
  const motionIdle = (now - activeSession.lastMotionTime) > 300;

  if (inputIdle && motionIdle) {
    scrollPerfDebug.recordScrollEnd();
    return;
  }

  rafId = requestAnimationFrame(onRaf);
}

export const scrollPerfDebug = {
  recordInputEvent() {
    const now = performance.now();
    const st = readCurrentScrollTop();
    if (!activeSession) {
      activeSession = {
        startTime: now,
        lastInputTime: now,
        lastMotionTime: now,
        endTime: 0,
        startScrollTop: st,
        releaseScrollTop: 0,
        endScrollTop: 0,
        frames: [],
        recomputeTimes: [],
        nodeRailSyncTimes: [],
        rowMountCount: 0,
        rowRenderCount: 0,
        virtualWindowSnapshots: [],
        longTasks: [],
      };
      lastRafTime = now;
      lastObservedScrollTop = st;
      rafId = requestAnimationFrame(onRaf);
      console.log("%c[ScrollPerf] 🚀 Scroll gesture started - tracking Active Drag & Momentum Fling...", "color: #00b4d8; font-weight: bold;");
    } else {
      activeSession.lastInputTime = now;
      activeSession.lastMotionTime = now;
    }
  },

  recordScrollStart() {
    this.recordInputEvent();
  },

  recordScrollEnd() {
    if (!activeSession) return;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    const now = performance.now();
    activeSession.endTime = now;
    activeSession.endScrollTop = readCurrentScrollTop();
    if (activeSession.releaseScrollTop === 0) {
      activeSession.releaseScrollTop = activeSession.endScrollTop;
    }

    const session = activeSession;
    activeSession = null;
    lastRafTime = 0;

    const totalDurationMs = Math.round(session.endTime - session.startTime);
    const activeFrames = session.frames.filter((f) => !f.isMomentum);
    const momentumFrames = session.frames.filter((f) => f.isMomentum);

    const activeDurationMs = Math.max(1, Math.round(
      activeFrames.length > 0 ? (activeFrames[activeFrames.length - 1]!.timestamp - session.startTime) : (session.lastInputTime - session.startTime)
    ));
    const momentumDurationMs = Math.max(0, totalDurationMs - activeDurationMs);

    const calcPhaseFps = (frames: FrameRecord[], durMs: number) =>
      durMs > 0 && frames.length > 0 ? (frames.length / (durMs / 1000)).toFixed(1) : "0.0";

    const activeDropped = activeFrames.filter((f) => f.delta > 20).length;
    const activeSevere = activeFrames.filter((f) => f.delta > 50).length;
    const momentumDropped = momentumFrames.filter((f) => f.delta > 20).length;
    const momentumSevere = momentumFrames.filter((f) => f.delta > 50).length;

    const totalDropped = session.frames.filter((f) => f.delta > 20).length;
    const totalSevere = session.frames.filter((f) => f.delta > 50).length;
    const overallFps = session.frames.length > 0 && totalDurationMs > 0
      ? (session.frames.length / (totalDurationMs / 1000)).toFixed(1)
      : "0.0";

    const avgRecompute = session.recomputeTimes.length > 0
      ? (session.recomputeTimes.reduce((a, b) => a + b, 0) / session.recomputeTimes.length).toFixed(2)
      : "0.00";
    const avgNodeRail = session.nodeRailSyncTimes.length > 0
      ? (session.nodeRailSyncTimes.reduce((a, b) => a + b, 0) / session.nodeRailSyncTimes.length).toFixed(2)
      : "0.00";

    const activeDisplacement = Math.round(Math.abs(session.releaseScrollTop - session.startScrollTop));
    const momentumDisplacement = Math.round(Math.abs(session.endScrollTop - session.releaseScrollTop));
    const totalDisplacement = Math.round(Math.abs(session.endScrollTop - session.startScrollTop));

    const report = {
      "1. Phase: 跟手阶段 (Active Drag)": {
        "Duration (ms)": activeDurationMs,
        "Avg FPS": `${calcPhaseFps(activeFrames, activeDurationMs)} fps`,
        "Total Frames": activeFrames.length,
        "Dropped Frames (>20ms)": activeDropped,
        "Severe Jank (>50ms)": activeSevere,
        "Displacement": `${activeDisplacement} px`,
      },
      "2. Phase: 离手抛滑 (Momentum Fling)": {
        "Duration (ms)": momentumDurationMs,
        "Avg FPS": `${calcPhaseFps(momentumFrames, momentumDurationMs)} fps`,
        "Total Frames": momentumFrames.length,
        "Dropped Frames (>20ms)": momentumDropped,
        "Severe Jank (>50ms)": momentumSevere,
        "Displacement": `${momentumDisplacement} px`,
      },
      "3. Summary: 全流程物理收敛 (Full Lifecycle)": {
        "Total Duration (ms)": totalDurationMs,
        "Overall Avg FPS": `${overallFps} fps`,
        "Total Frames": session.frames.length,
        "Total Dropped (>20ms)": totalDropped,
        "Total Severe (>50ms)": totalSevere,
        "Long Tasks (>50ms)": session.longTasks.length,
        "Row Mounts": session.rowMountCount,
        "Total Displacement": `${totalDisplacement} px`,
        "Avg Recompute (ms)": avgRecompute,
        "Avg NodeRail (ms)": avgNodeRail,
      },
    };

    console.group("%c[ScrollPerf] 📊 Multi-Phase Scroll Report (跟手 + 离手抛滑)", "color: #ffb703; font-size: 13px; font-weight: bold;");
    console.log("%cPhase 1: 跟手操作阶段 (Active Drag)", "color: #00b4d8; font-weight: bold;");
    console.table(report["1. Phase: 跟手阶段 (Active Drag)"]);
    console.log("%cPhase 2: 离手抛滑阶段 (Momentum Fling Coasting)", "color: #06d6a0; font-weight: bold;");
    console.table(report["2. Phase: 离手抛滑 (Momentum Fling)"]);
    console.log("%cPhase 3: 全局汇总 (Overall Lifecycle)", "color: #f72585; font-weight: bold;");
    console.table(report["3. Summary: 全流程物理收敛 (Full Lifecycle)"]);
    if (session.longTasks.length > 0) {
      console.warn("[ScrollPerf] ⚠️ Long Tasks detected during scroll:", session.longTasks);
    }
    console.log("[ScrollPerf] Full session raw data stored in window.__LAST_SCROLL_REPORT__");
    console.groupEnd();

    if (typeof window !== "undefined") {
      (window as any).__LAST_SCROLL_REPORT__ = {
        summary: report,
        details: session,
      };
    }
  },

  recordRecomputeTime(ms: number, snapshot?: any) {
    if (activeSession) {
      activeSession.recomputeTimes.push(ms);
      if (snapshot) {
        activeSession.virtualWindowSnapshots.push(snapshot);
      }
    }
    if (ms > 5) {
      console.warn(`%c[ScrollPerf] ⚠️ Slow recomputeVirtualWindow: ${ms.toFixed(2)}ms`, "color: #e63946;", snapshot);
    }
  },

  recordNodeRailSyncTime(ms: number, nodesQueried: number) {
    if (activeSession) {
      activeSession.nodeRailSyncTimes.push(ms);
    }
    if (ms > 4) {
      console.warn(`%c[ScrollPerf] ⚠️ Slow MessageNodeRail.sync: ${ms.toFixed(2)}ms (queried ${nodesQueried} elements)`, "color: #e63946;");
    }
  },

  recordRowMount(_id: string, _index: number) {
    if (activeSession) {
      activeSession.rowMountCount++;
    }
  },

  recordRowRender(id: string, index: number, durationMs: number) {
    if (activeSession) {
      activeSession.rowRenderCount++;
    }
    if (durationMs > 10) {
      console.warn(`%c[ScrollPerf] ⚠️ Slow Row Render: idx=${index}, id=${id}, took ${durationMs.toFixed(2)}ms`, "color: #e63946;");
    }
  },

  recordLog(tag: string, ...args: any[]) {
    console.log(`%c[ScrollPerf:${tag}]`, "color: #a8dadc; font-weight: bold;", ...args);
  },
};

if (typeof window !== "undefined") {
  (window as any).__SCROLL_PERF_DEBUG__ = scrollPerfDebug;
  window.addEventListener(
    "wheel",
    () => {
      scrollPerfDebug.recordInputEvent();
    },
    { passive: true, capture: true },
  );
  window.addEventListener(
    "touchmove",
    () => {
      scrollPerfDebug.recordInputEvent();
    },
    { passive: true, capture: true },
  );
  window.addEventListener(
    "scroll",
    () => {
      const now = performance.now();
      if (activeSession) {
        activeSession.lastMotionTime = now;
      } else {
        scrollPerfDebug.recordInputEvent();
      }
    },
    { passive: true, capture: true },
  );
  console.log(
    "%c[ScrollPerf] 🚀 Multi-phase telemetry initialized. Accurately tracks Active Drag & Momentum Fling.",
    "color: #06d6a0; font-weight: bold; font-size: 12px;",
  );
}
