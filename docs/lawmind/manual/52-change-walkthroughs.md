# 第 52 章 完整改动示例

第 18.5、49.12、50.12 节给了「要动哪几处」的清单。这一章给**带真实代码的完整示例**——照着改就能跑。

三个示例覆盖最常见的三类改动：加工具、加 lint 规则、加 HTTP 端点。

> 本章的代码是**示例**，用于说明形状与位置。它们基于仓库里真实的写法（比如 `update-plan-tool.ts`、`lint/general.ts`、`lawmind-server-route-desk-settings.ts`），但示例本身不在仓库里。

## 52.1 示例一：加一个工具

**需求**：加一个 `summarize_deadlines` 工具，让模型能拿到本案期限的汇总（按紧急程度分组）。

**为什么选这个需求当例子**：它需要绑案件、只读、要访问已有的领域模块——覆盖了一个典型工具的全部要素。

### 第一步：先找实现该调用谁

查一下已有的期限模块（第 45 章讲过）：

```text
src/lawmind/application/services/deadline-service.ts  → listDeadlinesForMatter / listDeskDeadlines
src/lawmind/desk/deadline-chain.ts                    → annotateDeskDeadlines（加 sourceLabel/released）
```

**工具层不写算法**（第 49.11 节的「薄壳」模式）。所以这个工具只做三件事：取案件、调服务、组织返回。

### 第二步：写实现

新建 `src/lawmind/agent/tools/legal/deadline-summary-tool.ts`：

```ts
import { listDeadlinesForMatter } from "../../../../application/services/deadline-service.js";
import { annotateDeskDeadlines } from "../../../../desk/deadline-chain.js";
import type { AgentTool } from "../../types.js";
import { matterRequiredResult } from "../matter-required.js";

export const deadlineSummaryTool: AgentTool = {
  definition: {
    name: "summarize_deadlines",
    description:
      "汇总本案期限：按已逾期、七日内、三十日内、更远分组，并标出每一项的来源与是否在等待前置。" +
      "只读，不修改任何期限。需要先选定案件。",
    category: "matter",
    parameters: {
      matter_id: {
        type: "string",
        description: "案件 ID（默认使用当前案件）",
      },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const matterId = (params.matter_id as string) || ctx.matterId;
    if (!matterId) {
      return matterRequiredResult(ctx.workspaceDir);
    }

    const records = await listDeadlinesForMatter(ctx.workspaceDir, matterId);
    const view = annotateDeskDeadlines(records);
    if (view.length === 0) {
      return { ok: true, data: { matterId, total: 0, message: "本案暂无登记期限。" } };
    }

    // 分组逻辑保持在工具里，因为它只服务这一个工具的返回形状。
    const now = Date.now();
    const days = (iso: string) => Math.floor((new Date(iso).getTime() - now) / 86_400_000);
    const overdue = view.filter((d) => d.status === "open" && days(d.dueAt) < 0);
    const within7 = view.filter(
      (d) => d.status === "open" && days(d.dueAt) >= 0 && days(d.dueAt) <= 7,
    );
    const within30 = view.filter(
      (d) => d.status === "open" && days(d.dueAt) > 7 && days(d.dueAt) <= 30,
    );
    const later = view.filter((d) => d.status === "open" && days(d.dueAt) > 30);

    const line = (d: (typeof view)[number]) =>
      `${d.title}（${d.dueAt}，${d.sourceLabel}${d.released ? "" : `；等待：${d.waitingOnTitle}`}）`;

    return {
      ok: true,
      data: {
        matterId,
        total: view.length,
        overdue: overdue.map(line),
        within7: within7.map(line),
        within30: within30.map(line),
        later: later.map(line),
      },
    };
  },
};
```

**对照第 49.2 节的骨架，逐项检查**：

| 要求                      | 这里怎么做的                                                  |
| ------------------------- | ------------------------------------------------------------- |
| `definition.name`         | `snake_case` 全小写                                           |
| `description`             | 说清**做什么 + 边界**（「只读，不修改任何期限」）             |
| `category`                | `matter`（因为它是案件域）                                    |
| `parameters`              | 只 `matter_id`，可选                                          |
| `isConcurrencySafe: true` | 只读，可与同批只读工具并发                                    |
| 案件三段式                | `params.matter_id \|\| ctx.matterId` → `matterRequiredResult` |
| 返回形状                  | `{ ok: true, data }`                                          |

**几个刻意的选择**：

