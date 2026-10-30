# LawMind 未完成项台账（2026-10-28）

> 用途：把散落在 `GOALS.md`、工程审查、REA 复评、未来问题总册和各专题计划里的未完成项收成一张台账。
> 口径：只登记**当前仍未完成**的项；已完成的历史切片不再搬入。
> 分档：A = 本仓当前路线可收口；B = 等外部输入；C = 平级仓/他司交付物；D = 长期 backlog，只登记不排期。
> 更新规则：A 档完成后必须同时有代码、测试、文档证据才改状态；B 档必须写明「谁提供什么」；不得用合成数据、假证书或仓库内 NDA 冒充外部验收。

最后更新：2026-10-28。

---

## A. 本轮排期（本仓代码可收口）

### A1. P3.7 剧本观测扩展与非条款适用范围

- 来源：[`docs/LAWMIND-ENGINEERING-REVIEW.md`](../LAWMIND-ENGINEERING-REVIEW.md) P3.6「仍未接」①②；[`docs/LAWMIND-OSS-WORKFLOW-REA.md`](../LAWMIND-OSS-WORKFLOW-REA.md) §4 第 8 行。
- 现状：`PlaybookCriterion.check` 只有 `clause_present`；意见书、诉状没有对应剧本体系；`draft-playbook-triage.ts` 硬编码只给 `contract.` 前缀跑分流。
- 本轮交付：检查类型 `section_present` / `phrase_present` / `phrase_absent` / `citation_present`；文本级 `observationsFromDocument()`；`contract.` / `memo.` / `litigation.` 三类适用范围；设置页检查项编辑；回读安全线（无引用不出 PASS，否定性检查不自动 PASS）。
- 验收：`pnpm exec vitest run src/lawmind/deliverables src/lawmind/delivery src/lawmind/agent/tools/legal/playbook-triage-tool.test.ts apps/lawmind-desktop/server/lawmind-server-route-playbooks.test.ts apps/lawmind-desktop/src/renderer/LawmindSettingsPlaybooks.test.tsx`；意见书/诉状能出 GREEN/YELLOW/RED；无剧本 `basis=default`。
- 状态：已完成（2026-10-28）；仍未接法律实体判断与内置条款清单。

### A2. MatterRun 真实交付步骤

- 来源：[`docs/LAWMIND-OSS-WORKFLOW-REA.md`](../LAWMIND-OSS-WORKFLOW-REA.md) §4 第 1 行、§3.8；[`docs/LAWMIND-ENGINEERING-REVIEW.md`](../LAWMIND-ENGINEERING-REVIEW.md) AI 原生工作流复评。
- 现状：`matter-run.ts` + `matter-run-store.ts` 已有步骤状态机、幂等键、租约、持久等待、事件唤醒、重启恢复；`lawyer-automations-runner.ts` 每次派单只落一条 `automation_run` 步骤，草稿/渲染/外发没有拆开。
- 本轮交付：`matter-delivery-run.ts` 生成 `delivery_wait_job` → `delivery_collect` → `delivery_render` → `delivery_outbound_prepare`；桌面 job 终态唤醒 run；外发步骤只写待发信，不调用 `send_email`；`LAWMIND_DELIVERY_RUN=0` 可回滚。
- 验收：等待/渲染/外发准备中模拟 `kill -9`，重启后不重复派单、不重复渲染、不产生第二封待发信；job 完成后 run 自动 resume；UI 显示逐步进度。
- 状态：已完成（2026-10-28）；已覆盖所有自动办件模板；自动发送仍未接。

### A3. 第十九期「本期消化 3 个外部能力」

