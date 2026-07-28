# 设计文档：会话内「消息节点」定位

> **状态**：设计 only（不改代码）  
> **日期**：2026-07-28（粒度决策：逐条消息）  
> **澄清**：此处「会话节点」**不是**多分支 / Fork 树，而是 **同一个 session 里，用户消息与 Grok 回复作为消息节点的定位与导航**。  
> **粒度（已拍板）**：**逐条消息（per-message）** — 每条合格的 user / assistant 气泡各为一个节点；**不是**「一问一答」合并成一个回合节点。  
> **约束**：尽量对当前代码改动小。  
> **误读归档**：此前「分支快照 / branches.json」方案见同目录 `2026-07-28-session-nodes-design.md`，**不作为本需求方案**。

---

## 1. 需求定义（校正后）

### 1.1 一句话

在**一条会话（session）**的对话流中，把**每一条**用户消息和**每一条** Grok 回复视为可独立定位的 **消息节点（message node）**，支持：

- 知道「当前在哪一条消息节点」；
- 快速跳到某一条消息节点；
- 长对话中不迷路。

### 1.2 不是什么

| 易混淆概念 | 本需求是否包含 |
|------------|----------------|
| 同问多答、◀▶ 兄弟分支 | **否** |
| 侧栏多 session 血缘树 | **否** |
| 以「回合」合并 user+assistant 为单节点 | **否**（已否决；见 §3.1） |
| `session_fork` / rewind 产品改造 | **否**（可作跳转后的附属操作，非本设计核心） |
| 全文搜索 Cmd/Ctrl+F | **相关但更窄**；搜索是「按关键字命中」，节点定位是「按消息结构定位」 |

### 1.3 对标直觉（网页端常见形态）

用户感知通常是其中一种或组合：

1. **消息节点轨**：侧边或边缘一列圆点 / 短条，**每条 user、每条 assistant 各一格**（可用形状或颜色区分角色），点击滚到对应气泡。  
2. **当前位置同步**：滚动 transcript 时，高亮「当前视口内」的那条消息节点。  
3. **上一条 / 下一条消息**：快捷键或按钮按 **节点列表顺序**（逐条 message）步进，而不是按「上一问 / 下一问」跳过 assistant。  
4. **稳定锚点**：URL / 深链 / 从搜索、引用、Changes 跳回时，精确滚到某条 `messageId`。

本设计以 **1 + 2 + 稳定锚点** 为主；**3** 为低成本增强。

---

## 2. 现状（可复用，少造轮子）

| 已有能力 | 位置 | 与「节点定位」关系 |
|----------|------|---------------------|
| 每条消息稳定 `id` | `ChatMessage.id` / journal | **节点主键（1:1）** |
| DOM 锚点 `data-message-id` | `ChatItem` / `ConversationThread` | **已具备 scroll 目标** |
| Find 命中后 `scrollIntoView` | `ConversationThread` | **已有「滚到某 messageId」路径** |
| 会话内查找 | `chatFind.ts` + UI | 按文本；节点定位按结构，可共享滚动 |
| 虚拟列表（≥36 条） | `chatVirtualList` / `useChatMessageVirtualizer` | 定位时必须先保证目标行 **mounted** 或虚拟滚动定位 |
| `role` / `marker` | `ChatMessage` | 过滤哪些行算节点（见 §5.4） |
| User turn 判定 | `isTurnPromptMessage` | **不**用于合并节点；仅可选地给 user 节点标注 `promptIndex` 元数据 |

**结论**：数据与滚动手感的骨架已在；缺的是 **「逐条消息节点」产品层**（节点列表、当前节点、导航 UI），不是新的消息存储模型。节点与 journal 行在合格集合上 **一一对应**。

---

## 3. 概念模型

### 3.1 消息节点（Message Node）— 粒度已定

| 粒度 | 定义 | 本需求 |
|------|------|--------|
| **A. 逐条消息** | 每个合格的 `user` / `assistant` 气泡 = **独立一节点** | **采用（唯一默认）** |
| B. 回合节点 | 一次 user prompt + 其后回复合并为一节点 | **不采用** |

规则：

