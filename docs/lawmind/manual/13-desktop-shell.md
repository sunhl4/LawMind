# 第 13 章 桌面壳

这一章讲 Electron 那一层：窗口怎么开、渲染进程能碰到什么、密钥放哪、端口为什么会漂。

> 这一章是**从架构看**。逐文件的实现精读在第 66–67 章：第 66 章讲进程与桥面（启动十三步、导航护栏、CSP、43 个桥面通道全表、文件桥十一步围栏、拖放导入、安全命令网关、密钥保管），第 67 章讲端口契约、凭据派生与 macOS 签名公证（含 2026-09-21 那次故障的完整因果链）。

## 13.1 定位：这一层管什么

桌面壳（`apps/lawmind-desktop/electron/`）只做四件事：

1. **开窗口**，把渲染进程装进去。
2. **当桥**：渲染进程需要碰文件系统、要用原生对话框、要调 shell，都通过 IPC 让主进程去做。
3. **管子进程**：本地 HTTP 服务、officecli、后台守护，都由主进程拉起来和监督。
4. **守住边界**：CSP、导航白名单、可写根白名单、治理路径保护，都在这一层。

有一条贯穿全层的前提：**渲染进程不直接碰文件系统、不直接联网**。所有敏感动作要么走本地 API，要么走 IPC，由主进程校验后再执行。

律师看不见这一层。端口、密钥链、Node 路径、开发者工具和侧载清单只留在日志与本手册。界面上只说结果：Word 连上没有、钥匙串能不能保存、有没有新版本。

五条铁律在这里的取舍：

| 铁律           | 这一层怎么落                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------- |
| 上手简单       | 不向律师展示端口、环境变量、开发者工具或打包命令。Word 连不上时只说「请完全退出 Word 后再打开」。 |
| 交付质量       | 壳不写文书。它保证改稿、导出、钥匙串保存能做完；保存失败就说明失败，不改成明文凑成功。            |
| 稳定           | 关开发者工具不能杀掉本地服务；端口被占时写回已有清单，不静默换一把随机地址。                      |
| 先复用，后自研 | 窗口、菜单、更新用 Electron 现成能力。自写的只有回环围栏、文件桥和凭据派生。                      |
| 发挥模型能力   | 壳不参与选工具。硬控只留在导航、密钥、可写根和治理路径：这些是凭据与自我提权，不是文稿质量。      |

对照 Cursor / Codex / Harvey：本地运行时是产品的一部分，不做成第二套运维控制台。日志、哈希链和壳审计只服务排障与安全调查，不当成律师信任来源。

## 13.2 启动顺序

主进程入口是 `apps/lawmind-desktop/electron/main.mjs`。模块加载阶段到窗口出现，顺序是这样的：

1. `ignoreBrokenPipe(process.stdout/stderr)`：子进程日志前转时管道断了不把主进程带走。
2. 解析运行时图标路径。
3. `applyProductName(app)` 设应用名（从 `branding/manifest.json` 读，不是硬编码）。
4. `pinDevUserData(app)` 钉住开发态的用户数据目录（见 13.8）。
5. 建文件桥 `createFsBridge(getAllowedRoots)`。
6. **单实例锁**：`app.requestSingleInstanceLock()`。开发态可以用 `LAWMIND_ALLOW_MULTI_INSTANCE=1` 关掉（有警告，且只有非打包态生效）；锁基于 userData 路径，所以 E2E 给每个实例一个独立 `LAWMIND_USER_DATA_DIR` 就能各自拿到锁。拿不到锁的第二个实例不抢端口、不动共享凭据文件，直接退出。
7. `app.whenReady()` 之后：
   - macOS 设置 Dock 图标。
   - `installIpcHandlers()` 注册所有 IPC。
   - `setupApplicationMenu()` 装菜单。
   - 装渲染进程崩溃恢复（崩了就重建窗口）。
   - `await createWindow()` 开主窗口——窗口出现前先在里头 `await ensureBackend()` 把本地服务拉起到就绪。
   - 12 秒后跑一次自动更新检查（`LAWMIND_E2E=1` 或 `LAWMIND_SKIP_AUTO_UPDATE=1` 时跳过）。
   - 启动失败会打日志并**重试一次**；第二次失败才 `app.quit()`。
8. 两个善后事件：`second-instance`（律师又点了一次图标）把已有窗口叫到前台——注释说得很直白，「用户以为没打开，其实是已有窗口在后台」；macOS 的 `activate` 同理，没窗时才新建。

### 窗口参数

