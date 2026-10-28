# 发布前的外部输入（工程侧不能替代）

> 用途：把「必须由律师、发布负责人、客户或真实材料提供」的发布前输入集中写清。
> 口径：工程侧只保证脚本可运行、缺失时诚实 SKIP/红；**不伪造真稿、证书、真实模型分数或客户环境**。

对应台账：[`LAWMIND-REMAINING-WORK.md`](LAWMIND-REMAINING-WORK.md) B 档。

## 1. 真稿对照（P0-1 与各期「对照实测」）

### 谁提供

律师自行脱敏后放入真实合同、起诉状或其它交付物。不要用仓库内 NDA markdown 或合成文档代替。

### 放哪

```text
fixtures/lawmind-true-manuscript/
  <真实文件>.docx | .doc | .pdf
  <真实文件>.baseline.json      # 可选 sidecar，只检查抽取文本形状
```

二进制夹具已被 `.gitignore` 排除；仓库只保留 README。

### 怎么跑

```bash
pnpm lawmind:true-manuscript
# 发版前 fail-closed：
LAWMIND_REQUIRE_TRUE_MANUSCRIPT=1 pnpm lawmind:true-manuscript
```

### 通过标准

- 文件夹里有真实二进制，闸门从 SKIP 变 RUN；
- 全部样本通过；
- 报告写到 `lawmind/metrics/true-manuscript-report.json`；
- `pnpm lawmind:release-readiness` 的真稿章节从「待外部输入」变绿。

### 现在是什么状态

`fixtures/lawmind-true-manuscript/` 只有 README，闸门诚实 SKIP。工程侧不勾 P0-1。

## 2. 签名与公证（P2-A）

### 谁提供

发布负责人提供 Apple Developer ID 证书与 GitHub secrets；Windows 代码签名证书同理。

### 需要的 secrets

- macOS 签名：`MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`
- Apple 公证：`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`
- Windows 签名：`WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`

### 怎么跑

推 `lawmind-desktop-v*` tag 触发 [`.github/workflows/lawmind-desktop-build.yml`](../../.github/workflows/lawmind-desktop-build.yml)。mac 分支在证书存在时设 `LAWMIND_REQUIRE_NOTARIZED=1`；缺 secrets 时如实标红，不伪装成已签名。

### 通过标准

- tag 工作流产出已签名、已公证的 `.dmg`；
- `LAWMIND_REQUIRE_NOTARIZED=1` 通过；
- `pnpm lawmind:release-readiness` 的公证项变绿；
- 浏览器下载后 Gatekeeper 不再拦。

### 现在是什么状态

本机是 adhoc 未签名包；缺证书与 secrets。工程侧不勾 P2-A。

## 3. 真实模型基准（80% 发版门）

### 谁提供

有授权的真实材料、模型预算与评测负责人。

### 怎么跑

```bash
pnpm lawmind:benchmark -- --mode real --out dist/lawmind-benchmark.json
pnpm lawmind:release-readiness -- --strict --benchmark-in dist/lawmind-benchmark.json
```

### 通过标准

- `--mode real` 的报告达到约定门槛；
- 报告写明模型、题集、日期与失败样本；
- 不用 `--mode scripted` 的文本重叠率冒充质量证据。

### 现在是什么状态

没有授权的真实跑分；`pnpm lawmind:verify:release` 会因缺真实基准而红。这是诚实红，不是工程缺陷。

## 4. 试点测量（预注册协议）

### 谁提供

真实律师使用与至少 8 周观察窗。

### 怎么跑

```bash
pnpm lawmind:north-star-trend -- --workspace <dir> --window 90
```

### 通过标准

- 单周 ≥5 次交付才报比率；
- ≥4 个可用周才给方向；
- `mixed` 原样报出，不挑好看的一项；
- 样本不足时结论是「证据不足」，不是「没变差」。

详见 [`LAWMIND-PILOT-MEASUREMENT-PROTOCOL.md`](LAWMIND-PILOT-MEASUREMENT-PROTOCOL.md)。

## 5. 14.11 人/数据/凭证债

| 项                    | 谁提供         | 通过标准                                  |
| --------------------- | -------------- | ----------------------------------------- |
| 法律顾问抽审          | 外部法律顾问   | 抽审记录与签字；规则/判据变更须顾问验收   |
| 真实 ≥10 已结案       | 律所           | 脱敏后进入评测集；不得用合成案件顶替      |
| LLM 评审人类校准 ≥80% | 律师标注       | 双模型打分与律师标注一致度达标            |
| 法宝 / Lexis 联调     | 供应商账号     | 真实检索回包与引用核对；断网/拒答诚实降级 |
| M4 生产流量指标       | 试点客户       | 真实使用指标；不以本地夹具代替            |
| DOCX 修订回读         | 真实 Word 文件 | 读实际 `w:ins`/`w:del`；整句删增不算完成  |

## 6. 客户交付清单

见 [`LAWMIND-DELIVERY.md`](../LAWMIND-DELIVERY.md) §8。只能在客户机器完成，不在本仓代跑。

## 7. 外部输入到位后的收口动作

1. 把真实文件/证书/报告放到约定位置，不提交含 PII 的二进制；
2. 跑对应命令，保留报告；
3. 更新 [`LAWMIND-REMAINING-WORK.md`](LAWMIND-REMAINING-WORK.md) B 档状态；
4. 更新 [`GOALS.md`](../../GOALS.md) 对应勾选项；
5. 在 [`LAWMIND-ENGINEERING-REVIEW.md`](../LAWMIND-ENGINEERING-REVIEW.md) 记一行「何时、用什么材料、结果」；
6. 若结果不达标，保持不勾，不把「跑过」当成「通过」。
