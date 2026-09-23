# 第 56 章 实现精读：本机访问网关

第 15 章从「机制清单」的角度讲过本机访问。这一章从**实现**的角度讲：13 个文件的 `host-access/` 是怎么把「律师的整台电脑」变成「一个受控的、只读的、带案件围栏的资源池」。

## 56.1 四个模式，而不是一个开关

`host-access/types.ts` 定义的核心枚举是：

```ts
HostAccessMode = "matter" | "mounts" | "locate" | "command";
```

四档不是「开多大」，而是**四种不同的能力**：

| 模式      | 能用什么                                         |
| --------- | ------------------------------------------------ |
| `matter`  | 只用工作区（案件材料）。**最严**                 |
| `mounts`  | 工作区 + 已选本机文件夹（**默认值**）            |
| `locate`  | 加上「本机查找」（能找到路径，但读正文仍要授权） |
| `command` | 加上受控本机命令                                 |

`DEFAULT_HOST_ACCESS_POLICY` 的 `mode` 是 **`"mounts"`**。

**为什么默认不是 `matter`**：律师要能把客户发来的材料收进本案，这需要能读本机文件夹。默认卡死在 `matter` 会让「收进本案」这条主路径不可用。所以默认给了 `mounts`，而**挂载点一律只读**（下一节）。

### 默认策略的十一个字段

```ts
{
  mode: "mounts",
  maxMounts: 16,
  spotlightEnabled: true,
  fullDiskAccessOptIn: false,
  allowHostCommands: false,      ← 默认不给命令
  hostCommandLevel: "office",    ← 命令档位默认最窄
  fileTaskReadBudget: 16,
  fileTaskReadHardCap: 48,
  denyPathPatterns: [],
  allowCrossMatterMounts: false, ← 默认不许跨案
  indexBodyInAppSupport: true,
  forceMatterMode: false,
  allowSessionCommands: true,
}
```

三个默认值值得单独看：

- **`allowHostCommands: false`** —— 默认不给本机命令。要开得显式。
- **`hostCommandLevel: "office"`** —— 命令档位默认最窄（只允许办公类）。
- **`allowCrossMatterMounts: false`** —— 默认不许跨案件读别的案子的挂载。

### 环境变量会被「打包态」屏蔽

`resolveHostAccessPolicy` 里有一条：

```text
LAWMIND_PACKAGED === "1" → 忽略 LAWMIND_HOST_ACCESS_MODE 与 LAWMIND_HOST_COMMANDS
```

**打包（真实用户）状态下，环境变量不能改这两个值。** 这与第 13 章那条「生产不可被环境变量改状态」是同一个姿态。

所以在生产里，本机能力的档位只能通过**工作区策略文件**或**界面设置**改。

### 三组数值都要夹范围

| 字段                  | 夹的范围 |
| --------------------- | -------- |
| `maxMounts`           | 1–32     |
| `fileTaskReadBudget`  | 1–64     |
| `fileTaskReadHardCap` | 4–128    |

还有一条联动：

```text
if (fileTaskReadHardCap < fileTaskReadBudget) hardCap = budget
```

**硬上限不能小于软上限**——否则「预算」这个概念自相矛盾。

### 律所版的特殊处理

```text
firm 版：allowSessionCommands 必须是显式 true 才开；且档位是 session 时会降到 workspace
solo 版：只要不是显式 false 就算开
```

**律所版默认更严**：不受信任的「本会话命令」在律所环境默认是关的。

## 56.2 硬黑名单：授权也不能越过

`deny-list.ts` 的头部注释只有一句，但很硬：

```text
Hard deny list for host access. Grants cannot override these paths.
```

**「Grants cannot override」是重点**：哪怕律师明确授权读某个目录，目录里的这些文件也读不到。

### 四组名单

**文件名**（`DENY_BASENAMES`，9 个）：

