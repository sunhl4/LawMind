# 第 13 章 桌面壳

这一章讲 Electron 那一层：窗口怎么开、渲染进程能碰到什么、密钥放哪、端口为什么会漂。

> 这一章是**从架构看**。逐文件的实现精读在第 66–67 章：第 66 章讲进程与桥面（启动十二步、导航护栏、CSP、36 个 IPC 通道、文件桥九步围栏、拖放导入、安全命令网关、密钥保管），第 67 章讲端口契约、凭据派生与 macOS 签名公证（含 2026-09-21 那次故障的完整因果链）。

## 13.1 定位：这一层管什么

桌面壳（`apps/lawmind-desktop/electron/`）只做四件事：

1. **开窗口**，把渲染进程装进去。
2. **当桥**：渲染进程需要碰文件系统、要用原生对话框、要调 shell，都通过 IPC 让主进程去做。
3. **管子进程**：本地 HTTP 服务、officecli、后台守护，都由主进程拉起来和监督。
4. **守住边界**：CSP、导航白名单、可写根白名单、治理路径保护，都在这一层。

有一条贯穿全层的前提：**渲染进程不直接碰文件系统、不直接联网**。所有敏感动作要么走本地 API，要么走 IPC，由主进程校验后再执行。

## 13.2 启动顺序

主进程入口是 `apps/lawmind-desktop/electron/main.mjs`。模块加载阶段到窗口出现，顺序是这样的：

1. 解析运行时图标路径。
2. `applyProductName(app)` 设应用名（从 `branding/manifest.json` 读，不是硬编码）。
3. `pinDevUserData(app)` 钉住开发态的用户数据目录（见 13.8）。
4. 建文件桥 `createFsBridge(getAllowedRoots)`。
5. **单实例锁**：`app.requestSingleInstanceLock()`。开发态可以用 `LAWMIND_ALLOW_MULTI_INSTANCE=1` 关掉（有警告）。
6. `app.whenReady()` 之后：
   - macOS 设置 Dock 图标。
   - `installIpcHandlers()` 注册所有 IPC。
   - `setupApplicationMenu()` 装菜单。
   - 装渲染进程崩溃恢复（崩了就重建窗口）。
   - `await createWindow()` 开主窗口。
   - 12 秒后跑一次自动更新检查（`LAWMIND_E2E=1` 或 `LAWMIND_SKIP_AUTO_UPDATE=1` 时跳过）。
   - 启动失败会打日志并**重试一次**；第二次失败才 `app.quit()`。

### 窗口参数

```js
new BrowserWindow({
  width: 1280, height: 840,
  minWidth: 1024, minHeight: 720,
  webPreferences: {
    preload: <dir>/preload.cjs,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: app.isPackaged,
  },
})
```

三个决定值得解释：

- `contextIsolation: true` + `nodeIntegration: false`：渲染进程拿不到 Node API，只能用 preload 暴露的那套。
- `sandbox: app.isPackaged`：**开发态关、打包态开**。注释解释了原因：开发态是 `http://127.0.0.1:5174`，某些 Electron + Vite 组合下开 sandbox 会让 preload/contextBridge 出问题；打包态是 `file://`，sandbox 打开没问题。
- `preload.cjs` 用 CommonJS。注释：「CommonJS preload is more reliable than .mjs across Electron versions.」

## 13.3 三道网络边界

### 第一道：CSP

`session-config.mjs` 用 `webRequest.onHeadersReceived` 注入 CSP。两套规则：

| 指令                       | 开发态                                                                           | 打包态                      |
| -------------------------- | -------------------------------------------------------------------------------- | --------------------------- |
| `default-src`              | `'self'`                                                                         | `'self'`                    |
| `script-src`               | `'self' 'unsafe-inline' 'unsafe-eval'`                                           | `'self'`                    |
| `style-src`                | `'self' 'unsafe-inline'`                                                         | 同                          |
| `img-src`                  | `'self' data: blob:`                                                             | 同                          |
| `font-src`                 | `'self' data:`                                                                   | 同                          |
| `connect-src`              | `'self' http://127.0.0.1:* ws://127.0.0.1:* ws://localhost:* http://localhost:*` | `'self' http://127.0.0.1:*` |
| `frame-src` / `object-src` | `'none'`                                                                         | `'none'`                    |
| `base-uri`                 | `'self'`                                                                         | `'self'`                    |

两条注释解释了为什么开发态必须放开 script-src：

