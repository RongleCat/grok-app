/**
 * 判定 composerPrefsResolve 的结果是否仍可作为真相落地。
 *
 * 切模型/思考等级会先 `setModelId` 立即刷新界面，再异步 `composerPrefsSet`
 * 落盘；而「项目/会话变化时重新解析」的 effect 是独立的异步 IPC。两者交错时，
 * 更早发起、或在写入落盘前读值的 resolve 会把界面盖回旧模型，直到下一次重新
 * 解析（例如切会话）才纠正。
 *
 * 用法：
 * - 本地写入用 {@link trackLocalWrite} 登记，登记即自增版本号；
 * - resolve 先用 {@link settled} 等本地写入落盘，再 {@link beginResolve} 取版本号；
 * - resolve 返回时用 {@link isFresh} 判定：期间若有新的本地选择（版本号已变），
 *   丢弃这次结果，不做界面回滚。
 *
 * 写入结束后版本号稳定，之后发起的 resolve 仍会正常落地，后端解析保持真相来源。
 */
export class ComposerPrefsFreshness {
  private version = 0;
  private writeChain: Promise<void> = Promise.resolve();

  /** resolve 发起前取当前版本号，返回时用 {@link isFresh} 判定是否过期。 */
  beginResolve(): number {
    return this.version;
  }

  /** 判定 `issuedVersion` 对应的 resolve 结果是否仍可落地。 */
  isFresh(issuedVersion: number): boolean {
    return issuedVersion === this.version;
  }

  /**
   * 等到所有本地写入落盘，且期间新登记的写入也一并等待。
   *
   * 返回后到下一次 `await` 之间不会再有本地写入开始（同步执行），因此紧接其后
   * 调用 {@link beginResolve} 取到的版本号可代表「已落盘状态」。
   */
  async settled(): Promise<void> {
    let chain = this.writeChain;
    for (;;) {
      await chain;
      // 等待期间若有新写入登记，writeChain 已更新，需继续等它。
      if (chain === this.writeChain) return;
      chain = this.writeChain;
    }
  }

  /**
   * 登记一次本地 prefs 写入：登记即自增版本号，作废此前发起的 resolve；
   * 写入串行执行，供 {@link settled} 等待。
   */
  trackLocalWrite<T>(write: () => Promise<T>): Promise<T> {
    this.version += 1;
    const run = this.writeChain.then(() => write());
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
