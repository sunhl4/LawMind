# 第 67 章 实现精读：端口契约、凭据派生与 macOS 打包

第 66 章讲了进程与桥面。这一章讲三块：

```text
local-server.mjs              端口选择、子进程 spawn、环境注入、崩溃监督（1178 行）
local-api-port-contract.mjs   端口漂移与清单落点的纯函数
local-api-credentials.mjs     凭据派生（唯一真相源）
server-supervision.mjs        退避策略纯函数
host-access-store.mjs         本机目录持久层
mac-gatekeeper.mjs 等         签名与公证
```

这一章的核心是一条**事故线**：2026-09-21 那次故障，同时解释了「为什么端口要持久化」与「为什么凭据要派生」。

## 67.1 那条事故线：三件事相乘

`local-api-credentials.mjs` 的头注释把事故写得很完整：

```text
2026-09-21 实测故障：Word 任务窗格报 `unauthorized`，且此后每次 LawMind 重启都复发。
根因不是鉴权写错，而是**一把「每进程随机、只下发一次」的共享令牌同时服务四种能力
完全不同的客户端**。三个事实相乘：

  1. 端口是**持久化**的（`desktop-config.json` 的 `apiPort`）—— 这是有意为之，
     为的是侧载清单里写死的地址不因重启失效；
  2. 而令牌是**进程级**的（每次启动 `randomBytes(32)`）；
  3. 加载项只在**页面加载时**取一次令牌（CSP 只放行同源脚本，没有第二条投递通道）。

于是必然出现「地址不变、钥匙变了」⇒ 重启后所有已打开的窗格一律 401，且客户端
无处重新发现新钥匙，只能人工重载窗格。
```

**「三个事实相乘」**这个说法很准确：**每一条单独看都合理，合起来必然出事**。

| 事实               | 单独看为什么合理                        |
| ------------------ | --------------------------------------- |
| 端口持久化         | 否则侧载清单里的地址会失效              |
| 令牌进程级         | 否则旧的令牌会一直有效（安全上更差）    |
| 加载项只取一次令牌 | 因为 CSP 只放行同源脚本，没有第二条通道 |

**结论：地址不变、钥匙变了。** 而客户端无处发现新钥匙。

### 还有一层更根本的缺口

```text
更根本的一处：共享令牌在**结构上**回答不了「这次改稿是从 Word 来的，还是从桌面端
来的」—— 审计只能记 `actorId`（是谁），记不出来源（从哪来）。对一个把审计链当
核心的产品，这是实质缺口，且只有引入客户端身份才能修。
```

**「记不出从哪来」**——一把共享令牌意味着服务端不知道调用者是谁。**这不是靠加日志能补的，必须改身份模型。**

### 同一件事的另一面：端口漂移

`local-server.mjs` 那边记的是同一次故障的另一半（注释原文）：

```text
2026-09-21 实测故障正是如此：持久化端口被另一个实例占着 → `pickPort` 静默回退随机
端口 → 窗格先报 `unauthorized`（旧凭据），服务换端口后变成 `Load failed`（网络错误）。
```

**注意症状的演变**：先是 `unauthorized`（旧凭据），换端口后变成 `Load failed`（网络错误）。**两种报错指向两个不同的根因**，这正是那次故障难查的原因。

而 `local-api-port-contract.mjs` 的头注释给了一个更精确的定性：

```text
## 为什么端口是「契约」

Word 的侧载清单把回环端口**钉死**在文件里：清单由服务端按请求的实际 `Host` 现场
生成，但律师**存盘并侧载之后**那个端口就固定了。于是端口和安装密钥一样，属于
**持久化契约**的一部分 —— 任何静默改变它的行为都会让所有已侧载的窗格失联。
```

**「端口和安装密钥一样，属于持久化契约」**——这句话是整章的题眼。

## 67.2 端口选择：五步

`pickPort` 的算法**没有端口区间扫描，也没有 `EADDRINUSE` 字面量**——它靠 `net.Server` 的 `'error'` 事件。

### 五步

```text
① preferredPort = apiPort || readPersistedApiPort()
     进程内优先；跨 app 重启用持久值
② 若 preferredPort > 0 且绑不上 → probePortOccupant(preferredPort)（只为诊断）
③ pickPort(preferredPort)
     合法 → 试着 listen(127.0.0.1, want)
            成功 → close，用 want
            失败 → listenEphemeralPort()
     非法 → 直接 listenEphemeralPort()
④ apiPort = port; persistApiPort(port)
⑤ loopbackPortDrift = buildPortDrift({ preferredPort, actualPort, occupant })
     非空 → 打警告
```

**第 ② 步只管诊断，不管绑定**（注释：`这一步只为诊断，绑定仍交给 pickPort`）——所以「查出谁占着」与「换端口」是两件事。

**第 ③ 步那个「listen 成功再 close」是实现细节**：Node 没有「试绑」API，只能真绑一次再放掉。**这制造了一个竞态窗口**——所以外层有三次重试（见下）。

### 「持久化端口」的由来

`readPersistedApiPort` 上面那段注释解释了整件事：

