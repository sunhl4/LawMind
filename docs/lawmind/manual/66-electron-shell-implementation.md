# 第 66 章 实现精读：桌面壳（进程、窗口、IPC 桥面）

第 13 章从架构角度讲了桌面壳。这一章讲 `apps/lawmind-desktop/electron/` 的实现：29 个非测试文件、约 6,800 行（其中 `after-pack-mac.mjs` 与 `after-all-artifact-build-mac.mjs` 两个打包钩子见第 67.8 节）。

这一章覆盖进程与桥面；端口、凭据派生与打包在第 67 章。

先把两个数说清（实测口径）：

- **IPC 桥面 43 个字面通道 = 40 个 invoke + 3 个推送**（`preload.cjs`；详见 66.6）。
- **`main.mjs` 的顶层启动是十三步**（详见 66.1）。

## 66.1 `main.mjs`：启动十三步

`main.mjs` **不导出任何东西**——它只有导入和顶层副作用。所以它不能被单测，只能整个跑。

### 十三步

```text
①  ignoreBrokenPipe(process.stdout) / ignoreBrokenPipe(process.stderr)
②  __dirname
③  appIconPath = resolveRuntimeAppIconPath(__dirname)
④  applyProductName(app)          ← app.setName + setAboutPanelOptions
⑤  pinDevUserData(app)            ← 钉住开发态 userData
⑥  模块状态：mainWindowRef / auxWindows / fsBridge
⑦  allowMultiInstance = !isPackaged && LAWMIND_ALLOW_MULTI_INSTANCE === "1"
⑧  singleInstanceOk = allowMultiInstance || app.requestSingleInstanceLock()
⑨  allowMultiInstance → 打警告
⑩  !singleInstanceOk → 打警告 + app.quit()
⑪  app.whenReady().then(...)
⑫  singleInstanceOk → 装 second-instance
⑬  singleInstanceOk → 装 window-all-closed / before-quit / activate
```

**第 ① 步是 stdio 护栏**：打包态 / 分离运行时 stdout 管道可能已关闭，`process.stdout.write` 会抛未捕获的 `EPIPE`，在 macOS 上表现为「主进程发生 JavaScript 错误」弹窗。`ignoreBrokenPipe` 只吞掉 `EPIPE` / `ERR_STREAM_DESTROYED` / `ERR_STREAM_WRITE_AFTER_END`，其它错误仍然打日志。

**第 ⑦ 步的两条边界**：多实例开关**只在非打包态**生效；打包版一律被忽略。

**第 ⑧ 步的写法**：`allowMultiInstance || requestSingleInstanceLock()` 是**短路**——所以开了多实例开关时**根本不请求锁**。

**锁的粒度是 userData 路径**，不是进程名。所以 E2E 用 `LAWMIND_USER_DATA_DIR` 给每个实例独立目录时，各自都能拿到锁——多实例开关只服务人工调试。

### 四个窗口尺寸常量

```text
width: 1280   height: 840
minWidth: 1024   minHeight: 720
```

而 `webPreferences`：

```text
contextIsolation: true
nodeIntegration: false
sandbox: app.isPackaged        ← 开发态关沙箱，打包态开
```

第三条有注释解释：

```text
// Dev (http://127.0.0.1:Vite): sandbox off avoids preload/contextBridge issues on some Electron+Vite setups. Packaged app uses file:// with sandbox on.
```

**「打包态开沙箱」**——所以生产环境的隔离更强。

窗口还固定了 `preload: <electron>/preload.cjs`（注释：CommonJS preload 比 `.mjs` 在各种 Electron 版本上更稳）与 `autoHideMenuBar: true`。所以菜单栏在 Windows/Linux 上默认隐藏，按 Alt 才出现；macOS 用系统顶栏。

### `whenReady` 里的七件事

开头还有一道早退：`if (!singleInstanceOk) return;`——第二个实例已经在顶层 `app.quit()`，这里不再装 handler、不起服务。

```text
①  mac 上 app.dock.setIcon(appIconPath)
②  installIpcHandlers()
③  setupApplicationMenu()
④  installAppRendererProcessGoneHandler(() => createWindow())
⑤  await createWindow()
⑥  非 E2E 且非跳过自动更新 → 12 秒后检查更新
⑦  catch：打日志 → 再试一次 createWindow → 还失败才 app.quit()
```

**第 ⑥ 步的条件是两项**：`LAWMIND_E2E !== "1"` **且** `LAWMIND_SKIP_AUTO_UPDATE !== "1"`。E2E 不检查更新，是为了不让测试进程去碰更新服务器。

**第 ⑦ 步的注释**：

```text
// Do not quit immediately — retry once so a transient Vite/port race does not kill the app.
```

**「Vite/端口竞态」**——开发态下 Vite 可能还没起来。**所以第一次失败不代表真的起不来。**

### `createWindow` 的十一步

```text
①  findReusableMainWindow() → 有就聚焦并返回（不重复建窗）
②  await ensureBackend()     ← 起本地服务；已经在跑则直接返回
③  new BrowserWindow(...)
④  installLawmindContentSecurityPolicy(session.defaultSession, { dev: !isPackaged })
⑤  mainWindowRef = mainWindow
⑥  on("closed") → 清 mainWindowRef
⑦  denyInAppWindowOpen(webContents)
⑧  denyUnexpectedMainWindowNavigation(webContents)
⑨  installRendererRecovery(win, reload 回调)
⑩  await loadRendererIntoWindow(win)
⑪  非打包且非 E2E 且 LAWMIND_DEVTOOLS=1 → openDevTools({ mode: "bottom" })
```

**第 ② 步在 `new BrowserWindow` 之前**——窗口出来时本地服务已经在监听，渲染层第一次 `/api/*` 不会撞上「连接被拒」。`ensureBackend()` 自己用 `serverStarted` 做幂等：热重载、`activate`、`second-instance` 都不会重复起子进程。

**第 ① 步「有就聚焦」实现了「重复点图标不重复开窗」。**

### 两道导航护栏

**第一道：`denyInAppWindowOpen`**

```text
// target=_blank / window.open to http(s) must open in the system browser, not an in-app window (often blank).
```

**注释说明了理由**：应用内开窗经常是空白的。所以一律 deny，交给系统浏览器。

**第二道：`denyUnexpectedMainWindowNavigation`**

```text
// will-navigate：同窗口导航可把远程页面装进带 preload 的主窗口（token + fs 桥随之暴露）。
// 只允许预期 origin（packaged file:// dist / dev Vite loopback 端口），其余一律拦下。
// 程序化 loadURL/loadFile 不触发 will-navigate，正常加载不受影响。
```

**这是本章最要紧的一条安全推理**：**远程页面进主窗口 = 它能用 preload**（拿到回环令牌 + 文件桥）。

而第三句解释了为什么加这道护栏不会影响正常加载：**程序化加载不触发这个事件**。

放行清单只有两种：

```text
打包态：file:// 下 dist 目录内
开发态：Vite 端口在回环上（localhost / 127.0.0.1）
```

### 那个 DevTools 陷阱

`window-all-closed` 里有个细节，`app-windows.mjs` 的头注释专门解释了：

