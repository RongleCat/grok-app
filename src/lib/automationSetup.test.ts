import { describe, expect, it } from "vitest";
import {
  aiCreateSeedPrompt,
  extractAutomationPayload,
  hasExplicitScheduleSignal,
  looksLikeScheduleIntent,
  looksLikeScheduleReject,
  looksLikeScheduleUpdateIntent,
  looksLikeStandingModeIntent,
  parseAutomationConfigJson,
  recentUserPlainText,
  resolveAutomationUpsertTarget,
  shouldAutoApplyAutomationFence,
  wrapAutomationSetupAgentText,
} from "./automationSetup";

describe("automationSetup", () => {
  it("seed prompt has no json schema", () => {
    const s = aiCreateSeedPrompt();
    expect(s).not.toMatch(/```/);
    expect(s.toLowerCase()).not.toContain("frequency");
    expect(s).toMatch(/定期|多久/);
  });

  it("wraps user text with silent prefix without user-facing schema words in body only", () => {
    const w = wrapAutomationSetupAgentText("每天 9 点查天气");
    expect(w).toContain("User request:");
    expect(w).toContain("每天 9 点查天气");
    expect(w).toContain("grok-automation");
    expect(w).toMatch(/Only schedule when|role cards|NOT schedules/i);
  });

  it("parses valid fence and strips from display", () => {
    const text = [
      "好的，我会每天早上 9 点查询动态。",
      "",
      "```grok-automation",
      JSON.stringify({
        title: "查 cgnot996",
        prompt: "查询 X 上 @cgnot996 最近动态并摘要",
        frequency: "daily",
        time: "09:00",
        weekdays: [],
        enabled: true,
      }),
      "```",
    ].join("\n");
    const { cleanText, input } = extractAutomationPayload(text);
    expect(cleanText).toContain("每天早上 9 点");
    expect(cleanText).not.toContain("grok-automation");
    expect(cleanText).not.toContain('"title"');
    expect(input?.title).toBe("查 cgnot996");
    expect(input?.frequency).toBe("daily");
    expect(input?.time).toBe("09:00");
    expect(input?.nextRunAt).toBeTruthy();
  });

  it("accepts json fence fallback", () => {
    const text = `确认一下\n\`\`\`json\n{"title":"t","prompt":"p","frequency":"once","time":"20:30","enabled":true}\n\`\`\``;
    const { input, cleanText } = extractAutomationPayload(text);
    expect(input?.title).toBe("t");
    expect(input?.frequency).toBe("once");
    expect(cleanText).toBe("确认一下");
  });

  it("keeps ordinary json samples in the transcript", () => {
    const payload = `{
  "config": [
    {
      "kind": "Databus",
      "metadata": { "name": "surreal_app_prefix_301_write_test" },
      "spec": { "batch": { "max_events": 50, "timeout_secs": 1 } }
    }
  ]
}`;
    const text = `给了，就是这个：\n\n\`\`\`json\n${payload}\n\`\`\``;
    const { input, cleanText, rawJson } = extractAutomationPayload(text);
    expect(input).toBeNull();
    expect(rawJson).toBeNull();
    expect(cleanText).toContain("给了，就是这个：");
    expect(cleanText).toContain("```json");
    expect(cleanText).toContain('"kind": "Databus"');
    expect(cleanText).toContain('"max_events": 50');
  });

  it("strips broken grok-automation fences but keeps nearby json samples", () => {
    const text = [
      "示例：",
      "```json",
      '{"hello":"world"}',
      "```",
      "",
      "```grok-automation",
      "{not-json",
      "```",
    ].join("\n");
    const { input, cleanText } = extractAutomationPayload(text);
    expect(input).toBeNull();
    expect(cleanText).toContain("```json");
    expect(cleanText).toContain('"hello":"world"');
    expect(cleanText).not.toContain("grok-automation");
    expect(cleanText).not.toContain("{not-json");
  });

  it("parses real failed-session style fence", () => {
    const text = `好的，已设好。\n\n\`\`\`grok-automation\n{"title":"知识库美女提示词检索","prompt":"在用户的知识库检索","frequency":"once","time":"20:56","weekdays":[],"enabled":true}\n\`\`\``;
    const { input, cleanText } = extractAutomationPayload(text);
    expect(input?.title).toBe("知识库美女提示词检索");
    expect(input?.frequency).toBe("once");
    expect(cleanText).not.toContain("grok-automation");
  });

  it("detects schedule intent for real timers", () => {
    expect(
      looksLikeScheduleIntent(
        "过 3 分钟帮我从知识库里找一个关于美女的图片提示词",
      ),
    ).toBe(true);
    expect(looksLikeScheduleIntent("每天早上 9 点查天气")).toBe(true);
    expect(looksLikeScheduleIntent("帮我改一下登录按钮颜色")).toBe(false);
  });

  it("does not treat goal/role standing cards as schedule intent", () => {
    const roleCard = [
      "# 角色与模式",
      "你是负责「奥德赛」产品的搭档，运行在【目标模式】下。",
      "目标模式 = 始终对齐用户的最终体验目标；每次回复只服务沉浸。",
      "产品原则：线性主线 > 自由沙盒。",
    ].join("\n");
    expect(looksLikeStandingModeIntent(roleCard)).toBe(true);
    expect(hasExplicitScheduleSignal(roleCard)).toBe(false);
    expect(looksLikeScheduleIntent(roleCard)).toBe(false);
    expect(
      shouldAutoApplyAutomationFence({
        inExplicitAutomationSetup: false,
        recentUserText: roleCard,
      }),
    ).toBe(false);
  });

  it("honors explicit reject even with daily language", () => {
    const t = "禁止定时任务。每天只在对话里提醒我原则，不要创建已安排。";
    expect(looksLikeScheduleReject(t)).toBe(true);
    expect(looksLikeScheduleIntent(t)).toBe(false);
    expect(
      shouldAutoApplyAutomationFence({
        inExplicitAutomationSetup: true,
        recentUserText: t,
      }),
    ).toBe(false);
  });

  it("detects schedule update intent without clock language", () => {
    expect(
      looksLikeScheduleUpdateIntent(
        "语料库路径挪了，改一下这个定时任务的提示词",
      ),
    ).toBe(true);
    expect(
      looksLikeScheduleUpdateIntent("我看提示词里一点都没改，再看看是哪里的问题"),
    ).toBe(true);
    expect(looksLikeScheduleUpdateIntent("帮我改一下登录按钮颜色")).toBe(
      false,
    );
    expect(
      shouldAutoApplyAutomationFence({
        inExplicitAutomationSetup: false,
        recentUserText: "更新已安排里那条收录任务的路径",
      }),
    ).toBe(true);
  });

  it("upserts by title instead of stacking create", () => {
    const list = [
      {
        id: "old",
        title: "每日 X 输出收录语料库",
        updatedAt: "2026-08-11T12:00:00.000Z",
      },
      {
        id: "newer",
        title: "每日 X 输出收录语料库",
        updatedAt: "2026-08-11T13:00:00.000Z",
      },
    ];
    expect(
      resolveAutomationUpsertTarget(list, {
        title: "每日 X 输出收录语料库",
        action: "upsert",
      }),
    ).toEqual({ kind: "update", id: "newer" });
    expect(
      resolveAutomationUpsertTarget(list, {
        title: "每日 X 输出收录语料库",
        existingId: "old",
      }),
    ).toEqual({ kind: "update", id: "old" });
    expect(
      resolveAutomationUpsertTarget(list, {
        title: "全新任务",
        action: "upsert",
      }),
    ).toEqual({ kind: "create" });
    expect(
      resolveAutomationUpsertTarget(list, {
        title: "每日 X 输出收录语料库",
        action: "create",
      }),
    ).toEqual({ kind: "create" });
  });

  it("parses fence action and id for upsert", () => {
    const text = `好的\n\`\`\`grok-automation\n{"title":"t","prompt":"p","frequency":"daily","time":"03:30","action":"upsert","id":"abc"}\n\`\`\``;
    const { input, existingId, action } = extractAutomationPayload(text);
    expect(input?.title).toBe("t");
    expect(existingId).toBe("abc");
    expect(action).toBe("upsert");
  });

  it("auto-applies for explicit setup or clear schedule; not for bare goal text", () => {
    expect(
      shouldAutoApplyAutomationFence({
        inExplicitAutomationSetup: true,
        recentUserText: "帮我配置一下",
      }),
    ).toBe(true);
    expect(
      shouldAutoApplyAutomationFence({
        inExplicitAutomationSetup: false,
        recentUserText: "每天 9 点查 @user",
      }),
    ).toBe(true);
    expect(
      shouldAutoApplyAutomationFence({
        inExplicitAutomationSetup: false,
        recentUserText: "/goal 收敛主线点燃进厅探洞",
      }),
    ).toBe(false);
  });

  it("recentUserPlainText joins last N user messages", () => {
    const text = recentUserPlainText(
      [
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "u2" },
        { role: "assistant", content: "a2" },
        { role: "user", content: "u3" },
      ],
      2,
    );
    expect(text).toBe("u2\nu3");
  });

  it("rejects incomplete config", () => {
    expect(parseAutomationConfigJson('{"title":"only"}')).toBeNull();
    expect(parseAutomationConfigJson("not json")).toBeNull();
  });
});
