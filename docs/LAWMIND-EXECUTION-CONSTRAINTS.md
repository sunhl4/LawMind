# LawMind 执行约束对照（51 条 + 手改影响面）

本文给律师/维护者**逐条核对**用。每一条写清：文件在哪、运行时干什么、手改会怎样、这次优化改了什么。

**不要把本文当成第二套产品原则。** 北极星仍是 `GOALS.md`。LawMind 是律师用的 Codex：Skill 管质量，工具默认可用；不要做成「多条硬管线的集成器」。改约束时先改代码里的单一真相源，再改本文。

相关测试：

```bash
pnpm exec vitest run \
  src/lawmind/platform/contract-fast-lane-instruction.test.ts \
  src/lawmind/agent/prompt-protocol-gate.test.ts \
  src/lawmind/agent/turn-orchestrator-prompt.test.ts \
  src/lawmind/agent/turn-orchestrator-cassettes.test.ts \
  src/lawmind/agent/system-prompt.test.ts \
  src/lawmind/research/research-protocol.test.ts \
  src/lawmind/drafts/redline-plan.test.ts \
  src/lawmind/drafts/paired-review-deliverable.test.ts \
  src/lawmind/drafts/audience-split.test.ts \
  src/lawmind/practice/bilateral-review.test.ts \
  src/lawmind/practice/user-standards.test.ts \
  src/lawmind/router/intake-gate.test.ts \
  src/lawmind/memory/lawyer-profile-for-prompt.test.ts \
  src/lawmind/memory/applied-preferences.test.ts \
  src/lawmind/agent/runtime.test.ts \
  src/lawmind/runtime/same-turn-verify.test.ts \
  src/lawmind/agent/same-turn-verify-cassette.test.ts \
  src/lawmind/runtime/legal-verify-middleware.test.ts \
  src/lawmind/drafts/legacy-update-draft-warning.test.ts \
  src/lawmind/agent/world-state.test.ts
```

---

## 怎么读

| 列     | 含义                                                   |
| ------ | ------------------------------------------------------ |
| 裁决   | KEEP / TIGHTEN / MERGE / FIX / DROP（2026-09-12 评审） |
| 运行时 | 会不会进模型提示词、会不会硬拦工具                     |
| 手改   | 改这个文件会立刻影响下一轮对话 / 导出 / 办件           |

---

## 一、北极星（产品原则，不进每一轮 prompt）

### 1. 律师产品四条铁律 — KEEP

- **路径**：`GOALS.md` §二
- **作用**：上手简单 / 交付质量 / 稳态 / 先复用后自研。否决立项与主路径取舍。
- **手改**：改这里会改团队口径，但**不会**自动改模型行为。要把铁律变成行为，必须改下面的提示词或硬门禁。
- **本次**：未改条文。

### 2. 软教练优先、硬拦截克制 — FIX

- **路径**：`GOALS.md` §二「Agent 引导原则」
- **作用**：规定什么时候用软教练、什么时候硬拦。
- **手改**：只改文档不改引擎。真正硬拦在 `surgical-span-gate.ts`、`dangerous-tool-policy.ts`、工具锁。
- **本次**：补了一句例外：跨度硬门禁可以硬拦；路径识别不得同时锁工具又注入相反协议。

### 3. 不把可审计当产品价值 — FIX

- **路径**：`GOALS.md` §二「关于可审计」
- **对照**：旧 `src/lawmind/agent/system-prompt.ts` 原则 5「全程可追溯」
- **作用**：GOALS 否定「可审计=可信」。
- **手改**：只改 GOALS 不会改模型。模型看的是 system prompt。
- **本次**：系统提示词改为「结论能指回来源；日志只服务调试与撤销」。

### 4. 第十六期：标准是律师写的 — TIGHTEN

- **路径**：`GOALS.md` §三；实现 `src/lawmind/practice/user-standards.ts`；落盘 `workspace/lawmind/standards/*.json`（若有）
- **作用**：律师可增删停用审查标准；学习项默认关。
- **手改**：在设置里改标准，或直接改 `lawmind/standards/*.json`，下一轮匹配到的办件会换口径。
- **本次**：内置合同标准不再抄 playbook 永不接受；补了诉讼收案与中国合同审查清单；每日邮件关键词收窄。

---

## 二、系统提示词（几乎每轮都在）

组装入口：`src/lawmind/agent/turn-orchestrator-prompt.ts` → `src/lawmind/agent/system-prompt.ts`。

行为版本号：`LAWMIND_AGENT_BEHAVIOR_EPOCH`（以 `src/lawmind/agent/system-prompt.ts` 为准）。改静态原则后必须改这个值，否则旧会话可能继续用缓存前缀。

### 5. 身份与核心原则 — TIGHTEN

- **路径**：`src/lawmind/agent/system-prompt.ts`（`staticHead`）
- **作用**：告诉模型它是任务型助理，不是聊天机器人。
- **手改**：这里的每一句都会进所有对话。改长了会占上下文；改错了会带偏所有办件。
- **本次**：六条压成四条。删「全程可追溯」。强调先看本轮工具表。

### 6. 自主工作流程三步 — TIGHTEN

- **路径**：同上，`## 自主工作流程`
- **作用**：教模型先理解、再执行、再汇报。
- **手改**：会改变模型是否调用 `execute_workflow`。
- **本次**：删「最强大的能力 / 能用就用」。未锁时工具都可用、按任务选用；锁路径按工具表。不再把 `execute_workflow` 写成唯一正途。

### 7. 律师审核与交付闭环 — MERGE

