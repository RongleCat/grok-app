import { describe, expect, it, vi } from "vitest";
import { ComposerPrefsFreshness } from "./composerPrefsFreshness";
import type { ComposerPrefsSetBody } from "./api/settings";
import { writeComposerPrefs } from "./composerPrefsWrite";

/** 可手动放行的闸门，用来把某次落盘按住在途状态。 */
function createGate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe("writeComposerPrefs", () => {
  it("落盘成功后返回的 promise resolve，可作为发送屏障", async () => {
    // Arrange
    const freshness = new ComposerPrefsFreshness();
    const sent: ComposerPrefsSetBody[] = [];
    const onError = vi.fn();
    const gate = createGate();
    const settled = vi.fn();

    // Act
    const write = writeComposerPrefs(
      freshness,
      { projectId: "p-1", sessionId: "s-A", effort: "high" },
      async (body) => {
        sent.push(body);
        await gate.promise;
      },
      onError,
    );
    void write.then(settled);

    // Assert：发送屏障必须等到真正落盘，而不是登记即放行。
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(settled).not.toHaveBeenCalled();
    gate.open();
    await write;
    expect(settled).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("落盘失败时上抛给 onError，返回的 promise 仍然 resolve", async () => {
    // Arrange
    const freshness = new ComposerPrefsFreshness();
    const failure = new Error("ipc down");
    const onError = vi.fn();

    // Act
    await writeComposerPrefs(
      freshness,
      { projectId: null, sessionId: null, modelId: "m-1" },
      async () => {
        throw failure;
      },
      onError,
    );

    // Assert
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("串行落盘：上一次未完成时下一次不发出，放行后按登记顺序执行", async () => {
    // Arrange
    const freshness = new ComposerPrefsFreshness();
    const sent: string[] = [];
    const gate = createGate();
    const first = writeComposerPrefs(
      freshness,
      { projectId: null, sessionId: "s-A", effort: "low" },
      async () => {
        sent.push("first");
        await gate.promise;
      },
      () => undefined,
    );
    const second = writeComposerPrefs(
      freshness,
      { projectId: null, sessionId: "s-B", modelId: "m-1" },
      async () => {
        sent.push("second");
      },
      () => undefined,
    );

    // Act
    await Promise.resolve();
    expect(sent).toEqual(["first"]);
    gate.open();
    await Promise.all([first, second]);

    // Assert
    expect(sent).toEqual(["first", "second"]);
  });

  it("排队期间切到别的会话，落盘仍写到登记时的那个会话", async () => {
    // Arrange：body 以值传入，目标在登记那一刻定格。
    const freshness = new ComposerPrefsFreshness();
    const sent: ComposerPrefsSetBody[] = [];
    const gate = createGate();
    const first = writeComposerPrefs(
      freshness,
      { projectId: null, sessionId: "s-A", effort: "low" },
      async () => {
        await gate.promise;
      },
      () => undefined,
    );

    // Act
    const second = writeComposerPrefs(
      freshness,
      { projectId: null, sessionId: "s-B", modelId: "m-1" },
      async (body) => {
        sent.push(body);
      },
      () => undefined,
    );
    await Promise.resolve();
    expect(sent).toEqual([]); // 上一次还在途
    gate.open();
    await Promise.all([first, second]);

    // Assert
    expect(sent).toEqual([
      { projectId: null, sessionId: "s-B", modelId: "m-1" },
    ]);
  });
});