> Vite dev injects inline module scripts + uses eval for HMR; strict script-src breaks Electron white screen.

还有一条关于字体的坑：

> 渲染器会把小字体内联成 `data:`（Vite `assetsInlineLimit` 默认 4KB）。`img-src` 已允许 `data:`，字体同样属于应用自带资源；不加 `data:` 会被 CSP 拦下，用户侧表现为**字体静默回退 + 控制台报错**。

注意最后那个症状描述：字体静默回退。界面看起来「就是丑了一点」，不像报错，很容易被忽略。

### 第二道：导航白名单

`denyUnexpectedMainWindowNavigation` 拦 `will-navigate`。允许的只有两种来源：

- 打包态：`dist/` 目录下的 `file://` 路径。
- 开发态：Vite 的端口 + 回环主机（`localhost` 或 `127.0.0.1`）。

注释把风险讲得很清楚：

> `will-navigate`：同窗口导航可把远程页面装进带 preload 的主窗口（token + fs 桥随之暴露）。只允许预期 origin（packaged `file://` dist / dev Vite loopback 端口），其余一律拦下。程序化 `loadURL` / `loadFile` 不触发 `will-navigate`，正常加载不受影响。

也就是说，如果不管这一道，一个远程页面被导航进主窗口，它就**继承了 preload**——能拿到本机 API 的凭据、能调文件桥。这是最危险的一类漏洞。

### 第三道：`window.open` 一律拒绝

`denyInAppWindowOpen` 把 `window.open` 的 `action` 永远设成 `deny`；如果是 `http(s)` 链接，先交给系统浏览器打开。

注释：

> `target=_blank` / `window.open` to http(s) must open in the system browser, not an in-app window (often blank).

## 13.4 窗口生命周期：一个容易踩的坑

`app-windows.mjs` 是纯函数模块（不依赖 Electron 运行时，好测）。它管两件事。

### `shouldKeepLocalServerAlive`

关窗时要不要杀掉本地服务？判定是「有主窗口、有辅助窗口、还有任何应用窗口」三者任一为真就保留。

为什么这么麻烦？注释讲了一个具体故障：

> Detached DevTools is itself a BrowserWindow. Closing it can emit `window-all-closed` even while the LawMind window is still up. Killing the loopback API in that case leaves the main renderer failing every `/api/*` call (JSON parse / fetch errors).

也就是说：**分离式开发者工具的窗口关掉，也会触发 `window-all-closed`。** 如果这时候顺手把本地服务杀了，主界面就会开始报一堆 fetch 错误，而且没人会想到是「关了个 devtools 窗口」导致的。

顺带解释了另一件事：为什么**从不自动打开分离式 DevTools**。注释：

> Never auto-open _detached_ DevTools: that window is easy to mistake for a new chat, and closing it can kill the local API (see `window-all-closed`). Opt-in docked tools: `LAWMIND_DEVTOOLS=1`.

分离式 devtools 看起来像一个新窗口，容易误关；而且关了可能连带杀掉本地服务。所以默认不开，要看就 `LAWMIND_DEVTOOLS=1` 开**停靠式**的（菜单里「显示 → 切换开发者工具」也一直可用）。

### 退出时拉守护

`before-quit` 里做两件事：杀掉本地服务，然后 **best-effort 拉起工作区守护进程**（`spawnWorkspaceDaemon`）。所以关掉应用之后，后台的定时办件还能继续（第 14、17 章）。

## 13.5 IPC 桥：渲染进程能碰到什么

`preload.cjs` 通过 `contextBridge.exposeInMainWorld("lawmindDesktop", ...)` 暴露一整套方法。这是唯一的桥面。

按功能分组列一下（括号里是 IPC 通道名）：

**配置与更新**：`getConfig()`（`lawmind:get-config`）、`checkForUpdates()`、`showNotification()`、`readModelSettings()`、`saveSetup()`、`keychainStatus()`、`setRetrievalMode()`、`setOpenLawNpc()`、`syncWordAddinManifest()`。

**密钥**：`saveCustomModelKey()`、`deleteCustomModelKey()`、`saveMcpServerSecret()`、`deleteMcpServerSecret()`。

**目录与挂载**：`pickWorkspace()`、`pickProject()`、`pickFolder()`、`setProjectDir()`、`listHostFolders()`、`addHostFolder()`、`removeHostFolder()`、`bindHostFolder()`。