```text
Detached DevTools is itself a BrowserWindow. Closing it can emit
`window-all-closed` even while the LawMind window is still up.
Killing the loopback API in that case leaves the main renderer failing
every `/api/*` call (JSON parse / fetch errors).
```

**「分离式 DevTools 本身就是一个 BrowserWindow」**——所以关掉它可能触发 `window-all-closed`，从而杀掉本地 API，**而主窗口还开着**。

所以判定被抽成一个纯函数：

```text
shouldKeepLocalServerAlive({ mainAlive, auxAliveCount, remainingAppWindowCount })
  主窗活着        → true
  aux 窗活着       → true
  还有别的应用窗口  → true
  否则            → false
```

**三级回落**——`remainingAppWindowCount` 兜住「既不是主窗也不是 aux 的应用窗口」；注意 `listAppWindows()` 已经先把 `devtools://` 窗口过滤掉，所以它**不**包含 DevTools。

而 `main.mjs` 顶部有一条注释把结论说清了：

```text
// Never auto-open *detached* DevTools: that window is easy to mistake for a
// new chat, and closing it can kill the local API (see window-all-closed).
// Opt-in docked tools: LAWMIND_DEVTOOLS=1. View → Toggle Developer Tools always works.
```

**「Never auto-open detached」**——所以自动开的是 `{ mode: "bottom" }`（底部停靠），而不是分离窗口。理由有两条：律师会把它误认成新对话；关掉它会杀掉本地 API。

那条注释最后半句「View → Toggle Developer Tools always works」**只在未打包时成立**：打包菜单的 `viewSubmenu` 不含 `toggleDevTools`（见 66.3）。

三个开关的完整边界：

| 场景                             | 自动开 DevTools？                   |
| -------------------------------- | ----------------------------------- |
| 打包版                           | 否（`app.isPackaged` 直接排除）     |
| 未打包 + `LAWMIND_E2E=1`         | 否（测试自己控制）                  |
| 未打包 + `LAWMIND_DEVTOOLS=1`    | 是，且 `mode: "bottom"`             |
| 未打包 + 未设 `LAWMIND_DEVTOOLS` | 否，但菜单「显示 → 开发者工具」仍在 |

**打包版的「显示」菜单只有缩放三项**（实际大小 / 放大 / 缩小），没有「重新载入」和「开发者工具」——见 66.3 的 `viewSubmenu` 条件。

### `second-instance` 为什么要聚焦

```text
// 第二实例被拒时 Electron 会带上它的 argv 触发这个事件 —— 用户以为「没打开」，
// 其实是已有窗口在后台。把它叫到前台，别让律师对着 Dock 反复点。
```

**「别让律师对着 Dock 反复点」**——这就是这个事件存在的界面理由。

而第二实例的行为有明确边界：

```text
// 第二个实例：不抢端口、不动共享的凭据文件，把已有窗口叫到前台后退出。
```

### `activate` 与 `window-all-closed` 各自的两条分支

`activate`（点 Dock 图标）：

```text
有可复用主窗 → 记回 mainWindowRef + 聚焦
否则若一个应用窗口都没有 → createWindow()
```

`window-all-closed`：

```text
shouldKeepLocalServerAlive(...) 为真 → 直接返回（不杀服务）
否则 → killLocalServer()
        非 macOS → app.quit()；macOS 保持进程活着（等 activate）
```

**macOS 不在 `window-all-closed` 里退出**是平台惯例；**非 macOS 必须显式 `quit`**，否则关掉最后一个窗口后进程会挂在后台，还占着已持久化的回环端口——那样下次启动就会被迫漂移。

### `before-quit` 两件事

```text
① killLocalServer()
② spawnWorkspaceDaemon()（try/catch 包着，注释：/* best-effort */）
```

**第 ② 步是「关掉桌面后还有人办事」的起点**（第 17 章那个守护进程）。而它是 best-effort——**起不来不该阻止退出**。

### `main.mjs` 里没有的东西（值得单独记）

| 没有                               | 说明                                            |
| ---------------------------------- | ----------------------------------------------- |
| `process.on("uncaughtException")`  | **不在这个文件**（服务端有自己的，第 63.10 节） |
| `process.on("unhandledRejection")` | 同上                                            |
| `dialog` 调用                      | 这个文件一次都没用                              |
| CLI 参数处理                       | 没有 `process.argv` 解析                        |
| 窗口控制（最小化/最大化/关闭）     | **用原生菜单 role**，不走 IPC                   |

最后一条很重要：**渲染层没有「关闭窗口」的 IPC 通道**——因为 macOS 的窗口按钮和菜单 role 已经够用。

## 66.2 渲染崩溃恢复：三次机会

`renderer-recovery.mjs` 只有两个导出，但它的策略很具体。

### 三条规则

| 事件                  | 处理                                        |
| --------------------- | ------------------------------------------- |
| `did-fail-load`       | 忽略 `-3`；重试上限 3 次；超限 → 显示兜底页 |
| `did-finish-load`     | **计数归零**                                |
| `render-process-gone` | 重试上限 3 次（独立计数）                   |

**两个计数器是分开的**（`failRetries` / `goneRetries`）——因为「加载失败」与「进程崩了」是两回事。

**`-3` 被忽略**，注释：`// -3 = ERR_ABORTED (often navigation cancel); ignore.`

**退避是线性的**（不是指数）：`400 × 第几次`、`500 × 第几次`。

### 归零的那一步

`did-finish-load` → `failRetries = 0`。

**为什么必要**：不归零的话，应用跑久了偶发失败会累积，最后撞到上限。**「连续失败三次」才是该显示兜底页的条件。**

### 兜底页

三次失败后加载一段内联 HTML：

```html
<h1>界面没有打开</h1>
<p>请退出 LawMind 后重新打开。</p>
```

错误码和「开发服务」只留在主进程日志里。兜底页不把排障词给律师。

它用 `data:text/html` 加载——所以**不需要任何文件系统访问**，在渲染层完全坏掉的情况下也能显示。

### 应用级的那条

`installAppRendererProcessGoneHandler` 监听 `app` 级的 `render-process-gone`，然后：

```text
有活的窗口 → 不管
没有活窗口 → createWindow()
```

**「一个窗口都不剩才重建」**——避免多窗口场景下的重复创建。

## 66.3 菜单：平台分叉与一条 IPC

`app-menu.mjs` 有六个导出，其中三个值得单独讲。

### 菜单树的两套

两份菜单的差别是一份很实用的「macOS 惯例对照表」：

| 项                  | macOS                                  | 非 macOS                  |
| ------------------- | -------------------------------------- | ------------------------- |
| 应用菜单            | `app.name`（about/services/hide/quit） | 无（`quit` 放在 File 里） |
| 编辑                | undo/redo/cut/copy/paste               | 同                        |
| 缩放（显示菜单）    | `resetZoom` / `zoomIn` / `zoomOut`     | 同                        |
| 重新载入/开发者工具 | 仅未打包时出现                         | 同                        |
| 窗口                | `minimize` / `zoom` / `front`          | `minimize` / `close`      |

**「非 macOS 没有应用菜单」**——所以 `quit` 挪进 File。这是 Electron 的标准做法。

**缩放三项两边都有**——`viewSubmenu` 是共享的；平台差别只在窗口菜单的最后一项（macOS `front` / 非 macOS `close`）与是否要应用菜单。

### 那个文件菜单 IPC

```text
「保存」      CommandOrControl+S      → send("lawmind:file-menu", { action: "save" })
「另存为…」  Shift+CommandOrControl+S → send("lawmind:file-menu", { action: "save-as" })
```

发送目标是：

```text
BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
```

**「聚焦窗口，否则第一个窗口」**——所以即使没有聚焦窗口，快捷键也不会丢。

**自定义 `click` 只有四处**：文件菜单的「保存」「另存为…」，帮助菜单的「检查更新…」「下载安装包…」。其余全部是 role——这是菜单的正确用法：**能交给系统的就交给系统**。

### 三条渲染层加载规则

`loadRendererIntoWindow(win, hash)` 的判定：

```text
useDistInE2e = LAWMIND_E2E === "1" && dist/index.html 存在
非打包 且 不是 E2E → 加载 Vite dev URL（带 hash）
否则              → loadFile(dist/index.html, { hash })
```

**E2E 走 dist 而不是 dev server**——注释说明了理由：**dev server 的输出不可预测，e2e 需要稳定的构建产物。**

### 自动更新的五个对话框

更新的每条路径都有对应文案：

| 情况       | 文案                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| 开发构建   | `这是开发版本，没有应用内更新。`                                            |
| 更新被关掉 | `应用内更新已关闭。请向管理员索取安装包。`                                  |
| 有新版本   | `发现新版本 <版本>。将自动下载；下载完成后会通知您，退出应用时可完成安装。` |
| 已是最新   | `当前已是最新版本。`                                                        |
| 检查失败   | `这次没能检查更新。请稍后再试，或从下载页获取安装包。`（原因只打日志）      |

**`loadAutoUpdater()` 在两种情况下返回 `null`**：非打包，或设了 `LAWMIND_SKIP_AUTO_UPDATE=1`。

