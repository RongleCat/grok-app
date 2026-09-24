import type { ComposerPrefsSetBody } from "./api/settings";
import type { ComposerPrefsFreshness } from "./composerPrefsFreshness";

/**
 * 把一次 composer prefs 写入登记进 {@link ComposerPrefsFreshness} 的串行链并落盘。
 *
 * `body` 是**已定格的值**（含目标项目/会话）：写入要排队等前面的落盘完成，目标
 * 在排队期间必须保持稳定，因此这里不接受「执行时再去读当前会话」的回调。
 *
 * 排队前驱由 `ComposerPrefsFreshness` 内部维护，调用方拿不到、也不该自备：若把
 * 「本次写入自己的 promise」当前驱，写入会等自己完成而永不 settle，整条链随之
 * 卡死，之后所有 prefs 写入（含切模型）都不会再发出 IPC。
 *
 * @param freshness 维护串行链与「本地写入版本号」的对象。
 * @param body 已定格的落盘内容。
 * @param send 实际发送动作，正常为 `api.composerPrefsSet`。
 * @param onError 落盘失败的回调；失败不阻断队列，后续写入照常执行。
 * @returns 本次写入的 promise，resolve 后表示该次选择已落盘，可作为发送屏障。
 */
export function writeComposerPrefs(
  freshness: ComposerPrefsFreshness,
  body: ComposerPrefsSetBody,
  send: (body: ComposerPrefsSetBody) => Promise<unknown>,
  onError: (error: unknown) => void,
): Promise<void> {
  return freshness.trackLocalWrite(async () => {
    try {
      await send(body);
    } catch (error) {
      onError(error);
    }
  });
}
