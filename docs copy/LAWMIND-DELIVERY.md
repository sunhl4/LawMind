# LawMind 客户交付手册（v1）

本手册用于客户交付阶段，目标是做到：

- 安装后可启动
- 启动后可自检
- 自检后可演示
- 演示后可进入试运行

## 1) 环境要求

- Node.js 22+
- npm
- pnpm
- Git

## 2) 快速上手（开发机/客户机）

在仓库根目录执行：

```bash
npm run lawmind:onboard -- --preset qwen-chatlaw --yes
```

说明：

- 该命令会创建/校验 `workspace/` 关键文件；
- 生成 `.env.lawmind`；
- 执行 `lawmind:env:check --strict`；
- 默认执行 smoke（可加 `--skip-smoke` 跳过）。

## 3) 运维命令（交付必备）

### 状态面板

```bash
npm run lawmind:ops -- status
```

输出：

- matter 数量
- task 数量和状态分布
- draft 数量和审核状态
- session 数量

### 健康检查

```bash
npm run lawmind:ops -- doctor
```

深度检查（包含 smoke）：

```bash
npm run lawmind:ops -- doctor --deep
```

## 4) 全链路验收（交付前必须跑）

```bash
npm run lawmind:acceptance -- --strict-env
```

该命令执行以下 5 步：

1. `vitest` 跑完 `src/lawmind/` 全部测试；
2. `lawmind:env:check`（可选 strict）；
3. `lawmind:smoke --fail-on-empty-claims`；
4. `lawmind:demo`（客户演示脚本）；
5. `lawmind:ops -- status`。

## 5) 客户演示脚本

```bash
npm run lawmind:demo
# 一键生成 PPT：
npm run lawmind:demo -- --ppt
```

演示内容：

- 触发 `execute_workflow` 一键流程；
- 默认：合同审查 + 法律备忘录（`.docx`）；加 `--ppt`：案件进展汇报（`.pptx`）；
- 输出任务状态、步骤、交付路径；
- 形成可演示的“接单 -> 干活 -> 交付”闭环。

## 6) 桌面应用（Electron）

### 6.1 开发机运行

在**已克隆**本仓库且已 `pnpm install` 的机器上：

```bash
pnpm lawmind:desktop
```

说明：

- 详见 [apps/lawmind-desktop/README.md](../apps/lawmind-desktop/README.md)；
- 本地 API 仅监听 `127.0.0.1`；
- 默认写入 `Electron userData` 下的 `LawMind/workspace` 与 `LawMind/.env.lawmind`（与仓库内 `workspace/` 相独立）；
- 开发态仍需要本机 **Node 22+** 与 monorepo 根（`tsx` 启动 `lawmind-local-server.ts`）。

### 6.2 打包与「解压即用」产物

在 **与目标系统一致** 的构建机上执行（每种平台单独打一次包）：

```bash
cd apps/lawmind-desktop && pnpm run dist:electron
```

该流程会依次：**esbuild 打包本地 API**、**下载官方 Node 二进制至 `resources/node-runtime/`（仅当前平台/架构）**、构建前端、`electron-builder` 出产物。

产出（在 `apps/lawmind-desktop/release/`，具体文件名随版本变化）：

- **macOS**：`dmg` 安装包 + **`zip`**（解压后得到 `LawMind.app`，可直接双击；适合绿色分发）；
- **Windows**：`nsis` 安装包 + **`portable`** 绿色版（单文件可执行，或由 builder 配置决定的可搬运形态）。

**最终用户**：安装版或解压版均**不要求**单独安装 Node；应用内已携带与本包架构匹配的 Node，用于启动 `lawmind-local-server.cjs`。高级场景仍可用环境变量 `LAWMIND_NODE_BIN` 指定其他 Node 路径。

### 6.3 macOS 代码签名与公证（对外分发）

当前仓库内 `electron-builder` 的 mac 配置可能为 `identity: null`（未签名）。未签名的 `.app` / `zip` 在客户机上可能被 Gatekeeper 拦截。

若需对公网用户分发：

1. 为 **Electron 应用** 与 **内嵌的 `node` 二进制**（路径：`LawMind.app/Contents/Resources/node-runtime/<platform-arch>/bin/node`）使用同一开发者证书签名（与现有 OpenClaw / LawMind 发布流程对齐）。
2. 对 `.app` 做 **notarytool 公证**（Apple 要求）。
3. 在交付手册中写明：若暂为测试包，用户可在「系统设置 - 隐私与安全性」中允许运行，或使用「右键 - 打开」首次放行。