- **`description` 里写「只读」**：模型看到这句才不会把它当写工具用。
- **空结果也返回 `ok: true`**：这不是失败（第 49.2 节那个约定）。
- **分组逻辑写在工具里**：因为它只服务这个工具的返回形状。如果它以后要被别处复用，再抽到 `desk/` 里去。**判断标准是「谁还需要它」**。
- **返回的是字符串数组**（`line()` 格式化过），不是原始记录：模型拿到的是可直接写进回复的文本，省得它自己拼。

### 第三步：注册

在 `src/lawmind/agent/tools/legal-tools.ts` 的 `tools` 数组里加一行。找到「案件与工作台」那一组（`...deskTools` 附近）：

```ts
    ...deskTools,
    deadlineSummaryTool,
    proposeOrganizePlan,
```

并在文件顶部加 import。

### 第四步：判断它属于哪些集合

查 `tool-name-sets.ts` 的五个集合：

| 集合                    | 要不要加 | 理由         |
| ----------------------- | -------- | ------------ |
| `MATTER_SCOPE_REQUIRED` | **要**   | 它必须绑案件 |
| `WRITE_TOOLS`           | 不要     | 它只读       |
| `IDEMPOTENT_READ_TOOLS` | **要**   | 只读且可重放 |
| `DESK_WRITE_TOOL_NAMES` | 不要     | 它不写工作台 |
| `BACKGROUND_JOB_TOOLS`  | 不要     | 它不跑长任务 |

**两个「要」是有后果的**：

- 进 `MATTER_SCOPE_REQUIRED` → 中间件会拦「没绑案件」的调用（第 5.7 节第 8 道）。
- 进 `IDEMPOTENT_READ_TOOLS` → 它算「幂等只读」，可以安全重试，而且**不会触发写类审批**。

**同时**：`governance.ts` 会**自动推导**治理元数据（风险级别按 `riskLevel`，运行模式按「在不在写集合里」，案件范围按「在不在 `MATTER_SCOPE_REQUIRED` 里」）。所以第四步做完，治理信息就对了，**不用手工写**。

### 第五步：判断要不要披露

它该不该开局就广告给模型？

| 情况             | 处理                                                           |
| ---------------- | -------------------------------------------------------------- |
| 它很常用、很轻   | 放进大 `tools` 数组（**开局广告**）                            |
| 它只在特定场景用 | 加到 `governance.ts` 的 `DISCLOSED_TOOL_HINTS`（**按需披露**） |

期限汇总是「问一次就有用」的轻工具，所以**直接放进数组**（上面就是这么做的）。

如果选按需披露，就在 `DISCLOSED_TOOL_HINTS` 加一条：

```ts
{ name: "summarize_deadlines", hint: "按紧急程度汇总本案期限（只读）" },
```

**注意 `hint` 是给律师/模型看的中文**，要遵守术语表（第 32 章）。

### 第六步：测试

新建 `deadline-summary-tool.test.ts`（同目录）：

```ts
import { describe, expect, it } from "vitest";
// 用 testkit 或临时工作区建一个案件 + 几条期限，然后调 execute
```

**测什么**（参考第 35.9 节的建议）：

| 测什么                                | 为什么             |
| ------------------------------------- | ------------------ |
| 没绑案件时返回 `needsMatter: true`    | 那条三段式是硬约束 |
| 空期限时返回 `ok: true` 且 `total: 0` | 「空不是失败」     |
| 分组边界（正好 7 天、正好 30 天）     | 边界最容易错       |
| 逾期项进 `overdue` 而不是 `within7`   | —                  |

**不要测**「description 里有某个词」——那是无效测试。

### 第七步：判断要不要 cassette

第 18.3 节的触发条件是「改编排器、澄清门、compact、steer、playbook 工具锁、审批管线」。

**这个工具只是新增了一个被广告的工具**，没改上面任何一项，所以**不强制加 cassette**。

但如果它是「必须被广告才会走对的路径」（比如合同审查必须看到某个工具），那就该加一条断言：

```text
断言：本轮按××处理时，下一次请求体里广告了 summarize_deadlines
```

### 完整清单回顾