- **路径**：`system-prompt.ts` `## 律师审核与交付闭环`；细则 `src/lawmind/skills/builtin/delivery-language.md`
- **作用**：待审核稿不得写成可签发。
- **手改**：系统提示词是每轮必见；Skill 只在 lean 注入时出现。两处打架时模型听更长的那份。
- **本次**：系统提示词只留三条；细则交给交付用语 Skill。

### 8. 默认汇报格式 — DROP

- **路径**：`system-prompt.ts` `## 回答规范`
- **作用**：旧五段汇报（摘要/发现/风险/路径/待确认）会把 Word 改稿带成意见书。
- **手改**：改这里影响所有回合的说话方式。
- **本次**：默认「结论在前」。长汇报只建议给意见/备忘/报告。

### 9. 安全边界 — KEEP

- **路径**：`system-prompt.ts` `## 安全边界`；硬拦 `src/lawmind/agent/dangerous-tool-policy.ts`
- **作用**：不编造法条、不代替律师决策、外发要拍板。
- **手改**：提示词是软的。真拦外发看 `toolRequiresExplicitApproval` 和 `toolRequiresLawyerPause`。
- **本次**：未改硬政策。

### 10. 未决澄清硬拦 — FIX

- **路径**：
  - 键集合：`src/lawmind/router/intake-gate.ts`（`HARD_CLARIFICATION_KEYS`）
  - 写入会话：`src/lawmind/agent/turn-orchestrator-finalize.ts`
  - 下一轮拦工具：`src/lawmind/agent/turn-orchestrator.ts` → `src/lawmind/runtime/tool-pipeline.ts`（`clarificationGateMiddleware`）
  - 提示词：`turn-orchestrator-prompt.ts`「未决澄清要点」
- **作用**：只有函件收件人/主张、诉讼主体/诉请会跨轮拦住起草。租金、审查重点等不再跨轮硬拦。
- **手改**：往 `HARD_CLARIFICATION_KEYS` 加键，等于把这类缺口升级成「不答就不能写」。删键则相反。
- **本次**：实现了「硬拦只留给高风险空跑」。跨轮只持久化硬键；同轮工具返回的软澄清也不再置位 `clarificationBlockingHeavyTools`。

### 11. 工作区/本案强制规则 — KEEP

- **路径**：`src/lawmind/policy/workspace-policy.ts`（8KB 封顶）；来源 `lawmind.policy.json` 的 `agentMandatoryRules` / `agentMandatoryRulesPath`；本案 `cases/<id>/RULES.md` 或 `matters/<id>/RULES.md`
- **作用**：律师写的红线，注入为「工作区强制规则 / 本案强制规则」。
- **手改**：改 policy 或 RULES.md，下一轮立刻生效。写太长会被截断并提示。
- **本次**：未改机制。仓库里目前没有实际 policy 规则文件。

---

## 三、短路径锁（只禁误发与重建）

### 12. 邮件合同短路径 — KEEP

- **路径**：
  - 识别与指令：`src/lawmind/platform/mail-contract-short-path-instruction.ts`
  - 提示词：`src/lawmind/agent/mail-contract-fast-path.ts`
  - 工具锁：`src/lawmind/platform/playbook-tool-lock.ts`
  - 自动化复用：`src/lawmind/platform/lawyer-automations.ts`
- **作用**：路径已钉选时不要翻案卷找附件；**不冻结工具表**。硬禁 `send_email` 与 `render_document` 重建附件。核法条可用检索；可在对话里说明改了什么。
- **手改**：改识别正则会让普通聊天误进或漏进短路径。改 deny-list 会立刻允许/禁止某工具。
- **本次**：由允许名单改为拒绝名单。不再拒绝 `search_workspace` / `search_statute`。

### 13. 原 Word 改稿锁 — KEEP

- **路径**：`src/lawmind/platform/word-revision-instruction.ts`；检查单 `src/lawmind/platform/word-revision-checklist.ts`；类型包 `src/lawmind/platform/word-revision-packs.ts`；律师可读清单 `workspace/playbooks/word-revision/*.md`
- **作用**：把带审阅痕迹的 Word 写到源文件同目录；可在对话里说明改了什么。硬禁 `render_document` 重建原件与外发。不冻结检索。
- **手改**：改检测正则会影响「改这份」是否走锁。改 `word-revision/*.md` 会改变该类型的看/改/停要点（注入「改稿要点」）。
- **本次**：工具表由允许名单改为拒绝名单。单说「立场 / 导出」仍不进 Word 改稿锁。律师点名只要意见书时也不进锁。

### 14. 合同审查快车道 — FIX（最大冲突）

- **路径**：`src/lawmind/platform/contract-fast-lane-instruction.ts`
- **作用**：5 分钟交办 = 先出意见的**提示**。工具表不收窄。
- **手改**：把识别写宽，普通办件审查会吃到「先出意见」的教练（不再会突然不能检索）。
- **本次**：不再冻结工具表。只认「5 分钟合同审查」或带立场/重点的结构化【交办】意见。不把 `【办件】能力：contract.review` 当快车道。

### 15. 最短锚定跨度硬门禁 — KEEP

- **路径（唯一数字源）**：`src/lawmind/drafts/surgical-span-gate.ts`
- **执行**：`src/lawmind/drafts/apply-surgical-edits.ts`、`src/lawmind/drafts/surgical-edit-gate.ts`
- **提示词**：`src/lawmind/drafts/contract-redline-craft.ts`
- **作用**：整句/整段 `find` 会被拒或跳过。条数不限。
- **手改**：改 `SURGICAL_MAX_FIND_CHARS` / `SURGICAL_MAX_FIND_WITH_TERMINATOR` 会立刻改变所有改稿能否落上。不要在邮件指令或 Skill 里另抄数字。
- **本次**：邮件指令与 Craft Skill 读这里的常量，不再手抄 12。`apply_surgical_edits` 每轮 tools JSON 只保留操作指针（硬门禁由引擎执行；数字不进广告描述）。

