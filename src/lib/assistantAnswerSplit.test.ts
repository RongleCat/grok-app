import { describe, expect, it } from "vitest";
import { processSpeechParagraphs, splitAssistantAnswer } from "./assistantAnswerSplit";

/** Shape of journal a51171b5 / message 428d3ffa (process diary + --- + 01/02/03). */
const FORK_FIXTURE = `已有品牌事实和第一版列表稿。接下来读规格、现稿和风格库，确认另外两版的结构差异再动手。先把 \`bflabs-ui\` 仓库当品牌源核对一遍，再按同一套 token 补完另外两版结构不同的稿。本地已经有 \`bflabs-ui\`。我先拆它的 token、组件和官网入口，再按同一套语言写另外两版。设计系统已经对上。接着读组件用法、官网动效和技能站参考，保证三版共用同一套 \`bflabs-ui\`，只换信息架构。接下来把 \`bflabs-ui\` 的 token 和组件样式落到本地，并抽出官网轨道几何，三版共用同一套语言。用户还提到团队官网入口。我先核一下除了 \`bflabs.cn\` 之外还有没有独立团队站，避免三版把外链写错。资产已经落到仓库。下面写共用套件，并按同一套 \`bflabs-ui\` 出三版结构不同的稿。共用套件写好了。接下来三版分开写：列表索引、货架网格、官网巨字，骨架互不重复。第一版还缺页脚。我补上官网同款页脚，再按 1440×900 把三版一起截出来。截图已经出了。我先肉眼过三张首屏，看骨架、品牌件和可读性有没有明显翻车。三张首屏都空了：导航、文案和列表都没渲染出来。我先查脚本加载和报错，再改。根因是共用脚本把 \`t\` 泄漏到全局，和页面里的 \`const { t }\` 撞名，整页 JS 直接停了。我把套件收进闭包，再重截三版。第三版标题把「智能体」拆开了。我按官网的断行方式改一版，再截首屏。三版都按 Sunnyender-org/bflabs-ui 出了：同一套 token、bf-* 组件、BF 标、顶栏/中英切换/轨道线/页脚，和 bflabs.cn 同一套语言。内容一样，骨架不一样。

**团队入口**：顶栏「官网 / 团队」目前都回 \`https://bflabs.cn\`。独立团队站 URL 还没核到，选定方向后再加第二外链。

---

**01 · 轮盘 17 Functional Brutalism / Are.na**
发丝目录 + 右侧检验栏。适合当内部索引，不像商店。

---

**02 · 现实参照 · Raycast Store / Vercel Marketplace**
左侧过滤 + 搜索 + 货架卡片。

---

**03 · 官网续章 · bflabs.cn 同一套巨字**
Skills 当成官网下一章。

选一版深化，或混搭。选定之前我停在这里。`;

