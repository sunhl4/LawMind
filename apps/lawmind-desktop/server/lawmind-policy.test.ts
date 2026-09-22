import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyLawMindPolicyToEnv,
  loadAndApplyLawMindPolicy,
  readLawMindPolicyFile,
  resolveChatAllowWebSearch,
} from "./lawmind-policy.js";

describe("lawmind-policy", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-pol-"));
    delete process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH;
    delete process.env.LAWMIND_RETRIEVAL_MODE;
    delete process.env.LAWMIND_EDITION;
    process.env.LAWMIND_ENABLE_COLLABORATION = "true";
  });
  afterEach(() => {
    delete process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH;
    delete process.env.LAWMIND_RETRIEVAL_MODE;
    delete process.env.LAWMIND_EDITION;
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

  it("applyLawMindPolicyToEnv sets LAWMIND_EDITION when policy edition is valid", () => {
    const applied = applyLawMindPolicyToEnv({
      schemaVersion: 1,
      edition: "firm",
    });
    expect(applied).toContain("edition");
    expect(process.env.LAWMIND_EDITION).toBe("firm");
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

  it("keeps compose 联网 on in research/readonly unless policy forces it off", () => {
    expect(resolveChatAllowWebSearch(true)).toBe(true);
    expect(resolveChatAllowWebSearch(false)).toBe(false);
    process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH = "1";
    expect(resolveChatAllowWebSearch(true)).toBe(false);
  });

  it("treats egressMode offline as forcing web search off", () => {
    const applied = applyLawMindPolicyToEnv({ schemaVersion: 1, egressMode: "offline" });
    expect(applied).toContain("egressOffline");
    expect(process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH).toBe("1");
    expect(resolveChatAllowWebSearch(true)).toBe(false);
  });

  it("does not force web search off for the allowlisted mode", () => {
    // 律所日常：放行官方法规站即可，联网保持可用（范围由 networkAllowlist 限定）。
    const applied = applyLawMindPolicyToEnv({
      schemaVersion: 1,
      egressMode: "allowlisted",
      allowWebSearch: true,
      networkAllowlist: ["npc.gov.cn"],
    });
    expect(applied).not.toContain("forceNoWebSearch");
    expect(applied).not.toContain("egressOffline");
    expect(process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH).toBeUndefined();
    expect(resolveChatAllowWebSearch(true)).toBe(true);
  });

  it("keeps the legacy highSecurityMode key working as offline", () => {
    const applied = applyLawMindPolicyToEnv({ schemaVersion: 1, highSecurityMode: true });
    expect(applied).toContain("egressOffline");
    expect(process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH).toBe("1");
  });
});
