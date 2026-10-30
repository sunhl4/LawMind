/**
 * P1.4 字段出处：自动填入必须能回指来件与原文；不同值不覆盖。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMatter } from "../adapters/matter-storage/index.js";
import { listDeadlinesForMatter } from "../application/services/deadline-service.js";
import {
  createMatterIfMissing,
  updateMatterProfile,
} from "../application/services/matter-write-service.js";
import { listQueueItemsForMatter } from "../application/services/queue-write-service.js";
import { isDeniedHostPath } from "../host-access/deny-list.js";
import {
  applyIntakeFieldProvenance,
  applyIntakeFieldsFromItem,
  extractIntakeMatterFields,
  listMissingProvenance,
  loadFieldProvenance,
  provenancePath,
} from "./field-provenance.js";
import { recordIntakeItem } from "./store.js";

const dirs: string[] = [];

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-provenance-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function seedMatter(dir: string, matterId = "matter-a") {
  createMatterIfMissing(dir, { matterId, title: "甲案", status: "intake" });
}

function seedItem(dir: string, key: string, text: string) {
  return recordIntakeItem(dir, {
    channel: "email",
    externalKey: `email:provenance:${key}`,
    receivedAt: "2026-10-27T01:00:00.000Z",
    from: { display: "王五", address: `w${key}@client.test` },
    subject: "材料",
    text,
    attachments: [],
  }).item;
}

describe("field provenance", () => {
  it("extracts case number and counterparty, applies them, and records quote/source", async () => {
    const dir = workspace();
    seedMatter(dir);
    const item = seedItem(
      dir,
      "a",
      "上海市浦东新区人民法院\n（2026）沪01民初1001号\n被告：李四\n请依法处理。",
    );
    const extracted = extractIntakeMatterFields(item);
    expect(extracted.map((row) => row.field)).toEqual([
      "docket.caseNo",
      "docket.court",
      "counterparty",
    ]);
    expect(extracted[0]).toMatchObject({
      value: "（2026）沪01民初1001号",
      confidence: 0.9,
    });
    expect(extracted.find((row) => row.field === "counterparty")).toMatchObject({
      value: "李四",
      confidence: 0.5,
    });

    const result = await applyIntakeFieldsFromItem(dir, "matter-a", item.id);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.applied).toEqual(["docket.caseNo", "docket.court", "counterparty"]);
    expect(result.conflicts).toEqual([]);
    expect(loadMatter(dir, "matter-a")?.docket?.caseNo).toBe("（2026）沪01民初1001号");
    expect(loadMatter(dir, "matter-a")?.docket?.court).toBe("上海市浦东新区人民法院");
    expect(loadMatter(dir, "matter-a")?.counterparty).toBe("李四");

    const file = loadFieldProvenance(dir, "matter-a");
    expect(file?.entries).toHaveLength(3);
    for (const entry of file?.entries ?? []) {
      expect(entry.itemId).toBe(item.id);
      expect(entry.quote.length).toBeGreaterThan(0);
      expect(entry.capturedAt).toBeTruthy();
      expect(entry.status).toBe("applied");
    }
    expect(listMissingProvenance(dir, "matter-a").missing).toEqual([]);
  });

  it("does not overwrite an existing different value and opens a need_client_input item", async () => {
    const dir = workspace();
    seedMatter(dir);
    const first = seedItem(dir, "first", "（2026）沪01民初1001号\n被告：李四");
    await applyIntakeFieldsFromItem(dir, "matter-a", first.id);

    const second = seedItem(dir, "second", "（2026）沪01民初2002号\n被告：王五");
    const result = await applyIntakeFieldsFromItem(dir, "matter-a", second.id);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.conflicts).toEqual(["docket.caseNo", "counterparty"]);
    expect(loadMatter(dir, "matter-a")?.docket?.caseNo).toBe("（2026）沪01民初1001号");
    expect(loadMatter(dir, "matter-a")?.counterparty).toBe("李四");

    const queue = listQueueItemsForMatter(dir, "matter-a", {
      kind: "need_client_input",
      status: "open",
    });
    expect(queue.map((row) => row.title)).toEqual(
      expect.arrayContaining(["核对案号", "核对对方当事人"]),
    );
    expect(loadFieldProvenance(dir, "matter-a")?.entries.at(-1)?.status).toBe("conflict");
  });

  it("treats the same value as same and does not duplicate the write", async () => {
    const dir = workspace();
    seedMatter(dir);
    const first = seedItem(dir, "same-1", "（2026）沪01民初1001号");
    await applyIntakeFieldsFromItem(dir, "matter-a", first.id);
    const second = seedItem(dir, "same-2", "（2026）沪01民初1001号");
    const result = await applyIntakeFieldsFromItem(dir, "matter-a", second.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.same).toEqual(["docket.caseNo"]);
      expect(result.conflicts).toEqual([]);
    }
    expect(loadFieldProvenance(dir, "matter-a")?.entries.at(-1)?.status).toBe("same");
  });

  it("preserves other docket fields when filling one", async () => {
    const dir = workspace();
    seedMatter(dir);
    await updateMatterProfile(dir, {
      matterId: "matter-a",
      docket: { court: "上海市浦东新区人民法院", instance: "一审" },
    });
    const item = seedItem(dir, "docket", "（2026）沪01民初1001号");
    await applyIntakeFieldsFromItem(dir, "matter-a", item.id);
    const record = loadMatter(dir, "matter-a");
    expect(record?.docket?.caseNo).toBe("（2026）沪01民初1001号");
    expect(record?.docket?.court).toBe("上海市浦东新区人民法院");
    expect(record?.docket?.instance).toBe("一审");
  });

  it("reports lawyer-filled fields without provenance and keeps provenance out of the matter dir", async () => {
    const dir = workspace();
    seedMatter(dir);
    await updateMatterProfile(dir, {
      matterId: "matter-a",
      causeOfAction: "房屋租赁合同纠纷",
    });
    const coverage = listMissingProvenance(dir, "matter-a");
    expect(coverage.missing).toEqual([
      expect.objectContaining({ field: "causeOfAction", value: "房屋租赁合同纠纷" }),
    ]);

    const item = seedItem(dir, "cause", "房东不退押金。");
    await applyIntakeFieldProvenance(dir, "matter-a", {
      itemId: item.id,
      fields: [
        {
          field: "causeOfAction",
          value: "房屋租赁合同纠纷",
          quote: "房东不退押金",
          confidence: 0.7,
        },
      ],
    });
    const file = provenancePath(dir, "matter-a");
    expect(file.startsWith(path.join(dir, "lawmind", "intake", "provenance"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "matters", "matter-a", "provenance.json"))).toBe(false);
    expect(isDeniedHostPath(file, { homeDir: os.homedir(), workspaceDir: dir })).toBe(true);
    expect(listMissingProvenance(dir, "matter-a").missing).toEqual([]);
  });

  it("returns an empty apply when the item has nothing deterministic to extract", async () => {
    const dir = workspace();
    seedMatter(dir);
    const item = seedItem(dir, "empty", "您好，想咨询一下。");
    const result = await applyIntakeFieldsFromItem(dir, "matter-a", item.id);
    expect(result).toEqual({
      ok: true,
      applied: [],
      same: [],
      conflicts: [],
      coverage: { missing: [], tracked: 0 },
    });
  });

  it("writes court, cause, and a dated hearing, and leaves review cards", async () => {
    const dir = workspace();
    seedMatter(dir);
    const item = seedItem(
      dir,
      "summons",
      "北京市朝阳区人民法院传票：请于2026年9月15日9时到第三法庭开庭。案由：买卖合同纠纷。",
    );
    const result = await applyIntakeFieldsFromItem(dir, "matter-a", item.id);
    expect(result.ok).toBe(true);
    const matter = loadMatter(dir, "matter-a");
    expect(matter?.docket?.court).toBe("北京市朝阳区人民法院");
    expect(matter?.causeOfAction).toBe("买卖合同纠纷");
    expect(matter?.docket?.hearingAt).toBeTruthy();
    const deadlines = listDeadlinesForMatter(dir, "matter-a");
    expect(deadlines.map((row) => row.title)).toEqual(["开庭"]);
    expect(deadlines[0]?.source).toBe("document_extract");

    await applyIntakeFieldsFromItem(dir, "matter-a", item.id);
    expect(listDeadlinesForMatter(dir, "matter-a")).toHaveLength(1);

    const titles = listQueueItemsForMatter(dir, "matter-a", { status: "open" }).map(
      (row) => row.title,
    );
    expect(titles).toEqual(expect.arrayContaining(["核对法院", "核对案由", "核对已登记的期限"]));
  });

  it("reads a case number that only appears in an attachment name", () => {
    const dir = workspace();
    const item = recordIntakeItem(dir, {
      channel: "email",
      externalKey: "email:provenance:filename",
      receivedAt: "2026-10-27T01:00:00.000Z",
      subject: "请查收",
      text: "见附件。",
      attachments: [{ name: "（2026）沪01民初1001号.pdf", size: 12 }],
    }).item;
    expect(extractIntakeMatterFields(item)).toEqual([
      expect.objectContaining({
        field: "docket.caseNo",
        value: "（2026）沪01民初1001号",
      }),
    ]);
  });
});
