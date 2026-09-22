# LawMind Word 插件（就地审查）

Word 里「审这份、改这份、导出去」，只与本机 LawMind 通信。对标 Spellbook 的 Word 原生形态，
但不引任何远程控制面：插件页面由本机 LawMind 服务在回环地址上提供，数据面也只打回环 API。

## 它做什么

| 动作           | 走的东西                                  | 结果                                                         |
| -------------- | ----------------------------------------- | ------------------------------------------------------------ |
| 审这份         | `POST /api/word-addin/reviews`            | 本机建一条请求；桌面端**自动取件开跑**（`queued → running`） |
| 取回           | `GET /api/word-addin/reviews/:id`         | 拿回带修订轨的产物路径 + 可就地落改的最短锚点                |
| 选案卷（可选） | `POST /api/word-addin/reviews/:id/matter` | 只想把这次改稿记到某个案卷名下时才需要；不选也照跑（ad-hoc） |
| 案卷表         | `GET /api/word-addin/matters`             | 窗格下拉用的 `{ matterId, title }` 列表（不含案卷正文）      |
| 改这份         | Word.js `Word.run` + 打开修订轨           | 在**当前文档**里落成 Word 原生修订轨，逐处可接受/拒绝        |
| 导出           | `POST /api/word-addin/reviews/:id/export` | 指向桌面端已写出的审阅稿（与源文件同目录）                   |

审查本身由桌面端 LawMind 执行（`apply_surgical_edits` → `render_tracked_draft`）。
插件不自己下结论，也不自己算 diff：拿不到最短锚点的整节重写会如实计成
`skippedSectionHunks`，提示律师回桌面端看。

## 侧载（sideload）

1. 起桌面端（`LawMind.app` 或 `pnpm lawmind:desktop`），确认本机服务在跑。
2. 从本机服务取清单：浏览器打开 `http://localhost:<实际端口>/word-addin/manifest.xml`（端口见桌面端「设置 → 体检 → Word 加载项」里的本机 API 地址）。

   > **清单里的地址按请求的实际 `Host` 现场替换，但侧载之后就钉死了。**
   > 所以端口是**持久化契约**的一部分：只要服务换了端口，已侧载的窗格就够不着，
   > 必须用当前端口**重新生成并重新侧载**（设置 → 体检 → Word 加载项 →「重新侧载 Word 清单」）。
   > 别把「清单填好了」当成「一劳永逸」。
   >
   > 端口变化主要有两个来源：与其它程序撞端口（app 会回退到随机端口并在体检里报警），
   > 以及**同时开了两个 LawMind 实例**（第二个实例会抢不到端口）。后者现已由单实例锁挡住；
   > 开发态确实要开两个时用 `LAWMIND_ALLOW_MULTI_INSTANCE=1`。

3. 把取到的 `manifest.xml` 存成文件后侧载：
   - **macOS / Word**：`~/Library/Containers/com.microsoft.Word/Data/Documents/wef/`，
     放入 `lawmind-word-addin/` 目录下的 `manifest.xml`，重启 Word。
   - **Windows**：在「文件 → 选项 → 信任中心 → 受信任的加载项目录」共享目录里放清单，
     或在 Word 里插入 → 我的加载项 → 上传我的加载项。
4. Word 打开任一份 `.docx` → 加载项「LawMind 就地审查」→ 任务窗格出现。

### 窗格报「无法加载该加载项」时怎么判

**一定要用 `localhost` 取清单**，不要用 `127.0.0.1`：两者在 Office 里不是一回事
（社区多次报告 `127.0.0.1` 取清单/开页面失败），而且本机服务原先只绑了 IPv4——
`localhost` 会先解析到 `::1`，那条路以前是死的。

看本机服务 stderr（`pnpm lawmind:desktop` 的那个窗口）有没有这一行：

```
[word-addin] GET /word-addin/taskpane.html host=localhost:<port> remote=::1 (ipv6) ua="…Word…"
```

- **有这行**：Word 的 webview 确实来取过页面了，问题在页面内部（CSP / Office.js / 初始化超时），
  这时才该去动 `taskpane.html`、`config.js` 这些。
