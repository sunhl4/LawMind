# LAWMIND-YUANDIAN-INTEGRATION — 元典智库接入与多法库并用

状态：已实现（代码在 `src/lawmind/retrieval/`），待拿真实 API Key 联调。

## 0. 结论

- 元典（华宇元典）官方开放平台：<https://open.chineselaw.com/>，注册换 API Key，`Authorization: Bearer` 鉴权。
- 接入形态：**Streamable HTTP MCP Server**（默认 `https://open.chineselaw.com/mcp`），与官方 npm 代理
  `yuandian-mcp-server` 指向同一远端。LawMind 用自研 client 直连（initialize 会话握手 + 复用），
  不依赖 npx 代理。
- 多法库兼容：`LAWMIND_AUTHORITY_PROVIDER` 现在**支持逗号分隔多值**（例 `yuandian,pkulaw`），
  元典与北大法宝可同时启用，调用结果合并、去重、逐库记账。单库配置行为与旧版完全一致。

## 1. 环境变量

| 变量                         | 谁用         | 说明                                                                                                                                            |
| ---------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `LAWMIND_AUTHORITY_PROVIDER` | 全局         | 单值或列表：`open`（默认）/ `generic` / `pkulaw` / `yuandian` / `lexis`；多值例 `yuandian,pkulaw`；别名支持 `法宝` `北大法宝` `元典` `元典智库` |
| `LAWMIND_YUANDIAN_API_KEY`   | 元典         | **必填**才能启用元典；不与法宝 Key 共享（故意不发同一个 Bearer 到不同厂商）                                                                     |
| `LAWMIND_YUANDIAN_ENDPOINT`  | 元典         | 可选，默认 `https://open.chineselaw.com/mcp`；仅 http/https，私网/元数据地址拒绝                                                                |
| `LAWMIND_YUANDIAN_MODE`      | 元典         | `keyword`（默认，法条/案例关键词检索）或 `vector`（语义检索）                                                                                   |
| `LAWMIND_YUANDIAN_LAW_TOOL`  | 元典         | 可选覆盖法库工具名；默认 `yuandian_rh_ft_search`（vector 模式 `yuandian_law_vector_search`）                                                    |
| `LAWMIND_YUANDIAN_CASE_TOOL` | 元典         | 可选覆盖案例工具名；默认 `yuandian_rh_ptal_search`（vector 模式 `yuandian_case_vector_search`）                                                 |
| `LAWMIND_AUTHORITY_ENDPOINT` | 法宝/generic | 法宝网关地址（沿用，不变）                                                                                                                      |
| `LAWMIND_AUTHORITY_API_KEY`  | 法宝/generic | 法宝调用令牌（沿用，不变）                                                                                                                      |
| `LAWMIND_PKULAW_MODE` 等     | 法宝         | 未动，见 `providers/pkulaw/client.ts` 头注释                                                                                                    |

Key 只从环境变量读取，不落盘、不打日志；该前缀已被 `src/lawmind/platform/safe-command.ts` 列为密钥项。

## 2. 多同时多法库怎么兼容（设计）

`src/lawmind/retrieval/authority-adapter.ts`：

1. `resolveAuthorityProviderList` 把 env 解析成有序去重列表；未知 token 丢弃并在结果上挂
   风险旗（fail-closed，不静默升级成 open）。
2. 多库时**并发 fan-out**：每个库用各自的端点/Key 独立检索；未配置（缺 Key 或缺端点）的库
   自动跳过，不浪费调用。
3. 合并在 `src/lawmind/retrieval/authority-merge.ts`：
   - **跨库重复命中都保留**（`provider` 标签区分）——两个独立库同时命中同一条法条是更强的
     权威信号；同库重复按 `provider+title+citation+url` 均匀去重，claim 的 `sourceIds` 重映射，
     跨库 id 冲突时发新 UUID，claim 归属不漂移；
   - `riskFlags` / `missingItems` 按库顺序取并集（面向律师的告知不吞并）；
   - `authorityOutcome` 取最优状态（ok > empty > 限流/配额/鉴权/不可用），`hitCount` 求和。
4. 记账：`recordAuthorityUsage` 按库分别记录（`ops/authority-usage.json` 的 `byProvider` 原生支持），
   元典 / 法宝各自的成功率、限流、命中率分开看，不互相污染。
5. 全库都未配置 → 保持 fail-closed（明确 missingItems「不得编造法条」），与单库语义一致。

层级/文案：`buildAuthorityCorpusSummary`（`authority-health.ts`）在多库模式下给
`providerLabel = "北大法宝 + 元典智库"`、`status = configured`，Doctor 与检索工具文案自动生效；
`search-authority.ts` 把命中标签成「元典智库」「北大法宝」分开显示来源。

## 3. 元典 client 细节（`providers/yuandian/`）