而 `autoDownload = true` + `autoInstallOnAppQuit = true`——**所以是「静默下载，退出时装」**。文案里也这么说了。

### 下载页 URL 的默认值

```text
https://cdn.jsdelivr.net/gh/sunhl4/LawMind@main/apps/lawmind-desktop/download/index.html
```

**默认指向 CDN 上的一个静态页**，可用 `LAWMIND_DOWNLOAD_PAGE_URL` 覆盖。所以「下载安装包」这个菜单项不依赖应用内打包的页面。

## 66.4 CSP：开发态与打包态的差别

`session-config.mjs` 只有一个函数，但它装的是全应用唯一的 CSP。

### 十条 CSP 指令

| 指令          | 值                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `default-src` | `'self'`                                                                                          |
| `script-src`  | 打包 `'self'`；开发 `'self' 'unsafe-inline' 'unsafe-eval'`                                        |
| `style-src`   | `'self' 'unsafe-inline'`                                                                          |
| `img-src`     | `'self' data: blob:`                                                                              |
| `font-src`    | `'self' data:`                                                                                    |
| `connect-src` | 打包 `'self' http://127.0.0.1:*`；开发另加 `ws://127.0.0.1:* ws://localhost:* http://localhost:*` |
| `worker-src`  | `'self' blob:`                                                                                    |
| `frame-src`   | `'none'`                                                                                          |
| `object-src`  | `'none'`                                                                                          |
| `base-uri`    | `'self'`                                                                                          |

**`worker-src 'self' blob:` 是给 pdf.js 的**：它在 worker 里解析 PDF，`blob:` 覆盖 Vite 开发态创建的 worker，`'self'` 覆盖打包后从 dist 加载的 worker。少了这条，PDF 预览会静默失败。

**三处差别**：

1. **`script-src` 在开发态放开 `unsafe-inline` 与 `unsafe-eval`**，注释：`// Vite dev injects inline module scripts + uses eval for HMR; strict script-src breaks Electron white screen.`
2. **`connect-src` 打包态只放 `127.0.0.1`**，开发态另加 `localhost` 与 `ws`（HMR 需要）。
3. **`font-src` 与 `img-src` 都允许 `data:`**——这个有段注释专门解释：

```text
// 渲染器会把小字体内联成 data:（Vite assetsInlineLimit 默认 4KB）。
// img-src 已允许 data:，字体同样属于应用自带资源；不加 data: 会被 CSP 拦下，
// 用户侧表现为字体静默回退 + 控制台报错。
```

**「字体静默回退」**——一个很容易被当成「字体没装」的故障。

**`frame-src: 'none'` 与 `object-src: 'none'`** 是纯收紧（应用不用 iframe 与插件）。

### 打包态与开发态共享同一段代码

**唯一的开关是 `dev` 参数**——所以两套策略不会各自漂移。

## 66.5 品牌与 userData：一个 manifest 管全部

`brand.mjs` 的头注释定了一条规矩：

```text
Desktop product brand — reads apps/lawmind-desktop/branding/manifest.json.
Next rebrand: change the manifest (and icon files it lists), then
`pnpm lawmind:desktop:brand`. Do not scatter new product-name literals.
```

**「不要散落新的产品名字面量」**——所有产品名都从 manifest 读。

manifest 里有五样：`productName`、`appId`、`devUserDataFolder`、`icons`（5 个图标文件：窗口 PNG、打包 PNG、ICNS、ICO、SVG）、`svgCopies`（三处要同步的 SVG 副本）。

**唯一会抛错的情况**是 `productName` 缺失或非字符串。

### `pinDevUserData` 那条注释

```text
Keep unpackaged userData on the historical Electron folder so renaming CFBundleName / app.setName does not migrate workspace or .env.lawmind.
```

**「保持历史路径」**——因为改产品名会改变 `userData` 的默认位置，而那样工作区与 `.env.lawmind` 就找不到了。**所以开发态硬钉在 `<appData>/Electron`。**

### `lawmind-root.mjs`：那段「两条路都不通」的记录

这个文件只有 33 行，但它的头注释是全部 electron 文件里最有价值的一段：

```text
为什么需要显式覆盖：E2E 需要把应用状态（配置、`.env.lawmind`、Chromium profile/
localStorage）隔离到临时目录。两条路都不通：
  1. `--user-data-dir`：Playwright 的 `_electron.launch()` 固定把 `--inspect=0` /
     `--remote-debugging-port=0` 前置，而 Electron 只在它位于其它开关之前时才认，
     于是开关被静默忽略；
  2. `pinDevUserData` 本身在非打包时会 `setPath("userData", appData/Electron)`，
     无条件盖掉任何外部设置。
```

**两条路各有一个具体的技术原因**：

| 方案                           | 为什么不通                                                      |
| ------------------------------ | --------------------------------------------------------------- |
| `--user-data-dir`              | Playwright 会前置两个 `--` 开关，而 Electron 只在它排第一时才认 |
| 靠 `pinDevUserData` 之外的方式 | 它自己会无条件覆盖                                              |

**后果写得很具体**：应用会读到机器上真实的配置与 localStorage（首跑弹窗已 dismissed），且读不到夹具的 `.env.lawmind`——**「签批 bypass 缺失 → 403 checklist_bypass_forbidden」**。这是一条能追到具体错误的因果链。

所以第三条路是应用自己支持一个环境变量：

```text
LAWMIND_USER_DATA_DIR
```

**而结论是一句姿态声明**：

```text
且**打包版一律忽略**——与 `LAWMIND_SKIP_API_AUTH` 同一姿态：测试可隔离，生产不可被环境变量改状态。
```

**「同一姿态」**——这两件事（`SKIP_API_AUTH`、`USER_DATA_DIR`）的边界是同一条：**测试要能隔离，生产不许被环境变量改**。

`resolveDevUserDataDir` 三步：`packaged` → `null`；`override` 非空 → `path.resolve(override)`；否则 → `<appData>/<brandFolder || "Electron">`。

## 66.6 IPC 桥面：43 个通道（40 invoke + 3 推送）

`ipc-handlers.mjs` 有 1,408 行，但只有一个导出（`registerIpcHandlers`）。

先把三个数对齐，免得和 `preload.cjs` 对不上：

| 口径                                | 数量 | 含义                                                        |
| ----------------------------------- | ---- | ----------------------------------------------------------- |
| `preload.cjs` 的 `lawmind:*` 字面量 | 43   | 桥面全量                                                    |
| 其中的 `ipcRenderer.invoke`         | 40   | 渲染 → 主，`ipc-handlers.mjs` 里恰好 40 个 `ipcMain.handle` |
| 其中的 `ipcRenderer.on`             | 3    | 主 → 渲染的推送（见下）                                     |

所以 `ipc-handlers.mjs` 里 grep `lawmind:` 会得到 **41** 个字面量：40 个 `handle` + 1 个 `notification-click` 的 `send`。另外两个推送字面量在 `local-server.mjs`（`loopback-config`）与 `app-menu.mjs`（`file-menu`）。**43 = 40 + 3，两边不矛盾。**

**一句要紧的事实：40 个注册全是 `ipcMain.handle`，没有一个 `ipcMain.on`。**

所以 IPC 注册面是**请求-响应**式的；三条单向通道都是 `webContents.send`，不走 `ipcMain.on`。

### 按前缀分组的清单（16 组、40 条）

