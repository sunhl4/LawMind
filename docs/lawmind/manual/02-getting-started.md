# 第 2 章 安装、首跑与界面导览

本章是把 LawMind 装起来、跑通第一次交办、认全界面。安装与交付细节另见 `apps/lawmind-desktop/INSTALL.md`（面向终端用户）与 `docs/LAWMIND-DELIVERY.md`（交付手册）。

## 2.1 两种安装方式

### 源码运行（开发 / 内测）

前置：Node.js **22.16+**（仓库 `.nvmrc` 为 `22`）与 pnpm **10.23.0**（`package.json` 的 `packageManager`）。

```bash
git clone https://github.com/sunhl4/LawMind.git
cd LawMind
corepack enable
corepack prepare pnpm@10.23.0 --activate
pnpm install
pnpm lawmind:desktop
```

`pnpm install` 会为当前 OS 下载 OfficeCLI（Word 修订轨 / 改稿用，Apache-2.0），并给开发版 Electron 打上应用名与图标。若 pnpm v10 跳过了 Electron 的 postinstall，执行 `pnpm approve-builds`（允许 `electron`）后重跑 `pnpm install`。

`pnpm lawmind:desktop` 会启动 Vite（端口 **5174**，仅作为 Electron 渲染进程来源）并打开桌面窗口。**不要**用浏览器打开 `http://127.0.0.1:5174` 当作产品 UI。

### 安装包（终端用户）

- 从 GitHub Release（工作流 **LawMind desktop build**，tag `lawmind-desktop-v*`）下载对应 OS / 架构的 `LawMind-<version>-<os>-<arch>.<ext>`。
- 当前打包线版本：**0.2.1**（`apps/lawmind-desktop/package.json`），appId `ai.lawmind.desktop`。
- macOS 未公证包首次打开需「右键 → 打开」；Windows 有 `.exe`、portable 与 `.zip`；Linux 有 `.AppImage` 与 `.tar.gz`。
- 自行打包：`pnpm lawmind:desktop:dist`（内部顺序：bundle 本地服务 → vendor Node → vendor officecli → Vite build → electron-builder）。

### 开发态与打包态的差别（排障必读）

|                           | 开发态                                                                  | 打包态                                                              |
| ------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 渲染进程来源              | Vite dev server `http://127.0.0.1:5174`                                 | `dist/index.html`（`file://`）                                      |
| 本地 API 进程             | `node --import tsx apps/lawmind-desktop/server/lawmind-local-server.ts` | vendored Node + `resources/lawmind-server/lawmind-local-server.cjs` |
| 沙箱                      | `sandbox` 仅打包态启用                                                  | 启用                                                                |
| `LAWMIND_SKIP_API_AUTH=1` | 可用（且打包态强制忽略）                                                | 忽略                                                                |

## 2.2 首次启动会发生什么

首跑的组件是 `apps/lawmind-desktop/src/renderer/LawmindApiSetupWizard.tsx`（连接向导）与 `LawmindFirstRunDialog.tsx`（30 秒首跑）。顺序：

1. **连接模型**：向导收集 API Key、Base URL、模型名、工作区、检索通道（`single` / `dual`）。向导内置「推荐栈」（DeepSeek Flash（推荐）/ 通义千问 / OpenAI 兼容）；这些值默认落进设置里的「模型与连接」分区。
2. **写入密钥**：密钥优先进入操作系统密钥链（`apps/lawmind-desktop/electron/lawmind-key-vault.cjs`）；随后从 `.env.lawmind` 抹掉明文，并重启本地 API 子进程。若系统加密存储不可用，向导**拒绝**保存（文案：请在系统设置里打开钥匙串后再试）。不改成明文。
3. **落到对话**：钥匙验证通过后建「演示案件」、权限可执行、输入框留空。已经有案件时引导不会自动再弹。身份和文书仍可从设置重开 `LawmindFirstRunDialog`；走完才写偏好。已经往下选时，放弃按钮是「不记这些，直接开始」，不和「下一步」抢主按钮。
4. **空对话示例**：三句可点交办（备忘 / 审违约责任 / 记下传票）只填进输入框，不自动发送。审合同和记传票要先拖入文件。实现：`lawmind-day-one.ts` 的 `DAY_ONE_EXAMPLE_PROMPTS`，空态在 `lawmind-chat-messages-column.tsx`。
5. **首跑完成标记**：`<工作区>/.lawmind/firstrun-acceptance-pending.json` 记录待验收的 `matterId`（先写临时文件再改名），验收完成后清除；首跑向导可从设置重新打开。

