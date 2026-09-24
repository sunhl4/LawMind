# 第 71 章 实现精读：文档站

`apps/lawmind-docs/` 是 VitePress 文档站。第 18 章提过它一句（「文档站同步」），这一章讲实现。

**先划清一条边界**：**这个站不是产品界面。** 本地规则里写得很明确——**不要把文档站当 LawMind 打开**：

```text
Never open Vite (http://127.0.0.1:5174), docs.lawmind.ai, or a browser tab as LawMind.
```

**产品 UI 只有本机那个 Electron 应用。** 文档站是**对外发布**的东西（官网 + 手册），两者完全分开。

## 71.1 这个包只有八个文件

`apps/lawmind-docs/` 被 git 跟踪的文件**只有八个**：

```text
package.json
README.md
scripts/sync-docs.mjs
docs/.vitepress/config.mts
docs/.vitepress/theme/custom.css
docs/.vitepress/theme/index.ts
docs/index.md
docs/public/favicon.svg
```

**其余全部是同步产物**——`.gitignore` 里逐条列了：

```text
apps/lawmind-docs/docs/LAWMIND-*.md
apps/lawmind-docs/docs/lawmind/
apps/lawmind-docs/docs/archive/
apps/lawmind-docs/docs/assets/
apps/lawmind-docs/docs/public/download/
apps/lawmind-docs/docs/public/CNAME
apps/lawmind-docs/docs/public/.nojekyll
```

**「七个条目全部被忽略」这件事本身就是一条规矩的实现**：README 里那句「请改根目录 `docs/`，不要只改同步产物」——**光靠劝是不够的，但 git 会让你改不了**（改了也不会进版本库）。

**所以「单一事实来源」这件事在这里是被工具强制的，不是靠自觉。**

而依赖也只有两个：

```text
vitepress ^1.6.3
vue       ^3.5.42
```

**没有 Markdown 插件、没有搜索后端、没有分析脚本**——VitePress 自带的本地搜索就够。

## 71.2 同步脚本：七条映射

`scripts/sync-docs.mjs` 88 行。头注释两句：

```text
Copy LawMind markdown from monorepo docs/ into this package's docs/ root.
Source of truth remains ../../docs — run before dev/build/preview.
```

**「run before dev/build/preview」**——所以三个脚本都先跑同步（`pnpm run sync && vitepress …`）。

### 七个映射（这就是脚本的全部）

| #   | 源                                         | 目标                              | 方式                                |
| --- | ------------------------------------------ | --------------------------------- | ----------------------------------- |
| 1   | `docs/LAWMIND-*.md`（**只顶层**）          | `docs/<同名>`                     | 逐文件复制 + **清理目标里多出来的** |
| 2   | `docs/lawmind/`                            | `docs/lawmind/`                   | **整目录**：删掉目标再递归复制      |
| 3   | `docs/archive/`                            | `docs/archive/`                   | 同上                                |
| 4   | `docs/assets/`                             | `docs/assets/`                    | 同上                                |
| 5   | `apps/lawmind-desktop/download/index.html` | `docs/public/download/index.html` | 复制                                |
| 6   | `docs/CNAME`                               | `docs/public/CNAME`               | 复制                                |
| 7   | （生成）                                   | `docs/public/.nojekyll`           | 写空文件                            |

**七条里有四条是「整目录删了再复制」**（2–4 是，1 是逐文件 + 清理）。

**为什么要先删**：因为源里删掉的文件必须在目标里也消失。**只复制不删会让下线文档留在站上。**

### 第 1 条那个「只顶层」

```js
const srcLawmindMd = new Set(
  fs.readdirSync(srcDocs).filter((f) => f.startsWith("LAWMIND-") && f.endsWith(".md")),
);
```

**`readdirSync` 不递归，也没有 `withFileTypes`**——所以它只拿顶层的。

而清理逻辑是：

```text
目标里凡是 LAWMIND- 开头 .md 结尾、且源集合里没有的 → 删掉
```

**这也是「前缀规则」而不是「名单规则」**——这一条后面会展开（见 71.6 节）。

### 第 2 条那条最要紧

```js
if (fs.existsSync(lmSrc)) {
  fs.rmSync(lmDest, { recursive: true, force: true });
  fs.cpSync(lmSrc, lmDest, { recursive: true });
}
```

**`docs/lawmind/` 是整目录递归复制**——所以：

