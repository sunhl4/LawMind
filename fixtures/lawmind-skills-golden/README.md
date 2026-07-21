# LawMind Skills 黄金集（S0）

20 条脱敏样例，用于基线评分与回归抽测（闸门 G0 / G1）。  
**不调用模型**：CLI 只校验夹具完整与分诊/清单规则可解析。

## 目录

| 文件              | 说明                                        |
| ----------------- | ------------------------------------------- |
| `catalog.json`    | 20 条选题元数据与期望要点                   |
| `cases/*.md`      | 输入材料（脱敏）                            |
| `expected/*.json` | 期望分诊档位 / 交付类型 / 必核 spec（可选） |

## 跑法

```bash
pnpm lawmind:skills:golden
```

无 API 密钥时仍应通过（结构与规则冒烟）。有工作区时可附带指标汇总：

```bash
pnpm lawmind:skills:golden -- --workspace ./workspace
```
