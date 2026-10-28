/**
 * P0.4 验收门里能离线证明的两条：
 *
 * 1. 自动归案只用强键，且在合成数据上精确率 100%（跨客户错归为 0）；
 * 2. 收件层拿不到发送能力——来件内容是不可信数据，不是 Agent 指令。
 *
 * 「失败重试不丢邮件」「重复只入库一条」「撤回不删律师修改」分别在
 * `mail-intake.test.ts` / `store.test.ts` 覆盖，这里不重复。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import { buildIntakeMatterIndex } from "./matter-index.js";
import { resolveIntakeItem } from "./resolve.js";
import { getIntakeItem, listIntakeItems, recordIntakeItem } from "./store.js";
import { triageIntakeItem } from "./triage.js";
import type { NewIntakeItem } from "./types.js";

const dirs: string[] = [];

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-intake-acceptance-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const CASE_A = "(2026)沪01民初1001号";
const CASE_B = "(2026)沪01民初2002号";

function message(key: string, patch: Partial<NewIntakeItem> = {}): NewIntakeItem {
  return {
    channel: "email",
    externalKey: `email:acc:${key}`,
    receivedAt: "2026-10-26T04:00:00.000Z",
    from: { display: "来件", address: `${key}@sender.test` },
    subject: "材料",
    text: "请查收。",
    attachments: [],
    ...patch,
  };
}

describe("intake auto-filing acceptance", () => {
  it("auto-files only strong-key hits, at 100% precision, with zero cross-client filing", () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案" });
    createMatterIfMissing(dir, { matterId: "matter-b", title: "乙案" });
    /** 案号是唯一强键来源：把它记进案卷，再建一次快照。 */
    const writeDocket = (matterId: string, caseNo: string) => {
      const file = path.join(dir, "matters", matterId, "matter.json");
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      raw.docket = { caseNo };
      fs.writeFileSync(file, JSON.stringify(raw));
    };
    writeDocket("matter-a", CASE_A);
    writeDocket("matter-b", CASE_B);
    const index = buildIntakeMatterIndex(dir);

    /** 期望：auto_attach 时只能归到 expected；其余一律停在律师队列。 */
    const cases: Array<{ key: string; input: NewIntakeItem; expected: string | null }> = [
      {
        key: "a1",
        input: message("a1", { subject: `补充证据 ${CASE_A}`, text: "见附件。" }),
        expected: "matter-a",
      },
      {
        key: "a2",
        input: message("a2", { subject: "补充", text: `案号 ${CASE_A}，请查收。` }),
        expected: "matter-a",
      },
      {
        key: "b1",
        input: message("b1", { subject: `开庭材料 ${CASE_B}` }),
        expected: "matter-b",
      },
      {
        key: "b2",
        input: message("b2", { text: `这是 ${CASE_B} 的送达回证。` }),
        expected: "matter-b",
      },
      {
        key: "both",
        input: message("both", { text: `两案都要：${CASE_A} 与 ${CASE_B}` }),
        expected: null,
      },
      {
        key: "dmarc",
        input: message("dmarc", { subject: `伪造 ${CASE_A}`, dmarc: "fail" }),
        expected: null,
      },
      {
        key: "none",
        input: message("none", { from: { display: "路人", address: "stranger@example.test" } }),
        expected: null,
      },
    ];

    let autoFiled = 0;
    let correct = 0;
    for (const row of cases) {
      const item = recordIntakeItem(dir, row.input).item;
      const resolution = resolveIntakeItem(item, index);
      const decided = triageIntakeItem(dir, item, index);
      const filedTo: string | null = decided.filing?.matterId ?? null;
      if (filedTo) {
        autoFiled += 1;
        if (filedTo === row.expected) {
          correct += 1;
        }
      }
      if (row.expected === null) {
        expect(filedTo, `${row.key} 不能自动归案`).toBeNull();
        expect(resolution.decision).not.toBe("auto_attach");
      } else {
        expect(filedTo, `${row.key} 应归入 ${row.expected}`).toBe(row.expected);
      }
    }

    expect(autoFiled).toBe(4);
    expect(correct / autoFiled).toBe(1);
    // 跨客户错归为 0：乙案的来件不会出现在甲案里。
    const aMeshed = listIntakeItems(dir, { statuses: ["attached"] }).filter(
      (item) => item.filing?.matterId === "matter-a",
    );
    expect(aMeshed.length).toBe(2);
    expect(aMeshed.every((item) => (item.text + (item.subject ?? "")).includes(CASE_A))).toBe(true);
  });

  it("does not give the intake layer any outbound send capability", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const files = fs
      .readdirSync(here)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(5);

    /** 这些名字一出现，就说明收件层可以直接把内容发出去。 */
    const forbidden = [
      "sendMailViaAccount",
      "sendSmtpMail",
      "sendGraphMail",
      "send_email",
      'from "../mail/index.js"',
      'from "../agent/tools',
    ];
    for (const name of files) {
      const source = fs.readFileSync(path.join(here, name), "utf8");
      for (const needle of forbidden) {
        expect(source, `${name} 不应引用 ${needle}`).not.toContain(needle);
      }
    }
  });

  it("keeps one record when the same message is pulled twice", () => {
    const dir = workspace();
    const first = recordIntakeItem(
      dir,
      message("dup", { thread: { messageId: "<dup@example.test>" } }),
    );
    const second = recordIntakeItem(
      dir,
      message("dup", { thread: { messageId: "<DUP@example.test>" } }),
    );
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.item.id).toBe(first.item.id);
    expect(listIntakeItems(dir, { statuses: ["pending"] })).toHaveLength(1);
    // store 归一化 Message-ID：去尖括号、小写。
    expect(getIntakeItem(dir, first.item.id)?.thread?.messageId).toBe("dup@example.test");
  });
});