```text
.env  .env.lawmind  id_rsa  id_ed25519  id_ecdsa  id_dsa
mail-secrets.json  lawmind.policy.json  ethics-wall.json
```

**扩展名**（`DENY_EXTENSIONS`，4 个）：

```text
.pem  .p12  .pfx  .key
```

**目录名**（`DENY_DIR_NAMES`，4 个）：

```text
.ssh  .gnupg  Keychains  Cookies
```

**工作区内的前缀**（`WORKSPACE_DENY_PREFIXES`）：

```text
audit/  sessions/  lawmind/
```

### 四类之外还有三条规则

1. **任何以 `.env` 开头的文件名**都拒（不只是那两个精确名）。
2. **`defaultSensitiveHomeDirs()`** 四个目录：`<home>/.ssh`、`<home>/.gnupg`、`<home>/Library/Keychains`、`<home>/Library/Cookies`。
3. **治理路径**（`governanceRelDenied`）——但**排除 `docs/lawmind`**。

**第 3 条的排除是个细节**：`docs/lawmind/` 是文档目录，不是治理数据，所以不受 `lawmind/` 前缀的拦截。

### 一条「宁可误拒」的注释

`matchesGlobish` 处理 `**/` 开头的模式时，有一处专门的逻辑：

```text
**/<rest> 且 <rest> 以 . 开头时：
  base === rest || base.startsWith(rest + ".") || base.startsWith(rest)
```

**这是为了让 `.env` 这个模式能同时命中 `.env`、`.env.lawmind`、`.env.production`**。否则律师在 `denyPathPatterns` 里写 `.env` 只会拦住精确那一个。

### 那句给律师看的话

```text
该路径属于密钥、钥匙串或治理数据，不能读取。请把需要的材料复制到本案或本机文件夹后再交办。
```

**它做了三件事**：说明为什么拒、说明这类文件是什么、给出替代路径。这是第 32 章那条「拒绝要解释原因并给替代路径」的好例子。

## 56.3 挂载点为什么一律只读

`access-broker.ts` 的头部注释是全章最该读的一段：

```text
挂载点（已选本机文件夹）只读的统一口径。

这是本机能力网关的核心约束：`resolveHostPath(..., { write: true })` 对挂载点一律
返回 `write_forbidden`，律师要把外部材料纳进本案，走「收进本案」复制到案件目录。

桌面侧的文件接口（`/api/fs/write`、`lawmind:fs:write` 等）必须复用同一条文案，
否则会开出一个与网关口径矛盾的写入口。
`apps/lawmind-desktop/electron/fs-bridge.mjs` 持有一份纯 JS 镜像，改动时保持同步。
```

三件事：

1. **挂载点只读是实现层面的硬约束**，不是界面上的提示。
2. **「收进本案」是唯一合法路径**——复制到案件目录，然后在案件目录里改。
3. **桌面侧要复用同一条文案**，否则会出现「网关说不许写、另一个接口却能写」的矛盾。

第 3 点说的那个文案是：

```text
本机文件夹默认不能改写。请使用「收进本案」复制到案件目录。
```

它是 `MOUNT_WRITE_REFUSAL` 常量。**常量被导出，就是为了让桌面侧 import 同一个值**。

而 Electron 侧那份镜像（`fs-bridge.mjs`）因为不能 import TS，只能手抄——第 29.22 节讲过这个漂移风险。

## 56.4 一次路径解析的十一步

`resolveHostPath` 是这一层的核心。它把「律师说了一个路径」变成「一个带权限标签的绝对路径」，或者一个明确的拒绝。

返回类型是二选一：

| 成功 | `{ abs, rel, rootKind, rootId?, writable }` |
| ---- | ------------------------------------------- |
| 失败 | `{ error, message }`                        |

`rootKind` 三种：`workspace` / `mount` / `grant`。

### 十一步顺序（每步的拒绝原因与文案）