```js
new BrowserWindow({
  width: 1280, height: 840,
  minWidth: 1024, minHeight: 720,
  title: LAWMIND_PRODUCT_NAME,
  icon: appIconPath,
  autoHideMenuBar: true,
  webPreferences: {
    preload: <dir>/preload.cjs,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: app.isPackaged,
  },
})
```

几个决定值得解释：

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
| `worker-src`               | `'self' blob:`                                                                   | 同                          |
| `frame-src` / `object-src` | `'none'`                                                                         | `'none'`                    |
| `base-uri`                 | `'self'`                                                                         | `'self'`                    |

两条注释解释了为什么开发态必须放开 script-src：

> Vite dev injects inline module scripts + uses eval for HMR; strict script-src breaks Electron white screen.

还有一条关于字体的坑：

> 渲染器会把小字体内联成 `data:`（Vite `assetsInlineLimit` 默认 4KB）。`img-src` 已允许 `data:`，字体同样属于应用自带资源；不加 `data:` 会被 CSP 拦下，用户侧表现为**字体静默回退 + 控制台报错**。

注意最后那个症状描述：字体静默回退。界面看起来「就是丑了一点」，不像报错，很容易被忽略。

`worker-src 'self' blob:` 是给 pdf.js 的：它在 worker 上画图，`blob:` 盖 Vite 开发态的 worker，`'self'` 盖打包后的文件。

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

`app-windows.mjs` 是纯函数模块（不依赖 Electron 运行时，好测）。窗口相关的纯判定都在这：导航白名单（13.3 的那道）、DevTools 窗口与弹出窗识别（`devtools://` 前缀 / `lm-popout=` 哈希）、以及下面这个关窗时的服务去留判定。

### `shouldKeepLocalServerAlive`

关窗时要不要杀掉本地服务？判定是「有主窗口、有辅助窗口、还有任何应用窗口」三者任一为真就保留。

为什么这么麻烦？注释讲了一个具体故障：

> Detached DevTools is itself a BrowserWindow. Closing it can emit `window-all-closed` even while the LawMind window is still up. Killing the loopback API in that case leaves the main renderer failing every `/api/*` call (JSON parse / fetch errors).

也就是说：**分离式开发者工具的窗口关掉，也会触发 `window-all-closed`。** 如果这时候顺手把本地服务杀了，主界面就会开始报一堆 fetch 错误，而且没人会想到是「关了个 devtools 窗口」导致的。

配套的一道过滤在 `main.mjs`：`listAppWindows()` 先把 URL 以 `devtools://` 开头的窗口（`isDevToolsWindowUrl`）排除掉，再数「还剩几个应用窗口」——否则 DevTools 窗口本身又会被当成「还有窗口」而干扰判定。

顺带解释了另一件事：为什么**从不自动打开分离式 DevTools**。注释：

> Never auto-open _detached_ DevTools: that window is easy to mistake for a new chat, and closing it can kill the local API (see `window-all-closed`). Opt-in docked tools: `LAWMIND_DEVTOOLS=1`.

分离式 devtools 看起来像一个新窗口，容易误关；而且关了可能连带杀掉本地服务。所以默认不开，要看就 `LAWMIND_DEVTOOLS=1` 开**停靠式**（`mode: "bottom"`）的——而且只在未打包、非 E2E 时生效（`LAWMIND_E2E=1` 下它也保持关闭）。未打包时菜单「显示 → 开发者工具」也一直在；正式安装包的「显示」菜单里只有缩放，没有这一项。

### 退出时拉守护

`before-quit` 里做两件事：杀掉本地服务，然后 **best-effort 拉起工作区守护进程**（`spawnWorkspaceDaemon`）。所以关掉应用之后，后台的定时办件还能继续（第 14、17 章）。

两个前提条件：工作区里 `lawmind/daemon.json` 的 `enabled` 为真，且旧 pid 已不在。起的是**监督进程**（`LAWMIND_DAEMON_SUPERVISOR=1`，真正的 tick 由它 fork 的子进程跑），环境过一道拒绝名单——`LAWMIND_LOCAL_API_INSTALLATION_SECRET`、代次、吊销名单、实例 id 一律不传：守护进程不监听端口，没有理由持有凭据根。

## 13.5 IPC 桥：渲染进程能碰到什么

`preload.cjs` 通过 `contextBridge.exposeInMainWorld("lawmindDesktop", ...)` 暴露一整套方法。这是唯一的桥面。

先把数说清（2026-10 实测）：`preload.cjs` 里一共 **43 个字面通道**，分两类——