### 15a. 短路径旧改稿路警告碎片 — TIGHTEN

- **路径**：`src/lawmind/drafts/legacy-update-draft-warning.ts`；`update_draft` 调用点；世界状态 `craft`（`prependWorldStateCraft`）
- **作用**：钉死的邮件/Word 短路径上，用 `update_draft.sections` 改正文会失败（不落盘）。失败的 tool result + craft 段短警告把模型赶回 `apply_surgical_edits`。seed 基线（`contract_edit_baseline_path` + `seed_sections_from_baseline`）仍可用。意见稿/审核台不走这条拦截。
- **手改**：改警告文案会影响模型是否回头。不要把它写成 system 长禁令；禁令会被忽略，刚失败的 tool result 才会听。
- **本次**：新增。不拉长邮件/Word 短路径 system 段。

### 16. 空修订不得导出 — TIGHTEN

- **路径**：`src/lawmind/drafts/tracked-render-hunk-gate.ts`；`src/lawmind/runtime/same-turn-verify.ts`
- **作用**：`redlinePending=0` 不能 `render_tracked_draft`。`apply_surgical_edits` 空 hunk / 缺 `craft_check` 是 **tool error**，不是给律师看的导出红字。模型说「已完成」时若验证器仍红，同一回合会把缺口打回，直到绿或 bounce 上限暂停。步骤预算不再因此询问律师是否继续。
- **手改**：放宽门禁会出现「空修订假完成」。
- **本次**：验收失败回到同一回合（Codex：测试失败是下一轮输入）。cassette：空 hunk 后再说已完成，必须再调 `apply_surgical_edits`。

### 16a. 独立审稿员（法律 Guardian）— NEW

- **路径**：`src/lawmind/guardian/`；交卷钩子 `render_tracked_draft`（空修订硬门禁之后、写 Word 之前）与意见类 `render_document`（验收门禁之后、盖戳/写 Word 之前）
- **作用**：写者照常改稿。交卷前另开短调用，只喂代码组装的证据包（hunk、锚句、引用、检查单、硬门禁事实、律师已确认答案、写者 deferred 声明）。审稿员 `pass|fail`+缺口。fail 作为工具结果打回主循环；审稿全文只进 `drafts/<taskId>.guardian.json`，不进会话历史。
- **不是**：再给写者加「你必须引用法条」的 prompt；也不是 `craft_check` 自评覆盖率。空修订/跨度/引用 ID∈bundle 仍是硬门禁（法律版 REPL：跑过才算过）。
- **手改**：`LAWMIND_LEGAL_GUARDIAN=0` 关闭。无模型时 skip（不挡导出，审核台显示「未跑」）。审稿输出上限/超时/温度走 `resolveClassifySidecarLimits`（模型窗口 5% 包络，不是固定 800/2048）。HTTP 失败与空/截断/无法解析输出共用 `modelAttemptBudget`（DeepSeek harness normal：TRANSPORT 与 EMPTY_RESPONSE 同一重试预算，指数退避）。仍读不出则 **skip**（不挡导出，审核台显示「未完成」），不消耗覆盖轮次，也不把写者打去落改；下一次导出同 hash 会再采样，不把 infra skip 当成成功缓存。覆盖 fail 仍 fail-closed。默认 ≤2 轮覆盖 fail 后要求交给律师。证据包 hash 相同且上次为 pass/fail 则跳过审稿 LLM（`unchanged_evidence`），稿变了才再调。
- **律师看见的**：审核台交卷核对「独立审稿」，不是写者 coverage 分数。

### 16b. 同一回合验收（lint / 引用 / craft_check / 空修订） — TIGHTEN

- **路径**：`src/lawmind/runtime/same-turn-verify.ts`；`legal-verify-middleware.ts`；`turn-orchestrator-model-loop.ts`
- **作用**：「任务完成」= 验证器绿，不是模型说完了。写稿路径上机械 lint blocker（不含定金上限等主观残差）与空修订、缺引用、缺 `craft_check` 一样是 **tool error**。`contractEdit` 基线不跑机械 lint（避免原文旧疵冒充本回合失败）。`prepare_outbound_mail` 在已关联草稿时预检引用/空修订/craft_check/机械 lint。模型说「已完成」时的打回写入 `hiddenFromLawyer` 用户消息，律师气泡看不到；硬工具顶若验收仍红则 **paused**，不标 completed。
- **手改**：把 `ok` 改回 true 只拦律师，模型会再次假完成。把 bounce 改回可见 user，律师会看到自己没发的验收全文。
- **本次**：lint 机械项进入同一回合；bounce 不对律师冒充；硬顶红验收改为暂停。独立审稿（Guardian）仍在 `render_tracked_draft`。
- **2026-09-15 token**：bounce 只服务下一轮采样。验证器绿则从 `conversationHistory` 删除全文；暂停则收成 `【验收缺口】` 一行码。下一会话不再重付 1–3 份验收全文。失败 tool JSON 只在 `error` 保留一份 `【同一回合验收未过】` 全文（`issues[].message` 仍在，供 bounce 重建）；`verify.message` 与 `gateDecision.reason` 不再第三、第四份拷贝。引用类 `ok:true` 的 `data.verify.message` 不变。
- **2026-09-15 history cap**：工具结果入史默认 ~1000 **token**（CJK 1 字 ≈ 1 token）。原先 4k **字符** 上限把 3k 汉字当成「还没到 1k token」。`maxChars` 覆盖仍给测试/溢出调用。截断仍保留 `ok`/`error`/`redlinePending`/`gateDecision`。