| #   | 检查                                  | 失败原因                                               | 给律师的话                                                                                                         |
| --- | ------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| ①   | 空 / 含 NUL                           | `empty`                                                | `路径为空。`                                                                                                       |
| ②   | 相对路径 → 在已选文件夹里找           | `not_found`                                            | 多个命中：`「X」在多个已选文件夹里都有：A、B。请指明是哪一个。`；零命中：`在已选本机文件夹和工作区里找不到「X」。` |
| ③   | realpath + 黑名单（**真实路径也查**） | `deny_list`                                            | 那句密钥/钥匙串/治理数据                                                                                           |
| ④   | 是否属于**其他案件**                  | `cross_matter_denied`                                  | `该路径属于其他案件，本案不能读取。如需核对利益冲突，请用利益冲突检索。`                                           |
| ⑤   | 在工作区内                            | ✅                                                     | `{ rootKind: "workspace", writable: true }`                                                                        |
| ⑥   | 挂载点被挡的情况                      | `ethical_wall` / `cross_matter_denied` / `mode_denied` | 见下                                                                                                               |
| ⑦   | 挂载点 + 写请求                       | `write_forbidden`                                      | `MOUNT_WRITE_REFUSAL`                                                                                              |
| ⑧   | 有匹配的 grant                        | ✅                                                     | `{ rootKind: "grant", writable: kind === "write" }`                                                                |
| ⑨   | 写请求但没 grant                      | `write_forbidden`                                      | `写入只允许工作区。本机路径请先收进本案。`                                                                         |
| ⑩   | 允许 locate 或模式是 locate/command   | `needs_grant`                                          | `尚未允许读取「X」（位于 Y）。请律师选择允许一次、本会话允许或始终允许。`                                          |
| ⑪   | 都不在                                | `escape`                                               | `该路径不在工作区或已选本机文件夹内。请先选择本机文件夹，或改用本机查找。`                                         |

### 三个细节

**第 ③ 步的两个「也」**：注释写着 `denied (claimed or real)`——**声明的路径和真实路径都要查**。因为软链可以让声称的路径看起来干净、真实的路径指向 `.ssh`。

**第 ② 步的相对路径解析**有两层要求：段里不能有 `.`、`..`、空段；而且**多命中时要报出「是哪几个」**（`parent/base` 形式）。这不是随便报个错——律师需要知道要指明哪个。

**第 ⑩ 步的三种授权时长**（`HostGrantDuration`）：`once` / `session` / `always`。文案里把这三种都念出来，是为了让界面能照做。

### 第 ⑥ 步的三种被挡原因

| 原因                  | 文案                                                                     |
| --------------------- | ------------------------------------------------------------------------ |
| `ethical_wall`        | `该本机文件夹绑定的案件与本案当事人对立，已按利益冲突隔离。`             |
| `cross_matter_denied` | `该本机文件夹已绑定其他案件。未打开「允许对照旧案材料」时不能读取正文。` |
| `mode_denied`         | `当前本机能力为「仅本案」，请先在设置里改成已选文件夹。`                 |

**第二条里藏了一个开关**：`allowCrossMatterMounts`（默认 false）。

## 56.5 案件围栏：冲突判定会传递

`matter-fence.ts` 管「这个挂载点能不能在本案用」。

### 当事人从哪来

`readMatterParties` 的顺序：

```text
① loadMatter → deriveMatterIdentity(hydrateMatterParties(rec))，优先 clientId / counterparty
② 失败 → 读 cases/<id>/CASE.md，用 parseMatterCaseProfileFields 抠
③ 再失败 → {}（空对象）
```

**两级回落**：新的 JSON 真相源优先，老的工作区只有 CASE.md 也能用。

### 冲突的判据只有一条

```text
partiesConflict(a, b):
  (a.clientId === b.counterparty) || (a.counterparty === b.clientId)
```

**「我方客户是对方当事人」或「我方对方是对方客户」**——两种对称的情况都判冲突。

