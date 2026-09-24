/**
 * 护栏：选择模型必须**同时**更新本地 `modelId` 状态。
 *
 * 这个缺口连着踩了两次：
 * - 官方分支有 `setModelId`，自定义 provider 分支只有 `setEffort` —— 自定义路由下
 *   芯片的显示取自 `resolveActiveCustomModel({ provider, modelId })`，它与会话的
 *   `modelId` 对齐；少这一次更新，显示就一直停在旧值，直到切会话触发重新解析。
 *   模型本身早已生效，于是表现为「点了没反应、实际已切换」。
 *
 * 分支体在 `handleModelPick` 这个 React 回调里，无法用纯函数断言；沿用仓库既有的
 * 源码 guard 范式把不变量钉住。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const app = readFileSync(join(__dirname, "../app/AppWorkbench.tsx"), "utf8");

/** 取出 `handleModelPick` 的完整实现（到下一个顶层 useCallback 为止）。 */
function handleModelPickBody(): string {
  const start = app.indexOf("const handleModelPick = useCallback(");
  expect(start).toBeGreaterThan(-1);
  const next = app.indexOf("const ", app.indexOf("\n  );", start));
  return app.slice(start, next > -1 ? next : start + 12000);
}

describe("model picker updates local state", () => {
  it("sets the local model id in every branch", () => {
    // Arrange
    const body = handleModelPickBody();

    // Assert — 两个分支各一次：官方分支 + 自定义 provider 分支
    const calls = body.match(/setModelId\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);

    // 自定义分支必须带上它自己的 modelId（而不是只改 effort）
    const customIdx = body.indexOf('pick.kind === "official"');
    expect(customIdx).toBeGreaterThan(-1);
    const customBranch = body.slice(customIdx);
    expect(customBranch).toMatch(/setModelId\(pick\.modelId\)/);
  });

  it("never rewrites the channel's global model on a pick", () => {
    // Arrange / Act / Assert — 那正是「改一个会话 = 改全局」的根因
    const body = handleModelPickBody();
    expect(body).not.toMatch(/providersUpsert\(\{/);
  });
});