- **一条 user 消息 → 一个节点**  
- **一条 assistant 消息 → 一个节点**（同一回合若有多条 assistant 气泡，则多个节点）  
- 节点 id **等于** `message.id`（不再发明 `turn-${n}` 作为主键）  
- 定位目标 **永远是该条消息的气泡**，不是「回合头」代理锚点  

View-model（纯前端派生，**不必改 journal schema**）：

```ts
type SessionMessageNode = {
  /** 与 ChatMessage.id 相同 */
  id: string;
  /** 在 messages[] 中的下标（便于虚拟列表 scrollToIndex） */
  messageIndex: number;
  /** 在「节点列表」中的 0-based 序号（仅计合格节点） */
  nodeIndex: number;
  role: "user" | "assistant";
  preview: string;           // 该条 content 截断
  /** 流式 / 错误等，用于轨上样式 */
  status?: "pending" | "done" | "error";
  /**
   * 可选元数据：若该条是真 user prompt，带上 0-based promptIndex，
   * 便于 UI 展示「第 n 问」标签；assistant 可为 null。
   * 不改变「一消息一节点」的主键与步进语义。
   */
  promptIndex?: number | null;
};
```

由现有 `messages[]` **派生**，不落盘第二套图。

```ts
// 伪代码
function buildSessionMessageNodes(messages: ChatMessage[]): SessionMessageNode[] {
  const out: SessionMessageNode[] = [];
  let nodeIndex = 0;
  let promptIndex = 0;
  messages.forEach((m, messageIndex) => {
    if (!isMessageNodeCandidate(m)) return;
    const node: SessionMessageNode = {
      id: m.id,
      messageIndex,
      nodeIndex: nodeIndex++,
      role: m.role === "user" ? "user" : "assistant",
      preview: truncatePreview(m.content),
      status: nodeStatus(m),
      promptIndex:
        m.role === "user" && isTurnPromptMessage(m) ? promptIndex++ : null,
    };
    out.push(node);
  });
  return out;
}
```

### 3.2 当前节点（Active / Focused Node）

定义（实现简单、可测）：

- 视口中线（或上 1/3）附近，**最靠近中心的那条已挂载消息节点**；或  
- 虚拟列表：`range` 内最靠近视口中心的 **合格 message 行**（按 `messageIndex`）。

用于：节点轨高亮、顶栏「第 k / M 条消息节点」（M = 节点总数，不是「总问数」）。

若产品文案需要同时显示「第 n 问」，可从当前节点的 `promptIndex` 或向上找最近的 user 节点推导——**展示层**问题，不改节点粒度。

### 3.3 定位（Locate）动作

```
locate(messageId)   // nodeId === messageId
  → 若虚拟列表：scrollToIndex(messageIndex) 并等待行挂载
  → query [data-message-id="…"]
  → scrollIntoView({ block: "center" })  // 与 chatFind 同策略
  → 短暂高亮（CSS class，1.5s）
```

**尽量复用** Find 的 scroll 逻辑，抽成 `scrollToMessageId(id)` 共用。  
因粒度是逐条消息，Locate 与 Find 的目标粒度一致（都是单条 `messageId`）。

---

## 4. UX 方案（由简到繁）

### 4.1 P0 — 最小可用（改动最小，推荐先做）

**不新增侧栏大面板**，只做：

1. **派生节点列表**（纯函数 `buildSessionMessageNodes(messages)`，**逐条**）。  
2. **快捷导航**：  
   - 按钮或快捷键：**「上一条消息 / 下一条消息」**（按 `nodeIndex` ±1，`locate(node.id)`）。  
   - 可选：顶条显示 `k / M`（当前节点序 / 节点总数）。  
   - 可选增强（非默认步进）：「上一问 / 下一问」仅在 **user 节点** 间跳——作为过滤器，**不**把 assistant 从节点列表里删掉。  
3. **统一 `scrollToMessageId`**：Find、节点跳转、外部深链共用。

触及面：

- 新建小 lib + 单测；  
- `ConversationThread` 或 composer 附近 1～2 个控件；  
- 虚拟列表补 `scrollToIndex` 若尚未暴露。

**不改** Rust store、不改 journal、不动 fork/rewind。

### 4.2 P1 — 节点轨（更接近「网页端会话节点」视觉）