- **没有这行**：Word 根本没发出请求 → 问题在 URL 层面（方案或主机名不被接受），
  页面里改什么都白改。下一步是上 `https://localhost:<port>` + 本机证书。

**别把「清单填好了」当成「链路通了」**：只看窗格文案会一直误判（那句「请确保您具有网络和/或
Internet 连接」看起来像断网，实际是来源被拒）。上面这一行日志是唯一能自证的事实。

## 发起之后：桌面端**自动**跑这次审查

「审这份」只做两件事：把当前文档的**本机路径**登记成一条请求，并让插件开始轮询。
**律师不需要再回桌面端做任何事**：本地服务取件后自动跑同一套
`apply_surgical_edits` → `render_tracked_draft`（同一套审批与门禁），完成后结果自动回填：

- 取件时写一条**授权留痕**（`authorization`）：谁（actorId）、哪个文件、点击时的内容指纹、
  授予了哪个本机目录、记到哪个案卷、什么时候。Word 里那次点击**就是**授权动作。
- 桌面端对**同一个文件**导出带修订轨的审阅稿时，`render_tracked_draft` 会把产物路径与
  最短锚点回填给请求（`src/lawmind/integrations/word-addin/attach-result.ts`）。
- 插件轮询到 `ready` 后，「改这份」把锚点落成 Word 原生修订轨。

### 为什么这里可以自动跑（修正此前文档的说法）

此前本文写的是「那一步会触发写侧工具链，属于审批面，插件绕过等于绕过审批」——**这个说法在本仓库不成立**。
`toolRequiresExplicitApproval`（`src/lawmind/agent/dangerous-tool-policy.ts`）只对
`toolRequiresLawyerPause` 命中的工具返回 true，而那只包含 `send_email`。也就是说
`apply_surgical_edits` / `render_tracked_draft` / `update_draft` 本来就不需要律师二次点击，
`lawyer_approved_write` 是**审计分类**，不是交互闸门。邮件短路径
（`mail-contract-redline` 的 `redline` 步，`autoApprove: true`）早就把同一条链无人值守地跑过了。

所以真正缺的从来不是「审批」，而是两份契约，现在由 `src/lawmind/integrations/word-addin/auto-run.ts` 补上：

| 缺的东西                               | 现在怎么解                                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 这份本机文件属于哪个案卷               | 请求带的 `matterId` → `cases/<id>/`、`matters/<id>/` 路径推断 → 都不成立就**ad-hoc 直跑**（`source: "adhoc"`）。改稿链本身不需要案卷（不碰 `MATTER_SCOPE_REQUIRED` 的任何工具），产物仍写源文件同目录；窗格下拉只用于「可选记到案卷」 |
| 工作区外的文件凭什么能读、能写回同目录 | **只对工作区外的文件**，取件时把源文件所在目录作为本次运行的 `projectDir`（本机文件夹），仅本次运行、并写进授权留痕；不改原件，只写同目录 `原名_日期_01.docx`。工作区内文件不额外挂载，免得行为与桌面回合不一致                       |
| 点了很多次                             | 创建时折叠同文件同指令（10 分钟窗口）；取件时再折一次同口径的 `queued`。**绝不折叠 `running`**：那笔已付费，结果必须回到律师手上                                                                                                      |
| 点击到取件之间文件被改了               | 取件时重算指纹（前 256 KiB + 字节数），不一致转 `stale`，绝不用旧基线出稿                                                                                                                                                             |
| 两条请求争同一个 draft                 | 取件串行：一次只领一条（模块级串行闸）                                                                                                                                                                                                |
| 任务失败/取消/降级导出后没人回填       | 每个 tick 先跑一次孤儿清理：`running` + 任务已终态（或记录消失超 30 分钟、或压根没记下 jobId）就如实转 `failed`——不然请求会永远「正在审查…」                                                                                          |

