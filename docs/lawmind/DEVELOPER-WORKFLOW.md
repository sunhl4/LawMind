# LawMind Developer Workflow

本文档对照 **本地脚本**、**CI 工作流** 与 **发布门禁**，便于 PR 前自检。

## 日常开发

```bash
pnpm install
pnpm lawmind:desktop          # Electron + 本地 API
pnpm test                     # Vitest（引擎 + desktop server/renderer）
pnpm typecheck                # 引擎 + scripts
pnpm --filter lawmind-desktop typecheck
```

## PR 前验证（推荐）

```bash
pnpm lawmind:verify
pnpm lawmind:desktop:e2e:pr
```

`lawmind:verify` 等价于 CI `verify` job：

1. `pnpm test`
2. `pnpm typecheck`
3. `pnpm lawmind:bundle:desktop-server`
4. `pnpm --filter lawmind-desktop typecheck`
5. `pnpm lawmind:desktop:http-smoke`

`lawmind:desktop:e2e:pr` 等价于 CI `desktop-e2e-mock` job（mock API + Vite，smoke / golden-path / matter-cockpit）。本地需 `apps/lawmind-desktop/.env.e2e`（可从 `.env.example` 复制）。

## 发布 / 大改门禁

```bash
pnpm lawmind:multitask:validate          # 非 strict，PR CI 默认
pnpm lawmind:multitask:validate:strict   # 含 Playwright，发布前
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
| `pnpm lawmind:multitask:validate` | `.github/workflows/lawmind-ci.yml` → `multitask-validate`        |
| `pnpm lawmind:gate --specs`       | `.github/workflows/lawmind-deliverable-gate.yml`                 |
| `pnpm lawmind:docs:build`         | `.github/workflows/lawmind-docs.yml`                             |

## Platform Contracts 回退

- 环境变量 `LAWMIND_PLATFORM_CONTRACTS_V1=0` 回退 chat 旧响应字段
- 详见 [LAWMIND-BIGBANG-CUTOVER-ROLLBACK.md](./LAWMIND-BIGBANG-CUTOVER-ROLLBACK.md)
