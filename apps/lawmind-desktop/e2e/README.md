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

## 并行会话：同一克隆里同时跑 e2e 会互相杀掉服务器

`e2e/dev-with-mock.sh` 启动前会 **`kill -9` 占用 mock / Vite 端口的进程**（这是为了清掉上轮
残留的僵死服务，本身是对的）。代价是：**两个 Playwright 进程同时在同一个克隆里跑时，
后启动的那个会杀掉先启动的那个的 mock API 与 Vite。**

表现极具误导性 —— 受害方的页面永远加载不出来，`gotoShell()` 卡满 60 秒超时，
于是**整个 spec 文件的每一条用例都以 60 秒失败**（实测：`judgment-escalation.spec.ts`
4 条用例耗时 248 秒 = 4 × 62 秒），看起来像「这条链全断了」，实际只是端口被抢。
而 runner 的退出码可能仍是 0（若命令带 `| tail`），于是它在日志里显示"成功"。

**因此：并行跑 e2e 必须各自换用不同端口。** 端口已经是环境变量可覆盖的：

```bash
# 会话 B（会话 A 用默认端口）
LAWMIND_E2E_MOCK_PORT=49888 LAWMIND_E2E_VITE_PORT=53473 \
  pnpm --filter lawmind-desktop test:e2e
```

判断方法：失败时先看耗时。**每条用例都恰好 60 秒**（`gotoShell` 的超时值）→ 几乎一定是端口被抢，
而不是产品坏了；换成独立端口重跑即可确认。

> 这条不是理论风险：2026-09-22 一次「spec 全红」的排查就停在这里 —— 实际是同一时刻
> 另一个会话在跑同一份套件。真机 Electron 套件（`test:e2e:electron`）不受影响，
> 它不依赖这两个端口。

**同样地，不要一边跑 `pnpm test` 一边跑 e2e。** 全量单测本机会开 8 个 fork，
足以让 Vite 饿死：表现是**页面根本没渲染**（失败快照里只剩一个「跳到主内容」链接）、
`getByTestId`/`getByText` 一律「element(s) not found」——看起来像组件没挂载，实际是机器被打满。
实测同一份套件：与全量单测并发时 1 条失败，机器空闲时 **69 通过 / 0 失败**。

**判定口诀**：*整页空的无障碍树* → 先怀疑「机器被占满 / 端口被抢」，
*只有某个 testid 缺失* → 才去查产品与接线。这两类症状长得很像，代价却差几小时。

## 测试分类

两套配置互斥，清单的唯一真相源是 **`e2e/electron-specs.ts`**
（`playwright.config.ts` 的 `testIgnore` 与 `playwright.electron.config.ts` 的 `testMatch` 共用它，
`electron/e2e-spec-partition.test.ts` 锁住它与磁盘一致）。
**新增真机 spec 时改那一处即可**，不要只改其中一个配置 —— 只改 electron 配置会让
`pnpm lawmind:desktop:e2e`（无参数，CI 的 mock 作业正是这么调的）把它扫进浏览器套件并整体变红。

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `app-driver.spec.ts` | Electron | 验证测试 helper 自身能干净启动/关闭应用 |
| `first-matter-journey.spec.ts` | Electron | 首跑案件全旅程：首跑对话框 → 案件 → 提交交办 → 草稿 → 签批（API） → 导出 DOCX（API） |
| `server-crash-recovery.spec.ts` | Electron | 本地服务崩溃后由监督层自动重启；审计记录；UI 展示 fetch 失败提示 |
| `electron-golden-path.spec.ts` | Electron | 既有 Electron 冒烟测试 |
| `electron-file-deeplink.spec.ts` | Electron | 既有文件深链测试 |
| `judgment-escalation-electron.spec.ts` | Electron | G3 待定夺卡在真机 Electron 下走通「引擎 → 本地路由 → 界面」（非 stub） |
| `_debug-*.spec.ts` | 本地调试 | 永不进 CI / 默认套件 |
| `*.spec.ts`（其余） | Browser + mock API | 基于 `mock-api.mjs` 的 UI 行为测试 |

### 已退役的 spec（不要按旧样式加回来）

`skills-pack.spec.ts` **已删除**，不是丢失：它断言的那个界面（设置 → 技能库）已被**刻意**从侧栏退役
（`lawmind-settings-nav.ts` 的 `SETTINGS_NAV_RETIRED_ITEMS`，理由写在导航项的 description 里：
「开箱技能自动启用，不必在此开关」），且没有任何深链入口 → 该 spec 从写下那天起就不可能通过。
退役本身由 `settings.spec.ts` 的 `lm-settings-nav-skills` 计数断言锁住；技能签名拒载由
`src/lawmind/skills/skill-runtime.test.ts` 覆盖。删掉它是为了**恢复信号**：一条永远红的用例
会盖住同一文件里真正的回归。

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
4. 新建 `*.spec.ts`；真机 spec 要把文件名加进 `e2e/electron-specs.ts`（两套配置共用这一处清单，`electron/e2e-spec-partition.test.ts` 会校验）。
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

### 应用状态隔离：`LAWMIND_USER_DATA_DIR`（必须用）

`launchLawMindElectron()` 会注入 `LAWMIND_USER_DATA_DIR=<临时目录>`，让应用把 userData（配置、`.env.lawmind`、`models.json`、Chromium profile/localStorage）整体落在夹具目录里。

**不要改回 `--user-data-dir`。** 它在这里必须无效，两层原因：

1. Playwright 的 `_electron.launch()` 固定把 `--inspect=0` / `--remote-debugging-port=0` 前置到 `args`，而 Electron 只在 `--user-data-dir` 位于其它开关之前时才认它 → 开关被静默忽略；
2. 即使生效，`pinDevUserData()`（`electron/brand.mjs`）在非打包时还会再 `setPath("userData", appData/Electron)` 覆盖一次。

失效不会报错，只会静默读机器上**真实**的 `desktop-config.json`（陈旧 `workspaceDir`）、真实 localStorage（首跑弹窗早被 dismissed）与真实 `models.json` —— 表现为契约化 E2E 报一个难懂的 `403 checklist_bypass_forbidden`，或首跑对话框不出现。改动这套机制后请以 `e2e/app-driver.spec.ts` 的隔离断言（`lawMindRoot`/`configPath` 必须落在临时目录内）为准。

夹具的 `models.json` 需要同时验证 `env:current` 与 `builtin:qwen-plus`：`.env.lawmind` 里配置了模型时，应用把**当前**模型解析为 `env:current`（见 `/api/models` 的 `defaultModelId`），只写 builtin 形式会让「模型未验证」守卫拦下发送（对话区保持空态）。

生产打包版本会忽略 `LAWMIND_ENABLE_E2E_TEST_ROUTES`、`LAWMIND_SKIP_API_AUTH` 与 `LAWMIND_USER_DATA_DIR`。
