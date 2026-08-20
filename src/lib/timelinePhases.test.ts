import { describe, expect, it } from "vitest";
import type { MessageSegment } from "./session";
import {
  buildAssistantTimeline,
  buildTimelineUnits,
  foldProcessIntoTimeline,
  isPhaseWorthy,
  phaseTitleModel,
  shouldShowTrailingLiveThinking,
  weaveSpeechAndTools,
} from "./timelinePhases";
import type { MessageToolSegment } from "./session";

function tool(
  id: string,
  title: string,
  status = "completed",
): Extract<MessageSegment, { kind: "tool" }> {
  return {
    kind: "tool",
    toolCallId: id,
    title,
    toolKind: "read_file",
    status,
    streaming: status === "running",
  };
}

describe("timelinePhases", () => {
  it("isPhaseWorthy: thought+tool or ≥2 tools", () => {
    expect(isPhaseWorthy(["plan"], [tool("a", "Read a")])).toBe(true);
    expect(isPhaseWorthy([], [tool("a", "a"), tool("b", "b")])).toBe(true);
    expect(isPhaseWorthy(["only think"], [])).toBe(false);
    expect(isPhaseWorthy([], [tool("a", "a")])).toBe(false);
  });

  it("closes phase when content starts (not at full turn end only)", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "**定位** 目录结构" },
      tool("t1", "Read a"),
      tool("t2", "Read b"),
      { kind: "content", text: "结论如下。" },
      { kind: "thought", text: "再查一遍" },
      tool("t3", "Read c"),
      { kind: "content", text: "补充。" },
    ];
    // Still streaming after first content would keep later work live — turn done:
    const units = buildTimelineUnits(segs, { streaming: false });
    expect(units.map((u) => u.kind)).toEqual([
      "phase",
      "content",
      "phase",
      "content",
    ]);
    const p0 = units[0]!;
    expect(p0.kind).toBe("phase");
    if (p0.kind === "phase") {
      expect(p0.live).toBe(false);
      expect(p0.tools).toHaveLength(2);
      expect(p0.thoughts[0]).toContain("定位");
      const title = phaseTitleModel(p0);
      expect(title.gist).toBeTruthy();
      expect(title.stepCount).toBe(2);
    }
  });

  it("merges adjacent think/tool bursts into ONE phase (no body between)", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "round1" },
      tool("t1", "Read a"),
      { kind: "thought", text: "round2" },
      tool("t2", "Read b"),
      tool("t3", "Read c"),
    ];
    const units = buildTimelineUnits(segs, { streaming: false });
    // A long agent turn must NOT render as a stack of “Worked for 1s” blocks.
    expect(units.map((u) => u.kind)).toEqual(["phase"]);
    if (units[0]!.kind === "phase") {
      expect(units[0]!.tools).toHaveLength(3);
      expect(units[0]!.thoughts).toEqual(["round1", "round2"]);
      expect(units[0]!.items).toHaveLength(5);
    }
  });

  it("content still splits phases (answer boundary)", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "round1" },
      tool("t1", "Read a"),
      { kind: "content", text: "结论如下。" },
      { kind: "thought", text: "round2" },
      tool("t2", "Read b"),
    ];
    const units = buildTimelineUnits(segs, { streaming: false });
    expect(units.map((u) => u.kind)).toEqual(["phase", "content", "phase"]);
  });

  it("trailing work stays live while streaming", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "**探索**" },
      tool("t1", "Read a", "completed"),
      tool("t2", "Read b", "running"),
    ];
    const live = buildTimelineUnits(segs, { streaming: true });
    expect(live).toHaveLength(1);
    expect(live[0]!.kind).toBe("phase");
    if (live[0]!.kind === "phase") {
      expect(live[0]!.live).toBe(true);
      expect(live[0]!.runningCount).toBe(1);
    }
    const done = buildTimelineUnits(segs.map((s) =>
      s.kind === "tool" ? { ...s, status: "completed", streaming: false } : s,
    ), { streaming: false });
    if (done[0]!.kind === "phase") {
      expect(done[0]!.live).toBe(false);
    }
  });

  it("empty tool status without streaming is not running", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "plan" },
      {
        kind: "tool",
        toolCallId: "t1",
        title: "Read",
        toolKind: "read_file",
        status: "",
        streaming: false,
      },
      {
        kind: "tool",
        toolCallId: "t2",
        title: "List",
        toolKind: "list_dir",
        status: "completed",
        streaming: false,
      },
      { kind: "content", text: "done" },
    ];
    const units = buildTimelineUnits(segs, { streaming: false });
    expect(units[0]!.kind).toBe("phase");
    if (units[0]!.kind === "phase") {
      expect(units[0]!.live).toBe(false);
      expect(units[0]!.runningCount).toBe(0);
    }
  });

  it("turn end clears runningCount even when tools still claim running", () => {
    // Real bug: tool_call_update never sent "completed", so status stayed
    // in_progress after the assistant finished — UI showed "工作中 8m…".
    const segs: MessageSegment[] = [
      { kind: "thought", text: "The video analysis is running" },
      tool("t1", "Read file", "in_progress"),
      tool("t2", "Edit file", "running"),
      { kind: "content", text: "分析完成" },
    ];
    const live = buildTimelineUnits(segs, { streaming: true });
    expect(live[0]!.kind).toBe("phase");
    if (live[0]!.kind === "phase") {
      expect(live[0]!.runningCount).toBe(2);
    }
    const done = buildTimelineUnits(segs, { streaming: false });
    expect(done[0]!.kind).toBe("phase");
    if (done[0]!.kind === "phase") {
      expect(done[0]!.live).toBe(false);
      expect(done[0]!.runningCount).toBe(0);
    }
  });

  it("single thought or single tool stays bare (not a phase chip)", () => {
    expect(
      buildTimelineUnits(
        [{ kind: "thought", text: "hmm" }, { kind: "content", text: "hi" }],
        { streaming: false },
      ).map((u) => u.kind),
    ).toEqual(["thought", "content"]);

    expect(
      buildTimelineUnits(
        [tool("only", "Read x"), { kind: "content", text: "ok" }],
        { streaming: false },
      ).map((u) => u.kind),
    ).toEqual(["tool", "content"]);
  });

  it("phase id stays stable while a live phase grows (no endSi churn)", () => {
    const base: MessageSegment[] = [
      { kind: "thought", text: "plan" },
      tool("a", "Read a"),
    ];
    const p1 = buildTimelineUnits(base, { streaming: true });
    const grown = buildTimelineUnits(
      [...base, tool("b", "Read b"), tool("c", "Read c")],
      { streaming: true },
    );
    if (p1[0]!.kind === "phase" && grown[0]!.kind === "phase") {
      expect(p1[0]!.id).toBe(grown[0]!.id);
    }
  });

  it("failed tools set errorCount for default expand", () => {
    const units = buildTimelineUnits(
      [
        { kind: "thought", text: "try" },
        tool("ok", "Read a"),
        {
          ...tool("bad", "Shell"),
          toolKind: "run_terminal_command",
          status: "failed",
          isError: true,
        },
      ],
      { streaming: false },
    );
    expect(units[0]!.kind).toBe("phase");
    if (units[0]!.kind === "phase") {
      expect(units[0]!.errorCount).toBe(1);
    }
  });

  it("history reconstruction thought→tools→content yields phase then content", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "**定位** 项目" },
      tool("t1", "Read a"),
      tool("t2", "Read b"),
      tool("t3", "Read c"),
      { kind: "content", text: "项目概览……" },
    ];
    const units = buildTimelineUnits(segs, { streaming: false });
    expect(units.map((u) => u.kind)).toEqual(["phase", "content"]);
    if (units[0]!.kind === "phase") {
      expect(units[0]!.live).toBe(false);
      expect(units[0]!.tools).toHaveLength(3);
    }
  });

  it("thought after first content stays live while the turn is streaming", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "round1" },
      { kind: "content", text: "先睇 Ego Lite。" },
      { kind: "thought", text: "round2 still thinking" },
    ];
    const live = buildTimelineUnits(segs, { streaming: true });
    expect(live.map((u) => u.kind)).toEqual(["thought", "content", "thought"]);
    const last = live[2]!;
    expect(last.kind).toBe("thought");
    if (last.kind === "thought") expect(last.streaming).toBe(true);
    const first = live[0]!;
    expect(first.kind).toBe("thought");
    if (first.kind === "thought") expect(first.streaming).toBe(false);
  });

  it("shouldShowTrailingLiveThinking skips a live last content tail", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "round1" },
      tool("t1", "Read a"),
      { kind: "content", text: "先睇 Ego Lite。" },
    ];
    const units = buildTimelineUnits(segs, { streaming: true });
    expect(shouldShowTrailingLiveThinking(units, {
      messageStreaming: true,
      hasRunningTool: false,
    })).toBe(false);
    expect(shouldShowTrailingLiveThinking(units, {
      messageStreaming: true,
      hasRunningTool: true,
    })).toBe(false);
    expect(shouldShowTrailingLiveThinking(units, {
      messageStreaming: false,
      hasRunningTool: false,
    })).toBe(false);

    const thinking = buildTimelineUnits(
      [...segs, { kind: "thought", text: "round2" }],
      { streaming: true },
    );
    expect(shouldShowTrailingLiveThinking(thinking, {
      messageStreaming: true,
      hasRunningTool: false,
    })).toBe(false);
  });

  it("shouldShowTrailingLiveThinking after a last bare tool while waiting", () => {
    const segs: MessageSegment[] = [tool("t1", "Read a")];
    const units = buildTimelineUnits(segs, { streaming: true });
    expect(shouldShowTrailingLiveThinking(units, {
      messageStreaming: true,
      hasRunningTool: false,
    })).toBe(true);
    expect(shouldShowTrailingLiveThinking(units, {
      messageStreaming: false,
      hasRunningTool: false,
    })).toBe(false);
  });

  it("does not paint trailing thinking while an earlier work phase still has running tools", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "round1" },
      tool("t1", "Read a", "running"),
      { kind: "content", text: "正在调用接口。" },
    ];
    const units = buildTimelineUnits(segs, { streaming: true });
    const phase = units[0]!;
    expect(phase.kind).toBe("phase");
    if (phase.kind === "phase") {
      expect(phase.runningCount).toBe(1);
    }
    expect(
      shouldShowTrailingLiveThinking(units, {
        messageStreaming: true,
        hasRunningTool: false,
      }),
    ).toBe(false);
  });
});