- **40 个 invoke 通道**（渲染 → 主，`ipcRenderer.invoke`），全部在 `ipc-handlers.mjs` 用 `ipcMain.handle` 注册。
- **3 个推送通道**（主 → 渲染，`webContents.send`）：`lawmind:loopback-config`（在 `local-server.mjs` 服务就绪后广播）、`lawmind:file-menu`（在 `app-menu.mjs` 菜单点击后发）、`lawmind:notification-click`（在 `ipc-handlers.mjs` 的通知点击回调里发）。

所以 `ipc-handlers.mjs` 里能 grep 到 41 个字面量（40 个 handle + 1 个 send），另外两个 send 的字面量分别在 `local-server.mjs` 和 `app-menu.mjs`。43 = 40 + 3，两张表不矛盾。

按功能分组列一下：

**配置与更新**：`getConfig()`（`lawmind:get-config`）、`checkForUpdates()`、`showNotification()`、`readModelSettings()`、`saveSetup()`、`keychainStatus()`、`setRetrievalMode()`、`setOpenLawNpc()`、`syncWordAddinManifest()`、`readAuthoritySettings()`、`saveAuthority()`（权威法源/北大法宝的地址与令牌，见 13.6）。

**密钥**：`saveCustomModelKey()`、`deleteCustomModelKey()`、`saveMcpServerSecret()`、`deleteMcpServerSecret()`。

**目录与挂载**：`pickWorkspace()`、`inspectWorkspaceVolume()`（选中工作区之前先报所在卷的文件系统类型与剩余字节，只查询不判断）、`pickProject()`、`pickFolder()`、`setProjectDir()`、`listHostFolders()`、`addHostFolder()`（上限 16 个挂载）、`removeHostFolder()`、`bindHostFolder()`。

**文件桥**：`fsList()`、`fsRead()`、`fsWrite()`、`fsMkdir()`、`fsRename()`、`fsDelete()`、`fsCopy()`、`importDroppedFiles()`、`importPastedBytes()`。

**对话框与 shell**：`openFilesDialog()`、`saveTextFileDialog()`、`openExternal()`、`showItemInFolder()`、`openWithSystem()`、`openWithWps()`、`openAuxWindow()`（交付预览弹窗，只认 `kind: "review-preview"` + `taskId`）。

**订阅（主进程推给渲染进程）**：`onLoopbackConfig()`（`lawmind:loopback-config`，本地服务的 base + 渲染层自己的凭据 + 实例 id + 代次）、`onNotificationClick()`、`onFileMenu()`（菜单里的保存/另存为）。

**一个非 IPC 的方法**：`getPathForFile(file)`。它先用 `webUtils.getPathForFile`，失败时回退到老的 `file.path`。拖拽文件进来时用它拿磁盘路径。

### `lawmind:get-config` 返回什么

这个响应值得单独看，因为它把「运行环境到底长什么样」暴露给界面：

```text
apiBase, apiAuthToken, loopbackPortDrift, addinHosts,
workspaceDir, projectDir, envFilePath, lawMindRoot, configPath,
retrievalMode, packaged, bundledServer,
nodeRuntimeKey, nodeExecutable, appVersion, downloadPageUrl
```

`loopbackPortDrift` 仍在配置里，供 Word 连接组（设置 → 外观）判断「要不要请律师重开 Word」。`addinHosts` 是同组数据：Word 与 WPS 各自的连接状态（`connected` / `reopen` / `missing` / `another-copy`），由主进程比对「清单里钉的端口」与「当前实际端口」算出（见 13.9）。界面不显示端口号、本机地址或占位者分类。数字和原因只打在主进程日志里。

注意 `apiAuthToken` 下发的是**渲染层自己**的凭据（clientId=`renderer`），主进程健康检查用的是另一把（clientId=`desktop`），安装密钥本身永不下发。

## 13.6 密钥存在哪

`lawmind-key-vault.cjs` 是 OS 密钥链的封装（用 Electron 的 `safeStorage`）。

- 服务名固定 `ai.lawmind.desktop`。
- 账号名有约定：`wizard.default.apiKey`、`wizard.webSearch.apiKey`、`authority.pkulaw.apiKey`（北大法宝访问令牌，注入为 `LAWMIND_AUTHORITY_API_KEY`）、`custom.<模型id>.apiKey`、`mcp.<服务id>.secret`、`audit.hashChainKey`、`mail.secretsKey`、`localApi.installationSecret`。
- 加密后的密文放在 `path.join(app.getPath("userData"), "lawmind-secrets.json")`。