**文件桥**：`fsList()`、`fsRead()`、`fsWrite()`、`fsMkdir()`、`fsRename()`、`fsDelete()`、`fsCopy()`、`importDroppedFiles()`、`importPastedBytes()`。

**对话框与 shell**：`openFilesDialog()`、`saveTextFileDialog()`、`openExternal()`、`showItemInFolder()`、`openWithSystem()`、`openAuxWindow()`。

**订阅（主进程推给渲染进程）**：`onLoopbackConfig()`（`lawmind:loopback-config`，本地服务的 base + 凭据 + 实例 id + 代次）、`onNotificationClick()`、`onFileMenu()`（菜单里的保存/另存为）。

**一个非 IPC 的方法**：`getPathForFile(file)`。它先用 `webUtils.getPathForFile`，失败时回退到老的 `file.path`。拖拽文件进来时用它拿磁盘路径。

### `lawmind:get-config` 返回什么

这个响应值得单独看，因为它把「运行环境到底长什么样」暴露给界面：

```text
apiBase, apiAuthToken, loopbackPortDrift,
workspaceDir, projectDir, envFilePath, lawMindRoot, configPath,
retrievalMode, packaged, bundledServer,
nodeRuntimeKey, nodeExecutable, appVersion, downloadPageUrl
```

注意 `loopbackPortDrift`。源码注释：

> 端口漂移 = 侧载清单失联的前兆，必须在体检面板里看得见

也就是说端口漂移这件事刻意暴露到界面上，让律师能自己看到问题（见 13.9）。

## 13.6 密钥存在哪

`lawmind-key-vault.cjs` 是 OS 密钥链的封装（用 Electron 的 `safeStorage`）。

- 服务名固定 `ai.lawmind.desktop`。
- 账号名有约定，比如 `wizard.default.apiKey`、`wizard.webSearch.apiKey`、`custom.<模型id>.apiKey`、`mcp.<服务id>.secret`、`audit.hashChainKey`、`mail.secretsKey`、`localApi.installationSecret`。
- 加密后的密文放在 `path.join(app.getPath("userData"), "lawmind-secrets.json")`。

四个操作：`saveSecret` / `readSecret` / `deleteSecret` / `listSecrets`。

### 不可用时的行为

头部注释写得很明确：

> All operations are best-effort: if `safeStorage` encryption is unavailable (rare, but possible on some Linux configurations), `isAvailable()` returns false and callers **must refuse** persisting new secrets.

所谓「must refuse」是真的拒。保存 API Key 时如果密钥链不可用，界面会看到：

```text
系统加密存储不可用，无法安全保存新的 API Key。请启用操作系统密钥链，或先在 .env.lawmind 中手工配置后重启。
```

错误码 `keychain_unavailable`。另外两个相关错误码：`keychain_write_failed`（写入失败，文案是「密钥链写入失败，已取消保存以避免明文落盘。」）。

**宁可保存失败，也不明文落盘。** 这是这条设计的原则。

### 保存成功后会抹掉明文

有一处细节很容易漏：密钥存进密钥链之后，`.env.lawmind` 里的明文会被**删掉**。相关函数叫 `writeLawmindEnvWithoutKeys`，注释：

> Remove plaintext secrets from `.env.lawmind` after they are stored in the OS keychain.

为什么要删？注释在保存流程里说了：

> Env-file keys win over keychain at server bootstrap; strip so the new keychain secret is not shadowed by a stale plaintext key from an earlier save.

也就是说：**环境变量文件的优先级高于密钥链**。如果不删掉旧明文，新存的密钥链密钥会被旧明文盖住，你以为换了密钥其实没换。

要清理的键名是固定的 8 个（`WIZARD_ENV_SECRET_KEYS`）：`LAWMIND_AGENT_API_KEY`、`LAWMIND_QWEN_API_KEY`、`LAWMIND_DEEPSEEK_API_KEY`、`LAWMIND_PROVIDER_DEEPSEEK_API_KEY`、`DEEPSEEK_API_KEY`、`LAWMIND_CHATLAW_API_KEY`、`LAWMIND_WEB_SEARCH_API_KEY`、`BRAVE_API_KEY`。

## 13.7 文件桥：可写根白名单

`fs-bridge.mjs` 是文件操作的唯一入口。它的核心是三个「拒绝」。

### 拒绝一：不可写的根

可写根只有一个白名单：

