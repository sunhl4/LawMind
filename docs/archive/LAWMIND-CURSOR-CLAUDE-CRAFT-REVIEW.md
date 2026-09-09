# Cursor / Claude 式「高级引导」全工程对照审查

> **状态**：目标级对照文档（2026-08-09）  
> **原则**：用 **Skill / 原则 / 自评量规 / 软教练 / 提案–接受** 发挥模型判断力；**硬控只留给安全、空交付、律师权威与滥用护栏**。  
> **已落地样板**：合同改稿 Craft Skill（`src/lawmind/drafts/contract-redline-craft.ts`）+ `craft_check` + soft `craftSignals`。  
> **关联**：[GOALS.md](../GOALS.md) §二 / 第十三期 · [LAWMIND-REFERENCE-PROJECT-LESSONS.md](LAWMIND-REFERENCE-PROJECT-LESSONS.md)

---

## 0. 何谓「高级」vs「低级硬控」

|            | 低级硬控                             | 高级（Cursor / Claude / Codex 做法）        |
| ---------- | ------------------------------------ | ------------------------------------------- |
| 手段       | 字数/条数/句号/关键词正则 → 直接拒绝 | Skill、原则、工作流、自评量规、工具结果教练 |
| 模型角色   | 被规则替掉判断                       | 在原则内行使专业判断                        |
| 失败形态   | 静默拒写 / 假完成 / 浅改交差         | 可见反馈 → 反思 → 再改；律师 Accept/Reject  |
| 硬拦截保留 | 滥用成默认                           | 仅：安全、空交付、律师未批、密钥/网络边界   |

**三条产品铁律不变**（上手简单 / 质量高 / 稳定高）。高级引导是为第 2、3 条服务：质量靠判断力，稳定靠可解释门禁，而不是靠「禁止清单」假装稳定。

---

## 1. 已对齐（Keep / Extend）

| 模式                            | 落点                                                 | 说明                                          |
| ------------------------------- | ---------------------------------------------------- | --------------------------------------------- |
| Craft Skill + 自评              | `drafts/contract-redline-craft.ts`；邮件短路径注入   | 原则 + 量规 + `craft_check`；宽改动 soft warn |
| 外科落改 validity-only          | `drafts/apply-surgical-edits.ts`                     | 空 find / 未匹配才拒；风格不硬杀              |
| 提案式 Redline                  | `drafts/redline-proposal.ts` + `LawmindRedlinePanel` | Cursor L1：Accept / Reject                    |
| RULES / 强制规则注入            | `policy/workspace-policy.ts`、`system-prompt.ts`     | Cursor L5：律师权威规则（≠ 禁止清单 spam）    |
| @钉源 / ContextPlan             | compose pins、`runtime/context-plan.ts`              | Cursor L2                                     |
| 检查点续跑                      | pause / resume                                       | Cursor L4                                     |
| SKILL.md 运行时                 | `skills/skill-runtime.ts`、签名校验                  | 可扩展为默认引导载体                          |
| 审核自检 / 核对清单             | `verification-checklist.ts`、Review self-check UI    | 律师量规                                      |
| 空修订门禁                      | `tracked-render-hunk-gate.ts`                        | **应保持硬**：假交付                          |
| 危险工具批准                    | `dangerous-tool-policy.ts`                           | **应保持硬**：安全                            |
| 网络 allowlist / 不可信正文围栏 | `network-allowlist.ts`、`content-trust.ts`           | **应保持硬**：安全                            |
| Demo 语料拒写中高风险稿         | `engine-tool-shared.ts`                              | **应保持硬**：信任                            |
| 审核未通过不得终稿              | `review-gates.ts`、acceptance                        | **应保持硬**：律师权威                        |

---

## 2. 应升级（判断类硬控 → Craft / Skill）

优先级：P0 = 立刻影响交付质量或误伤专业改稿；P1 = 摩擦大；P2 = 卫生/一致性。

### 2.1 P0 — 合同改稿双轨不一致

| 现状                                                                | 路径                                                        | 高级替代                                                                                        |
| ------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `update_draft` 仍跑 **整稿 rewrite amplitude 硬拒**（~25% 或 Δ400） | `drafts/surgical-edit-gate.ts` → `engine-pipeline-tools.ts` | 与 `apply_surgical_edits` 对齐：soft craftSignals；大改写可进 Redline 待律师 Accept，勿静默拒写 |
| 邮件路径已 Craft，意见书路径仍 `## 禁止` 工具名单                   | `lawyer-automations.ts` opinion 分支                        | 复用 Craft +「路径已钉选」原则；工具约束用 ContextPlan/allowlist 元数据表达                     |

### 2.2 P0 — Intake / 关键词澄清过度冻结

| 现状                                                | 路径                                                      | 高级替代                                                                       |
| --------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 关键词/长度启发式 → 回合前 `awaiting_clarification` | `router/intake-gate.ts`、`turn-orchestrator-shortcuts.ts` | 默认「软问」：先只读收集再问；钉源/邮件快路径已豁免 → 扩到更多「材料已齐」场景 |
| `instruction.length < 40` 等编造必答题              | `router/deliverable-meta.ts`                              | 交付物 Skill：Required Inputs 原则；模型提案问题，不机械冻结写工具             |
| 诉讼 triage 强制「必须先澄清」                      | `triage/rules.ts`                                         | 分诊结果作**建议**与色标，不自动闸死 agent                                     |