「不再自动打开」记在**当前工作区**的 `.lawmind/firstrun-dismissed.json`，不跟浏览器配置走。换一个空工作区会重新出现首跑；浏览器里的 `lm.firstRun.dismissed` 只在读不到工作区标记时兜底。钥匙保存成功后走的是上面第 3 步，**不会**再写 `lm.firstRun.requestOpen`。

## 2.3 工作区与配置文件的真实位置

LawMind 把「应用数据」与「随仓库的开发工作区」刻意分开：

| 内容                | 位置                                     | 说明                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 应用根              | `<userData>/LawMind`                     | `app.getPath("userData")` 拼上 `LawMind`（`electron/local-server.mjs:348`）。**开发态的 `<userData>` 被刻意钉在 `Application Support/Electron`**，所以完整路径是 `~/Library/Application Support/Electron/LawMind`；打包态才回到应用名目录。别按「Application Support/LawMind」去找，开发机上那里什么都没有（第 13.8 节讲了为什么保留 `Electron` 这个名字）。E2E 用 `LAWMIND_USER_DATA_DIR` 隔离，但**打包版一律忽略**它 |
| 工作区              | `<userData>/LawMind/workspace`           | 默认值；可在设置「工作区」或向导中改。设置页展示完整路径，可复制、可在文件夹中显示。路径落在同步盘或网络共享时只提示、不拦截（含 macOS `CloudStorage` 下的 OneDrive / Dropbox / Box，以及 `\\server\share`）。外置本地盘不提示。代码：`electron/local-server.mjs`、`src/renderer/lawmind-workspace-location.ts`、`LawmindSettingsWorkspace.tsx`                                                                         |
| 环境变量            | `<userData>/LawMind/.env.lawmind`        | 真实密钥；`.env.lawmind.example` 是模板，**永远不要提交**                                                                                                                                                                                                                                                                                                                                                               |
| 桌面配置            | `<userData>/LawMind/desktop-config.json` | 持久化本机 API 端口（`apiPort`）、凭据代次与吊销名单等非秘密配置                                                                                                                                                                                                                                                                                                                                                        |
| 本机文件夹授权      | 由 `host-access-store.mjs` 持久化        | 律师选出的可读目录（可绑案件）；默认只读                                                                                                                                                                                                                                                                                                                                                                                |
| 仓库内 `workspace/` | 仓库根                                   | 只放可公开的骨架（模板、playbooks、示例案件、示例 `MEMORY.md`）；真实数据由 `.gitignore` 排除                                                                                                                                                                                                                                                                                                                           |

本机 API 只监听回环：`127.0.0.1` 与 `::1`（macOS 上 `localhost` 会解析到两者，Word 任务窗格优先试 `::1`，见第 14 章）。端口默认是**动态选一个空闲口并持久化**到 `desktop-config.json`（Word 侧载的 `manifest.xml` 会钉住这个端口，所以端口不能每次随机漂移）。

## 2.4 界面导览：律师能打开的工作面

类型 `LawmindMainView`（`apps/lawmind-desktop/src/renderer/lawmind-main-view.ts`）里有六个 id。律师进得去的是五个。顶栏一级 tab **只有三个**（`LawmindAppHeader.tsx`）：对话、工作台、在办。改稿和整理资料不占一级位置，**已经停在该面时**才多出一个次级 tab（`lm-tab-secondary`），用来定位和返回。`meeting` 仍留在类型里，顶栏没有「会议室」，主内容区也不挂载 `MeetingView`。输入条「+」里没有开会议室（`apps/lawmind-desktop/e2e/meeting-flow.spec.ts`）。不要在界面上找这一屏。