```js
WRITABLE_ROOT_KEYS = new Set(["workspace", "project"]);
```

**注意这是白名单，不是黑名单。** 注释专门解释了为什么不反过来写：

> 用白名单而非「root 以 `mount:` 开头」的否定式判断：新增根种类（如将来的 `grant:`）默认只读，必须显式加入才能写，避免默默开出一个新写入口。

本机文件夹（`mount:<id>`）是只读的，被拒时的文案是：

```text
本机文件夹默认不能改写。请使用「收进本案」复制到案件目录。
```

正确做法就是「收进本案」——复制到案件目录，然后在案件目录里改。

### 拒绝二：路径穿越与逃逸

`resolveFsPath` 有四种拒绝：

| 情况                     | 报错                            |
| ------------------------ | ------------------------------- |
| 路径含 `..`              | `path traversal is not allowed` |
| 解析后逃出根             | `path escapes root`             |
| 路径不存在（要求存在时） | `path does not exist`           |
| 符号链接指向根外         | `symlink escapes root`          |

注意最后一条：**符号链接会做 realpath 检查**。不然建个软链就能绕过根围栏。

### 拒绝三：治理路径

有一组路径禁止通过文件接口改写，这是「治理与数据分离」的落地：

| 类别                   | 内容                                                    |
| ---------------------- | ------------------------------------------------------- |
| 精确匹配               | `lawmind.policy.json`、`.env`、`.env.lawmind`           |
| 前缀匹配               | `lawmind/`、`audit/`、`sessions/`、`tasks/`、`matters/` |
| 文件名匹配（任意深度） | `.lawmind-dms.json`、`RULES.md`、`ethics-wall.json`     |

拒绝文案：

```text
该路径属于 LawMind 治理/审计数据（策略、MCP 配置、审计、会话、任务、案件真相源），
不能通过写文书或文件接口修改；请使用对应的设置入口。
```

错误码 `protected_workspace_path`。

为什么 `RULES.md` 要保护？因为**它会被注入系统提示词**。模型能改 `RULES.md`，就等于能改自己的行为准则。

### 一份要手工同步的镜像

这段清单在 `src/lawmind/runtime/protected-workspace-rels.ts` 里有一份规范实现，在 `fs-bridge.mjs` 里有一份纯 JS 镜像。注释写明了原因和风险：

> 规范实现：`src/lawmind/runtime/protected-workspace-rels.ts`（Electron 主进程为 `.mjs`，无法直接 import TS）。修改该文件清单时必须同步修改此处。

工程研究笔记把这类「因为技术限制而复制」的常量列为最容易漂移的地方，目前也没有单测保证两份一致。

### 大小与类型限制

| 限制         | 值                                       |
| ------------ | ---------------------------------------- |
| 文本读取上限 | 1MB（`MAX_TEXT_READ_BYTES`）             |
| 图片读取上限 | 12MB（`MAX_IMAGE_READ_BYTES`）           |
| 二进制判定   | 采样前 4096 字节，出现 `0x00` 即判二进制 |

图片的 MIME 是按后缀映射的（png / jpg / jpeg / gif / webp / bmp / svg / ico）。

### 写冲突检测

`fs:write` 支持乐观并发：传了 `expectedMtimeMs` 且磁盘上的 mtime 差超过 1ms，就返回：

```text
{ ok: false, conflict: true, error: "file was modified externally", mtimeMs }
```

意思是「你看到的版本已经被别人改过了」，不是静默覆盖。

## 13.8 用户数据目录为什么要「钉住」

`lawmind-root.mjs` 和 `brand.mjs` 里有一个不太直观的设计。

开发态的 userData 固定在 `Application Support/Electron`（**不是** `…/Electron/LawMind`——`Electron` 是 Electron 自己的 userData 目录名，`LawMind` 是 LawMind 建在其下的数据根 `lawMindRoot`，两个概念别混）。为什么保留 `Electron` 这个名字？注释：

> Keep unpackaged userData on the historical Electron folder so renaming `CFBundleName` / `app.setName` does not migrate workspace or `.env.lawmind`.

也就是说：应用名改来改去，如果 userData 跟着名字走，那**每次改名都会「丢掉」工作区和 API Key**（其实是换了个新目录）。所以开发态把这个目录钉死。

`BRANDING.md` 里也有一条禁令：**不要改开发态 CFBundleIdentifier**（`com.github.Electron`），理由相同。

### E2E 隔离为什么不用 `--user-data-dir`

