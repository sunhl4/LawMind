# LawMind 案件副本（Matter Replica）

> **分支能力**：`feature/matter-replica-collab`  
> **状态**：M0/M1 已落地（身份、邀请、成员角色、Word 签出、记录管、可选目录中继）。材料块 CDC / CASE CRDT / 托管 SaaS 中继为后续切片。  
> **与 Solo 关系**：**默认关闭**。独立律师版不出现入口，不改变现有办案路径。

## 一句话

每人继续用自己的 LawMind；邀请同事进入**这一案**；本机磁盘仍是真相；云/中继只转发加密后的记录管与（后续）材料块。

## 为什么不是坚果云整树同步

| 落盘                              | 整树同步会怎样     | 本方案                         |
| --------------------------------- | ------------------ | ------------------------------ |
| `approvals.jsonl` / `queue.jsonl` | 冲突副本、待办丢失 | 记录管按 op 追加（M1）         |
| `matter.json`                     | 字段互相覆盖       | 后续字段级 apply；今日先记 ops |
| `CASE.md`                         | 段落互盖           | M3：CRDT 活层写回文件（未做）  |
| `materials/*.docx`                | `合同 (冲突).docx` | **签出**（已做）               |

## 门控

| 条件                                                  | 结果                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `edition: solo`（默认）                               | 关闭                                                                        |
| `edition: firm` / `private_deploy`                    | 开启                                                                        |
| `lawmind.policy.json` → `matterReplica.enabled: true` | Solo 也可强制开                                                             |
| `matterReplica.enabled: false`                        | Firm 也可强制关                                                             |
| `matterReplica.sharedRelayDir`                        | 两台机器指向同一文件夹即可交换 ops（无需律所 NAS 也可；USB/已有同步盘亦可） |

Edition feature key：`matterReplicaCollab`。

## 律师怎么用

1. 律所协作版：打开案件概览 → **成员协作**。
2. 填写姓名（与邮箱）并保存。
3. **生成邀请码** → 复制分享文案发给同事（微信即可）。
4. 同事在自己的 LawMind 粘贴邀请码 → **加入本案**。
5. 改合同前点 **我来改**（签出路径）；改完 **释放**。
6. 若配置了 `sharedRelayDir`，点 **同步记录** 交换 ops。

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

| 方法 | 路径                                       | 说明            |
| ---- | ------------------------------------------ | --------------- |
| GET  | `/api/matter-replica/status`               | 是否开启 + 身份 |
| PUT  | `/api/matter-replica/identity`             | 保存姓名/邮箱   |
| GET  | `/api/matter-replica/membership?matterId=` | 成员/邀请/锁    |
| POST | `/api/matter-replica/invites`              | 创建邀请        |
| POST | `/api/matter-replica/invites/accept`       | 用邀请码加入    |
| POST | `/api/matter-replica/locks/acquire`        | 签出            |
| POST | `/api/matter-replica/locks/release`        | 释放            |
| POST | `/api/matter-replica/sync?matterId=`       | 经中继同步 ops  |

## 后续（刻意未做，避免拖垮主工程）

1. **托管案件云**（HTTP relay + 国内对象存储密文块）— 产品默认路径，替换/补充 `sharedRelayDir`
2. **材料块 CDC**（Seafile/casync 级）— M2
3. **CASE.md Yjs 活层**（muesli 模式）— M3。今日 `case_md.snapshot` 已记 excerpt（8000 字）与 sha256，仍不是 CRDT。
4. **工作台「新材料」事件**接助手整理案卷
5. **客户端加密信封**（Keyhive 风格）

## 验证

```bash
pnpm exec vitest run src/lawmind/matter-replica src/lawmind/policy/edition.test.ts
pnpm --filter lawmind-desktop typecheck
```

Solo 回归：不设 `LAWMIND_EDITION=firm` 时，案件概览不应出现「成员协作」面板。
