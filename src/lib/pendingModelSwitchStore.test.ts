/**
 * BOR-52：待生效模型切换 store 的行为约束。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pendingModelSwitchStore } from "./pendingModelSwitchStore";

describe("pendingModelSwitchStore", () => {
  beforeEach(() => {
    pendingModelSwitchStore.resetForTests();
  });

  it("registers a queued switch and clears it on the turn-end edge", () => {
    // Arrange / Act
    pendingModelSwitchStore.apply({ sessionId: "s-a", pending: true });

    // Assert
    expect(pendingModelSwitchStore.isPending("s-a")).toBe(true);

    // Act：turn 结束，后端 flush 广播 pending: false
    pendingModelSwitchStore.apply({ sessionId: "s-a", pending: false });

    // Assert
    expect(pendingModelSwitchStore.isPending("s-a")).toBe(false);
  });

  it("keeps sessions independent", () => {
    // Arrange / Act
    pendingModelSwitchStore.apply({ sessionId: "s-a", pending: true });
    pendingModelSwitchStore.apply({ sessionId: "s-b", pending: true });
    pendingModelSwitchStore.apply({ sessionId: "s-a", pending: false });

    // Assert
    expect(pendingModelSwitchStore.isPending("s-a")).toBe(false);
    expect(pendingModelSwitchStore.isPending("s-b")).toBe(true);
  });

  it("treats a missing pending flag as true and ignores empty ids", () => {
    // Arrange / Act
    pendingModelSwitchStore.apply({ sessionId: "s-c" });
    pendingModelSwitchStore.apply({ sessionId: "   " });

    // Assert
    expect(pendingModelSwitchStore.isPending("s-c")).toBe(true);
    expect(pendingModelSwitchStore.isPending("")).toBe(false);
    expect(pendingModelSwitchStore.isPending(null)).toBe(false);
  });

  it("notifies subscribers only when a flag actually flips", () => {
    // Arrange
    const listener = vi.fn();
    pendingModelSwitchStore.subscribe(listener);

    // Act：首次登记会通知；重复的相同状态不通知
    pendingModelSwitchStore.apply({ sessionId: "s-d", pending: true });
    pendingModelSwitchStore.apply({ sessionId: "s-d", pending: true });
    pendingModelSwitchStore.apply({ sessionId: "s-d", pending: false });
    pendingModelSwitchStore.apply({ sessionId: "s-d", pending: false });

    // Assert
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stops notifying after unsubscribe", () => {
    // Arrange
    const listener = vi.fn();
    const unsubscribe = pendingModelSwitchStore.subscribe(listener);

    // Act
    unsubscribe();
    pendingModelSwitchStore.apply({ sessionId: "s-e", pending: true });

    // Assert
    expect(listener).not.toHaveBeenCalled();
  });
});
