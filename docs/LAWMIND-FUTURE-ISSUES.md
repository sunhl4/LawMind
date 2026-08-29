# LawMind「未来问题」总册

> **用途**：集中登记**已识别、暂未做完或需长期回看**的工程/产品风险，避免散落在聊天与多个 backlog 里丢失。  
> **怎么用**：新发现的「以后会痛」的问题写进对应章节；落地后勾选并链到 PR/审查文。  
> **不是**：当前 sprint 清单（那是具体 PR）；也不是愿景文档（见 VISION / OPTIMIZATION-BACKLOG）。

**交叉引用**

| 文档                                                                         | 关系                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------ |
| [LAWMIND-PERSISTENCE-SCALE-REVIEW.md](./LAWMIND-PERSISTENCE-SCALE-REVIEW.md) | 持久化膨胀 / token / 扫盘审查与 P0–P2 已实施细节 |
| [LAWMIND-OPTIMIZATION-BACKLOG.md](./LAWMIND-OPTIMIZATION-BACKLOG.md)         | 产品远景与能力 backlog                           |
| [LAWMIND-ENGINEERING-REVIEW.md](./LAWMIND-ENGINEERING-REVIEW.md)             | 工程评审与已落地附录                             |

---

## 1. 持久化与扩展性（长期使用 / 多案件）

> 背景审查：2026-07-18 → [PERSISTENCE-SCALE-REVIEW](./LAWMIND-PERSISTENCE-SCALE-REVIEW.md)

### 已缓解（勿重复开坑）

- [x] Prompt 注入窗口（CASE / 画像 / 日日志等）
- [x] CASE §8 进展轮转 + `progress-archive.md`
- [x] 案件列表 lite（不扫全量 audit）
- [x] `readRecentAuditLogs` 限窗
- [x] 相似案读入上限；检索适配器截断
- [x] 协作 audit 按天分文件
- [x] CASE.md per-matter 写锁（`case-md-lock.ts`）

### 仍待做

- [ ] **真正的 matter 级 audit 索引**（taskId/matterId → 日期文件偏移），彻底告别「按天窗口近似」
- [ ] **会话磁盘 compact**：`sessions/*.json` 与 `.turns.jsonl` / transcript 归档或 gzip 旧段；热路径只保留摘要
- [ ] **queue / approvals / adoption JSONL**：行数大时改为 append-only + 软删，或 SQLite
- [x] **atomic `rewriteJsonl`**（短中期）：temp+rename 已落地（ENGINEERING-REVIEW **R-P1-9 ✅**）；长期 JSONL→SQLite 仍见上条
- [ ] **LAWYER_PROFILE §八写侧轮转**（prompt 已截断；档案本体仍可能无限 append）
- [ ] **`model-usage/ledger.jsonl` 保留策略**（按月滚动）
- [ ] **FTS 重建增量索引**（避免全量扫 audit + turns）
- [ ] **详情 API 按章节懒加载 CASE**（UI 不必一次拉 120k）
- [ ] **工具 `read_case_file` 默认窗口**（禁止默认返回全文）

---

## 2. Agent / 上下文与成本

- [x] System prompt 工具列表随 registry 膨胀 → 默认 compact + 核心 12 + `list_more_tools` 本会话披露（2026-08-16 W1-C；registry 仍保留全部 execute）
- [ ] 相关记忆召回与 system 注入的统一 budget 账本（单一计数器）
- [ ] 检索链路（research）与对话链路共享同一套窗口常量（避免两套漂移）
- [ ] 多 agent 并行时的上下文隔离配额（避免会议室 + 多委派同时灌满）
- [x] **同 session 并行 turn**：进程内按 `workspaceDir+sessionId` 串行（`session-turn-gate.ts`，2026-08-14）；跨进程双开本地 server 仍可能竞态（桌面默认单进程）
- [x] **律师可见工具卡 / Stop 打到工具 / 轮中补材料 / 结构事件日志 / prompt 段表**（2026-08-14 DeepSeek 三刀；`session.json` 仍为权威，events.jsonl 并行）
- [x] **纠正本轮 / 检索邮件 spill / 溢出先剪再试 / 停止与超时正交**（2026-08-16 DeepSeek 第二遍；见 ENGINEERING-REVIEW 附录）
- [ ] **事件日志升格为会话权威**：今日 `events.jsonl` 只投影 live-turn；完整替换可变 `session.json` + 流式 delta 回放仍待做

---

## 3. 产品与治理（从评审迁移）

- [ ] **文档站自动发布到托管**（Pages / Cloudflare）
- [ ] **智能体层级强制策略**（仅可向汇报线委派等）写进 `validateDelegation` / `lawmind.policy.json`
- [ ] **互审多轮与版本时间线**（`request_review` 现为单轮）
- [ ] Firm 级伦理墙与客户披露的独立治理流程（Edition 模板已有；真墙未完）
- [ ] 权威外库 API 与本机启发式拒答的长期校准