- 来源：[`GOALS.md`](../../GOALS.md) 第十九期期次模板；[`docs/LAWMIND-CANONICAL-LEGAL-SKILLS.md`](../LAWMIND-CANONICAL-LEGAL-SKILLS.md) §8「待消化」。
- 现状：待消化表有 4 个候选，本期只做 3 个；`contract-copilot`（CC-BY-NC）只写方法借鉴，不复制文案/脚本。
- 本轮交付：劳动 N/N+1/2N 规则回放（MIT，规则数值待法律顾问验收）、GCL 角色档位与对内/对外稿（Apache-2.0）、LPM 接案/范围变更模板（Apache-2.0）。每个有 builtin 正文、`BUILTIN_SKILL_SEED_IDS` 注册、能力映射、契约测试、§8 记录。
- 验收：`pnpm lawmind:skills:golden -- --compare`；邮件短路径与指定 Word 改稿的工具表不被新 Skill 带偏。
- 状态：已完成（2026-10-28）；`contract-copilot`（CC-BY-NC）仍只做方法借鉴，未消化。

### A4. 引擎侧术语收敛

- 来源：[`docs/LAWMIND-ENGINEERING-REVIEW.md`](../LAWMIND-ENGINEERING-REVIEW.md) 「仍然挡在对外发布前面的」第 4 条。
- 现状：渲染层已统一「签批 / 签批发送 / 签批并继续」；引擎工具描述与结果仍出现「批准发送」。
- 本轮交付：`mail-tools.ts`、`tool-name-sets.ts`、`packet-outbound.ts` 统一为「签批发送」；内部 `approve_send` / 路由名不动；新增工具文案契约测试。
- 验收：`pnpm lawmind:ui-copy-lint`；定向测试断言律师可见工具描述与结果不含「批准发送」。
- 状态：已完成（2026-10-28）。实际改动：`mail-tools.ts` / `tool-name-sets.ts` / `packet-outbound.ts` / `lawyer-outbound-decision.ts` / `lawyer-automations-runner.ts` / `lawyer-automations.ts` / `outbound-approval-binding.ts` / `intake/admission.ts` / `compact-reinjection.ts` / `session-carryover.ts` / `memory/templates.ts` / `deliverable-pipeline.ts`；契约测试 `agent/tools/legal/mail-tools.test.ts` 与 `mail-tools-copy.test.ts`。通用工具审批（非外发）仍用「批准」。

### A5. 发布就绪收口

- 来源：[`docs/LAWMIND-ENGINEERING-REVIEW.md`](../LAWMIND-ENGINEERING-REVIEW.md) 阻塞项 1–3；[`scripts/lawmind/lawmind-release-readiness.ts`](../../scripts/lawmind/lawmind-release-readiness.ts)；[`src/lawmind/agent/tools/legal/pptx-officecli.test.ts`](../../src/lawmind/agent/tools/legal/pptx-officecli.test.ts)。
- 现状：`officecli` 视觉用例全量并发偶发失败；release-readiness 对真稿/公证保持诚实 SKIP/红，但缺一页可执行 runbook。
- 本轮交付：`pptx-officecli.test.ts` 单独重复跑 10 次后决定串行或环境重试；新增 [`docs/lawmind/RELEASE-EXTERNAL-INPUTS.md`](RELEASE-EXTERNAL-INPUTS.md)；扩写真稿夹具 README。
- 验收：`pnpm lawmind:verify` 除外部 SKIP 外全绿；`pnpm lawmind:release-readiness` 如实列出待外部输入。
- 状态：工程侧已完成（2026-10-28）。`pptx-officecli.test.ts` 单独重复跑 10 次全过；对视觉用例加了一次 retry（断言仍全部重跑），不掩盖真实失败。新增 [`docs/lawmind/RELEASE-EXTERNAL-INPUTS.md`](RELEASE-EXTERNAL-INPUTS.md)；扩写 [`fixtures/lawmind-true-manuscript/README.md`](../../fixtures/lawmind-true-manuscript/README.md)。`pnpm lawmind:true-manuscript` 诚实 SKIP；`pnpm lawmind:release-readiness` 已跑，如实报真稿 SKIP 与未公证。测试套件与各门禁分项通过（1176 文件 / 8614 测试）。

### A6. P3.6 设置页文档缺口

