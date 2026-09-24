import { describe, expect, it } from "vitest";
import { ComposerPrefsFreshness } from "./composerPrefsFreshness";

/** 手动可控的 promise，用于精确编排「解析返回」与「写入落盘」的时序。 */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 冲刷微任务队列，让链式 then 推进。 */
function flush(times = 3): Promise<void> {
  let p = Promise.resolve();
  for (let i = 0; i < times; i += 1) p = p.then(() => undefined);
  return p;
}

describe("ComposerPrefsFreshness", () => {
  it("keeps a resolve fresh when no local write intervened", () => {
    // Arrange
    const freshness = new ComposerPrefsFreshness();

    // Act
    const version = freshness.beginResolve();

    // Assert
    expect(freshness.isFresh(version)).toBe(true);
  });

  it("invalidates a resolve issued before the user picked a model", async () => {
    // Arrange
    const freshness = new ComposerPrefsFreshness();
    const version = freshness.beginResolve();
    const gate = deferred();

    // Act — 用户在解析返回前切了模型（本地写入登记）
    const write = freshness.trackLocalWrite(() => gate.promise);

    // Assert — 旧解析结果必须被丢弃
    expect(freshness.isFresh(version)).toBe(false);
    gate.resolve();
    await write;
    expect(freshness.isFresh(version)).toBe(false);
  });

  it("becomes fresh again for a resolve issued after the write settled", async () => {
    // Arrange
    const freshness = new ComposerPrefsFreshness();
    const stale = freshness.beginResolve();
    const write = freshness.trackLocalWrite(async () => undefined);
    await write;

    // Act
    await freshness.settled();
    const version = freshness.beginResolve();

    // Assert
    expect(freshness.isFresh(version)).toBe(true);
    expect(freshness.isFresh(stale)).toBe(false);
  });

  it("does not resolve settled() until the in-flight write lands", async () => {
    // Arrange
    const freshness = new ComposerPrefsFreshness();
    const gate = deferred();
    const write = freshness.trackLocalWrite(() => gate.promise);
    let settled = false;
    const waiting = freshness.settled().then(() => {
      settled = true;
    });

    // Act / Assert — 写入未完成前 settled() 不返回
    await flush();
    expect(settled).toBe(false);
    gate.resolve();
    await write;
    await waiting;
    expect(settled).toBe(true);
  });

  it("waits for a write registered while settled() was already pending", async () => {
    // Arrange
    const freshness = new ComposerPrefsFreshness();
    const first = deferred();
    const second = deferred();
    const writeA = freshness.trackLocalWrite(() => first.promise);
    let settled = false;
    const waiting = freshness.settled().then(() => {
      settled = true;
    });

    // Act — 等待期间又登记了一次写入
    const writeB = freshness.trackLocalWrite(() => second.promise);
    first.resolve();
    await writeA;
    await flush();
    // Assert — A 完成但 B 仍在途，settled() 不应返回
    expect(settled).toBe(false);
    second.resolve();
    await writeB;
    await waiting;
    expect(settled).toBe(true);
  });

  it("serializes local writes so settled() sees the last one", async () => {
    // Arrange
    const freshness = new ComposerPrefsFreshness();
    const gate = deferred();
    const order: string[] = [];
    const first = freshness.trackLocalWrite(async () => {
      order.push("start-a");
      await gate.promise;
      order.push("end-a");
    });
    const second = freshness.trackLocalWrite(async () => {
      order.push("start-b");
      order.push("end-b");
    });

    // Act
    gate.resolve();
    await Promise.all([first, second]);

    // Assert
    expect(order).toEqual(["start-a", "end-a", "start-b", "end-b"]);
  });
});