---

## 4. 桌面 UX / IA 债

- [x] Action Hub 模态 vs「在办」主视图的最终收敛：侧栏/顶栏/对话「待我拍板」直接进「在办」（不再开模态）
- [x] 「会议室」为顶栏「会议室·办件」入口（可绑案件 / 临时讨论）；案件内改为深链；一级顶栏仅对话/在办
- [x] 会议室：工作区级临时讨论存储（`meetings/adhoc/`，不再 `POST /api/matters/create` 造假案件；遗留 `cases/临时讨论` 自动迁移并在事项列表隐藏）
- [x] 会议室：对话「引用到对话」材料注入 `meetingAgenda`（每轮模型上下文；议题旁可见材料列表）
- [x] 会议室：议题材料选择器（复用 `LawmindComposeContextPicker` + 搜索框；与对话 pins 同一真相源）
- [x] 无文件系统桥接时的建案/材料树降级体验（侧栏「新建」CTA + 对话空态不再依赖 FS 桥，2026-07-20；材料树本身仍需桥接）
- [ ] 超大工作区（数千案件）下的侧栏虚拟化与搜索索引
- [x] 文书台预览窗与主窗状态同步：`sync-request` + 未保存 live 不被 8s 磁盘轮询覆盖
- **不做**：对话消息区改 `role="tabpanel"`。会话 Tab 已有 `aria-controls`，面板保持 `region` + `aria-busy` + `#lawmind-chat-messages-panel`。改 tabpanel 会拆多份 e2e `getByRole("region", { name: "对话消息" })`，律师可感知收益接近零。

---

## 5. 安全与运维

- [ ] **邮件密钥进 OS 钥匙串**：现为 LawMind 根目录 `mail-secrets.json`（0o600）。模型 Key 已走 `safeStorage`；邮件密钥要进钥匙串需 main 注入 + 迁移，且自动办件跑在 server 子进程。未做：不是 Day-1 主路径，磁盘权限已挡普通泄露。
- [ ] 工作区备份 / 迁移工具（含 progress-archive、day-split audit）
- [ ] 审计完整性链在「按天窗口读取」下的校验策略说明
- [ ] Doctor：检测 CASE/audit/session 体积异常并建议轮转
- [ ] 私有化部署下的磁盘配额告警

---

## 6. 工程卫生

- [ ] **脏树按主题拆 PR（N-A0）**：组织/合并面，不是代码缺陷。要发 PR 时再切，勿在功能轮顺手拆。
- [ ] **`engine-pipeline-tools.ts` 按工具族拆文件**：现约 1300 行、7 个工具定义。下次改起草/渲染工具时顺手拆，不单独开重构轮。
- [x] `memory/index.ts` ↔ `case-writes.ts` 循环依赖拆干净（ensureCaseWorkspace 下沉 → `memory/case-workspace.ts`，2026-07-20）
- [ ] 桌面 server 路由与引擎查询层对「lite vs full index」API 命名统一
- [ ] CI：为 prompt-windows / overview-lite 增加回归门禁（已有单测则挂到 PR 集）
- [ ] `persistDraftPipeline` 仍为同步 API、CASE 进展 `void` 触发：长期可改为 async 管道，避免测试/热路径依赖「锁 + 最终一致」
- [ ] 将其它 Markdown 真相文件（日日志、LAWYER_PROFILE）也纳入同类写锁或统一 write-gateway
- [ ] **双真相写路径收敛**（检测已部分落地）：高风险字段单写口见 ENGINEERING-REVIEW **R-P2-7**（review stamp SSOT + `transitionDeliverable` 防 approved/rejected 回写，2026-07-28）；Doctor 巡检另含 `client_drift`（CASE ↔ matter.json.clientId，2026-07-28 续轮）；完整 Markdown↔JSON / tasks↔drafts 其余写路径仍属本文件长期项

---

## 变更记录

| 日期       | 说明                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| 2026-07-18 | 建册；并入持久化审查未尽项与 DEFERRED 类问题；链到 PERSISTENCE-SCALE-REVIEW                                |
| 2026-07-18 | 标记 CASE.md 写锁已落地；补充日日志/画像写锁与 async draft pipeline 待做项                                 |
| 2026-07-25 | 链到工程 9.5 冲刺：R-P1-9 atomic rewriteJsonl、R-P2-7 写路径收敛（短中期）                                 |
| 2026-08-14 | DeepSeek 三刀落地（中文卡 / Stop+工具信号 / 轮中注入 / events.jsonl / prompt 段表）；session.json 仍为权威 |