| 工作面   | 视图 id     | 顶栏       | 律师在这里做什么，以及怎么进来                                                             |
| -------- | ----------- | ---------- | ------------------------------------------------------------------------------------------ |
| 对话     | `workspace` | 一级       | 直接说事或丢材料交办；看引用、澄清、压缩提示                                               |
| 工作台   | `desk`      | 一级       | 今日安排、案件门类、本案卷宗、期限与谈话                                                   |
| 在办     | `agents`    | 一级       | 还没了结的交办。左栏分「停在你这里 / 正在办 / 今天办完」，右栏点开一件再签批、补充或去改稿 |
| 改稿     | `review`    | 打开后次级 | 改稿、批注、预览、导出。按钮文案一律是「改稿」。从在办「改稿」或对话「去改稿」进入         |
| 整理资料 | `archive`   | 打开后次级 | 三步整理指定范围：指定范围 → 查看分类 → 勾选确认，确认后才复制。从设置 → 工作区进入        |

整理资料页是 `LawmindArchiveOrganizePage.tsx`；入口在设置 → 工作区「整理电脑上的资料」（第 24.7 节）。`meeting` 的数据格式和委派留痕见第 16.7 节，那不是一条导航。

过程不堆在对话里，到「在办」看。

叠加在这些面上的公共结构：

- **侧栏**：品牌标 + 设置齿轮；材料 / 资源管理器；案件列表；会话列表；有待决策时才出现「待我拍板」徽标（进入在办并聚焦待决策）。工作台、改稿、整理资料不显示侧栏，这时同一按钮改到顶栏。
- **顶栏**：三个一级工作面；当前案件芯片（打开工作台本案卷宗）；版面开关；助手多于一个时才出现切换。当前模型在**对话输入栏**里选，不在顶栏。
- **设置**：整页（非模态），左侧一级目录 + 右侧内容区，支持搜索定位分区。
- **文件工作台**：`FileWorkbench`，可从深链直接打开某个工作区文件。

### 设置分区

`apps/lawmind-desktop/src/renderer/lawmind-settings-nav.ts` 定义侧栏为一条平铺目录（返回、搜索、下列各项），不再分组，也不再把后半段收进「更多设置」。本机文件夹在「工作区」里添加或撤销。查找、阅读已选文件夹和本机命令默认可用，没有单独的能力开关页。旧的「本机能力」深链会打开工作区。

| 分区       | 说明                                                 |
| ---------- | ---------------------------------------------------- |
| 账号       | 登录身份、订阅方案、用量，以及模型是自备还是套餐内置 |
| 模型与连接 | 密钥、当前模型、联网与法源                           |
| 工作区     | 案件数据目录、本机文件夹与办案标准                   |
| 外观       | 浅色或深色、全软件字号，以及审稿是否要您拍板         |
| 自动办件   | 定时任务与邮箱配置                                   |
| 记忆库     | 办案沉淀与偏好学习                                   |
| 助手编制   | 新建、切换与编辑助手                                 |
| 免责声明   | 使用边界与责任                                       |

版本号和「更新」在设置侧栏底部，不另开一页。本机许可、激活码和开始时的偏好在「账号」。界面出错时弹出说明，可复制后发给帮你看的人。

六个「已退役但可深链」的分区（`SETTINGS_NAV_RETIRED_ITEMS`）不再出现在侧栏：角色说明、团队工作流、作业标准、版本与授权、系统健康、文书模板。它们的日常入口分别是：默认助手、顶栏「在办」、交办时自动带上的内置作业标准（深链只读，不能安装或开关）、设置侧栏底部的版本号、`pnpm lawmind:doctor` 与 `GET /api/health`（原「系统健康」页已拆：Word 连接在设置 → 外观，查找重建与案件档案整理在设置 → 工作区，许可与用量在设置 → 账号）、出稿内置模板。旧深链 id 会自动改道（`lawmind-settings-nav.ts` 的 `readStoredSettingsSection` / `lawmindSettingsSectionFromDomId`）：`review-prefs` → 外观，`host` 与 `doctor` → 工作区，`tools` → 模型与连接，`app-update` → 账号。

