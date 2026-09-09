# LawMind 律师可观测性指标

`src/lawmind/metrics/` 提供**基于已落地事件的真实口径指标**，不输出无法验证的「安全分」「质量分」。

## 模块职责

- `runtime-events.ts` / `product-metrics.ts`：事件真相源（runtime 事件与派生产品指标）。
- `north-star.ts`：全工作区 north-star 比率（一次过率、lint 逃逸率等）。
- `team-growth-dashboard.ts`：团队内测指标表（Wave A–D DoD）。
- `lawyer-dashboard.ts`：律师可观测性仪表盘——**案件级**真实指标与 **LawmindDesk** 汇总。

## 案件级指标口径（`buildMatterHealthMetrics`）

输入：一个案件的 `runtime-events`、`product-metrics`、签批/队列/期限数据。
输出：

| 指标               | 计算口径                                                                                                                          | 律师语言                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `lintCoverageRate` | 已触发机械核对规则数 / 已注册相关规则数。未传入外部规则集时，分母使用引擎内置 `LEGAL_LINT_RULES + CITATION_VALIDITY_RULE_COUNT`。 | 已核对 X% 的机械规则          |
| `editRate`         | `lawyer_edit` 中 `outcome === "modified"` 的事件 / 全部 `lawyer_edit` 事件。                                                      | AI 建议后被律师实质修改的比例 |
| `firstPassRate`    | `deliver` 事件中 `firstPass === true` 的比例。                                                                                    | 首次交付无需修改的比例        |
| `pendingApprovals` | 案件签批记录中 `status === "pending"` 的数量。                                                                                    | 待拍板数                      |
| `overdueTasks`     | 案件期限记录中 `status === "open"` 且 `dueAt` 已过当前时间的数量。                                                                | 逾期任务数                    |
| `lastActivityAt`   | 所有 runtime/product/签批/队列/期限事件中的最新时间戳。                                                                           | 最近活动时间                  |
| `phase`            | 按「待签批 → 待改稿 → 可交付 → 交办」推导的当前阶段。                                                                             | 当前阶段                      |

注意：无样本时，所有比率返回 `null`，不会编造 `0%` 或 `100%`。

## 全工作区汇总（`buildLawyerDeskDashboard`）

- 遍历工作区下所有案件，计算每个案件的 `MatterHealthMetrics`。
- 按 `lastActivityAt` 倒序排列。
- 输出：
  - `totalPendingApprovals`：全工作区待拍板总数。
  - `totalOverdueTasks`：全工作区逾期任务总数。
  - `todayActivityCount`：今日（本地 0 点起）runtime 事件总数。
  - `thisWeekFirstPassCount`：近 7 天内 `firstPass === true` 的交付事件数。
