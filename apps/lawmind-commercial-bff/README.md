# LawMind Commercial BFF（平台权威额度代理）

> **仅闭源商业构建使用。** OSS 默认构建不得依赖本目录运行时密钥。  
> 状态：**骨架占位** — 不包含真实厂商主密钥。

## 用途

桌面商业版 → 本 BFF → 北大法宝（或主库），隐藏平台主密钥；桌面仅持短时兑换 token。

## 启用条件

```bash
LAWMIND_BUILD_CHANNEL=commercial
LAWMIND_PLATFORM_AUTHORITY_PROXY=1
LAWMIND_PLATFORM_AUTHORITY_BFF_URL=https://your-bff.example
```

`src/lawmind/build-channel.ts` 的 `isPlatformAuthorityProxyEnabled()` 在 `oss` 下恒为 false。

## USER 必做（工程无法代劳）

1. 部署本 BFF（或等价网关）到贵司可控环境  
2. 将法宝/主库 **主密钥** 仅注入 BFF 密钥管理（KMS/Vault），勿进桌面包  
3. 实现：`POST /v1/authority/session` 兑换短时 token；`GET/POST /v1/authority/search` 代理检索  
4. 配置速率限制、审计日志（无案件正文）、合同转授权条款  
5. 商业 CI 使用 `LAWMIND_BUILD_CHANNEL=commercial`；OSS CI 保持默认 `oss`

## 本地占位服务

```bash
node --import tsx apps/lawmind-commercial-bff/stub-server.ts
```

Stub 仅返回 501 + 说明 JSON，用于桌面联调「代理未就绪」路径。
