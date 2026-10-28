# 工作区备份与迁移

> 入口：`pnpm lawmind:workspace:backup` / `pnpm lawmind:workspace:restore`。
> 旧的 `pnpm lawmind:backup`（bash tarball）仍在，保留给习惯 tar 的运维；新工具多了清单、恢复校验与默认密钥排除。

## 1. 备份

```bash
pnpm lawmind:workspace:backup -- --workspace <工作区> --out <备份.zip>
```

不写 `--out` 时，在当前目录生成 `lawmind-workspace-backup-<UTC 时间>.zip`。

默认排除：

- 密钥：`.env` / `.env.*`、`lawmind/license.json`、`lawmind/mail-secrets.json`；
- 派生/运行时：`lawmind/search-index*`、`lawmind/lint/`、`lawmind/decision/`、`rounds/`、`.git/`、`node_modules/`、`dist/`、`release/`、`.cache/`、`tmp/`；
- 符号链接不跟进，避免把工作区外的文件带进包；
- 单文件超过 100 MB 跳过并写 warning；总量超过 2 GB 直接拒绝（可用 API 的 `maxFileBytes` / `maxTotalBytes` 调整）。

确实要带密钥时显式加 `--include-secrets`。归档会明文包含密钥；移动前加密，恢复后按需轮换，不要把归档留在共享位置。

### 清单

zip 根目录有 `BACKUP-MANIFEST.json`：

- `schemaVersion`、`createdAt`、`workspaceName`（只写目录名，不写本机绝对路径）；
- `fileCount` / `totalBytes` / `includedRoots`；
- `excluded` / `warnings` / `secretsIncluded`；
- `files`（POSIX 相对路径 + 字节数）。

`--json` 会直接打印这份清单，便于脚本核对。

## 2. 恢复

```bash
pnpm lawmind:workspace:restore -- --from <备份.zip> --to <新工作区>
```

安全规则：

- 目标目录已有文件时默认拒绝；确认要覆盖同名文件才加 `--force`；
- `--force` 只覆盖同名文件，**不删除**目标里已有内容；
- 归档内出现绝对路径、盘符或反斜杠路径直接拒绝；
- 恢复清单本身也落盘，便于事后核对；
- 不碰工作区外的 `~/.lawmind`（密钥链、许可、模型凭据、邮箱密钥都不在这个包里）。

恢复后：

1. 退出应用；如守护进程还在，先 `pnpm lawmind:daemon -- stop --workspace <新工作区>`。
2. 打开应用，看模型连接与工作区索引；索引缺了会在检索时重建。
3. 换机器时重配模型密钥、技能签名、邮箱与许可（`~/.lawmind/license.json`）。

## 3. 与旧 tar 备份的关系

`pnpm lawmind:backup` 仍按 `LAWMIND_WORKSPACE_DIR` 打 tar.gz，清单是 `BACKUP-MANIFEST.txt`。两条路都可用：

- 只要一个能解开就行的归档：旧 tar 就够；
- 要默认排除密钥、要清单、要安全恢复：用新的 zip 工具。

不要把两种清单混用；恢复前先看 zip 根目录是 `BACKUP-MANIFEST.json` 还是 `BACKUP-MANIFEST.txt`。

## 4. 私有化部署的磁盘配额

在 `lawmind.policy.json` 里写：

```json
{
  "schemaVersion": 1,
  "storage": { "quotaGb": 20, "warnRatio": 0.9 }
}
```

`pnpm lawmind:doctor` 会多打一行工作区合计；到 `warnRatio` 给备份/归档建议，超过配额也只告警，不拦写入。配额按工作区根目录统计，不跟符号链接，跳过 `.git`、`node_modules`、`dist`、`release`、`.cache`、`tmp`。没写 `storage` 时只报案件/审计/会话/草稿四个桶，不做总量统计。

配额不替代备份，也不替代磁盘监控：它只在有人跑巡检时说话。要在计划任务里定期看，跑 `pnpm lawmind:doctor --json`，读 `ops.storage.quota.usedRatio`。

## 5. 关键文件

- `src/lawmind/platform/workspace-backup.ts`：规划、打包、恢复、路径校验；
- `src/lawmind/platform/workspace-storage-health.ts`：工作区总量、四个桶、配额告警；
- `scripts/lawmind/lawmind-workspace-backup.ts`：备份 CLI；
- `scripts/lawmind/lawmind-workspace-restore.ts`：恢复 CLI；
- `src/lawmind/platform/workspace-backup.test.ts`：排除项、清单、往返、非空目标、恶意路径、超大文件、符号链接；
- `src/lawmind/platform/workspace-storage-health.test.ts`：体积统计、符号链接、配额告警。
