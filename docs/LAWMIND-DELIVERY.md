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
```

演示内容：

- 触发 `execute_workflow` 一键流程；
- 输出任务状态、步骤、交付路径；
- 形成可演示的“接单 -> 干活 -> 交付”闭环。

## 6) 一键安装脚本（Windows/macOS）

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

## 7) 交付检查清单

- [ ] `npm run lawmind:acceptance -- --strict-env` 成功
- [ ] `npm run lawmind:ops -- doctor --deep` 成功
- [ ] 客户机器 smoke 成功
- [ ] 客户机器 demo 成功
- [ ] 客户已填写 `.env.lawmind`
- [ ] 客户已知晓审批机制与审计日志位置