```text
[x] 1. 实现（legal/deadline-summary-tool.ts）
[x] 2. 注册（legal-tools.ts 的 tools 数组）
[x] 3. 名字集合（MATTER_SCOPE_REQUIRED + IDEMPOTENT_READ_TOOLS）
[x] 4. 治理元数据（自动推导，不用写）
[ ] 5. 披露（本例不需要，因为直接放进数组了）
[ ] 6. 保留名（非核心工具，不需要）
[ ] 7. 沙箱（不跑重活，不需要）
[x] 8. 测试
[ ] 9. cassette（没碰编排器，不强制）
```

## 52.2 示例二：加一条 lint 规则

**需求**：合同里同时出现「定金」和「订金」两个词时提醒——这两个词法律含义不同，混用是常见笔误。

**为什么选这个当例子**：它是纯函数规则，形状简单，而且能展示「lint 规则怎么带出处」。

### 第一步：看真实规则的形状

仓库里 `lint/general.ts` 的一条规则长这样（真实代码）：

```ts
const liquidatedDamagesHighRule: LegalLintRule = {
  id: "statutory.liquidated_damages_high",
  family: "statutory_cap",
  run(text) {
    const findings: LegalLintFinding[] = [];
    for (const m of text.matchAll(/违约金[^。]{0,24}?(\d{1,2})\s*%/g)) {
      // ...
      findings.push(
        finding(liquidatedDamagesHighRule, "warning", "…", {
          anchor: m[0],
          statuteRef: "民法典第585条",
        }),
      );
    }
    return findings;
  },
};
```

`LegalLintRule` 的形状只有三个字段（我核对过 `lint/types.ts`）：

```ts
export type LegalLintRule = {
  id: string;
  family: LegalLintFamily;
  run: (text: string, ctx?: LegalLintContext) => LegalLintFinding[];
};
```

**规则是纯函数**：吃文本，出发现项。没有 I/O、没有网络。

### 第二步：写规则

新建 `src/lawmind/lint/rules/deposit-wording.ts`：

```ts
import { lintFinding as finding } from "../finding.js";
import type { LegalLintFinding, LegalLintRule } from "../types.js";

/**
 * 「定金」与「订金」混用。两者法律含义不同：
 * 定金有担保效力（民法典第586–588条），订金一般只是预付款。
 */
export const depositWordingRule: LegalLintRule = {
  id: "form.deposit_wording_mixed",
  family: "form",
  run(text) {
    const hasDeposit = /定金/.test(text);
    const hasEarnest = /订金/.test(text);
    if (!hasDeposit || !hasEarnest) {
      return [];
    }
    const findings: LegalLintFinding[] = [];
    for (const m of text.matchAll(/[^。；\n]{0,24}(定金|订金)[^。；\n]{0,24}/g)) {
      findings.push(
        finding(
          depositWordingRule,
          "warning",
          "同一份合同里同时出现「定金」与「订金」：前者有担保效力（可适用定金罚则），后者一般仅视为预付款。请确认用词是否为本意，并统一。",
          { anchor: m[0], statuteRef: "民法典第586条" },
        ),
      );
    }
    return findings;
  },
};
```

**逐项对照已有规则的写法**：

| 要点                         | 这里怎么做的                               |
| ---------------------------- | ------------------------------------------ |
| 文件头注释说明「为什么」     | 写了两种词的法律差别                       |
| `id` 用 `族.名字` 形式       | `form.deposit_wording_mixed`               |
| `family` 从已有枚举取        | `form`                                     |
| 先判「适不适用」再干活       | 两个词都在才往下走                         |
| 一条发现项带三样             | 严重度、人话说明、`{ anchor, statuteRef }` |
| 用正则 `matchAll` 找所有出现 | 不是只找第一处                             |

**为什么 `anchor` 和 `statuteRef` 重要**：

- `anchor` 是命中的原文片段——**律师能看到「它指的是这一句」**。
- `statuteRef` 是法条依据——**律师能自己核这个判据对不对**。

**严重度用 `warning` 而不是 `blocker` 是有意的**：混用可能是有意为之（有些地方习惯写订金），所以只提醒。

### 第三步：注册规则

`general.ts` 里有一个 `GENERAL_EXTRA_LINT_RULES` 数组（12 条），把新规则加进去，或者如果它更适合某个族，就加进对应族的数组（比如 `EQUITY_LINT_RULES`）。

**注意族的判定**：如果放进族数组，还要看那个族有没有 `*FamilyApplies` 判定——**规则只在该族适用的文书上跑**。

上面这条规则是通用的（任何合同都可能混用），所以放 `general`。

### 第四步：判断要不要抬规则数