```text
为什么需要：`apiPort` 只是**进程内**记忆，整个 app 重启后会归零 → `pickPort(0)` 走
`listen(0)` 拿随机端口。于是端口每次启动都换一个，而 Word 插件侧载的 `manifest.xml`
里写死的是取清单那一刻的端口 → 律师侧载一次，重启 app 后插件就加载不出来。
持久化后跨重启复用同一端口，侧载清单不再失效。
```

**先做了持久化**（修一个问题），**然后持久化引入了新问题**（端口被占时静默回退）。这一段是这个功能演进的真实记录。

### 那句承认「静默是根因」的话

```text
**但「回退随机」这一步是静默的，而这正是 2026-09-21 那次故障的根因**：
持久化端口被另一个实例占着时，app 悄悄换到随机端口，于是所有已侧载的 Word 窗格
全部失联 —— 而且窗格无处重新发现新端口（发现端点也挂在旧 base 上）。
所以现在把漂移**记录下来并暴露出去**（见 `loopbackPortDrift`）。
```

**「回退随机这一步是静默的」**——代码本身没错（换端口比绑不上强），**错在没告诉任何人**。所以修法是记录并暴露。

### 占用者判定：问它「是不是本机 API」

```text
/**
 * 谁占着这个端口 —— 决定要不要告诉用户「另一个 LawMind 正在跑」。
 *
 * 判据不是进程名（不可靠），而是**问它是不是本机 API**：发现端点只有 LawMind 会回，
 * 且回的是我们的形状（判定逻辑在纯模块里，可单测）。
 */
```

实现是 `fetch("http://127.0.0.1:<port>/.well-known/lawmind-local", { signal: AbortSignal.timeout(1200) })`。

**而形状校验有三条**：

```text
instanceId 是非空字符串
clients 是数组
epoch 是数字
```

注释说明了为什么这三条够：

```text
判据取的是**形状**而不是进程名或端口 —— 进程名不可靠，端口本身就是我们在查的东西。
形状要求 `instanceId` + `clients[]` + `epoch`（三者都由我们的发现端点产出），
所以巧合通过的概率极低。
```

**「端口本身就是我们在查的东西」**——所以不能用端口当判据（循环）。

### 三态占用者，而且 `unknown` 不等于 `foreign`

```text
another-lawmind   另一个 LawMind 实例
foreign           外部程序
unknown           探测不到
```

那句话值得完整记：

```text
`occupant` 三态是刻意的：`unknown` 不等于 `foreign` —— 探测不到占用者时可能是外部程序，也可能是刚崩掉的残留，把它们混为一谈会让排障的人往错的方向查。
```

**「会让排障的人往错的方向查」**——所以宁可说「不知道」。

### 漂移警告的完整文案

```text
[LawMind] 本机 API 端口从 <持久端口> 漂移到 <实际端口>：<持久端口> 被<占用者>占用。
Word 加载项的侧载清单把端口钉死（http://localhost:<持久端口>/word-addin/taskpane.html），
因此在重新侧载清单之前，已打开的窗格会报「无法加载」或加载失败。
请在「设置 → 体检」里用「重新侧载 Word 清单」修复。
```

**四段结构**：现象（漂移到哪）、机制（清单钉死端口）、后果（窗格失效）、**出路（去哪修、点哪个按钮）**。

而占用者那三个词在日志里是这样拼的：

```text
另一个 LawMind 实例
其它程序
其它程序（该端口不响应本机 API 探测，无法进一步区分）
```

**第三个把「无法区分」直接说出来**——而不用一个含糊的中性词。

### `loopbackPortDrift` 为什么必须导出

```text
为什么要暴露而不是只打日志：Word 侧载清单把端口钉死，漂移 ⇒ **所有已侧载窗格失联**，
且窗格自己无法重新发现（发现端点也在旧 base 上）。这是「静默违反持久化契约」，
必须让律师在体检面板里看得见，而不是等在 Word 里报一句没头没尾的加载失败。
根因治理见 `main.mjs` 的单实例锁。
```

**「静默违反持久化契约」**——这是对问题的准确定性。而最后一句指出：**真正的根治是单实例锁**（第 66.1 节第 ⑦ 步）——**不允许多实例，就不会有别人占着端口**。

漂移记录的形状是 `{ requestedPort, actualPort, occupant }`——而它经 `lawmind:get-config` 直达界面。

### 三次重试与它的理由

```text
// pickPort→bind 竞态（listen(0)+close 后端口被抢注）：杀残留子进程、换端口重试。
```

退避是 `150 × 第几次` 毫秒，最多 3 次。

**这是一个很窄的竞态**（试绑与真绑之间），但它的后果很重（整个服务起不来），所以值得重试。

### 端口落盘在哪

**没有 `lawmind-port` 这样的握手文件**（全仓 0 处命中）。端口只写一个地方：

```text
<userData>/LawMind/desktop-config.json  →  { ...原内容, apiPort: <数字> }
```

写入是「读-改-写」合并式的（保留其他键），`JSON.stringify(..., null, 2)`。注释：

```text
/** Best-effort：端口复用是优化，写盘失败绝不能影响启动。 */
```

**「写盘失败绝不能影响启动」**——所以它是 try/catch 的。

## 67.3 子进程：spawn 与二十五项环境注入

### 两条启动路径

