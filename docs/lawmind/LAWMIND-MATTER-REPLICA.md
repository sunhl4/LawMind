# LawMind 案件副本（Matter Replica）

> **状态**：M0–M2+ 已落地（身份、邀请、成员角色、Word 签出、记录管、apply 层、材料内容哈希同步/分块、**跨机器接受邀请**、LWW 与冲突旁路、**删除传播**、**材料完整性校验**、**密钥轮换**、**叙事密文出网**、**后台自动同步**、**可远程部署的托管案件云服务端**、**云权威邀请**、**所级协作审计报表**、CASE rematerialize、本机 Matter Cloud `/v1/matters`、邀请密钥包装、工作台协作新材料与「整理入卷」）。  
> **与 Solo 关系**：**默认关闭**。独立律师版不出现入口，不改变现有办案路径。  
> **差距评审**：见 `LAWMIND-MATTER-REPLICA-GAP-REVIEW.md`。

## 一句话

每人继续用自己的 LawMind；邀请同事进入**这一案**；本机磁盘仍是真相；云/中继转发记录管 ops 与材料内容块（SHA-256）。

## 为什么不是坚果云整树同步

| 落盘                              | 整树同步会怎样     | 本方案                                                                 |
| --------------------------------- | ------------------ | ---------------------------------------------------------------------- |
| `approvals.jsonl` / `queue.jsonl` | 冲突副本、待办丢失 | 记录管按 op 追加（M1）                                                 |
| `matter.json`                     | 字段互相覆盖       | 白名单字段经 apply 层投影（其余仍只记 ops）                            |
| `CASE.md`                         | 段落互盖           | **不覆盖本机文件**；分歧摘录写入 `CASE（冲突摘录）.md`。M3 CRDT 仍未做 |
| `materials/*`                     | 静默互盖           | **签出** + **mtime LWW**；败方 `文件名 (冲突).ext`；删除经墓碑传播     |

## Apply 层（远端 op → 本机状态）

`ops.jsonl` 只是日志。**没有 apply 层，跨机器协作是空转的**：同事的 `lock.acquire` 到了、
`locks.json` 却没变，两人仍可能同时改同一份 Word。`src/lawmind/matter-replica/apply-ops.ts`
负责把日志投影成本机状态：

| 投影目标          | 来源 op                                             | 语义                                                                  |
| ----------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| `locks.json`      | `lock.acquire` / `lock.release`                     | 同一路径先到者胜（平局比 `lockId`），过期即清；两台机器收敛到同一答案 |
| `membership.json` | `invite.accept` / `member.upsert` / `member.revoke` | `invite.accept` 只补不覆盖（不复活已移出成员）；不能移出唯一主办      |
| `matter.json`     | `matter.field_set`                                  | 仅白名单字段，且值仍过 `matterSchema` 校验                            |

三条性质：**幂等**（从既有状态 + 全量日志重投影，可重入）、**确定性**（与 op 到达顺序无关）、
**保守**（不认识的字段/非法值一律不写）。

同步顺序也相应调整为「**先拉 op 并生效 → 再传材料 → 最后发布 ops**」，这样同事刚签出的文件，
本轮就能被跳过，而不是被覆盖。`sync` 响应新增 `applied` 字段（生效的签出 / 成员 / 字段数）。

## 跨机器接受邀请（邀请从 op 重建）

同事那台机器上**没有** `invites.jsonl` —— 邀请是随中继上的 `invite.create` op 到达的。
`findInviteByToken` 因此在「本机名册 → inbox」之后兜底一层**从 op 重建**：

- 用 `tokenFp`（SHA-256 前 16 位）匹配，**中继上从不出现邀请码明文**；持有邀请码的人自己就能算出指纹，
  所以不需要把明文写进 op。
- 状态由 `invite.revoke` / `invite.accept` op 还原 —— 否则「已撤销的邀请还能用」会在对端复活，
  「已被使用的邀请」也会被判成可用。
- 重建出的邀请会落到本机 `invites.jsonl`，让后续状态改写有行可依。