**注意它只比 clientId 与 counterparty 两个字段**，不比名字。所以如果两边都没填 id，判不出冲突。这是实现的边界。

### 传递性：这条最值得记

`activeMountsForSession` 的逻辑：

```text
初始 acceptedParties = 本案当事人
逐个数每个挂载点：
  · 绑了别的案件且不许跨案 → blocked "cross_matter"
  · 它的当事人与「已接受的任一方」冲突 → blocked "ethical_wall"
  · 否则 → 放行，并把它的当事人加进 acceptedParties
```

**「加进 acceptedParties」这一步就是传递性**：如果 A 挂载点的当事人和 B 挂载点冲突，那么当 A 先被接受、B 后处理时，B 会被判冲突。

也就是说：**系统不只看「挂载点 vs 本案」，还看「挂载点 vs 已经允许的别的挂载点」**。这是漏掉就出事的细节——不然律师可以靠「多挂几个目录」绕过冲突检查。

### `mode === "matter"` 时全部挡掉

```text
mode === "matter" → active: []，每个挂载点 blocked "matter_mode"
```

**`matter` 模式不是「优先用案件材料」，而是「一个挂载点都不用」**。

### 工作区里别的案件也是禁区

`workspaceOtherMatterDenied`：

```text
没有 sessionMatterId → false（不拦）
路径不在 <workspace>/cases 下 → false（不拦）
首个相对段 ≠ sessionMatterId 且不是 ".." → true（拦）
```

所以 `cases/other-matter/CASE.md` 在本案里读不到。**这条防的是「用文件工具读隔壁案子的卷宗」**。

## 56.6 本机助手 API：五个函数

`hostd.ts` 的头部注释说明了它的定位：

```text
In-process host helper (本机助手). Same API a future lawmind-hostd would expose.
Tools call these functions instead of touching the filesystem directly.
```

**「Same API a future lawmind-hostd would expose」**——现在它是进程内函数，将来可能变成独立进程。所以**工具不许直接碰文件系统，只能调这五个函数**。

| 函数                                      | 做什么                      |
| ----------------------------------------- | --------------------------- |
| `hostdList(runtime, mountId?)`            | 列某个挂载点的直接子项      |
| `hostdSearch(runtime, query)`             | 搜索（转发到 `searchHost`） |
| `hostdRead(runtime, rawPath)`             | 读文本                      |
| `hostdImport(runtime, rawPath, matterId)` | 收进本案                    |
| `hostdRebuildIndex(runtime)`              | 重建索引                    |

### `hostdRead` 的五个分支

| 情况     | 结果                                                              |
| -------- | ----------------------------------------------------------------- |
| 解析失败 | `{ ok: false, error, needsGrant }`（`needsGrant` 由错误类型推导） |
| 是目录   | 返回递归列举的文本（目录带 `/` 后缀）                             |
| 不是文件 | `not_found` + `不是文件。`                                        |
| 超过 1MB | `too_large` + **`文件过大，请先收进本案再分段阅读。`**            |
| 含 `\0`  | `binary` + 下面那段长文案                                         |
| 其他     | 全文                                                              |

**二进制文件那段文案**（`MAX_TEXT_READ_BYTES = 1000000`）：

```text
这是 PDF、Word 等二进制材料，本工具只读纯文本。请用 analyze_document 或
read_folder_documents 读正文；要归档再用 import_host_file（可传整个文件夹）。
```

**它不只是说「不行」**，而是把「该用哪个工具读正文」和「该用哪个工具归档」都指了出来。这是好错误设计的又一个例子。

### `hostdImport` 的三个检查

**第一个：案件 id 的判定**（`pickImportMatterId`）有三层：