| 场景 | 命令                                                                               | cwd          |
| ---- | ---------------------------------------------------------------------------------- | ------------ |
| 打包 | `<resources>/lawmind-server/lawmind-local-server.cjs`                              | 脚本所在目录 |
| 开发 | `node --import tsx <repoRoot>/apps/lawmind-desktop/server/lawmind-local-server.ts` | 仓库根       |

**开发态找不到脚本时报**：

```text
Server script not found: <路径>
```

而 `resolveNodeExecutable` 三级回落：

```text
① LAWMIND_NODE_BIN
② 打包态：<resources>/node-runtime/<平台-架构>/(node.exe 或 bin/node)
③ 字面量 "node"（走 PATH）
```

`<平台-架构>` 是 `` `${process.platform}-${process.arch}` ``（如 `darwin-arm64`）。

**stdout/stderr 都 pipe 到主进程**——所以服务端日志与桌面日志混在一起看。**stdio 是 `["ignore", "pipe", "pipe"]`**（stdin 不用）。

### 注入的环境变量：四大类

`serverEnv` 是「`process.env` + 下表」的合并。

**第一类：坐标与开关（十三项）**

| 变量                                | 值                               |
| ----------------------------------- | -------------------------------- |
| `LAWMIND_WORKSPACE_DIR`             | 工作区路径                       |
| `LAWMIND_DESKTOP_PORT`              | 最终绑定的端口                   |
| `LAWMIND_ENV_FILE`                  | `<lawMindRoot>/.env.lawmind`     |
| `LAWMIND_REPO_ROOT`                 | 仓库根                           |
| `LAWMIND_RETRIEVAL_MODE`            | `dual` 或 `single`               |
| `LAWMIND_PROJECT_DIR`               | 项目目录或空串                   |
| `LAWMIND_HOST_ACCESS_FILE`          | `<lawMindRoot>/host-access.json` |
| `LAWMIND_AUDIT_EXTERNAL_ANCHOR_URL` | 仅非空时（来自 desk-settings）   |
| `LAWMIND_PACKAGED`                  | 仅打包态 `"1"`                   |
| `LAWMIND_RESOURCES_PATH`            | 仅打包态                         |
| `LAWMIND_OFFICECLI`                 | officecli 可执行文件路径         |

**第二类：凭据与代次（五项）**

```text
LAWMIND_LOCAL_API_INSTALLATION_SECRET
LAWMIND_LOCAL_API_EPOCH
LAWMIND_LOCAL_API_REVOKED_CLIENTS
LAWMIND_LOCAL_API_INSTANCE_ID
```

**第三类：从密钥链取的密钥（八类）**

```text
LAWMIND_AGENT_API_KEY
LAWMIND_QWEN_API_KEY
LAWMIND_DEEPSEEK_API_KEY
LAWMIND_PROVIDER_OPENAI_API_KEY
LAWMIND_WEB_SEARCH_API_KEY / BRAVE_API_KEY
LAWMIND_CUSTOM_<大写 UUID>_API_KEY
LAWMIND_MCP_<大写 ID>_SECRET
LAWMIND_AUDIT_CHAIN_KEY
LAWMIND_MAIL_SECRETS_KEY
```

**每一条都有「且 env 文件未设」的前置条件**——所以 **`.env.lawmind` 里的显式配置优先于密钥链**。

而自定义模型与 MCP 的变量名是**动态生成**的：

```text
LAWMIND_CUSTOM_<uuid 里非字母数字替成下划线、转大写>_API_KEY
LAWMIND_MCP_<id 同上>_SECRET
```

**这个命名规则必须与引擎侧一致**（否则引擎读不到）——第 55 章讲模型层时验证过。

**第四类：一个被删掉的变量**

```text
打包态且 LAWMIND_SKIP_API_AUTH === "1" → 删掉它
```

并打一行日志：

```text
[LawMind] LAWMIND_SKIP_API_AUTH=1 is ignored in packaged builds; loopback API auth remains enabled.
```

**这是第 63.4 节那条「打包版忽略 dev 开关」的**第二道**保险**：服务端自己会忽略，主进程还会**根本不给**。

### 为什么用户密钥要绕一圈经密钥链

因为 `.env.lawmind` 是明文文件。**从某版开始，前端保存 API Key 时写密钥链、并从 env 文件里删掉对应的键**（`ipc-handlers.mjs` 的 `writeLawmindEnvWithoutKeys`），而服务端启动时再由主进程把密钥链的值注进去。

那条注释说明了为什么必须删：

```text
// Env-file keys win over keychain at server bootstrap; strip so the new keychain secret is not shadowed by a stale plaintext key from an earlier save.
```

**「env 文件的键会盖住密钥链」**——所以不删的话，新的密钥链密钥会被旧的明文键遮蔽。**这是一处很具体的「优先级导致更新失效」的坑。**

## 67.4 凭据派生：唯一真相源

`local-api-credentials.mjs` 166 行，但被两个进程共用（主进程与服务端）——所以是**唯一真相源**。

### 派生公式

```text
credential(clientId, epoch) = HMAC-SHA256(installationSecret, `${clientId}:${epoch}`)
                            → 十六进制摘要
```

