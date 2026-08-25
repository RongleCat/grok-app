import { describe, expect, it, beforeEach } from "vitest";
import { sessionLiveMapStore } from "@/lib/sessionLiveMapStore";
import { projectHostIntoLiveMap } from "@/lib/sessionLiveStore";
import { peekBusySessionIds } from "./useSessionLiveMap";

describe("useSessionLiveMap helpers", () => {
  beforeEach(() => {
    sessionLiveMapStore.resetForTests();
  });

  it("peekBusySessionIds reflects store without React", () => {
    sessionLiveMapStore.setMap((prev) =>
      projectHostIntoLiveMap(prev, {
        sessionId: "a",
        state: "streaming",
      }),
    );
    expect([...peekBusySessionIds()]).toEqual(["a"]);
  });

  it("busyKey lists busy session ids", () => {
    sessionLiveMapStore.setMap((prev) =>
      projectHostIntoLiveMap(prev, { sessionId: "x", state: "streaming" }),
    );
    const key = sessionLiveMapStore.getBusySnapshot().busyKey;
    expect(key.split("\0")).toContain("x");
  });
});
