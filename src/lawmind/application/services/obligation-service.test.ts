import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { amountMinorFromText, recordObligation } from "./obligation-service.js";

describe("amountMinorFromText", () => {
  it("reads a plain yuan amount into fen and leaves approximate wording unread", () => {
    expect(amountMinorFromText("32,100 元")).toBe(3_210_000);
    expect(amountMinorFromText("10.5元")).toBe(1050);
    expect(amountMinorFromText("约 30 万元")).toBeUndefined();
  });
});

describe("recordObligation", () => {
  let workspaceDir: string;

  afterEach(() => {
    if (workspaceDir) {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("keeps the original amount wording when it is not a plain number", () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-obligation-"));
    const record = recordObligation(workspaceDir, {
      matterId: "m-pay",
      title: "支付第二期价款",
      obligor: "买方",
      amountText: "约 30 万元",
      sourceQuote: "买方应于验收后十日内支付第二期价款约 30 万元。",
    });
    expect(record.amountText).toBe("约 30 万元");
    expect(record.amountMinor).toBeUndefined();
    expect(record.sourceQuote).toContain("第二期价款");
    expect(record.status).toBe("open");
  });
});
