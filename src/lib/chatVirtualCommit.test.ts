import { describe, expect, it } from "vitest";
import { planChatVirtualWindowCommit } from "./chatVirtualCommit";
import { cumulativeOffsets, type ChatVirtualWindow } from "./chatVirtualList";

function win(
  partial: Partial<ChatVirtualWindow> & Pick<ChatVirtualWindow, "start" | "end">,
): ChatVirtualWindow {
  return {
    paddingTop: 0,
    paddingBottom: 0,
    totalHeight: 0,
    richStart: partial.start,
    richEnd: partial.end,
    ...partial,
  };
}

describe("planChatVirtualWindowCommit", () => {
  it("keeps a viewport hole on the urgent lane", () => {
    const count = 80;
    const offsets = cumulativeOffsets(count, () => 100);
    const planned = planChatVirtualWindowCommit({
      next: win({
        start: 20,
        end: 50,
        richStart: 24,
        richEnd: 36,
        totalHeight: 8000,
        paddingTop: 2000,
        paddingBottom: 3000,
      }),
      committed: win({
        start: 0,
        end: 12,
        richStart: 0,
        richEnd: 8,
        totalHeight: 8000,
      }),
      offsets,
      count,
      viewTop: 2400,
      viewBottom: 3000,
      pinToBottom: false,
      freezeRich: false,
      scrollTopWasWritten: false,
    });
    expect(planned.deferrable).toBe(false);
    expect(planned.window.richStart).toBeLessThanOrEqual(24);
    expect(planned.window.richEnd).toBeGreaterThan(24);
  });

  it("still paints the live viewport while a gesture freezes overscan", () => {
    const count = 80;
    const offsets = cumulativeOffsets(count, () => 100);
    const planned = planChatVirtualWindowCommit({
      next: win({
        start: 20,
        end: 50,
        richStart: 24,
        richEnd: 36,
        totalHeight: 8000,
        paddingTop: 2000,
      }),
      committed: win({
        start: 0,
        end: 12,
        richStart: 0,
        richEnd: 8,
        totalHeight: 8000,
      }),
      offsets,
      count,
      viewTop: 2400,
      viewBottom: 3000,
      pinToBottom: false,
      freezeRich: true,
      scrollTopWasWritten: false,
    });
    expect(planned.window.richStart).toBeLessThanOrEqual(24);
    expect(planned.window.richEnd).toBeGreaterThan(24);
  });
});