## 2.5 模型与连接配置

律师在这一页要配通的是**当前模型**。其余通道默认跟着它走，不必先拆开。

- **对话模型**：`GET /api/models` 读，`PATCH /api/models/default` 写（**没有 POST**）。设置页先显示「待配置 / 待验证 / 已验证」；Key 进系统密钥链，连通性用「验证模型」测，探测走出口代理（`src/lawmind/models/probe.ts`）。
- **联网**：对话栏打开「联网」后，`web_search` 才进入本回合工具表。公开网页默认用**当前对话模型的厂商检索**（DeepSeek / 通义，与聊天同一套 Key）。关掉「检索与对话共用同一模型」且法律垂类自带厂商联网时，才改走垂类。Brave（`LAWMIND_WEB_SEARCH_API_KEY` 或 `BRAVE_API_KEY`）只是当前模型没有厂商检索时的备用，不是开联网的前提。工作区策略 `allowWebSearch: false` 或 `egressMode: "offline"` 会整轮不注册联网工具。
- **法源**：NPC（国家法律法规数据库）hybrid 默认开，`LAWMIND_OPEN_LAW_NPC=0` 才关。
- **分开的模型**（设置页「高级」里，Day-1 不必动）：`PATCH /api/models/worker` 的更快模型只用于审稿和长对话摘要，对话里选工具、改稿仍用当前模型；`PATCH /api/models/retrieval` 的 `single` / `dual` 决定法律检索是否另用垂类模型（见第 3 章）。

自定义模型：`/api/models/custom`，密钥走 `lawmind:save-custom-model-key` IPC。MCP 服务器密钥同理（`lawmind:save-mcp-server-secret`）。

## 2.6 第一条交办（端到端）

最短可用路径：

1. 在「对话」里**直接说事**（不必先选办件），或把材料拖进输入框钉选、把文件夹丢进来。
2. 系统做**隐式意图编译**，状态条只显示一行「本轮按××处理」（不提供分类菜单，第 4 章）。
3. 回合内模型调用工具：读材料 / 检索 / 起草 / 计算 / 改稿，过程在「在办」展示，对话里不堆过程芯片。
4. 产出草稿后，对话里出现「去改稿」；点进去才打开改稿面。需要律师决定的事项进「待我拍板」（侧栏；工作台、改稿、整理资料没有侧栏时改到顶栏），打开在办并只看停在你这里的。直接点「在办」看到全部还没了结的交办：要你处理的、正在办的、今天办完的。
5. 在「改稿」里审核与改稿，逐项过「必核清单」后**签批**。
6. **交付**：导出 DOCX / PPTX。对已有 Word 的修改走修订轨，写出另一份带修订的稿，不覆盖律师给的原件（第 8 章）。

回合里真正停下来等律师的，只有**发出邮件**（`send_email`）。`prepare_outbound_mail` 只写入待发信，拍板在收件侧，不打断这一轮。澄清问句也会出现在「待我拍板」，因为不问完办不下去。列目录、检索、分析、起草、本地导出都直接做完。改已有 Word 走修订轨，不在回合中途再要一次「能不能改原稿」。

## 2.7 常用命令

