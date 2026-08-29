import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GROK_ACTIVITY_MAPPED_CAP_PX,
  GROK_ACTIVITY_STEP_ROW_PX,
  GROK_ACTIVITY_VIRTUAL_VISIBLE_ROWS,
  GROK_ACTIVITY_VIRTUALIZE_THRESHOLD,
  applyActivityStepExpandPolicy,
  applyActivityStepUserToggle,
  emptyActivityStepExpandState,
  grokActivityVirtualMaxHeightPx,
  activityScrollerScrollToKey,
  liveActivityFollowKey,
  resolveActivityStepExpandDesired,
  scrollDeltaToBringChildIntoContainer,
  shouldCapMappedGrokActivitySteps,
  shouldVirtualizeActivityWithExpand,
  shouldVirtualizeGrokActivitySteps,
} from "./grokActivityVirtualize";
import { toolExpandBody } from "./toolDisplay";
import {
  DEFAULT_TOOL_STEPS_AUTO_COLLAPSE,
  toolStepDefaultOpen,
} from "./toolStepsAutoCollapsePref";

describe("grokActivityVirtualize", () => {
  it("keeps short lists non-virtual (≤ threshold)", () => {
    expect(shouldVirtualizeGrokActivitySteps(0)).toBe(false);
    expect(shouldVirtualizeGrokActivitySteps(1)).toBe(false);
    expect(
      shouldVirtualizeGrokActivitySteps(GROK_ACTIVITY_VIRTUALIZE_THRESHOLD),
    ).toBe(false);
  });

  it("liveActivityFollowKey prefers the last running step, not the first reads", () => {
    expect(
      liveActivityFollowKey([
        { key: "explore-0", running: false },
        { key: "bash-2", running: true },
        { key: "read-9", running: false },
      ]),
    ).toBe("bash-2");
    expect(
      liveActivityFollowKey([
        { key: "explore-0", running: true },
        { key: "bash-2", running: true },
      ]),
    ).toBe("bash-2");
    expect(
      liveActivityFollowKey([
        { key: "th-0", type: "thought", streaming: false },
        { key: "th-1", type: "thought", streaming: true },
      ]),
    ).toBe("th-1");
    expect(liveActivityFollowKey([{ key: "only" }])).toBe("only");
    expect(liveActivityFollowKey([])).toBeNull();
  });

  it("after live ends, keeps the last step instead of jumping to the first reads", () => {
    const steps = [
      { key: "explore-0", running: false },
      { key: "bash-2", running: false },
      { key: "th-1", type: "thought", streaming: false },
    ];
    expect(activityScrollerScrollToKey(true, steps)).toBe("th-1");
    expect(activityScrollerScrollToKey(false, steps)).toBe("th-1");
    expect(
      activityScrollerScrollToKey(false, [
        { key: "read-0", running: false },
        { key: "edit-9", running: false },
      ]),
    ).toBe("edit-9");
    expect(activityScrollerScrollToKey(false, [])).toBeNull();
  });

  it("wires the nested VirtualList to followKey after live ends", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../components/lobe-chat/TimelinePhaseBlock.tsx"),
      "utf8",
    );
    expect(src).toContain("activityScrollerScrollToKey");
    expect(src).not.toMatch(/scrollToKey=\{live \? followKey : null\}/);
    expect(src).toMatch(/scrollToKey=\{scrollToKey\}/);
    expect(src).not.toMatch(/if \(!live \|\| !followKey\) return/);
  });

  it("live follow only moves the nested scroller, never an ancestor", () => {
    // Child clipped below the capped steps box → scroll that box down.
    expect(
      scrollDeltaToBringChildIntoContainer(
        { top: 100, bottom: 300 },
        { top: 280, bottom: 340 },
      ),
    ).toBe(40);
    // Child clipped above → scroll that box up (negative delta).
    expect(
      scrollDeltaToBringChildIntoContainer(
        { top: 100, bottom: 300 },
        { top: 60, bottom: 90 },
      ),
    ).toBe(-40);
    // Already visible → 0. scrollIntoView(nearest) would still walk the
    // chat ancestor and unpin stick when the next thinking/tool/body round
    // starts below a still-visible live step.
    expect(
      scrollDeltaToBringChildIntoContainer(
        { top: 100, bottom: 300 },
        { top: 120, bottom: 160 },
      ),
    ).toBe(0);
  });

  it("virtualizes when count exceeds threshold", () => {
    expect(
      shouldVirtualizeGrokActivitySteps(GROK_ACTIVITY_VIRTUALIZE_THRESHOLD + 1),
    ).toBe(true);
    expect(shouldVirtualizeGrokActivitySteps(100)).toBe(true);
  });

  it("maxHeight is min(visibleRows, count) × row height", () => {
    expect(grokActivityVirtualMaxHeightPx(0)).toBe(0);
    expect(grokActivityVirtualMaxHeightPx(5)).toBe(5 * GROK_ACTIVITY_STEP_ROW_PX);
    expect(grokActivityVirtualMaxHeightPx(15)).toBe(15 * GROK_ACTIVITY_STEP_ROW_PX);
    expect(
      grokActivityVirtualMaxHeightPx(GROK_ACTIVITY_VIRTUAL_VISIBLE_ROWS + 3),
    ).toBe(GROK_ACTIVITY_VIRTUAL_VISIBLE_ROWS * GROK_ACTIVITY_STEP_ROW_PX);
    expect(grokActivityVirtualMaxHeightPx(100)).toBe(
      GROK_ACTIVITY_VIRTUAL_VISIBLE_ROWS * GROK_ACTIVITY_STEP_ROW_PX,
    );
  });

  it("row height constant matches virtual CSS contract (36px)", () => {
    expect(GROK_ACTIVITY_STEP_ROW_PX).toBe(36);
    expect(GROK_ACTIVITY_VIRTUALIZE_THRESHOLD).toBe(14);
    expect(GROK_ACTIVITY_VIRTUAL_VISIBLE_ROWS).toBe(18);
    expect(GROK_ACTIVITY_MAPPED_CAP_PX).toBe(640);
  });

  it("mapped lists cap only past the virtualize threshold (CSS 70vh/40rem, not N×row)", () => {
    expect(shouldCapMappedGrokActivitySteps(GROK_ACTIVITY_VIRTUALIZE_THRESHOLD)).toBe(
      false,
    );
    expect(
      shouldCapMappedGrokActivitySteps(GROK_ACTIVITY_VIRTUALIZE_THRESHOLD + 1),
    ).toBe(true);
    expect(grokActivityVirtualMaxHeightPx(100)).not.toBe(
      GROK_ACTIVITY_MAPPED_CAP_PX,
    );
  });

  it("streaming thought bodies leave VirtualList; running tool titles do not", () => {
    const stepCount = GROK_ACTIVITY_VIRTUALIZE_THRESHOLD + 5;
    expect(shouldVirtualizeActivityWithExpand(stepCount, 0, 0)).toBe(true);
    expect(shouldVirtualizeActivityWithExpand(stepCount, 0, 1)).toBe(false);
  });

  it("expand leaves VirtualList and user toggle survives remount", () => {
    const stepCount = GROK_ACTIVITY_VIRTUALIZE_THRESHOLD + 5;
    expect(shouldVirtualizeActivityWithExpand(stepCount, 0)).toBe(true);

    const body = toolExpandBody(
      {
        toolCallId: "bash-1",
        toolKind: "run_terminal_command",
        detail: "line1\nline2\nline3",
      },
      false,
    );
    expect(body.hasBody).toBe(true);

    let state = emptyActivityStepExpandState();
    // User expand — parent marks userToggled (survives remount).
    state = applyActivityStepUserToggle(state, "bash-1", true);
    expect(state.expandedKeys.has("bash-1")).toBe(true);
    expect(state.userToggledKeys.has("bash-1")).toBe(true);
    expect(
      shouldVirtualizeActivityWithExpand(stepCount, state.expandedKeys.size),
    ).toBe(false);

    // Remount policy sync (running=false, autoCollapse default) must NOT close
    // a user-toggled open step.
    state = applyActivityStepExpandPolicy(state, "bash-1", {
      hasBody: true,
      running: false,
      autoCollapse: DEFAULT_TOOL_STEPS_AUTO_COLLAPSE,
    });
    expect(state.expandedKeys.has("bash-1")).toBe(true);

    // Explicit user collapse re-enters VirtualList.
    state = applyActivityStepUserToggle(state, "bash-1", false);
    expect(state.expandedKeys.has("bash-1")).toBe(false);
    expect(
      shouldVirtualizeActivityWithExpand(stepCount, state.expandedKeys.size),
    ).toBe(true);
  });

  it("running→finished auto-collapses when !userToggled; sticks when user toggled", () => {
    expect(DEFAULT_TOOL_STEPS_AUTO_COLLAPSE).toBe(true);
    expect(toolStepDefaultOpen(true, true)).toBe(true);
    expect(toolStepDefaultOpen(false, true)).toBe(false);

    const stepCount = GROK_ACTIVITY_VIRTUALIZE_THRESHOLD + 3;
    let state = emptyActivityStepExpandState();

    // Auto-open while running (policy, not user).
    state = applyActivityStepExpandPolicy(state, "t-run", {
      hasBody: true,
      running: true,
      autoCollapse: true,
    });
    expect(state.expandedKeys.has("t-run")).toBe(true);
    expect(state.userToggledKeys.has("t-run")).toBe(false);
    expect(
      shouldVirtualizeActivityWithExpand(stepCount, state.expandedKeys.size),
    ).toBe(false);

    // Finish under default autoCollapse — must collapse even if currently open
    // (bug was early-return when expanded=true).
    state = applyActivityStepExpandPolicy(state, "t-run", {
      hasBody: true,
      running: false,
      autoCollapse: true,
    });
    expect(state.expandedKeys.has("t-run")).toBe(false);
    expect(
      shouldVirtualizeActivityWithExpand(stepCount, state.expandedKeys.size),
    ).toBe(true);

    // User-toggled open sticks through running→finished.
    state = applyActivityStepUserToggle(state, "t-user", true);
    state = applyActivityStepExpandPolicy(state, "t-user", {
      hasBody: true,
      running: true,
      autoCollapse: true,
    });
    expect(state.expandedKeys.has("t-user")).toBe(true);
    state = applyActivityStepExpandPolicy(state, "t-user", {
      hasBody: true,
      running: false,
      autoCollapse: true,
    });
    expect(state.expandedKeys.has("t-user")).toBe(true);
    expect(resolveActivityStepExpandDesired({
      hasBody: true,
      running: false,
      autoCollapse: true,
      userToggled: true,
    })).toBeNull();
  });
});