`lawmind:compiler-gate` 有一条门禁：`MIN_RULES = 20`（规则数下限）。

**加规则只会让这个数变大，不会触发失败。** 但如果你的改动**删了**规则，就要注意别跌破下限。

另外 `citation-validity.ts` 有一个 `CITATION_VALIDITY_RULE_COUNT = 3`——那是引用有效性那组自己的计数，**不要动**（它是给别处做断言的）。

### 第五步：测试

新建 `deposit-wording.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { runLegalLint } from "../run-lint.js";

describe("form.deposit_wording_mixed", () => {
  it("两个词同时出现时报一条", () => {
    const report = runLegalLint("定金条款：……。另约定订金若干。");
    expect(report.findings.some((f) => f.id === "form.deposit_wording_mixed")).toBe(true);
  });

  it("只出现「定金」不报", () => {
    const report = runLegalLint("定金条款：……");
    expect(report.findings.some((f) => f.id === "form.deposit_wording_mixed")).toBe(false);
  });

  it("带出条文出处", () => {
    const report = runLegalLint("定金……订金……");
    const hit = report.findings.find((f) => f.id === "form.deposit_wording_mixed");
    expect(hit?.statuteRef).toBe("民法典第586条");
  });
});
```

**测三条：正例、反例、出处。** 反例（只出现一个词）比正例更重要——**误报是 lint 最大的敌人**。

### 第六步：判断要不要接硬门禁

**默认不接。** 第 51.6 节讲过 `clause.dispute_missing` 的处理方式：**有已知误报的能力先别接进 `guardian/machine-verifiers.ts`**。

要不要接，看三件事：

| 判据             | 说明                                 |
| ---------------- | ------------------------------------ |
| 有没有误报       | 有就不接（或先修误报）               |
| 是不是法律硬规则 | 硬规则（超上限）可以接；风格建议不接 |
| 有没有出处       | 带 `statuteRef` 的更适合接           |

上面这条（用词混用）属「风格建议」，**不接**。

## 52.3 示例三：加一个 HTTP 端点

**需求**：加 `GET /api/matters/:matterId/deadline-summary`，把示例一那个汇总暴露给界面。

### 第一步：看真实路由的形状

仓库里最小的路由之一 `lawmind-server-route-desk-settings.ts`（真实代码，已简化）：

```ts
export async function handleDeskSettingsRoutes({
  pathname,
  req,
  res,
  c,
  ctx,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;
  if (pathname !== "/api/workspace/desk-settings") {
    return false;
  }
  if (req.method === "GET") {
    const settings = await readDeskSettings(workspaceDir);
    sendJson(res, 200, { ok: true, settings }, c);
    return true;
  }
  // ...
  return false;
}
```

`LawmindRouteContext` 的字段（我核对过 `lawmind-server-route-types.ts`）：`ctx`（含 `workspaceDir`）、`req`、`res`、`url`、`pathname`、`c`（CORS 头）、`clientId`（本次请求的已认证客户端）。

**三个必须遵守的点**：

1. **不匹配就 `return false`**（让下一个 handler 试）。
2. **处理了就 `return true`**。
3. **`sendJson(res, status, body, c)` 必须传 `c`**（第 14.12 节那个 CORS 坑）。

### 第二步：写 handler

期限的端点归 `lawmind-server-route-lawyer-desk.ts`（它已经在管 `/api/matters/:matterId/deadlines`）。所以**不新建文件**，在那里加一个分支：

```ts
const summaryMatch = pathname.match(/^\/api\/matters\/([^/]+)\/deadline-summary$/);
if (summaryMatch && req.method === "GET") {
  const matterId = summaryMatch[1];
  if (!isValidMatterId(matterId)) {
    sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
    return true;
  }
  const records = await listDeadlinesForMatter(workspaceDir, matterId);
  const view = annotateDeskDeadlines(records);
  sendJson(res, 200, { ok: true, matterId, total: view.length, items: view }, c);
  return true;
}
```

**四个点对照**：

| 点                     | 做法                                                 |
| ---------------------- | ---------------------------------------------------- |
| 路径匹配用**正则捕获** | 不是 `startsWith`（要拿到 `:matterId`）              |
| matterId 先**校验**    | `isValidMatterId`，不合法返 400                      |
| 错误也 `return true`   | 因为**这个 handler 已经处理了**（返回 400 也算处理） |
| 传了 `c`               | 必须的                                               |

### 第三步：注册 handler