开关：edition feature `wordAddinAutoRun`（**solo 默认开**，firm / private_deploy 默认关，
律所版保留「桌面端必须有一次显式动作」的档位），现场可用 `lawmind.policy.json` 的
`wordAddinAutoRun` 覆盖（注意：policy 文件必须带 `schemaVersion: 1`，否则整份文件会被忽略）。
插件通过同源 `/word-addin/config.js` 的 `autoRun` 拿到同一个口径，据此选文案——
关掉时窗格写「请在桌面端跑这次审查」，不会假称「正在自动审查」。
**关掉即退回原人工档**：插件只登记请求，由律师在桌面端对同一份文件跑一次审查，行为与从前逐字一致
（孤儿清理仍会跑，但它对人工档的请求是空操作）。

### 出稿后的两道复核（无人值守也看得见）

1. **最短改动**：引擎在落盘前已把每处 hunk 重算成多段最短 op（只标真正变动的字）；导出后还会读
   实际 `word/document.xml`，检出「删/增相邻且几乎同句」的修订对（`xml_qa_non_minimal_edits`）——
   那正是多人协作时最难受的「整句删+整句增」，命中即不当作已完成。口径见
   [LAWMIND-MINIMAL-EDITS.md](LAWMIND-MINIMAL-EDITS.md)。
2. **独立审稿（Guardian）**：缺省随 edition——solo 档 `advisory`（审稿照跑，缺口如实写进窗格那句话，
   不阻断出稿；否则「审稿 2 轮未过」会让整条无人值守改稿断掉，律师只看到「没有结果」）；
   firm / private_deploy 档 `block`（审稿不过就不出稿）。可用 policy `guardianTrackedRedline` 或
   `LAWMIND_GUARDIAN_TRACKED_REDLINE` 覆盖任一方向。

### 请求状态

| 状态           | 含义                                                                  | 律师要做什么                                 |
| -------------- | --------------------------------------------------------------------- | -------------------------------------------- |
| `queued`       | 已登记，等取件                                                        | 无（窗格会在 1 秒内看到 `running`）          |
| `running`      | 桌面端正在跑                                                          | 无；可以关掉窗格                             |
| `needs_matter` | 旧状态：路径对不到唯一案卷时曾停住等选案卷                            | 现改为 ad-hoc 直跑，不再用这个状态拦人       |
| `stale`        | 文件在点击后被改动                                                    | 重新点「审这份」                             |
| `superseded`   | 同文件重复点击，已被更新的那条取代                                    | 无（已在跑的那条不受影响，结果照常回来）     |
| `ready`        | 拿到锚点与产物                                                        | 点「改这份」落成 Word 修订轨，或「导出产物」 |
| `failed`       | 失败（源文件被移动/删除、任务失败或被取消、降级导出没有可回填的锚点） | 看窗格里的原因                               |

## 边界（诚实说明）

- **只走回环**：插件页面与数据面都指向 `http://localhost:<port>` / `http://127.0.0.1:<port>`。
  列表、产物路径、锚点都存在本机 `workspace/lawmind/word-addin/reviews.json`，不上传。
- **重开接得回**：Word 关掉再开、或窗格重载时，`GET /api/word-addin/reviews?path=…` 会接回
  这份文档最近一次的请求与结果，不必再点一次「审这份」。
- **本机目录授权只给本次运行**：源文件在工作区外（桌面/下载目录）时，取件把**源文件所在目录**
  作为本次运行的 `projectDir`（本机文件夹语义），用来读原件、并把审阅稿写在同目录；不写成常驻
  挂载，也不动原件。授予了哪个目录记录在 `authorization.grantedDir`。
- **自动取件不是「绕过审批」**：唯一会打断律师的工具是 `send_email`；Word 里那次点击就是授权
  动作，并写成 `authorization` 留痕。`stale` / `superseded` 等状态都只如实回报，
  不猜、不静默重试。
- **落改失败就不改**：锚点多处命中、锚点找不到、或该 Word 版本不支持 `changeTrackingMode`，
  都**不落改**并如实回报——绝不静默改成无痕迹编辑。