四个操作：`saveSecret` / `readSecret` / `deleteSecret` / `listSecrets`。

两道防呆值得知道：

- **落盘文件坏了就拒绝再写**（`storeCorrupt`）：`lawmind-secrets.json` 解析失败时，读返回空、写直接失败——避免拿一个空库覆盖落盘，把已存密钥冲掉。
- **写入是原子的**：先写 `.<pid>.tmp` 再 rename，权限 0600；写失败会把内存里的改动回滚回去。

### 不可用时的行为

头部注释写得很明确：

> All operations are best-effort: if `safeStorage` encryption is unavailable (rare, but possible on some Linux configurations), `isAvailable()` returns false and callers **must refuse** persisting new secrets.

所谓「must refuse」是真的拒。保存 API Key 时如果密钥链不可用，界面会看到：

```text
无法安全保存。请在系统设置里打开钥匙串后再试。
```

错误码 `keychain_unavailable`。另外两个相关错误码：`keychain_write_failed`（写入失败，文案是「密钥链写入失败，已取消保存以避免明文落盘。」）。

**宁可保存失败，也不明文落盘。** 这是这条设计的原则。

### 保存成功后会抹掉明文

有一处细节很容易漏：密钥存进密钥链之后，`.env.lawmind` 里的明文会被**删掉**。相关函数叫 `writeLawmindEnvWithoutKeys`，注释：

> Remove plaintext secrets from `.env.lawmind` after they are stored in the OS keychain.

为什么要删？注释在保存流程里说了：

> Env-file keys win over keychain at server bootstrap; strip so the new keychain secret is not shadowed by a stale plaintext key from an earlier save.

也就是说：**环境变量文件的优先级高于密钥链**。如果不删掉旧明文，新存的密钥链密钥会被旧明文盖住，你以为换了密钥其实没换。

要清理的键名是固定的 8 个（`WIZARD_ENV_SECRET_KEYS`）：`LAWMIND_AGENT_API_KEY`、`LAWMIND_QWEN_API_KEY`、`LAWMIND_DEEPSEEK_API_KEY`、`LAWMIND_PROVIDER_DEEPSEEK_API_KEY`、`DEEPSEEK_API_KEY`、`LAWMIND_CHATLAW_API_KEY`、`LAWMIND_WEB_SEARCH_API_KEY`、`BRAVE_API_KEY`。保存「连接权威库」时同口径：令牌进钥匙串后把 `LAWMIND_AUTHORITY_API_KEY` 从 env 抹掉。但权威库令牌有一处**有意的例外**：钥匙串不可用（新鲜克隆的 Linux 无密钥环、macOS 首访被拒）时，法宝令牌会写进用户数据目录的 `.env.lawmind`（随后 chmod 0600），而不是报「无法安全保存」——注释解释了取舍：该文件不在仓库里，而设置页不能因此接不上法源。模型 Key 不走这个例外，仍然宁可失败。

### 两个方向相反的搬运

- **一次性搬迁**（`maybeMigrateEnvKeysToKeychain`）：每次起服务前，如果 `.env.lawmind` 里还有明文而钥匙串是空的，就把它拷进钥匙串——**明文留在 env 文件里**（注释：env file remains authoritative），免得重启后要重输。这是老安装升级时的桥。
- **子进程注入**（`collectSecretsForServerEnv`）：起本地服务时把钥匙串里的密钥解出来，按 provider 映射成 `LAWMIND_*_API_KEY` 环境变量注入子进程（含 `custom.<id>` → `LAWMIND_CUSTOM_<ID>_API_KEY`、`mcp.<id>` → `LAWMIND_MCP_<ID>_SECRET`）；env 文件里已有的键优先，不覆盖。

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

正确做法就是「收进本案」——复制到案件目录，然后在案件目录里改。这条通路在代码里就是 `fs:copy`：**源**按 `access: "read"` 解析（从只读挂载点复制进工作区是正当用法），**目标**必须过可写根白名单，且目标已存在时直接报错（`destination already exists`），不覆盖。

### 拒绝二：路径穿越与逃逸

`resolveFsPath` 先要求调用点显式声明 `access: "read" | "write"`（漏传当场报错），写操作在解析路径前先过拒绝一的可写根白名单。然后是四种拒绝：

| 情况                     | 报错                            |
| ------------------------ | ------------------------------- |
| 路径含 `..`              | `path traversal is not allowed` |
| 解析后逃出根             | `path escapes root`             |
| 路径不存在（要求存在时） | `path does not exist`           |
| 符号链接指向根外         | `symlink escapes root`          |