- 来源：[`docs/LAWMIND-ENGINEERING-REVIEW.md`](../LAWMIND-ENGINEERING-REVIEW.md) P3.6。
- 现状：本所剧本编者界面、`GET/POST/DELETE /api/playbooks*`、`POST /api/playbooks/triage` 已落地，但律师手册没有对应章节。
- 本轮交付：新增 [`docs/lawmind/LAWMIND-FIRM-PLAYBOOKS.md`](LAWMIND-FIRM-PLAYBOOKS.md)，写清不内置法律条款、否定性检查不自动判 GREEN、无剧本 `basis=default`；在 `docs/lawmind/manual/22-capabilities-reference.md` 与律师手册加指针。
- 验收：文档能照着走完「新建剧本 → 绑定交付物类型 → 起草落盘 → 决策头看结论 → 律师 override」。
- 状态：已完成（2026-10-28）。新增 [`docs/lawmind/LAWMIND-FIRM-PLAYBOOKS.md`](LAWMIND-FIRM-PLAYBOOKS.md)；`docs/lawmind/manual/22-capabilities-reference.md` 已加指针。

### A7. 工作区备份 / 迁移工具（2026-10-28 续做）

- 来源：[`docs/LAWMIND-FUTURE-ISSUES.md`](../LAWMIND-FUTURE-ISSUES.md) D3「工作区备份 / 迁移工具（含 progress-archive、day-split audit）」。
- 本轮交付：`src/lawmind/platform/workspace-backup.ts` + `pnpm lawmind:workspace:backup` / `restore`。默认排除密钥、检索索引、lint/decision/rounds 与构建产物；清单 `BACKUP-MANIFEST.json`；恢复默认拒绝非空目标，拒绝绝对路径/盘符/反斜杠路径，不删除已有文件；符号链接不跟进。
- 验收：`pnpm exec vitest run src/lawmind/platform/workspace-backup.test.ts`（8 条：排除项、清单、往返、非空目标、恶意路径、超大文件、符号链接）；`pnpm typecheck`。
- 状态：已完成（2026-10-28）。文档 [`docs/lawmind/LAWMIND-WORKSPACE-BACKUP.md`](LAWMIND-WORKSPACE-BACKUP.md)；手册 31.4 与 `scripts/lawmind/README.md` 已更新。

### A8. Doctor 存储体积巡检（2026-10-28 续做）

- 来源：[`docs/LAWMIND-FUTURE-ISSUES.md`](../LAWMIND-FUTURE-ISSUES.md) D3「Doctor：检测 CASE/audit/session 体积异常并建议轮转」。
- 本轮交付：`src/lawmind/platform/workspace-storage-health.ts`；`pnpm lawmind:doctor` 增加一行「存储：案件 N 个 · 审计 X · 会话 Y（Z 个文件）· 草稿 W」；超过会话 200 MB / 审计 500 MB / 草稿 1 GB / 案件 2000 个时给轮转建议，并提示先跑备份。符号链接不跟进。
- 验收：`pnpm exec vitest run src/lawmind/platform/workspace-storage-health.test.ts src/lawmind/platform/ops-doctor.test.ts`（10 条）；`pnpm typecheck`。
- 状态：已完成（2026-10-28）。手册 31.1 的巡检行已包含存储提示。

### A9. 私有化部署磁盘配额告警（2026-10-28 续做）

- 来源：[`docs/LAWMIND-FUTURE-ISSUES.md`](../LAWMIND-FUTURE-ISSUES.md) D3「私有化部署下的磁盘配额告警」；[`docs/lawmind/LAWMIND-WORKSPACE-BACKUP.md`](LAWMIND-WORKSPACE-BACKUP.md)。
- 本轮交付：`lawmind.policy.json` 新增 `storage.quotaGb` / `storage.warnRatio`；Doctor 统计工作区总量并多打一行「工作区合计 …（配额 …，已用 …%）」，到比例或超额给备份/归档建议，只告警不拦写入。`--json` 输出 `ops.storage.quota.usedRatio` 供计划任务接入。统计不跟符号链接，跳过 `.git` / `node_modules` / `dist` / `release` / `.cache` / `tmp`。
- 验收：`pnpm exec vitest run src/lawmind/platform/workspace-storage-health.test.ts src/lawmind/platform/ops-doctor.test.ts src/lawmind/policy/workspace-policy.test.ts`（37 条）；`pnpm typecheck`。
- 状态：已完成（2026-10-28）。文档 [`LAWMIND-WORKSPACE-BACKUP.md`](LAWMIND-WORKSPACE-BACKUP.md) §4、手册 30.1 与 31.1 已更新。

