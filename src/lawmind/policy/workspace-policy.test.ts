import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_MANDATORY_RULES_MAX_CHARS,
  readWorkspacePolicyFile,
  resolveAgentMandatoryRulesForPrompt,
  resolveAgentMaxToolCallsPerTurn,
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
