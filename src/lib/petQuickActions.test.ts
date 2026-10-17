import { describe, expect, it, vi } from "vitest";
import { parsePetQuickAction, runPetQuickAction } from "./petQuickActions";

type P = { sessionId: string; id: number };
const deps = (over: Partial<Parameters<typeof runPetQuickAction<P>>[1]> = {}) => ({
  activePerm: null as P | null,
  pendingPerms: new Map<string, P>([["s2", { sessionId: "s2", id: 2 }]]),
  buttonsFor: () => [
    { decision: "allow_once" as const, optionId: "ok" },
    { decision: "deny" as const, optionId: "no" },
  ],
  resolve: vi.fn(async () => {}),
  stop: vi.fn(async () => true),
  open: vi.fn(),
  notify: vi.fn(),
  ...over,
});

describe("parsePetQuickAction", () => {
  it("accepts allowlisted kinds only", () => {
    expect(parsePetQuickAction({ kind: "stop", sessionId: " s1 " })).toEqual({ kind: "stop", sessionId: "s1" });
    expect(parsePetQuickAction({ kind: "rm", sessionId: "s1" })).toBeNull();
    expect(parsePetQuickAction({ kind: "stop", sessionId: "" })).toBeNull();
    expect(parsePetQuickAction(null)).toBeNull();
  });
});

describe("runPetQuickAction", () => {
  it("approves a pending background request", async () => {
    const d = deps();
    expect(await runPetQuickAction({ kind: "approve", sessionId: "s2" }, d)).toBe("approved");
    expect(d.resolve).toHaveBeenCalledWith({ sessionId: "s2", id: 2 }, "allow_once", "ok");
  });
  it("prefers the active bar for the current chat and denies it", async () => {
    const d = deps({ activePerm: { sessionId: "s1", id: 1 } });
    expect(await runPetQuickAction({ kind: "deny", sessionId: "s1" }, d)).toBe("denied");
    expect(d.resolve).toHaveBeenCalledWith({ sessionId: "s1", id: 1 }, "deny", "no");
  });
  it("opens the chat when nothing is waiting", async () => {
    const d = deps();
    expect(await runPetQuickAction({ kind: "approve", sessionId: "zz" }, d)).toBe("no-request");
    expect(d.open).toHaveBeenCalledWith("zz");
    expect(d.resolve).not.toHaveBeenCalled();
  });
  it("stops the given chat", async () => {
    const d = deps();
    expect(await runPetQuickAction({ kind: "stop", sessionId: "s3" }, d)).toBe("stopped");
    expect(d.stop).toHaveBeenCalledWith("s3");
  });
});