```text
docs/lawmind/manual/*.md  →  apps/lawmind-docs/docs/lawmind/manual/*.md
```

**本手册那 79 个文件是自动被带过去的，不需要改同步脚本、不需要登记。**

而路径是**原样保留**的——所以手册在站上的地址是 `/lawmind/manual/README`、`/lawmind/manual/01-overview` 这样。

### 第 6、7 条那两个「不复制会出事」的

`docs/CNAME` → `docs/public/CNAME` 的注释：

```text
GitHub Pages custom domain: VitePress serves from `docs/public/`, so the CNAME
at the repo `docs/CNAME` must be copied into the publish root or the custom
domain is dropped on every deploy.
```

**「or the custom domain is dropped on every deploy」**——不复制的话每次部署都会丢掉自定义域名。

`.nojekyll` 的注释：

```text
GitHub Pages must not run Jekyll on the VitePress output.
```

**「must not run Jekyll」**——因为 Jekyll 会把下划线开头的目录（`_assets` 之类）藏起来。**VitePress 的输出里有没有这种目录不重要，重要的是别让 Jekyll 碰它。**

### 最后那行日志

```text
sync-docs: copied <N> LAWMIND-*.md（pruned <M> stale）
  + docs/lawmind/ + docs/archive/ + docs/assets/ + download/ + CNAME → apps/lawmind-docs/docs/
```

**它把「复制了几份、清掉了几份、还带了哪几个目录」都报出来**——所以跑完一遍就能确认同步做了什么。

**而源目录不存在时是硬失败**：

```text
sync-docs: missing <路径>
退出码 1
```

**不是「跳过」而是「退出 1」**——因为源目录不在说明仓库结构不对，这种情况下构建一个空站更糟。

## 71.3 站点配置：导航与侧栏

`config.mts` 的顶层设置：

```text
title       "LawMind"
description "LawMind — 律师本机工作台：合同审查、改稿签批与可交付文书"
lang        "zh-Hans"
cleanUrls   true
lastUpdated true
ignoreDeadLinks true
```

**没有 `base`**——因为部署在域名根（`docs.lawmind.ai`）。

**`ignoreDeadLinks: true` 的理由写在注释里**：

```text
/** Engineering notes link to repo-local paths and asset indexes; do not block product site ship. */
```

**「不要因为死链挡住产品站发布」**——这个取舍很实际：工程笔记里必然有指向仓库路径的链接，那些在站上一定是死的。**如果不全局忽略，一篇工程笔记就能让整个站构建失败。**

### 一个「开源地址是占位符」的事实

```text
socialLinks: [{ icon: "github", link: "https://github.com/lawmind/lawmind" }]
```

**这个 org/repo 与打包配置里的不一致**——`package.json` 的 publish 配的是 `sunhl4/LawMind`，下载页默认也是 `sunhl4/LawMind`。

**所以侧栏那个 GitHub 图标现在指向一个不存在的仓库。** 这是一处**可以验证的不一致**（不是猜的，两处字面量摆在那里）。

### 导航六项

| 文字       | 指向                               |
| ---------- | ---------------------------------- |
| 快速指南   | `/LAWMIND-LAWYER-QUICKSTART`       |
| 交付       | `/LAWMIND-DELIVERY`                |
| 手册       | `/lawmind/manual/README`           |
| 数据处理   | `/archive/LAWMIND-DATA-PROCESSING` |
| 下载       | `/download/`                       |
| 实施与支持 | （下拉，无链接）                   |

下拉四项：

```text
私有化部署      /archive/LAWMIND-PRIVATE-DEPLOY
Support Runbook /archive/LAWMIND-SUPPORT-RUNBOOK
集成与边界      /archive/LAWMIND-INTEGRATIONS
安全清单        /archive/LAWMIND-SECURITY-CHECKLIST
```

**导航六项 + 下拉四项共十条，其中五条指向 `/archive/`**（`数据处理` 加下拉那四项）——**这是有意的**：导航优先给律师/客户看的是「快速指南」「交付」「手册」，而实施细节（部署、运维、安全）是归档文档但**仍然可达**。

### 侧栏八组与折叠

| 组               | 默认折叠 |
| ---------------- | -------- |
| 入门与交付       | **展开** |
| 产品说明         | **展开** |
| 桌面端           | 折叠     |
| 运维与信任       | 折叠     |
| 平台契约         | 折叠     |
| Multitask 与发布 | 折叠     |
| 功能与实现手册   | 折叠     |
| 工程笔记         | 折叠     |