### 17. 待拍板只拦外发 — KEEP

- **路径**：`src/lawmind/agent/dangerous-tool-policy.ts`；`src/lawmind/platform/lawyer-outbound-decision.js`（`toolRequiresLawyerPause`）
- **作用**：本地写合同/审合同/导出不暂停。`send_email` 要拍板。
- **手改**：把写文件也加成暂停，Solo 主路径会变难（违反铁律 1）。
- **本次**：未改。`MEMORY.md` 已按此口径重写。

---

## 四、能力绑定

### 18. 办件能力 + pipelineHint — TIGHTEN

- **路径**：`src/lawmind/skills/lawyer-capabilities.ts`；锁解析 `src/lawmind/skills/lawyer-capability-lock.ts`；关键词 `src/lawmind/skills/capability-patterns.ts`
- **作用**：把律师选的办件变成 Skill 列表 + 流水线 + 一句话 hint。
- **手改**：改 `skillIds` 会换注入哪些技能。改 `pipelineHint` 会换模型以为的完成定义。改正则会改「没点办件时猜错能力」。
- **本次**：审查 hint 改为「工具可用 + 默认成套，指定则按指定」，不再写「完成=意见+红线」。快车道另有短 hint（`resolveCapabilityPipelineHint`）。通用能力 hint 不再写「必须走 / 优先 execute_workflow」。

### 19. Lean 技能预算 — KEEP

- **路径**：`src/lawmind/skills/skill-prompt-budget.ts`
- **作用**：每种能力只灌 1–2 份技能正文，其余只留索引行。
- **手改**：把某技能放进 `PRIMARY_BY_CAPABILITY` 会让它从「索引」变成「通读」，上下文变贵。
- **本次**：未改预算策略。改稿手艺正文改为读引擎生成块，避免与 md 双源。

---

## 五、内置技能（`src/lawmind/skills/builtin/*.md`）

这些文件是律师 Agent 的运行时说明书。`readSkillPromptBodies` 会读它们（或工作区已签名覆盖版）。**改 md 会改变下一轮模型行为**，除非该技能只在索引里。

### 20. 合同分层审查 — KEEP

- **路径**：`src/lawmind/skills/builtin/contract-review-layers.md`
- **作用**：意见路径的宏观/中观/微观 + 每点必须有推荐措辞。
- **手改**：改栏目或「没有改法不算完成」，会改意见书长什么样。

### 21. 合同审阅改稿手艺 — MERGE

- **路径（运行时正文）**：`src/lawmind/drafts/contract-redline-craft.ts`（`CONTRACT_REDLINE_CRAFT_SKILL`）
- **路径（索引壳）**：`src/lawmind/skills/builtin/contract-redline-craft.md`
- **作用**：最短锚定、覆盖/缓办、`craft_check.deferred`（不再把写者自评当覆盖率）。交卷覆盖由独立审稿员看证据。
- **手改**：改 `.ts` 字符串会影响邮件短路径和 Word 改稿以及审查 lean 正文。改 `.md` 现在几乎只影响技能目录描述。
- **本次**：md 改成指针。`readSkillPromptBodies` 对这个 id 固定用 `.ts`。

### 22. 交付用语 — KEEP

- **路径**：`src/lawmind/skills/builtin/delivery-language.md`
- **作用**：待审核稿话术。几乎所有能力都挂它。
- **手改**：改这里会改所有办件怎么称呼草稿。

### 23. 引用锚定 — KEEP

- **路径**：`src/lawmind/skills/builtin/citation-grounding.md`
- **作用**：开放检索则核；路径已钉选时不要翻案卷找附件，核法条仍可用检索。
- **手改**：不要再写成「邮件/Word 禁止检索」。检索被拒只应发生在误发/重建原件的 deny-list。

### 24. 开箱默认执业口径 — MERGE

- **路径**：`src/lawmind/skills/builtin/practice-defaults.md`
- **对照**：真正红线在 `src/lawmind/practice/practice-playbook.ts`
- **作用**：教模型如何推断立场/类型/阶段。
- **手改**：不要在这里再写「永不接受」清单，会和 playbook 漂。
- **本次**：Skill 改为「红线只看本回合执业口径」。

### 25. 交办 Intake Soft Ask — MERGE

- **路径（单一正文）**：`src/lawmind/skills/builtin/intake-required-inputs.md`
- **注入**：`src/lawmind/router/intake-craft.ts`（`INTAKE_CRAFT_SKILL` 读上面的 md）
- **作用**：材料齐不冻写；硬澄清只留给高风险空跑。
- **手改**：改 md 会同时改技能正文和 Soft Ask 块。不要再在 `.ts` 里另写一份。

### 26. 法律要素提取 — KEEP

- **路径**：`src/lawmind/skills/builtin/legal-element-extraction.md`
- **作用**：口语 → 要件事实。审查回合通常只在索引。
- **手改**：把「九类事实」写进审查主技能会占上下文（测试已禁止）。

### 27. 规范现行有效 — MERGE

- **路径**：`src/lawmind/skills/builtin/norm-validity.md`
- **作用**：废止《合同法》等不得当有效依据。**废止法名单只放这里。**
- **手改**：加/删废止法名，会影响检索和意见里哪些旧法被禁止。
- **本次**：检索协议改为「名单见本 Skill」，不再抄第二份。

### 28. 检索命题矩阵 — KEEP

- **路径**：`src/lawmind/skills/builtin/research-query-matrix.md`
- **作用**：正反命题、试检再扩、备忘五栏。
- **手改**：改五栏会改检索备忘的交件形状。

### 29. 法律快问 — KEEP