注意最后一条：**符号链接会做 realpath 检查**。不然建个软链就能绕过根围栏。

还有一个顺序细节：治理路径判定（拒绝三）排在 `mustExist` 存在性检查**之前**——否则「该路径不存在」会盖掉「这是保护路径」，既泄漏存在性，又让错误契约随文件状态漂移。

### 拒绝三：治理路径

有一组路径禁止通过文件接口改写，这是「治理与数据分离」的落地。清单只对 workspace 根生效（与 `/api/fs/write` 同口径），分两层：

**第一层：路径身份**（纯函数，不看文件系统）——

| 类别                    | 内容                                                                        |
| ----------------------- | --------------------------------------------------------------------------- |
| 精确匹配                | `lawmind.policy.json`                                                       |
| 前缀匹配                | `lawmind/`、`audit/`、`sessions/`、`tasks/`、`matters/`、`drafts/`、`.git/` |
| 文件名匹配（任意深度）  | `.lawmind-dms.json`、`RULES.md`、`ethics-wall.json`、`.signing-secret`      |
| `.env` 家族（任意深度） | 文件名是 `.env` 或以 `.env.` 开头（`.env.lawmind`、`.env.local` …）一律拒写 |
| 祖先目录                | 上表前缀对应的目录本身（`audit`、`sessions` …），外加 `cases`（案件卷）     |

祖先目录单列一条的原因注释讲得很清楚：`fs:delete` 是 `rm -r`，删 `audit` 等于删掉整条审计链；而前缀匹配只认 `audit/…` 这种**带斜杠**的形态，目录名本身不命中。所以「删/改名一个目录」必须连祖先一起拒。

**第二层：目录内容扫描**（`findProtectedEntryUnder`，删/改名这类连带整棵子树的操作才做）——`RULES.md`、`ethics-wall.json`、`.lawmind-dms.json` 是任意深度保护，无法用前缀枚举，所以删 `cases/<id>` 时必须走进去看里面有没有这些文件。扫描在 symlink 校验**之后**做（不能顺着软链去读根外目录），节点上限 20,000，超限按「可能有保护文件」处理（fail-closed）。

拒绝文案：

```text
该路径属于 LawMind 治理/审计数据（策略、MCP 配置、审计、会话、任务、案件真相源），
不能通过写文书或文件接口修改；请使用对应的设置入口。
```

错误码 `protected_workspace_path`。

为什么 `RULES.md` 要保护？因为**它会被注入系统提示词**。模型能改 `RULES.md`，就等于能改自己的行为准则。

这层保护还不只文件桥一家：菜单「另存为」（`lawmind:dialog:save-text-file`）的用途是把内容交到工作区**外**，本不做根围栏；但若律师恰好选到工作区内的治理路径，走同一个 `isProtectedWorkspaceWritePath`（含祖先目录）拒绝——注释说得很明白，「否则这是唯一一条能绕过 protected-workspace-rels 的写路径」。

### 一份要手工同步的镜像

这段清单在 `src/lawmind/runtime/protected-workspace-rels.ts` 里有一份规范实现，在 `fs-bridge.mjs` 里有一份纯 JS 镜像。注释写明了原因和风险：

> 规范实现：`src/lawmind/runtime/protected-workspace-rels.ts`（Electron 主进程为 `.mjs`，无法直接 import TS）。修改该文件清单时必须同步修改此处。

两份清单由 `electron/fs-bridge.test.ts` 逐项比对，改一边不改另一边会在测试里失败。

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

这条原则：**凡是能让测试好写的环境变量，生产环境一律不认。**

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

`installationSecret` 优先存在密钥链里（`localApi.installationSecret`）；密钥链不可用（headless / CI）时降级为**工作区之外**的 0600 文件 `<userData>/LawMind/local-api-installation-secret`。两个落点都在工作区之外，注释给的理由很值：

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

CLI 的只读凭据写在 `<userData>/LawMind/local-api-clients.json`（权限 0600），内容是 `{ base, epoch, instanceId, credentials: { cli } }`——只写「没有别的投递通道」的 cli 一个客户端，不全量落盘；服务停止时删除，且删除前用 `instanceId` 比对，避免误删另一个实例的文件。为什么不直接让 CLI 读安装密钥？注释：发现文件泄了只能读，安装密钥泄了能为**任意 clientId** 现算凭据（等于根密钥）。

### 修法三：端口变了自己写回，界面只请律师重开 Word