**服务端不存任何每客户端凭据**——验签时现算。注释说明了好处：

```text
服务端**不存**任何每客户端凭据 —— 验签时现算（`timingSafeEqual` 常量时间比较），
所以吊销与轮换都只是「改名单 / 加一个整数」，不需要迁移任何存储。
```

**「吊销与轮换只是改名单 / 加一个整数」**——这是派生式设计的直接收益。

### 三个好处

```text
- **跨重启稳定**：密钥持久化 ⇒ 同一 clientId 的凭据不变 ⇒ 窗格不再被打断。
- **可归属**：服务端比对时就知道来的是哪个客户端 ⇒ 审计多一维，且可挂 scope。
- **可单独吊销**：`revoke` 撤单个客户端；`epoch += 1` 撤全部。
```

**第二条是那个「更根本的缺口」的修法**——现在服务端知道调用者是 `word-addin` 还是 `renderer`。

### 为什么不用 OAuth + PKCE

这一段推理很值得读：

```text
业界把回环 + PKCE 当默认答案（RFC 8252 / MCP 授权规范，Codex、VS Code、Claude Code
在**远端**授权场景都用它）。但 PKCE 防的是「授权码被本机其他 app 截走」，而这里的
AS 与 RS 是同一个进程、授权码本身就是发给自己的令牌 —— 防了个寂寞。等 LawMind 真把
自己作为 MCP server 暴露给外部 agent 时再上；届时发现端点（见 §发现）已经就位。
```

**三层**：

1. 承认业界默认做法（点名了 RFC 与三个同类产品）。
2. **说清为什么在这里不适用**：AS 与 RS 同进程，「授权码」就是令牌 ——「防了个寂寞」。
3. **什么时候该上**：真做 MCP server 给外部 agent 时。而且**现在就把发现端点准备好了**。

**这段是「拒绝流行方案并说明理由」的好例子**——它没有说 PKCE 不好，而是说**它防的威胁在这里不存在**。

### 宽限窗口：为什么是「一代」

```text
/**
 * 轮换宽限：验签时同时接受 `epoch` 与 `epoch-1`。
 *
 * 为什么需要：轮换若立即生效，所有在途客户端会在同一瞬间集体 401。给一代宽限，
 * 客户端可在下一次发现时自愈，而不是一起炸掉。宽限有界（默认一代），不是无限期。
 */
```

**「让客户端自己发现并自愈」**——配合发现端点（第 63.2 节），这是完整的自愈闭环。

接受代次的算法：从 `current` 往下数 `grace + 1` 个（且不小于 1），默认 `[当前代次, 上一代次]`。

### 那对「不要泄露接近哪个客户端」的顾虑

```text
遍历顺序固定在 `LOCAL_API_CLIENTS`（不依赖调用方输入），且每次都是常量时间比较，
所以失败路径不泄露「接近哪个客户端」。
```

**两层防护**：顺序固定（避免时间侧信道透露顺序），且逐项常量时间比较。

而比较函数本身：

```text
/** 常量时间比较；长度不同直接短路（不泄露内容，长度本身不是秘密）。 */
```

**「长度本身不是秘密」**——所以长度不等时短路是安全的。

### 那四个客户端与一个不在名单里的

```text
LOCAL_API_CLIENTS = ["desktop", "renderer", "word-addin", "cli"]
LEGACY_SHARED_CLIENT = "shared"
```

**`shared` 刻意不在名单里**：

```text
注意：这里**不含** `shared`。`shared` 是 `LAWMIND_LOCAL_API_TOKEN` 传入的旧式单一令牌，
只作为 dev/E2E 覆盖路径存在（见 `resolveLoopbackClient`），不参与派生，也不在轮换/吊销的管辖内。
```

**「不在轮换/吊销的管辖内」**——所以这个旧身份只能靠**根本不传这个环境变量**来关掉。

### 每客户端最小权限

```text
desktop / renderer  全量
word-addin          只碰 /word-addin/ 与 /api/word-addin/
cli                 只读（GET / HEAD / OPTIONS）
其他                拒绝
```

那段注释把每条的理由都写了：

```text
- `word-addin`：只碰插件自己的两条面。跨面即 403 —— 插件是被 Word 加载的第三方
  运行环境，权限越窄越好；它的诉求本来就只有「审这份 / 取结果 / 记案卷」。
- `cli`：只读。脚本与排障要的是看状态，不是改案卷；写操作请走桌面端或明确的客户端。
```

**「插件是被 Word 加载的第三方运行环境」**——这是给 Word 插件最小权限的理由。**它是一个可以被人改的页面。**

而最后一段补了一个容易漏的点：

