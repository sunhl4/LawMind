# LawMind 本机 API 鉴权：凭据模型、轮换与吊销

> **状态**：2026-09-21 落地（P0–P3）。替代此前「一进程一把随机令牌」的做法。
> **代码真相源**：`apps/lawmind-desktop/electron/local-api-credentials.mjs`（派生）、
> `apps/lawmind-desktop/server/lawmind-local-api-auth.ts`（校验）。
> **相关**：[SECURITY.md](../../SECURITY.md) · [LAWMIND-WORD-ADDIN.md](./LAWMIND-WORD-ADDIN.md) · `electron/local-server.mjs`（密钥持久化）

---

## 1. 为什么改（真实故障，不是推演）

2026-09-21 实测：Word 任务窗格报 `unauthorized`，且此后**每次 LawMind 重启都复发**。

根因是三件事相乘，任何一件单独都不致命：

| #   | 事实                                                                         | 出处                                 |
| --- | ---------------------------------------------------------------------------- | ------------------------------------ |
| 1   | 端口**持久化**（为让侧载清单里的地址不失效）                                 | `desktop-config.json` 的 `apiPort`   |
| 2   | 而令牌是**进程级**的（每次启动 `randomBytes(32)`）                           | 改造前的 `startLocalServerOnce`      |
| 3   | 加载项只在**页面加载时**取一次令牌（CSP 只放行同源脚本，没有第二条投递通道） | `taskpane.html` 的 CSP + `config.js` |

于是「地址不变、钥匙变了」⇒ 已打开的窗格一律 401，而客户端**无处重新发现**新钥匙，
只能由律师手动重载窗格 —— 而界面显示的只有一句没有上下文的 `unauthorized`。

还有一处结构性问题：**共享令牌回答不了「从哪来」**。Word 里的改稿与桌面端的操作在审计里
是同一个 `actorId`，无法区分。对一个把审计链当核心的产品，这是实质缺口。

---

## 2. 模型

```
credential(clientId, epoch) = HMAC-SHA256(installationSecret, `${clientId}:${epoch}`)
```

- **安装密钥持久**（keychain `localApi.installationSecret`；keychain 不可用时降级为
  `<userData>/LawMind/local-api-installation-secret`，`0600`，**工作区之外**）。
  ⇒ 同一客户端的凭据**跨重启逐字节相同**，客户端不再被打断。这是修掉故障的那一步。
- 服务端**不存**任何每客户端凭据：验签时按 `clientId` 现算，`timingSafeEqual` 常量时间比较。
  ⇒ 吊销只改名单、轮换只加一个整数，都不需要迁移存储。
- 密钥必须落在**工作区之外**：`workspace/` 是 agent 可写区（Skills 就在那儿播种），
  把根密钥放进去等于让被审查的材料有机会改掉自己的锁。

### 客户端与权限边界

| clientId     | 是谁                                  | 凭据怎么到它手上                                               | 权限                                    |
| ------------ | ------------------------------------- | -------------------------------------------------------------- | --------------------------------------- |
| `desktop`    | Electron 主进程（健康检查、模型探活） | 进程内派生                                                     | 全量                                    |
| `renderer`   | 应用窗口（渲染层）                    | IPC（`lawmind:get-config` / `lawmind:loopback-config`）        | 全量                                    |
| `word-addin` | Word 任务窗格                         | 同源 `config.js`（CSP 逼出来的唯一通道）                       | 仅 `/word-addin/*`、`/api/word-addin/*` |
| `cli`        | 脚本 / curl / CI                      | 发现文件 `<userData>/LawMind/local-api-clients.json`（`0600`） | 只读（`GET`/`HEAD`/`OPTIONS`）          |
| `shared`     | 旧式 `LAWMIND_LOCAL_API_TOKEN`        | 环境变量（dev/E2E 覆盖路径）                                   | 全量（语义与改造前一致）                |

**未知客户端一律拒绝**（白名单是加法，不是减法）。越权返回 `403 client_scope_forbidden`
并带上 `clientId`，便于排障时一眼看出「是谁在越界」，而不是笼统的 403。

### 发现端点

```
GET /.well-known/lawmind-local
→ { ok, base, instanceId, epoch, clients, credentialModel }
```

免 bearer（客户端此刻还没有凭据，鸡生蛋），但：**载荷不含任何秘密**、仍在回环 Host 校验之后、
CORS 白名单使浏览器读不到响应体。客户端在**启动时**与**收到 401 时**各调一次。
形状刻意贴近 RFC 9728（Protected Resource Metadata）：将来若把 LawMind 作为 MCP server
暴露给外部 agent，同一个端点长出 `authorization_servers` 即可接标准 OAuth，不必重新设计。

**它的能力边界要说清（2026-09-21 更正）**：发现端点**只救「令牌变了而地址没变」，
救不了「地址变了」** —— 因为它自己就挂在那个 base 上，base 一过期连它都到不了。

所以端口和安装密钥一样，属于**持久化契约**：任何静默改变它的行为都会让已侧载的客户端
集体失联（Word 的侧载清单把端口钉死在文件里）。当前防线有三层：

1. **单实例锁**（`main.mjs`）：第二个实例不再能抢走端口 —— 这是根因治理；
2. **自己写回**：端口被其它程序占用时，服务就绪后把清单写成当前端口。另一个 LawMind 占着原端口时不改写；
3. **律师只看到结果**：体检 → Word 写「请重新打开 Word」，需要时点「重新连接 Word」。端口号只在主进程日志里。