| 组             | 通道                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 配置           | `lawmind:get-config`                                                                                                                            |
| Word 插件      | `lawmind:addin:sync-manifest`                                                                                                                   |
| 更新与通知     | `lawmind:check-updates`、`lawmind:show-notification`                                                                                            |
| 工作区与项目   | `lawmind:pick-workspace`、`lawmind:pick-project`、`lawmind:pick-folder`、`lawmind:set-project-dir`、`lawmind:inspect-workspace-volume`          |
| 模型设置       | `lawmind:read-model-settings`、`lawmind:save-setup`                                                                                             |
| 自定义模型密钥 | `lawmind:save-custom-model-key`、`lawmind:delete-custom-model-key`                                                                              |
| MCP 密钥       | `lawmind:save-mcp-server-secret`、`lawmind:delete-mcp-server-secret`                                                                            |
| 密钥链         | `lawmind:keychain-status`                                                                                                                       |
| 检索开关       | `lawmind:set-retrieval-mode`、`lawmind:set-open-law-npc`                                                                                        |
| 权威库         | `lawmind:read-authority-settings`、`lawmind:save-authority`                                                                                     |
| 本机文件夹     | `lawmind:list-host-folders`、`lawmind:add-host-folder`、`lawmind:remove-host-folder`、`lawmind:bind-host-folder`                                |
| 文件桥         | `lawmind:fs:list` / `lawmind:fs:read` / `lawmind:fs:write` / `lawmind:fs:mkdir` / `lawmind:fs:rename` / `lawmind:fs:delete` / `lawmind:fs:copy` |
| 导入           | `lawmind:fs:import-dropped`、`lawmind:fs:import-pasted`                                                                                         |
| 对话框         | `lawmind:dialog:open-files`、`lawmind:dialog:save-text-file`                                                                                    |
| 系统打开       | `lawmind:open-external`、`lawmind:show-item-in-folder`、`lawmind:open-with-system`、`lawmind:open-with-wps`                                     |
| 辅助窗         | `lawmind:open-aux-window`                                                                                                                       |

**16 个组、40 条通道。** `lawmind:fs:*` 那七条仍是最集中的一组；`open-with-wps` 只服务 macOS 上的 WPS 加载项。

### `get-config` 返回的是「运行环境全貌」

这个响应值得单独看，因为界面判断连接状态只靠它：

```text
apiBase, apiAuthToken, loopbackPortDrift, addinHosts,
workspaceDir, projectDir, envFilePath, lawMindRoot, configPath,
retrievalMode, packaged, bundledServer,
nodeRuntimeKey, nodeExecutable, appVersion, downloadPageUrl
```

两处要点：

- `apiAuthToken` 是**渲染层自己的**凭据（clientId=`renderer`），安装密钥本身永不下发（第 67.4 节）。
- `addinHosts` 是 Word 与 WPS 的连接状态（`connected` / `reopen` / `missing` / `another-copy`），由主进程比对「清单里钉的端口」与「当前实际端口」算出；界面不显示端口号与占用者分类。

`preload.cjs` 里还有一个**非 IPC** 方法 `getPathForFile(file)`：先用 `webUtils.getPathForFile`，失败回退到旧的 `file.path`，给拖拽导入拿磁盘路径。

### 三条主进程 → 渲染层的通道

只有三条：

| 通道                         | 由谁发                                            |
| ---------------------------- | ------------------------------------------------- |
| `lawmind:loopback-config`    | `local-server.mjs` 的 `broadcastLoopbackConfig()` |
| `lawmind:notification-click` | 通知被点击                                        |
| `lawmind:file-menu`          | 菜单的保存/另存为                                 |

**三条里有两条是「用户动作的回传」**（点通知、点菜单），一条是「服务坐标变化」（第 67 章）。

**没有通用的 `sendToRenderer` 助手**——发送都是内联的 `webContents.send(...)`。

### 通知点击的三个原因（四个 reason）

```text
open_settings_collaboration                       去设置看协作
open_settings_workspace                           去设置看工作区
open_review + reviewTaskId + reviewMatterId       去审稿
open_workspace_chat + chatAssistantId + chatSessionId  去对话
```

`settingsSection` 只有 `workspace` 与 `collaboration` 两种，前者映射到 `open_settings_workspace`，其余一律 `open_settings_collaboration`。

**「点通知 → 直接落到对应界面」**——而载荷里带上目标 id，所以不用再查一次。

通知本身还有两个小边界：标题为空时回落到 `LAWMIND_PRODUCT_NAME`，正文截到 **512** 字；`Notification.isSupported()` 为假时返回 `{ ok: false, error: "notifications_not_supported" }`，不抛错。

### 那个例外：`pick-workspace` 不记路径授权

真正会调 `rememberPickerPath(picked)` 的只有两条：`lawmind:pick-project` 与 `lawmind:pick-folder`（对话框选完之后登记），**`lawmind:pick-workspace` 例外**。

**理由**：选工作区是「换整个工作区」，而路径授权是给「项目目录/本机文件夹」用的。**两者不是一回事。**

### 五处「重启本地服务」

五个通道会 `await restartBackendInternal()`：

```text
lawmind:save-setup            模型配置变了
lawmind:set-retrieval-mode    检索模式变了
lawmind:set-open-law-npc      法规库开关变了
lawmind:save-authority        法源地址/令牌变了
lawmind:set-project-dir       项目目录变了
```

而 `set-project-dir` 那条有注释说明：

```text
// Restart local API so LAWMIND_PROJECT_DIR and /api/fs/* match File Workbench.
```

**「重启是为了让环境变量与文件接口跟上」**——因为这两样都是启动时读一次。

**注意 `pick-workspace` 不在这个列表里**——它只返回路径，**重启发生在 `save-setup` 里**（那时才真的写配置）。

### 那个「唯一能绕过写保护」的通道

`lawmind:dialog:save-text-file` 上面有一段很关键的注释：

```text
// 另存为的用途是把内容交到工作区外（桌面/下载/文稿），所以不做根围栏；
// 但若律师恰好选到工作区内的治理/审计路径，必须与其它写入口同口径拒绝——
// 否则这是唯一一条能绕过 protected-workspace-rels 的写路径。
```

**「不做根围栏」是功能需求**（另存为就是要把文件交到工作区外），**但「治理路径仍要拦」是安全底线**。

判定方式：只在「目标相对路径落在工作区内」时才做治理路径检查。

**这条推理**：一个「故意不设围栏」的功能，会成为一个**绕过其他所有围栏的缺口**——所以必须单独补一处检查。

### 文件桥的七条错误码直通

`fsErrorResult` 会把 error 对象上的 `code` 透传：

```text
{ ok: false, code: e.code ?? undefined, error: e.message }
```

**为什么这要紧**：界面能据此区分「根不可写」（`root_not_writable`）与「治理路径」（`protected_workspace_path`），也能拿到 Node 原生的 `ENOENT` / `EACCES`——**不同拒绝给不同提示**，不用去猜中文文案。`outside_allowed_roots` 不在这条路径上：它来自 `show-item-in-folder` 自己的根守卫。

### Word/WPS 连接组：每次服务就绪都自愈

`restartBackendInternal()` 的最后两步是 `broadcastLoopbackConfig()` → `await ensureHostAddins()`。所以**每次服务就绪**（首次启动、换模型、换项目、换法源）都会重新登记加载项：

```text
syncWordAddinManifest({ downloadsFallback: false })
```

`downloadsFallback: false` 是自动自愈的关键：只写**真实存在**的 Word 容器（macOS `wef/`）或 Windows Word 目录，**绝不**在启动时往「下载」目录丢文件。若两者都没装，直接 `skipped: true` 返回。

两条来源不同的路径：

| 触发                 | `downloadsFallback` | 行为                                     |
| -------------------- | ------------------- | ---------------------------------------- |
| 服务就绪自动自愈     | `false`             | 只登记已安装的 Word / WPS；找不到就跳过  |
| 设置页点「重新连接」 | 默认 `true`         | 找不到宿主时退到「下载」，让律师自己拖入 |

手动按钮的标签就是 **「重新连接」**（`LawmindSettingsDoctorWordAddin.tsx`，`data-testid=lm-doctor-addin-resync`）。它在 `another-copy` 状态下**不渲染**——因为此时正确动作是「去用已经打开的那份 LawMind」，不是再写一份清单。

清单内容不是本地拼的：`syncWordAddinManifest` 从 `http://localhost:<当前端口>/word-addin/manifest.xml` **现场取服务端生成的清单**，这样端口与模板只有一处真相。WPS 走 `publish.xml`，只更新 `name="lawmind"` 那一条，其它加载项原样保留；Windows Word 另外登记 `HKCU\...\WEF\Developer`，不碰 HKLM。

