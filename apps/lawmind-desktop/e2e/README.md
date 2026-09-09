# LawMind Desktop E2E 契约化测试

本目录包含 LawMind 桌面端（Electron）的端到端契约化测试。测试目标不是覆盖所有 UI 路径，而是验证核心用户旅程在**真实本地服务 + 真实 Electron 壳**环境下的端到端行为：文件落盘、API 状态、UI 状态一致。

## 运行方式

### 1. 安装依赖

```bash
pnpm install
```

### 2. 构建渲染产物（Electron 测试会加载 `dist/index.html`）

```bash
pnpm --filter lawmind-desktop build:renderer
```

### 3. 运行 Electron 契约化测试

```bash
pnpm --filter lawmind-desktop test:e2e:electron
```

浏览器端的 mock-API 测试仍使用：

```bash
pnpm --filter lawmind-desktop test:e2e
```

## 测试分类

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `app-driver.spec.ts` | Electron | 验证测试 helper 自身能干净启动/关闭应用 |
| `first-matter-journey.spec.ts` | Electron | 首跑案件全旅程：首跑对话框 → 案件 → 提交交办 → 草稿 → 签批（API） → 导出 DOCX（API） |
| `server-crash-recovery.spec.ts` | Electron | 本地服务崩溃后由监督层自动重启；审计记录；UI 展示 fetch 失败提示 |
| `electron-golden-path.spec.ts` | Electron | 既有 Electron 冒烟测试 |
| `electron-file-deeplink.spec.ts` | Electron | 既有文件深链测试 |
| `*.spec.ts`（其余） | Browser + mock API | 基于 `mock-api.mjs` 的 UI 行为测试 |

## 哪些是真模型，哪些是 mock？

- **所有 Electron 契约化测试均不调用真模型**。测试 harness 会写入假模型 key（`LAWMIND_AGENT_API_KEY=e2e-fake-key`）和不可达 endpoint（`127.0.0.1:1`），使本地服务认为模型已配置，但任何真实推理请求都会快速失败。
- **草稿生成使用 mock 加速**：`first-matter-journey.spec.ts` 在 UI 提交交办后，通过测试专用路由 `POST /api/e2e/create-draft` 直接落盘草稿，避免等待模型响应。这是契约测试允许的「mock 加速」：断言仍然是端到端的（文件、API、UI 状态）。
- **签批/导出通过 API 完成**：由于 `contract.review` 需要 reasoning graph 且 UI 必核清单会禁用签批按钮，旅程在 UI 查看草稿后，通过 `POST /api/drafts/:id/review` 签批，并通过 `POST /api/drafts/:id/render?strict=false` 导出 DOCX，导出结果仍是端到端文件断言。
- **崩溃测试使用测试路由**：`POST /api/e2e/crash` 会干净退出本地服务子进程，由 `server-supervision.mjs` 触发指数退避重启。该路由仅在 `LAWMIND_ENABLE_E2E_TEST_ROUTES=1` 时启用。崩溃期间 UI 会显示 fetch 失败提示，证明用户感知到服务断连。
- **浏览器 mock-API 测试**使用 `mock-api.mjs` 提供固定响应，不涉及任何模型调用。

## 如何新增旅程

1. 在 `helpers/app-driver.ts` 复用或扩展 Electron 操作封装（启动、首跑、导航、签批、导出）。
2. 在 `helpers/contract-api.ts` 复用本地 API 编排（创建案件、草稿、签批、渲染、崩溃）。
3. 在 `fixtures/` 放置可复用的测试数据（案件、草稿 section、预期文案）。
4. 新建 `*.spec.ts`，并在 `playwright.electron.config.ts` 的 `testMatch` 中加入该文件。
5. 运行 `pnpm --filter lawmind-desktop test:e2e:electron` 验证。

## 关键环境变量

测试 harness 通过 `prepareElectronE2EUserDataWithEnv()` 写入临时 `.env.lawmind`：

- `LAWMIND_AGENT_API_KEY=e2e-fake-key`：让本地服务认为模型已配置，但不发起真实请求。
- `LAWMIND_ALLOW_CHECKLIST_BYPASS=1`：签批与导出时允许绕过律师必核清单（E2E 不测试清单 UI）。
- `LAWMIND_ALLOW_RENDER_GATE_BYPASS=1`：导出时允许绕过验收门禁。
- `LAWMIND_ENABLE_E2E_TEST_ROUTES=1`：启用 `/api/e2e/create-draft` 和 `/api/e2e/crash`。
- `LAWMIND_SKIP_API_AUTH=1`：开发模式跳过本地 API 鉴权（简化 helper 调用）。
- `LAWMIND_AGENT_BASE_URL=http://127.0.0.1:1`：万一真发生模型调用也会立即失败。

崩溃测试还会设置 `LAWMIND_E2E_SUPERVISION_BASE_DELAY_MS=5000` 拉长首次监督重启间隔，确保 UI 有足够时间捕获到服务断连提示；默认行为仍由 `server-supervision.mjs` 决定。

生产打包版本会忽略 `LAWMIND_ENABLE_E2E_TEST_ROUTES` 与 `LAWMIND_SKIP_API_AUTH`。
