# LawMind 优化改造续做记录（2026-10-21）

依据：用户确认的 W0–W11 执行计划。本文件说明当前实现及验收边界，不把自动化回归当成真实法律质量评测。

## 本轮接续修复

- 构建：修复引擎、本地服务、桌面界面三类 TypeScript 阻塞；移除桌面共用导出入口对 Node 文件 I/O 的运行时再导出，消除 renderer 构建中的 `node:fs/promises` 外置警告；同步已有 file-workbench CSS。保留之前的未提交工作，不做全量暂存、提交或回退。
- W1 抽取：修正 `extract_batch` 已计算但未回传 `ambiguousCells` 的断点。`update_cells` 支持候选原句与字段角色理由；只有值、原句及当前文本版本能对上才升级为 `exact_quote`，否则保留 `pattern_only`。来源版本随抽取元数据落盘。
- W2 证据：复用工作区路径围栏，拒绝符号链接越界和受保护文件；持久化本地研究来源版本，生产出稿查询接入证据核验。远程 URL 不误当本地文件。失效来源和引文不匹配进入机械出稿门。
- W3 工具：共享稳定参数签名，区分不同查询及同参新结果；重复判断包含结果。总预算和执行上限保留。指定交件缺口期间可在执行层限制检索，不再按任务帧从第零轮禁检索。
- W4 恢复：服务端以响应连接关闭判定断流，默认继续且保留 `LAWMIND_STREAM_LOSS_POLICY=abort`。工作开始前发送会话标识。客户端处理干净 EOF 和读取异常；仅用 GET 对账，未知结果不自动重发，后台会话不覆盖当前会话。最多轮询 60 次，仍未知时明确提示。暂停最终进度仍保持 paused。
- W5 采样：父循环与子工共用 `sampling-loop.ts` 有界驱动；子工回包收窄复用 `pruneToolResultsInHistory`，取消补齐工具配对；旧子工开关保留。测试验证六批读取三十份不同材料，超过旧五轮预算。
- W6 记账：主模型及新子工共用逐次调用记录器。HTTP 失败和配对修复有独立 attempt；记账回调失败不会触发模型重试。缺失用量不写成零；汇总标出未知条数，缓存观测不全时不伪造完整命中总量。fixed 估算随 token_usage 事件传至桌面。
- W6 续：把此前未接入的独立模型入口补进同一本账——压缩摘要（`compact_digest`）、材料成稿的逐文件摘要（`worker`）、案卷简报与案卷行热因（`matter_brief` / `matter_hotline`）、图片与 PDF 视觉 OCR（`ocr`）。此前「逐次用量只覆盖主循环和新只读子工」，其余调用真实消耗 token 却不进账本；现在按 `model-usage/ledger.jsonl` 逐次 HTTP 行记录，失败请求也记一行，未知用量留空而不是写 0。
- W7 工具表：软阈值与交件教练不再物理收缩 wire 工具表；权限与实际执行门仍独立生效。披露增长保留稳定排序及增量说明。cassette 比较连续请求的 tools。
- W8 文件：读时记录版本并跨超时上下文共享；写时实际传入 expectedVersion，临时写完后再校验；中途删除、取消均拒绝覆盖。唯一临时文件、fsync、rename，保留权限。摘要覆盖全部字节，能检测保留时间戳的中部变更。改名后正确记录目标版本。
- W9 审批：工具暂停的 gate reason 与默认对话回复复用已有中文说明；磁盘现状说明复用路径围栏。
- W10 参数：能力表控制 seed/response_format，reproducible 固定温度并持久化会话采样偏好；当前 turn 留模型、参数与工具表指纹。只承诺记录实际参数，不承诺服务商确定性。
- W11 链路：新增三条假模型、真工具链（`src/lawmind/evaluation/task-chains.test.ts`）：Word 原文件改稿（整句锚点被收窄 → 落改 → 带修订导出，检查 `w:ins`/`w:del` 与原文保留）、材料成稿（子工读材料 → 缺口如实落草稿 → 导出可打开）、多份合同金额比较（先返回 `ambiguousCells`，下一轮用候选原句显式指定才升为 `exact_quote`，未指定行仍是「无法判断」）。断言入口工具表、下一请求体、工具结果与磁盘产物。

## 收尾补齐（第二轮）

- 重启对账：`getLiveTurnProgressOrReplay` 现在区分「日志里最后一轮没有 `final`」与「仍在运行」。前者置 `paused` + `needsReconcile`、把残留 `running` 步骤改成 `paused`，并补一条「上次办理在应用退出时中断」的说明；另一进程仍持有租约时不改写。派生的「继续本件 / 弃办」卡片继续由 `turn-interrupt.ts` 负责。
- 外发绑定：新增 `platform/outbound-approval-binding.ts`。`prepare_outbound_mail` / `send_email` 排队时把收件人、主题哈希、正文哈希、每个附件的全字节版本钉进 `pendingSend.binding`；`approve_send` 前逐项复核，变化即返回 409 并列出原因，不再按旧批准发出改过的内容。
- 旁路账本：独立审稿员（`guardian`）与路由分类（`router`）接入同一本逐次账本；`completeJsonObject` 新增 `onAttempt`，失败与重试同样有行。缺失用量仍记未知，不写 0。
- 摘要与 OCR 账本（第三轮）：压缩摘要（`compact_digest`）、材料成稿的逐文件摘要（`worker`）、案卷简报与案卷行热因（`matter_brief` / `matter_hotline`）、图片与 PDF 视觉 OCR（`ocr`）全部接入同一本账。此前这些调用真实消耗 token 却不进账本，「本轮花了多少」只能解释主循环那一半；现在每次 HTTP 一行，失败也记，未知用量留空不写 0。
- 不稳定用例：`turn-orchestrator-parallel.test.ts` 原先只把 `turn_wait` 挂在第三路，但哪一路排队由调度决定；漏收事件后测试空转到 15 秒模型超时，超时释放槽位又让三路都进采样，于是随机失败（复现约 1/10）。改为三路都收事件，失败信息补每路请求数；修复后连续 40 次 0 失败。
- 真实材料探针：新增 `pnpm lawmind:task-chains`（离线、不调模型）：在本机案件材料上跑「最短锚点改 Word → 带修订导出 → 原件未变」与「真材料批量抽取 → 逐行可追溯 → 歧义可见」。成稿链没有模型时明确 SKIP。
- 缓存 A/B：新增 `pnpm lawmind:cache-ab`（默认 `--dry-run`；真实运行只用合成法条文本，不读工作区材料），三测冷启动/复读/变表，上游不报缓存字段时输出 `absent`。
- 修一处会直接崩的断点：`ingest-helpers.ts` 使用 `resolveDocumentPageChars` 却未导入，补齐导入。