```text
注意：静态面 `/word-addin/*` 的 GET 在 dispatch 里本就免 bearer（Word 取页面时还没有
令牌，鸡生蛋），这里覆盖的是**数据面**与插件可能发起的其余请求。
```

**「鸡生蛋」**——静态资源必须免令牌（否则页面取不到），所以 scope 管的是**数据面**。

### 默认拒绝

```text
每客户端最小权限（P3）。**默认拒绝**：未知客户端、未知路径一律不放行。
```

而白名单的性质也写明了：

```text
新增客户端必须同时给出 scope（见 `isClientAllowedForRequest`），否则默认拒绝 ——
白名单是加法，不是减法。
```

## 67.5 那个只给 CLI 的凭据文件

这是本章一个很精细的设计。三条投递通道：

| 客户端     | 通道                                                    |
| ---------- | ------------------------------------------------------- |
| 桌面主进程 | 直接 import（同进程）                                   |
| 渲染层     | IPC（`lawmind:get-config` / `lawmind:loopback-config`） |
| Word 插件  | 同源 `config.js`                                        |
| **CLI**    | **没有通道**                                            |

所以给 CLI 单独写一个文件。那段注释解释了为什么不能给它安装密钥：

```text
/**
 * 无 IPC 通道的客户端（脚本 / CLI）怎么拿到凭据 —— **同用户可读的发现文件**。
 *
 * 三种客户端各有投递通道：桌面主进程与渲染层走 IPC，Word 插件走同源 `config.js`。
 * 只剩 CLI 没有通道。给它单独写一个 0600 发现文件，而不是让它读安装密钥：
 * 前者泄了只能读，后者泄了能为**任意 clientId** 现算凭据（等于根密钥）。
 *
 * 位置在 `lawMindRoot`（`<userData>/LawMind`，工作区之外）——工作区是 agent 可写区，
 * 凭据文件放进去就等于让被审查的材料能给自己签一把钥匙。
 *
 * 形状与 `/.well-known/lawmind-local` 一致（base / epoch / instanceId），
 * 额外带上 `credentials`。文件在应用停止时删除：服务都没了，留着凭据只是脏数据。
 */
```

**四层信息**：

1. **为什么单独一个文件**：三种客户端都有通道，只有 CLI 没有。
2. **为什么给凭据而不是安装密钥**：「前者泄了只能读，后者泄了能为任意 clientId 现算凭据（等于根密钥）」——**这是「最小授权」的一个非常清楚的应用**。
3. **为什么放工作区外**：「工作区是 agent 可写区……等于让被审查的材料能给自己签一把钥匙」——**这句话值得多读一遍**。
4. **为什么停止时删**：「服务都没了，留着凭据只是脏数据」。

文件形状：

```text
{ base: "http://127.0.0.1:<端口>", epoch, instanceId, credentials: { cli: "<hex>" } }
```

**只写 `cli` 一个客户端**（注释：`只写「没有别的投递通道」的客户端 —— 不全量落盘`）。

### 删除时必须比对 instanceId

```text
/**
 * 只删除**本实例写出**的那一份。
 *
 * 为什么必须比对 instanceId：这个文件在 userData 下，是**跨实例共享**的。
 * 同一台机器上若同时开着两个 LawMind（开发栈 + 打包版、或两个 dev 实例），
 * 无条件 `rm` 会让先退出的那个把另一个正在用的凭据删掉 —— 表现为「CLI 突然说
 * 凭据文件不存在」，而服务其实活得好好的。谁的实例谁负责收尾。
 */
```

**「谁退出谁不能删别人的」**——而症状描述得很具体：**「CLI 突然说凭据文件不存在」，而服务其实活得好好的**。

### 安装密钥本身的三级回落

```text
① 密钥链（service `ai.lawmind.desktop`，account `localApi.installationSecret`）
② 不可用 → `<userData>/LawMind/local-api-installation-secret`（0600，64 位 hex）
③ 都失败 → 进程内临时密钥（打警告）
```

第 ② 条的理由：

```text
**为什么必须落在工作区之外**：`workspace/` 是 agent 可写区（Skills 就在那儿播种），
把鉴权根密钥放进去，等于让被审查的材料有机会改掉自己的锁。`lawMindRoot` 是
`<userData>/LawMind`，在工作区之外，也落在 `LAWMIND_USER_DATA_DIR` 的 E2E 隔离里。
```

**「让被审查的材料有机会改掉自己的锁」**——这是同一句话在另一处的重复。它值得重复，因为这是这个产品最核心的一条威胁。

而第 ③ 条的警告：

```text
[LawMind] 无法写入本机 API 安装密钥文件；本次为进程内临时密钥。
```

**「进程内临时」意味着重启就换**——所以它会重新引入那次事故的症状。**这是最后手段。**

### 代次与吊销名单放在配置文件里

```text
/**
 * 凭据代次与吊销名单（非秘密，放 `desktop-config.json`）。
 *
 * 放配置文件而不是 keychain，是因为它们要能被「看」：排障时最常问的两件事正是
 * 「现在第几代」与「哪个客户端被撤了」。密钥才需要藏。
 */