### 2.3 P1 — Prompt 「禁止」面过大

| 现状                         | 路径                                   | 高级替代                                                                        |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| 系统提示密集禁止列表         | `agent/system-prompt.ts`               | 短原则常驻；「交付用语 Skill」「安全 Skill」按需注入（Cursor rules 分层）       |
| 交付管线额外禁止块           | `agent/deliverable-pipeline.ts`        | 单一 deliverable-pipeline skill                                                 |
| 邮件短路径仍夹带长工具禁名单 | `mail-contract-fast-path.ts`（ops 段） | 收成一句原则：「路径已钉选，禁止再发现」；质量全交给 Craft                      |
| 工作流种子/模板禁语          | `builtin-workflow-templates.ts`        | 质量靠 Craft；`send_email` 禁发保留为**安全硬约束**（可写成 workflow metadata） |

### 2.4 P1 — 工具配额当质量阀

| 现状                      | 路径                                               | 高级替代                                                                     |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| 默认 25 次 tool call 硬停 | `turn-orchestrator.ts`、`agentMaxToolCallsPerTurn` | Claude 式：软预算 + 检查点「是否继续」；硬顶只防 runaway（保留较高 ceiling） |

### 2.5 P2 — 其它启发式质量分

| 现状                              | 路径                                  | 高级替代                                    |
| --------------------------------- | ------------------------------------- | ------------------------------------------- |
| 专案组 `score = 90 - findings×12` | `review-campaign/serial-runner.ts`    | 量规自评 / Safety Score 与发现数解耦        |
| 关键词极性冲突聚类                | `reasoning/keyword-draft.ts`          | Reasoning skill + 引用                      |
| IRAC `minIssues` 等数字地板       | `deliverables/reasoning-validator.ts` | 结构缺失可硬；「至少 N 个争点」→ 量规软提示 |
| 修订积累 / 审查学习已偏软         | `learning/*`                          | 继续用偏好回流，勿加新硬杀                  |

---

## 3. 必须保持硬控（对照表）

| 门禁                                    | 为何硬           | 备注                   |
| --------------------------------------- | ---------------- | ---------------------- |
| 空 Redline / 空验收 blocker 导出        | 假交付           | 可配教练文案，不可默许 |
| `reviewStatus` / 核对清单未完成         | 律师权威         | bypass 须显式知情      |
| 危险工具 / `send_email` 未批准          | 安全             | Edition 严格批准       |
| Demo 语料中高风险起草                   | 信任             |                        |
| 网络 allowlist / SSRF / 密钥不进 prompt | 安全             |                        |
| 不可信附件围栏                          | Prompt injection |                        |
| 字段长度 / absurd batch                 | DoS / 误传       | 勿写成产品「改点上限」 |
| `example.com` 等假邮箱                  | 防假外发         |                        |

---

## 4. 目标架构（全产品默认姿势）

```text
律师 Rules / Matter RULES.md  ──硬注入──► 系统原则（短）
                                      │
交付物 / 场景 Skill（Craft、Intake、Citation…）──按需注入──► 模型判断
                                      │
工具结果 soft coaching（craftSignals / self-check）──反思环──► 再调用
                                      │
提案（Redline / RequiresAction）──律师 Accept──► 落盘 / 外发
                                      │
空交付·安全·未批准 ──硬门禁──► 拒绝（可解释）
```

**工程口令**：新能力默认问「这是 Skill/量规，还是硬拦截？」——只有上表「必须保持」类才能硬。

---

## 5. 第十三期验收草案（与 GOALS 对齐）

1. **原则入宪**：`GOALS.md` / `LAWMIND-VISION.md` 写明「高级引导优先于判断类硬控」。
2. **双轨合一**：`update_draft` amplitude 改为 soft（或大改强制走 Redline 提案）；单测证明专业整段修订不被误杀。
3. **Intake 软化**：关键词长度闸默认不冻写路径；邮件/钉源/材料齐备场景零假澄清。
4. **Skill 面**：至少 3 个内置 Craft 类 skill（合同改稿已有；补 Intake、Citation/交付用语）；`lawmind/skills` 可发现。
5. **禁止名单瘦身**：自动化意见书路径与系统提示去掉重复「禁止工具」spam，改为原则句 + allowlist 元数据。
6. **工具预算**：软预算提示 + 检查点续跑；硬顶仅防 runaway。
7. **回归**：邮件合同审阅 E2E / craft 单测 / 空修订仍拒导出。

---

## 6. 进度快照（2026-08-09）

| 项                                            | 状态          |
| --------------------------------------------- | ------------- |
| 合同 Craft Skill + craft_check + soft signals | ✅            |
| `apply_surgical_edits` 去风格硬拒             | ✅            |
| 邮件短路径注入 Craft                          | ✅            |
| 工作区 `mail-contract-redline` 种子升级       | ✅            |
| `update_draft` amplitude soft 化              | ✅            |
| Intake / deliverable-meta 去关键词冻结        | ✅            |
| 意见书自动化禁语 → 原则                       | ✅            |
| 系统提示分层 Skills                           | ✅            |
| 工具预算检查点 UX                             | ✅            |
| 桌面默认模型路由（有凭据即分类，关键词回退）  | ✅ 2026-08-19 |
| 系统提示：勿等律师先选通道                    | ✅ 2026-08-19 |
| 高频办件产品化能力（Skill + 流水线自动绑定）  | ✅ 2026-08-19 |

---

_最后更新：2026-08-19_