```text
① id 不合规 → 拒：请先关联案件再收进本案。
② cases/<id> 或 matters/<id>/matter.json 存在 → 用它
③ 否则按名字匹配（CASE.md 的标签 / matter.json 的 title，忽略空白）
     多个匹配 → 拒：有多个案件都叫「X」。请打开要收进的那一件再交办。
```

**第 ③ 层的「多个匹配就拒」**很重要：律师说「收进 XX 案」，如果有两个案子叫类似的名字，**系统不猜**，而是让他指明。

**第二个：源路径解析**（复用 `resolveHostPath`，`allowLocateHint` 开）。

**第三个：目标位置**：

```text
destDir = <workspace>/cases/<matterId>/materials
destRel = cases/<matterId>/materials/<原文件名>
```

**注意目标永远是「案件的 materials 目录」**，不是工作区根也不是别的地方。这是「收进本案」的确切含义。

**写权限检查**：调 `resolveHostPath(..., { write: true })`——所以如果目标是挂载点会被拒。

### 目录导入的五个上限

| 常量                     | 值    |
| ------------------------ | ----- |
| `IMPORT_MAX_FILES`       | 200   |
| `IMPORT_MAX_DEPTH`       | 8     |
| `IMPORT_MAX_FILE_BYTES`  | 50MB  |
| `IMPORT_MAX_TOTAL_BYTES` | 200MB |

超了会**截断并标 `truncated: true`**，而不是失败。但如果一个文件都没复制成，会报：

```text
文件夹过大或层级过深，没有复制进本案。
文件夹里没有可收进本案的文件。
```

**「截断但有收获」和「一个都没成」是两种结果**，文案分开。

导入目录时会跳过：软链接、被拒路径、点开头的目录、逃出根的文件。

## 56.7 索引：一个「便宜且诚实」的设计

`host-index.ts` 把每个挂载点的文件索引成一份 JSON：

```text
<应用数据根>/host-index/host-index.json
```

结构：

```text
{ schemaVersion: 1, mounts: { <mountId>: { absPath, files: [{ rel, name, ext, size, mtimeMs, body? }] } } }
```

**读失败或版本不对就返回空索引**（不是抛错）。

### 四个上限与两个跳过名单

| 常量                  | 值                                         |
| --------------------- | ------------------------------------------ |
| `MAX_FILES_PER_MOUNT` | 4000                                       |
| `MAX_BODY_CHARS`      | 32000                                      |
| `MAX_INDEX_DEPTH`     | 8                                          |
| `TEXT_EXT`            | `.md .txt .json .csv .html .xml .log .tex` |

跳过名单（`SKIP_DIR`）：

```text
node_modules  .git  .svn  dist  release  __pycache__  .lawmind
```

**只索引文本扩展名且 ≤32000 字节的文件才有 `body`**。所以索引里大部分条目只有元数据，没有正文。

### 搜索排序：插入顺序

`searchHostIndex` 的匹配逻辑很朴素：

```text
hay = `${file.name} ${file.body ?? ""}`.toLowerCase()
命中 = hay.includes(q)
snippet = body 里命中位置前后各取一段
```

**排序是「插入顺序」**——代码注释里没写排序函数，所以是「谁先遍历到谁先出」。挂载点对象顺序 → 文件顺序 → 取前 `limit` 条。

**这是一个刻意的取舍**：不做模糊评分，就没有「为什么这条排前面」的疑问。**代价是相关性不如评分**。

### 命中会再查一次黑名单

```text
re-checks deny list
```

索引是**之前**建的，黑名单可能变过。所以出结果前再查一遍——这也是为什么黑名单不能只依赖索引。

## 56.8 三路搜索：名字、索引、系统查找

`host-search.ts` 的 `searchHost` 依次用三种方式：

| 路               | 函数                                | 特点                              |
| ---------------- | ----------------------------------- | --------------------------------- |
| ① 挂载点名字扫描 | `searchMountsByName`                | 走文件系统，最多 800 文件、深度 8 |
| ② 索引           | `searchHostIndex`                   | 走索引（快，但可能陈旧）          |
| ③ 系统查找       | `searchSpotlight` / `searchWindows` | **有条件**                        |

