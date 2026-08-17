import { describe, expect, it } from "vitest";
import {
  GROK_ACTIVITY_STEP_ROW_PX,
  GROK_ACTIVITY_VIRTUAL_VISIBLE_ROWS,
  GROK_ACTIVITY_VIRTUALIZE_THRESHOLD,
  applyActivityStepExpandPolicy,
  applyActivityStepUserToggle,
  emptyActivityStepExpandState,
  grokActivityVirtualMaxHeightPx,
  resolveActivityStepExpandDesired,
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

  it("virtualizes when count exceeds threshold", () => {
    expect(
      shouldVirtualizeGrokActivitySteps(GROK_ACTIVITY_VIRTUALIZE_THRESHOLD + 1),
    ).toBe(true);
    expect(shouldVirtualizeGrokActivitySteps(100)).toBe(true);
  });

  it("maxHeight is min(visibleRows, count) × row height", () => {
    expect(grokActivityVirtualMaxHeightPx(0)).toBe(0);
    expect(grokActivityVirtualMaxHeightPx(5)).toBe(5 * GROK_ACTIVITY_STEP_ROW_PX);
    expect(grokActivityVirtualMaxHeightPx(15)).toBe(
      GROK_ACTIVITY_VIRTUAL_VISIBLE_ROWS * GROK_ACTIVITY_STEP_ROW_PX,
    );
    expect(grokActivityVirtualMaxHeightPx(100)).toBe(
      GROK_ACTIVITY_VIRTUAL_VISIBLE_ROWS * GROK_ACTIVITY_STEP_ROW_PX,
    );
  });

  it("row height constant matches virtual CSS contract (30px)", () => {
    expect(GROK_ACTIVITY_STEP_ROW_PX).toBe(30);
    expect(GROK_ACTIVITY_VIRTUALIZE_THRESHOLD).toBe(14);
    expect(GROK_ACTIVITY_VIRTUAL_VISIBLE_ROWS).toBe(12);
  });

  it("live tool bodies leave VirtualList even before expand policy runs", () => {
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