---

## B. 等外部输入（只做验收脚本与台账，不伪造）

### B1. 真稿对照与各期「对照实测」

- 来源：[`GOALS.md`](../../GOALS.md) P0-1、第十五期、第十六期、第十七期、第十八期。
- 缺口：`fixtures/lawmind-true-manuscript/` 只有 README，没有真实 `.docx` / `.doc` / `.pdf`。
- 谁提供：律师自行脱敏后放入；工程侧不伪造。
- 验收：`LAWMIND_REQUIRE_TRUE_MANUSCRIPT=1 pnpm lawmind:true-manuscript` 全过；报告写 `lawmind/metrics/true-manuscript-report.json`；nightly 在无夹具时诚实 SKIP。
- 状态：等外部输入。

### B2. P2-A 发行纪律（签名与公证）

- 来源：[`GOALS.md`](../../GOALS.md) P2-A；[`.github/workflows/lawmind-desktop-build.yml`](../../.github/workflows/lawmind-desktop-build.yml)。
- 缺口：缺 Apple Developer ID 证书与 `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`；Windows 缺 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`。
- 谁提供：证书与 GitHub secrets 由发布负责人提供。
- 验收：tag 工作流产出公证包，`LAWMIND_REQUIRE_NOTARIZED=1` 通过；release-readiness 公证项变绿。
- 状态：等外部输入。

### B3. 14.11 人/数据/凭证债

- 来源：[`GOALS.md`](../../GOALS.md) 第十四期 14.11。
- 缺口：法律顾问抽审、真实 ≥10 已结案、LLM 评审人类校准 ≥80%、法宝/Lexis 联调、M4 生产流量指标、DOCX 修订回读。
- 谁提供：法律顾问、律所真实案件、法宝/威科账号、生产试点。
- 验收：每项有外部证据与签字；仓库内不以代码测试替代。
- 状态：等外部输入。

### B4. 真实模型 80% 基准

- 来源：[`docs/LAWMIND-ENGINEERING-REVIEW.md`](../LAWMIND-ENGINEERING-REVIEW.md) 阻塞项 2。
- 缺口：`pnpm lawmind:verify:release` 必须跑 `--mode real`；scripted 的文本重叠率不能当质量证据。
- 谁提供：有授权的真实材料与模型预算。
- 验收：`pnpm lawmind:benchmark -- --mode real` 报告达标；否则报告如实 SKIP。
- 状态：等外部输入。

### B5. 试点测量协议

- 来源：[`docs/lawmind/LAWMIND-PILOT-MEASUREMENT-PROTOCOL.md`](LAWMIND-PILOT-MEASUREMENT-PROTOCOL.md)。
- 缺口：需要 ≥8 周观察窗、其中 ≥4 周达到每周 ≥5 次交付的样本门槛。
- 谁提供：真实律师使用。
- 验收：`pnpm lawmind:north-star-trend -- --workspace <dir>` 给出方向；样本不足时结论是「证据不足」。
- 状态：等时间与真实使用。

### B6. 质量整改 §12 的 40 题评测

- 来源：[`docs/LAWMIND-QUALITY-REMEDIATION.md`](../LAWMIND-QUALITY-REMEDIATION.md) §12。
- 缺口：40 道校准题、双模型打分、律师标注一致度 ≥0.6。
- 谁提供：脱敏真实件与律师标注。
- 验收：`scores_dual.json` + 一页纸结论；低于 0.6 先改检查项写法。
- 状态：等外部材料与人工。

### B7. 客户交付清单

- 来源：[`docs/LAWMIND-DELIVERY.md`](../LAWMIND-DELIVERY.md) §8。
- 缺口：客户机器 smoke、demo、`.env.lawmind`、审批机制与审计日志位置确认。
- 谁提供：客户环境与交付负责人。
- 验收：6 项全勾并有客户确认。
- 状态：等客户环境。

### B8. 中栏真机验收

- 来源：[`docs/lawmind/LAWMIND-MIDDLE-COLUMN-PLAN.md`](LAWMIND-MIDDLE-COLUMN-PLAN.md)。
- 缺口：双合同 tab 状态、图片/docx/未知二进制 fallback、盖章页修订轨、扫描件 OCR 提示、判决书真机打开、真实脱敏材料打开。
- 谁提供：一次真机验收窗口与真实脱敏材料。
- 验收：逐条按文档操作并记录；拼写检查明确不做。
- 状态：等人工真机窗口。

---

## C. 平级仓 / 他司交付物（不在本仓排期）

### C1. LawMind-Bench

- 来源：[`GOALS.md`](../../GOALS.md) 第十九期 Bench。
- 未完成：律师金标 v0（每分册 ≥3 道私有题）、跑分 CLI + 发版 advisory、题量达标后从 advisory 升为挡发版。
- 归属：独立仓库 `../LawMind-Bench/`，不在本仓实现。
- 状态：平级仓。

### C2. TenderOS 投标自动化

- 来源：[`docs/LAWMIND-LEGAL-TENDER-AUTOMATION.md`](../LAWMIND-LEGAL-TENDER-AUTOMATION.md)。
- 未完成：67 个勾选项，含供应商评估、投标文件清单、TenderOS 对象模型与交付层。
- 归属：平级 TenderOS 工程；本仓只保留 `MatterRun` / `DeliveryPacket` 复用接口的规格。
- 状态：他司/平级项目。

### C3. WPS 套件移植规格

- 来源：[`docs/WPS-SUITE-PORTING.md`](../WPS-SUITE-PORTING.md)。
- 未完成：18 个移植核对项（officecli vendoring、摄取矩阵、xlsx/pptx 预览、最短改动、证据锚、交付、加载项可选等）。
- 归属：面向他司 deepseekharness 项目的独立规格；不是本仓路线。
- 状态：他司交付物。

---

## D. 长期 backlog（逐条登记，不排期）

### D1. 持久化与扩展性（`docs/LAWMIND-FUTURE-ISSUES.md`）

- [ ] 真正的 matter 级 audit 索引（taskId/matterId → 日期文件偏移）。
- [ ] 会话磁盘 compact：`sessions/*.json` 与 `.turns.jsonl` / transcript 归档或 gzip。
- [ ] queue / approvals / adoption JSONL 大时改 append-only + 软删，或 SQLite。
- [ ] `model-usage/ledger.jsonl` 按月滚动。
- [ ] FTS 重建增量索引。
- [ ] 详情 API 按章节懒加载 CASE。

### D2. Agent / 上下文 / 组织

- [ ] 事件日志升格为会话权威（完整替换可变 `session.json` + 流式 delta 回放）。
- [ ] 智能体层级强制策略写进 `validateDelegation` / `lawmind.policy.json`。
- [ ] 互审多轮与版本时间线（`request_review` 现为单轮）。
- [ ] 权威外库 API 与本机启发式拒答的长期校准。
- [ ] 超大工作区（数千案件）下的侧栏虚拟化与搜索索引。
- [ ] 对话写穿工作台档案的验收（代码已落地，缺真实传票/谈话实测；见 GOALS 第十八期）。

### D3. 运维 / 发布 / 数据

- [ ] 文档站自动发布到托管（Pages / Cloudflare）。
- [x] 工作区备份 / 迁移工具（含 progress-archive、day-split audit）。2026-10-28：`pnpm lawmind:workspace:backup` / `restore`，清单与安全恢复见 [`LAWMIND-WORKSPACE-BACKUP.md`](LAWMIND-WORKSPACE-BACKUP.md)。
- [ ] 审计完整性链在「按天窗口读取」下的校验策略说明。
- [x] Doctor：检测 CASE/audit/session 体积异常并建议轮转。2026-10-28：`pnpm lawmind:doctor` 增存储行与阈值建议。
- [ ] 私有化部署下的磁盘配额告警。

### D4. 工程债 / 重构

- [ ] 脏树按主题拆 PR（N-A0）：组织/合并面，不是代码缺陷。
- [ ] `engine-pipeline-tools.ts` 按工具族拆文件。
- [ ] 桌面 server 路由与引擎查询层对 lite vs full index API 命名统一。
- [ ] CI：为 prompt-windows / overview-lite 增加回归门禁。
- [ ] `persistDraftPipeline` 改 async 管道。
- [ ] 其它 Markdown 真相文件（日日志、LAWYER_PROFILE）纳入同类写锁或统一 write-gateway。
- [ ] 双真相写路径收敛（叙事章节与 tasks↔drafts 其余写路径）。
- [ ] TurnProfile 三处收敛（新增交付形态只改 profile）。
- [ ] 模型调用层重试/溢出/空 choice 分支从循环内联外移。
- [ ] `prose_syndrome` 不可达（保留策略位）。
- [ ] 回放 CLI 参数解析单测。

### D5. 专题评审里的未排期建议

- [ ] 更细粒度模板体系（含模板版本与历史产物一致性）。
- [ ] 量子控制面指标：误报密度、hedging 率、同源重复率（witness 弱读数进证据滤波已完成：被动 `witnessAnswers` + 主动抽查 `LAWMIND_FACTOR_WITNESS=1`，默认关闭）。
- [ ] MeWork 补证：PDF/Excel 专用核对器、精确页/单元格定位、思维导图节点编辑。
- [ ] Grok F6：失败/长时间阻塞/需人工接管/daemon 掉线四类通知。
- [ ] 决策层：`item_outcome` 合并进 `decision-samples.jsonl`。
- [ ] 平台代理 4 个未决问题（服务端 SDK、WebSocket vs SSE、工具调用计费、多模态计费）。
- [ ] Multitask 4 项执行清单（首批 3 个 Task Contract、指标基线、真实并行试运行、复盘回写）。
- [ ] 记忆长期使用 3 个缺口：跨案证据豁免、冲突只比精确名字、同一条款并排进入。
- [ ] 中栏 OCR 提示文案与拼写检查（拼写检查明确不做）。

---

## E. 明确不做 / 已降级

- Word / WPS 加载项：只保留维护态，不新增验收，不做任务窗格/侧载清单。
- 飞书日历写入、Outlook 全量客户端、国家案由规定全文分类器：不做。
- 中栏拼写检查：中文场景价值低，默认关且不做。
- 收件规则 v0 通用 DSL：暂缓，需先有明确律所规则需求与事件回放。
- 4×LPR 上限：LPR 序列未入库，有值才算，不硬编码。
- 外部判定器（Jev / decision-model）：未接进判定路径，等分歧数据。
- 自动外发：`outbound` 保持一键签发，不升级为自动发送。
- 把日志、哈希链、回放、审批包装成「可审计」或法律正确性证明：不做产品价值。

---

## F. 变更记录

- 2026-10-28：首版台账。盘点全仓约 150 个未勾项，A 档 6 组进入本轮排期；B/C/D 只登记不排期。
- 2026-10-28：A1–A6 工程侧完成。剧本观测/非条款适用范围、MatterRun 交付步骤、三个外部能力消化、外发术语收敛、发布外部输入 runbook、P3.6 手册均已落地；B 档真稿/公证/14.11/真实基准仍等外部输入，未伪造。
- 2026-10-28：续做 A7 工作区备份/迁移工具（zip + 清单 + 安全恢复），并把 delivery run 扩到所有自动办件模板。
- 2026-10-28：续做 A8 Doctor 存储体积巡检（案件/审计/会话/草稿 + 阈值轮转建议）。

## G. 基线（2026-10-28 10:57）

- 工作树：235 个未提交条目（含本台账与 `GOALS.md` 指针），按工作流集中在 `apps/lawmind-desktop/src` 47、`src/lawmind/agent` 39、`src/lawmind/delivery` 21、`apps/lawmind-desktop/server` 20。
- `pnpm typecheck`：通过。
- `pnpm --filter lawmind-desktop typecheck`：通过。
- `pnpm typecheck:desktop-node`：通过。
- 剧本定向测试：36 文件 / 311 测试通过（`src/lawmind/deliverables`、`src/lawmind/delivery`、`playbook-triage-tool`、`lawmind-server-route-playbooks`、`LawmindSettingsPlaybooks`）。
- MatterRun 定向测试：4 文件 / 43 测试通过（`matter-run`、`matter-run-store`、`lawyer-automations-runner`、`lawmind-server-route-matter-runs`）。
- 基线无已知红；全量 `pnpm lawmind:verify` 留到收口阶段跑。

## H. 最终验证（2026-10-28 收口）

- 验证方式：测试套件与各门禁分项复跑；单命令收口时并发会话正在改 `MatterAdmissionCard` / `prose-repair`，分项均通过。
- 测试：1176 文件 / 8614 测试通过（4 skipped，2 文件 skipped）；这是 A1–A7 收口时的全量结果。A8 追加 4 条存储体检测试，A7/A8 定向合计 24 条通过；因并发会话仍在改其它文件，未在本轮末尾重跑全量。
- 覆盖率：statements 70.44%（地板 69.46%）/ branches 60.83%（59.95%）/ functions 71.54%（70.14%）/ lines 70.51%（69.53%）。
- `pnpm lawmind:true-manuscript`：诚实 SKIP（无真实二进制）。
- `pnpm lawmind:release-readiness`：已生成，Known Risks 如实列真稿缺失、未公证、真实基准未达标。
- `pnpm lawmind:desktop:e2e:pr`：55 通过 / 2 skipped（59.0s）。
- 说明：e2e 为 mock/browser 套件，不替代真机 Word/WPS 与真实材料验收；真机项仍在 B 档。

## I. 分组提交清单（未提交，等确认）

> 纪律：只按组显式 `git add`，不跑 `git add -A` / `git add .`；共享工作区还有其他会话的改动，提交前逐组核对 `git diff --cached`。运行时产物（`workspace/`、`dist/`、`docs/generated/`）不入库。

### I1. 剧本（P3.7 + P3.6 手册）

- `src/lawmind/deliverables/playbook-triage.ts`
- `src/lawmind/deliverables/playbook-triage.test.ts`
- `src/lawmind/deliverables/playbook-store.ts`
- `src/lawmind/deliverables/playbook-store.test.ts`
- `src/lawmind/delivery/draft-playbook-triage.ts`
- `src/lawmind/delivery/draft-playbook-triage.test.ts`
- `src/lawmind/agent/tools/legal/playbook-triage-tool.ts`
- `src/lawmind/agent/tools/legal/playbook-triage-tool.test.ts`
- `apps/lawmind-desktop/server/lawmind-server-route-playbooks.ts`
- `apps/lawmind-desktop/server/lawmind-server-route-playbooks.test.ts`
- `apps/lawmind-desktop/src/renderer/LawmindSettingsPlaybooks.tsx`
- `apps/lawmind-desktop/src/renderer/LawmindSettingsPlaybooks.test.tsx`
- `docs/lawmind/LAWMIND-FIRM-PLAYBOOKS.md`
- `docs/lawmind/manual/22-capabilities-reference.md`

### I2. MatterRun 交付步骤

- `src/lawmind/platform/matter-delivery-run.ts`
- `src/lawmind/platform/matter-delivery-run.test.ts`
- `src/lawmind/platform/matter-run.ts`
- `src/lawmind/platform/matter-run-store.ts`
- `src/lawmind/platform/matter-run-wait.ts`
- `src/lawmind/platform/matter-run.test.ts`
- `src/lawmind/platform/matter-run-store.test.ts`
- `src/lawmind/platform/agent-fleet.ts`
- `src/lawmind/platform/build-agent-fleet.ts`
- `src/lawmind/platform/build-agent-fleet.test.ts`
- `apps/lawmind-desktop/server/lawmind-server-matter-delivery.ts`
- `apps/lawmind-desktop/server/lawmind-server-matter-delivery.test.ts`
- `apps/lawmind-desktop/server/lawmind-server-route-matter-runs.ts`
- `apps/lawmind-desktop/server/lawmind-server-route-matter-runs.test.ts`
- `apps/lawmind-desktop/server/lawmind-local-server.ts`
- `apps/lawmind-desktop/server/lawmind-server-jobs.ts`
- `apps/lawmind-desktop/src/renderer/LawmindMatterRunWaitDetail.tsx`
- `apps/lawmind-desktop/src/renderer/LawmindMatterRunWaitDetail.test.tsx`
- `apps/lawmind-desktop/src/renderer/styles/agents-workbench.css`
- `apps/lawmind-desktop/src/renderer/styles.css`

### I3. 本期消化的三个 Skill

- `src/lawmind/skills/builtin/labor-termination-triage.md`
- `src/lawmind/skills/builtin/role-audience-tiers.md`
- `src/lawmind/skills/builtin/matter-intake-scope.md`
- `src/lawmind/skills/ensure-builtin-skill-seeds.ts`
- `src/lawmind/skills/lawyer-capabilities.ts`
- `src/lawmind/evaluation/skill-deliverable-contract.test.ts`
- `docs/LAWMIND-CANONICAL-LEGAL-SKILLS.md`

### I4. 外发术语与发布门槛

- `src/lawmind/agent/tools/legal/mail-tools.ts`
- `src/lawmind/agent/tools/legal/mail-tools.test.ts`
- `src/lawmind/agent/tools/legal/mail-tools-copy.test.ts`
- `src/lawmind/agent/tool-name-sets.ts`
- `src/lawmind/delivery/packet-outbound.ts`
- `src/lawmind/platform/lawyer-outbound-decision.ts`
- `src/lawmind/platform/lawyer-automations-runner.ts`
- `src/lawmind/platform/lawyer-automations.ts`
- `src/lawmind/platform/outbound-approval-binding.ts`
- `src/lawmind/intake/admission.ts`
- `src/lawmind/agent/compact-reinjection.ts`
- `src/lawmind/agent/session-carryover.ts`
- `src/lawmind/memory/templates.ts`
- `src/lawmind/agent/deliverable-pipeline.ts`
- `src/lawmind/agent/tools/legal/pptx-officecli.test.ts`
- `scripts/lawmind/ui-copy-lint-synonym-baseline.json`

### I5. 文档与台账

- `GOALS.md`
- `docs/LAWMIND-ENGINEERING-REVIEW.md`
- `docs/LAWMIND-OSS-WORKFLOW-REA.md`
- `docs/lawmind/LAWMIND-REMAINING-WORK.md`
- `docs/lawmind/RELEASE-EXTERNAL-INPUTS.md`
- `fixtures/lawmind-true-manuscript/README.md`

### I6. 工作区备份 / 迁移

- `src/lawmind/platform/workspace-backup.ts`
- `src/lawmind/platform/workspace-backup.test.ts`
- `scripts/lawmind/lawmind-workspace-backup.ts`
- `scripts/lawmind/lawmind-workspace-restore.ts`
- `scripts/lawmind/README.md`
- `docs/lawmind/LAWMIND-WORKSPACE-BACKUP.md`
- `docs/lawmind/manual/31-ops-runbook.md`
- `package.json`

### I7. Doctor 存储巡检

- `src/lawmind/platform/workspace-storage-health.ts`
- `src/lawmind/platform/workspace-storage-health.test.ts`
- `src/lawmind/platform/ops-doctor.ts`
- `docs/lawmind/manual/31-ops-runbook.md`