```

**「密钥才需要藏」**——所以判断标准是「是秘密吗」，不是「重要吗」。

## 67.6 崩溃监督：两层结构

### `server-supervision.mjs` 只有两个纯函数

```text
SERVER_SUPERVISION_DEFAULTS = { baseDelayMs: 500, factor: 2, maxDelayMs: 30000, maxAttempts: 5 }
```

退避公式：`min(30000, 500 × 2^(n-1))` → 500ms → 1s → 2s → 4s → 8s。

头注释说明了策略：

```text
策略：意外退出 → 指数退避自动重启；超过上限 → 放弃并表面化给用户。
正常停止（killLocalServer / 手动重启 / 应用退出）不触发监督重启。
```

**「表面化给用户」**——第 5 次失败会弹一个对话框：

```text
message: LawMind 本地服务多次崩溃，已停止自动重启。
detail:  请在设置页检查环境后手动重启本地服务；若持续崩溃请查看日志定位原因。
```

**`detail` 给了两条动作**（去设置重启 / 看日志）。

### 「意外」与「正常」的区分

```text
intentionalStop 区分「正常停止」（killLocalServer / 手动重启 / 应用退出）与
「意外退出」；只有后者触发监督重启。
supervisionAttempts 在重启成功（ready）后归零。
```

**两个状态变量解决两件事**：`intentionalStop` 区分主动/被动，`supervisionAttempts` 计退避次数。

**「重启成功后归零」**——所以「连续崩溃五次」才是放弃条件，不是「总共崩过五次」。

### 四个环境变量可以改退避

```text
LAWMIND_E2E_SUPERVISION_BASE_DELAY_MS   默认 500
LAWMIND_E2E_SUPERVISION_FACTOR          默认 2
LAWMIND_E2E_SUPERVISION_MAX_DELAY_MS    默认 30000
LAWMIND_E2E_SUPERVISION_MAX_ATTEMPTS    默认 5
```

**前缀是 `LAWMIND_E2E_`**——所以这些是**给测试用的**（让测试不用真等 8 秒）。校验规则：非有限或负值回退默认。

### 与 `lawmind-daemon-supervisor.ts` 不是同一个东西

这里容易混。两者监督的对象不同：

|        | `server-supervision.mjs`             | `lawmind-daemon-supervisor.ts`                 |
| ------ | ------------------------------------ | ---------------------------------------------- |
| 监督谁 | **桌面本地 API 服务子进程**          | **`lawmindd`（桌面退出后继续办件的守护进程）** |
| 结构   | 单层（主进程直接管）                 | **两层**（监督进程 + tick 子进程）             |
| 位置   | `electron/`（`.mjs`，electron-free） | `apps/lawmind-desktop/server/`                 |
| 内容   | 两个纯函数 + 一组常量                | 循环编排 + pid 文件 + 单实例锁                 |

**结论：不是同一个模块，也不是包装关系。** 唯一的接线是 `local-server.mjs` 用 `{ supervisor: true }` 起守护进程时（第 63.12 节讲的 `LAWMIND_DAEMON_SUPERVISOR=1`）。

### 守护进程的子进程环境要剥七项

`buildDaemonProcessEnv` 的拒绝名单和第 63.12 节那张一样（七项凭据类），**加一条理由**：

```text
// 凭据根密钥与代次同样在拒绝名单里：daemon 不监听端口，没有理由持有它们。
```

**「不监听端口，没有理由持有它们」**——最小权限的推理。

而 daemon 模式还会**删掉 `LAWMIND_DAEMON`、设 `LAWMIND_DAEMON_SUPERVISOR=1`**（监督进程自己不跑 tick）。

### 那对密钥要跨进程复用

```text
/**
 * 缓存注入子进程的本地密钥，供 lawmindd（quit 时 spawn，同步路径）复用同一批密钥，
 * 避免桌面服务器与 daemon 各持一把钥匙导致审计链/邮件凭证跨进程不一致。
 */