`lawmind-root.mjs` 的头部注释解释了一个技术细节：

Playwright 的 `_electron.launch()` 会**静默忽略** `--user-data-dir`（因为它自己的 `--inspect=0` / `--remote-debugging-port=0` 排在前面），而 `pinDevUserData` 又会无条件覆盖外部设置。

所以改成应用自己支持 `LAWMIND_USER_DATA_DIR`，而且**打包版一律忽略**：

> 与 `LAWMIND_SKIP_API_AUTH` 同一姿态：测试可隔离，生产不可被环境变量改状态。

这条原则值得记：**凡是能让测试好写的环境变量，生产环境一律不认。**

## 13.9 端口漂移：一次真实故障的产物

这一节讲的是本项目最有教育意义的一次故障。

### 故障现象

Word 任务窗格报 `unauthorized`，而且**每次重启 LawMind 都复发**。后来服务换了端口，窗格改报 `Load failed`（网络错误）。两个症状都看不出真正的原因。

### 根因

`local-api-credentials.mjs` 的头部注释讲得很清楚，有三层：

第一层：**一把共享令牌服务四种客户端**。一个「每进程随机、只下发一次」的令牌，同时给桌面、渲染进程、Word 插件、CLI 用。Word 插件在页面加载时取一次令牌，之后不再取。于是必然出现「地址不变、钥匙变了」——重启后所有已打开的窗格一律 401。

第二层：**共享令牌在结构上回答不了「来源」**。

> 更根本的一处：共享令牌在结构上回答不了「这次改稿是从 Word 来的，还是从桌面端来的」—— 审计只能记 `actorId`（是谁），记不出来源（从哪来）。

第三层：**端口是持久化的**（Word 侧载清单把端口钉死了），所以第二个实例启动时发现端口被占，`pickPort` **静默**回退到随机端口。于是所有已侧载的窗格全部失联，而且窗格无处重新发现新端口（发现端点也挂在旧 base 上）。

注释对这一点的措辞很到位：

> 但「回退随机」这一步是静默的，而这正是那次故障的根因。

### 修法一：派生化凭据

新的凭据模型：

```text
credential(clientId, epoch) = HMAC-SHA256(installationSecret, "<clientId>:<epoch>")
```

四个客户端 id：`desktop`、`renderer`、`word-addin`、`cli`。加一个历史遗留的 `shared`（来自 `LAWMIND_LOCAL_API_TOKEN`，只在开发/E2E 用）。

关键性质：

- **同一安装密钥 + 同一 clientId + 同一代次 → 永远算出同一个凭据。** 重启不换钥匙。
- 轮换靠 `epoch` 递增，而且允许**读上一代**（`LOCAL_API_EPOCH_GRACE = 1`）。注释解释了为什么要有宽限：轮换代次不能让所有客户端立刻 401。
- 每个客户端**可以单独吊销**（有吊销名单）。
- 比较用常量时间（`timingSafeEqual`，先比长度短路）。

`installationSecret` 存在密钥链里（`localApi.installationSecret`），而且放在**工作区之外**。注释给的理由很值：

> 工作区是 agent 可写区（Skills 就在那儿播种），把鉴权根密钥放进去，等于让被审查的材料有机会改掉自己的锁。

### 修法二：最小权限

反查客户端时按固定顺序逐个试。`isClientAllowedForRequest` 的规则：

| 客户端                | 能做什么                                    |
| --------------------- | ------------------------------------------- |
| `desktop`、`renderer` | 全部                                        |
| `shared`              | 全部（历史语义，仅开发）                    |
| `word-addin`          | 只能碰 `/word-addin/` 和 `/api/word-addin/` |
| `cli`                 | 只能 `GET` / `HEAD` / `OPTIONS`             |
| 其他                  | **默认拒绝**                                |

注释特意提醒：未知客户端也必须在 `isClientAllowedForRequest` 里给个范围，否则默认拒绝——这是 fail-closed 的写法。

CLI 的只读凭据写在 `<应用根>/local-api-clients.json`（权限 0600），内容是 `{ base, epoch, instanceId, credentials: { cli } }`。删除时用 `instanceId` 比对，避免误删另一个实例的文件。

### 修法三：让端口漂移可见

`local-api-port-contract.mjs` 是三个纯函数：

