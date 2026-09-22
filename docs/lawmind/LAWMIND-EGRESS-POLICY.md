# LawMind 出站（egress）模式

> **状态**：已落地（2026-09-20）。`egressMode` 是出站能力的**唯一权威**；旧 `highSecurityMode` 保留为等价别名。
> **律师可见名**：设置 → 安全 → 「离线模式（完全不出站）」。
> **工程名**：Egress Policy。
> **用途**：给律所级本地部署（本地模型、全不出站）留一个**开箱即用的总闸**；日常用「放行官方法规站」的白名单就够。
> **不是**：不是「断网」的全部 —— 它管的是检索类出站，模型 API 与已配的权威库端点仍会出网，见 §4。
> **交叉引用**：[SECURITY.md](../../SECURITY.md) · [LAWMIND-ARCHITECTURE.md](../LAWMIND-ARCHITECTURE.md) · [LAWMIND-HOST-ACCESS.md](./LAWMIND-HOST-ACCESS.md)

---

## 0. 一句话

`egressMode` 决定「这台机器允许把案子数据发到哪儿」；它**只读不改**，所以开关来回切不会把律师的偏好抹掉。

---

## 1. 三种模式

| `egressMode`    | 含义                                         | 法规检索 | 公开网页  | MCP 客户端 | 分析脚本 / `run_compute`  |
| --------------- | -------------------------------------------- | -------- | --------- | ---------- | ------------------------- |
| `"offline"`     | **完全不出站**（律所级本地部署，需本地模型） | ✗        | ✗         | ✗          | ✗                         |
| `"allowlisted"` | 只放行 `networkAllowlist` 里的主机           | ✓        | ✓（受限） | ✓          | 按 `allowAnalysisScripts` |
| `"open"`        | 不额外限制（仍受 edition 与白名单规则约束）  | ✓        | ✓         | ✓          | 按 `allowAnalysisScripts` |

**缺省推导**：未写 `egressMode` 时，`networkAllowlist` 非空 → `allowlisted`，否则 → `open`。

**优先级**：显式 `egressMode` > 旧 `highSecurityMode: true`（等价 `offline`）> 白名单推导。

---

## 2. 配置

`lawmind.policy.json`（工作区根）：

```json
{
  "schemaVersion": 1,
  "egressMode": "allowlisted",
  "networkAllowlist": ["npc.gov.cn", "court.gov.cn", "www.gov.cn"],
  "allowWebSearch": true
}
```

**律所级全离线**（届时把这两行换成）：

```json
{
  "egressMode": "offline"
}
```

并配本地模型。这是预留接口，**新增部署只要改这一个字段**，不需要动代码。

---

## 3. `egressMode` 与 `allowWebSearch` 是「总闸 vs 偏好」

| 字段             | 角色                                             |
| ---------------- | ------------------------------------------------ |
| `egressMode`     | **上限**。`offline` 时联网无条件关闭。           |
| `allowWebSearch` | **偏好**。律师/IT 想不想联网，`false` 即强制关。 |

关键不变量：**离线模式不会被写进 `allowWebSearch`**。

历史 bug（已修）：`PATCH /api/policy/workspace` 打开「高安全模式」时会静默把
`allowWebSearch: false`、`productInsightsCollection: "off"`、`allowAnalysisScripts: false`
写进策略文件。于是关掉该模式后，律师原来的偏好已经被抹掉 —— 表现为「联网再也开不回来」。
现在这三项一律在**读取时**按 `egressMode` 推导（`resolveEgressMode` /
`resolveProductInsightsCollection` / `isAnalysisScriptsAllowed`），文件里的偏好原样保留。

---

## 4. 它不管什么（别把它当断网开关）

| 通道                           | 是否受 `egressMode: "offline"` 约束 |
| ------------------------------ | ----------------------------------- |
| 公开网页 / 法规站检索          | ✓ 关闭                              |
| MCP 客户端（外部服务）         | ✓ 关闭                              |
| `run_compute` / 分析脚本       | ✓ 关闭                              |
| **模型 API**（DeepSeek 等）    | ✗ **仍会出网** —— 需换本地模型      |
| **已配的权威库端点**（法宝等） | ✗ **仍会出网**                      |
| **外部判定模型（P5）**         | ✓ 关闭                              |

所以「律所内网全不出站」= `egressMode: "offline"` **+ 本地模型** **+ 不配外部权威库端点**。三者缺一，出站就没真正封死。

> **外部判定模型（P5）为什么在表里是「✓ 关闭」**：上面「模型 API / 权威库端点」那两行的豁免是**既有口径**——对话模型与已配的权威库是产品必需的通道，无法在离线模式下并存。
> 而 `src/lawmind/models/decision-model.ts` 的 `resolveDecisionModel()` **刻意不沿用这个豁免**：外部判定器是**新引入**的出站通道，没有任何理由让它继承「离线仍出网」的通行证。
> 它把 `egressMode: "offline"` 的判定放在**读取任何其他配置之前**，所以即使显式配了 `decisionModelMode: "on"` 与完整凭据，离线部署下它也是死的。

---

## 5. 代码落点

| 关注点                 | 位置                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| 类型 / 解析器          | `src/lawmind/policy/workspace-policy.ts` → `resolveEgressMode`       |
| 离线时关工具 / MCP     | `src/lawmind/policy/analysis-scripts.ts` → `isHighSecurityMode`      |
| 离线时关产品遥测       | `src/lawmind/policy/edition.ts` → `resolveProductInsightsCollection` |
| 启动时写入 env 闸      | `apps/lawmind-desktop/server/lawmind-policy.ts`                      |
| 读 / 写接口            | `apps/lawmind-desktop/server/lawmind-server-route-platform.ts`       |
| 主机白名单             | `src/lawmind/policy/network-allowlist.ts`                            |
| **外部判定模型（P5）** | `src/lawmind/models/decision-model.ts` → `resolveDecisionModel`      |

`isHighSecurityMode()` 名称保留为历史别名，真值来自 `isEgressOffline()`；新增代码请直接读 `egressMode`，不要再单独判断 `highSecurityMode`。
