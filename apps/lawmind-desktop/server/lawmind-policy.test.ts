import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyLawMindPolicyToEnv,
  loadAndApplyLawMindPolicy,
  readLawMindPolicyFile,
} from "./lawmind-policy.js";

describe("lawmind-policy", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-pol-"));
    delete process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH;
    delete process.env.LAWMIND_RETRIEVAL_MODE;
    process.env.LAWMIND_ENABLE_COLLABORATION = "true";
  });
  afterEach(() => {
    delete process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH;
    delete process.env.LAWMIND_RETRIEVAL_MODE;
    delete process.env.LAWMIND_ENABLE_COLLABORATION;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("readLawMindPolicyFile returns loaded false when missing", () => {
    expect(readLawMindPolicyFile(tmp).loaded).toBe(false);
  });

  it("loads valid policy file", () => {
    fs.writeFileSync(
      path.join(tmp, "lawmind.policy.json"),
      JSON.stringify({ schemaVersion: 1, allowWebSearch: false, retrievalMode: "dual" }),
      "utf8",
    );
    const r = readLawMindPolicyFile(tmp);
    expect(r.loaded).toBe(true);
    if (r.loaded) {
      expect(r.policy.allowWebSearch).toBe(false);
      expect(r.policy.retrievalMode).toBe("dual");
    }
  });

  it("applyLawMindPolicyToEnv sets flags", () => {
    const applied = applyLawMindPolicyToEnv({
      schemaVersion: 1,
      allowWebSearch: false,
      retrievalMode: "single",
      enableCollaboration: false,
    });
    expect(applied).toContain("forceNoWebSearch");
    expect(applied).toContain("retrievalMode");
    expect(applied).toContain("enableCollaboration");
    expect(process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH).toBe("1");
    expect(process.env.LAWMIND_RETRIEVAL_MODE).toBe("single");
    expect(process.env.LAWMIND_ENABLE_COLLABORATION).toBe("false");
  });

  it("loadAndApplyLawMindPolicy integrates", () => {
    fs.writeFileSync(
      path.join(tmp, "lawmind.policy.json"),
      JSON.stringify({ schemaVersion: 1, allowWebSearch: false }),
      "utf8",
    );
    const st = loadAndApplyLawMindPolicy(tmp);
    expect(st.loaded).toBe(true);
    if (st.loaded) {
      expect(st.applied).toContain("forceNoWebSearch");
    }
    expect(process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH).toBe("1");
  });
});
