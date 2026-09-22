import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateWorkspaceMemoryMarkdown, sanitizeStaleMemoryPolicy } from "./memory-md-migrate.js";

const LEGACY_STOCK = `# MEMORY.md — LawMind 通用长期记忆

本文件是 LawMind 的**系统级记忆**，记录稳定、通用、可复用的规则与原则。  
每次任务启动时必须加载此文件。**不要在此文件写入案件事实或律师个人偏好。**

---

## 一、产品原则

- 高风险操作（发送邮件、修改文件、外发文书）默认需要律师确认，不自动执行。
- 所有输出必须能回溯来源；无法引用来源的结论须明确标注为"不确定"。
- 生成文书前，先呈现结构化草稿，律师审核后再渲染最终产物。
- 成本透明：调用外部模型前告知预估消耗。

---

## 四、风险红线

- 禁止将案件材料、客户信息发送至外部服务。

---

## 五、模型使用规则

- 通用模型：用于背景整理、结构优化、语言润色。
- 专用法律模型：用于法条提取、类案分析、风险识别。
- 两种模型都返回结果时，以专用法律模型为准。

---

## 七、知识与方法论积累

- 本所租赁审查先看押金是否超过两个月。
`;

describe("sanitizeStaleMemoryPolicy", () => {
  it("rewrites legacy stock but keeps lawyer accumulation", () => {
    const { text, changed } = sanitizeStaleMemoryPolicy(LEGACY_STOCK);
    expect(changed).toBe(true);
    expect(text).toContain("待拍板只拦");
    expect(text).toContain("云端推理不是把案件材料另送到一个未授权渠道");
    expect(text).not.toContain("修改文件");
    expect(text).not.toContain("预估消耗");
    expect(text).not.toContain("发送至外部服务");
    expect(text).not.toContain("专用法律模型");
    expect(text).toContain("本所租赁审查先看押金是否超过两个月");
  });

  it("rewrites a single stale bullet without dropping topic indexes", () => {
    const mixed = `# MEMORY.md

- 成本透明：调用外部模型前告知预估消耗。
- [诉状](memory/topics/lit.md) — 诉讼
`;
    const { text, changed } = sanitizeStaleMemoryPolicy(mixed);
    expect(changed).toBe(true);
    expect(text).toContain("云端推理不是把案件材料另送到一个未授权渠道");
    expect(text).toContain("memory/topics/lit.md");
    expect(text).not.toContain("预估消耗");
  });

  it("leaves current policy and topic indexes alone", () => {
    const current = `# MEMORY.md

- 待拍板只拦「从律师这边发出去」的操作。
- [诉状](memory/topics/lit.md) — 诉讼
`;
    const { text, changed } = sanitizeStaleMemoryPolicy(current);
    expect(changed).toBe(false);
    expect(text).toContain("memory/topics/lit.md");
  });
});

describe("migrateWorkspaceMemoryMarkdown", () => {
  let dir = "";

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists the rewrite so recall reads the new policy", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-memory-md-"));
    const file = path.join(dir, "MEMORY.md");
    fs.writeFileSync(file, LEGACY_STOCK, "utf8");
    const first = migrateWorkspaceMemoryMarkdown(dir);
    expect(first.changed).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toContain("待拍板只拦");
    expect(migrateWorkspaceMemoryMarkdown(dir).changed).toBe(false);
  });
});