| 命令                                                | 用途                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm lawmind:desktop`                              | 开发态启动桌面应用                                                                                     |
| `pnpm lawmind:desktop:dist`                         | 打包安装包                                                                                             |
| `pnpm test`                                         | Vitest（`src/lawmind` + 桌面单测）                                                                     |
| `pnpm --filter lawmind-desktop typecheck`           | 桌面类型检查                                                                                           |
| `pnpm lawmind:bundle:desktop-server`                | 打包本地 API 为 `server/dist/lawmind-local-server.cjs`                                                 |
| `pnpm lawmind:agent`                                | 命令行 Agent（`--session` / `--matter` / `--list-sessions` / `--message`）                             |
| `pnpm lawmind:doctor`                               | 无界面工作区 / 健康体检（`--json`、`--fix` 修复会话工具调用配对）                                      |
| `pnpm lawmind:release-readiness`                    | 发布就绪报告                                                                                           |
| `pnpm lawmind:verify`                               | 与 PR CI 同一条链（覆盖率一次、类型检查、结构门禁、HTTP smoke）。质量证据另跑 `lawmind:verify:release` |
| `pnpm lawmind:docs:dev` / `pnpm lawmind:docs:build` | 文档站开发 / 构建                                                                                      |

完整命令表见第 17 章。

## 2.8 常见问题

| 现象                                   | 原因与处理                                                                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 浏览器打开 5174 一片空白或报错         | 5174 只是 Electron 渲染进程来源；请打开桌面窗口                                                                                                                                                     |
| 装不上 / 启动即崩，提示找不到 Electron | pnpm v10 跳过了 postinstall；`pnpm approve-builds` 允许 `electron` 后重装                                                                                                                           |
| API Key 无法保存                       | 系统密钥链不可用，或 `lawmind-secrets.json` 已损坏（损坏时不会用空文件覆盖）。启用密钥链，或手工写 `.env.lawmind` 后重启                                                                            |
| 模型报 502 / 连不通                    | 先跑连接体检（`pnpm lawmind:doctor` 或 `GET /api/health`）；确认网络、Base URL 与模型名；出口受网络白名单约束时需放行                                                                               |
| macOS 打不开安装包                     | 未公证 / 未签名包需右键 → 打开；正式包应已 Developer ID 签名并公证                                                                                                                                  |
| Word 插件找不到服务                    | 本机 API 端口被重选，侧载 `manifest.xml` 钉的是旧端口；看端口漂移诊断（第 8、14 章）                                                                                                                |
| 改了文件但检索搜不到                   | 检索会把改过的审计、会话、知识和材料补进索引，下一次搜索就带上。整库重建只在索引损坏时用：设置 → 工作区（需要时「查找」组才出现）。单独启动的 API 未开 `LAWMIND_ALLOW_INDEX_REBUILD=1` 时重建会 403 |
| 对话很长后答案开始「忘事」             | 触发了上下文压缩（compact）；对话里会出现压缩提示，必要时用「承前分叉」（第 3 章）                                                                                                                  |

## 2.9 实现：首跑与配置的代码路径

| 环节                                           | 代码                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 窗口与生命周期、单实例锁                       | `apps/lawmind-desktop/electron/main.mjs`                                                                            |
| 菜单、渲染进程加载、自动更新                   | `apps/lawmind-desktop/electron/app-menu.mjs`                                                                        |
| 应用根 / 工作区解析                            | `apps/lawmind-desktop/electron/lawmind-root.mjs`、`electron/local-server.mjs`                                       |
| 本地 API 子进程 spawn 与监督                   | `apps/lawmind-desktop/electron/local-server.mjs`、`electron/server-supervision.mjs`                                 |
| 凭据派生与吊销                                 | `apps/lawmind-desktop/electron/local-api-credentials.mjs`                                                           |
| 密钥链                                         | `apps/lawmind-desktop/electron/lawmind-key-vault.cjs`                                                               |
| 连接向导                                       | `apps/lawmind-desktop/src/renderer/LawmindApiSetupWizard.tsx`                                                       |
| 空对话示例与演示案件名                         | `apps/lawmind-desktop/src/renderer/lawmind-day-one.ts`                                                              |
| 30 秒首跑                                      | `apps/lawmind-desktop/src/renderer/LawmindFirstRunDialog.tsx`                                                       |
| 首跑完成标记、关闭标记与审计                   | `src/lawmind/onboarding/firstrun-state.ts`；`GET /api/onboarding/firstrun`、`POST /api/onboarding/firstrun-dismiss` |
| 工作区路径提示（同步盘 / 网络共享 / 剩余空间） | `src/renderer/lawmind-workspace-location.ts`、`electron/workspace-volume.mjs`                                       |
| 设置分区元数据                                 | `apps/lawmind-desktop/src/renderer/lawmind-settings-nav.ts`                                                         |
| 一级工作面定义                                 | `apps/lawmind-desktop/src/renderer/lawmind-main-view.ts`                                                            |

## 2.10 已知坑

- 打包态一律忽略 `LAWMIND_SKIP_API_AUTH=1`；在开发态用它跳过鉴权时，写操作仍被要求 `Content-Type: application/json`，否则返回 `415`。
- `desktop-config.json` 位于应用根而**工作区之外**，是跨实例共享的；这正是凭据必须比对 `instanceId` 的原因。
- 首跑「不再自动打开」先写入当前工作区的 `firstrun-dismissed.json`。写入成功后会清掉浏览器里的 `lm.firstRun.dismissed`。只有工作区写失败时才落到浏览器；那时若本机 API 也读不到，换工作区可能把引导一起跳过。
- 密钥文件 `lawmind-secrets.json` 用临时文件换名落盘。文件损坏时拒绝再写，避免一次失败把已存的 API Key 覆盖成空。
- 首跑偏好会写进记忆（`LAWYER_PROFILE.md` 与应用偏好），之后零确认不写入——所有后续学习都走记忆采纳（第 6 章）。

## 2.11 安装包的三个平台差异

| 平台      | 产物                              | 注意点                                                                |
| --------- | --------------------------------- | --------------------------------------------------------------------- |
| macOS     | `.dmg` + `.zip`                   | 分 arm64 / x64；**未公证的包从浏览器下载后双击打不开**，要右键 → 打开 |
| Windows   | `.exe`（nsis）+ portable + `.zip` | portable 版不写注册表；`.zip` 适合受控环境                            |
| Linux x64 | `.AppImage` + `.tar.gz`           | AppImage 要加可执行位；`.tar.gz` 适合自己放路径                       |

**怎么知道自己的包是不是公证过的**：运行中的应用不跑 `codesign` 自检。签名状态在发布就绪报告里（`pnpm lawmind:release-readiness`，实现 `src/lawmind/evaluation/release-artifacts.ts`）：`signed_notarized` / `signed_only` / `unsigned` / `not_evaluated`。没打过包就写「未评估」，不会把「没打包」说成「已公证」。律师侧的判断更简单：从浏览器下载的 macOS 包若双击打不开，就是还没公证，右键 → 打开。

## 2.12 工作区路径怎么选

默认在用户数据目录下的 `workspace`。要改的话，考虑三件事：

| 考虑               | 建议                                                     |
| ------------------ | -------------------------------------------------------- |
| 会不会被同步盘同步 | **不建议放同步盘**（尤其开了案件副本时，会两套同步叠加） |
| 磁盘空间           | 材料会累积，选个大点的盘                                 |
| 备份方便           | 选一个你们备份工具认识的位置                             |

**可以放外置盘或网络盘吗**：外置本地盘可以。网络共享技术上也能选，但案件检索放在网络盘上容易变慢或写坏（索引是工作区里的 SQLite），并且同一时刻只能有一台电脑在写。向导和「设置 → 工作区」只提示、不拦截。

路径字符串认得出 UNC、`smb://`、`/net/` 和常见同步盘，认不出「挂在 `/Volumes` 或某个盘符上的网络卷」。那一层问操作系统（`electron/workspace-volume.mjs`）：macOS 用 `stat -f %T`，Linux 读 `/proc/mounts`，Windows 读 `Win32_LogicalDisk.DriveType`。`smbfs` / `nfs` / `afp` / `webdav` 或 DriveType 4 才算网络卷；`exfat`、`apfs` 和可移动盘不算。查不到就保持安静。本机磁盘剩余空间不足 5 GB 时另提示一句，同步盘或网络共享的提示优先。文案在 `workspaceLocationCautionMessage`。