**只有前两组默认展开**——因为这是给律师看的。**后面六组是给工程师的，但都不删。**

**这个「全部保留、多数折叠」的做法**：它没有为了让首页好看而删掉工程文档，而是**用折叠控制默认视野**。

### 工程笔记者一组有十四条

```text
未来问题 / 仓库目录结构 / 法律编译器路线图 / 归档区说明
三条铁律与改动清单（归档）
Engineering status / Compliance audit trail / Legal reasoning graph
Agent workbench memory / Task checkpoints / Quality & benchmarks
Citation & matter detail / Phase C governance / Phase D operability
```

**十四条里有九条指向 `/lawmind/*`**（也就是 `docs/lawmind/` 那批工程笔记），另有三条是仓库根文档、两条在 `archive/`。

**所以「工程笔记」这一组实际是 `docs/lawmind/` 的入口**。本手册也在那个目录下（`/lawmind/manual/`），但它**不靠这一组登记**——2026-09-23 起，导航新增了顶层的「手册」项（指向 `/lawmind/manual/README`），侧栏也新增了独立的「功能与实现手册」组（只放总目录与总索引两个入口）。

**这里有个取舍**：手册有 79 个文件，**没有把 71 章逐一列进侧栏**。列了会把侧栏撑成一本电话簿；不列，人就得靠手册自己的 `README`/`INDEX` 往下走。现在的选择是「导航给一个总入口，章级导航交给手册内部」。真要逐章翻侧栏，改 `config.mts` 的 `items` 即可——同步已经把全部 md 带过去了，地址是现成的。

### 主题与配色

`theme/index.ts` 只有四行：

```ts
import DefaultTheme from "vitepress/theme";
import "./custom.css";

export default DefaultTheme;
```

**没有注册任何组件、没有任何全局属性**——所以这个站是「默认主题 + 一份 CSS」。

而 CSS 的头注释说明了配色意图：

```text
LawMind product site — commercial landing tone (VitePress home + docs).
Brand: ink / brass (matches desktop favicon), not toy gradients.
```

**「ink / brass（墨与黄铜）」+「not toy gradients」**——**明确说了不要玩具感渐变**。而颜色也确实是一个偏深的蓝（`#1e5a8a` 系列）加一点黄铜色，且**暗色模式另有一套更亮的蓝**（`#6eb3e8` 系列）。

**「matches desktop favicon」**——所以站点配色与桌面图标的色调是对齐的。

## 71.4 部署：GitHub Pages 与两处门禁

### 自定义域名

```text
docs.lawmind.ai
```

真相源是 `docs/CNAME`，同步到 `docs/public/CNAME`。

### CI：`.github/workflows/lawmind-docs.yml`

**触发路径**（只有这些改了才跑）：

```text
apps/lawmind-docs/**
docs/LAWMIND-*.md
docs/lawmind/**
docs/CNAME
apps/lawmind-desktop/download/**
pnpm-lock.yaml
package.json
```

**七个路径**——覆盖同步脚本读的那五样加一个锁文件，再加 `package.json`。**所以「改了源文档就会重新发布」是自动的。**

**两个 job**：

```text
build   跑构建 → 断言三样东西存在
deploy  configure-pages + deploy-pages
```

**那三条断言**：

```text
${dist}/index.html 必须存在
${dist}/.nojekyll 必须存在
${dist}/CNAME 必须存在
```

**「三样缺一就失败」**——因为：

| 缺什么       | 后果                |
| ------------ | ------------------- |
| `index.html` | 站打不开            |
| `.nojekyll`  | Jekyll 可能藏掉文件 |
| `CNAME`      | **自定义域名丢掉**  |

**三个后果都是「站看着像坏了但构建没报错」那一类**——所以必须显式断言。

### 发布门与那个 `latest.yml`

另一条与文档站相关的门禁在桌面打包那边（第 67.8 节）：

```text
::error::No latest*.yml in the packaged artifacts — clients could not auto-update.
```

**同一个手法**：**把「构建成功但客户端坏了」这种情况显式检查出来。**

## 71.5 那份「下载页」是怎么来的

`apps/lawmind-desktop/download/index.html` 被同步到站上的 `/download/`。

它是一个**独立于 VitePress 的静态页**（不是 Markdown 渲染的），做的事：