- **Word.js 是队列式 API**：属性/集合必须先 `load()` + `context.sync()` 才能读（不 load 就读，
  Word 会直接抛「属性…不可用」——真机实测踩过一次）。落改顺序固定为：load 修订轨设置 → sync
  → 打开修订轨 → sync → 逐个锚点 search/load/sync → 恢复律师原本的修订轨设置 → sync。
  这条顺序由 `apps/lawmind-desktop/src/renderer/word-addin-taskpane.test.ts` 用**假 Word** 守住
  （读未 load 的属性会抛真机同款错误，改错必挂）；任务窗格在 `config.testHook === true` 时
  才暴露内部函数给该测试，生产配置不设。
- **凭据怎么下发**：页面由本机服务渲染，但凭据**不能写在页面里的内联 `<script>`**——Word
  任务窗格启用 CSP，`script-src` 会把内联脚本拦掉，结果就是 base 与凭据都为空、所有请求 401
  （2026-09-20 真机实测踩到）。所以凭据走**同源** `/word-addin/config.js`（`'self'` 本来就放行），
  且必须先于 `taskpane.js` 加载；页面本身不含凭据。数据面（`/api/word-addin/*`）照旧要求
  `Authorization: Bearer`，与桌面端其它本地 API 同一把锁。
  - `config.js` 现在下发的是**本插件专属凭据**（`clientId: "word-addin"`），不是全局共享令牌 ——
    它随安装密钥持久，所以**桌面端重启后窗格仍然可用**；同时服务端据此做审计归属与最小权限，
    插件只能碰 `/word-addin/*` 与 `/api/word-addin/*`。
  - 同一份载荷还带 `epoch` 与 `instanceId`（供窗格做陈旧检测）。
  - **401 自愈**（2026-09-21）：窗格收到 401 会重取一次同源 `config.js` 换上新凭据，然后
    **重放一次**原请求；并发 401 共享同一个 in-flight 刷新。只重放一次是刻意的 —— 换完还是
    401 说明凭据被吊销或服务已不是同一实例，此时如实上报并给出动作，而不是静默重试。
    模型与运维细节见 **`LAWMIND-LOCAL-API-AUTH.md`**。
- **Office.js 例外**：`office.js` 本身来自微软的加载项 CDN（Word 首次加载后会缓存），
  这不是 LawMind 的控制面，也不影响「LawMind 侧不联网」的判断。
- **插件一直加载不出来的真因在 URL 层面，不在页面里（2026-09-20 更正）**：
  此前这里写的是「Word 对任务窗格页面通常要求 https，但 `http://localhost` 在其允许范围内」，
  并据此把插件加载失败归到别处（令牌、端口、取件队列都改过一遍）。核对下来的事实是：
  - **页面这一侧是好的**：`/word-addin/taskpane.html|taskpane.js|taskpane.css|config.js|icon-32.png|manifest.xml`
    在本机全部 200，端口与侧载清单一致，CSP/同源 `config.js` 也在位。
  - **Word 的 webview 根本没发出请求**：窗格报错时本机服务侧没有任何来自 Word 的连接；
    Word 诊断日志里只有 `Office.Extensibility.Sandbox.*` 的激活心跳，没有任何页面加载记录。
  - 也就是说：错误出在「Word 取这个 URL」这一步，而不是页面内容（否则会渲染出我们的 UI）。
  - 侧载清单当时用的是 **`http://`**。Office 宿主要求插件页面来自受信任的安全来源
    （微软 `generator-office` 的 ssl 文档：「Office clients require add-ins and webpages to come from
    a trusted and secure location」），而把清单里的地址写成 http 时，Word 报的**正是**截图里那句
    「很抱歉，无法加载该加载项。请确保您具有网络和/或 Internet 连接」——看起来像断网，其实是来源被拒。
    微软自家脚手架（Yeoman + `office-addin-dev-certs`）也一直用 `https://localhost:3000`。
  - 状态：**尚未在本机 Word 上证实**（下一步先做零证书的 `http://localhost` 探针，证伪再上
    `https://localhost` + 本机证书）。在证实之前，别把「清单填好了」当成「链路通了」。
    自证方式：看本机服务 stderr 有没有 `[word-addin] GET /word-addin/taskpane.html …` 这一行——
    没有这行就说明 Word 没来取页面，问题在 URL 层面。