## 已执行验证

- 最后一次全量 Vitest：**7902 tests / 1095 files 通过**，4 tests / 2 files skipped，耗时约 152 秒（改造前基线 7 个失败：consult 检索锁定、discovery 收表、审计日文件时区、相对时间跨日、并发排队）。
- 新增/修复的准入用例：`task-chains.test.ts`（三条任务链）、`task-chain-probe.test.ts`（真 docx/真 txt 上的确定性链）、`sample-until-done.test.ts`（子工轮次/截断/回滚开关）、`atomic-write.test.ts`（版本冲突）、`outbound-approval-binding.test.ts`（附件版本变化拒绝发送）、`sidecar-usage-accounting.test.ts`（审稿员成功/失败都入账）、`cache-ab.test.ts`（缺缓存字段不写 0）、`session-event-log.test.ts`（重启中断回放）、`turn-orchestrator-cassettes.test.ts`（W7 工具表排序与披露增量）、`review-table-patterns.test.ts`（多候选歧义）、`evidence-support.test.ts`（stale / quote 不匹配）。
- `pnpm typecheck`、`pnpm --filter lawmind-desktop typecheck`、`pnpm typecheck:desktop-node` 均通过。
- `pnpm lawmind:bundle:desktop-server` 与 `pnpm --filter lawmind-desktop build:renderer` 通过；有既有大 chunk 警告。
- 真实 Electron 启动和本地服务崩溃恢复测试 2/2 通过。使用隔离测试数据，不把 Vite 页面当产品。

## 数据路径和不作的承诺

- 文件：案卷、草稿、交件、用量账本保存在本机工作区。
- 推理：模型推理会把所需上下文发送给配置的模型服务商；这与文件保存在本地是两件事。
- 检索：联网检索把查询发送给启用的检索提供方，受现有出网策略约束。
- 外发：沿用人工签批与待发路径，本轮没有把工具自动执行等同于外发授权。
- 引文匹配只证明文本能核对，不证明法律适用或语义正确；二进制材料未接专用抽取器时不能宣称原句验证通过。
- 逐次用量已覆盖：主循环、只读子工、材料摘要子工、压缩摘要、案卷简报/案卷行热因、图片与 PDF 视觉 OCR、独立审稿员、路由分类。仍未覆盖：旧实现回滚路径、标题生成、`probe` 连通性测试、`openai-json` 的成稿/审稿旁路（`buildDraftWithModel` / `critiqueDraftWithModel`）、自动化规划解析（`directive-parser` 直连请求）；这些调用要么量小、要么走旧引擎，但在补齐前不能说「所有模型调用都已记账」。
- 文件冲突保护从首次读取/触碰目标开始，不是 turn 开始时扫描全工作区。外部 Word/Finder 不受进程内锁约束，最后检查与 rename 之间仍有小竞态窗口；本轮未建立通用历史备份系统。
- 外发绑定覆盖「排队 → 批准发送」这条路；旧会话遗留的 `__approved` 直发路径没有历史绑定可比对。
- 三条链的自动化用例使用合成材料。`pnpm lawmind:task-chains` 可在真实材料上跑确定性部分，但本机 `workspace/cases/*` 目前没有材料（`materials` 均为空），脚本如实返回 `skipped: no_matter_materials`；没有材料就不产出「真实任务对照」。
- 本机未配置模型凭据（`LAWMIND_AGENT_*` / `DEEPSEEK_*` 均未设置），`pnpm lawmind:cache-ab --dry-run` 返回 `configured: false`，因此**真实缓存 A/B、账单金额、同输入正文哈希一致都尚未测**。脚本已就绪，配置凭据后可直接跑；这仍然不能用 cassette 代替。

## 后续验收（现在只剩需要真实环境的部分）

代码侧已补齐：重启对账、外发版本绑定、旁路账本、离线探针与缓存 A/B 脚本。仍需在真实环境完成的四项：

1. 在已获授权材料上跑 `pnpm lawmind:task-chains`，保留产物与耗时；
2. 配置模型凭据后跑 `pnpm lawmind:cache-ab`（合成文本），记录 `reported` 数字与实际账单；
3. 真机走一遍「附件重新导出后再点批准发送」，确认 409 与重新批准路径符合律师预期；
4. 关窗/杀进程后重开，确认在办卡片给出「继续本件 / 弃办」且 live-turn 不再显示 running。

未完成这四项前，产品效果验收仍为部分完成；自动化回归只能证明行为契约，不能替代真实材料与真实账单。