`local-api-port-contract.mjs` 是三个纯函数：

- `buildPortDrift({preferredPort, actualPort, occupant})`：端口没漂就返回 `null`。占位者分三类：`another-lawmind`、`foreign`、`unknown`。注释特意说明 `unknown` **不等于** `foreign`——「连不上或不是 HTTP：可能是外部程序，也可能是刚死的残留。区分不了就如实说。」
- `classifyDiscoveryResponse(body)`：判「是不是另一个 LawMind 实例」靠**响应结构**（有非空 `instanceId`、有 `clients` 数组、有数字 `epoch`），不靠进程名或端口。
- `resolveManifestTargets` / `manifestInstructions`：告诉律师清单该放哪、下一步做什么。

漂移时的警告文案长这样（占位者为 `unknown` 时措辞是「其它程序（该端口不响应本机 API 探测，无法进一步区分）」）：

```text
[LawMind] 本机 API 端口从 <旧> 漂移到 <新>：<旧> 被<另一个 LawMind 实例 / 其它程序>占用。
Word 加载项的侧载清单把端口钉死（http://localhost:<旧>/word-addin/taskpane.html），
因此已打开的 Word 窗格会连不上。将自动写回清单；请完全退出 Word 后再打开。
```

### 自动写回与「重新连接」按钮

写回动作有两个入口，同一套实现（`syncWordAddinManifest`）：

- **自动**：每次本地服务就绪都跑 `ensureHostAddins()`（不只漂移时——第一次安装也靠它登记），只写入**已经存在**的 Word 侧载目录与 WPS `jsaddons` 目录（`downloadsFallback: false`），不把清单丢进「下载」。
- **手动**：设置 → 外观的「重新连接」按钮（`lawmind:addin:sync-manifest`），这时才允许退到下载目录，让律师自己拖进 Word。

清单由**服务端按当前端口现场生成**（不是本地拼模板），端口与模板只有一处真相。Windows 上额外把清单路径登记进注册表（`HKCU\Software\Microsoft\Office\16.0\WEF\Developer`，只写当前用户）；WPS 一侧改的是 `jsaddons/publish.xml` 里 LawMind 那一条，别的插件原样留下。占位者是另一个 LawMind 时**不**改写任何清单，避免把 Word 指到这份多余实例——界面直接说「请改用已经打开的 LawMind。不要同时开两份。」

界面一侧（`WordAddinDoctorGroup`，设置 → 外观）：常驻两行，Word 与 WPS 各一。状态四种——`connected`（「Word 已连接。」）、`reopen`（「请完全退出 Word 后再打开。」）、`missing`（「这台电脑没有安装 Word。」）、`another-copy`（「请改用已经打开的 LawMind。不要同时开两份。」）；读不到配置时说「暂时看不清 Word 是否连着。」。**读到配置之前整组不渲染**（返回 `null`）——不闪一条「读取中…」占位，这是测试钉死的行为。写回成功后该行仍保持「请完全退出 Word 后再打开。」，直到下次启动清单端口与当前端口对上为止。所有说明都不带地址、不带文件路径。

## 13.10 其他壳内能力

