# LawMind Developer Workflow

本文档对照 **本地脚本**、**CI 工作流** 与 **发布门禁**，便于 PR 前自检。

## 日常开发

```bash
pnpm install
pnpm lawmind:desktop          # Electron + 本地 API
pnpm test                     # Vitest（引擎 + desktop server/renderer）
pnpm typecheck                # 引擎 + scripts
pnpm --filter lawmind-desktop typecheck   # 只覆盖渲染进程
pnpm typecheck:desktop-node               # server/ 与 electron/*.ts。漏跑这条，server 里的类型错误不会红
```

迁移或跨模块改动收口前跑完整 `pnpm lawmind:verify`，不要只跑 `pnpm test`。

## PR 前验证（推荐）

```bash
pnpm lawmind:verify
pnpm lawmind:desktop:e2e:pr
```

`lawmind:verify` 等价于 CI `verify` job（测试只跑一遍，带覆盖率）：

1. `pnpm test:coverage` 然后 `pnpm test:coverage:ratchet`
2. `pnpm lawmind:skills:golden -- --compare`
3. `pnpm typecheck`、`pnpm lawmind:bundle:desktop-server`、桌面 typecheck、`pnpm typecheck:desktop-node`
4. 渲染层 CSS、Node 导入、UI 文案 lint、`pnpm lawmind:check:platform-contracts`
5. `pnpm lawmind:desktop:http-smoke`
6. `pnpm lawmind:release-readiness`（没有 benchmark 文件时记「未提供」，退出 0；文件在但不是 scripted/real，或 JSON 坏了，退出 1）

质量证据是 `pnpm lawmind:verify:release`（scripted，`--strict`），不在 PR 的 `verify` 作业里。文件大小棘轮是旁边的 `file-size-check` 作业（`pnpm lawmind:check:file-size`）。

`lawmind:desktop:e2e:pr` 等价于 CI `desktop-e2e-mock` job（mock API + Vite，smoke / golden-path / matter-cockpit）。本地需 `apps/lawmind-desktop/.env.e2e`（可从 `.env.example` 复制）。

## 发布 / 大改门禁

```bash
pnpm lawmind:multitask:validate          # 本地；当前 CI workflow 不跑这一步
pnpm lawmind:multitask:validate:strict   # 含 Playwright，发布前在本地跑
pnpm lawmind:acceptance                  # 季末验收链路
```

## Ops 辅助

```bash
pnpm lawmind:ops status
pnpm lawmind:ops doctor --deep
pnpm lawmind:ops matter-consistency --workspace workspace
```

## CI 映射

| 本地命令                          | GitHub Workflow                                                  |
| --------------------------------- | ---------------------------------------------------------------- |
| `pnpm lawmind:verify`             | `.github/workflows/lawmind-ci.yml` → `verify`                    |
| `pnpm lawmind:desktop:e2e:pr`     | `.github/workflows/lawmind-ci.yml` → `desktop-e2e-mock`          |
| `pnpm lawmind:desktop:e2e`        | `.github/workflows/lawmind-desktop-e2e.yml`（周调度 + dispatch） |
| `pnpm lawmind:multitask:validate` | 本地命令；当前 workflow 里没有同名 job                           |
| `pnpm lawmind:gate --specs`       | `.github/workflows/lawmind-deliverable-gate.yml`                 |
| `pnpm lawmind:docs:build`         | `.github/workflows/lawmind-docs.yml`                             |

## Platform Contracts 回退

- 环境变量 `LAWMIND_PLATFORM_CONTRACTS_V1=0` 回退 chat 旧响应字段
- 详见 [LAWMIND-BIGBANG-CUTOVER-ROLLBACK.md](./LAWMIND-BIGBANG-CUTOVER-ROLLBACK.md)