`lawmind:open-with-wps` 只认 macOS：`/usr/bin/open -b com.kingsoft.wpsoffice.mac -- <路径>`，找不到 WPS 就报「请先安装 WPS，再用它打开这份文件。」，**不改用别的应用打开**。这条路径同样经过 `resolveFsPath(..., { access: "read" })`，所以只能开工作区/项目内的文件。

### 其余几条容易漏的行为

- **`inspect-workspace-volume`** 只查询不判断：返回 `fstype`（macOS `stat -f %T` / Linux `/proc/mounts`）、`driveType`（Windows PowerShell）与 `freeBytes`（`statfs`），文案判断留在渲染层。
- **权威库两条通道**：`read-authority-settings` 返回 provider（`pkulaw` / `open`）、两个端点、是否有令牌；`save-authority` 写 `.env.lawmind` 并重启服务。令牌默认进钥匙串（`authority.pkulaw.apiKey`）并从 env 抹掉明文；**钥匙串不可用是唯一的明文例外**——`placeAuthorityApiKey` 会把令牌写进 `.env.lawmind` 并 `chmod 0600`，否则设置页只能报「无法安全保存」而接不上法源。这条例外是刻意的（fresh clone / 无桌面会话的场景）。
- **本机文件夹上限 16 个**（`add-host-folder`），超出返回「本机文件夹已达上限」；删除一个挂载后 `projectDir` 回落到剩下的第一个。
- **`open-aux-window` 只认 `kind: "review-preview"` + `taskId`**：同 key 已存在则聚焦，否则按鼠标所在屏幕在 720px 宽、560–900px 高之间开窗；渲染页用 hash `lm-popout=review-preview&taskId=...`，`listAppWindows()` 靠 `lm-popout=` 把它从「主窗候选」里排除。
- **`show-item-in-folder` 有独立的根守卫**：只允许展示 workspace / project / 挂载根内的路径，否则 `outside_allowed_roots`；它不经过 `resolveFsPath`，所以单独补了这一道。
- **`fs:copy` 的源可以是只读根**（从挂载点复制进工作区是正当用法），目标必须是可写根，且**不覆盖已存在目标**（`destination already exists`）。
- **`fs:rename` 的 `from` 与 `fs:delete` 都按 `destructive: true` 判**：除保护路径本身，还要扫目标目录里有没有任意深度的保护文件（见 66.7）。
- **`fs:write` 对新文件会先 `mkdir -p` 父目录**；`fs:read` 对图片返回 `kind: "image"` + `mimeType` + base64 + `mtimeMs`，对二进制文本直接拒绝（`binary file is not editable in this view`）。

## 66.7 文件桥：十一步围栏

`fs-bridge.mjs` 是一份**纯 JS 镜像**——因为主进程是 `.mjs`，不能直接 import 引擎的 TS。头注释写明了同步义务：

```text
// ── 治理/证据面写保护（纯 JS 镜像） ──
// 规范实现：src/lawmind/runtime/protected-workspace-rels.ts（Electron 主进程为 .mjs，
// 无法直接 import TS）。修改该文件清单时必须同步修改此处。
```

**「必须同步修改此处」**——所以这是第 39 章那条「两处实现」的一个真实案例。

### 十一步围栏（`resolveFsPath`）

| #   | 检查                                     | 拒绝                                                   |
| --- | ---------------------------------------- | ------------------------------------------------------ |
| 1   | `access` 必须是 read/write               | `internal: resolveFsPath requires access: read\|write` |
| 2   | 写操作先过可写根白名单                   | `MOUNT_WRITE_REFUSAL` 或 `不可写的根：<key>`           |
| 3   | 根键形状（workspace / project / mount:） | `invalid root`                                         |
| 4   | 根存在                                   | `root not available: <key>`                            |
| 5   | 不许操作根本身（除非显式允许）           | `root path is not allowed for this operation`          |
| 6   | 无 `..`                                  | `path traversal is not allowed`                        |
| 7   | 字面在根内                               | `path escapes root`                                    |
| 8   | 工作区写操作的治理路径判定               | `protected_workspace_path`                             |
| 9   | 文件存在（若要求）                       | `path does not exist`                                  |
| 10  | realpath 仍在根内                        | `symlink escapes root`                                 |
| 11  | `destructive` 时扫描目录内容             | `protected_workspace_path`                             |

**第 6 与第 7 步的区别**：第 6 步拦字符串里的 `..`，第 7 步拦「`path.resolve` 之后跑出根」——两者都不需要读文件系统，但拦的写法不同。

**第 3 与第 4 步都来自 `assertRoot`**：先看键的形状，再看 `getAllowedRoots()` 里有没有这个键。`mount:*` 允许读，但写会在第 2 步被白名单拦下。

**第 8 步只对 `rootKey === "workspace"` 生效**：受保护清单是**工作区相对**的，`project` 与 `mount:*` 没有这套治理面。所以同一个相对路径在 `project` 根下可写、在 `workspace` 根下未必——这是有意的口径，与 `/api/fs/write` 一致。

**第 8 步先于第 9 步**：注释写明了理由——否则「该路径不存在」会盖掉「这是保护路径」，既泄漏存在性，又让错误契约随文件状态漂移。

**第 11 步放在第 10 步之后**：目录扫描要 `readdir`，必须先确认目标没有顺着软链逃出根，否则会去读根外目录。

**第 1 步那个「漏传则当场报错」是有意的**：

```text
/**
 * `access` 必填：调用点必须显式声明读还是写。写操作先过可写根白名单，
 * 这样新增写入口不会因为「忘了加校验」而默认放行；漏传则当场报错。
 */
```

**「漏传则当场报错」**——所以「忘了传 access」不会静默当成读（那会绕过风险判断）。

### 白名单而不是黑名单

```text
// ── 可写根白名单（fail-closed） ──
// 用白名单而非「root 以 mount: 开头」的否定式判断：新增根种类（如将来的 grant:）
// 默认只读，必须显式加入才能写，避免默默开出一个新写入口。
```

**「新增根种类默认只读」**——这是 fail-closed 的一个具体应用。

而挂载点只读的两条理由：

```text
// 挂载点（mount:<id>）只读：规范实现在
// src/lawmind/host-access/access-broker.ts 的 MOUNT_WRITE_REFUSAL（本机能力网关对挂载点
// 一律 write_forbidden）。桌面文件接口必须同口径，否则 /api/fs/write 与
// lawmind:fs:write 会开出一个与网关矛盾的写入口。
// 文件面板的 RootKey 只有 workspace | project，拒绝 mount:* 不影响任何已发布 UI 路径。
```

**「否则会开出一个与网关矛盾的写入口」**——不一致本身就是漏洞。而最后一句确认了**拒绝它不会破坏任何已发布功能**。

### 三组受保护路径

```text
EXACT_PROTECTED_RELS   = ["lawmind.policy.json"]
PROTECTED_REL_PREFIXES = ["lawmind/", "audit/", "sessions/", "tasks/", "matters/", "drafts/", ".git/"]
PROTECTED_BASENAMES    = [".lawmind-dms.json", "RULES.md", "ethics-wall.json", ".signing-secret"]
```

`.env` 与 `.env.*` 不在精确名单里，由 `isEnvSecretBasename` 按文件名拦截，**任意深度都算**（`.env`、`.env.lawmind`、`.env.local` 全拒）。写保护在「文件必须已存在」之前就判。

**匹配前先转小写**（大小写不敏感）——所以 `RULES.md` 与 `rules.md` 都被拦。

### 祖先目录与 20,000 节点上限

`isProtectedWorkspaceRel` 按 `audit/` 这种**带斜杠前缀**匹配，所以目录名本身（`audit`）不命中。而 `fs:delete` 是 `rm -r`、`fs:rename` 会移走整棵子树——删 `audit` 等于删掉整条审计链。所以另有 `isProtectedWorkspaceAncestor`：

```text
PROTECTED_TREE_ROOTS = 七个前缀去掉斜杠 + "cases"
```

`cases` 不在 `PROTECTED_REL_PREFIXES` 里（它不是治理面），但它是**案件卷**（`cases/<id>/CASE.md`、`RULES.md` 等结构文件），所以同样不许整卷删除/改名。

`RULES.md` / `ethics-wall.json` / `.lawmind-dms.json` 是**任意深度**保护，无法用前缀枚举。所以 `destructive: true` 时还要 `findProtectedEntryUnder` 递归扫目标目录：