在主对话区 **右侧边缘**（或滚动条内侧）一条细轨：

- **每条消息节点**一个小点（user / assistant **异形或异色**，避免连成「一问一答一格」的误解）；  
- 当前节点加粗 / 主题色；  
- hover 显示 `role` + `preview`；  
- click → `locate(messageId)`。

注意：

- 长会话节点数 ≈ 合格气泡数，可能明显多于「问数」：轨需 **可滚动** 或密度自适应（最小间距、可压缩），避免上百点挤爆；  
- 与现有右侧 **Files pane** 不抢空间：轨贴在 chat 列内缘，宽度 ~8–12px。  

### 4.3 P2 — 消息大纲抽屉（可选）

轻量列表：按节点顺序列出，例如：

- `用户 · preview…`  
- `Grok · preview…`  

点击跳到**该条**。可从顶栏打开，**不要**默认占侧栏 session 树。  
若列表过长，可虚拟滚动大纲本身。

### 4.4 与 Chat Find 的分工

| | 消息节点定位 | Chat Find |
|--|--------------|-----------|
| 索引键 | **逐条** `messageId` 结构序 | 关键字 |
| UI | 轨 / 上一条下一条 / 大纲 | 搜索框 prev/next |
| 高亮 | 整气泡短暂强调 | 文本 mark |
| 步进 | 所有合格消息节点 | 仅含匹配文本的命中 |

两者共享 `scrollToMessageId`，数据源都是当前 session 的 `messages`。

---

## 5. 技术设计（贴合现架构）

### 5.1 数据流

```
messages[] (App state / journal)
        │
        ▼
buildSessionMessageNodes()     // 逐条；src/lib/sessionMessageNodes.ts（建议新建）
        │
        ├── NodeRail / MessageNav UI
        ├── activeNodeId ← IntersectionObserver 或 virtual range（message 级）
        └── locate(messageId) → scrollToMessageId → data-message-id
```

### 5.2 虚拟列表（关键正确性）

当 `messages.length >= 36` 走虚拟窗口时：

1. `locate` 不能只靠 `querySelector`（目标可能未挂载）。  
2. 用节点上的 **`messageIndex`**（原数组下标）调用 `virtualizer.scrollToIndex`，再 rAF 后 `scrollIntoView` 微调。  
3. 单测或手工验收：第一条 user、第一条 assistant、中间任意条、最后一条、流式中的 pending assistant。

### 5.3 流式中的节点

- 正在生成的 assistant：只要已有 `id` 并进入 `messages[]`，即占一个节点，`status: pending`。  
- 自动跟随底部时，**active 自然为最后一条消息节点**；用户上翻后 active 随视口变，不要强行抢滚动。

### 5.4 哪些行不算节点

**排除**（不进入节点列表，也无轨点）：

- `role === "tool"` 以及 `marker === "tool_step"` 等工具行（首版不要「工具节点」）  
- 纯系统 marker（如 `context_compact`、`turn_cancelled` 等，按现网 marker 枚举过滤）  
- `marker === "interjection"`：若产品视其为独立 user 气泡，**可计入** user 节点；若视为中途插话噪音，可排除——**默认：排除 interjection**，与「主对话节点」更干净；实现前若要计入，只改 `isMessageNodeCandidate`  
- 非 user/assistant 的其它 role  

**计入**：

- 普通 `user` 气泡  
- 普通 `assistant` 气泡（含 `isError` 的失败回复 — 仍占一节点，`status: "error"`）  
- 流式中、内容仍空的 assistant 占位（可选计入，便于跳到「正在生成」；默认 **计入**）

**不做**：把多条 assistant 合并成一个节点，或把 user+assistant 绑成一对再定位。

### 5.5 要不要改 Host / 磁盘？

**首版：不需要。**

节点 = 内存派生。深链直接：

- `?message=<messageId>`  

与逐条粒度一致；**不必** `?turn=3` 作为主键（turn 仅可作可选 UX 文案）。

---

## 6. 「尽量少改代码」的落点

