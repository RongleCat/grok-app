import { describe, expect, it } from "vitest";
import {
  acquireAppearanceWrite,
  isAppearanceWriteBusy,
} from "./appearanceWriteLock";

describe("appearanceWriteLock", () => {
  it("serializes overlapping acquires", async () => {
    const order: string[] = [];
    const a = acquireAppearanceWrite().then(async (unlock) => {
      order.push("a-in");
      expect(isAppearanceWriteBusy()).toBe(true);
      await Promise.resolve();
      order.push("a-out");
      unlock();
    });
    const b = acquireAppearanceWrite().then((unlock) => {
      order.push("b-in");
      unlock();
      order.push("b-out");
    });
    await Promise.all([a, b]);
    expect(order).toEqual(["a-in", "a-out", "b-in", "b-out"]);
    expect(isAppearanceWriteBusy()).toBe(false);
  });
});