## 删除传播（材料墓碑）

`material.remove` 以前只有发出、没有消费者。后果不只是「同事那边没删」：
中继清单只做并集、永不删条目，所以**已删材料会被自己拉回来（本机复活）**。

现在两条都收口：

- **发布侧**：`publishManifest` 接受 `removed` 名单，清单能**变短**；`material-cloud` 的
  `/materials/manifest` PUT 也认 `removed` 字段。
- **拉取侧**：`applyRemoteMaterialRemovals` 在扫描本地之前落实墓碑，并同步改写本地索引，
  所以对端不会为自己没收到的删除再发一条多余的 tombstone op。

两条护栏：同路径取**最晚**的 `material.put` / `material.remove`（否则「删除后重新上传同一份材料」
会被旧墓碑再删一次）；`sha256` 必须一致才删（本地已改成别的内容是冲突，交给 LWW 与冲突旁路）。

## 托管案件云（服务端）

这是「律所不用自备主机」的那台服务端。桌面端把 `matterReplica.endpoint` 指过来即可，
**不需要** `sharedRelayDir`（判据 `X9`）。

```bash
pnpm lawmind:matter-cloud -- --setup   # 建租户 + 打印一次管理员令牌
pnpm lawmind:matter-cloud              # 启动（默认 127.0.0.1:8788）
```

数据目录布局（租户隔离在**路径层面**完成，不靠逐处 if 判断）：

```text
<dataDir>/
  tenants.json                    # 租户表
  accounts.json                   # 账号表（只存 tokenHash / tokenFp，**明文令牌不落盘**）
  tenants/<tenantId>/
    invites.json                  # 该租户的邀请（跨租户兑换在结构上不可能）
    matters/<matterId>/
      ops-bundle.json
      materials-manifest.json
      blobs/<sha256>
      cloud-membership.json       # 服务器侧成员名册（授权依据）
```

### 端点

| 方法    | 路径                                          | 说明                                         |
| ------- | --------------------------------------------- | -------------------------------------------- |
| GET     | `/v1/health`                                  | 免鉴权；只回服务名与租户数，不含案件信息     |
| GET     | `/v1/me`                                      | 我是谁（account / tenant / lawyerId / role） |
| GET/PUT | `/v1/matters/:id/ops`                         | 记录管                                       |
| GET/PUT | `/v1/matters/:id/materials/manifest`          | 材料清单（含墓碑 `removed`）                 |
| GET/PUT | `/v1/matters/:id/blobs/:sha256`               | 内容块                                       |
| GET/PUT | `/v1/matters/:id/membership`                  | 云侧成员名册                                 |
| POST    | `/v1/matters/:id/invites` · `/invites/revoke` | 建/撤销邀请                                  |
| POST    | `/v1/invites/redeem`                          | 用邀请码加入                                 |

### 授权（复用桌面端能力矩阵，避免两端漂移）

| 端点                                     | 需要                                                |
| ---------------------------------------- | --------------------------------------------------- |
| `ops` GET · `manifest` GET · `blobs` GET | 在册成员，**`external` 除外**                       |
| `ops` PUT                                | `edit_matter_records`                               |
| `manifest` PUT                           | `upload_materials`（带墓碑另需 `delete_materials`） |
| `blobs` PUT                              | `upload_materials`                                  |
| `membership` GET                         | 在册成员                                            |
| `membership` PUT                         | `manage_members`                                    |
| `invites` POST                           | `invite`                                            |

### 内容块的完整性边界（重要且诚实）

端到端加密下，客户端上传的是**密文**，而路径上的 `sha256` 是**明文**的哈希 ——
服务端没有密钥，重算必然不等。所以服务端按是否封套分流：

- **明文部署**：服务端重算哈希，不符即 `400 blob_hash_mismatch`，中继无法被当作污染源；
- **密文部署（E2EE）**：服务端只校验格式与大小；真实性与完整性由 AES-GCM 认证标签
  **加**客户端按 manifest 的 `sha256` 校验（判据 `X5`）共同保证。