字符串这一层（`lawmind-workspace-location.ts`）认这些位置：

- 同步盘：iCloud（含「移动文稿」）、Dropbox、OneDrive（含 `OneDrive - 律所` 和 macOS `CloudStorage/OneDrive-Personal`）、Google 云端硬盘、坚果云、Box（含 `CloudStorage/Box-Box`）、群晖 Drive、Nextcloud。目录本身就是同步盘根目录时也会提示。
- 网络共享：UNC、`smb` / `nfs` / `afp` / `cifs`、macOS `/net/`。
- 不提示：本机文档目录。`/Volumes` 不按路径报警；主进程查到 U 盘保持安静，查到网络卷才提示。查不到系统信息时也不误报。

## 2.13 模型怎么选

三条经验：

1. **先用一个通用模型跑通全链路**，再考虑专门化。没有跑通之前换模型只会增加变量。
2. **法律垂类模型不是必须的**。它们可以配成检索或推理的专用通道（`LAWMIND_CHATLAW_*`、`LAWMIND_LAWGPT_*`），但通用模型已经能覆盖大部分任务。
3. **贵不等于好用**。影响效果最大的是「口径配得准不准」（记忆 + playbook），不是模型档次。

**结构化输出**：`json-schema-capability.ts` 默认对所有主机用 `json_object`（已核实支持 strict schema 的主机白名单目前是空的，这是故意的，避免未核实端点直接 400）。设 `LAWMIND_LLM_JSON_SCHEMA=on` 才会尝试 `json_schema`；端点拒绝后按主机记住，之后回到 `json_object`，不每次都失败一次。这不需要律师配。

