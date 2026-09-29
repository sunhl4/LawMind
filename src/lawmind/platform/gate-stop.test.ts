/**
 * 门禁「到此为止」的识别 + 自动办件派单台账（防重复派单）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  baselinePathFromInstruction,
  clearBlockedDispatch,
  dispatchFingerprint,
  findBlockedDispatch,
  formatBlockedDispatchNote,
  listDispatchLedger,
  markDispatchBlocked,
  syncDispatchLedgerForTurn,
} from "./automation-dispatch-ledger.js";
import { detectGateStop, formatGateStopSummary } from "./gate-stop.js";

const dirs: string[] = [];

function tmpWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-gate-stop-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("detectGateStop", () => {
  it("独立审稿轮次用尽 → 停", () => {
    const stop = detectGateStop({
      gateDecisions: [
        {
          gate: "legal_guardian_gate",
          decision: "block",
          reason: "验收已停：独立审稿未过（缺口交律师）",
        },
      ],
      sameTurnVerify: {
        issues: [
          {
            code: "guardian_fail",
            terminal: true,
            message: "独立审稿已 2 轮未过。请把缺口交给律师，不要继续为过审而改稿。",
          },
        ],
      },
    });
    expect(stop.stopped).toBe(true);
    expect(stop.codes).toContain("guardian_fail");
    expect(stop.gaps?.[0]).toContain("交给律师");
    expect(formatGateStopSummary(stop)).toContain("没有出 Word");
    expect(formatGateStopSummary(stop)).not.toContain("独立审稿");
    expect(formatGateStopSummary(stop)).not.toContain("验证器");
  });

  it("普通 block（可补改）不算停；无判定也不算", () => {
    expect(
      detectGateStop({
        gateDecisions: [
          {
            gate: "legal_guardian_gate",
            decision: "block",
            reason: "验收未过：引用对不上来源，请再交 apply_surgical_edits",
          },
        ],
      }).stopped,
    ).toBe(false);
    expect(detectGateStop({}).stopped).toBe(false);
    // guardian_exhausted 即使只出现在 reason 里也认
    expect(
      detectGateStop({
        gateDecisions: [
          {
            gate: "legal_guardian_gate",
            decision: "block",
            reason: "[guardian_exhausted] 2 轮未过",
          },
        ],
      }).stopped,
    ).toBe(true);
  });
});

describe("automation dispatch ledger", () => {
  it("同一份材料门禁停下后不再重复派；材料变了或律师继续则恢复", () => {
    const ws = tmpWs();
    const rel = "cases/m/国浩审-合作协议.doc";
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
    fs.writeFileSync(path.join(ws, rel), "第一版");

    const fp = dispatchFingerprint(ws, rel);
    expect(
      findBlockedDispatch(ws, { matterId: "m", relativePath: rel, fingerprint: fp }),
    ).toBeUndefined();

    markDispatchBlocked(ws, {
      matterId: "m",
      relativePath: rel,
      reason: "guardian_exhausted",
      automationId: "a-1",
    });
    const blocked = findBlockedDispatch(ws, { matterId: "m", relativePath: rel, fingerprint: fp });
    expect(blocked?.state).toBe("blocked");
    expect(formatBlockedDispatchNote(blocked!)).toContain("不再重复派单");
    // 幂等
    expect(markDispatchBlocked(ws, { matterId: "m", relativePath: rel, reason: "again" })).toBe(
      false,
    );

    // 材料内容变了 → 指纹变 → 恢复派单
    fs.writeFileSync(path.join(ws, rel), "第二版（对方回了新稿）");
    const fp2 = dispatchFingerprint(ws, rel);
    expect(fp2).not.toBe(fp);
    expect(
      findBlockedDispatch(ws, { matterId: "m", relativePath: rel, fingerprint: fp2 }),
    ).toBeUndefined();

    // 律师继续推进（正常收口）→ 解除拦截
    expect(clearBlockedDispatch(ws, { matterId: "m", relativePath: rel })).toBe(1);
    expect(
      findBlockedDispatch(ws, { matterId: "m", relativePath: rel, fingerprint: fp }),
    ).toBeUndefined();
    expect(listDispatchLedger(ws)).toHaveLength(0);
  });

  it("门禁停下走 syncDispatchLedgerForTurn 记账，正常收口解除", () => {
    const ws = tmpWs();
    const rel = "cases/m/协议.doc";
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
    fs.writeFileSync(path.join(ws, rel), "x");
    const instruction = `【邮件合同审阅改稿 · 短路径】\n默认 contract_edit_baseline_path=\`${rel}\``;
    expect(baselinePathFromInstruction(instruction)).toBe(rel);

    syncDispatchLedgerForTurn({
      workspaceDir: ws,
      matterId: "m",
      instruction,
      gateStop: true,
      reason: "guardian_exhausted",
    });
    const fp = dispatchFingerprint(ws, rel);
    expect(
      findBlockedDispatch(ws, { matterId: "m", relativePath: rel, fingerprint: fp }),
    ).toBeTruthy();

    syncDispatchLedgerForTurn({
      workspaceDir: ws,
      matterId: "m",
      instruction,
      gateStop: false,
    });
    expect(
      findBlockedDispatch(ws, { matterId: "m", relativePath: rel, fingerprint: fp }),
    ).toBeUndefined();
  });

  it("指令没点名基线时什么都不做（不猜）", () => {
    const ws = tmpWs();
    expect(baselinePathFromInstruction("随便聊聊这份合同")).toBe("");
    syncDispatchLedgerForTurn({
      workspaceDir: ws,
      matterId: "m",
      instruction: "随便聊聊这份合同",
      gateStop: true,
    });
    expect(listDispatchLedger(ws)).toHaveLength(0);
  });
});
