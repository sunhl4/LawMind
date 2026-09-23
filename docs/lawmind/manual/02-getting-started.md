# 第 2 章 安装、首跑与界面导览

本章是唯一以「照做」为主的章节：把 LawMind 装起来、跑通第一次交办、认全界面。安装与交付细节另见 `apps/lawmind-desktop/INSTALL.md`（面向终端用户）与 `docs/LAWMIND-DELIVERY.md`（交付手册）。

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
- 打包版**不需要**单独装 Node 或 officecli：Node 运行时随包 vendored 到 `Resources/node-runtime/`，OfficeCLI 在 `Resources/officecli/`。
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

1. **连接模型**：向导收集 API Key、Base URL、模型名、工作区、检索通道（`single` / `dual`）。向导内置「推荐栈」（DeepSeek Flash（推荐）/ 通义千问 / OpenAI 兼容），默认落地本节区在设置里就是「模型与连接」。
2. **写入密钥**：密钥优先进入操作系统密钥链（`apps/lawmind-desktop/electron/lawmind-key-vault.cjs`）；随后从 `.env.lawmind` 抹掉明文，并重启本地 API 子进程。若系统加密存储不可用，向导**拒绝**持久化新的 API Key（文案：请启用密钥链，或先手工配置 `.env.lawmind` 后重启）。
3. **30 秒首跑偏好访谈**：依次选角色（独立执业 / 律所协办 / 合伙人）→ 偏好（写作风格：简洁直接 / 详尽论证 / 偏诉讼对抗；风险取向：偏保守 / 平衡 / 偏进取；客户口吻：正式严谨 / 通俗易懂 / 亲和说明）→ 起始交付物类型 → 创建案件 + 生成一条种子交办 + 写回偏好。
4. **首跑完成标记**：`<工作区>/.lawmind/firstrun-acceptance-pending.json` 记录待验收的 `matterId`，验收完成后清除；首跑向导可从设置重新打开。

首跑不再强制弹向导（钥匙验证完即自动建演示案件 + 种子提示 + 可执行默认）。首跑对话框的关闭标记是 localStorage 的 `lm.firstRun.dismissed`，向导保存成功后通过 `lm.firstRun.requestOpen` 请求重新打开一次。

## 2.3 工作区与配置文件的真实位置

LawMind 把「应用数据」与「随仓库的开发工作区」刻意分开：

| 内容                | 位置                                     | 说明                                                                                          |
| ------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| 应用根              | `<userData>/LawMind`                     | macOS 上即 `~/Library/Application Support/LawMind`。E2E 用 `LAWMIND_USER_DATA_DIR` 隔离       |
| 工作区              | `<userData>/LawMind/workspace`           | 默认值；可在设置「工作区」或向导中改。代码：`apps/lawmind-desktop/electron/local-server.mjs`  |
| 环境变量            | `<userData>/LawMind/.env.lawmind`        | 真实密钥；`.env.lawmind.example` 是模板，**永远不要提交**                                     |
| 桌面配置            | `<userData>/LawMind/desktop-config.json` | 持久化本机 API 端口（`apiPort`）、凭据代次与吊销名单等非秘密配置                              |
| 本机文件夹授权      | 由 `host-access-store.mjs` 持久化        | 律师选出的可读目录（可绑案件）；默认只读                                                      |
| 仓库内 `workspace/` | 仓库根                                   | 只放可公开的骨架（模板、playbooks、示例案件、示例 `MEMORY.md`）；真实数据由 `.gitignore` 排除 |

本机 API 只监听回环：`127.0.0.1` 与 `::1`（macOS 上 `localhost` 会解析到两者，Word 任务窗格优先试 `::1`，见第 14 章）。端口默认是**动态选一个空闲口并持久化**到 `desktop-config.json`（Word 侧载的 `manifest.xml` 会钉住这个端口，所以端口不能每次随机漂移）。

## 2.4 界面导览：五个工作面

一级导航有且只有五个工作面，定义在 `apps/lawmind-desktop/src/renderer/lawmind-main-view.ts`：