## 2.14 初始配置清单

第一次配完之后，对着这份清单核一遍：

```text
[ ] 模型已配置且连通（设置 → 模型与连接里「验证模型」，或 `pnpm lawmind:doctor`）
[ ] 已直接开始，或按需记了习惯（角色 / 风格 / 风险取向 / 客户口吻；不挡第一句）
[ ] 工作区路径确认（不是同步盘或网络共享；磁盘剩余空间不要低于 5 GB）
[ ] 模型钥匙进了系统密钥链（保存时若密钥链不可用，向导会拒绝写入）
[ ] 本机文件夹（如果要用）已添加，且理解「默认只读」
[ ] 听到「只有发出邮件会停住这一轮；澄清会出现在待我拍板」
[ ] 知道「待我拍板」在侧栏；工作台、改稿、整理资料没有侧栏时，它改到顶栏，而且只在有待决策时出现
[ ] 知道记忆要确认才写入
```

## 2.15 第一次交办之后会发生什么

很多人第一次交办之后不确定「好没好」。按这个顺序看：

| 看哪             | 期望                             |
| ---------------- | -------------------------------- |
| 对话里           | 一条「本轮按××处理」的状态条     |
| 输入框上方       | 钉选的文件（如果拖了文件）       |
| 「在办」         | 这件事出现在列表里，可以看到进度 |
| 几秒到几分钟后   | 对话里出现助手回复，附上产出     |
| 「改稿」         | 如果有草稿，能在这里看到正文     |
| 侧栏「待我拍板」 | **通常不出现**（正常）           |

**侧栏没有「待我拍板」是正常的。** 没有待决定事项时按钮不占侧栏（避免空入口）。发出邮件会停住这一轮并出现在这里；助手需要你补一句才能继续时，澄清也会出现在这里，按钮带上数量。起草和本地导出不会。顶栏不常驻这个按钮；只有侧栏没挂上（工作台、改稿、整理资料，或侧栏收起）并且确实有待决策时，同一枚按钮才出现在顶栏。

## 2.16 界面快捷键与快捷入口

| 想干什么           | 怎么操作                                |
| ------------------ | --------------------------------------- |
| 打开设置           | 侧栏顶部齿轮                            |
| 搜索历史会话       | `⌘⇧O` 或输入 `/chats`                   |
| 保存/另存          | `⌘S` / `⇧⌘S`（菜单里的「文件」）        |
| 开发者工具         | 菜单「显示 → 切换开发者工具」（停靠式） |
| 打开某个工作区文件 | 文件工作台，或者深链                    |

`LAWMIND_DEVTOOLS=1` 会让应用**自动**打开停靠式开发者工具。注意**不要**去开分离式窗口（第 13 章那个坑）。