| 模块                                                                             | 干什么                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `safe-shell-command.mjs`                                                         | 安全 shell 网关：白名单命令（`open` / `explorer` / `start` / `xdg-open`）、绝对路径校验、参数数组、审计到 `workspace/audit/desktop-shell-YYYY-MM-DD.jsonl`。「用 WPS 打开」走 `open -b com.kingsoft.wpsoffice.mac`（仅 macOS；找不到 WPS 就直接失败，不改用别的软件打开） |
| `import-dropped-files.mjs`                                                       | 把拖进来的文件收进工作区：单文件 200MB、单目录 200 个文件、深度 8、总量 500MB；粘贴图片另算，单张 20MB                                                                                                                                                                    |
| `picker-path-grant.mjs`                                                          | 记录律师在原生对话框里选过的目录（最多 64 个），渲染进程传来的路径必须匹配才放行                                                                                                                                                                                          |
| `host-access-store.mjs`                                                          | 本机文件夹挂载的持久化（`<userData>/LawMind/host-access.json`）；挂载上限 16 个（`lawmind:add-host-folder` 里判）                                                                                                                                                         |
| `workspace-volume.mjs`                                                           | 选中工作区之前报所在卷的事实：文件系统类型（Linux 读 `/proc/mounts` 最长挂载点）与剩余字节。只查询不判断，文案在渲染层                                                                                                                                                    |
| `authority-setup.mjs`                                                            | 「连接权威库」的保存计划：非秘密项写 `.env.lawmind`，令牌由调用方放钥匙串再抹明文；地址校验（必须 https、不许把令牌写进地址、拒绝回环/内网主机）                                                                                                                          |
| `lawmind-model-probe.cjs`                                                        | 保存设置前的内联模型探活（60s 超时），探不过就不写盘                                                                                                                                                                                                                      |
| `child-log-forward.mjs`                                                          | 子进程日志前转（`writeChildLog`）与 `ignoreBrokenPipe`：管道断了不把主进程带走                                                                                                                                                                                            |
| `officecli-runtime.mjs`                                                          | 定位 officecli 可执行文件：`LAWMIND_OFFICECLI` → 打包的 `resourcesPath/officecli/<平台-架构>/` → 仓库里的 vendor 目录                                                                                                                                                     |
| `renderer-recovery.mjs`                                                          | 渲染进程加载失败/崩溃时重试（最多 3 次，退避 400ms×n / 500ms×n；`errorCode -3` 的导航取消直接忽略），最终兜底显示一个说明页                                                                                                                                               |
| `server-supervision.mjs`                                                         | 本地服务崩溃监督：指数退避（基 500ms、系数 2、上限 30s、最多 5 次）。**正常停止不触发重启。**超过上限放弃并弹窗「LawMind 本地服务多次崩溃，已停止自动重启。」                                                                                                             |
| `mac-gatekeeper.mjs` + `after-pack-mac.mjs` + `after-all-artifact-build-mac.mjs` | macOS 签名与公证（见 13.11）                                                                                                                                                                                                                                              |
| `brand.mjs`                                                                      | 品牌读取（`branding/manifest.json`）                                                                                                                                                                                                                                      |

`safe-shell-command.mjs` 有一条注释：

> 独立文件，避免写入引擎哈希链日审计而把链打断。

桌面壳的记录单独写一个文件，不混进引擎那条按天追加的链。混进去会把链打断，排障时对不上。这份文件不是给律师看的质量证明。

## 13.11 打包与签名

打包流程（根目录 `pnpm lawmind:desktop:dist`，转发到 `apps/lawmind-desktop` 的 `dist:electron`）的顺序是固定的：

1. `bundle:server` → `server/dist/lawmind-local-server.cjs`
2. `vendor:node` → `resources/node-runtime/<平台-架构>/`
3. `vendor:officecli` → `resources/officecli/<平台-架构>/`
4. `build:renderer`（先建 canvas sandbox，再 `vite build`）
5. `electron-builder --publish never`

产物：macOS 出 `dmg` + `zip`，Windows 出 `nsis` + `portable` + `zip`，Linux x64 出 `AppImage` + `tar.gz`。mac 配置开了 `hardenedRuntime`，但 electron-builder 自己的 `notarize` 是关掉的——签名与公证走 `afterPack` / `afterAllArtifactBuild` 两个钩子（下面的 `mac-gatekeeper.mjs` 家族），这样能同时管住打包进来的 node 与 officecli 二进制。

### macOS 的两条硬规则

`mac-gatekeeper.mjs` 的头部注释讲清了签名状态和用户体验的关系：

> Browser-downloaded apps only double-click when signed with Developer ID Application and notarized. Adhoc (-) seals resources so a locally built app launches; it **does not** pass Gatekeeper after download.

翻译：**从浏览器下载的 app，只有 Developer ID 签名 + 公证过，才能双击打开。** 自签名（adhoc）只在本地能跑，下载之后会被 Gatekeeper 拦。

`after-all-artifact-build-mac.mjs` 里有一个开关 `LAWMIND_REQUIRE_NOTARIZED=1`：打开之后，如果 app 不是 Developer ID 签名，直接抛错：

```text
LAWMIND_REQUIRE_NOTARIZED=1 but LawMind.app is not signed with Developer ID Application
```

CI 的 tag 工作流就带着这个开关。没证书时它会诚实地失败，而不是出一个「看起来能发」的包。

相关凭据环境变量：签名身份可用 `CSC_NAME` 或 `LAWMIND_MAC_SIGN_IDENTITY` 显式指定（缺省自动挑钥匙串里的 Developer ID Application，找不到就退 adhoc）；`CSC_LINK`、`CSC_KEY_PASSWORD` 给 electron-builder 导证书；公证凭据三选一——`APPLE_KEYCHAIN_PROFILE`、`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`、`APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`。

### 自动更新