```

**「避免各持一把钥匙」**——审计链密钥不一致会导致链验不过。

而 `before-quit` 里 spawn daemon 是**同步路径**（不能 await），所以密钥必须提前缓存。

### 起守护进程时的参数

```text
{ cwd, detached: true, stdio: "ignore", env: ... }
child.unref()
```

注释：

```text
// 起监督进程而不是裸 tick 进程：崩了才会被按退避自动拉起。
```

**`detached: true` + `unref()`**——所以桌面退出后它还活着。

## 67.7 本机目录持久层

`host-access-store.mjs` 68 行，管一个文件。

```text
<lawMindRoot>/host-access.json
```

**形状**：

```text
{
  schemaVersion: 1,
  mounts: [ { id, absPath, label, addedAt } ],
  persistentGrants: [],
  fullDiskAccessNoted?: boolean
}
```

四条读取规则：

```text
文件不存在 / 解析失败 → 默认空态
schemaVersion !== 1   → 默认空态（不尝试迁移）
mounts / persistentGrants 非数组 → 各自兜底成 []
fullDiskAccessNoted 只在 === true 时为真
```

**「schemaVersion 不等于 1 就整个重置」**——这是最保守的兼容策略（不做迁移，只认当前版本）。

### `rootsFromStore` 的三级

```text
roots.workspace = 工作区
roots.project   = mounts[0].absPath（否则退回传入的 projectDir）
roots["mount:<id>"] = 每个挂载点
```

**`project` 取的是「第一个挂载点」**——所以第一个挂载点有特殊地位（它同时也是 `LAWMIND_PROJECT_DIR` 的来源）。

而挂载点 id 在迁移时固定为 `"project"`，新增的是 `mount-<时间戳 base36>`（上限 16 个）。

## 67.8 macOS 签名与公证

### 先记一个否定事实

**代码里完全不做隔离属性（quarantine）处理。** 全仓搜 `xattr` / `quarantine` / `spctl` 在打包文件里 0 处命中。

而 `README.md` 里那句话说明了预期行为：

```text
unsigned/adhoc builds "still need **Right-click → Open** the first time"
```

**所以「首次打开要右键」是文档化的预期行为**，不是自动处理掉的。

### 头注释把签名档位说清了

```text
Browser-downloaded apps only double-click when signed with
Developer ID Application and notarized. Adhoc (`-`) seals resources so a
locally built app launches; it does not pass Gatekeeper after download.
```

**两档**：

| 档位                | 能做什么                     | 不能做什么                  |
| ------------------- | ---------------------------- | --------------------------- |
| adhoc（`-`）        | 本地构建能启动（资源被封签） | **下载后过不了 Gatekeeper** |
| Developer ID + 公证 | 浏览器下载后能双击           | —                           |

**「adhoc 只是封签资源」**——所以它能跑起来，但**不是分发给律师的形态**。

### 签名身份的四个优先级

```text
① CSC_NAME 或 LAWMIND_MAC_SIGN_IDENTITY（显式）
② 密钥链里第一个匹配 /Developer ID Application/i 的
③ LAWMIND_REQUIRE_NOTARIZED === "1" → 抛错
④ 否则 adhoc `-`
```

第 ③ 步是一条**硬门**：要求公证但找不到 Developer ID 证书时**直接失败**，而不是悄悄降级成 adhoc。文案：

```text
LAWMIND_REQUIRE_NOTARIZED=1 but no Developer ID Application identity was found. Install a Developer ID certificate or set CSC_NAME / CSC_LINK.
```

**「而不是悄悄降级」**——这是发布流程该有的姿态：**要发布就得签，签不了就别发**。

### 签名的命令数组

```text
/usr/bin/codesign --sign <身份> --force --options runtime
                [--timestamp（非 adhoc 时）] [--deep] [--entitlements <文件>] <文件>
```

**两个细节**：

1. **adhoc 时不加 `--timestamp`**——因为 adhoc 没有时间戳服务可用。
2. **`--options runtime` 恒定**——即「强化运行时」（hardened runtime），这是公证的前提。

签名顺序：**先签所有随包的辅助二进制，最后 `--deep` 签整个 app**。

```text
listBundledHelperBinaries(appPath)
  → Contents/Resources/node-runtime/**/(node|node.exe)
  → Contents/Resources/officecli/**/(officecli|officecli.exe)