```text
PROTECTED_SCAN_MAX_NODES = 20_000
```

**超过 20,000 个节点按「可能有保护文件」处理（fail-closed）**——宁可拒绝一次删除，也不放过一个删掉 `cases/<id>/RULES.md` 的机会。扫描只下钻真实目录，符号链接目录不跟进。

### 两个读上限

```text
MAX_TEXT_READ_BYTES  = 1000000（1 MB）
MAX_IMAGE_READ_BYTES = 12000000（12 MB）
```

**图片上限是文本的 12 倍**——因为图片要 base64 传，且律师需要看原图。

### 二进制判定

```text
前 min(长度, 4096) 字节里有 NUL 字节 → 二进制
```

**与第 63.3 节的 `isLikelyBinary` 是同一套判据**（那个也是 4096）。

### mtime 冲突的容差

```text
|先前 mtime - 期望 mtime| > 1 毫秒 → "file was modified externally"
```

**1 毫秒容差**——因为文件系统的时间精度不同（有的只到秒）。

### 八种图片 MIME

`.png` / `.jpg` / `.jpeg` / `.gif` / `.webp` / `.bmp` / `.svg` / `.ico`。

## 66.8 拖放导入：五条常量上限、一次 8 项与一个命名规则

`import-dropped-files.mjs` 的头注释一行为它定位：

```text
Copy lawyer-dropped files that sit outside the workspace/project into
`uploads/` or `cases/<matterId>/materials/` so chat tools can read them.
```

**「so chat tools can read them」**——所以这个功能的目的是**让对话里的工具能读到**。

### 五条常量上限 + 一条批次上限

| 常量                          | 值     | 作用域                      |
| ----------------------------- | ------ | --------------------------- |
| `MAX_DROPPED_IMPORT_BYTES`    | 200 MB | 单文件（拖入与整夹内都判）  |
| `MAX_DROPPED_DIR_TOTAL_BYTES` | 500 MB | 整夹累计                    |
| `MAX_DROPPED_DIR_FILES`       | 200 个 | 整夹文件数                  |
| `MAX_DROPPED_DIR_DEPTH`       | 8 层   | 整夹递归深度                |
| `MAX_PASTED_BYTES`            | 20 MB  | 粘贴图片（`const`，未导出） |
| `maxItems`（默认）            | 8 项   | 单次 `import-dropped` 批次  |

**没有扩展名白名单**——任何文件都收（只有体积与数量限制）。

整夹复制还跳过三类条目：**符号链接**（`ent.isSymbolicLink()` 直接 `continue`，防止借链接把根外内容卷进来）、`SKIP_DIR_NAMES` 里的目录、以及**任何以 `.` 开头的目录**。

### 十一个跳过的目录名

```text
node_modules  .git  .svn  dist  build  .next  coverage
__pycache__  .lawmind  .vite  release
```

**而任何以 `.` 开头的目录也跳过**——所以 `.git`、`.svn`、`.next`、`.lawmind`、`.vite` 这五条是冗余的，但写出来更明确（也让「哪些目录被跳过」不依赖那条通配规则）。

### 落在哪里

```text
有可用案件 id → cases/<id>/materials/<文件名>
否则          → uploads/<文件名>
```