| 工作面 | 视图 id     | 律师在这里做什么                                                  |
| ------ | ----------- | ----------------------------------------------------------------- |
| 对话   | `workspace` | 直接说事或丢材料交办；看过程、引用、澄清、压缩提示                |
| 工作台 | `desk`      | 今日安排、案件门类、本案卷宗、待我拍板事项、期限与谈话            |
| 在办   | `agents`    | 正在办的事集合；左侧待办目录 + 右侧办理区；集中签批 / 补充 / 驳回 |
| 会议室 | `meeting`   | 多助手围绕一个议题先后发言，可打断 / 暂停 / 恢复                  |
| 改稿   | `review`    | 改稿 · 批注 · 模板实时预览 · 导出；三栏可显隐并持久化             |

叠加在这五个面上的公共结构：

- **侧栏**：品牌标 + 设置齿轮；材料 / 资源管理器；案件列表；会话列表（Cursor 风格）；「待我拍板」徽标按钮（进入在办并聚焦待决策）。
- **顶栏**：五个工作面切换、案件驾舱开关、版面开关、助手切换、模型选择入口。
- **设置**：整页（非模态），左侧分组导航 + 右侧内容区，支持搜索定位分区。
- **文件工作台**：`FileWorkbench`，可从深链直接打开某个工作区文件。

### 设置分区（Day-1 与「更多设置」）

`apps/lawmind-desktop/src/renderer/lawmind-settings-nav.ts` 定义：Day-1 侧栏只暴露 **模型与连接 / 工作区 / 本机能力 / 外观 / 免责声明**，其余收进「更多设置」。

| 分组             | 分区       | 说明                                    |
| ---------------- | ---------- | --------------------------------------- |
| 本机与外观       | 模型与连接 | API、默认模型与检索通道                 |
|                  | 工作区     | 案件数据目录、材料夹与办案标准          |
|                  | 本机能力   | 本机查找、本机命令与案件隔离            |
|                  | 外观       | 主题、字号、版面、签批审阅与导出        |
| 办案（更多设置） | 自动办件   | 定时任务与邮箱配置                      |
|                  | 文书模板   | Word / PPT 交付模板                     |
|                  | 记忆库     | 办案沉淀与偏好学习                      |
|                  | 助手编制   | 新建、切换与编辑助手                    |
| 关于             | 免责声明   | 使用边界与责任                          |
| 专业控制         | 系统健康   | 连接、核对与运行体检（含成绩单 / 用量） |
|                  | 安全       | 高安全开关与联网策略（含 MCP、沙箱）    |
|                  | 应用更新   | 检查桌面版更新                          |

四个「已退役但可深链」的分区（`SETTINGS_NAV_RETIRED_ITEMS`）不再出现在侧栏：角色说明、团队工作流、技能库、版本与授权。它们的日常入口分别是：默认助手、顶栏「在办」、开箱自动启用的技能、设置侧栏底部的版本号。

## 2.5 模型与连接配置

三条通道要分清：

- **对话 / 推理模型**：`GET /api/models` 读，`PATCH /api/models/default`、`/api/models/worker`、`/api/models/retrieval` 写（**没有 POST**）。`workerModel` 是「本轮有工具要广告时」优先使用的模型（见第 3 章）。
- **检索通道**：`/api/models/retrieval`，`single` 与 `dual` 两档。法源侧的 NPC（国家法律法规数据库）hybrid 默认开，`LAWMIND_OPEN_LAW_NPC=0` 才关。
- **联网检索**：设置「安全」里的联网策略；配置 `LAWMIND_WEB_SEARCH_API_KEY` 或 `BRAVE_API_KEY` 后 `web_search` 才会出现在本回合工具表。

自定义模型与密钥：`/api/models/custom`，密钥走 `lawmind:save-custom-model-key` IPC 进密钥链。模型连通性探测走出口代理，见 `src/lawmind/models/probe.ts`。MCP 服务器密钥同理（`lawmind:save-mcp-server-secret`）。

## 2.6 第一条交办（端到端）

最短可用路径：

1. 在「对话」里**直接说事**（不必先选办件），或把材料拖进输入框钉选、把文件夹丢进来。
2. 系统做**隐式意图编译**，状态条只显示一行「本轮按××处理」（不提供分类菜单，第 4 章）。
3. 回合内模型调用工具：读材料 / 检索 / 起草 / 计算 / 改稿，过程在「在办」展示，对话里不堆过程芯片。
4. 产出草稿后进入**审核**；需要律师决定的事项进「待我拍板」。
5. 在「改稿」里审核与改稿，逐项过「必核清单」后**签批**。
6. **交付**：导出 DOCX / PPTX（改原稿的场景走 Word 修订轨，第 8 章）。

