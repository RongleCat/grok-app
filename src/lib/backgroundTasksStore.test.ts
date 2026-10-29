import { afterEach, describe, expect, it } from "vitest";
import {
  adoptDraftFleet,
  clearDraftFleet,
  FLEET_DRAFT_ID,
  forgetFleetAutoOpen,
  getBackgroundTasksSnapshot,
  noteFleetRowsForAutoOpen,
  setBackgroundTasksOpen,
  setFleetChatContext,
  toggleBackgroundTasks,
} from "./backgroundTasksStore";

afterEach(() => {
  forgetFleetAutoOpen();
  clearDraftFleet();
  setFleetChatContext("a", false);
  setBackgroundTasksOpen(false);
  setFleetChatContext("b", false);
  setBackgroundTasksOpen(false);
  setFleetChatContext("chat", false);
  setBackgroundTasksOpen(false);
  setFleetChatContext(null, false);
});

describe("backgroundTasksStore", () => {
  it("keeps the pane open state on the chat that set it", () => {
    setFleetChatContext("a", false);
    setBackgroundTasksOpen(true);
    setFleetChatContext("b", true);
    expect(getBackgroundTasksSnapshot().open).toBe(false);
    expect(getBackgroundTasksSnapshot().sessionId).toBe("b");
    setFleetChatContext("a", false);
    expect(getBackgroundTasksSnapshot().open).toBe(true);
    expect(getBackgroundTasksSnapshot().sessionId).toBe("a");
  });

  it("leaves the pane closed for a new chat", () => {
    setFleetChatContext(FLEET_DRAFT_ID, false);
    expect(getBackgroundTasksSnapshot().open).toBe(false);
    expect(getBackgroundTasksSnapshot().sessionId).toBe(FLEET_DRAFT_ID);
    adoptDraftFleet("created-closed");
    setFleetChatContext("created-closed", false);
    expect(getBackgroundTasksSnapshot().open).toBe(false);
    expect(getBackgroundTasksSnapshot().sessionId).toBe("created-closed");
  });

  it("carries a manual open or close onto the session that chat creates", () => {
    setFleetChatContext(FLEET_DRAFT_ID, false);
    expect(getBackgroundTasksSnapshot().open).toBe(false);
    setBackgroundTasksOpen(true);
    expect(getBackgroundTasksSnapshot().open).toBe(true);
    adoptDraftFleet("created");
    setFleetChatContext("created", false);
    expect(getBackgroundTasksSnapshot().open).toBe(true);
    expect(getBackgroundTasksSnapshot().sessionId).toBe("created");
    setFleetChatContext(FLEET_DRAFT_ID, false);
    expect(getBackgroundTasksSnapshot().open).toBe(false);
    setBackgroundTasksOpen(true);
    setBackgroundTasksOpen(false);
    expect(getBackgroundTasksSnapshot().open).toBe(false);
    adoptDraftFleet("created-2");
    setFleetChatContext("created-2", true);
    expect(getBackgroundTasksSnapshot().open).toBe(false);
    expect(getBackgroundTasksSnapshot().sessionId).toBe("created-2");
  });

  it("opens for a task, stays closed after dismiss, and reopens for the next task", () => {
    setFleetChatContext("chat", false);
    expect(noteFleetRowsForAutoOpen("chat", [])).toBe(false);
    expect(noteFleetRowsForAutoOpen("chat", [{ id: "task-1" }])).toBe(true);
    setBackgroundTasksOpen(true);
    setBackgroundTasksOpen(false);
    expect(noteFleetRowsForAutoOpen("chat", [{ id: "task-1", toolCallId: "call-1" }])).toBe(false);
    expect(getBackgroundTasksSnapshot().open).toBe(false);
    expect(
      noteFleetRowsForAutoOpen("chat", [
        { id: "bg-1", toolCallId: "call-1" },
      ]),
    ).toBe(false);
    expect(noteFleetRowsForAutoOpen("chat", [{ id: "task-2" }])).toBe(true);
    setBackgroundTasksOpen(true);
    expect(getBackgroundTasksSnapshot().open).toBe(true);
    toggleBackgroundTasks();
    expect(getBackgroundTasksSnapshot().open).toBe(false);
  });

  it("leaves a chat closed when every task is already finished", () => {
    expect(
      noteFleetRowsForAutoOpen("old", [{ id: "done-1", running: false }]),
    ).toBe(false);
    expect(
      noteFleetRowsForAutoOpen("old", [{ id: "done-1", running: false }]),
    ).toBe(false);
    expect(
      noteFleetRowsForAutoOpen("live", [{ id: "run-1", running: true }]),
    ).toBe(true);
    expect(
      noteFleetRowsForAutoOpen("old", [
        { id: "done-1", running: false },
        { id: "run-2", running: true },
      ]),
    ).toBe(true);
  });
});
