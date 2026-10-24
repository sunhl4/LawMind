# 自动化执行层：合 main 前的律师可用回归清单

- 分支：`feat/automation-parity`
- 适用：把 `src/lawmind/review/`、`src/lawmind/drafts/branch.ts`、`src/lawmind/evaluation/all-pass.ts` 合进 main 之前
- 原则：**默认助手路径不得变坏**；新能力挂显式入口与开关

---

## 1. 硬门槛（任何一条不过 → 不合 runtime）

| #   | 检查       | 命令 / 动作                                                                                                            | 通过标准                                              |
| --- | ---------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | 全量测试   | `pnpm test`                                                                                                            | 全绿；新增红必须与本分支相关                          |
| 2   | 引擎类型   | `npx tsc --noEmit -p tsconfig.json`                                                                                    | 无错                                                  |
| 3   | 桌面类型   | `pnpm --filter lawmind-desktop typecheck`                                                                              | 无错                                                  |
| 4   | 回合准入   | `pnpm exec vitest run src/lawmind/agent/turn-orchestrator-cassettes.test.ts`                                           | 全绿                                                  |
| 5   | 子工契约   | `pnpm exec vitest run src/lawmind/agent/draft-worker.test.ts src/lawmind/product/single-parent-agent-contract.test.ts` | 全绿                                                  |
| 6   | 修订保真   | `pnpm exec vitest run src/lawmind/drafts/word-surface src/lawmind/drafts/word-revision`                                | 全绿；合并后重新打开 docx，`w:ins`/`w:del`/格式仍在   |
| 7   | 开关默认关 | `printenv LAWMIND_RULE_BRANCH_WRITE`                                                                                   | 空或非 `1`；`executeRuleReview` 返回 `enabled: false` |

## 2. 日常助手 5 分钟手工回归（开关关）

逐步做，任一步炸就停：

1. 打开桌面 app → 新建/进入一个案件；
2. 说一句普通问题（例：「这份合同的违约责任怎么写更稳」）→ 有回复，无报错；
3. 钉一份 `.docx` → 说「把违约金比例改成万分之五」→ 出修订稿；
4. 在修订稿里接受一处、拒绝一处 → 保存；
5. 关闭并重新打开该文件 → 修订轨、格式、批注仍在；
6. 工作台：今日 / 期限 / 谈话三页能开；
7. 外发邮件仍停在「待我拍板」。

## 3. 新旧路径隔离（开关关）

- 不出现「规则覆盖 incomplete」之类挡交件；
- 不出现规则审查进度条 / `rule_result` 事件；
- 普通回合的延迟与合入前无明显差异（规则审查可以慢，日常不能）。

## 4. 开关打开时（内测）

- 12 条 playbook：派 6 或 12 支，**每支都有分类**，缺一即报 incomplete；
- 两条规则改同一句话 → 产生 conflict，交给人/lead，**不静默覆盖**；
- 单支超时只重试那一支，不重跑整次；
- worker 工具表**不含** `apply_surgical_edits` / `render_tracked_draft` / `draft_document` / `update_draft` / `write_document`。

## 5. 不许带上 main 的东西

- 任何未过 §1 的运行时代码；
- `LAWMIND_RULE_BRANCH_WRITE=1` 作为默认值；
- 与「可审计对外当卖点」相关的文案改动（与 `GOALS.md` §二 冲突）。

## 6. 回滚

1. 关开关 `LAWMIND_RULE_BRANCH_WRITE`（或删掉该 env）；
2. 若已合 main 且出现问题：revert 本分支 runtime 提交即可，`review/` 与 `branch.ts` 无数据格式迁移，无持久化 schema 变更。