- **回环要两个协议族都听**：`localhost` 在 macOS 上同时解析到 `::1` 与 `127.0.0.1`，
  而 WebKit（任务窗格）多半先试 `::1`。本机服务原先只绑 `127.0.0.1`，用 `localhost` 打开的客户
  会直接连不上（同样报「无法加载该加载项」）。现在 `127.0.0.1` 与 `::1` 都听，仍是回环、不对局域网暴露。
- **端口漂移会让窗格失联（2026-09-21 实测，两个阶段都踩到）**：清单把端口钉死，而 app 在
  持久化端口被占时会**静默**回退随机端口（见 §侧载的说明）。现场表现会误导人——
  先是窗格报 `unauthorized`（持有派生改造之前的旧凭据），服务换端口后变成 `Load failed`
  （网络错误）。两者都看不出真因。现在：
  - 漂移会在「设置 → 体检 → Word 加载项」里以警示形式出现，并写明被谁占用
    （另一个 LawMind 实例 / 其它程序）；
  - 提供「重新侧载 Word 清单」按钮，用当前端口重新生成并装回 Word 的侧载目录
    （macOS 上直接写 `~/Library/Containers/com.microsoft.Word/.../wef/lawmind-word-addin/`；
    没装 Word 时退到下载目录让律师自己拖）；
  - 根因治理：**单实例锁**（`app.requestSingleInstanceLock()`）——第二个实例不再能抢走端口。
    开发态要开两个实例用 `LAWMIND_ALLOW_MULTI_INSTANCE=1`（会打警告）。
  - 注意：发现端点（`/.well-known/lawmind-local`）**救不了端口变化**——它也挂在同一个 base 上，
    base 一过期连它都到不了。它只能救「令牌变了而地址没变」。
- **整节重写不上插件**：Word 里就地落改只做最短锚点；整节级重写需要看上下文，留在桌面端审阅。
- **锚点必须唯一命中**：同一锚点在文中出现多处于插件侧不落改，如实回报，交回桌面端处理。

## 相关代码

| 位置                                                              | 作用                                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/lawmind-desktop/resources/word-addin/`                      | 清单模板 + 任务窗格（html/js/css，含可选「记到案卷」下拉）                             |
| `apps/lawmind-desktop/src/renderer/word-addin-taskpane.test.ts`   | 假 Word 驱动的任务窗格回归（load/sync 顺序、多处命中不落改）                           |
| `src/lawmind/integrations/word-addin/review-requests.ts`          | 请求模型、存储、锚点推导、指纹/去重/取件（`claimWordAddinReviewForRun`）、资源路径校验 |
| `src/lawmind/integrations/word-addin/auto-run.ts`                 | 案卷解析规则、是否需本机目录授权、Word 改稿指令与固定流水线、授权留痕（纯决策层）      |
| `src/lawmind/integrations/word-addin/attach-result.ts`            | 渲染完成后回填结果（闭环最后一段）                                                     |
| `apps/lawmind-desktop/server/lawmind-server-word-addin-runner.ts` | 自动取件：孤儿清理、串行领一条、过期/案卷/入队判定                                     |
| `apps/lawmind-desktop/electron/local-api-credentials.mjs`         | 本机 API 凭据派生的**唯一真相源**（clientId → 凭据、scope、宽限、发现路径）            |
| `apps/lawmind-desktop/electron/local-server.mjs`                  | 安装密钥持久化（keychain / 0600 降级）、代次与吊销名单、CLI 发现文件                   |
| `apps/lawmind-desktop/server/lawmind-server-route-word-addin.ts`  | `/word-addin/*` 静态 + `/api/word-addin/*` 数据面；下发插件专属凭据                    |
| `apps/lawmind-desktop/server/lawmind-server-dispatch.ts`          | 只对 `GET /word-addin/*` 免 bearer，其余照旧                                           |
| `apps/lawmind-desktop/server/lawmind-local-server.ts`             | 30s tick 里跑取件；插件 POST 后立刻 wake 一次                                          |