**不用改注册表**——因为这个 handler（`handleLawyerDeskRoutes`）已经在 `LAWMIND_ROUTE_HANDLERS` 里了。

**只有新建路由文件时**才需要往注册表加，而且要**插在合适的位置**（第 14.5 节讲了顺序有意义）。

### 第四步：加客户端常量

在 `apps/lawmind-desktop/src/renderer/lawmind-api-routes.ts` 里加一条（路径集中管理，别在组件里写字符串）。

### 第五步：加 query key 与 hook

按第 50.5 节的约定：

```ts
// lawmind-query-keys.ts
deadlineSummary: (apiBase: string, matterId: string) =>
  ["lawmind", "deadline-summary", apiBase, matterId] as const,
```

**key 带 `apiBase`**（端口变了要重新取），**前缀是 `lawmind`**（便于整体失效）。

然后在 `lawmind-query-hooks.ts` 里加一个 `useLawmindDeadlineSummary(apiBase, matterId)`。

### 第六步：测试（示例2）

新建或加到 `lawmind-server-route-lawyer-desk.test.ts`：

```ts
it("GET /api/matters/:id/deadline-summary 返回分组", async () => {
  /* ... */
});
it("invalid matter id 返回 400", async () => {
  /* ... */
});
it("未匹配的路径返回 false，交给下一个 handler", async () => {
  /* ... */
});
```

**第三条容易被忽略**：`return false` 是契约的一部分，要测。

### 第七步：如果手写了 `writeHead`，检查 CORS

用 `sendJson(..., c)` 就没事。**如果因为要流式或下载而手写 `res.writeHead`，必须带 `...c`。**

有一条结构测试（`lawmind-server-cors-structure.test.ts`）会扫这件事——**它红了就是你漏了**。

## 52.4 三条通用流程

把三个示例的共同部分提出来。

### 流程一：先找「该调谁」

三个示例的第一步都是「查已有的实现」：

| 改动         | 先找                                                                    |
| ------------ | ----------------------------------------------------------------------- |
| 加工具       | 领域模块里的服务函数（`application/services/`、`desk/`）                |
| 加 lint 规则 | `lint/statute-params.ts`（参数有没有现成出处）、`lint/types.ts`（形状） |
| 加端点       | 已有同域的路由文件（**优先加分支，不新建文件**）                        |

**这条最重要**：这个仓库分层清晰，**大部分新功能不需要写新逻辑，只需要把已有能力接出来**。

### 流程二：改动要「成组」

每类改动都有一组必须同时动的地方：

| 改动      | 必须成组的                                                |
| --------- | --------------------------------------------------------- |
| 工具      | 实现 + 注册 + 名字集合（+ 披露/保留名/沙箱三选）          |
| lint 规则 | 实现 + 注册进数组（+ 族判定）                             |
| 端点      | handler + （新建文件才要）注册表 + 客户端常量 + query key |

**只动一半会静默失效**：比如工具写了没注册，它根本不存在；端点写了没注册，404。

### 流程三：每个改动都要有「反例测试」

三个示例的测试都强调反例：

| 改动      | 反例                                   |
| --------- | -------------------------------------- |
| 工具      | 没绑案件、空结果、边界值（7 天/30 天） |
| lint 规则 | **只出现一个词不能报**                 |
| 端点      | 非法 id、不匹配的路径返 false          |

**为什么反例比正例重要**：正例不过你会立刻发现；**反例会静默地把噪音灌进律师的工作台**。

## 52.5 已知坑（本章相关）

- **工具层不写算法。** 先找领域模块有没有现成的。
- **工具写进 `tools` 数组就开局广告；要按需披露就进 `DISCLOSED_TOOL_HINTS`。**
- **治理元数据是自动推导的**，把工具加进正确的名字集合就等于写好治理信息。
- **lint 规则是纯函数**，先判「适不适用」再干活。
- **lint 发现项要带 `anchor` 与 `statuteRef`。**
- **有误报的规则不要接硬门禁。**
- **路由优先加分支，不新建文件。**
- **路由的三个契约**：不匹配 `return false`、处理了 `return true`、`sendJson` 带 `c`。
- **路径参数要先校验**（`isValidMatterId`）。
- **手写 `writeHead` 必须带 `...c`**，有结构测试守着。
- **query key 带 `apiBase`、前缀是 `lawmind`。**
- **反例测试不能省。**
- **别测「description 里有某个词」。**