只有两类事会真正打断律师：**外发**（`send_email`）与**改原稿**等真授权动作。中间步骤（列目录、检索、分析）不会反复问「要不要继续」。

## 2.7 常用命令

| 命令                                                | 用途                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm lawmind:desktop`                              | 开发态启动桌面应用                                                           |
| `pnpm lawmind:desktop:dist`                         | 打包安装包                                                                   |
| `pnpm test`                                         | Vitest（`src/lawmind` + 桌面单测）                                           |
| `pnpm --filter lawmind-desktop typecheck`           | 桌面类型检查                                                                 |
| `pnpm lawmind:bundle:desktop-server`                | 打包本地 API 为 `server/dist/lawmind-local-server.cjs`                       |
| `pnpm lawmind:agent`                                | 命令行 Agent（`--session` / `--matter` / `--list-sessions` / `--message`）   |
| `pnpm lawmind:doctor`                               | 无界面工作区 / 健康体检（`--json`、`--fix` 修复会话工具调用配对）            |
| `pnpm lawmind:release-readiness`                    | 发布就绪报告                                                                 |
| `pnpm lawmind:verify`                               | 全量门禁（测试 + 双端类型检查 + benchmark + 发布就绪 + bundle + HTTP smoke） |
| `pnpm lawmind:docs:dev` / `pnpm lawmind:docs:build` | 文档站开发 / 构建                                                            |

完整命令表见第 17 章。

## 2.8 常见问题

| 现象                                   | 原因与处理                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| 浏览器打开 5174 一片空白或报错         | 5174 只是 Electron 渲染进程来源；请打开桌面窗口                                            |
| 装不上 / 启动即崩，提示找不到 Electron | pnpm v10 跳过了 postinstall；`pnpm approve-builds` 允许 `electron` 后重装                  |
| API Key 无法保存                       | 系统密钥链不可用。启用密钥链，或手工写 `.env.lawmind` 后重启                               |
| 模型报 502 / 连不通                    | 先跑连接体检（设置 → 系统健康）；确认网络、Base URL 与模型名；出口受网络白名单约束时需放行 |
| macOS 打不开安装包                     | 未公证 / 未签名包需右键 → 打开；正式包应已 Developer ID 签名并公证                         |
| Word 插件找不到服务                    | 本机 API 端口被重选，侧载 `manifest.xml` 钉的是旧端口；看端口漂移诊断（第 8、14 章）       |
| 改了文件但检索搜不到                   | 检索是 FTS5 派生索引，需重建：`POST /api/search/workspace/rebuild`                         |
| 对话很长后答案开始「忘事」             | 触发了上下文压缩（compact）；对话里会出现压缩提示，必要时用「承前分叉」（第 3 章）         |

## 2.9 实现：首跑与配置的代码路径

| 环节                         | 代码                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| 窗口与生命周期、单实例锁     | `apps/lawmind-desktop/electron/main.mjs`                                            |
| 菜单、渲染进程加载、自动更新 | `apps/lawmind-desktop/electron/app-menu.mjs`                                        |
| 应用根 / 工作区解析          | `apps/lawmind-desktop/electron/lawmind-root.mjs`、`electron/local-server.mjs`       |
| 本地 API 子进程 spawn 与监督 | `apps/lawmind-desktop/electron/local-server.mjs`、`electron/server-supervision.mjs` |
| 凭据派生与吊销               | `apps/lawmind-desktop/electron/local-api-credentials.mjs`                           |
| 密钥链                       | `apps/lawmind-desktop/electron/lawmind-key-vault.cjs`                               |
| 连接向导                     | `apps/lawmind-desktop/src/renderer/LawmindApiSetupWizard.tsx`                       |
| 30 秒首跑                    | `apps/lawmind-desktop/src/renderer/LawmindFirstRunDialog.tsx`                       |
| 首跑完成标记与审计           | `src/lawmind/onboarding/firstrun-state.ts`                                          |
| 设置分区元数据               | `apps/lawmind-desktop/src/renderer/lawmind-settings-nav.ts`                         |
| 一级工作面定义               | `apps/lawmind-desktop/src/renderer/lawmind-main-view.ts`                            |

## 2.10 已知坑

- 打包态一律忽略 `LAWMIND_SKIP_API_AUTH=1`；在开发态用它跳过鉴权时，写操作仍被要求 `Content-Type: application/json`，否则返回 `415`。
- `desktop-config.json` 位于应用根而**工作区之外**，是跨实例共享的；这正是凭据必须比对 `instanceId` 的原因。
- 首跑偏好会写进记忆（`LAWYER_PROFILE.md` 与应用偏好），之后零确认不写入——所有后续学习都走记忆采纳（第 6 章）。

## 2.11 补充：安装包的三个平台差异

| 平台      | 产物                              | 注意点                                                                |
| --------- | --------------------------------- | --------------------------------------------------------------------- |
| macOS     | `.dmg` + `.zip`                   | 分 arm64 / x64；**未公证的包从浏览器下载后双击打不开**，要右键 → 打开 |
| Windows   | `.exe`（nsis）+ portable + `.zip` | portable 版不写注册表；`.zip` 适合受控环境                            |
| Linux x64 | `.AppImage` + `.tar.gz`           | AppImage 要加可执行位；`.tar.gz` 适合自己放路径                       |

**怎么知道自己的包是不是公证过的**：体检页的发布就绪信息里会显示签名状态（`signed_notarized` / `signed_only` / `unsigned` / `not_evaluated`）。

## 2.12 补充：工作区路径怎么选

默认在工作区的用户数据目录下。要改的话，考虑三件事：

| 考虑               | 建议                                                     |
| ------------------ | -------------------------------------------------------- |
| 会不会被同步盘同步 | **不建议放同步盘**（尤其开了案件副本时，会两套同步叠加） |
| 磁盘空间           | 材料会累积，选个大点的盘                                 |
| 备份方便           | 选一个你们备份工具认识的位置                             |

**可以放外置盘或网络盘吗**：技术上可以，但注意性能（材料检索会读文件）和「同一时刻一个写者」那条约束。

## 2.13 补充：模型怎么选

三条经验：

1. **先用一个通用模型跑通全链路**，再考虑专门化。没有跑通之前换模型只会增加变量。
2. **法律垂类模型不是必须的**。它们可以配成检索或推理的专用通道（`LAWMIND_CHATLAW_*`、`LAWMIND_LAWGPT_*`），但通用模型已经能覆盖大部分任务。
3. **贵不等于好用**。影响效果最大的是「口径配得准不准」（记忆 + playbook），不是模型档次。

**如果模型不支持严格 JSON schema**，代码里有能力探测（`json-schema-capability.ts`），会按主机自动降级到 `json_object` 模式。这不需要你配。

## 2.14 补充：初始配置清单

第一次配完之后，对着这份清单核一遍：

```text
[ ] 模型已配置且连通（体检页）
[ ] 首跑偏好已选（角色 / 风格 / 风险取向 / 客户口吻）
[ ] 工作区路径确认（不是同步盘）
[ ] 密钥进了系统密钥链（keychainStatus）
[ ] 本机文件夹（如果要用）已添加，且理解「默认只读」
[ ] 听到「只有外发会打断你」这条（避免后面困惑）
[ ] 知道「待我拍板」在侧栏
[ ] 知道记忆要确认才写入
```

## 2.15 补充：第一次交办之后会发生什么

很多人第一次交办之后不确定「好没好」。按这个顺序看：

| 看哪             | 期望                             |
| ---------------- | -------------------------------- |
| 对话里           | 一条「本轮按××处理」的状态条     |
| 输入框上方       | 钉选的文件（如果拖了文件）       |
| 「在办」         | 这件事出现在列表里，可以看到进度 |
| 几秒到几分钟后   | 对话里出现助手回复，附上产出     |
| 「改稿」         | 如果有草稿，能在这里看到正文     |
| 侧栏「待我拍板」 | **通常什么都没有**（正常）       |

**「待我拍板」没东西是正常的。** 只有外发和真授权才进那里。

## 2.16 补充：界面快捷键与快捷入口

| 想干什么           | 怎么操作                                |
| ------------------ | --------------------------------------- |
| 打开设置           | 侧栏顶部齿轮                            |
| 搜索历史会话       | `⌘⇧O` 或输入 `/chats`                   |
| 保存/另存          | `⌘S` / `⇧⌘S`（菜单里的「文件」）        |
| 开发者工具         | 菜单「显示 → 切换开发者工具」（停靠式） |
| 打开某个工作区文件 | 文件工作台，或者深链                    |

`LAWMIND_DEVTOOLS=1` 会让应用**自动**打开停靠式开发者工具。注意**不要**去开分离式窗口（第 13 章那个坑）。
