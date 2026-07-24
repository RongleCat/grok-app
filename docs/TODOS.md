# Grok App · TODOS

> 来自 `/autoplan` 2026-07-21。P0 矩阵功能面不删；此处为契约/文档/增强项。

## P0 契约（编码阻塞或强相关）

| ID | What | Why | Effort | Priority |
|----|------|-----|--------|----------|
| T01 | CLI 下载信任链（白名单 URL + SHA256 + fail-closed） | 供应链 Critical | M | P0 |
| T02 | ACP 真机 spike 报告（工具/权限/Stop/重附着） | 架构生死线 | M | P0 |
| T03 | Host FSM + 事件契约一页纸 | 防双 SoT | S | P0 |
| T04 | 错误文案 Deck zh/en | 可行动诊断 | S | P0 |
| T05 | Permission scope_key 单测 | 默认安全可证明 | S | P0 |
| T06 | ACP stub CI + golden fixtures | 协议回归 | M | P0 ✅ (`tests/fixtures/acp` + `acp_golden_test`) |
| T07 | redact 单测门禁 | 密钥泄漏 | S | P0 |
| T08 | README 暖路径 + Gatekeeper/SmartScreen | 首跑 | S | P0 |

## P0.5 体验（规格已定案，实现时带上）

| ID | What | Effort | Priority |
|----|------|--------|----------|
| T09 | Setup checklist（跳过 Onboarding 后） | S | P0 |
| T10 | 连接状态 pill + 五类空状态 | S | P0 |
| T11 | 右栏默认折叠 + 项目常驻语境 | S | P0 |
| T12 | Doctor 显示 resolved path + 来源 | S | P0 |
| T13 | 流式 stick-to-bottom 规则 | S | P0 |

## P1 / 延后

| ID | What | Why | Priority |
|----|------|-----|----------|
| T14 | 10–12 屏线框/注释参考图 | 减 UI 即兴 | P1 |
| T15 | aria-live + 键盘图完整 a11y | 无障碍 | P1 |
| T16 | 支持包 zip（脱敏日志+Doctor JSON） | 支持 | P1 |
| T17 | App 自动更新 | L08 | P1 |
| T18 | Reset App data in Doctor | 逃生舱 | P1 |
| T19 | shared 模式并发/损坏混沌测试强化 | 若主打 shared | P1 |
| T20 | 竞争/留存月度回顾 | 战略 | P2 |

## 明确不做（再次确认）

- 内嵌 grok-go 网关 UI  
- agent-connect / IM 桥  
- 默认 YOLO  
- 首发 Linux  
- 砍掉能力矩阵已列 P0 条目（仅允许实现分期与宣称分层）