若在服务端一律强制比对上文的明文哈希，E2EE 就永远无法上传 —— 这是取舍，不是遗漏。

### 部署责任（本进程不做）

TLS 终止、限流、审计日志留存、备份、密钥托管。**不要**把明文 HTTP 直接暴露到公网；
`--setup` 输出的令牌只显示一次，请立刻存入密钥管理。

## 所级协作审计报表

协作动作原先只落 `ops.jsonl`（同步日志），**从不进入审计链** —— 律所采购清单上的
「谁在何时动了卷宗」在协作场景下是空白。现在协作动作写入**防篡改审计链**，并可导出报表。

### 记什么

`collab.` 前缀的审计事件，**自带 `matterId`**（协作动作不是任务，无法靠 taskId 反查案件）：

| 事件                                               | 触发                             |
| -------------------------------------------------- | -------------------------------- |
| `collab.invite_created` / `_accepted` / `_revoked` | 生成 / 接受 / 撤销邀请           |
| `collab.member_removed`                            | 移出成员                         |
| `collab.member_key_published`                      | 公布设备公钥（幂等，仅首次记）   |
| `collab.key_rotated` / `_distributed`              | 轮换密钥 / 向新成员补发          |
| `collab.document_checked_out` / `_released`        | 签出 / 释放                      |
| `collab.material_filed` / `_removed`               | 入卷 / 移除材料                  |
| `collab.integrity_rejected`                        | 拒收哈希不符或解封失败的内容     |
| `collab.conflict_parked`                           | 冲突旁路写出                     |
| `collab.cloud_roster_applied`                      | 云名册改变本地名册               |
| `collab.sync_activity`                             | **确有变化**的同步（非每轮心跳） |

> 刻意不给每轮自动同步记事件：30 秒一轮的心跳会把审计链灌满，稀释真正的信号。
> 只有 `pulled > 0`、apply 有改动、或材料真有进出时才记。

### 兼容性（关键）

`canonicalPayload` 里 `matterId` / `actorName` 是**条件包含**的：

```ts
...(event.matterId ? { matterId: event.matterId } : {}),
...(event.actorName ? { actorName: event.actorName } : {}),
```

若无条件加入哈希，**既有的每一条审计链都会验签失败** —— 对合规特性是灾难性回归。
条件包含同时让新事件里的 `matterId` 受篡改保护（改案件号即验签失败，有测试覆盖）。

### 写入姿态与导出

- 写入是**投递即忘**（审计 IO 不拖慢签出/入卷），需要确定性时 `flushCollaborationAudit()`；
  报表生成前会先 flush，保证不漏掉刚发生的动作。
- 报表含：按动作 / 按律师 / 按案件汇总 + 明细 + **链完整性结论**。

| 方法 | 路径                                               | 说明                                           |
| ---- | -------------------------------------------------- | ---------------------------------------------- |
| GET  | `/api/matter-replica/audit-report`                 | JSON 报表，支持 `since` / `until` / `matterId` |
| GET  | `/api/matter-replica/audit-report?format=markdown` | 可打印/可交付的 Markdown                       |

## 云权威邀请（桌面端已接云）

配了云之后，**邀请由服务端权威管理**，桌面端不再自己造邀请码 —— 同一件事只有一个真相源。

| 环节          | 权威                                 | 本地角色                                                  |
| ------------- | ------------------------------------ | --------------------------------------------------------- |
| 建 / 撤销邀请 | 云（`POST /v1/matters/:id/invites`） | 只留一条可追溯的 op（**不含**可兑换的明文邀请码）         |
| 邀请码        | 云（`LMC-` 前缀）                    | 面板粘贴即兑换                                            |
| 成员名册      | 云                                   | **投影**：同步时拉云名册写成本地，用于签出 / 权限 / apply |
| 案件密钥      | 主办端分发                           | 新成员接受后等主办端下一轮补发                            |
| 卷宗数据      | 本机磁盘 + ops 投影                  | 云只做转发与鉴权                                          |

