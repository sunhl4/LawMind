# LawMind「未来问题」总册

> **用途**：集中登记**已识别、暂未做完或需长期回看**的工程/产品风险，避免散落在聊天与多个 backlog 里丢失。  
> **怎么用**：新发现的「以后会痛」的问题写进对应章节；落地后勾选并链到 PR/审查文。  
> **不是**：当前 sprint 清单（那是具体 PR）；也不是愿景文档（见 VISION / OPTIMIZATION-BACKLOG）。

**交叉引用**

| 文档                                                                         | 关系                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------ |
| [LAWMIND-PERSISTENCE-SCALE-REVIEW.md](./LAWMIND-PERSISTENCE-SCALE-REVIEW.md) | 持久化膨胀 / token / 扫盘审查与 P0–P2 已实施细节 |
| [LAWMIND-DEFERRED.md](./LAWMIND-DEFERRED.md)                                 | 暂缓项索引（指向本册或保留短列表）               |
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
- [ ] **LAWYER_PROFILE §八写侧轮转**（prompt 已截断；档案本体仍可能无限 append）
- [ ] **`model-usage/ledger.jsonl` 保留策略**（按月滚动）
- [ ] **FTS 重建增量索引**（避免全量扫 audit + turns）
- [ ] **详情 API 按章节懒加载 CASE**（UI 不必一次拉 120k）
- [ ] **工具 `read_case_file` 默认窗口**（禁止默认返回全文）

---

## 2. Agent / 上下文与成本

- [ ] System prompt 工具列表随 registry 膨胀 → 按角色/场景裁剪工具定义
- [ ] 相关记忆召回与 system 注入的统一 budget 账本（单一计数器）
- [ ] 检索链路（research）与对话链路共享同一套窗口常量（避免两套漂移）
- [ ] 多 agent 并行时的上下文隔离配额（避免会议室 + 多委派同时灌满）

---

## 3. 产品与治理（从 DEFERRED / 评审迁移）

- [ ] **文档站自动发布到托管**（Pages / Cloudflare）：见原 [DEFERRED](./LAWMIND-DEFERRED.md)
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

---

## 5. 安全与运维

- [ ] 工作区备份 / 迁移工具（含 progress-archive、day-split audit）
- [ ] 审计完整性链在「按天窗口读取」下的校验策略说明
- [ ] Doctor：检测 CASE/audit/session 体积异常并建议轮转
- [ ] 私有化部署下的磁盘配额告警

---

## 6. 工程卫生

- [x] `memory/index.ts` ↔ `case-writes.ts` 循环依赖拆干净（ensureCaseWorkspace 下沉 → `memory/case-workspace.ts`，2026-07-20）
- [ ] 桌面 server 路由与引擎查询层对「lite vs full index」API 命名统一
- [ ] CI：为 prompt-windows / overview-lite 增加回归门禁（已有单测则挂到 PR 集）
- [ ] `persistDraftPipeline` 仍为同步 API、CASE 进展 `void` 触发：长期可改为 async 管道，避免测试/热路径依赖「锁 + 最终一致」
- [ ] 将其它 Markdown 真相文件（日日志、LAWYER_PROFILE）也纳入同类写锁或统一 write-gateway

---

## 变更记录

| 日期       | 说明                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| 2026-07-18 | 建册；并入持久化审查未尽项与 DEFERRED 类问题；链到 PERSISTENCE-SCALE-REVIEW |
| 2026-07-18 | 标记 CASE.md 写锁已落地；补充日日志/画像写锁与 async draft pipeline 待做项  |