（内部发布细节以仓库内 `docs/platforms/mac/` 下签名与发布相关文档为准。）

### 6.4 构建注意

若 pnpm 忽略 electron 构建脚本，需执行 `pnpm approve-builds` 并允许 `electron`。

Node 版本可通过环境变量覆盖：`LAWMIND_DESKTOP_NODE_VERSION`（默认与脚本内一致，需与 `esbuild` 的 `target=node22` 大版本协调）。

## 7) 一键安装脚本（Windows/macOS）

当前仓库内置安装脚本：

- macOS/Linux: `scripts/install-lawmind.sh`
- Windows: `scripts/install-lawmind.ps1`

脚本默认仓库：

- `https://github.com/sunhl4/LawMind.git`
- 默认分支：`main`

示例：

```bash
bash scripts/install-lawmind.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-lawmind.ps1
```

可选环境变量：

- `LAWMIND_REPO_URL`：代码仓库地址
- `LAWMIND_REPO_BRANCH`：拉取分支（默认 `main`）
- `LAWMIND_INSTALL_DIR`：安装目录
- `LAWMIND_PRESET`：初始化预设（默认 `qwen-chatlaw`）

### 从 GitHub 远程一键安装（推荐）

安装脚本托管在 openclaw 仓库，执行后会克隆 LawMind 到本地。

macOS/Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/openclaw/openclaw/main/scripts/install-lawmind.sh | bash
```

Windows PowerShell：

```powershell
iwr https://raw.githubusercontent.com/openclaw/openclaw/main/scripts/install-lawmind.ps1 -UseBasicParsing | iex
```

**安装后的日常使用**请参见 [LawMind 使用手册](docs/LAWMIND-USER-MANUAL.md)（配置、Agent、案件、审核、运维命令与常见问题）。

## 8) 交付检查清单

- [ ] `npm run lawmind:acceptance -- --strict-env` 成功
- [ ] `npm run lawmind:ops -- doctor --deep` 成功
- [ ] 客户机器 smoke 成功
- [ ] 客户机器 demo 成功
- [ ] 客户已填写 `.env.lawmind`
- [ ] 客户已知晓审批机制与审计日志位置

## 9) 法务包（商务交付用）

以下文档在仓库内为 **草案（draft）**，对外签署前须由 **客户与供应商双方执业律师** 定稿。

| 文档               | 路径                                                       |
| ------------------ | ---------------------------------------------------------- |
| 服务条款（英）草案 | [docs/legal/terms-of-service.md](legal/terms-of-service)   |
| 隐私政策草案       | [docs/legal/privacy-policy.md](legal/privacy-policy)       |
| DPA 大纲           | [docs/legal/dpa-outline.md](legal/dpa-outline)             |
| 数据处理说明       | [docs/LAWMIND-DATA-PROCESSING.md](LAWMIND-DATA-PROCESSING) |

**签署角色建议**：客户侧由律所管理合伙人或授权法务签署；供应侧由产品主体法定代表人或授权代表签署。电子版或纸质按合同惯例执行。

公开文档入口：

- https://docs.openclaw.ai/legal/terms-of-service
- https://docs.openclaw.ai/legal/privacy-policy
- https://docs.openclaw.ai/LAWMIND-DATA-PROCESSING

## 10) 备份、升级与回滚

### 备份

- 使用仓库内 `scripts/lawmind-backup.sh`，设置环境变量 **`LAWMIND_WORKSPACE_DIR`** 指向客户 **workspace** 目录（详见脚本注释）。默认排除 workspace 根目录下的 `.env` / `.env.lawmind`；若确需打包密钥（不推荐），可设 **`LAWMIND_BACKUP_INCLUDE_ENV=1`**，并务必加密归档、按所内流程轮换密钥。
- 路径说明与目录布局见 [LawMind 私有化部署](/LAWMIND-PRIVATE-DEPLOY)。

### 升级

- **桌面端**：覆盖安装新版本，或替换绿色版目录；除非刻意迁移，**保留** Electron **userData**（含 workspace 与 `.env.lawmind` 等路径）。
- **版本号**：CLI / monorepo 见仓库根 `package.json` 的 `version`；桌面应用见 `apps/lawmind-desktop/package.json` 及各平台打包元数据。

### 回滚

- 用保留的旧版安装包重装；若数据结构有变，从**备份**恢复 workspace。先在 workspace **副本**上验证回滚步骤。

https://docs.openclaw.ai/LAWMIND-DELIVERY  
https://docs.openclaw.ai/LAWMIND-PRIVATE-DEPLOY  
https://docs.openclaw.ai/LAWMIND-SECURITY-CHECKLIST