- `buildPortDrift({preferredPort, actualPort, occupant})`：端口没漂就返回 `null`。占位者分三类：`another-lawmind`、`foreign`、`unknown`。注释特意说明 `unknown` **不等于** `foreign`——「连不上或不是 HTTP：可能是外部程序，也可能是刚死的残留。区分不了就如实说。」
- `classifyDiscoveryResponse(body)`：判「是不是另一个 LawMind 实例」靠**响应结构**（有非空 `instanceId`、有 `clients` 数组、有数字 `epoch`），不靠进程名或端口。
- `resolveManifestTargets` / `manifestInstructions`：告诉律师清单该放哪、下一步做什么。

漂移时的警告文案长这样：

```text
[LawMind] 本机 API 端口从 <旧> 漂移到 <新>：<旧> 被<另一个 LawMind 实例 / 其它程序>占用。
Word 加载项的侧载清单把端口钉死（http://localhost:<旧>/word-addin/taskpane.html），
因此在重新侧载清单之前，已打开的窗格会报「无法加载」或加载失败。
请在「设置 → 体检」里用「重新侧载 Word 清单」修复。
```

## 13.10 其他壳内能力

| 模块                                                                             | 干什么                                                                                                                                                     |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `safe-shell-command.mjs`                                                         | 安全 shell 网关：白名单命令（`open` / `explorer` / `start` / `xdg-open`）、绝对路径校验、参数数组、审计到 `workspace/audit/desktop-shell-YYYY-MM-DD.jsonl` |
| `import-dropped-files.mjs`                                                       | 把拖进来的文件收进工作区：单文件 200MB、单目录 200 个文件、深度 8、总量 500MB                                                                              |
| `picker-path-grant.mjs`                                                          | 记录律师在原生对话框里选过的目录（最多 64 个），渲染进程传来的路径必须匹配才放行                                                                           |
| `host-access-store.mjs`                                                          | 本机文件夹挂载的持久化（`<应用根>/host-access.json`）                                                                                                      |
| `officecli-runtime.mjs`                                                          | 定位 officecli 可执行文件：`LAWMIND_OFFICECLI` → 打包的 `resourcesPath/officecli/<平台-架构>/` → 仓库里的 vendor 目录                                      |
| `renderer-recovery.mjs`                                                          | 渲染进程加载失败/崩溃时重试（最多 3 次），最终兜底显示一个说明页                                                                                           |
| `server-supervision.mjs`                                                         | 本地服务崩溃监督：指数退避（基 500ms、系数 2、上限 30s、最多 5 次）。**正常停止不触发重启。**                                                              |
| `mac-gatekeeper.mjs` + `after-pack-mac.mjs` + `after-all-artifact-build-mac.mjs` | macOS 签名与公证（见 13.11）                                                                                                                               |
| `brand.mjs`                                                                      | 品牌读取（`branding/manifest.json`）                                                                                                                       |

`safe-shell-command.mjs` 有一条注释很值得记：

> 独立文件，避免写入引擎哈希链日审计而把链打断。

也就是说，桌面壳的审计**单独写一个文件**，不混进引擎那条带哈希链的审计里。否则壳的事件会把哈希链「插队」，反而破坏完整性。

## 13.11 打包与签名

打包流程（`pnpm lawmind:desktop:dist`）的顺序是固定的：

1. `bundle:server` → `server/dist/lawmind-local-server.cjs`
2. `vendor:node` → `resources/node-runtime/<平台-架构>/`
3. `vendor:officecli` → `resources/officecli/<平台-架构>/`
4. `vite build`
5. `electron-builder`

产物：macOS 出 `dmg` + `zip`，Windows 出 `nsis` + `portable` + `zip`，Linux x64 出 `AppImage` + `tar.gz`。

### macOS 的两条硬规则

`mac-gatekeeper.mjs` 的头部注释讲清了签名状态和用户体验的关系：

> Browser-downloaded apps only double-click when signed with Developer ID Application and notarized. Adhoc (-) seals resources so a locally built app launches; it **does not** pass Gatekeeper after download.

翻译：**从浏览器下载的 app，只有 Developer ID 签名 + 公证过，才能双击打开。** 自签名（adhoc）只在本地能跑，下载之后会被 Gatekeeper 拦。

`after-all-artifact-build-mac.mjs` 里有一个开关 `LAWMIND_REQUIRE_NOTARIZED=1`：打开之后，如果 app 不是 Developer ID 签名，直接抛错：

```text
LAWMIND_REQUIRE_NOTARIZED=1 but LawMind.app is not signed with Developer ID Application
```

