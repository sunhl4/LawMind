# LawMind 模型适配说明（通用 + 法律专用）

本文档说明 LawMind 当前支持的模型接入方式：

- 国内通用模型 API 接入口（OpenAI-compatible）
- 开源法律专用模型（ChatLaw / LaWGPT）
- LexEdge 框架接入
- 未来合作方本地部署接入位

---

## 一、接入原则

1. **接口统一**：优先走 OpenAI-compatible 接口。
2. **能力分层**：通用模型负责背景整理，法律模型负责法律结论和风险识别。
3. **输出约束**：模型输出必须是结构化 JSON，且经过 schema 校验。
4. **可替换**：任何模型都通过 adapter 接入，不侵入核心流程。

---

## 二、国内通用模型 API 接入口

当前支持以下 provider 预设（是否免费取决于各平台实时策略/额度）：

- Qwen（DashScope compatible）
- DeepSeek
- GLM（智谱）
- Moonshot（Kimi）
- SiliconFlow

对应代码：

- `src/lawmind/retrieval/providers.ts`
- `createDomesticGeneralAdaptersFromEnv()`

环境变量（示例）：

- `LAWMIND_QWEN_API_KEY` + `LAWMIND_QWEN_MODEL`
- `LAWMIND_DEEPSEEK_API_KEY` + `LAWMIND_DEEPSEEK_MODEL`
- `LAWMIND_GLM_API_KEY` + `LAWMIND_GLM_MODEL`
- `LAWMIND_MOONSHOT_API_KEY` + `LAWMIND_MOONSHOT_MODEL`
- `LAWMIND_SILICONFLOW_API_KEY` + `LAWMIND_SILICONFLOW_MODEL`

---

## 三、开源法律专用模型适配

### 1) ChatLaw（开源，主力推荐）

接入方式：本地部署后暴露 OpenAI-compatible endpoint。

环境变量：

- `LAWMIND_CHATLAW_BASE_URL`
- `LAWMIND_CHATLAW_MODEL`
- `LAWMIND_CHATLAW_API_KEY`（本地可填 `local`）

### 2) LaWGPT（开源，备用）

环境变量：

- `LAWMIND_LAWGPT_BASE_URL`
- `LAWMIND_LAWGPT_MODEL`
- `LAWMIND_LAWGPT_API_KEY`（本地可填 `local`）

对应代码：

- `createOpenSourceLegalAdaptersFromEnv()`

---

## 四、LexEdge（开源框架）适配

LexEdge 作为多智能体框架参考，LawMind 当前预留了 HTTP 适配入口：

- `LAWMIND_LEXEDGE_ENDPOINT`
- `LAWMIND_LEXEDGE_TOKEN`（可选）

约定：LexEdge endpoint 返回与 LawMind `ModelRetrievalOutput` 同结构 JSON。

对应代码：

- `createLexEdgeAdapterFromEnv()`

---

## 五、合作方本地部署接入位

为后续与其他公司合作的专用法律模型保留统一入口：

- `LAWMIND_PARTNER_LEGAL_BASE_URL`
- `LAWMIND_PARTNER_LEGAL_MODEL`
- `LAWMIND_PARTNER_LEGAL_API_KEY`（可选，本地可填 `local`）

对应代码：

- `createPartnerLegalAdapterFromEnv()`

---

## 六、快速验证（smoke）

### 1) 复制环境模板

```bash
cp .env.lawmind.example .env.lawmind
```

你只需要填写要启用的 provider 对应变量，不必全部填写。  
`lawmind:env:check` 和 `lawmind:smoke` 会自动读取 `.env.lawmind`（无需手动 `source`）。

### 1.1) 一键初始化（推荐）

```bash
npm run lawmind:setup
```

可选参数：

```bash
npm run lawmind:setup -- --preset qwen-chatlaw --yes
```

可用 preset：

- `qwen-chatlaw`
- `deepseek-lawgpt`
- `general-lexedge`
- `general-partner`

### 2) 运行 smoke

命令：

```bash
npm run lawmind:smoke
```

### 3) 先做环境体检（推荐）

命令：

```bash
npm run lawmind:env:check
```

可选 `--strict`（CI/交付验收）：若未同时具备 general+legal ready，退出码非 0。

```bash
npm run lawmind:env:check -- --strict
```

会输出每个 provider 的状态：`ready / partial / off`，并给出整体可运行状态：

- `ready (general+legal)`
- `partial (some providers ready)`
- `mock-only`

### 4) 推荐最小可用组合

- **推荐起步**：Qwen + ChatLaw
- **备用组合**：DeepSeek + LaWGPT
- **框架组合**：任一通用模型 + LexEdge
- **合作部署**：任一通用模型 + Partner Legal Model

可选环境变量：

- `LAWMIND_INTERACTIVE_REVIEW=1` 启用 CLI 人工审核

当任一真实模型适配器启用时，smoke 会自动切到 `real-model` 模式；否则使用内置 mock 适配器。

可选 `--fail-on-empty-claims`（生产验收）：在 real-model 下若检索结果无任何结论，直接失败。

```bash
npm run lawmind:smoke -- --fail-on-empty-claims
```

---

## 七、后续建议

1. 为每个 provider 增加连接自检命令（health check）。
2. 增加模型返回质量评分（来源完整率、冲突率、空洞率）。
3. 对法律模型增加“法条版本一致性校验”。