function bash(id: string): MessageToolSegment {
  return {
    kind: "tool",
    toolCallId: id,
    title: "Run",
    toolKind: "run_terminal_command",
    status: "completed",
    streaming: false,
  };
}

function edit(id: string): MessageToolSegment {
  return {
    kind: "tool",
    toolCallId: id,
    title: "Edit",
    toolKind: "search_replace",
    status: "completed",
    streaming: false,
  };
}

describe("foldProcessIntoTimeline", () => {
  it("keeps process body as content — never folds it into 工作了 speech", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "The plan is to decode eight shots" },
      tool("r1", "Read a"),
      tool("r2", "Read b"),
      bash("b1"),
      bash("b2"),
      bash("b3"),
      edit("e1"),
      edit("e2"),
      {
        kind: "content",
        text: `按上次说的做：先把 8 张 hard-set 都 decode 对照手写种子，再拿反推稿出图，跑 decode → render 闭环。8 张类型全对。接着用反推稿出图，文件名加 \`-decode\`，不覆盖旧成品。H1 出图撞上 Cloudflare 524。我给生图加上有限次重试，然后从 H1 接着跑。8 张 decode 稿都出了。

成品文件名带 \`-decode\`，旧的手写成品没动。Finder 已打开。

| 看这张闭环 | 结果 |
|---|---|
| \`H6-type-poster-decode.png\` | **最好**。标题、眼窗、口号都在 |`,
      },
    ];
    const units = buildAssistantTimeline(segs, { streaming: false });
    expect(units.map((u) => u.kind)).toEqual(["phase", "content"]);
    const phase = units[0]!;
    expect(phase.kind).toBe("phase");
    if (phase.kind === "phase") {
      expect(phase.thoughts[0]).toContain("decode eight");
      expect(phase.items.some((i) => i.kind === "speech")).toBe(false);
      expect(phase.tools.length).toBe(7);
    }
    const answer = units[1]!;
    expect(answer.kind).toBe("content");
    if (answer.kind === "content") {
      expect(answer.text).toContain("先把 8 张");
      expect(answer.text).toContain("成品文件名带");
    }
  });

  it("keeps every mid-turn content visible instead of last-sentence-only", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "round1" },
      tool("r1", "Read a"),
      tool("r2", "Read b"),
      { kind: "content", text: "先看仓库结构，接着对一下入口。" },
      bash("b1"),
      bash("b2"),
      {
        kind: "content",
        text: `本地已经改完，接下来装一遍确认。我再把对照表写清楚。先把重试补上，再核一遍成品路径，避免旧文件被覆盖。已经对上类型，接着把对照表写进正文，并把 Finder 打开给用户看。本地路径都对上了。

成品在 \`evals/renders/\`，对照表如下。

| 图 | 结果 |
|---|---|
| a | 过 |`,
      },
    ];
    const units = buildAssistantTimeline(segs, { streaming: false });
    expect(units.map((u) => u.kind)).toEqual([
      "phase",
      "content",
      "phase",
      "content",
    ]);
    const phase = units[0]!;
    expect(phase.kind).toBe("phase");
    if (phase.kind === "phase") {
      expect(phase.thoughts).toEqual(["round1"]);
      expect(phase.tools).toHaveLength(2);
    }
    const later = units[2]!;
    expect(later.kind).toBe("phase");
    if (later.kind === "phase") {
      expect(later.tools).toHaveLength(2);
    }
    const bodies = units.filter((u) => u.kind === "content");
    expect(bodies.map((u) => (u.kind === "content" ? u.text : ""))).toEqual([
      "先看仓库结构，接着对一下入口。",
      expect.stringContaining("成品在"),
    ]);
    expect(
      bodies.some(
        (u) => u.kind === "content" && u.text.includes("先看仓库结构"),
      ),
    ).toBe(true);
  });

  it("weaves a trailing process blob in front of tool family groups", () => {
    const woven = weaveSpeechAndTools([
      { kind: "tool", tool: tool("r1", "Read a") },
      { kind: "tool", tool: tool("r2", "Read b") },
      { kind: "tool", tool: bash("b1") },
      { kind: "tool", tool: bash("b2") },
      { kind: "speech", text: "先对照手写种子。" },
      { kind: "speech", text: "再补重试。" },
    ]);
    expect(woven.map((i) => i.kind)).toEqual([
      "speech",
      "tool",
      "tool",
      "speech",
      "tool",
      "tool",
    ]);
  });

  it("does not hide a streaming last content that has no cut yet", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "plan" },
      tool("r1", "Read a"),
      tool("r2", "Read b"),
      { kind: "content", text: "正在写结论，还没有分段。" },
    ];
    const live = foldProcessIntoTimeline(
      buildTimelineUnits(segs, { streaming: true }),
      { streaming: true },
    );
    expect(live.map((u) => u.kind)).toEqual(["phase", "content"]);
    const content = live[1]!;
    expect(content.kind).toBe("content");
    if (content.kind === "content") {
      expect(content.text).toContain("正在写结论");
    }
  });

  it("keeps the whole body visible when tools follow it", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "plan" },
      tool("r1", "Read a"),
      tool("r2", "Read b"),
      {
        kind: "content",
        text: `按上次说的做：先把 8 张 hard-set 都 decode 对照手写种子，再拿反推稿出图，跑 decode → render 闭环。8 张类型全对。接着用反推稿出图，文件名加 \`-decode\`，不覆盖旧成品。H1 出图撞上 Cloudflare 524。我给生图加上有限次重试，然后从 H1 接着跑。8 张 decode 稿都出了。

成品文件名带 \`-decode\`，旧的手写成品没动。Finder 已打开。`,
      },
      bash("open-finder"),
    ];
    const units = buildAssistantTimeline(segs, { streaming: false });
    expect(units.map((u) => u.kind)).toContain("content");
    const answer = units.find((u) => u.kind === "content");
    expect(answer && answer.kind === "content" && answer.text).toContain(
      "成品文件名带",
    );
    expect(answer && answer.kind === "content" && answer.text).toContain(
      "先把 8 张",
    );
    const phase = units.find((u) => u.kind === "phase");
    expect(phase && phase.kind === "phase").toBe(true);
    if (phase && phase.kind === "phase") {
      expect(phase.items.some((i) => i.kind === "speech")).toBe(false);
      expect(phase.thoughts[0]).toContain("plan");
    }
  });

  it("does not swallow a streaming last content when a later tool arrives", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "plan" },
      tool("r1", "Read a"),
      tool("r2", "Read b"),
      { kind: "content", text: "正在写结论，还没有分段。" },
      bash("open-finder"),
    ];
    const live = foldProcessIntoTimeline(
      buildTimelineUnits(segs, { streaming: true }),
      { streaming: true },
    );
    const content = live.find((u) => u.kind === "content");
    expect(content && content.kind === "content" && content.text).toContain(
      "正在写结论",
    );
  });

  it("does not invent a work fold for a body-only turn", () => {
    const segs: MessageSegment[] = [
      {
        kind: "content",
        text: `先接手这个 Claude 会话，核对项目上下文和站点上线状态。接着按 resume 协议读会话交接文档，并拉项目上下文。正在读取该 Claude 会话，并核对仓库与上线相关证据。会话 ID 没直接命中，接着列本地会话并核对站点是否真的上线。

刚接手的是 Grok.app 分叉会话，不是 Claude。

今天刚核过的线上事实：

| 入口 | 现状 |
|---|---|
| \`skills.bflabs.cn\` | 无 DNS，解析失败 |`,
      },
    ];
    const units = buildAssistantTimeline(segs, { streaming: false });
    expect(units.map((u) => u.kind)).toEqual(["content"]);
    const answer = units[0]!;
    expect(answer.kind).toBe("content");
    if (answer.kind === "content") {
      expect(answer.text).toContain("先接手这个");
      expect(answer.text).toContain("刚接手的是");
    }
  });

  it("keeps think → tools → body → think → tools → answer in stream order", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "round1" },
      tool("t1", "Read a"),
      tool("t2", "Read b"),
      { kind: "content", text: "先核对技能目录，再下载压缩包。" },
      { kind: "thought", text: "round2" },
      bash("b1"),
      { kind: "content", text: "安装完成。" },
    ];
    const units = buildAssistantTimeline(segs, { streaming: false });
    expect(units.map((u) => u.kind)).toEqual([
      "phase",
      "content",
      "phase",
      "content",
    ]);
    const p0 = units[0]!;
    expect(p0.kind).toBe("phase");
    if (p0.kind === "phase") {
      expect(p0.thoughts).toEqual(["round1"]);
      expect(p0.tools.map((t) => t.toolCallId)).toEqual(["t1", "t2"]);
      expect(p0.items.some((i) => i.kind === "speech")).toBe(false);
    }
    expect(units[1]).toMatchObject({
      kind: "content",
      text: "先核对技能目录，再下载压缩包。",
    });
    const p1 = units[2]!;
    expect(p1.kind).toBe("phase");
    if (p1.kind === "phase") {
      expect(p1.thoughts).toEqual(["round2"]);
      expect(p1.tools.map((t) => t.toolCallId)).toEqual(["b1"]);
    }
    expect(units[3]).toMatchObject({
      kind: "content",
      text: "安装完成。",
    });
  });

  it("does not hoist later thinking above unfinished tools after a mid-turn body", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "round1" },
      tool("t1", "Read a", "running"),
      { kind: "content", text: "正在调用生图接口。" },
      { kind: "thought", text: "round2" },
    ];
    const units = buildAssistantTimeline(segs, { streaming: true });
    expect(units.map((u) => u.kind)).toEqual([
      "phase",
      "content",
      "thought",
    ]);
    const phase = units[0]!;
    expect(phase.kind).toBe("phase");
    if (phase.kind === "phase") {
      expect(phase.tools[0]?.toolCallId).toBe("t1");
    }
    const last = units[2]!;
    expect(last.kind).toBe("thought");
    if (last.kind === "thought") {
      expect(last.text).toBe("round2");
      expect(last.streaming).toBe(true);
    }
    expect(
      shouldShowTrailingLiveThinking(units, {
        messageStreaming: true,
        hasRunningTool: true,
      }),
    ).toBe(false);
  });

  it("keeps every live status sentence visible (DSH long-turn shape)", () => {
    const segs: MessageSegment[] = [
      { kind: "thought", text: "Look at both projects" },
      tool("t1", "Read a"),
      tool("t2", "Read b"),
      { kind: "content", text: "我先查看工作区里 DSH_CLIAPI 和 DSH_api 的目录。" },
      bash("b1"),
      { kind: "content", text: "两个项目都在，接着核对 git 历史。" },
      bash("b2"),
      { kind: "content", text: "测试都过了。接下来分别提交两个仓库并推到 GitHub。" },
    ];
    const live = buildAssistantTimeline(segs, { streaming: true });
    expect(live.map((u) => u.kind)).toEqual([
      "phase",
      "content",
      "tool",
      "content",
      "tool",
      "content",
    ]);
    const texts = live
      .filter((u): u is Extract<typeof u, { kind: "content" }> => u.kind === "content")
      .map((u) => u.text);
    expect(texts).toEqual([
      "我先查看工作区里 DSH_CLIAPI 和 DSH_api 的目录。",
      "两个项目都在，接着核对 git 历史。",
      "测试都过了。接下来分别提交两个仓库并推到 GitHub。",
    ]);
    const phase = live.find((u) => u.kind === "phase");
    expect(phase && phase.kind === "phase").toBe(true);
    if (phase && phase.kind === "phase") {
      expect(phase.thoughts[0]).toContain("Look at both projects");
      expect(phase.tools).toHaveLength(2);
    }
  });
});
