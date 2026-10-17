import { describe, expect, it, vi } from "vitest";
import { runPetQuickPrompt } from "./petQuickPromptRun";

const base = () => ({
  sessions: [{ id: "s1", projectId: "p1" }],
  projects: [{ id: "p1" }],
  openSession: vi.fn(async () => {}),
  newChat: vi.fn(async () => {}),
  sessionsList: vi.fn(async () => [] as { id: string }[]),
  mapRow: (r: { id: string }) => ({ id: r.id, projectId: null }),
  send: vi.fn(async () => true),
  showToast: vi.fn(),
  tr: () => "failed",
  settleMs: 0,
});

describe("runPetQuickPrompt", () => {
  it("opens the known chat and sends to it", async () => {
    const d = base();
    await runPetQuickPrompt({ sessionId: "s1", text: "hi" }, d);
    expect(d.openSession).toHaveBeenCalled();
    expect(d.send).toHaveBeenCalledWith(expect.objectContaining({ targetSessionId: "s1", storedDisplay: "hi" }));
  });
  it("falls back to a new chat when the id is unknown", async () => {
    const d = base();
    await runPetQuickPrompt({ sessionId: "nope", text: "hi" }, d);
    expect(d.newChat).toHaveBeenCalled();
    expect(d.send).toHaveBeenCalledWith(expect.objectContaining({ targetSessionId: null }));
  });
  it("toasts when the send fails", async () => {
    const d = { ...base(), send: vi.fn(async () => false) };
    expect(await runPetQuickPrompt({ sessionId: null, text: "x" }, d)).toBe(false);
    expect(d.showToast).toHaveBeenCalledWith("failed", 4200);
  });
});