### 第 ① 路的匹配规则有三条

```text
basename 含 query（小写）
或 query === 扩展名（含点）
或 query === 扩展名去掉点
```

**后两条是为了「找所有 pdf」这种用法**。

### 第 ③ 路的两个条件

```text
spotlightEnabled && (mode 是 locate/command 或 fullDiskAccessOptIn)
```

也就是：**要么开了定位模式，要么律师显式给了全盘访问**。而且 macOS 用 `mdfind`（超时 4000ms），Windows 走自己遍历。

查询会被消毒：

```text
query.replace(/["'\\]/g, " ").trim().slice(0, 80)
```

**剥引号和反斜杠**是防 shell 参数注入（虽然这里用的是 `spawnSync` 数组形式）。

### 未授权命中会被「脱敏」

```text
needsGrant: true
absPath: undefined       ← 不给绝对路径
locateAbs: abs           ← 只给「定位用」的路径
snippet: undefined       ← 不给正文片段
```

**这是「能找到但不能读」的实现**：律师能看到「有这么个文件」，但系统不会把路径和内容直接给模型。授权之后才能读。

### 去重与限量

```text
dedupe key = hit.absPath ?? `${displayName}:${parentName}`
```

`searchHost` 默认 `limit = 16`。

## 56.9 受控命令：三档与两张名单

`host-command.ts` 是这一层风险最高的部分（它真的执行命令）。

### 三档的层级关系

```text
rank = { office: 1, workspace: 2, session: 3 }
allowed when rank[configured] >= rank[needed]
```

| 档          | 名单                          |
| ----------- | ----------------------------- |
| `office`    | `officecli`、`mdfind`、`mdls` |
| `workspace` | `git`、`python`、`python3`    |
| `session`   | 其他（需要本会话显式允许）    |

### 禁止名单

```text
sh  bash  zsh  fish  dash  cmd  cmd.exe  powershell  powershell.exe  pwsh  pwsh.exe
sudo  osascript  curl  wget
```

**十五个**。包括 shell、提权、AppleScript、网络下载工具。

### officecli 的特殊处理

officecli 是这一层最特殊的：**它的位置参数是「文档选择器」而不是文件路径**。所以有一条专门的校验正则：

```text
OFFICECLI_SELECTOR_RE = /^\/(?:body|header|footer|comments?|endnotes?|footnotes?|styles|numbering|settings|theme|metadata|docProps|revision|slide|sheet)\d*(?:\[[^\]]*\])?(?:\/.*)?$/i
```

**裸 `/` 也接受**。注释解释了为什么需要这条：

```text
officecli：可改写文件，且它的**位置参数是文档选择器**而不是文件系统路径。
```

也就是说，不排除这些参数的话，「参数路径必须在已授权目录内」那条检查会把合法调用误拒。

还有一条注释：

```text
宁可误拒也不误放。
```

**这是这一层的设计姿态**：不确定就拒。

### 另外两条 officecli 约束

1. **officecli 的 cwd 必须在工作区内**（注释：「相对路径参数以 cwd 为基准解析，所以写类命令的 cwd 也必须留在工作区内」）。
2. **officecli 的 roots 只有工作区**（不是 `allowedRootsForCommands` 那套）。

### 七步拒绝（每步的确切文案）

