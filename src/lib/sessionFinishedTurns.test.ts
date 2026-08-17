import { afterEach, describe, expect, it } from "vitest";
import {
  forgetFinishedTurn,
  getFinishedTurns,
  rememberFinishedTurn,
  resetFinishedTurnsForTests,
  subscribeFinishedTurns,
} from "./sessionFinishedTurns";

afterEach(() => {
  resetFinishedTurnsForTests();
});

describe("sessionFinishedTurns", () => {
  it("remembers a finish and forgets when a new turn starts", () => {
    rememberFinishedTurn("s1", 10);
    expect(getFinishedTurns()).toEqual({ s1: 10 });
    forgetFinishedTurn("s1");
    expect(getFinishedTurns()).toEqual({});
  });

  it("notifies subscribers only on change", () => {
    const seen: number[] = [];
    const unsub = subscribeFinishedTurns(() => {
      seen.push(Object.keys(getFinishedTurns()).length);
    });
    rememberFinishedTurn("a", 1);
    rememberFinishedTurn("a", 1);
    rememberFinishedTurn("b", 2);
    forgetFinishedTurn("a");
    unsub();
    rememberFinishedTurn("c", 3);
    expect(seen).toEqual([1, 2, 1]);
  });
});
