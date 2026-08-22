/**
 * Diagnostic logger for chat transcript scroll performance.
 * Collects FPS, frame times, long tasks, layout recomputes, and component renders.
 */

interface ScrollSessionMetrics {
  startTime: number;
  endTime: number;
  frameCount: number;
  droppedFrames: number; // frames taking > 20ms
  severeJankFrames: number; // frames taking > 50ms
  frameTimes: number[];
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
let stopTimer: NodeJS.Timeout | null = null;

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

function onRaf(now: number) {
  if (!activeSession) return;
  if (lastRafTime > 0) {
    const delta = now - lastRafTime;
    activeSession.frameCount++;
    activeSession.frameTimes.push(delta);
    if (delta > 20) {
      activeSession.droppedFrames++;
    }
    if (delta > 50) {
      activeSession.severeJankFrames++;
    }
  }
  lastRafTime = now;
  rafId = requestAnimationFrame(onRaf);
}

export const scrollPerfDebug = {
  recordScrollStart() {
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    if (!activeSession) {
      activeSession = {
        startTime: performance.now(),
        endTime: 0,
        frameCount: 0,
        droppedFrames: 0,
        severeJankFrames: 0,
        frameTimes: [],
        recomputeTimes: [],
        nodeRailSyncTimes: [],
        rowMountCount: 0,
        rowRenderCount: 0,
        virtualWindowSnapshots: [],
        longTasks: [],
      };
      lastRafTime = performance.now();
      rafId = requestAnimationFrame(onRaf);
      console.log("%c[ScrollPerf] 🚀 Scroll gesture started - recording metrics...", "color: #00b4d8; font-weight: bold;");
    }

    stopTimer = setTimeout(() => {
      scrollPerfDebug.recordScrollEnd();
    }, 400);
  },

  recordScrollEnd() {
    if (!activeSession) return;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    activeSession.endTime = performance.now();
    const session = activeSession;
    activeSession = null;
    lastRafTime = 0;

    const durationMs = session.endTime - session.startTime;
    const avgFps = session.frameCount > 0 ? (session.frameCount / (durationMs / 1000)).toFixed(1) : "0";
    const avgRecompute = session.recomputeTimes.length > 0
      ? (session.recomputeTimes.reduce((a, b) => a + b, 0) / session.recomputeTimes.length).toFixed(2)
      : "0";
    const avgNodeRail = session.nodeRailSyncTimes.length > 0
      ? (session.nodeRailSyncTimes.reduce((a, b) => a + b, 0) / session.nodeRailSyncTimes.length).toFixed(2)
      : "0";

    const report = {
      "Duration (ms)": Math.round(durationMs),
      "Avg FPS": avgFps + " fps",
      "Total Frames": session.frameCount,
      "Dropped Frames (>20ms)": session.droppedFrames,
      "Severe Jank Frames (>50ms)": session.severeJankFrames,
      "Long Tasks (>50ms)": session.longTasks.length,
      "Virtual Recompute Calls": session.recomputeTimes.length,
      "Avg Recompute Time (ms)": avgRecompute,
      "NodeRail Sync Calls": session.nodeRailSyncTimes.length,
      "Avg NodeRail Time (ms)": avgNodeRail,
      "Row Render Count": session.rowRenderCount,
      "Row Mount Count": session.rowMountCount,
      "Last Window": session.virtualWindowSnapshots.slice(-1)[0] || null,
    };

    console.group("%c[ScrollPerf] 📊 Scroll Session Summary Report", "color: #ffb703; font-size: 13px; font-weight: bold;");
    console.table(report);
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
}