| #   | 情况                     | 文案                                                                                        |
| --- | ------------------------ | ------------------------------------------------------------------------------------------- |
| ①   | 策略没开命令             | `未打开本机命令。请到设置「本机能力」允许本机命令。`                                        |
| ②   | 在禁止名单               | `不允许运行 <名字>。`                                                                       |
| ③   | session 档但策略不允许   | `该命令超出办公/工作副本白名单。Solo 可在本机能力中打开「本会话命令」。`                    |
| ④   | session 档但本会话没允许 | `请先在本会话确认「本机命令：本会话允许」。`（带 `needsApproval: true`）                    |
| ⑤   | 档位不足                 | workspace：`请在本机能力中把本机命令档位调到「工作副本」。`；其他：`当前本机命令档位不足。` |
| ⑥   | 非 office 档且未批准     | `该本机命令需要律师确认后才能执行。`（带 `needsApproval: true`）                            |
| ⑦   | 命令找不到               | `找不到命令：<名字>`                                                                        |

第 ⑥ 步还有一条参数检查：

```text
参数路径不在已授权目录内：<basename>
```

**只报 basename，不报完整路径**——这也是路径脱敏的一种。

### 执行与截断

```text
runSafeCommand({ ..., timeoutMs: 30000 })
stdout.slice(0, 12000)
stderr.slice(0, 2000)
```

**30 秒超时、stdout 截 12000 字符**。这两个数字是「够用但不失控」的取舍。

### 路径解析的两条回落

```text
officecli → resolveOfficeCliBin({ explicit })   ← 走第 57 章那个解析器
其他     → resolveOnPath（PATH 拆分，win32 试 .exe/.cmd/.bat）
```

## 56.10 本机访问日志

`host-log.ts` 很小，但有三点值得记。

### 八个动作

```ts
action = "search" | "read" | "import" | "command" | "grant" | "deny" | "revoke" | "index";
```

**注意它记的不只是「做了什么」，还记 `deny`（被拒）与 `revoke`（撤销授权）**。所以事后能看出来「有人试图读但被拒了」。

### 记录形状

```text
{ at, action, sessionId?, matterId?, path?, detail?, ok }
```

### 两条纪律

```text
logDir 为空 → 直接返回（no-op）
出错 → 吞掉（注释：logging must not break tools）
```

第二条很重要：**日志写失败不能影响工具执行**。这与审计那条「best-effort」是同一个姿态。

`readHostAccessLog(logDir, limit = 100)` 读尾部 N 条，跳过坏行。

## 56.11 会话级授权的内存状态

`host-store.ts` 维护三份内存状态：

```text
sessionGrantStore: Map<sessionId, HostGrant[]>     ← 本会话的授权
sessionCommandStore: Set<sessionId>                ← 允许本会话命令的会话
locateHitStore: Map<sessionId, Map<hitId, abs>>    ← 定位命中的路径
```

**第三份值得单独说**：`rememberLocateHit` / `resolveLocateHit` 让「律师在搜索结果里看到了某个文件，然后说『就读那个』」这件事能成立——因为搜索时只给了 `hitId`，没给绝对路径（第 56.8 节），所以需要一个 `hitId → abs` 的映射来兑现。而且它**按会话隔离**。

持久化的那部分（磁盘上的 `host-access.json`）校验 `schemaVersion: 1`，坏 JSON 返回空默认值。

`addMountToStore` 超过上限会抛：

```text
本机文件夹已达上限（16）
```

`migrateProjectDirToMounts` 把老的「项目目录」概念迁移成一个 `id: "project"` 的挂载点——这是老概念向新概念的一次兼容迁移。

### 存储路径的三平台回落

```text
① LAWMIND_HOST_ACCESS_FILE 环境变量
② macOS：<home>/Library/Application Support/LawMind/host-access.json
③ Windows：<APPDATA 或 <home>/AppData/Roaming>/LawMind/host-access.json
④ 其他：<home>/.config/LawMind/host-access.json
```

## 56.12 摄取：OCR 为什么要律师确认

`ingest/ocr/index.ts` 是这条链路的入口。它的头部注释讲了四件事，其中最关键的是一句：

```text
Confirmation gate: callers should not auto-commit OCR text into matter
knowledge without lawyer confirm (see confirmOcrExtraction).
```

