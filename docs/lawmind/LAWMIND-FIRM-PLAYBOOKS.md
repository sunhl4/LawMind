# 本所剧本（工作区三色分流）

> 适用范围：LawMind 桌面版设置 → 工作区 → 剧本；接口 `/api/playbooks*`。
> 与 `contract-playbook-review` 技能里的「三档审查」不是同一层：那份是审查方法与提示；本页是**本所自己的交付条件**，落在工作区 JSON 里，起草落盘时自动跑一次三色分流。

## 1. 它解决什么

律师/律所把「这份交付物什么样才算过」写成条件，LawMind 在草稿落盘时逐条核对：

- 全部 `green` 条件有据通过 → `GREEN`（仍需一键签发，不自动外发）；
- 任一 `red` 条件命中 → `RED`（须全面审阅；律师可写理由降档）；
- 其余情况 → `YELLOW`（逐项待确认）。

没有剧本时返回 `basis=default`，明确写「通用标准（未加载本所剧本，不代表本所立场）」，不冒充本所立场。

## 2. 适用交付物

剧本的 `deliverableTypes` 是前缀匹配：

- `contract.`：合同审查、合同起草等合同类交付物，走条款抽取 + 正文检查；
- `memo.`：意见书、内部备忘、研究备忘，只走正文检查；
- `litigation.`：起诉状、答辩状、代理词、诉讼提纲，只走正文检查。

没写 `deliverableTypes` 的剧本适用于以上全部已支持类型。工作区里按类型过滤后**恰好一份**剧本才跑分流；0 份或多份都不猜，如实不出结论。

## 3. 条件与检查方式

每条条件有 `kind: "green" | "red"`、`title`，以及可选的 `check`。不写 `check` 的条件由律师/模型给结论与引用。

| `check.kind`       | 判定方式                                 | 通过/不通过口径                                                    |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------ |
| `clause_present`   | 合同条款抽取后按 `clauseTypes` 找条款    | 找到给逐字引用 + 行号；找不到 `FLAG`（可能是抽取失败，不判不符合） |
| `section_present`  | 正文里找 `headings` 中的章节标题         | 找到标题行给引用 + 行号；找不到 `FLAG`                             |
| `phrase_present`   | 正文里逐字找 `phrases`                   | 找到给引用 + 行号；找不到 `FLAG`                                   |
| `phrase_absent`    | 正文里逐字找禁止表述                     | **命中才 `FAIL`**（附引用）；未命中一律 `FLAG`，不自动 `PASS`      |
| `citation_present` | 保守匹配带书名的法条、常见法典条号或案号 | 找到给引用 + 行号；找不到 `FLAG`                                   |

两条硬线：

1. **没有逐字引用 + 位置，不出 `PASS`**。回读核对（`playbook-triage-verify.ts`）找不到原句、文件没了、版本变了、格式读不了，一律降 `FLAG`。
2. **否定性结论不能靠「没找到」证明**。`phrase_absent` 未命中只说明这次没扫到，不能据此判 `GREEN`，必须由律师确认。

## 4. 怎么建一份剧本

设置 → 工作区 → 剧本 → 新建剧本，填写：

- 编号：会变成文件名，只能用字母、数字、点、下划线与连字符；
- 名称、版本、标准立场、可接受区间、升级触发；
- 适用范围：一行一条，例如 `contract.review`、`memo.opinion`、`litigation.complaint`；
- 条件：每条选 `green`/`red`、写标题、选机械核对方式；选「必含条款」时再选条款类型。

保存后只影响**之后**新生成的草稿；已生成的草稿不会重算。

### 示例：意见书结构剧本

```json
{
  "id": "prc.memo.opinion",
  "name": "意见书结构（示例）",
  "jurisdiction": "PRC",
  "version": "1.0.0",
  "stance": "",
  "acceptableRange": "",
  "escalationTriggers": ["涉及行政处罚"],
  "deliverableTypes": ["memo.opinion"],
  "criteria": [
    {
      "id": "issue",
      "kind": "green",
      "title": "有争议焦点",
      "check": { "kind": "section_present", "headings": ["争议焦点"] }
    },
    {
      "id": "advice",
      "kind": "green",
      "title": "有明确建议",
      "check": { "kind": "phrase_present", "phrases": ["建议"] }
    },
    {
      "id": "guarantee",
      "kind": "red",
      "title": "不得保证结果",
      "check": { "kind": "phrase_absent", "phrases": ["保证胜诉", "保证结果"] }
    }
  ]
}
```

## 5. 接口

- `GET /api/playbooks`：列出工作区剧本；
- `GET /api/playbooks/:id`：读一份完整剧本；
- `POST /api/playbooks`：新建/覆盖（请求体与落盘共用 `PlaybookInputSchema`）；
- `DELETE /api/playbooks/:id`：删除；
- `POST /api/playbooks/triage`：收 `{ playbookId, observations, override? }`，先回读核对引用，再出三色结论。

## 6. 边界

- **不内置任何法律条款**。没有剧本就是 `basis=default`；示例只演示结构，不是中国法审查清单。
- **不做自动外发**。`GREEN` 也只是「最多一键签发」，`RED` 必须全面审阅；律师 override 必须写理由并留痕。
- **非合同交付物不做条款抽取**。`clause_present` 条件在 `memo.` / `litigation.` 上如实降 `FLAG`，由律师核对。
- **不把日志、哈希链、审批包装成法律正确性证明**。剧本只回答「本所条件有没有有据通过」，不回答「法律上一定正确」。

## 7. 关键文件

- `src/lawmind/deliverables/playbook-triage.ts`：条件类型、三色聚合、正文检查；
- `src/lawmind/deliverables/playbook-triage-verify.ts`：引用回读核对；
- `src/lawmind/deliverables/playbook-store.ts`：工作区 JSON 读写与校验；
- `src/lawmind/delivery/draft-playbook-triage.ts`：起草落盘时按交付物类型选剧本并分流；
- `apps/lawmind-desktop/src/renderer/LawmindSettingsPlaybooks.tsx`：设置页编者界面。