```text
取 GitHub releases/latest
识别客户端操作系统与架构
推荐并高亮对应的安装包
支持 ?repo=组织/仓库 覆盖
```

**「识别客户端 OS 与架构」**——所以同一个链接对不同人显示不同的推荐包。

而 README 里说明了两个地址：

```text
桌面应用「帮助」默认打开 https://docs.lawmind.ai
下载页为 https://docs.lawmind.ai/download/（可用 VITE_LAWMIND_* / LAWMIND_DOWNLOAD_PAGE_URL 覆盖）
```

**所以桌面应用的「帮助」菜单与「下载安装包」菜单都指向这个站**（第 66.3 节的 `resolveLawmindDownloadPageUrl`）。

**这也解释了为什么导航里要有「下载」那一项**：它是桌面应用自己会打开的那个页面。

## 71.6 一处值得单独说的事：「9 篇」与「21 份」

这里有一个**两份规则并存**的情况，读代码才看得出来。

### 第一份规则：治理口径说「9 篇」

`docs/LAWMIND-REPO-LAYOUT.md` 里：

```text
文档已做减法：现行有效入口仅顶部「现行文档清单」中的 9 篇，历史快照封存于 `docs/archive/`（只读）。
```

```text
「文档体系减法」后，**现行文档仅以下 9 篇**；其余历史文档只读封存于 `docs/archive/`，口径以现行文档为准。
```

那 9 篇里有 **2 篇在仓库根**（`GOALS.md`、`SECURITY.md`），所以 `docs/` 里的是 **7 篇**：

```text
LAWMIND-ARCHITECTURE        LAWMIND-LAWYER-QUICKSTART
LAWMIND-TERMINOLOGY         LAWMIND-DELIVERY
LAWMIND-LEGAL-COMPILER-ROADMAP
LAWMIND-FUTURE-ISSUES       LAWMIND-REPO-LAYOUT
```

### 第二份规则：同步脚本用「前缀」

```text
凡是 docs/ 顶层、以 LAWMIND- 开头、以 .md 结尾的 → 全部复制
```

**而实际顶层有 21 份**（不是 7 份）：

```text
LAWMIND-ACCEPTANCE-LAYER-STRATEGY      LAWMIND-AGENT-PARITY-REVIEW
LAWMIND-ARCHITECTURE                   LAWMIND-CANONICAL-LEGAL-SKILLS
LAWMIND-CHAT-MATTER-FILL               LAWMIND-CODEX-WORKER-PARITY
LAWMIND-DELIVERY                       LAWMIND-DESKTOP-UI-CONTROLS
LAWMIND-EXECUTION-CONSTRAINTS          LAWMIND-EXTERNAL-LEGAL-CAPABILITY-CATALOG
LAWMIND-FUTURE-ISSUES                  LAWMIND-GROK-BOT-BORROW-REVIEW
LAWMIND-LAWYER-QUICKSTART              LAWMIND-LEGAL-COMPILER-ROADMAP
LAWMIND-PRODUCT-ROUTE-COMPARISON       LAWMIND-REPO-LAYOUT
LAWMIND-ROUTE-ASYNC-DECISION           LAWMIND-SKILL-LOGIC-REQUIREMENTS
LAWMIND-SKILL-THREE-LAWS-REVIEW        LAWMIND-STRATEGY-MASTER
LAWMIND-TERMINOLOGY
```

**21 份 vs 7 份。** 而 REPO-LAYOUT 自己那一段也提到了其中几篇（「维护者核对（非正式产品原则）」那段点名了 EXECUTION-CONSTRAINTS、AGENT-PARITY-REVIEW、CHAT-MATTER-FILL）。

### 所以两句话分别是对的

| 说法                           | 管的是                     |
| ------------------------------ | -------------------------- |
| 「现行文档仅 9 篇」            | **口径**——哪些文档是权威的 |
| 「顶层 LAWMIND-*.md 全部同步」 | **机制**——哪些文件会被发布 |

**这两件事不是一回事**：一份文档可以是「已发布但不是权威口径」——比如 `LAWMIND-EXECUTION-CONSTRAINTS.md`（50 条运行时约束清单），REPO-LAYOUT 把它标成「维护者核对（非正式产品原则）」。

**但这里有一个实际的后果值得知道**：**「现行文档」这个集合在代码里没有对应物。**

- 没有一份名单文件写着那 7 篇。
- 同步脚本不读那份名单。
- 侧栏「入门与交付」组登记的也不是那 7 篇。