describe("splitAssistantAnswer", () => {
  it("folds the first-person diary and keeps 团队入口 in the answer", () => {
    const split = splitAssistantAnswer(FORK_FIXTURE);
    expect(split.cut).toBe("heading");
    expect(split.process).toContain("接下来读规格");
    expect(split.process).toContain("根因是共用脚本");
    expect(split.process).not.toContain("团队入口");
    expect(split.answer.startsWith("**团队入口**")).toBe(true);
    expect(split.answer).toContain("**01 · 轮盘");
    expect(split.answer).toContain("**03 · 官网续章");
  });

  it("cuts at the first standalone hr when there is no earlier heading", () => {
    const text = `${"接下来我会先读仓库，已经对上设计系统。".repeat(6)}

---

这是结论正文，从这里开始给用户看，不再夹带工作日记。`;
    const split = splitAssistantAnswer(text);
    expect(split.cut).toBe("hr");
    expect(split.process).toContain("接下来我会先读仓库");
    expect(split.answer).toBe(
      "这是结论正文，从这里开始给用户看，不再夹带工作日记。",
    );
    expect(split.answer).not.toContain("---");
  });

  it("cuts at **01 · when that is the first deliverable marker", () => {
    const text = `${"Let me read the spec next. I'll then write the three variants and screenshot them. ".repeat(2)}

**01 · List index**
A hairline directory.`;
    const split = splitAssistantAnswer(text);
    expect(split.cut).toBe("numbered");
    expect(split.process).toMatch(/Let me read the spec/i);
    expect(split.answer.startsWith("**01 · List index**")).toBe(true);
  });

  it("folds a process paragraph that ends at the first blank line", () => {
    const decode = `按上次说的做：先把 8 张 hard-set 都 decode 对照手写种子，再拿反推稿出图，跑 decode → render 闭环。8 张类型全对。接着用反推稿出图，文件名加 \`-decode\`，不覆盖旧成品。H1 出图撞上 Cloudflare 524。我给生图加上有限次重试，然后从 H1 接着跑。8 张 decode 稿都出了。

成品文件名带 \`-decode\`，旧的手写成品没动。Finder 已打开。

| 看这张闭环 | 结果 |
|---|---|
| \`H6-type-poster-decode.png\` | **最好**。标题、眼窗、口号都在 |`;
    const split = splitAssistantAnswer(decode);
    expect(split.cut).toBe("break");
    expect(split.process).toContain("先把 8 张");
    expect(split.process).not.toContain("成品文件名");
    expect(split.answer.startsWith("成品文件名带")).toBe(true);
    expect(split.answer).toContain("H6-type-poster-decode.png");
  });

  it("folds 先接手 diary before the factual recap", () => {
    const site = `先接手这个 Claude 会话，核对项目上下文和站点上线状态。接着按 resume 协议读会话交接文档，并拉项目上下文。正在读取该 Claude 会话，并核对仓库与上线相关证据。会话 ID 没直接命中，接着列本地会话并核对站点是否真的上线。

刚接手的是 Grok.app 分叉会话，不是 Claude。

今天刚核过的线上事实：

| 入口 | 现状 |
|---|---|
| \`skills.bflabs.cn\` | 无 DNS，解析失败 |`;
    const split = splitAssistantAnswer(site);
    expect(split.cut).toBe("break");
    expect(split.process).toContain("先接手这个");
    expect(split.process).not.toContain("刚接手的是");
    expect(split.answer).toContain("刚接手的是");
    expect(split.answer).toContain("skills.bflabs.cn");
  });

  it("does not fold a long conclusion that uses process-like verbs then a table", () => {
    const text = `已经按你说的把闭环跑完，8 张类型都对，成品都写在 evals/renders 下面、文件名带 -decode。接下来是结论，也是我核过之后愿意签字的推荐，下面这张表按可读性和品牌件排过序。

| 图 | 结果 |
|---|---|
| a | 过 |`;
    const split = splitAssistantAnswer(text);
    expect(split.cut).toBeNull();
    expect(split.process).toBeNull();
    expect(split.answer).toContain("接下来是结论");
    expect(split.answer).toContain("| a | 过 |");
  });

  it("does not fold a short intro before a heading", () => {
    const split = splitAssistantAnswer(
      "先说结论。\n\n**团队入口**：官网目前回 bflabs.cn。",
    );
    expect(split.cut).toBeNull();
    expect(split.process).toBeNull();
    expect(split.answer).toContain("先说结论");
  });

  it("does not fold when the body already starts with the deliverable", () => {
    const split = splitAssistantAnswer(
      "**01 · 轮盘**\n发丝目录 + 右侧检验栏。",
    );
    expect(split.process).toBeNull();
    expect(split.answer).toContain("**01 · 轮盘**");
  });

  it("ignores table separators and fenced ---", () => {
    const text = `结论用表。

| a | b |
| --- | --- |
| 1 | 2 |

\`\`\`
---
not a cut
\`\`\`

正文继续写，没有工作日记。`;
    const split = splitAssistantAnswer(text);
    expect(split.process).toBeNull();
    expect(split.answer).toContain("| --- | --- |");
    expect(split.answer).toContain("not a cut");
  });

  it("leaves empty / tiny strings alone", () => {
    expect(splitAssistantAnswer("").process).toBeNull();
    expect(splitAssistantAnswer("   \n").process).toBeNull();
    expect(splitAssistantAnswer("短").process).toBeNull();
  });

  it("splits a process diary into paragraphs", () => {
    expect(
      processSpeechParagraphs("先接手这个会话。\n\n正在读取证据。"),
    ).toEqual(["先接手这个会话。", "正在读取证据。"]);
  });

  it("does not cut yaml-like front matter with an empty prefix", () => {
    const text = `---
title: note
---

# Hello

A normal document.`;
    const split = splitAssistantAnswer(text);
    expect(split.process).toBeNull();
  });
});
