import { describe, expect, it } from "vitest";
import { listVerificationChecklistSpecs } from "../deliverables/verification-checklist.js";
import { WORD_REVISION_PACKS } from "../platform/word-revision-packs.js";
import {
  EXPECTED_TOTAL_ITEMS,
  EXPECTED_VERIFICATION_ITEMS,
  EXPECTED_WORD_REVISION_ITEMS,
  ITEM_JUDGMENTS,
} from "./item-judgments.js";
import {
  lawyerOnlyKeys,
  machineItemsByVerifier,
  verificationKey,
  wordRevisionKey,
} from "./judgment-tier.js";
import { MACHINE_VERIFIERS } from "./machine-verifiers.js";

/** 全部 150 项的真实清单（来自代码，不是抄来的数字）。 */
function allChecklistKeys(): string[] {
  const wordRevision = (
    Object.values(WORD_REVISION_PACKS) as Array<{
      items: Array<{ id: string }>;
    }>
  ).flatMap((p) => p.items.map((it) => wordRevisionKey(it.id)));
  const verification = listVerificationChecklistSpecs().flatMap((spec) =>
    spec.items.map((it) => verificationKey(spec.id, it.id)),
  );
  return [...wordRevision, ...verification];
}

describe("G0 判定表：150 项一处不漏", () => {
  it("清单规模与判定表登记的期望值一致（改了清单就要显式改期望值）", () => {
    const wordRevision = (Object.values(WORD_REVISION_PACKS) as Array<{ items: unknown[] }>).reduce(
      (a, p) => a + p.items.length,
      0,
    );
    const verification = listVerificationChecklistSpecs().reduce((a, s) => a + s.items.length, 0);
    expect(wordRevision).toBe(EXPECTED_WORD_REVISION_ITEMS);
    expect(verification).toBe(EXPECTED_VERIFICATION_ITEMS);
    expect(wordRevision + verification).toBe(EXPECTED_TOTAL_ITEMS);
  });

  it("清单里每一项都在判定表里分级了", () => {
    const missing = allChecklistKeys().filter((key) => !(key in ITEM_JUDGMENTS));
    expect(missing, `未分级：${missing.join("、")}`).toEqual([]);
  });

  it("判定表里没有已不存在的项（清单删项后要同步删表）", () => {
    const known = new Set(allChecklistKeys());
    const orphans = Object.keys(ITEM_JUDGMENTS).filter((key) => !known.has(key));
    expect(orphans, `判定表里的孤儿项：${orphans.join("、")}`).toEqual([]);
  });

  it("清单键无重复（`citations` / `sources` 这类跨 spec 同名必须带 specId 前缀）", () => {
    const keys = allChecklistKeys();
    const dup = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
    expect(dup, `重复键：${dup.join("、")}`).toEqual([]);
  });
});

describe("G0 判定表：machine 项必须有可执行的验证器", () => {
  it("每个 machine 项都声明了 verifier", () => {
    const bad = Object.entries(ITEM_JUDGMENTS)
      .filter(([, j]) => j.tier === "machine" && !j.verifier?.trim())
      .map(([k]) => k);
    expect(bad, `缺 verifier：${bad.join("、")}`).toEqual([]);
  });

  it("每个 machine 项指向的 verifier 都在注册表里", () => {
    const known = new Set(MACHINE_VERIFIERS.map((v) => v.id));
    const bad = Object.entries(ITEM_JUDGMENTS)
      .filter(([, j]) => j.tier === "machine" && j.verifier && !known.has(j.verifier))
      .map(([k, j]) => `${k}→${j.verifier}`);
    expect(bad, `验证器不存在：${bad.join("、")}`).toEqual([]);
  });

  it("判定表与验证器声明的 itemIds **双向一致**", () => {
    const byVerifier = machineItemsByVerifier(ITEM_JUDGMENTS);
    for (const v of MACHINE_VERIFIERS) {
      const declared = (byVerifier.get(v.id) ?? []).toSorted();
      const actual = [...v.itemIds].toSorted();
      expect(actual, `验证器 ${v.id} 的 itemIds 与判定表不一致`).toEqual(declared);
    }
    // 反向：判定表里出现但没有任何验证器认领的 verifier id。
    const registryIds = new Set(MACHINE_VERIFIERS.map((v) => v.id));
    for (const verifierId of byVerifier.keys()) {
      expect(registryIds.has(verifierId), `判定表引用了未注册的验证器 ${verifierId}`).toBe(true);
    }
  });
});

describe("G0 判定表：主观项永不编译", () => {
  it("lawyer 项都写了律师可见的理由", () => {
    const bad = Object.entries(ITEM_JUDGMENTS)
      .filter(([, j]) => j.tier === "lawyer" && !j.lawyerReason?.trim())
      .map(([k]) => k);
    expect(bad, `缺 lawyerReason：${bad.join("、")}`).toEqual([]);
  });

  it("lawyer 项**不得**出现在任何机器验证器里（I3 编译期防呆）", () => {
    const lawyer = lawyerOnlyKeys(ITEM_JUDGMENTS);
    const claimed = new Set(MACHINE_VERIFIERS.flatMap((v) => v.itemIds));
    const violated = [...lawyer].filter((key) => claimed.has(key));
    expect(violated, `主观项被机器验证器认领：${violated.join("、")}`).toEqual([]);
  });

  it("每一项都有定级依据（rationale 非空）", () => {
    const bad = Object.entries(ITEM_JUDGMENTS)
      .filter(([, j]) => !j.rationale?.trim())
      .map(([k]) => k);
    expect(bad, `缺 rationale：${bad.join("、")}`).toEqual([]);
  });
});

describe("G0 覆盖诚实：machine 占比按实测登记，不靠改分级凑数", () => {
  it("machine 项数 <= 30（占比约 14%，如需提高必须走 G4 写规则而非改分级）", () => {
    const machineCount = Object.values(ITEM_JUDGMENTS).filter((j) => j.tier === "machine").length;
    // 上界：防止有人为了"看起来机械化"把主观项标成 machine。
    // 下界：防止误删分级导致覆盖率悄悄归零。
    expect(machineCount).toBeGreaterThanOrEqual(18);
    expect(machineCount).toBeLessThanOrEqual(30);
  });

  it("三级都有项（off / shadow / on 三条路径都会被真实走到）", () => {
    const tiers = new Set(Object.values(ITEM_JUDGMENTS).map((j) => j.tier));
    expect([...tiers].toSorted()).toEqual(["judge", "lawyer", "machine"]);
  });
});
