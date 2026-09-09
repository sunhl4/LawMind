# LawMind 平台安全网关

本目录集中管理引擎侧的两个统一安全出口：

1. `outbound-proxy.ts` — 统一 HTTP 出口代理。
2. `safe-command.ts` — 统一命令执行网关。

两者均不依赖 Electron，headless / CLI 可直接使用；桌面端通过环境变量注入代理与根证书设置。

## 1. 统一 HTTP 出口代理（outbound-proxy）

所有引擎侧向外 HTTP 请求（MCP HTTP、URL dossier、模型 API、检索 provider）都应经过 `createOutboundProxy()` 返回的 `fetch` 方法。

### 基本用法

```ts
import { createOutboundProxy } from "./outbound-proxy.js";

const proxy = createOutboundProxy({
  allowInsecure: false, // 是否允许非本地 http://（默认 false）
  allowLocalNetwork: true, // 是否允许 localhost / 私网地址（默认 true，桌面版需要）
  auditDir: workspaceAuditDir, // 审计目录；未提供时不写日志
  taskId: "task-123",
  actor: "model",
  requestTag: "web-search",
});

const res = await proxy.fetch("https://api.example.com/v1/endpoint", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ foo: "bar" }),
});
```

### 安全策略

- 默认只允许 `http://localhost:*` / `http://127.0.0.1:*` 和 `https://*`。
- 非本地 `http://` 默认拒绝；可通过 `allowInsecure: true` 显式放行（MCP 的 `allowInsecureHttp` 透传到此）。
- SSRF 黑名单默认拒绝：
  - `169.254.0.0/16`（link-local / 云元数据）
  - `0.0.0.0/8`
  - 常见云元数据主机名（`metadata`、`metadata.google.internal` 等）
- `allowLocalNetwork: false` 时额外拒绝 `127.0.0.0/8`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16` 及对应 IPv6 私网/loopback。
- URL 中嵌入的凭据（`username:password`）会被拒绝。

### 超时与重试

- `timeoutMs` 会在传入的 `signal` 之外叠加一个 AbortController 超时；任一条件触发都会取消请求。
- `maxRetries` 控制代理层额外重试次数，默认 0，避免与上层（如 `runtime-model-call.ts`）的重试策略叠加。

### 代理环境变量

当 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 设置且未提供 `fetchImpl` 时，代理会走 node 原生请求路径，并遵循这些环境变量：

- `HTTP_PROXY` 用于 `http://` 目标。
- `HTTPS_PROXY` 用于 `https://` 目标。
- `NO_PROXY` 支持逗号分隔的精确主机或 `.suffix` 后缀匹配。

### 根证书注入

传入 `rootCerts`（PEM 字符串数组）会让代理走 node 原生 TLS 路径，并将证书追加到 `ca` 选项。未提供 `rootCerts` 且无代理环境变量时，默认使用 global `fetch`。

### 审计

开启 `auditDir` 后，每次请求会写入一条 `outbound_http` 审计事件，包含：

- `method`
- `host`
- `pathname`
- `status`（或 `error`）
- `durationMs`
- `requestTag`（如配置了）

**不包含请求体、响应体或查询参数**，避免敏感数据泄露。

## 2. 统一命令执行网关（safe-command）

所有需要启动外部子进程的地方（MCP stdio、tool sandbox、lawmindd 等）都应通过 `safeCommand()` 或 `runSafeCommand()` 执行。

### 基本用法

```ts
import { safeCommand, runSafeCommand } from "./safe-command.js";

const handle = safeCommand({
  command: "/usr/bin/python3",
  args: ["script.py", "--input", "value"],
  cwd: "/workspace/project",
  allowedRoots: ["/workspace"],
  env: { CUSTOM_VAR: "value" },
  timeoutMs: 30_000,
  auditDir: workspaceAuditDir,
  taskId: "task-123",
});

// 与子进程交互（IPC 或 pipe）。
handle.child.stdin?.write("data\n");

// 等待结果并自动清理。
const result = await handle.finished;
console.log(result.exitCode, result.stdout, result.stderr);
```

或直接使用一次性封装：

```ts
const result = await runSafeCommand({
  command: process.execPath,
  args: ["script.js"],
  timeoutMs: 10_000,
});
```

### 安全策略

1. **命令绝对化**：
   - 若传入相对路径，会基于 `cwd` 解析为绝对路径，并校验文件存在。
   - 若传入纯命令名，会在 `PATH` 中查找并返回绝对路径。
2. **禁止 shell**：
   - `allowShell` 默认 `false`，强制数组传参，拒绝 `bash`、`sh`、`cmd`、`powershell` 等系统 shell，以及 `-c`、`-Command`、`-e` 等代码执行开关。