CI 的 tag 工作流就带着这个开关。没证书时它会诚实地失败，而不是出一个「看起来能发」的包。

相关凭据环境变量：`CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`、`APPLE_KEYCHAIN_PROFILE` 等。

### 自动更新

用 `electron-updater`，只在打包态启用（开发态返回 `null`）。默认开自动下载、退出时安装。关闭开关是 `LAWMIND_SKIP_AUTO_UPDATE=1`。

菜单里两项：「检查更新…」和「下载安装包…」。后者打开的地址默认是 jsDelivr 上的下载页，可用 `LAWMIND_DOWNLOAD_PAGE_URL` 换。

各种结果的提示文案都是给律师看的（开发态会说「当前为开发构建，请使用菜单「下载安装包」页面获取正式版本。」）。

## 13.12 关键文件

| 关注点             | 文件                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------- |
| 启动、窗口、导航拦 | `apps/lawmind-desktop/electron/main.mjs`                                                |
| 窗口生命周期纯函数 | `electron/app-windows.mjs`                                                              |
| 菜单、加载、更新   | `electron/app-menu.mjs`                                                                 |
| CSP                | `electron/session-config.mjs`                                                           |
| 崩溃恢复           | `electron/renderer-recovery.mjs`                                                        |
| IPC 注册           | `electron/ipc-handlers.mjs`                                                             |
| 桥面               | `electron/preload.cjs`                                                                  |
| 文件桥             | `electron/fs-bridge.mjs`                                                                |
| 密钥链             | `electron/lawmind-key-vault.cjs`                                                        |
| 凭据与端口契约     | `electron/local-api-credentials.mjs`、`local-api-port-contract.mjs`                     |
| 本地服务子进程     | `electron/local-server.mjs`、`server-supervision.mjs`                                   |
| 用户数据根         | `electron/lawmind-root.mjs`、`brand.mjs`                                                |
| shell 网关         | `electron/safe-shell-command.mjs`                                                       |
| 拖入导入           | `electron/import-dropped-files.mjs`                                                     |
| 路径授权           | `electron/picker-path-grant.mjs`、`host-access-store.mjs`                               |
| officecli 定位     | `electron/officecli-runtime.mjs`                                                        |
| 签名公证           | `electron/mac-gatekeeper.mjs`、`after-pack-mac.mjs`、`after-all-artifact-build-mac.mjs` |
| 文档               | `apps/lawmind-desktop/BRANDING.md`、`README.md`、`INSTALL.md`、`RELEASE-CHECKLIST.md`   |

## 13.13 已知坑

- **不要自动打开分离式 DevTools。** 关了它会触发 `window-all-closed`，可能连带杀掉本地服务，症状是主界面一堆 fetch 报错。
- **`window-all-closed` 不能直接杀服务。** 要过 `shouldKeepLocalServerAlive` 判断（有辅助窗口就得留着）。
- **不要改开发态 CFBundleIdentifier。** 改了会「换」用户数据目录，等于丢工作区和密钥。
- **生产环境不认 `LAWMIND_USER_DATA_DIR`。** 只有开发态生效，这是有意的。
- **可写根是白名单。** 新增根种类默认只读，要写必须显式加进 `WRITABLE_ROOT_KEYS`。
- **治理路径清单有两份镜像。** 改 `protected-workspace-rels.ts` 必须同步改 `fs-bridge.mjs`，目前没有测试保证一致。
- **本机文件夹不能改写。** 用「收进本案」复制到案件目录再改。
- **密钥链不可用时保存会失败，这是对的。** 不要为了「能保存」改成明文落盘。
- **存完密钥链要抹掉 `.env.lawmind` 里的明文。** 环境变量优先级更高，不抹掉新密钥会被旧明文盖住。
- **凭据是派生的，不是随机的。** 排查「重启后 401」先看 `installationSecret` 和 `epoch` 是否一致，别去怀疑令牌过期。
- **端口漂移是静默的。** 换端口后已侧载的 Word 窗格会失联，界面上要看 `loopbackPortDrift` 字段。
- **`unknown` 占位者和 `foreign` 不是一回事。** 探测不到就别说是外部程序。
- **macOS 未公证包从浏览器下载后双击打不开。** 要右键 → 打开；正式包必须签名+公证。
- **桌面壳的审计单独写文件。** 别把它并进引擎的哈希链日审计，会打断链。