- **路径**：`src/lawmind/skills/builtin/quick-legal-triage.md`
- **作用**：一问一答，禁止改成表单。
- **手改**：写成「先选深度」会破坏上手简单。

### 30. 合同起草路由 — KEEP

- **路径**：`src/lawmind/skills/builtin/contract-drafting-route.md`
- **对照类型表**：`src/lawmind/contracts/closed-contract-type.ts`
- **作用**：先路由再骨架。
- **手改**：12 类标签应改 `closed-contract-type.ts`，不要只改 Skill 里的手抄名单。

### 31. 劳动补偿 / 期限计算 — KEEP

- **路径**：`src/lawmind/skills/builtin/labor-compensation-calc.md`、`legal-period-calc.md`
- **硬执行**：`src/lawmind/agent/tools/legal/calculate-lib.ts`（`calculate` 工具）
- **作用**：口算不算完成。
- **手改**：只改 Skill 不改 `calculate`，模型仍可能被引擎数字纠正。改引擎公式才会改金额。

### 32. 起诉状 / 证据链 / 谈话整理 — KEEP

- **路径**：`complaint-elements-fill.md`、`evidence-argument-chain.md`、`client-talk-intake.md`
- **作用**：固定栏目、缺项仍出稿、旧案事实隔离。
- **手改**：改栏目会改诉讼交件骨架。

### 33. 阶段/领域路由技能群 — KEEP

- **路径**：`litigation-stage-route.md`、`criminal-stage-route.md`、`family-matter-route.md`、`ip-dispute-route.md`、`bankruptcy-stage-route.md`、`governance-route.md`、`capital-markets-route.md`、`ads-compliance-route.md`、`data-compliance-route.md`、`ma-diligence-route.md`
- **作用**：多数是「不要套错模板」。lean 下通常只是索引。
- **手改**：把某个路由放进 `PRIMARY_BY_CAPABILITY` 才会变成通读正文。

### 34. 运营类技能 — KEEP

- **路径**：`invoice-organizer.md`、`court-sms-intake.md`、`chronology-from-materials.md`、`matter-from-materials.md`、`matter-budget-lite.md`、`matter-status-report.md`、`legal-event-extract.md`、`spreadsheet-analysis.md`
- **作用**：已有材料先做完，不要面试式追问。
- **手改**：加「先填冲突问卷」会挡干活。

### 35. 工作区 cn-contract-checklist — TIGHTEN

- **路径**：`workspace/lawmind/skills/cn-contract-checklist/SKILL.md`（有签名，改了会 `signatureOk=false` 从而不注入）
- **本次**：可执行条目迁到内置用户标准 `builtin-cn-contract-checklist`（`user-standards.ts`）。工作区 Skill 仍在，但是薄清单；不要当第二套审查标准。
- **手改**：改已签名 SKILL.md 却不重签，等于关掉它。

---

## 六、协议注入（和锁叠在一起才会出事）

开关现在看**本轮指令 + 真实工具表**。实现：`src/lawmind/agent/prompt-protocol-gate.ts`。

### 36. 检索协议 — FIX

- **路径**：`src/lawmind/research/research-protocol.ts`
- **作用**：写条号前先试检 `search_statute` / `search_case_law`。邮件/Word 同样注入（核法条）；5 分钟快车道或工具表没有检索工具时不注入。
- **手改**：若在快车道或没有检索工具时仍注入，模型会被要求做一件做不到的事。
- **本次**：快车道或工具表没有检索工具 → 不注入。引擎自动试检算已试检，不再只认模型是否点名 `search_statute`。

### 37. 改稿计划 — FIX

- **路径**：`src/lawmind/drafts/redline-plan.ts`；落盘 `drafts/<taskId>.redline-plan.json`
- **作用**：未锁审查时先列最短 find/replace，再 `apply_surgical_edits`。
- **手改**：直接改 sidecar JSON 会影响导出重试。改注入条件会影响模型是否去调 surgical。
- **本次**：快车道或没有 `apply_surgical_edits` → 不注入。

### 38. 成套交件 — FIX

- **路径**：`src/lawmind/drafts/paired-review-deliverable.ts`；交件形态 `src/lawmind/intent/delivery-intent.ts`
- **作用**：未锁审查 + 钉选 Word = **默认**意见且修订稿。不是完成硬条件；律师指定只要一种则按指定。
- **手改**：在快车道仍注入会与「只出意见书」互斥。
- **本次**：快车道不注入。律师自然语言指定「只要意见书 / 不改原稿 / 新文档」时也不注入成套默认。工具表不因此收窄。钉选 Word 且未指定交件形态的普通办件审查仍注入成套**教练**（不是「文字意见不算完成」）。
- **点名落点**：桌面 / 下载 / 文稿 是交件目录，不是本机文件夹写权。只允许这三个家目录。原件永不覆盖。

### 39. 纸侧与交易角色 — MERGE

- **路径**：`src/lawmind/practice/bilateral-review.ts`
- **作用**：己方纸/对方纸 × 买卖。
- **手改**：推断正则写错会审反立场。
- **本次**：不再内嵌永不接受清单，改为指向「执业口径」。

### 40. 交件对象分流 — TIGHTEN

- **路径**：`src/lawmind/drafts/audience-split.ts`
- **作用**：对内 / 客户 / 法院。
- **手改**：`AUDIENCE_SPLIT_IDS` 决定哪些办件会看到这段。
- **本次**：只挂函件、诉讼、材料、意见、起草、备忘、谈话。计算/发票不再注入。

### 41. 封闭 12 类合同 — KEEP