```

**「先里后外」**——因为签外层会把内层的签名一起纳入校验，内层改了外层签名就失效。

### 公证是手写代码，不是 electron-builder 的选项

`package.json` 里明确写了：

```text
"notarize": false
```

**electron-builder 自带的公证被关掉了**，改由 `afterAllArtifactBuild` 钩子自己做：

```text
/usr/bin/xcrun notarytool submit <文件> ... --wait
/usr/bin/xcrun stapler staple <文件>
```

**为什么自己写**：因为要支持三种凭据来源，并要能对**多个产物**（dmg + zip）逐个提交与装订。

### 三种公证凭据来源

| 优先级           | 需要的变量                                                   |
| ---------------- | ------------------------------------------------------------ |
| ① 密钥链 profile | `APPLE_KEYCHAIN_PROFILE`（+ 可选 `APPLE_KEYCHAIN`）          |
| ② API Key        | `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`    |
| ③ Apple ID       | `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` |
| 都没有           | 抛 `missing Apple notary credentials`                        |

**三种都支持是为了适配本机开发与 CI 两种场景**（CI 用 ③ 或 ②，本机用 ①）。

### 两个钩子的分工

`after-pack-mac.mjs`（19 行）：**打完包就签名**。它只做一件事：

```text
非 darwin → 直接返回
否则 → 找到 app → signLawMindMacApp（两份 entitlements）→ 打一行日志
```

日志格式：

```text
[lawmind-mac] <adhoc|developer-id> sign: nodes=<节点数> identity=<env|keychain|adhoc>
```

`after-all-artifact-build-mac.mjs`（48 行）：**所有产物出来之后公证**。四步：

```text
① 非 darwin → 返回
② 找到 app → codesign -dv 看签名
③ 不是 Developer ID 签名 → 警告（或 REQUIRE_NOTARIZED=1 就抛）
④ 有 Developer ID 但没凭据 → 警告（或抛）
⑤ 都有 → 对每个 dmg/zip 提交公证 + 装订
```

**两级警告的文案都很有信息量**：

```text
[lawmind-mac] adhoc/unsigned build: Gatekeeper will block double-click after a browser download. Provide a Developer ID certificate to notarize.
[lawmind-mac] Developer ID signature present, but notary credentials are missing; skip notarization.
```

**第一条说清后果**（浏览器下载后双击会被拦）**与解法**（提供开发者证书）。

### 两份 entitlements 的唯一差别

| 键                                                       | 主 plist | inherit plist |
| -------------------------------------------------------- | -------- | ------------- |
| `com.apple.security.cs.allow-jit`                        | ✅       | ✅            |
| `com.apple.security.cs.allow-unsigned-executable-memory` | ✅       | ✅            |
| `com.apple.security.cs.disable-library-validation`       | ✅       | ✅            |
| `com.apple.security.network.client`                      | ✅       | ✅            |
| `com.apple.security.network.server`                      | ✅       | ✅            |
| `com.apple.security.files.user-selected.read-write`      | ✅       | **无**        |

**inherit 少了「用户选择文件的读写」**——因为它给子进程（随包的 Node 等）用，**子进程不需要直接读用户选的路径**（它读工作区内的路径）。

**而 `network.server` 两份都有**——因为本地 API 是子进程在监听。

主 plist 有一行注释说明了它的场景：

```text
<!-- Electron + spawned bundled Node (local loopback API). -->
```

**注意没有 `com.apple.security.app-sandbox`**——LawMind 不走 App Sandbox（它需要读用户任意位置的文件）。**所以它是「强化运行时 + 不沙箱」的组合。**

### 打包清单的五项 extraResources

```text
server/dist                    → lawmind-server            （只收 *.cjs）
../../src/lawmind/skills/builtin → lawmind-server/builtin   （只收 *.md）
resources/node-runtime         → node-runtime
resources/officecli            → officecli
resources/word-addin           → word-addin
```

**五项都是「必须随包」的东西**：服务端代码、技能种子、Node 运行时、officecli、Word 插件。**任何一项漏了功能就会缺一块。**

而 `files` 只收三样：

```text
electron/**/*（排除测试）
dist/**/*
（排除 sourcemap）
```

**「排除 .map」**——所以打包版不带 sourcemap。

### 发布渠道

```text
publish: [{ provider: "github", owner: "sunhl4", repo: "LawMind" }]
```

配合 `electron-updater`（第 66.3 节）——**所以自动更新走 GitHub Releases**。

而 CI 里有一道发布门（错误文案）：

```text
::error::No latest*.yml in the packaged artifacts — clients could not auto-update.
```

**「缺 latest.yml 客户端就没法自动更新」**——这个检查很实在：`electron-updater` 靠那个文件判断新版本。

## 67.9 已知坑（本章相关）

- **端口漂移的根因是「静默回退」**，不是换端口本身。
- **同一台机器上有两个实例时，先起的会占住端口**——根治靠单实例锁。
- **`unknown` 占用者不等于 `foreign`**（可能是刚崩的残留）。
- **`pickPort` 的「listen 后 close」有竞态**，所以有三次重试。
- **端口只写在 `desktop-config.json` 的 `apiPort`**；没有握手文件。
- **`LAWMIND_NODE_BIN` 优先于随包 Node。**
- **`.env.lawmind` 里的键会盖住密钥链**——所以保存新 Key 时要先把明文键删掉。
- **自定义模型与 MCP 的环境变量名是动态生成的**，必须与引擎侧命名规则一致。
- **`LAWMIND_SKIP_API_AUTH` 有两道保险**：服务端忽略 + 主进程不注入。
- **`shared` 那个旧身份不在 `LOCAL_API_CLIENTS` 里**，所以它不受轮换与吊销管辖。
- **Word 插件只拿到自己那两条路径的权限**（数据面；静态面本就免令牌）。
- **`cli` 只读**，写操作必须走桌面端。
- **认证失败路径不泄露「接近哪个客户端」**（顺序固定 + 常量时间）。
- **CLI 拿的是凭据，不是安装密钥**——因为后者能现算任意 clientId 的凭据。
- **凭据文件必须在工作区外**（工作区是 agent 可写区）。
- **删除凭据文件前要比对 instanceId**，否则会把别的实例的删掉。
- **安装密钥三级回落**，最后一级是「进程内临时密钥」——**重启就换，会重现事故症状**。
- **代次与吊销名单放配置文件而不是密钥链**（因为要能被看）。
- **监督重启在成功后归零**——所以是「连续五次」才放弃。
- **四个 `LAWMIND_E2E_SUPERVISION_*` 变量是给测试的**。
- **`server-supervision.mjs` 与 `lawmind-daemon-supervisor.ts` 监督的是不同的进程。**
- **守护进程不监听端口，所以被剥掉七项凭据类环境变量。**
- **审计链密钥要跨进程复用**（否则链验不过）。
- **`host-access.json` 的 `schemaVersion !== 1` 就整个重置**（不做迁移）。
- **`roots.project` 取第一个挂载点。**
- **代码不做 quarantine 处理**；未签名/adhoc 构建首次打开要右键。
- **adhoc 签名过不了 Gatekeeper**（只能本地跑）。
- **`LAWMIND_REQUIRE_NOTARIZED=1` 是硬门**：签不了就直接失败，不降级。
- **adhoc 签名不加 `--timestamp`。**
- **签名顺序是「先辅助二进制，最后 `--deep` 整个 app」**。
- **electron-builder 的 `notarize` 被关掉**，改由 `afterAllArtifactBuild` 手写（为了支持三种凭据来源 + 多个产物）。
- **两份 entitlements 只差「用户选择文件读写」一项。**
- **LawMind 不走 App Sandbox**（强化运行时 + 不沙箱）。
- **打包漏了 extraResources 任何一项，功能就会缺一块**。
- **缺 `latest*.yml` 会导致客户端无法自动更新**（CI 有门禁）。