用 `electron-updater`，只在打包态启用（开发态返回 `null`）。默认开自动下载（`autoDownload`）、退出时安装（`autoInstallOnAppQuit`）。关闭开关是 `LAWMIND_SKIP_AUTO_UPDATE=1`。

菜单用中文（保存、另存为、显示、窗口）。正式安装包的「显示」里只有缩放（实际大小/放大/缩小）；重新载入和开发者工具只在未打包时出现。

「帮助」里是「检查更新…」和「下载安装包…」。后者打开的地址默认是 jsDelivr 上的下载页，可用 `LAWMIND_DOWNLOAD_PAGE_URL` 换。手动检查的四种结果各有一句话：有新版本——「发现新版本 X。将自动下载；下载完成后会通知您，退出应用时可完成安装。」；已最新——「当前已是最新版本。」；失败原因打日志，对话框只说「这次没能检查更新。请稍后再试，或从下载页获取安装包。」；开发版本——「这是开发版本，没有应用内更新。」应用内更新被关掉时说「应用内更新已关闭。请向管理员索取安装包」，不提环境变量名。

界面打不开时的兜底页只写「请退出 LawMind 后重新打开」，不带错误码，也不提开发服务。

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
| 法源设置           | `electron/authority-setup.mjs`                                                          |
| 工作区卷预检       | `electron/workspace-volume.mjs`                                                         |
| 模型探活           | `electron/lawmind-model-probe.cjs`、`wizard-model-store.mjs`                            |
| 子进程日志         | `electron/child-log-forward.mjs`                                                        |
| officecli 定位     | `electron/officecli-runtime.mjs`                                                        |
| 签名公证           | `electron/mac-gatekeeper.mjs`、`after-pack-mac.mjs`、`after-all-artifact-build-mac.mjs` |
| 文档               | `apps/lawmind-desktop/BRANDING.md`、`README.md`、`INSTALL.md`、`RELEASE-CHECKLIST.md`   |

## 13.13 已知坑

- **不要自动打开分离式 DevTools。** 关了它会触发 `window-all-closed`，可能连带杀掉本地服务，症状是主界面一堆 fetch 报错。
- **`window-all-closed` 不能直接杀服务。** 要过 `shouldKeepLocalServerAlive` 判断（有辅助窗口就得留着）。
- **不要改开发态 CFBundleIdentifier。** 改了会「换」用户数据目录，等于丢工作区和密钥。
- **生产环境不认 `LAWMIND_USER_DATA_DIR`。** 只有开发态生效，这是有意的。
- **可写根是白名单。** 新增根种类默认只读，要写必须显式加进 `WRITABLE_ROOT_KEYS`。
- **治理路径清单有两份镜像。** 改 `protected-workspace-rels.ts` 必须同步改 `fs-bridge.mjs`——**有守卫**：`electron/fs-bridge.test.ts` 会逐项比对拒写文案、机器码与可写根白名单，并对受保护路径做行为等价校验（见 29.22）。
- **治理保护不止前缀匹配。** `RULES.md` 等是任意深度保护，所以删除/改名目录会走进去扫描（20,000 节点上限，超限 fail-closed）；`audit`、`cases` 这类目录本身也受保护。别为了省事退回「只查路径字符串」。
- **「另存为」不是治理路径的后门。** 它故意不做根围栏（用途就是交到工作区外），但落到工作区内的治理路径会同口径拒绝。
- **本机文件夹不能改写。** 用「收进本案」复制到案件目录再改。
- **密钥链不可用时保存会失败，这是对的。** 不要为了「能保存」改成明文落盘（唯一的例外是权威法源令牌，理由与落点见 13.6）。
- **存完密钥链要抹掉 `.env.lawmind` 里的明文。** 环境变量优先级更高，不抹掉新密钥会被旧明文盖住。
- **凭据是派生的，不是随机的。** 排查「重启后 401」先看 `installationSecret` 和 `epoch` 是否一致，别去怀疑令牌过期。
- **端口变了会自己写回 Word 与 WPS 清单**（另一个 LawMind 占端口时除外）。界面不展示端口；请律师完全退出 Word 再打开。
- **Word 连接组读到配置前不渲染。** 别加回「读取中…」占位——测试钉死了「不闪一条占位内容」。
- **`unknown` 占位者和 `foreign` 不是一回事。** 探测不到就别说是外部程序。
- **macOS 未公证包从浏览器下载后双击打不开。** 要右键 → 打开；正式包必须签名+公证。
- **桌面壳的记录单独写文件。** 别并进引擎按天追加的链，会打断链。这份文件不进律师界面。
