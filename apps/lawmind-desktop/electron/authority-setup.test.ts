import { describe, expect, it } from "vitest";
import {
  AUTHORITY_API_KEY_ENV,
  PKULAW_DEFAULT_CASE_ENDPOINT,
  PKULAW_DEFAULT_LAW_ENDPOINT,
  YUANDIAN_API_KEY_ENV,
  YUANDIAN_DEFAULT_ENDPOINT,
  authorityProviderUsesStoredKey,
  authorityProviderUsesYuandianKey,
  placeAuthorityApiKey,
  planAuthoritySave,
  validateAuthoritySetupUrl,
} from "./authority-setup.mjs";

describe("planAuthoritySave", () => {
  it("fills the official law and case gateways when the lawyer only pastes a token", () => {
    const plan = planAuthoritySave({ provider: "pkulaw", apiKey: "tok-1" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.assignments.LAWMIND_AUTHORITY_PROVIDER).toBe("pkulaw");
    expect(plan.assignments.LAWMIND_AUTHORITY_ENDPOINT).toBe(PKULAW_DEFAULT_LAW_ENDPOINT);
    expect(plan.assignments.LAWMIND_PKULAW_CASE_ENDPOINT).toBe(PKULAW_DEFAULT_CASE_ENDPOINT);
    expect(plan.assignments.LAWMIND_PKULAW_MODE).toBe("mcp_tools_call");
    expect(plan.assignments.LAWMIND_PKULAW_MCP_LAW_TOOL).toBe("search_article");
    expect(plan.assignments.LAWMIND_PKULAW_MCP_CASE_TOOL).toBe("search_case");
    expect(plan.storeApiKey).toBe("tok-1");
    expect(plan.removeKeys).not.toContain(AUTHORITY_API_KEY_ENV);
  });

  it("keeps a saved token when the field is left blank", () => {
    const plan = planAuthoritySave({ provider: "pkulaw", hasExistingKey: true });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.storeApiKey).toBe("");
  });

  it("refuses to connect without a token", () => {
    const plan = planAuthoritySave({ provider: "pkulaw" });
    expect(plan.ok).toBe(false);
    if (plan.ok) {
      return;
    }
    expect(plan.error).toContain("访问令牌");
  });

  it("drops gateway mode when the address is not the official gateway", () => {
    const plan = planAuthoritySave({
      provider: "pkulaw",
      apiKey: "tok",
      lawEndpoint: "https://vendor.example/search",
      caseEndpoint: "https://vendor.example/cases",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.assignments.LAWMIND_PKULAW_MODE).toBeUndefined();
    expect(plan.removeKeys).toContain("LAWMIND_PKULAW_MODE");
  });

  it("switches back to open law and clears commercial addresses", () => {
    const plan = planAuthoritySave({ provider: "open" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.assignments).toEqual({ LAWMIND_AUTHORITY_PROVIDER: "open" });
    expect(plan.removeKeys).toContain("LAWMIND_AUTHORITY_ENDPOINT");
    expect(plan.removeKeys).toContain("LAWMIND_PKULAW_CASE_ENDPOINT");
    expect(plan.removeKeys).not.toContain(AUTHORITY_API_KEY_ENV);
  });

  it("rejects a token embedded in the address", () => {
    const plan = planAuthoritySave({
      provider: "pkulaw",
      apiKey: "tok",
      lawEndpoint: "https://user:secret@apim-gateway.pkulaw.com/mcp-law-search-service",
    });
    expect(plan.ok).toBe(false);
  });

  it("rejects loopback, cleartext, and fragment addresses", () => {
    expect(validateAuthoritySetupUrl("http://127.0.0.1/search").ok).toBe(false);
    expect(validateAuthoritySetupUrl("https://10.0.0.8/search").ok).toBe(false);
    expect(validateAuthoritySetupUrl("http://apim-gateway.pkulaw.com/mcp-law-search-service").ok).toBe(
      false,
    );
    const hashed = validateAuthoritySetupUrl(`${PKULAW_DEFAULT_LAW_ENDPOINT}#token`);
    expect(hashed.ok).toBe(false);
  });
});

describe("placeAuthorityApiKey", () => {
  it("keeps the token for the keychain when encryption is available", () => {
    const plan = planAuthoritySave({ provider: "pkulaw", apiKey: "tok-1" });
    const placed = placeAuthorityApiKey(plan, { keychainAvailable: true });
    expect(placed.ok).toBe(true);
    if (!placed.ok) {
      return;
    }
    expect(placed.storeApiKey).toBe("tok-1");
    expect(placed.assignments.LAWMIND_AUTHORITY_API_KEY).toBeUndefined();
  });

  it("writes the token into the user env plan when the keychain cannot take it", () => {
    const plan = planAuthoritySave({ provider: "pkulaw", apiKey: "tok-fresh-clone" });
    const placed = placeAuthorityApiKey(plan, { keychainAvailable: false });
    expect(placed.ok).toBe(true);
    if (!placed.ok) {
      return;
    }
    expect(placed.storeApiKey).toBe("");
    expect(placed.assignments.LAWMIND_AUTHORITY_API_KEY).toBe("tok-fresh-clone");
    expect(placed.assignments.LAWMIND_AUTHORITY_PROVIDER).toBe("pkulaw");
    expect(placed.removeKeys).not.toContain(AUTHORITY_API_KEY_ENV);
  });

  it("leaves an already saved env token in place when the field is blank and the keychain is down", () => {
    const plan = planAuthoritySave({ provider: "pkulaw", hasExistingKey: true });
    const placed = placeAuthorityApiKey(plan, { keychainAvailable: false });
    expect(placed.ok).toBe(true);
    if (!placed.ok) {
      return;
    }
    expect(placed.storeApiKey).toBe("");
    expect(placed.assignments.LAWMIND_AUTHORITY_API_KEY).toBeUndefined();
  });

  it("保已有元典 token：保存法宝不把 yuandian,pkulaw 覆盖成单值 pkulaw", () => {
    const plan = planAuthoritySave({
      provider: "pkulaw",
      apiKey: "tok-1",
      existingProvider: "yuandian",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.assignments.LAWMIND_AUTHORITY_PROVIDER).toBe("yuandian,pkulaw");
  });

  it("已有元典别名同样保留；无元典则维持单值", () => {
    const plan = planAuthoritySave({ provider: "pkulaw", hasExistingKey: true, existingProvider: "元典智库" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.assignments.LAWMIND_AUTHORITY_PROVIDER).toBe("yuandian,pkulaw");
    const planNoYuandian = planAuthoritySave({ provider: "pkulaw", hasExistingKey: true, existingProvider: "yuandian,pkulaw" });
    expect(planNoYuandian.ok).toBe(true);
    if (!planNoYuandian.ok) {
      return;
    }
    // 不重复追加，幂等
    expect(planNoYuandian.assignments.LAWMIND_AUTHORITY_PROVIDER).toBe("yuandian,pkulaw");
  });
});

describe("元典 save plan", () => {
  it("写独立 env、默认端点，且不碰法宝端点", () => {
    const plan = planAuthoritySave({ provider: "yuandian", apiKey: "yd-1" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.provider).toBe("yuandian");
    expect(plan.keyEnv).toBe(YUANDIAN_API_KEY_ENV);
    expect(plan.assignments.LAWMIND_AUTHORITY_PROVIDER).toBe("yuandian");
    expect(plan.assignments.LAWMIND_YUANDIAN_ENDPOINT).toBe(YUANDIAN_DEFAULT_ENDPOINT);
    expect(plan.assignments.LAWMIND_AUTHORITY_ENDPOINT).toBeUndefined();
    expect(plan.assignments[AUTHORITY_API_KEY_ENV]).toBeUndefined();
    expect(plan.storeApiKey).toBe("yd-1");
  });

  it("已有法宝时保存元典 → yuandian,pkulaw 双库", () => {
    const plan = planAuthoritySave({
      provider: "yuandian",
      apiKey: "yd-1",
      existingProvider: "pkulaw",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.assignments.LAWMIND_AUTHORITY_PROVIDER).toBe("yuandian,pkulaw");
  });

  it("没有 Key 且无存量时拒绝，避免写入一个连不上的库", () => {
    const plan = planAuthoritySave({ provider: "yuandian" });
    expect(plan.ok).toBe(false);
  });

  it("keychain 不可用时元典 Key 落到独立 env（不是法宝那个）", () => {
    const plan = planAuthoritySave({ provider: "yuandian", apiKey: "yd-plain" });
    const placed = placeAuthorityApiKey(plan, { keychainAvailable: false });
    expect(placed.ok).toBe(true);
    if (!placed.ok) {
      return;
    }
    expect(placed.storeApiKey).toBe("");
    expect(placed.assignments.LAWMIND_YUANDIAN_API_KEY).toBe("yd-plain");
    expect(placed.assignments[AUTHORITY_API_KEY_ENV]).toBeUndefined();
  });

  it("留空时保留已保存的元典 Key，不写入空值", () => {
    const plan = planAuthoritySave({ provider: "yuandian", hasExistingYuandianKey: true });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.storeApiKey).toBe("");
  });

  it("已有元典时保存法宝 → 反向也保留 yuandian,pkulaw", () => {
    const plan = planAuthoritySave({
      provider: "pkulaw",
      apiKey: "pku-1",
      existingProvider: "yuandian",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.assignments.LAWMIND_AUTHORITY_PROVIDER).toBe("yuandian,pkulaw");
  });

  it("不把 generic/lexis 端点静默改写成 pkulaw", () => {
    for (const existingProvider of ["generic", "lexis", "lexisnexis"]) {
      const plan = planAuthoritySave({ provider: "yuandian", apiKey: "yd", existingProvider });
      expect(plan.ok).toBe(true);
      if (!plan.ok) {
        continue;
      }
      // 共用钥匙串账户不等于同一适配器：generic/lexis 改写成 pkulaw 会改变请求形态。
      expect(plan.assignments.LAWMIND_AUTHORITY_PROVIDER).toBe("yuandian");
    }
  });

  it("keychain 可用时元典 Key 交给钥匙串，不写明文", () => {
    const plan = planAuthoritySave({ provider: "yuandian", apiKey: "yd-1" });
    const placed = placeAuthorityApiKey(plan, { keychainAvailable: true });
    expect(placed.ok).toBe(true);
    if (!placed.ok) {
      return;
    }
    expect(placed.storeApiKey).toBe("yd-1");
    expect(placed.assignments.LAWMIND_YUANDIAN_API_KEY).toBeUndefined();
  });
});

describe("authorityProviderUsesYuandianKey", () => {
  it("多库列表里含元典就注入元典 Key", () => {
    expect(authorityProviderUsesYuandianKey("yuandian")).toBe(true);
    expect(authorityProviderUsesYuandianKey("yuandian,pkulaw")).toBe(true);
    expect(authorityProviderUsesYuandianKey("元典智库,北大法宝")).toBe(true);
    expect(authorityProviderUsesYuandianKey("pkulaw")).toBe(false);
    expect(authorityProviderUsesYuandianKey("")).toBe(false);
  });
});

describe("authorityProviderUsesStoredKey", () => {
  it("injects a stored token only for commercial providers", () => {
    expect(authorityProviderUsesStoredKey("pkulaw")).toBe(true);
    expect(authorityProviderUsesStoredKey("法宝")).toBe(true);
    expect(authorityProviderUsesStoredKey("open")).toBe(false);
    expect(authorityProviderUsesStoredKey("")).toBe(false);
  });

  it("multi-vendor list（元典 + 北大法宝同用）：法宝 key 仍然注入", () => {
    expect(authorityProviderUsesStoredKey("yuandian,pkulaw")).toBe(true);
    expect(authorityProviderUsesStoredKey("yuandian, 法宝")).toBe(true);
    // 单元典：走独立的 LAWMIND_YUANDIAN_API_KEY（.env.lawmind），不共用这笔账
    expect(authorityProviderUsesStoredKey("yuandian")).toBe(false);
    expect(authorityProviderUsesStoredKey("元典,pkulaw")).toBe(true);
    expect(authorityProviderUsesStoredKey("unknown-vendor")).toBe(false);
  });
});
