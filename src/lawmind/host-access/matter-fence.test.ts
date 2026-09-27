import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import { updateMatterProfile } from "../application/services/matter-write-service.js";
import { partiesConflict, readMatterParties } from "./matter-fence.js";

describe("readMatterParties", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const dir of tmp) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers matter.json parties over CASE.md for ethics-wall identity", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-fence-parties-"));
    tmp.push(workspaceDir);
    createMatterIfMissing(workspaceDir, { matterId: "m-json", title: "JSON 案" });
    await updateMatterProfile(workspaceDir, {
      matterId: "m-json",
      parties: [
        { partyId: "p-client", name: "甲公司", role: "client" },
        { partyId: "p-counterparty", name: "乙公司", role: "counterparty" },
      ],
    });
    fs.mkdirSync(path.join(workspaceDir, "cases", "m-json"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, "cases", "m-json", "CASE.md"),
      "## 1. 基本信息\n\n- 客户 / clientId: 错误客户\n- 对方当事人: 错误对方\n",
    );
    expect(readMatterParties(workspaceDir, "m-json")).toEqual({
      clientId: "甲公司",
      counterparty: "乙公司",
    });
  });

  it("falls back to CASE.md when JSON has no identity", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-fence-case-"));
    tmp.push(workspaceDir);
    fs.mkdirSync(path.join(workspaceDir, "cases", "m-case"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, "cases", "m-case", "CASE.md"),
      "## 1. 基本信息\n\n- 客户 / clientId: 甲公司\n- 对方当事人: 乙公司\n",
    );
    expect(readMatterParties(workspaceDir, "m-case")).toEqual({
      clientId: "甲公司",
      counterparty: "乙公司",
    });
  });

  it("reads party names when the case file has no client id", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-fence-names-"));
    tmp.push(workspaceDir);
    fs.mkdirSync(path.join(workspaceDir, "cases", "m-names"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, "cases", "m-names", "CASE.md"),
      [
        "## 1. 基本信息",
        "",
        "- 诉讼地位: 乙方",
        "",
        "## 2. 当事人",
        "",
        "- 甲方: 客户甲",
        "- 乙方: 客户乙",
        "",
      ].join("\n"),
    );
    expect(readMatterParties(workspaceDir, "m-names")).toEqual({
      clientId: "客户乙",
      counterparty: "客户甲",
    });
    expect(
      partiesConflict(readMatterParties(workspaceDir, "m-names"), {
        clientId: "客户甲",
        counterparty: "客户乙",
      }),
    ).toBe(true);
    fs.writeFileSync(
      path.join(workspaceDir, "cases", "m-names", "CASE.md"),
      [
        "## 1. 基本信息",
        "",
        "- 诉讼地位: 甲乙双方",
        "",
        "## 2. 当事人",
        "",
        "- 甲方: 客户甲",
        "- 乙方: 客户乙",
        "",
      ].join("\n"),
    );
    expect(readMatterParties(workspaceDir, "m-names")).toEqual({});
    fs.writeFileSync(
      path.join(workspaceDir, "cases", "m-names", "CASE.md"),
      [
        "## 1. 基本信息",
        "",
        "- 诉讼地位: 甲方或乙方",
        "",
        "## 2. 当事人",
        "",
        "- 甲方: 客户甲",
        "- 乙方: 客户乙",
        "",
      ].join("\n"),
    );
    expect(readMatterParties(workspaceDir, "m-names")).toEqual({});
  });

  it("flags opposing identity as a wall conflict", () => {
    expect(
      partiesConflict(
        { clientId: "甲公司", counterparty: "乙公司" },
        { clientId: "乙公司", counterparty: "甲公司" },
      ),
    ).toBe(true);
    expect(
      partiesConflict(
        { clientId: "甲公司", counterparty: "乙公司" },
        { clientId: "甲公司", counterparty: "丙公司" },
      ),
    ).toBe(false);
  });
});