`isUsableMatterId` 要求长度 2..128 且不含 `..` / `/` / `\` / `\0`。

### 命名冲突的规则

```text
report.pdf → report (1).pdf → report (2).pdf
```

**「空格 + 括号 + 序号」**——这是 macOS Finder 的风格（第 57.10 节那份 `allocateNonCollidingRelPath` 也是同样的后缀）。

### 那条最长的拒绝

```text
该文件夹与当前工作区互相包含，无法整夹复制。请在设置中把它加为本机文件夹，或只拖入其中的子文件夹。
```

**「互相包含」**是一种很难自己诊断的情况（把工作区的父目录拖进来）。所以文案给了**两条出路**。

### 部分导入的提示

```text
文件夹「<名>」未全部导入（超过数量或体积上限），已导入部分仍可阅读。
```

**「已导入部分仍可阅读」**——说明部分成功也返回成功（`ok: errors.length === 0`），不是整夹失败。

## 66.9 路径授权：会话内存

`picker-path-grant.mjs` 的头注释说明了它防什么：

```text
Session grants for directories the lawyer picked in a native dialog.
Renderer-supplied paths to set-project-dir / add-host-folder must match.
```

**「渲染层传的路径必须能对上」**——所以它的作用是：**渲染层不能凭空指定任意目录**，只能是「对话框刚选过的那个」。

| 属性     | 值                                     |
| -------- | -------------------------------------- |
| 存哪     | 模块级 `Set`（**不持久化**）           |
| 存多久   | 进程生命周期                           |
| 键是什么 | 规范化绝对路径 **+ realpath 两个都存** |
| 上限     | 64 条（FIFO 淘汰）                     |

**「两个都存」**是个细节：有的系统 `path.resolve` 与 `realpathSync` 结果不同（软链）。两个都登记，匹配时两种写法都能过。

三条拒绝文案：

```text
请用系统对话框选择文件夹。
invalid project directory
invalid folder
```

**第一条是给渲染层的**（说明正确做法），后两条是内部校验失败。

**测试用的 `resetPickerPathGrants()`** 也在导出里——所以这个模块是可测的。

## 66.10 安全命令网关：四条白名单

`safe-shell-command.mjs` 的头注释列了四条策略：

```text
- 命令白名单（仅 macOS `open`、Windows `explorer`/`start`、Linux `xdg-open`）
- 绝对路径校验，拒绝相对路径与路径穿越
- 参数数组化，禁止通过 shell 拼接
- 审计 `safe_command` 事件到 workspaceDir/audit/
```

**注意这里没有「黑名单」**——只有白名单。

```text
ALLOWED_OPEN_COMMANDS = ["open", "explorer", "start", "xdg-open"]
```

判定是 `path.basename(command).toLowerCase()`——**所以 `/usr/bin/open` 与 `open` 都过**（只取 basename）。

### 五条拒绝

```text
path required
path must be absolute
path contains traversal
command not allowed: <base>
unsupported command: <base>
```

**「path contains traversal」的触发条件要说准**：代码判的是 `path.normalize(trimmed) !== trimmed && normalized !== path.resolve(trimmed)`。对绝对路径而言，`..` 会被 `normalize` 与 `resolve` **同时**消掉，两者相等，所以这条**不会**因为含 `..` 而触发；它拦的是「归一化后既不是原串、也不是 resolve 结果」的写法。真正挡住根外访问的仍是调用方的 `resolveFsPath` 与 `show-item-in-folder` 的根守卫，不是这一条。

**命令判定只取 basename**：`path.basename(command).toLowerCase()`——所以 `/usr/bin/open` 与 `open` 都过。

### 那个「独立审计文件」的注释

```text
// 独立文件，避免写入引擎哈希链日审计而把链打断。
const filePath = path.join(auditDir, `desktop-shell-${todayAuditFileName()}`);
```

**「避免把链打断」**——这是附录 C 那条「三处独立审计」的落点之一：桌面壳的审计**不写进引擎的哈希链文件**，而是另起一个前缀。

而审计是尽力而为：

```text
/* 审计为尽力而为，失败不阻塞业务 */
```

**为什么可以这样**：因为这条链的失败不该阻止律师打开一个文件。

### 没有超时、没有上限

**这个文件没有超时常量，也没有字节上限。** 因为 `shell.openPath` 是「交给系统就返回」——**不等它打开完**。

## 66.11 密钥保管：用 safeStorage 而不是 keytar

`lawmind-key-vault.cjs` 的头注释说明了两个技术决定：

```text
Uses Electron's built-in safeStorage to encrypt secrets, which are then
persisted to a JSON file in the app's userData directory. This replaces
the deprecated `keytar` native module.
```

**「replaces the deprecated keytar」**——**用 Electron 自带的 `safeStorage` 替代了已废弃的 keytar 原生模块**。好处是不需要编译原生模块（打包简单）。

### 七个导出与八个账号名

`SERVICE = "ai.lawmind.desktop"`，存到 `<userData>/lawmind-secrets.json`。

八个账号（在 `local-server.mjs` 的 `KEYCHAIN_ACCOUNTS` 里定义；`customApiKey` 与 `mcpSecret` 是工厂函数，按 id 生成账号名）：

| 键                           | 账号格式                              |
| ---------------------------- | ------------------------------------- |
| `wizardApiKey`               | `wizard.default.apiKey`               |
| `webSearchApiKey`            | `wizard.webSearch.apiKey`             |
| `authorityApiKey`            | `authority.pkulaw.apiKey`             |
| `customApiKey(id)`           | `custom.<uuid>.apiKey`                |
| `mcpSecret(id)`              | `mcp.<id>.secret`（非法字符替成 `_`） |
| `auditChainKey`              | `audit.hashChainKey`                  |
| `mailSecretsKey`             | `mail.secretsKey`                     |
| `localApiInstallationSecret` | `localApi.installationSecret`         |

**八个账号分三类**：三个用户/法源填的密钥（前三条）、两个工厂账号（自定义模型与 MCP）、三个本地对称密钥（审计链、邮件、本机 API 根密钥）。`authority.pkulaw.apiKey` 是唯一的**明文例外**：钥匙串不可用时，`placeAuthorityApiKey` 会把令牌写进 `.env.lawmind` 并 `chmod 0600`，而不是拒绝保存（否则 fresh clone / 无桌面会话就接不上法源）。模型 Key 与 MCP 密钥没有这条例外。

### 落盘的三道保护

1. **坏库拒绝再写**：`lawmind-secrets.json` 解析失败时置 `storeCorrupt = true`，`readSecret` 返回空、`saveSecret` / `deleteSecret` 直接返回 `false`——避免拿一个空库覆盖落盘，把已存密钥冲掉。
2. **原子写 + 0600**：先写 `<file>.<pid>.tmp`（`mode: 0o600`），再 `renameSync` 覆盖，最后再 `chmod 0600`（某些文件系统不支持 chmod，内容已经换名落盘）。写失败会回滚内存里的改动，并删掉临时文件。
3. **空值即删除**：`saveSecret(account, "")` 委托给 `deleteSecret(account)`，避免「账号还在但值为空」的中间态。

### 一次性的 env → 钥匙串迁移

`maybeMigrateEnvKeysToKeychain(envPath)` 在**每次重启本地服务前**跑：

- 只处理两把键：`LAWMIND_AGENT_API_KEY`（或 `LAWMIND_QWEN_API_KEY`）与 `LAWMIND_AUTHORITY_API_KEY`。
- **只在钥匙串里还没有对应账号时**才写入——已有值不覆盖。
- 迁移后**不从 env 文件删键**：注释写明「Keys remain in the env file so restarts do not require re-entry.」所以老配置不会因为迁移而失效。

而 `save-setup` / `save-authority` 走的是相反方向：写进钥匙串之后，用 `writeLawmindEnvWithoutKeys` 把明文键从 `.env.lawmind` 抹掉——因为**env 文件的键会盖住钥匙串**（第 67.3 节那条优先级坑）。

### 安装密钥与 CLI 凭据文件

钥匙串里那把 `localApi.installationSecret` 是回环 API 的根密钥，三级回落（钥匙串 → `<userData>/LawMind/local-api-installation-secret` 0600 文件 → 进程内临时密钥）见第 67.5 节。

没有 IPC 通道的 CLI 走单独一份发现文件：`<userData>/LawMind/local-api-clients.json`（0600），只写 `cli` 一个客户端的派生凭据，退出时删除——**并且只删本实例写的那份**（比对 `instanceId`，防止先退出的实例把另一个正在用的凭据删掉）。

### 「不可用时必须拒绝保存」的姿态

头注释里那句是关键：

```text
All operations are best-effort: if safeStorage encryption is unavailable
(rare, but possible on some Linux configurations), `isAvailable()` returns
`false` and callers must refuse persisting new secrets (see main.mjs save-setup).
```

**「callers must refuse persisting new secrets」**——不可用时**拒绝保存**，而不是降级为明文。注释里写的 `main.mjs save-setup` 是旧位置；`save-setup` 的实际 handler 现在在 `ipc-handlers.mjs`。

而 `ipc-handlers.mjs` 里对应的两条拒绝：

```text
无法安全保存。请在系统设置里打开钥匙串后再试。
密钥链写入失败，已取消保存以避免明文落盘。
```

**第二条的「以避免明文落盘」是关键**——它说明了为什么宁可失败。

### 一条容易忽略的边界

`saveSecret(account, value)` 在 **value 为空**时不报错，而是**委托给 `deleteSecret(account)`**。

**所以「保存空值」等于「删除」**——这避免了「账号还在但值为空」这种中间态。

### `readSecret` 返回 null 而不是抛错

三个函数在不可用时的返回值：

```text
saveSecret → false
readSecret → null
listSecrets → []
```

**失败用返回值表达，不用异常**——调用方必须显式处理。

## 66.12 三个小工具

### `lawmind-model-probe.cjs`：一次最省的探测

它的头注释只有一句，但是一条维护契约：

```text
Minimal model reachability probe for the Electron main process.
Keep in sync with `src/lawmind/models/probe.ts`.
```

**「Keep in sync」**——又是一处必须手动同步的两份实现（第 55.6 节讲过引擎侧那份）。

探测参数是最省的：

```text
POST <baseUrl>/chat/completions
messages: [{ role: "user", content: "Reply with exactly: ok" }]
max_tokens: 8
temperature: 0
timeout: min(传入值, 60000)
```

**`max_tokens: 8` 与 `temperature: 0`**——探测只需要「通不通」，不需要质量。

六个错误码：

```text
missing_api_key      未配置 API Key
invalid_config       Base URL 与模型名不能为空
invalid_api_key      密钥无效或已过期（401 / 403，或响应体里认得出鉴权失败）
model_api_error      HTTP <状态>: <响应前 280 字>
model_timeout        模型请求超时（<ms>）。请检查网络或在 .env.lawmind 中增大 LAWMIND_AGENT_TIMEOUT_MS 后重启。
model_network_error  无法连接模型服务（<原因>）。请确认 Base URL：<url>，以及本机网络/代理/防火墙。
```

**`invalid_api_key` 是单独一条**：401/403，或 200 响应体里出现 `authentication fails` / `invalid api key` / `incorrect api key` / `unauthorized` 时都归到它，文案是「密钥无效或已过期。本机存过密钥不等于服务商接受。请到服务商重新生成，再用「连接向导」粘贴。」——**「本机存过不等于服务商接受」**正是这个错误最常见的误判。

**两条超时/网络错误都给了下一步动作**（改环境变量 / 查代理防火墙），且都**带上了耗时**。

还有两种「HTTP 200 但内容不对」的情况，由 `parseProbeErrorBody` 解析：

```text
响应体带 error 字段（字符串或 error.message / error.msg）→ 取前 280 字
响应体没有有效 choices                                  → 模型 API 返回 200 但无有效 choices，请检查模型名与 Key 权限
```

**「200 但无 choices」是一个很常见的误配症状**（模型名写错时有些网关就是这样回）。

这个探测是 `saveSetup` 的**写入前**预检：此时新 Key 还没写进 `.env.lawmind`、后端也还没带着新配置重启，所以不能走 `/api/models/test`（那只探得到旧配置）。写入后还有第二阶段 `postLocalModelTest`——两个检查点，不是重复。

### `officecli-runtime.mjs`：三级来源 + 空串兜底

```text
① LAWMIND_OFFICECLI 环境变量（且文件存在）
② 打包态：<resourcesPath>/officecli/<平台-架构>/<officecli|officecli.exe>
③ 开发态：<repoRoot>/apps/lawmind-desktop/resources/officecli/<平台-架构>/<名>
④ 都没有 → 返回空串
```

而 `applyOfficeCliEnv` 做两件事：设 `LAWMIND_OFFICECLI`，并把它的目录**前置进 `PATH`**。

**为什么还要改 PATH**：因为 officecli 可能自己调同目录的辅助程序。

`exists` 是个注入参数（默认 `fs.existsSync && !isDirectory`）——**所以可测**。

### `wizard-model-store.mjs`：五家服务商与十三个模型映射

```text
WIZARD_PROVIDER_BASES:
  deepseek  → https://api.deepseek.com/v1
  dashscope → https://dashscope.aliyuncs.com/compatible-mode/v1
  openai    → https://api.openai.com/v1
  moonshot  → https://api.moonshot.cn/v1
  zhipu     → https://open.bigmodel.cn/api/paas/v4
