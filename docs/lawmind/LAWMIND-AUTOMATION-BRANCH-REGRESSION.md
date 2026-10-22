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

---

## 7. 本轮实测（2026-10-22，`feat/automation-parity`）

环境：worktree `../LawMind-automation`；根 `node_modules` 与 `apps/*/node_modules` 软链到主检出；本地生成 `.gitignore` 内的 `sandbox-runtime.js`（`apps/lawmind-desktop/scripts/build-canvas-sandbox.mjs`）。

- 引擎类型：`npx tsc --noEmit -p tsconfig.json` → 无错
- 全量测试：`pnpm test` → 1108 passed / 2 skipped（1110 文件）；8059 passed / 5 skipped（8064 用例）
- 桌面类型：`pnpm --filter lawmind-desktop typecheck` → 无错
- 编译门禁：`pnpm lawmind:compiler-gate` → pass（rules=74 shadows=12 plantedRecall=1）
- 规则级 all-pass 夹具：`pnpm lawmind:allpass --validate` → PASS（20 用例，每例覆盖其纸别下全部 6 条规则）
- 评分器自检：`pnpm lawmind:allpass --arm oracle` → PASS 20/20（oracle 回放，非模型分数）

新增断言：

- `turn-orchestrator-cassettes.test.ts`（5 条）：flag 关 —— `draft_worker` 无 `rule_id`、无 `finalize_rule_review`；flag 开 —— 两者都在；六条规则派完 → `finalize_rule_review` 返回 `coverageComplete`、`ruleCount=6`、`conflictCount=0`；只派两条 → `ok:false` + `rule_review_incomplete` + 恰好 4 条 missing 且不含已派的两条；同一句两规则给不同改法 → `conflictCount=1` 且并列列出，不替你择一。这是「关 = 逐字节一致」与「漏规则不得声称完成」的机器证据。
- `finalize-rule-review-tool.test.ts`（13 条）：漏规则返回 `rule_review_incomplete` + `missingRuleIds`；全分类才 `coverageComplete: true`；同句异值报 `same_anchor_different_text`；同句同值不报冲突；`base_version` 只做留痕回显（不声称合并）；未知 playbook 不回落到默认；纸别外的判定不算覆盖。
- `review/bridge.test.ts`：缺 `ruleId` / 计划外 / 重复 / 缺分类都进 `invalid`，引擎不补默认值。
- `agent/factor-state.test.ts`：同句多改不再取第一条（B2 回归）。
- `evaluation/rule-allpass.test.ts`：漏判、错判、越界、重复判定、夹具覆盖不完备、非法期望值、正文过短、SKIP/validate 报告不得出现准确率。
- `evaluation/rule-allpass-model-arm.test.ts`（10 条）：每条规则恰好一次调用；错判记 mismatch 不算通过；缺判定记 missing + failures；401 即 `stoppedEarly` 且只跑完当前例；单规则超时记 missing 不拖垮整臂；`maxCases` 生效；完美分类器与 oracle 结果一致。

### 未随本轮验证（诚实标注）

- 真机 Word 侧载与桌面 5 分钟手工回归（§2）尚未执行——需人机交互，留待合 main 前由工程师按清单走一遍。
- 规则级 all-pass：`oracle` 自检 20/20（仅证明评分器接线）；`--arm deepseek` 真实模型臂已接线（走生产 `draft_worker` review 路径），但**合成夹具上的分数只能说明流程接线，不得作为真实合同准确性证据**。真实准确性需律师提供脱敏真稿后另跑。见 `fixtures/lawmind-allpass/README.md`。

### CI 存量红（与本分支无关，已定位）

`main`（`c5bd27ef3`）本身 CI 为 failure；本分支继承同一批红，**新增失败 0 个**：

|        | 失败文件 | 失败用例 | 通过用例 |
| ------ | -------- | -------- | -------- |
| `main` | 6        | 12       | 7948     |
| 本分支 | 6        | 12       | 8045     |

逐项归因：

- `sandbox-runtime.js` 是 gitignore 的生成物，CI 的 `verify` / `desktop-e2e-mock` / `acceptance-gate` 却直接跑测试或起 Vite，导致 2 个 renderer 测试与 e2e 失败。**已在本分支补构建步**（`lawmind-ci.yml`、`lawmind-deliverable-gate.yml`、`lawmind-desktop-e2e.yml`）。
- `render-docx-tracked`（9 例）、`task-chains`、`safe-shell-command` 依赖本机 `officecli` / WPS，CI 无此环境——main 同样红，未在本轮处理。
- `file-size-check`：13 处存量超标，全在本分支未触及的文件。
- `lawmind-desktop-e2e-electron`：实际用例通过，失败在 `Upload E2E diagnostics`——GitHub Actions artifact 存储配额用尽。
