# Contributing to Grok App

感谢关注 **Grok App**！欢迎 Issue、PR 与使用反馈。

Thanks for your interest in contributing.

## 开发环境 / Development

**Package manager:** root app is **pnpm only** (`pnpm-lock.yaml`). Do **not** run `npm install` / `yarn` at the repo root — that regenerates a stale `package-lock.json` and can reintroduce old CVEs (e.g. xlsx). `remote-bridge/` may use npm on its own.

```bash
pnpm install
pnpm dev          # Tauri + Vite
```

Windows: to run already-merged `origin/main` beside the official **Grok** install, double-click [`install-latest.cmd`](./install-latest.cmd) (see [docs/BUILD.md](./docs/BUILD.md)).

Frontend only:

```bash
pnpm dev:ui
```

Checks:

```bash
pnpm deps:check   # root lockfile hygiene (no package-lock.json)
pnpm audit:prod   # production CVEs (moderate+)
pnpm typecheck
pnpm test
pnpm build:ui
cd src-tauri && cargo test
```

Optional mock agent (no real CLI):

```bash
GROK_APP_ACP=mock pnpm dev
```

Default is the real **Grok Build** CLI (`grok agent stdio`).

## 贡献流程 / Workflow

1. Fork 本仓库并创建分支
2. 做尽量小而清晰的改动
3. 本地通过 `pnpm typecheck`、`pnpm test` 与 `cargo test`（`src-tauri`）
4. 用户可见文案走 `src/i18n/messages.ts`（`en` / `zh` 同键）
5. 禁止在 UI 使用 `window.confirm` / `prompt` / `alert`（见 `docs/llm-wiki/dialogs.md`）
6. 提交 PR，说明动机、改动与验证方式

**维护者 / AI 协作者**：Issue 分拣、PR 采纳标准、社区反馈入库与发版闭环见 **[docs/llm-wiki/maintain.md](./docs/llm-wiki/maintain.md)**。  
发版时贡献者圆形头像画廊由 `scripts/update-contributors.py` 写入 README（规则见 **[docs/llm-wiki/release.md](./docs/llm-wiki/release.md)**），请勿手写第二套表格。

## 约定 / Guidelines

- 产品名：**Grok App**（窗口 / 安装包名多为 **Grok**）
- 会话与设置数据在 App data root（可用 `GROK_APP_HOME` 覆盖）
- Agent 产品规则以 [`docs/llm-wiki/`](./docs/llm-wiki/) 为准
- 不要提交 `node_modules`、`target`、`dist`、本地 token / `secrets.json` / `auth.json`
- 安全相关问题请走 [SECURITY.md](./SECURITY.md)

## 交流 / Contact

- X: [@cgnot996](https://x.com/cgnot996)
- GitHub Issues: https://github.com/RongleCat/grok-app/issues

## Releases

Full process for humans and AI maintainers: **[docs/llm-wiki/release.md](./docs/llm-wiki/release.md)**.

1. Write bilingual notes under `## [X.Y.Z] - YYYY-MM-DD` in `CHANGELOG.md` (what changed — list form).
2. Commit on a clean `main`.
3. Run `./scripts/release-tag.sh X.Y.Z` (optionally `--push`).
4. CI builds **macOS ARM + Intel + Windows + Linux** and sets the **GitHub Release body** from that CHANGELOG section via `scripts/changelog-for-release.py` (changes only; install notes stay in README).

Do not tag without a matching CHANGELOG section — the release job will fail.
