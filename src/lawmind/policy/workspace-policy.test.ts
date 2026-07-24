import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_MANDATORY_RULES_MAX_CHARS,
  readWorkspacePolicyFile,
  resolveAgentMandatoryRulesForPrompt,
  resolveAgentMaxHistoryMessages,
  resolveAgentMaxToolCallsPerTurn,
  resolveMatterMandatoryRulesForPrompt,
  workspacePolicyPath,
} from "./workspace-policy.js";

describe("readWorkspacePolicyFile", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when file missing", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-pol-"));
    expect(readWorkspacePolicyFile(dir)).toBeNull();
  });

  it("parses valid policy", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-pol-"));
    const p = path.join(dir, "lawmind.policy.json");
    fs.writeFileSync(
      p,
      JSON.stringify({
        schemaVersion: 1,
        edition: "firm",
        benchmarkGateMinScore: 0.72,
      }),
      "utf8",
    );
    const pol = readWorkspacePolicyFile(dir);
    expect(pol?.edition).toBe("firm");
    expect(pol?.benchmarkGateMinScore).toBeCloseTo(0.72, 5);
  });

  it("returns null when schemaVersion missing", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-pol-"));
    fs.writeFileSync(path.join(dir, "lawmind.policy.json"), JSON.stringify({}), "utf8");
    expect(readWorkspacePolicyFile(dir)).toBeNull();
  });

  it("workspacePolicyPath resolves under workspace", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-pol-"));
    expect(workspacePolicyPath(dir)).toBe(path.join(path.resolve(dir), "lawmind.policy.json"));
  });
});

describe("resolveAgentMandatoryRulesForPrompt", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns inactive when policy null", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-mr-"));
    expect(resolveAgentMandatoryRulesForPrompt(dir, null)).toEqual({
      active: false,
      truncated: false,
      text: "",
    });
  });

  it("uses inline agentMandatoryRules", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-mr-"));
    const r = resolveAgentMandatoryRulesForPrompt(dir, {
      schemaVersion: 1,
      agentMandatoryRules: "  红线A  ",
    });
    expect(r.active).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("红线A");
  });

  it("reads from agentMandatoryRulesPath under workspace", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-mr-"));
    fs.mkdirSync(path.join(dir, "lawmind"), { recursive: true });
    fs.writeFileSync(path.join(dir, "lawmind/rules.md"), "来自文件\n", "utf8");
    const r = resolveAgentMandatoryRulesForPrompt(dir, {
      schemaVersion: 1,
      agentMandatoryRulesPath: "lawmind/rules.md",
      agentMandatoryRules: "fallback",
    });
    expect(r.text).toBe("来自文件");
    expect(r.active).toBe(true);
  });

  it("falls back to inline when path escapes workspace", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-mr-"));
    const r = resolveAgentMandatoryRulesForPrompt(dir, {
      schemaVersion: 1,
      agentMandatoryRulesPath: "../outside.md",
      agentMandatoryRules: "safe-inline",
    });
    expect(r.text).toBe("safe-inline");
  });

  it("truncates long content", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-mr-"));
    const long = "x".repeat(AGENT_MANDATORY_RULES_MAX_CHARS + 100);
    const r = resolveAgentMandatoryRulesForPrompt(dir, {
      schemaVersion: 1,
      agentMandatoryRules: long,
    });
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(AGENT_MANDATORY_RULES_MAX_CHARS);
  });
});

describe("resolveMatterMandatoryRulesForPrompt", () => {
  let dir = "";

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("reads matters/<id>/RULES.md", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-matter-rules-"));
    fs.mkdirSync(path.join(dir, "matters", "m1"), { recursive: true });
    fs.writeFileSync(path.join(dir, "matters", "m1", "RULES.md"), "本案不得对外承诺胜诉。\n");
    const r = resolveMatterMandatoryRulesForPrompt(dir, "m1");
    expect(r.active).toBe(true);
    expect(r.text).toContain("不得对外承诺胜诉");
  });

  it("falls back to cases/<id>/RULES.md", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-matter-rules-"));
    fs.mkdirSync(path.join(dir, "cases", "c1"), { recursive: true });
    fs.writeFileSync(path.join(dir, "cases", "c1", "RULES.md"), "优先引用合同原文。\n");
    const r = resolveMatterMandatoryRulesForPrompt(dir, "c1");
    expect(r.active).toBe(true);
    expect(r.text).toContain("合同原文");
  });
});

describe("resolveAgentMaxHistoryMessages (F6)", () => {
  it("uses policy value when set (clamped)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-mhist-"));
    try {
      fs.writeFileSync(
        path.join(dir, "lawmind.policy.json"),
        JSON.stringify({ schemaVersion: 1, agentMaxHistoryMessages: 40 }),
        "utf8",
      );
      expect(resolveAgentMaxHistoryMessages(dir, 100)).toBe(40);
      fs.writeFileSync(
        path.join(dir, "lawmind.policy.json"),
        JSON.stringify({ schemaVersion: 1, agentMaxHistoryMessages: 999 }),
        "utf8",
      );
      expect(resolveAgentMaxHistoryMessages(dir, 100)).toBe(200);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to envelope default when policy unset", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-mhist2-"));
    try {
      expect(resolveAgentMaxHistoryMessages(dir, 88)).toBe(88);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveAgentMaxToolCallsPerTurn", () => {
  it("uses policy value when set", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-mtc-"));
    const prev = process.env.LAWMIND_AGENT_MAX_TOOL_CALLS;
    try {
      delete process.env.LAWMIND_AGENT_MAX_TOOL_CALLS;
      fs.writeFileSync(
        path.join(dir, "lawmind.policy.json"),
        JSON.stringify({ schemaVersion: 1, agentMaxToolCallsPerTurn: 8 }),
        "utf8",
      );
      expect(resolveAgentMaxToolCallsPerTurn(dir)).toBe(8);
    } finally {
      if (prev !== undefined) {
        process.env.LAWMIND_AGENT_MAX_TOOL_CALLS = prev;
      } else {
        delete process.env.LAWMIND_AGENT_MAX_TOOL_CALLS;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to env when policy missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-mtc2-"));
    const prev = process.env.LAWMIND_AGENT_MAX_TOOL_CALLS;
    try {
      process.env.LAWMIND_AGENT_MAX_TOOL_CALLS = "12";
      expect(resolveAgentMaxToolCallsPerTurn(dir)).toBe(12);
    } finally {
      if (prev !== undefined) {
        process.env.LAWMIND_AGENT_MAX_TOOL_CALLS = prev;
      } else {
        delete process.env.LAWMIND_AGENT_MAX_TOOL_CALLS;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
