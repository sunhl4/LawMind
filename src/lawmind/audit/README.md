# LawMind 审计链（Audit Chain）

本目录实现本地审计日志的写入、导出、链式完整性校验与外部锚定。

## 文件

- `index.ts`：主写入接口 `emit()`、读取接口、Markdown 导出。`emit()` 在 `integrityChain=true` 时调用 `hash-chain` 生成 HMAC-SHA256 链，并写入 `audit-root.log` 外锚；若配置了 `LAWMIND_AUDIT_EXTERNAL_ANCHOR_URL`，会 fire-and-forget 同步到外部锚。
- `hash-chain.ts`：链式 HMAC/SHA-256 计算、校验与摘要统计。支持同一台机器上 env 密钥与 key 文件密钥并存。
- `audit-key.ts`：解析本机审计链密钥（env 优先，降级 key 文件）。
- `root-anchor.ts`：同目录 `audit/audit-root.log` 尾部截断检测。
- `export-summary.ts`：生成可验证审计摘要 `{dateRange, eventCount, rootHash, hashAlg, tailAnchor, hmacKeyId}`，并用 HMAC-SHA256 签名。支持纯文本打印格式。
- `external-anchor.ts`：外部锚定器接口。默认实现 `file://`，可选 `HttpPutExternalAnchorUploader` 走统一出口代理。失败只告警，不阻断审计。
- `verify-external.ts`：读取审计链与外部锚，验证签名、链完整性、root hash 一致，输出律师友好的中文报告。

## 摘要格式（JSON）

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-03T12:00:00.000Z",
  "summary": {
    "dateRange": { "from": "2026-09-01T00:00:00.000Z", "to": "2026-09-03T12:00:00.000Z" },
    "eventCount": 42,
    "rootHash": "...",
    "hashAlg": "hmac-sha256",
    "tailAnchor": { "date": "2026-09-03", "rootHash": "...", "timestamp": "...", "eventId": "..." },
    "hmacKeyId": "audit-chain"
  },
  "signature": "..."
}
```

## 外部锚配置

桌面端在「设置 → 工作区 → 审计外部锚」填写路径或 URL，保存后写入 `workspace/lawmind/desk-settings.json` 的 `auditExternalAnchorUrl` 字段。Electron 在启动本地服务器时读取该字段并注入环境变量 `LAWMIND_AUDIT_EXTERNAL_ANCHOR_URL`；服务器端 `emit()` 据此触发同步。

支持的 URL 形式：

- `file:///Volumes/Backup/lawmind-anchor.json` 或绝对路径
- `https://...` 只写 PUT URL（如 S3 signed PUT URL、云存储 webhook）

HTTP 上传走统一出口代理 `outbound-proxy.ts`，支持代理、超时、重试与 SSRF 二次校验。

## 验证命令

本地 API：

```bash
# 导出 JSON 摘要
GET /api/audit/export-summary

# 导出纯文本摘要（适合打印）
GET /api/audit/export-summary?format=text

# 验证链与外部锚
POST /api/audit/verify-external
{ "externalAnchorUrl": "file:///..." }
```

## 安全假设

- 审计链密钥（`LAWMIND_AUDIT_CHAIN_KEY` 或 `~/.lawmind/keys/audit-chain.key`）必须与工作区分开保存；攻击者只有同时拿到密钥和全部审计文件才能伪造链。
- 外部锚把工作区外的摘要作为独立副本，进一步提升防篡改能力；建议保存到异机、U 盘或只写云存储。
- 外部锚同步是 best-effort：网络失败会打印警告，但不会让审计事件写入失败。