面板会显示「邀请由**案件云**管理（endpoint）」；`GET /api/matter-replica/status` 也回
`cloud.inviteAuthority = "cloud" | "local"`，让排障一眼看清当前是谁在管邀请。

### 密钥补发（云邀请没有 `matter_key.share` op）

本地邀请路径靠 `matter_key.share` op 分发钥匙；云邀请没有这条 op，所以：

- 新成员公布公钥（**每次同步都会公布**，幂等 —— 不再只在本地邀请动作时发）；
- **主办端**（`manage_members`）在同步时把**当前**密钥逐一封装补发给尚未拿到的成员；
- 走的是 `matter_key.rotate` op（带当前 keyId），对端按「keyId 与我不同才装」处理，已有者自然跳过；
- **幂等**：每位在册成员都已覆盖当前 keyId 时不再产生 op，不会灌满日志。

### 密钥权威必须是唯一的（安全）

成员分发密钥需要 `manage_members`，且对端**只采信来自 `manage_members` 的密钥 op**。

原因：两台机器若各持一把自生成钥匙并各自分发，对端就成了「最后收到的赢」——
而先前的材料是用另一把钥匙封的，会**静默变得读不出来**。所以规则是：
**主办端分发，其他人只接受。**

## 后台自动同步

律师不该手点同步。`src/lawmind/matter-replica/sync-scheduler.ts` 是**策略**，
定时器与 `fs.watch` 由 desktop server 在启动时建立（`startMatterReplicaAutoSync`），
面板只读状态。

| 行为     | 做法                                                                          |
| -------- | ----------------------------------------------------------------------------- |
| 总开关   | 门控关闭（Solo 默认）不启动；`matterReplica.autoSync: false` 可显式关         |
| 轮询     | 默认 30s 一轮，逐案同步                                                       |
| 即时性   | 配了 `sharedRelayDir` 时 `fs.watch` 递归监听，同事一丢文件就同步（去抖 1.5s） |
| 节流     | 同一案件两次自动同步最小间隔 15s，避免每轮全量扫描                            |
| 单飞     | 上一轮未完成则跳过本轮，不堆积                                                |
| 隔离     | 单案失败只记 `lastError`，不拖累其他案件；只同步**有成员名册**的案件          |
| 生命周期 | 定时器与监听都 `unref()`，不钉住进程；`stop()` 清定时器 + 监听 + 去抖         |

API：