```

而「模型名 → 内置模型 id」的映射有十三项，其中三项是**别名**：

```text
deepseek-v4-flash           → builtin:deepseek-flash
deepseek-v4-flash-vision-exp → builtin:deepseek-flash
qwen-plus-latest            → builtin:qwen3.5-plus
```

**所以「模型名」与「内部 id」是两层**——第 55.3 节讲的四种 id 命名空间。

写入 `models.json` 时有一个「保留」规则（注释）：

```text
Keep custom models + verification records when the wizard writes defaultModelId.
models.json is schema 2 after the first successful POST /api/models/test.
```

**「向导只写 defaultModelId，不动自定义模型与验证记录」**——否则律师配好的自定义模型会被覆盖。

而 schema 兼容判定很窄：`schemaVersion` 是 1 或 2 **且** `customModels` 是数组，否则整个重置。解析失败被静默吞掉（`catch { raw = null; }`）。

## 66.13 已知坑（本章相关）

进程与窗口：

- **`main.mjs` 不导出任何东西**，所以只能整个进程跑（覆盖靠 e2e）。
- **`main.mjs` 里没有 `uncaughtException` / `unhandledRejection` 处理器。**它只给 stdout/stderr 装了 `ignoreBrokenPipe`（吞 `EPIPE` 一类流错误），这不是全局兜底。
- **单实例锁在 `LAWMIND_ALLOW_MULTI_INSTANCE=1` 时根本不请求**（短路），而且该开关**只在非打包态**生效。
- **锁按 userData 路径算**——E2E 的 `LAWMIND_USER_DATA_DIR` 隔离目录各自都能拿到锁，不需要多实例开关。
- **`activate` 与 `second-instance` 都是「有窗就聚焦、无窗才建」**；`second-instance` 在找不到可复用主窗时会 `createWindow()`，不是直接忽略 argv。
- **渲染层没有窗口控制 IPC**——用原生菜单 role。
- **分离式 DevTools 是一个 BrowserWindow**，关掉它可能触发 `window-all-closed` 杀掉本地 API；所以只自动开停靠式，且只在未打包、非 E2E、`LAWMIND_DEVTOOLS=1` 时。
- **打包版「显示」菜单只有缩放三项**，没有重新载入/开发者工具。
- **`window-all-closed` 的保活判定有三级回落**（主窗 / aux / 其他窗口）；非 macOS 在「不保活」时会显式 `quit`。
- **`will-navigate` 护栏的理由是「远程页面进主窗口会继承 preload」。**

CSP 与品牌：

- **CSP 一共十条指令**；`worker-src 'self' blob:` 是给 pdf.js 的，删掉它 PDF 预览会静默失败。
- **CSP 在开发态放开 `unsafe-eval`**（Vite HMR 需要）。
- **`font-src` 必须允许 `data:`**，否则字体静默回退（很像「字体没装」）。
- **`pinDevUserData` 硬钉在 `<appData>/Electron`**（保持历史路径）。
- **`LAWMIND_USER_DATA_DIR` 在打包版被忽略**（与 `SKIP_API_AUTH` 同一姿态）。
- **`--user-data-dir` 在 Playwright 下会被静默忽略**（前置开关导致）。

IPC 桥面：

- **43 个字面通道 = 40 个 `handle` + 3 个推送**；`ipc-handlers.mjs` grep 到 41 个，是因为其中一条是 `notification-click` 的 `send`。
- **只有三条主 → 渲染通道**（`loopback-config` / `notification-click` / `file-menu`），没有通用 `sendToRenderer` 助手。
- **`pick-workspace` 不记路径授权**；真正会记的只有 `pick-project` 与 `pick-folder`。
- **五个通道会重启本地服务**（模型配置、检索模式、法规库开关、法源地址/令牌、项目目录）。
- **`lawmind:dialog:save-text-file` 故意不做根围栏**，所以必须单独补治理路径检查（含祖先目录）——否则它是唯一能绕过写保护的路径。
- **`show-item-in-folder` 不经过 `resolveFsPath`**，所以它有自己的根守卫；漏掉它就能探测任意磁盘路径。
- **`open-with-wps` 只在 macOS 生效**，找不到 WPS 也不回退到系统默认应用。
- **`getPathForFile` 不是 IPC**：`webUtils.getPathForFile` 失败才回退到旧的 `file.path`。
- **自动登记加载项用 `downloadsFallback: false`**（只认真实 Word/WPS 容器），手动「重新连接」才允许退到「下载」。
- **`another-copy` 状态下「重新连接」按钮不渲染**——此时正确动作是去用已经打开的那份 LawMind。

文件桥：

- **文件桥是 TS 的纯 JS 镜像，必须手动同步**（`src/lawmind/runtime/protected-workspace-rels.ts`）。
- **`resolveFsPath` 是十一步围栏**，不是九步；治理路径判定（第 8 步）先于「文件必须存在」（第 9 步）。
- **写保护只对 `workspace` 根生效**；`project` 与 `mount:*` 没有这套治理面。
- **`access` 参数漏传会当场报错**（不许默认成读）。
- **可写根是白名单**，新增根种类默认只读。
- **挂载点一律只读**——否则会与引擎网关的 `write_forbidden` 矛盾。
- **`.env` / `.env.*` 是任意深度拒写**，不在精确名单里，按 basename 判。
- **删除/改名要连祖先目录一起拒**（`audit`、`sessions`、`cases` 等整棵子树），且目录扫描上限 20,000 节点，超限 fail-closed。
- **治理路径匹配大小写不敏感。**
- **mtime 冲突容差是 1 毫秒。**

拖放、授权与命令：

- **拖放导入没有扩展名白名单**，只有体积/数量/深度上限。
- **一次最多处理 8 项**；单文件 200 MB、整夹 500 MB、200 个文件、8 层；粘贴 20 MB。
- **整夹复制跳过符号链接**，也跳过所有 `.` 开头的目录。
- **路径授权不持久化**（进程内 `Set`，上限 64，FIFO）。
- **安全命令只有四条白名单，没有黑名单。**
- **`path contains traversal` 对绝对路径里的 `..` 不触发**（normalize 与 resolve 同时消掉）；真正的根外访问由 `resolveFsPath` 与根守卫挡。
- **桌面壳审计写在独立文件里**（`desktop-shell-<日期>.jsonl`，避免打断引擎哈希链）。

密钥与探测：

- **密钥链不可用时拒绝保存模型/MCP 密钥，而不是降级明文**；唯一例外是 **`authority.pkulaw.apiKey`**（钥匙串不可用时写 `.env.lawmind` 并 `chmod 0600`）。
- **`saveSecret` 传空值等于删除。**
- **坏库拒绝再写**（`storeCorrupt`），避免空库覆盖把已存密钥冲掉；写入是 `tmp + rename` 且 0600。
- **env → 钥匙串的迁移只在目标账号为空时写**，且不删 env 里的键；而向导保存会反向删掉明文键（因为 env 覆盖钥匙串）。
- **安装密钥与 CLI 凭据文件都在 `<userData>/LawMind` 下，不在工作区**；CLI 文件退出时按 `instanceId` 只删自己那份。
- **模型探测与引擎侧是两份实现**（`src/lawmind/models/probe.ts` 与 `lawmind-model-probe.cjs`）。错误体解析和 401/403 的「密钥无效」文案必须一起改。
- **探测有六个错误码**，`invalid_api_key` 与 `model_api_error` 不是一回事。
- **`lawmind-secrets.json` 存在 userData 下**（不是 keychain 本身，而是 safeStorage 加密后落在这个文件）。
- **向导只写 `defaultModelId`**，不动自定义模型与验证记录。