- MCP 生命周期：`initialize` → 取 `Mcp-Session-Id` → `notifications/initialized` →
  `tools/call`（复用会话）。会话 404/400/409 视为失效，重握手一次再重试一次；无跨进程持久化。
- 出网先过 `assertAuthorityEndpointSafeToFetch`（SSRF 校验、DNS 解析私网拒绝）与
  `createOutboundProxy`（tag `yuandian`），与法宝同规格。
- 响应映射（`map.ts`）：容错深扫 `data.list / extra.fatiao / structuredContent / content JSON`，
  法条用 `fgmc+ftnum` 组装 `《法规名》第X条` 引文，案例读 `case_number/标题`，
  全部命中打 `provider: "yuandian"` 标签，杜绝编造。
- 请求体按接口文档：keyword 模式 `{ keyword, page_size: 10 }`，vector 模式 `{ query, top_k: 10 }`
  （案例多带空 `wenshu_filter`）。**字段名如远端有出入，用上面的 tool/args 环境变量对齐，不必改代码。**

## 4. 联调步骤（拿到 Key 之后）

1. `export LAWMIND_YUANDIAN_API_KEY=...`，先用 curl 验证远端：
   ```bash
   curl -sS https://open.chineselaw.com/mcp \
     -H "authorization: Bearer $LAWMIND_YUANDIAN_API_KEY" \
     -H "content-type: application/json" \
     -H "accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"lawmind","version":"0.2.0"}}}'
   ```
   若返回体/响应头形状与 client 预期不符（例如 tools/call 参数名不是 `keyword`），
   优先用 `LAWMIND_YUANDIAN_LAW_TOOL` / `LAWMIND_YUANDIAN_CASE_TOOL` 调整工具名，
   或在 `providers/yuandian/client.ts` 的 `buildYuandianArguments` 对齐字段（带单测改）。
2. 单库验证：`LAWMIND_AUTHORITY_PROVIDER=yuandian` 起 `pnpm lawmind:desktop`，
   在「模型与连接」确认 Doctor 绿灯，聊天里跑一条法条检索 + 一条案例检索。
3. 多库并用：`LAWMIND_AUTHORITY_PROVIDER=yuandian,pkulaw`，确认合并命中「北大法宝 / 元典智库」
   双来源展示，`ops/authority-usage.json` 两个 `byProvider` 都有计数。
4. 口径核对：`元典智库板块` 自报数据库规模（400 万+ 法规文件、1.5 亿裁判文书），
   与 `authority-source-tier` 的 `live` 判定一致（有 Key 即 live）；免费额度条款确认后
   若按量计费，追加配置告警即可复用 402/429 的既定 fail-closed 文案。

## 5. 桌面客户端注意（本轮 client review 已处理）

- **钥匙串令牌注入是多库感知的**：`authorityProviderUsesStoredKey` 按列表 token 判断——
  `yuandian,pkulaw` 仍会注入钥匙串里的法宝令牌；`yuandian` 单独使用时不注入法宝账，
  元典 Key 从 `.env.lawmind` 的 `LAWMIND_YUANDIAN_API_KEY` 读取（该文件会被
  `lawmind-desktop-env-bootstrap.ts` 以 override=true 整体加载进引擎，无需额外接线）。
- **设置页 `read-authority-settings`**：provider 按列表首个可识别 token 映射——
  法宝系/generic/lexis → `pkulaw`（表单按法宝显示），元典 → `yuandian`，否则 `open`。
- **设置页「连接权威库」卡片**：provider 为元典时显示警示行——手工配置生效中；保存法宝
  时 `planAuthoritySave`（`electron/authority-setup.mjs`）会把已有的元典 token 合并回
  `yuandian,pkulaw`，不再整体覆盖（`mergeAuthorityProviderOnSave`），只有切换到
  「公开法规」才回到 `open`。configured + 元典/法宝/generic 都会显示「对话检索走这里的权威库」。
- Renderer 的 provider 类型联合 widened（`lawmind-settings-models.ts` / `lawmind-app-data.ts` /
  `global.d.ts`），`LawmindAuthoritySetup.tsx` 的 custom note 条件同步。

## 6. 暂不做 / 后续

- 元典「幻觉校验」类引文校验接口：开放平台首页提到但接口清单里未收录，暂没有 Client；
  法条详情 `yuandian_rh_ft_detail`（法条存在性 + 时效性核验）是最合适的落点，
  接入到 pkulaw `citation-validate` 的同款 env 门控即可。
- 企业信息 / 证券合规类接口（尽调工作流）未接，按 provider 已有扇出结构随时可加。
- MCP 工具直挂（`mcp-client-bridge` 手动加 `https://open.chineselaw.com/mcp`）仍是可行的
  快速验证路径，但工具表会多出 40 个泛化工具，不作为推荐终态。