- **路径**：`src/lawmind/contracts/closed-contract-type.ts`
- **作用**：软路由，未知归服务。
- **手改**：改 `RULES` 正则会改类型推断，从而改用户标准绑定和宏观检查单。

### 42. 意见书 Craft / 正式交付流水线 — TIGHTEN

- **路径**：`src/lawmind/drafts/opinion-craft.ts`；`src/lawmind/agent/deliverable-pipeline.ts`
- **作用**：非 Word 原件时走意见书。自动工作流只覆盖 ESG/报告类。
- **手改**：扩大 `DELIVERABLE_TYPES_AUTO_WORKFLOW` 会让更多指令不经模型直接跑工作流。
- **本次**：系统提示词不再承诺「凡正式文稿都自动走工作流」。

---

## 七、律师可改标准

### 43. 执业口径 playbook — KEEP

- **路径（代码默认）**：`src/lawmind/practice/practice-playbook.ts`
- **路径（工作区覆盖）**：`workspace/lawmind/practice-playbook.json`（律师在设置里改；没有文件就用默认）
- **作用**：默认立场、争议解决、永不接受。只影响之后的新任务。
- **手改**：这是「永不接受」的**唯一运行时源**。改默认数组会影响所有还没写工作区文件的用户。改 JSON 只影响该工作区。
- **本次**：bilateral / 用户标准 builtin / practice-defaults 不再复制这份清单。

### 44. 用户标准库 — TIGHTEN

- **路径**：`src/lawmind/practice/user-standards.ts`
- **落盘**：`workspace/lawmind/standards/<id>.json`
- **作用**：按合同类型 / 客户 / 关键词套用核对项。
- **手改**：JSON 里 `enabled: false` 立刻停用。`bindWhen.keywords` 写太宽会误套（旧「是否」就是例子）。
- **本次**：builtin 不再抄永不接受；补诉讼收案；每日关键词改为「请尽快/请确认/请回复/烦请」。中国合同审查清单只在识别出非「服务」兜底类型，或指令写了「审查清单 / 中国合同 / 适用中国法」时套用；不再和通用口径叠进每一次审查。

---

## 八、工作区记忆（会被召回进模型）

### 45. MEMORY.md — FIX

- **路径**：`workspace/MEMORY.md`（用户工作区副本）；引擎读取 `src/lawmind/memory/index.ts`、召回 `src/lawmind/memory/relevant-recall.ts`
- **作用**：系统级长期记忆。召回命中时整段进 prompt。
- **手改**：写错一条（例如「改文件必须先确认」）会和待拍板政策打架，模型可能拒绝本地改稿。
- **本次**：仓库样例已按现行产品重写。加载工作区时会改写已安装盘面里的过期库存口径（改文件须确认 / 报成本 / 双模型 / 材料不得出工作区），律师自己写的积累条目会留。不要把旧口径加回去。

### 46. LAWYER_PROFILE.md — FIX

- **路径**：`workspace/LAWYER_PROFILE.md`；过滤 `src/lawmind/memory/lawyer-profile-for-prompt.ts`
- **作用**：律师偏好。空模板（没填姓名/称呼/机构/领域，第八节也只有库存说明）**不再注入**。填了这四个字段之一，或第八节有真实积累（日期条、`草稿审核学习`、填过的审核标签），才会进 prompt。
- **手改**：在「姓名 / 称呼 / 所在机构 / 主要业务领域」填真值，或在「八、个人积累」写习惯，下一轮才会按习惯写。第八节里库存的「学习队列说明 / 审核标签枚举」**不算**真实积累，也不会变成「已按你的习惯」。
- **本次**：实现空模板不注入；库存审核标签说明不再误触发。

---

## 九、开发侧规则（约束写代码的人，不是律师 Agent）

### 47. AGENTS.md / CLAUDE.md — MERGE

- **路径**：`AGENTS.md`（唯一正文）；`CLAUDE.md`（短指针文件，不是 symlink）
- **作用**：告诉 Cursor / Claude 本仓库是 LawMind only、测法、桌面 UI 不是浏览器。Cursor 会同时注入两份；短指针避免把 `AGENTS.md` 全文付两遍。
- **手改**：只改 `CLAUDE.md` 无效。改 `AGENTS.md` 会影响以后所有工程 agent。

### 48. 本地桌面 UI only — KEEP

- **路径**：`.cursor/rules/local-desktop-ui.mdc`
- **作用**：alwaysApply。禁止把 Vite / 文档站当成产品。
- **手改**：删掉这条，工程 agent 可能又去开浏览器当 LawMind。

### 49. 工程 review skill — KEEP

- **路径**：`.agents/skills/lawmind-engineering-review/SKILL.md`；通用兜底 `~/.cursor/skills/continuous-dev-review/SKILL.md`（本机，不在仓库）
- **作用**：本仓库工程评审走 backlog + 双门。
- **手改**：改项目 skill 会影响后续「连续 review」怎么验收。

### 50. 最小修改开发 skill — MERGE

- **路径**：`.agents/skills/minimal-surgical-edit/SKILL.md`（仓库）；本机还有一份 `~/.cursor/skills/minimal-surgical-edit/SKILL.md`
- **作用**：给改引擎的人看。数字必须以 `surgical-span-gate.ts` 为准。
- **手改**：只改 skill 里的字数表、不改 span-gate，律师产品行为不变，开发 agent 却会按错表改代码。
- **本次**：skill 写明以 span-gate 为准。

### 51. 后台核算（律师只看交件）— KEEP