| 做法 | 说明 |
|------|------|
| 纯函数按条派生节点 | 不改 `SessionMeta` / journal；id = message.id |
| 复用 `data-message-id` + Find 滚动 | 不新造锚点体系 |
| `promptIndex` 仅作可选标签 | 不依赖 turn 合并 |
| UI 增量组件 | `SessionNodeRail` / `MessageNavigator`，少塞 `App.tsx` |
| 不碰 ACP / fork / agent pool | 与 agent 连续性无关 |

预计主 diff 热点：

- `src/lib/sessionMessageNodes.ts` + test  
- `ConversationThread` 或 chat 壳上挂轨 / 导航  
- 虚拟列表 scrollTo API 补强（若缺）  
- 少量 i18n（`session.nodes.*` / `chat.messageNav.*`）

---

## 7. 交互与无障碍

- 节点轨：`aria-label` 区分角色，例如「用户消息：{preview}」「助手消息：{preview}」；当前节点 `aria-current`。  
- 快捷键建议（可配置，避免与 Find 冲突）：  
  - **上一条 / 下一条消息节点**（例如 `Alt+↑` / `Alt+↓`，具体键位实现时再定并写进快捷键表）。  
  - 若另提供「上一问 / 下一问」，须在文案与快捷键上与「上一条消息」区分，避免用户以为节点是按回合合并的。  
- 高对比主题下 user/assistant 轨点仍可分辨（token 色 + 形状，不唯独靠色盲不友好的单色差）。  
- 不引入 `window.prompt`；无阻塞 dialog 需求。

---

## 8. 成功标准

1. 长会话中可通过「上一条 / 下一条」或节点轨，**稳定滚到对应那一条** user 或 assistant 气泡中心附近。  
2. 同一回合内的 user 与 assistant **可分别**作为当前节点被高亮与选中。  
3. 虚拟列表开关两种模式下定位都正确。  
4. 滚动时当前节点高亮与视口大致一致（允许一层滞后，不抖动狂跳）。  
5. 无节点 UI 时（未做 P1）也不破坏现有 Find / 气泡操作。  
6. **零** journal / session 索引格式变更。  
7. 与「多分支会话树」无关，不引入 `branches.json`。  
8. 节点列表长度在过滤后等于合格 user+assistant 条数（一消息一节点可测）。

---

## 9. 分阶段

| 阶段 | 内容 | 改动量 |
|------|------|--------|
| **P0** | `buildSessionMessageNodes`（逐条）+ `scrollToMessageId` + 上一条/下一条 + 可选 `k/M` | 小 |
| **P1** | 对话区边缘节点轨（user/assistant 可区分）+ hover preview + 当前高亮 | 小–中（纯 UI） |
| **P2** | 逐条消息大纲列表、深链 `messageId`、快捷键正式化；可选「仅 user 间跳转」过滤器 | 小 |
| **非目标** | 回合合并节点、分支兄弟、侧栏 session 树、每节点独立 agent | — |

---

## 10. 决策记录 / 开放问题

### 已决策

| 项 | 决策 |
|----|------|
| 节点粒度 | **逐条消息**（user / assistant 各算一节点） |
| 节点主键 | `message.id` |
| 回合合并 | **不做** |
| 分支树 | **不做**（本需求） |

### 仍可实现时微调

1. **导航入口**：仅快捷键 + 顶条，还是必须上节点轨？ → 建议 **P0 无轨也能用，P1 再上轨**。  
2. **interjection 是否计入节点**：默认排除；若要计入只改 candidate 谓词。  
3. **空占位 assistant**：默认计入（pending）。  

---

## 11. 一句话总结

> **会话节点 = 单 session 里每一条用户消息、每一条 Grok 回复的可定位点（一消息一节点）**；用现有 `message.id` + `data-message-id` 派生与跳转即可，**不必**按回合合并，也**不必**引入分支图或改 journal。

---

## 参考代码锚点

- 消息类型：`src/lib/session.ts`（`ChatMessage`；`isTurnPromptMessage` 仅作 user 节点可选 `promptIndex`）  
- 查找与命中：`src/lib/chatFind.ts`  
- 滚动与锚点：`src/components/lobe-chat/ConversationThread.tsx`（`data-message-id`、`scrollIntoView`）  
- 气泡锚点：`src/components/lobe-chat/ChatItem.tsx`  