**所以「现行/非现行」这个划分完全靠人维护 REPO-LAYOUT 那张表**——凡是从代码或配置出发的地方（同步、侧栏），走的都是「前缀 / 手工登记」这两条路。

**这不是 bug，但它是「口径与机制分离」的一个真实例子**。知道这件事的价值在于：**当你看到某篇文档在站上时，不要推断它一定属于「现行 9 篇」。**

### 还有一处「目标树比源树旧」

本地 `apps/lawmind-docs/docs/` 里现在有 **17 份** `LAWMIND-*.md`，而源有 **21 份**。差的是这四份：

```text
LAWMIND-ACCEPTANCE-LAYER-STRATEGY
LAWMIND-GROK-BOT-BORROW-REVIEW
LAWMIND-PRODUCT-ROUTE-COMPARISON
LAWMIND-STRATEGY-MASTER
```

**原因很简单**：同步产物不上版本库，所以本地那份是「上次谁跑过同步」时留下的快照。**跑一次 `pnpm lawmind:docs:dev` 就会补齐。**

而 `docs/lawmind/manual/`（本手册）同理——**现在本地还没有，下次同步就会出现**。

## 71.7 三个命令与它们的实际动作

```text
pnpm lawmind:docs:dev      同步 + vitepress dev      （默认 http://localhost:5173）
pnpm lawmind:docs:build    同步 + vitepress build
pnpm lawmind:docs:preview  vitepress preview         （不同步）
```

**前两个都带同步**——所以「开发/构建前先同步」这件事不需要记（脚本里已经串了）。

**而 `preview` 不带同步**——因为它预览的是**已经构建好的产物**，再同步一次反而会让人以为改了源就生效。

包内也可以直接：

```text
pnpm dev / pnpm build / pnpm preview / pnpm sync
```

**`pnpm sync` 单独存在**——所以只想刷新同步产物时不必要跑整个构建。

**产物位置**：`apps/lawmind-docs/docs/.vitepress/dist`。

### 一处与产品规则的交叉

**开发服务器默认 `http://localhost:5173`，而桌面端渲染层用 `5174`**——两个不同的端口。

**所以「不要打开 5173 当 LawMind」这条规则在端口号上也是分开的**：5173 是文档站，5174 是桌面渲染层。**记混了就会以为文档站是产品。**

## 71.8 已知坑（本章相关）

- **这个站不是产品界面**；不要把文档站（或 5173）当 LawMind 打开。
- **被跟踪的文件只有八个**，其余全是同步产物——`git` 会阻止你改同步产物（它们被忽略）。
- **同步脚本用「前缀规则」而不是「9 篇名单」**——顶层 `LAWMIND-*.md` 全部发布。
- **所以「现行文档 9 篇」是口径，不是发布范围。** 站上有文档不代表它是权威口径。
- **那 9 篇里有 2 篇在仓库根**（`GOALS.md`、`SECURITY.md`），不在 `docs/`。
- **同步会先删目标再复制**（四个目录都是）——所以源里删掉的文件在站上也会消失。
- **`docs/lawmind/` 是整目录递归复制**——手册自动发布，不需要登记。
- **手册在站上有两个入口**（导航顶层 + 侧栏「功能与实现手册」组），但 71 章没有逐章列进侧栏。
- **手册的站上入口有两处**：导航顶层「手册」指向 `/lawmind/manual/README`；侧栏新增「功能与实现手册」组（总目录 + 总索引）。
- **`ignoreDeadLinks: true` 是全局的**（理由：工程笔记必然有仓库路径链接）。
- **`CNAME` 与 `.nojekyll` 不复制就会「站看着正常但域名丢掉 / 文件被 Jekyll 藏」**，所以 CI 有三条断言。
- **导航十项里有五项指向 `/archive/`**（实施类文档归档但仍可达）。
- **侧栏八组里只有两组默认展开**（律师看的那两组）。
- **侧栏里那个 GitHub 链接指向的 org 与打包配置里的不一致**（`lawmind/lawmind` vs `sunhl4/LawMind`）。
- **本地同步产物会比源树旧**（因为产物不入库）——本地 17 份、源 21 份是正常现象。
- **`preview` 不同步**（它预览已构建的产物）。
- **文档站开发端口 5173，桌面渲染层 5174**——两个不同的东西。
- **源目录不存在时同步脚本退出码 1**（不静默跳过）。