3. **环境白名单**：
   - `buildMinimalChildEnv()` 只保留最小宿主环境变量（`PATH`、`HOME`、`TMPDIR` 等）。
   - `buildSandboxChildEnv()` 额外允许过滤后的 `LAWMIND_*` 配置项，但拒绝：
     - `LAWMIND_LOCAL_API_TOKEN`、`LAWMIND_SKIP_API_AUTH`、`LAWMIND_DESKTOP_PORT`
     - 模型 / 集成密钥前缀（`OPENAI_*`、`BRAVE_*`、`ANTHROPIC_*` 等）
     - `LAWMIND_*_KEY` / `*_TOKEN` / `*_SECRET` / `*_PASSWORD`
   - 调用方也可传入 `env` 自定义环境变量。
4. **cwd 限制**：
   - 提供 `allowedRoots` 时，`cwd` 必须落在其中一个根目录下；否则抛出 `SafeCommandError`。
5. **超时与资源清理**：
   - `timeoutMs` 到期后自动 `kill` 子进程。
   - 支持 `signal` 外部取消。
   - `detached: true` 时自动 `unref()`，避免阻塞父进程退出。

### 审计

开启 `auditDir` 后，子进程退出会写入一条 `safe_command` 审计事件，包含：

- `command` 摘要（命令名 + 参数，不展开完整路径）
- `cwd`
- `exitCode` / `exitSignal`
- `durationMs`
- `stderr` 前 200 字符

**不包含环境变量、完整命令路径或标准输出**。

## 3. 接入点

当前已通过以下入口接入：

| 能力                   | 入口文件                                                     | 网关                                                       |
| ---------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| MCP stdio              | `src/lawmind/mcp/mcp-jsonrpc-client.ts`                      | `safeCommand` + `buildMinimalChildEnv`                     |
| MCP HTTP               | `src/lawmind/mcp/mcp-jsonrpc-client.ts`                      | `createOutboundProxy`                                      |
| 模型 API               | `src/lawmind/agent/runtime-model-call.ts`                    | `createOutboundProxy`                                      |
| 模型探测               | `src/lawmind/models/probe.ts`                                | `createOutboundProxy`                                      |
| JSON LLM 客户端        | `src/lawmind/llm/openai-json.ts`                             | `createOutboundProxy`                                      |
| OpenAI-compatible 检索 | `src/lawmind/retrieval/openai-compatible.ts`                 | `createOutboundProxy`                                      |
| LexEdge 检索           | `src/lawmind/retrieval/providers.ts`                         | `createOutboundProxy`                                      |
| URL dossier            | `src/lawmind/research/url-dossier.ts`                        | `createOutboundProxy`（底层保留 `authority-pinned-fetch`） |
| open-law 检索          | `src/lawmind/retrieval/providers/open-law/client.ts`         | `createOutboundProxy`                                      |
| 北大法宝检索           | `src/lawmind/retrieval/providers/pkulaw/client.ts`           | `createOutboundProxy`                                      |
| Brave web search       | `src/lawmind/agent/tools/lawmind-web-search.ts`              | `createOutboundProxy`                                      |
| Tool sandbox           | `src/lawmind/runtime/tool-sandbox.ts`                        | `safeCommand` + `buildSandboxChildEnv`                     |
| lawmindd 启动          | `apps/lawmind-desktop/server/lawmind-server-route-daemon.ts` | `safeCommand` + `buildDaemonProcessEnv`                    |

### 已知未接入点

- `apps/lawmind-desktop/electron/local-server.mjs` 仍在 Electron 主进程中直接 `spawn` 本地服务器。Electron 主进程是 `.mjs` 文件，无法直接 import `src/lawmind/platform/safe-command.ts`（TypeScript 源码），且当前未提供 `.mjs` 镜像文件；本次安全收口在 server/引擎侧完成，桌面主进程启动路径仍保持原有行为，后续可通过生成/维护 `safe-command.mjs` 镜像或打包时注入统一网关再收口。

## 4. 扩展指南

- 新增 HTTP 出口：直接 `import { createOutboundProxy } from "../platform/outbound-proxy.js"` 并使用其 `fetch`。
- 新增子进程：直接 `import { safeCommand } from "../platform/safe-command.js"`，按需设置 `ipc`、`allowedRoots`、`auditDir` 等选项。
- 新增审计种类：在 `src/lawmind/types.ts` 的 `AuditEventKind` 中扩展，代理和网关会自动使用 `outbound_http` / `safe_command`。
