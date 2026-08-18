import { describe, expect, it } from "vitest";
import { queueComposerPreferenceApply } from "./composerPrefsBarrier";

describe("composer preference apply barrier", () => {
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
});