| 方法 | 路径                                 | 说明                                                                                                                                           |
| ---- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/api/matter-replica/scheduler`      | 状态（enabled / autoSync / running / watchingRelay / syncs / lastRunAt / lastError）。**门控关闭时也返回 200**，用来解释「为什么没在自动同步」 |
| POST | `/api/matter-replica/scheduler/tick` | 手动跑一轮**全部在册案件**（与面板上只同步当前案件的按钮不同）；无调度器时 409                                                                 |

> 刻意不做增量游标：文件中继每轮都是全量 bundle，增量要等服务端（见 X9）。

## 安全边界（拒绝降级 / 完整性 / 密钥轮换）

四条门线，对应验收判据 `X5–X8`。

### 材料完整性：内容不符即拒收（X5）

同步在写入律师卷宗**之前**比对 manifest 的 `sha256`（单块与分块都算一次整体哈希）。
不符即记为 `rejectedIntegrity` 并跳过该文件，不阻断其余材料：

```json
{
  "rejectedIntegrity": ["materials/委托合同（初稿）.docx"],
  "integrityErrors": ["材料内容校验失败：…"]
}
```

### 密文信封：失败关闭，不做明文直通（X6）

`openBytes` 遇到非 `LMRENv1` 字节**抛错**，不再原样放行。原先把非信封输入直接 return，
使「把密文换成明文」无法被发现，等于所有 sealed blob 都可被降级。

> **迁移提示**：`cloudEndpoint` 路径此前总是 `sealBytes` 写入，所以正常历史数据不受影响；
> 但若曾手工往中继塞过**未封装**的 blob，升级后该类 blob 会被拒收（这是预期行为）。

### 案件叙事：不再明文出网（X7）

`case_md.snapshot` 的摘录改为用**案件密钥封套**后发布（`sealedExcerptB64`），
没有密钥就只发 `sha256` / `charCount`：

- 摘要足以让对端判断「是否分叉」，正文留在本机；
- 读取走 `readCaseMdExcerpt`：优先解封套，仍兼容读取**旧**的明文 `excerpt`（只读，不再产生新的明文）；
- 无密钥 / 解封失败 → 返回空串，调用方降级为「仅比对摘要」。

> 仍开放：`op` 未签名，且邮箱 / 文件路径等元数据仍明文（属差距评审 G2/G3）。

### 密钥轮换：撤销与移出都必须换钥匙（X8）

每位律师持有一对 X25519 设备密钥（`lawmind/lawyer-keys.json`，私钥 `0600`）：

- **公钥**随 `member.key` op 公布；**私钥**从不出网；
- 轮换时新案件密钥用 ECDH 逐人封装给**仍在册**的成员（`matter_key.rotate`）；
- 对端 `apply` 时只解开「封装给自己」的那一份并装上新钥匙。

触发点：`revokeInvite`（撤销邀请）与 `DELETE` 成员。撤销后：

- 本地 `keyId` 必须变化；
- 泄露的邀请码仍解得出**旧**钥匙，但解不出**当前**钥匙 —— 之后写入的密文它读不了。

尚未公布公钥的老客户端换不到新钥匙，会记进 op 的 `skipped` 与接口响应的 `rotationSkipped`，
**可见地**失效，而不是静默掉线。

> **已知未收口**：`external`（外协）角色按 `upload_materials` 设计，但接受邀请时**仍会拿到案件密钥**，
> 因此能读中继上的密文块。要真正隔离外协，需要「按子树加密」或让外协走独立的收件箱通道 ——
> 这属于产品设计决策，未在本轮改动中处理。

## 门控

| 条件                                                  | 结果                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `edition: solo`（默认）                               | 关闭                                                                         |
| `edition: firm` / `private_deploy`                    | 开启                                                                         |
| `lawmind.policy.json` → `matterReplica.enabled: true` | Solo 也可强制开                                                              |
| `matterReplica.enabled: false`                        | Firm 也可强制关                                                              |
| `matterReplica.sharedRelayDir`                        | 两台机器指向同一文件夹即可交换 ops + materials blobs                         |
| `matterReplica.endpoint`                              | 托管案件云 HTTP 根（优先于目录中继；配 `cloudToken` = 该账号的 Bearer 令牌） |
| 云上材料同步                                          | 要求**本地成员资格**：非成员不会生成案件密钥、也不会在云上放材料             |
| `matterReplica.autoSync: false`                       | 关掉后台自动同步（只想手点同步时）                                           |

Edition feature key：`matterReplicaCollab`。

## 律师怎么用

1. 律所协作版：打开案件概览 → **成员协作**。
2. 填写姓名（与邮箱）并保存。
3. **生成邀请码** → 复制分享文案发给同事（微信即可）；可在列表中**撤销**。
4. 同事在自己的 LawMind 粘贴邀请码 → **加入本案**。
5. 材料放入 `cases/<id>/materials/`，点 **同步记录与材料**。
6. 改合同前点 **我来改**（签出路径）；改完 **释放**。
7. 「新动态」展示材料/签出/入伙等协作事件。

## 落盘布局（additive）

```text
workspace/
  lawmind/
    lawyer-identity.json          # 协作身份
    replica/inbox/                # 可选：导入的邀请包
  matters/<matterId>/replica/
    membership.json               # 成员与角色
    invites.jsonl
    ops.jsonl                     # 记录管
    locks.json                    # 签出锁
    materials-index.json          # 本机材料索引（M2）
  cases/<matterId>/
    CASE.md                       # 叙事（仍本机真相）
    materials/                    # 材料文件（M2 同步源）

sharedRelayDir/<matterId>/        # 可选中继
  ops-bundle.json
  materials-manifest.json
  blobs/<sha256>