**OCR 结果不许自动进案件知识库。** 为什么？因为 OCR 会认错字。一个数字错一位，整份材料的引用就错了。所以**必须律师看一遍**。

### 两个 provider

```ts
OcrProviderId = "local_tesseract" | "cloud_placeholder";
```

本地走 `tesseract.js`（动态 import），支持 `png` / `jpg` / `webp` / `tif`。**PDF 光栅化明确标为 future work**。

云 OCR 是**占位**（`LAWMIND_OCR_CLOUD=1` 才启用），返回空文本加一句：

```text
云 OCR 未接入（占位）：请配置厂商后实现；或关闭 LAWMIND_OCR_CLOUD 使用本地 tesseract。
```

**占位就明说是占位**，不假装能用。

### 语言默认

```text
LAWMIND_OCR_LANGS 默认 "chi_sim+eng"，按 "+" 拆分，空则回落到 "eng"
```

### 三种结果文案

| 情况   | 文案                                                |
| ------ | --------------------------------------------------- |
| 有文本 | `本地 OCR 完成：请律师确认后再写入案件知识库。`     |
| 无文本 | `本地 OCR 无文本：请检查图片清晰度或改用人工录入。` |
| 云占位 | 见上                                                |

而且 `OcrExtraction` 里有一个**固定为 true 的字段**：

```ts
needsLawyerConfirmation: true;
```

**它不是参数，是常量**——设计上不允许「不确认就入库」。

### 确认入库

`confirmOcrExtraction` 的两个前置校验：

| 情况                                | 错误                |
| ----------------------------------- | ------------------- |
| 文本为空                            | `empty_ocr_text`    |
| matterId 含 `..` / `/` / `\` 或为空 | `invalid_matter_id` |

写入位置：

```text
<workspace>/matters/<matterId>/ocr-confirmed/<时间戳>-<文件名>.md
```

文件名会被消毒（`[^\w.\-()\u4e00-\u9fff]+` → `_`，截 80 字，兜底 `"scan"`）。

正文结构固定：

```text
# OCR 确认入库
- 来源：...
- 确认人：...
- 确认时间：...
---
<OCR 文本>
```

**「确认人」那一行是审计的落点**：入库的文本带着「谁确认的」。

## 56.13 已知坑（本章相关）

- **本机能力有四档（matter / mounts / locate / command），不是一个开关。** 默认 `mounts`。
- **`matter` 模式会挡掉所有挂载点**，不是「优先用案件材料」。
- **打包态忽略 `LAWMIND_HOST_ACCESS_MODE` 与 `LAWMIND_HOST_COMMANDS`。**
- **硬上限不能小于软上限**（有联动修正）。
- **黑名单的授权也越不过。** 「Grants cannot override」。
- **`docs/lawmind` 被排除在治理路径拦截之外。**
- **挂载点一律只读，文案必须与桌面侧一致**（两处手抄，会漂）。
- **路径解析要同时查「声称的路径」和「realpath 之后」。**
- **案件围栏有传递性**（挂载点之间也互相判冲突）。这是不能删的细节。
- **`cases/<别的案件>/` 在本案里读不到。**
- **「收进本案」的目标永远是 `cases/<id>/materials/`。**
- **案件名有多个匹配时拒，不猜。**
- **目录导入超限是「截断」不是「失败」**，但一个文件都没成会报错。
- **索引搜索按插入顺序排，不做相关性评分。**
- **未经授权的命中不给绝对路径、不给正文片段。**
- **officecli 的参数是「文档选择器」，不是路径。** 那条正则不能删。
- **officecli 的 cwd 必须在工作区内。**
- **命令档位是三档且按 `rank` 比较**，不是按名字白名单。
- **用户中断、日志失败都不许影响主流程。**
- **OCR 结果必须律师确认才能入库**（`needsLawyerConfirmation` 是常量）。
- **PDF 光栅化还没做。** 云 OCR 是占位。