### 客户端自愈

Word 插件在收到 401 时：重取一次同源 `config.js`（重新插入 `<script>`，同源 CSP 本就放行）
→ 换上新凭据 → **重放一次**原请求。并发 401 共享同一个 in-flight 刷新。

只重放一次是刻意的：换完还是 401，说明凭据被吊销或服务已不是同一实例，继续重试只会把
真正的失败藏起来。此时文案会明确给出动作（「关掉窗格重新打开」），而不是照搬服务端术语。

---

## 3. 日常操作

### 取 CLI 凭据

```bash
pnpm lawmind:local:token             # 只打印凭据（接脚本用）
pnpm lawmind:local:token --json      # base / epoch / instanceId / token
pnpm lawmind:local:token --status    # 探一次发现端点
```

```bash
BASE=$(pnpm -s lawmind:local:token --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).base))")
TOK=$(pnpm -s lawmind:local:token)
curl -s -H "authorization: Bearer $TOK" "$BASE/api/health" | head -c 200
```

CLI 是**只读**身份。要改案卷请走桌面端 —— 这不是限制脚本作者，而是让「谁在什么时候
改了什么」在审计里始终说得清。

应用没在运行时该文件会被删除（服务都没了，留着凭据只是脏数据），CLI 会给出可照做的提示。

> 发现文件是**跨实例共享**的。为防止「先退出的实例把另一个正在用的凭据删掉」，
> 删除前会比对 `instanceId` —— 谁的实例谁负责收尾（`removeLocalApiClientFile`）。

### 吊销某个客户端

编辑 `<userData>/LawMind/desktop-config.json`：

```json
{
  "localApiEpoch": 1,
  "localApiRevokedClients": ["word-addin"]
}
```

然后重启本地服务（设置页保存一次 API 设置即可）。被吊销的客户端立刻 401；
其他客户端不受影响。用它来撤「一台不该再访问的机器 / 一次误配」。

### 轮换全部凭据

把 `localApiEpoch` 加一：

```json
{ "localApiEpoch": 2, "localApiRevokedClients": [] }
```

重启本地服务后：新一代凭据生效，**上一代仍被接受一代**（`LOCAL_API_EPOCH_GRACE = 1`）——
这样在途客户端不会在同一瞬间集体 401，而是能在下一次发现时自愈。宽限是有界的：
再老的代次不认，否则等于永不轮换。

### 轮换安装密钥（根密钥）

仅在两件事之一发生时做：**密钥疑似泄漏**，或**要一次性让所有客户端重新取凭据**。

1. 删除 keychain 条目 `ai.lawmind.desktop` → `localApi.installationSecret`
   （或删除降级文件 `<userData>/LawMind/local-api-installation-secret`）。
2. 重启桌面端 —— 主进程会生成新密钥（32 字节随机），并把凭据重新下发给各客户端。
3. Word 窗格会在下一次 401 时自动重取 `config.js` 并自愈；无需人工重载。

**不需要**在轮换密钥后再去动 `epoch`：密钥变了，所有派生凭据自然全变。

---

## 4. 故障排查

| 现象                                       | 先看什么                                                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 某客户端 401                               | 它是不是被写进 `localApiRevokedClients` 了？`epoch` 与它手上的一致吗？                                                |
| 某客户端 403                               | `clientId` 字段会告诉你它是谁；对照 §2 的权限表 —— 这是 scope 生效，不是故障                                          |
| 所有客户端同时 401                         | 安装密钥是否变了（keychain 条目被删/重建）？看启动日志有无密钥回退告警                                                |
| **Word 窗格报「无法加载」/ `Load failed`** | **端口变了**（不是鉴权）。设置 → 体检 → Word 会写「请重新打开 Word」；应用会自己写回清单，仍不行就点「重新连接 Word」 |
| CLI 说找不到发现文件                       | 桌面端在运行吗？`base` 是否换了端口（看 `--status`）？是否两个实例在争同一 userData？                                 |
| 窗格一直提示要重开                         | 说明 401 后自愈也失败了：服务大概率换了端口或已退出，看 `pnpm lawmind:local:token --status`                           |

排障时最有用的两条命令：

```bash
pnpm lawmind:local:token --status        # 坐标 + 发现端点探测
lsof -nP -a -p <server-pid> -iTCP -sTCP:LISTEN   # 注意 -a：lsof 默认是 OR 语义，漏 -a 会列出无关端口
```

---

## 5. 明确不做什么

- **不上 OAuth + PKCE**。业界把「回环 + PKCE」当默认答案（RFC 8252 / MCP 授权规范，
  Codex、VS Code、Claude Code 在**远端**授权场景都这么做）。但 PKCE 防的是「授权码被
  本机其他 app 截走」，而这里的 AS 与 RS 是同一个进程、授权码本身就是发给自己的令牌 ——
  防了个寂寞。等真做 MCP server 时再上，届时发现端点已就位。
- **不把 TCP 换成 Unix socket**。对原生客户端（desktop / CLI）它确是更干净的边界
  （文件系统权限即鉴权，Codex 与 Cursor 都这么做），**但对 Word 加载项无效** ——
  WebView 里的 `fetch` 访问不到 unix socket。所以 TCP + 凭据不可约简。
- **不照抄 Codex 的「带 `Origin` 全拒 403」**。Codex 能这么做是因为它的本地客户端不是
  浏览器；LawMind 自己的渲染层就是 Vite 来的浏览器上下文，照抄会把自己打死。
