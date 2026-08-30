import { describe, expect, it, vi } from "vitest";

import { restoreSessionGate } from "./sessionGateRestore";

function parkedGates<T>(entries: [string, T][] = []) {
  return { current: new Map<string, T>(entries) };
}

describe("restoreSessionGate", () => {
  it("applies a parked gate without asking the host", async () => {
    const parked = parkedGates([["s1", { rpcId: 7 }]]);
    const apply = vi.fn();
    const pull = vi.fn();

    restoreSessionGate("s1", () => true, {
      parked,
      apply,
      pull,
      enabled: true,
    });

    expect(apply).toHaveBeenCalledWith({ rpcId: 7 });
    expect(pull).not.toHaveBeenCalled();
  });

  it("pulls from the host when nothing is parked", async () => {
    const parked = parkedGates<{ rpcId: number }>();
    const apply = vi.fn();
    const pull = vi.fn().mockResolvedValue({ rpcId: 9 });

    restoreSessionGate("s1", () => true, {
      parked,
      apply,
      pull,
      enabled: true,
    });

    // Clears stale UI first, then restores once the host answers.
    expect(apply).toHaveBeenNthCalledWith(1, null);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(apply).toHaveBeenNthCalledWith(2, { rpcId: 9 });
    expect(parked.current.get("s1")).toEqual({ rpcId: 9 });
  });

  it("drops a restore for a chat the user already left", async () => {
    const parked = parkedGates<{ rpcId: number }>();
    const apply = vi.fn();
    const pull = vi.fn().mockResolvedValue({ rpcId: 9 });

    restoreSessionGate("s1", () => false, {
      parked,
      apply,
      pull,
      enabled: true,
    });

    await vi.waitFor(() => expect(pull).toHaveBeenCalled());
    expect(apply).toHaveBeenCalledExactlyOnceWith(null);
    expect(parked.current.has("s1")).toBe(false);
  });

  it("lets a live event win over an in-flight restore", async () => {
    const parked = parkedGates<{ rpcId: number }>();
    const apply = vi.fn();
    const pull = vi.fn().mockImplementation(async () => {
      // A live `session://ask_user` lands while the pull is in flight.
      parked.current.set("s1", { rpcId: 42 });
      return { rpcId: 9 };
    });

    restoreSessionGate("s1", () => true, {
      parked,
      apply,
      pull,
      enabled: true,
    });

    await vi.waitFor(() => expect(pull).toHaveBeenCalled());
    expect(apply).toHaveBeenCalledExactlyOnceWith(null);
    expect(parked.current.get("s1")).toEqual({ rpcId: 42 });
  });

  it("never touches the host when disabled", async () => {
    const parked = parkedGates<{ rpcId: number }>();
    const apply = vi.fn();
    const pull = vi.fn();

    restoreSessionGate("s1", () => true, {
      parked,
      apply,
      pull,
      enabled: false,
    });

    expect(apply).toHaveBeenCalledExactlyOnceWith(null);
    expect(pull).not.toHaveBeenCalled();
  });

  it("survives a rejected pull", async () => {
    const parked = parkedGates<{ rpcId: number }>();
    const apply = vi.fn();
    const pull = vi.fn().mockRejectedValue(new Error("host gone"));

    restoreSessionGate("s1", () => true, {
      parked,
      apply,
      pull,
      enabled: true,
    });

    await vi.waitFor(() => expect(pull).toHaveBeenCalled());
    expect(apply).toHaveBeenCalledExactlyOnceWith(null);
  });
});
