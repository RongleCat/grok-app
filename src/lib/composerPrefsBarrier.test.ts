import { describe, expect, it } from "vitest";
import {
  awaitComposerSendBarrier,
  liveHostAfterProviderSwitch,
  queueComposerPreferenceApply,
} from "./composerPrefsBarrier";

describe("composer preference apply barrier", () => {
  it("queued flush waits for the provider-switch barrier", async () => {
    let finish!: () => void;
    const barrier = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let done = false;
    const pending = awaitComposerSendBarrier(true, barrier).then(() => {
      done = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await pending;
    expect(done).toBe(true);
  });

  it("holds the next send until the effort change is applied", async () => {
    let finishApply!: () => void;
    const applying = new Promise<void>((resolve) => {
      finishApply = resolve;
    });
    const applied: string[] = [];
    const first = queueComposerPreferenceApply(
      Promise.resolve(),
      async () => {
        applied.push("high");
        await applying;
      },
      () => undefined,
    );
    const pending = queueComposerPreferenceApply(
      first,
      async () => {
        applied.push("xhigh");
      },
      () => undefined,
    );
    let sent = false;
    const send = pending.then(() => {
      sent = true;
    });

    await Promise.resolve();
    expect(sent).toBe(false);
    expect(applied).toEqual(["high"]);

    finishApply();
    await send;
    expect(sent).toBe(true);
    expect(applied).toEqual(["high", "xhigh"]);
  });

  it("drops a ready live host only when this chat switched provider", () => {
    const live = { sessionId: "s1", state: "ready", modelId: "grok-4.7" };
    expect(liveHostAfterProviderSwitch(live, "s1", true)).toEqual({
      sessionId: "s1",
      state: "disconnected",
      modelId: "grok-4.7",
    });
    expect(liveHostAfterProviderSwitch(live, "s1", false)).toBeNull();
    expect(
      liveHostAfterProviderSwitch(
        { sessionId: "s1", state: "streaming" },
        "s1",
        true,
      ),
    ).toBeNull();
    expect(
      liveHostAfterProviderSwitch(
        { sessionId: "other", state: "ready" },
        "s1",
        true,
      ),
    ).toBeNull();
  });
});
