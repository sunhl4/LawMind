# 条款解析 DSL（Clause DSL）

> 法律编译器 P1 骨架：用结构化模式替代正则全文扫描，解析合同文本中的「定义-引用-义务-责任」链。
> 所有法律语义假设均标注「待执业法律顾问复核」，正式使用前应经法律样本校准。

## 设计目标

1. **结构化而非纯正则**：把「标题 + 正文 + 子条款」建模为 AST，而不是在平文本上做无限正则。
2. **可声明的模式**：通过 `ClausePattern` 描述触发词、捕获范围、子模式、自定义提取器。
3. **可降级**：当标题识别失败时，把整个文本作为 `General` 单条款返回，不抛异常。
4. **可合并 lint**：结构化检查结果以 `ClauseFinding` 输出，可独立使用，也可通过 `LegalLintContext.clausePatterns` 合并到 `runLegalLint`。

## 模块一览

| 文件         | 职责                                                                                   |
| ------------ | -------------------------------------------------------------------------------------- |
| `ast.ts`     | AST 类型：`ClauseType`、`Clause`、`ClauseDoc`、`Reference`、序列化 helpers             |
| `pattern.ts` | 模式类型：`ClausePattern`、`CaptureSpec`、`ClauseExtractor`、触发工具                  |
| `dsl.ts`     | 常用模式构造函数：`defineClause`、`definitions`、`obligations`、`liability`、`dispute` |
| `extract.ts` | 核心提取器 `extractClauses(docText, patterns?)`                                        |
| `lint.ts`    | 结构检查器 `runClauseLint(docText, patterns?)`                                         |

## 示例：定义模式并提取

```ts
import { extractClauses } from "./extract.js";
import { defaultClausePatterns } from "./dsl.js";

const doc = extractClauses(contractText, defaultClausePatterns());

console.log(doc.clauses.map((c) => [c.articleNo, c.type, c.title]));
console.log([...doc.definitions.keys()]); // 定义术语
console.log(doc.references); // 第 N 条 / 前款 / 术语引用
```

## 子模式提取

`liability()` 模式自带两个子模式：`赔偿上限` 与 `不可抗力`。当违约责任条款正文中出现这些关键词时，会以子 `Clause` 形式挂在 `children` 下，便于后续规则（如法定赔偿上限、不可抗力通知义务）做局部处理。

## 结构化 lint

```ts
import { runClauseLint } from "./lint.js";

const findings = runClauseLint(contractText);
```

当前内置检查：

- `clause.undefined_article_ref`：引用了不存在的条号。
- `clause.undefined_term`：引用了未定义的引号术语。
- `clause.obligation_without_liability`：有义务条款但缺少违约责任/赔偿（info 级）。
- `clause.dispute_missing`：未识别到争议解决条款（warning 级）。

## 与既有 lint 合并

```ts
import { runLegalLint } from "../lint/run-lint.js";
import { defaultClausePatterns } from "./dsl.js";

const report = runLegalLint(text, undefined, undefined, [], {
  clausePatterns: defaultClausePatterns(),
});
```

不传入 `clausePatterns` 且交付物不是 `contract.*` 时，默认 `runLegalLint` 不引入 clause 发现。合同类交付物会自动接入 `defaultClausePatterns()`。

## 待扩展清单（后续轮次）

- 义务-责任权重/条件逻辑（如「若违约则...」的触发条件）。
- 日期、金额、百分比、上限数值解析，与 `chinese-numeral.ts` 进一步整合。
- 合同族特定模式（买卖、借款、租赁、建工等）的族化配置。
- 用更精确的 NLP/LLM 提取器替换启发式 `extractor`。
- 将 `crossRefRule` 等既有规则逐步迁移到 clause lint。
