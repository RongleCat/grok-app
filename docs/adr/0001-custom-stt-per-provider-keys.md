# ADR 0001 — 自定义听写密钥按提供方独立存储

- 状态：已采纳
- 日期：2026-08-19

## 背景

自定义听写引擎最初只有**一个**密钥槽（`stt_custom_api_key`）。提供方模板
（local / groq / openai / mistral / custom）共享这一个 Key，导致：在 Groq
模板下填了 Key，切到 OpenAI 模板时同一个 Key 仍然显示，用户误以为 Key 会
跟随提供方切换，甚至把 A 提供方的 Key 发到了 B 提供方（产生 401 与误导性
「请重新登录」报错）。

## 决策

每个提供方模板独立保存一个密钥，存于 `SecretsFile::stt_custom_api_keys`
（`HashMap<provider_id, key>`）：

- 模板下拉选中某提供方时，界面只显示该提供方的「已保存/未保存」状态；
- 填写/清空 Key 只作用于当前提供方的槽位；
- 发起转写时，Rust 按 Base URL 推导提供方 id（`stt_provider_for_base_url`
  ，与前端 `sttPresets.ts` 的 `matchSttPreset` 镜像一致——不新增设置字段，
  避免存储的提供方与 URL 漂移），再按该 id 取 Key；无匹配槽位时回退
  `custom` 槽位（旧单槽迁移落点）。

## 权衡

- 备选 A：单 Key 全局共用 —— 结构最简单，但与用户心智模型冲突（模板像
  「账号」，Key 却共用），且跨提供方误发 Key 是真实事故源。
- 备选 B：切换模板时清空 Key 显示 —— 治标不治本，用户每次切换都要重填。
- 选中方案：独立槽位，UI 与存储一致，误发风险归零；代价是密钥槽增多，
  但密钥始终在 Keychain/加密文件中，不增加明文暴露面。

## 影响

- `SecretsFile` 新增 `stt_custom_api_keys`；旧字段保留读取（迁移），保存新
  Key 时清空旧字段。
- `secrets_get_masked` 返回各提供方「是否已保存」布尔表，供占位提示（
  `sttCustomKeys`）。
- 转写路由按 provider id 取 Key，无 Key 时对云端端点会得到 401 → 提示
  「自定义听写 API Key 无效或未填写」，不再误导向「账户登录」。