- **路径**：`src/lawmind/agent/tools/legal/run-compute-tool.ts`；沙箱 `analysis-sandbox.ts`；交件包 `compute-deliverable.ts`；律师卡片 `tool-lawyer-card.ts`
- **作用**：任务需要归并表格、自定义汇总或出图时，模型在沙箱里写 JS、看报错、自修。成功后引擎把对照 xlsx 和 `analysis.table` 意见稿写入在办，律师对话只看到「核算数据」和交件，不看源码。法定金额/期限仍走 `calculate`。
- **手改**：不要把 `run_compute` 改成须律师确认脚本；不要从沙箱拿掉 Math/JSON/Date。高安全模式才隐藏该工具。不要让核算结果只停在聊天图里。

---

## 十、手改也会影响效果、但不在上面 50 条里的文件

这些不是「提示词条目」，但改了会改变执行结果。核对 50 条时请一并打开。

### 工作区里律师可改的文件

| 路径                                                              | 作用                                     | 手改后果                                                                                                                                              |
| ----------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace/FIRM_PROFILE.md`                                       | 律所级规则，随记忆加载                   | 现在多半是带「\_（例：）」的空模板。填真值后可能被检索/记忆用到。空模板不要写成像已生效的禁令。不会整段进 system prompt（和 `LAWYER_PROFILE` 不同）。 |
| `workspace/lawmind/lawyer-preferences.json`                       | 可执行偏好（最多 40 条）                 | 有文件就会进「已按你的习惯」。手改一条等于下一轮强制口径。没有文件则只看档案第八节的真实条目。                                                        |
| `workspace/playbooks/CLAUSE_PLAYBOOK.md`                          | 条款手册                                 | 召回命中会进 prompt，模型会按手册改条款。                                                                                                             |
| `workspace/playbooks/COURT_AND_OPPONENT_PROFILE.md`               | 法院/对手画像                            | 同上。写错会审错对手习惯。                                                                                                                            |
| `workspace/playbooks/word-revision/*.md`                          | 各合同类型的看/改/停                     | Word 改稿回合会注入对应类型。改「停」项等于禁止改那些点。                                                                                             |
| `workspace/lawmind/practice-playbook.json`                        | 执业口径覆盖                             | 见第 43 条。没有文件 = 用代码默认。                                                                                                                   |
| `workspace/lawmind/standards/*.json`                              | 律师标准                                 | 见第 44 条。                                                                                                                                          |
| `workspace/lawmind.policy.json`（若存在）                         | 联网、协作、强制规则、引用模式、工具上限 | 改 `allowWebSearch` / `agentMandatoryRules` / `citationMode` 会改工具和导出门禁。样例：`docs/examples/lawmind.policy.json.sample`                     |
| `workspace/cases/<id>/CASE.md`                                    | 本案事实                                 | 进「当前案件」。写错事实，模型会当已确认。                                                                                                            |
| `workspace/cases/<id>/RULES.md`                                   | 本案强制规则                             | 与第 11 条同等约束。                                                                                                                                  |
| `workspace/cases/<id>/MATTER_STRATEGY.md`                         | 本案策略                                 | 记忆层加载；可能被检索。                                                                                                                              |
| `workspace/assistants/<id>/PROFILE.md`                            | 该助手偏好                               | 进「本助手专属偏好」。                                                                                                                                |
| `workspace/CLIENT_PROFILE.md` 或 `clients/<id>/CLIENT_PROFILE.md` | 客户画像                                 | 只应写沟通习惯，不要写单案事实。                                                                                                                      |
| `workspace/memory/YYYY-MM-DD.md`                                  | 当日日志                                 | 进「今日工作记录」。                                                                                                                                  |
| `workspace/drafts/<taskId>.redline-plan.json`                     | 改稿计划 sidecar                         | 导出重试会读它。手改 find/replace 等于改落改。                                                                                                        |
| `workspace/templates/word/*.md`、`templates/ppt/*.md`             | 默认文书/PPT 骨架                        | `list_templates` / `render_document` 会按这里出稿。改栏目等于改默认交件骨架。                                                                         |
| `workspace/lawmind/templates/index.json` 与 `stored/`             | 律师上传的模板登记                       | 手改占位符映射会改套模板填值。                                                                                                                        |
| `workspace/lawmind/workflows/*.json`                              | 多智能体工作流模板                       | 改步骤/角色会改「完整审查专案组」怎么拆活。缺文件时引擎会按种子补一份。                                                                               |
| `workspace/lawmind/agents/*.md`                                   | 协作助手人设                             | 专案组里研究员/审查员/函件起草读这些。                                                                                                                |
| `workspace/lawmind/fleet-playbooks/*.json`                        | 批量审查战役剧本                         | 改并行门禁或步骤会影响战役，不影响单件快车道。                                                                                                        |
| `workspace/lawmind/packs/cn-legal-pack.json`                      | 中国法知识包登记                         | 影响检索/清单是否挂上该包。                                                                                                                           |
| `workspace/lawmind/integrations.json`                             | 外部系统连接                             | `enabled: true` 才会去扫网盘/iManage 等。Solo 默认应关。                                                                                              |
| `.env.lawmind`（用户数据目录或工作区，勿提交）                    | 模型与密钥                               | 换模型/密钥会改所有回合的推理质量，不是提示词问题。                                                                                                   |

### 引擎里改了就会变行为、但律师平时不打开的文件

| 路径                                                            | 作用                                | 手改后果                                                            |
| --------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| `src/lawmind/platform/playbook-tool-lock.ts`                    | 邮件/改原件的工具拒绝名单           | 改错会让误发或模板重建突然可用，或把检索又冻住。                    |
| `src/lawmind/platform/word-revision-checklist.ts`               | 把类型包编成「改稿要点」            | 改格式会影响 Word 改稿看/改/停。                                    |
| `src/lawmind/platform/word-revision-document-excerpt.ts`        | 钉选 Word 摘录                      | 影响模型能不能看到原文。                                            |
| `src/lawmind/router/deliverable-meta.ts`                        | 交付物类型、澄清问题、验收标准      | 改 `clarificationQuestionsFor` 会改 Soft Ask / 硬澄清问什么。       |
| `src/lawmind/router/keyword-route.ts`                           | 口头指令路由到交付物类型            | 改正则会改「没点办件时」走哪条能力。                                |
| `src/lawmind/policy/edition.ts`                                 | Solo/Firm 功能开关、验收/引用硬门禁 | 改 `strictDangerousToolApproval` 或 citation 模式会改导出能不能过。 |
| `src/lawmind/policy/workspace-policy.ts`                        | 读 `lawmind.policy.json`            | 改默认值等于改所有未写 policy 的工作区。                            |
| `src/lawmind/memory/executable-preferences.ts`                  | 合并 JSON 偏好与档案第八节          | 改抽取上限或合并顺序会改「已按你的习惯」。                          |
| `src/lawmind/memory/applied-preferences.ts`                     | 从第八节抽 bullet                   | 库存学习队列/审核标签说明已被过滤。再放宽会把模板说明当成习惯。     |
| `src/lawmind/memory/lawyer-profile-for-prompt.ts`               | 空档案不进 prompt                   | 放宽判定会让库存模板再次污染所有对话。                              |
| `src/lawmind/stance/inject.ts`                                  | 立场提示                            | 改了会影响审查立场句。                                              |
| `src/lawmind/evaluation/golden-recall.ts`                       | 黄金例注入                          | 改例会当「好交件」示范。                                            |
| `src/lawmind/learning/contract-revision-recall.ts`              | 历史改稿召回                        | 召回错例会被模型模仿。                                              |
| `src/lawmind/agent/collaboration/builtin-workflow-templates.ts` | 协作工作流种子                      | 改步骤会改多智能体怎么拆合同审查。                                  |
| `src/lawmind/agent/deliverable-pipeline.ts`                     | ESG/报告自动工作流                  | 扩大集合会绕过模型循环。                                            |
| `src/lawmind/drafts/opinion-craft.ts`                           | 意见书短路径 Craft                  | 只在「看起来像意见书」时注入。                                      |
| `src/lawmind/mail/mail-send-format.ts`                          | 外发落款                            | 改了会影响待发信格式。                                              |
| `src/lawmind/skills/ensure-builtin-skill-seeds.ts`              | 把 builtin md 种进工作区 skills     | 改种子逻辑会影响已有工作区是否被覆盖。                              |
| `src/lawmind/skills/skill-runtime.ts`                           | 技能签名与启用                      | 签名失败的工作区 Skill **不会**进 prompt。                          |
| `.cursor/rules/local-desktop-ui.mdc`                            | 见第 48 条                          |                                                                     |

### 不要手改、改了也几乎无效或有害

| 路径                                                      | 原因                                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                               | 已改成指针。改它不如改 `AGENTS.md`。                                                      |
| `src/lawmind/skills/builtin/contract-redline-craft.md`    | 运行时已改读 `.ts`。                                                                      |
| `workspace/lawmind/skills/cn-contract-checklist/SKILL.md` | 已签名；改了不重签等于禁用。清单已迁到用户标准。                                          |
| `docs/archive/**`                                         | 历史口径。以 `GOALS.md` 和本文为准。                                                      |
| `docs/LAWMIND-ARCHITECTURE.md` §2                         | 已改为「过滤后的档案」；空模板不进 system。运行时以 `lawyer-profile-for-prompt.ts` 为准。 |

---

## 十一、本次已落地的行为变化（核对清单）

1. 办件「合同审查」可以检索、可以走改稿计划；不再被误判成 5 分钟快车道。
2. 快车道 / 邮件 / Word 锁回合，不再注入检索协议、改稿计划、成套交件。
3. 跨轮硬拦起草只认函件/诉讼关键键；租金等缺口不再冻下一轮。
4. 空 `LAWYER_PROFILE` 模板不进 prompt。
5. `MEMORY.md` 与待拍板、云推理口径一致。
6. 永不接受只从 playbook 来一份。
7. 系统提示词不再要求五段汇报，也不再吹 `execute_workflow` 最强。
8. `CLAUDE.md` 不再维护第二份工程约定。
9. 快车道出意见后不再盖「尚未试检法规」。
10. 中国合同审查清单不再无 bind 打进所有审查。
11. `apply_surgical_edits` 跨度数字只在 `surgical-span-gate.ts` + Craft Skill；工具广告描述是指针，不嵌 12/48。
12. 已安装工作区里的过期 `MEMORY.md` 库存口径会在加载时改写；架构文档不再写「档案全文进 system」。
13. 核算/出图/整表走 `run_compute` 后台闭环；成功后对照表和意见进在办。律师只看交件，不审脚本。
14. 同轮软澄清（如租金缺口）不再冻写工具；硬键（收件人/诉请等）仍冻。
15. 能力 `pipelineHint` 改为「未锁时优先工作流」，不再写「必须走 execute_workflow」。
16. 钉死的邮件/Word 短路径上，`update_draft.sections` 改正文会失败并往 craft 世界状态塞短警告，改走 `apply_surgical_edits`。
17. 空修订 / 缺 craft_check / 缺引用 / 机械 lint 在导出或外发前是同一回合 tool error；模型说「已完成」不能跳过验证器。

若某一条手改后效果「没变」，先看：是不是锁路径根本没注入它；是不是只改了 md 索引壳；是不是旧会话还在用旧的静态 prompt 前缀（看 `LAWMIND_AGENT_BEHAVIOR_EPOCH`）。