```

**不进副本**：`sessions/`、模型密钥、邮件密钥、个人 `LAWYER_PROFILE`、未授权案件。

## 角色（商业默认）

| 角色            | 能力摘要                                            |
| --------------- | --------------------------------------------------- |
| 主办 / 共同主办 | 成员管理、邀请、改记录/CASE、材料、签出、策略、封卷 |
| 协办            | 邀请、改记录/CASE、上传、签出、策略、助手写         |
| 助理            | 改记录、上传、签出                                  |
| 只读            | 仅看                                                |
| 外协            | 仅上传（默认无策略备忘能力）                        |

## API（本地 loopback）

| 方法 | 路径                                       | 说明                   |
| ---- | ------------------------------------------ | ---------------------- |
| GET  | `/api/matter-replica/status`               | 是否开启 + 身份        |
| PUT  | `/api/matter-replica/identity`             | 保存姓名/邮箱          |
| GET  | `/api/matter-replica/membership?matterId=` | 成员/邀请/锁/材料/feed |
| POST | `/api/matter-replica/invites`              | 创建邀请               |
| POST | `/api/matter-replica/invites/accept`       | 用邀请码加入           |
| POST | `/api/matter-replica/invites/revoke`       | 撤销邀请               |
| GET  | `/api/matter-replica/feed?matterId=`       | 新动态                 |
| GET  | `/api/matter-replica/materials?matterId=`  | 材料索引               |
| POST | `/api/matter-replica/locks/acquire`        | 签出                   |
| POST | `/api/matter-replica/locks/release`        | 释放                   |
| POST | `/api/matter-replica/sync?matterId=`       | 经中继同步 ops+材料    |

## Matter Cloud（本机 MVP）

Firm 开启后默认写入 `workspace/lawmind/replica-cloud`，并由本地 API 暴露：

| 方法    | 路径                                 | 说明                              |
| ------- | ------------------------------------ | --------------------------------- |
| PUT/GET | `/v1/matters/:id/ops`                | 记录管                            |
| PUT/GET | `/v1/matters/:id/materials/manifest` | 材料清单                          |
| PUT/GET | `/v1/matters/:id/blobs/:sha256`      | 内容块（云端路径为 AES-GCM 密文） |

接管真 SaaS 时只需把 `matterReplica.endpoint` 指向同一契约的服务端。

## 后续（刻意未做）

1. **托管云的运维面**：对象存储后端（今日为本地磁盘）、令牌过期与轮换、限流、审计留存、
   备份。**部署所需的 TLS / 反代不在本进程内**。
2. **云名册与本地名册的对账**：目前云为权威、本地为投影，但没有冲突检测；
   若云上被手工改动，本地不会提示。
3. **成员公钥先于轮换到位**：轮换时若某成员尚未公布公钥，会记进 `skipped` 而拿不到新钥匙 ——
   可见而非静默，但理想是轮换前先补齐。
4. **材料块 CDC**（大文件分块为固定分块，非内容定义；整文件 ≤50MB）
5. **CASE.md Yjs/Loro 活层** — M3（今日：加密快照摘录 + 冲突旁路，不覆盖本机 CASE.md）
6. **op 签名与防重放**：中继写权限目前等于可注入 op（完整性靠 `sha256`，来源未认证）
7. **元数据加密**：邮箱 / 文件路径等 op 字段仍明文出网
8. **增量同步游标**：`fetchOps` 已收 `afterOpId`，但每轮仍全量

## 验证

```bash
pnpm exec vitest run src/lawmind/matter-replica src/lawmind/policy/edition.test.ts
pnpm --filter lawmind-desktop typecheck
```

**跨机器验收探针**（两个独立工作区 + 中继，判据是「商业级应该怎样」）：

```bash
pnpm lawmind:matter-replica:probe            # 打印逐条判据与证据
pnpm lawmind:matter-replica:probe -- --strict # 有红灯即退出码 1
```

Solo 回归：不设 `LAWMIND_EDITION=firm` 时，案件概览不应出现「成员协作」面板。
