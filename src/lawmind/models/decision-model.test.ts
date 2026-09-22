import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSystemOneRequestBody,
  createTypesafeDecisionModel,
  getDecisionModel,
  parseSystemOneAnswers,
  resolveDecisionModel,
  type DecisionModelConfig,
  type DecisionQuestion,
} from "./decision-model.js";

const dirs: string[] = [];

function makeWorkspace(policy?: Record<string, unknown>): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-dm-"));
  dirs.push(ws);
  if (policy) {
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      JSON.stringify({ schemaVersion: 1, ...policy }, null, 2),
      "utf8",
    );
  }
  return ws;
}

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
  vi.unstubAllGlobals();
});

const CFG: DecisionModelConfig = {
  kind: "typesafe",
  baseUrl: "https://api.typesafe.ai",
  apiKey: "sk-test",
  model: "jev-latest",
  timeoutMs: 5000,
};

describe("P5 门禁 ①：默认 off（不存在「配了 key 就自动开」）", () => {
  it("空工作区 → off / disabled_by_default", () => {
    const r = resolveDecisionModel({ workspaceDir: makeWorkspace(), env: {} });
    expect(r.mode).toBe("off");
    expect(r.reason).toBe("disabled_by_default");
  });

  it("配了完整凭据但没写 mode → 仍然 off（默认关是关键）", () => {
    const r = resolveDecisionModel({
      workspaceDir: makeWorkspace(),
      env: {
        LAWMIND_DECISION_MODEL_BASE_URL: "https://api.typesafe.ai",
        LAWMIND_DECISION_MODEL_API_KEY: "sk-test",
        LAWMIND_DECISION_MODEL_ID: "jev-latest",
      },
    });
    expect(r.mode).toBe("off");
    expect(r.reason).toBe("disabled_by_default");
  });

  it("mode=off 显式写也不行（与未写等价）", () => {
    const ws = makeWorkspace({
      decisionModelMode: "off",
      decisionModelBaseUrl: "https://api.typesafe.ai",
      decisionModelApiKey: "sk-test",
      decisionModelId: "jev",
    });
    expect(resolveDecisionModel({ workspaceDir: ws, env: {} }).mode).toBe("off");
  });

  it("getDecisionModel 在 off 时返回 undefined 端口（调用方必须能处理）", () => {
    const r = getDecisionModel({ workspaceDir: makeWorkspace(), env: {} });
    expect(r.model).toBeUndefined();
    expect(r.mode).toBe("off");
  });
});

describe("P5 门禁 ②：egressMode=offline 优先于一切", () => {
  it("offline + mode=on + 完整凭据 → 仍 off（一票否决）", () => {
    const ws = makeWorkspace({
      egressMode: "offline",
      decisionModelMode: "on",
      decisionModelBaseUrl: "https://api.typesafe.ai",
      decisionModelApiKey: "sk-test",
      decisionModelId: "jev",
    });
    const r = resolveDecisionModel({ workspaceDir: ws, env: {} });
    expect(r.mode).toBe("off");
    expect(r.reason).toBe("egress_offline");
  });

  it("旧键 highSecurityMode=true（等价 offline）同样一票否决", () => {
    const ws = makeWorkspace({
      highSecurityMode: true,
      decisionModelMode: "on",
      decisionModelBaseUrl: "https://api.typesafe.ai",
      decisionModelApiKey: "sk-test",
      decisionModelId: "jev",
    });
    expect(resolveDecisionModel({ workspaceDir: ws, env: {} }).reason).toBe("egress_offline");
  });

  it("offline 时连配置都不读 —— key 写不写都不影响（避免「配了以为能用」）", () => {
    const ws = makeWorkspace({ egressMode: "offline" });
    const r = resolveDecisionModel({
      workspaceDir: ws,
      env: {
        LAWMIND_DECISION_MODEL_MODE: "on",
        LAWMIND_DECISION_MODEL_BASE_URL: "https://api.typesafe.ai",
        LAWMIND_DECISION_MODEL_API_KEY: "sk-test",
        LAWMIND_DECISION_MODEL_ID: "jev",
      },
    });
    expect(r.mode).toBe("off");
    expect(r.reason).toBe("egress_offline");
  });

  it("open / allowlisted 不阻断（它们本来就允许出站）", () => {
    for (const egressMode of ["open", "allowlisted"] as const) {
      const ws = makeWorkspace({
        egressMode,
        decisionModelMode: "on",
        decisionModelBaseUrl: "https://api.typesafe.ai",
        decisionModelApiKey: "sk-test",
        decisionModelId: "jev",
      });
      expect(resolveDecisionModel({ workspaceDir: ws, env: {} }).mode).toBe("on");
    }
  });
});

describe("P5 门禁 ③：凭据不全 → 不产出半配置端口", () => {
  it("缺 key → off / missing_credentials", () => {
    const ws = makeWorkspace({
      decisionModelMode: "on",
      decisionModelBaseUrl: "https://api.typesafe.ai",
      decisionModelId: "jev",
    });
    const r = resolveDecisionModel({ workspaceDir: ws, env: {} });
    expect(r.mode).toBe("off");
    expect(r.reason).toBe("missing_credentials");
  });

  it("缺 baseUrl / 缺 id 同样拒绝", () => {
    expect(
      resolveDecisionModel({
        workspaceDir: makeWorkspace(),
        env: {
          LAWMIND_DECISION_MODEL_MODE: "on",
          LAWMIND_DECISION_MODEL_API_KEY: "k",
          LAWMIND_DECISION_MODEL_ID: "jev",
        },
      }).reason,
    ).toBe("missing_credentials");
    expect(
      resolveDecisionModel({
        workspaceDir: makeWorkspace(),
        env: {
          LAWMIND_DECISION_MODEL_MODE: "on",
          LAWMIND_DECISION_MODEL_BASE_URL: "https://x.ai",
          LAWMIND_DECISION_MODEL_API_KEY: "k",
        },
      }).reason,
    ).toBe("missing_credentials");
  });

  it("凭据齐全 → 返回 config，且 baseUrl 去掉尾斜杠", () => {
    const r = resolveDecisionModel({
      workspaceDir: makeWorkspace(),
      env: {
        LAWMIND_DECISION_MODEL_MODE: "on",
        LAWMIND_DECISION_MODEL_BASE_URL: "https://api.typesafe.ai/",
        LAWMIND_DECISION_MODEL_API_KEY: "sk-test",
        LAWMIND_DECISION_MODEL_ID: "jev-latest",
      },
    });
    expect(r.mode).toBe("on");
    if (r.mode === "off") {
      throw new Error("unreachable");
    }
    expect(r.config.baseUrl).toBe("https://api.typesafe.ai");
    expect(r.config.kind).toBe("typesafe");
  });

  it("shadow 与 on 都返回可用端口（区别在调用方，不在传输）", () => {
    for (const mode of ["shadow", "on"] as const) {
      const ws = makeWorkspace({
        decisionModelMode: mode,
        decisionModelBaseUrl: "https://api.typesafe.ai",
        decisionModelApiKey: "sk-test",
        decisionModelId: "jev",
      });
      const r = getDecisionModel({ workspaceDir: ws, env: {} });
      expect(r.mode).toBe(mode);
      expect(r.model?.id).toBe("typesafe.jev");
    }
  });

  it("policy 优先于 env（文件是显式配置）", () => {
    const ws = makeWorkspace({
      decisionModelMode: "on",
      decisionModelBaseUrl: "https://from-policy.ai",
      decisionModelApiKey: "policy-key",
      decisionModelId: "policy-model",
    });
    const r = resolveDecisionModel({
      workspaceDir: ws,
      env: {
        LAWMIND_DECISION_MODEL_BASE_URL: "https://from-env.ai",
        LAWMIND_DECISION_MODEL_API_KEY: "env-key",
        LAWMIND_DECISION_MODEL_ID: "env-model",
      },
    });
    if (r.mode === "off") {
      throw new Error("expected enabled");
    }
    expect(r.config.baseUrl).toBe("https://from-policy.ai");
    expect(r.config.model).toBe("policy-model");
  });

  it("超时默认 8s，env 可覆盖", () => {
    const ws = makeWorkspace({
      decisionModelMode: "on",
      decisionModelBaseUrl: "https://x.ai",
      decisionModelApiKey: "k",
      decisionModelId: "m",
    });
    const dflt = resolveDecisionModel({ workspaceDir: ws, env: {} });
    expect(dflt.mode === "off" ? 0 : dflt.config.timeoutMs).toBe(8000);
    const custom = resolveDecisionModel({
      workspaceDir: ws,
      env: { LAWMIND_DECISION_MODEL_TIMEOUT_MS: "1234" },
    });
    expect(custom.mode === "off" ? 0 : custom.config.timeoutMs).toBe(1234);
  });
});

describe("P5 请求/响应形状（只收合法值）", () => {
  it("三个原语翻成 Jev 请求形状", () => {
    const questions: DecisionQuestion[] = [
      { type: "noul", id: "urgent", instructions: "是否紧急？" },
      { type: "choice", id: "kind", instructions: "属于哪类？", options: ["a", "b"] },
      { type: "score", id: "impact", instructions: "影响多大？", scale: { min: 1, max: 5 } },
    ];
    expect(buildSystemOneRequestBody({ model: "jev", state: "s", questions })).toEqual({
      model: "jev",
      state: "s",
      questions: {
        urgent: { type: "noul", instructions: "是否紧急？" },
        kind: { type: "choice", instructions: "属于哪类？", options: ["a", "b"] },
        impact: { type: "score", instructions: "影响多大？", scale: { min: 1, max: 5 } },
      },
    });
  });

  it("noul 概率夹到 [0,1]", () => {
    const q: DecisionQuestion[] = [{ type: "noul", id: "x", instructions: "i" }];
    const out = parseSystemOneAnswers(
      { answers: [{ id: "x", type: "noul", probability: 1.7, confidence: -0.2 }] },
      q,
    );
    expect(out[0]).toMatchObject({ type: "noul", probability: 1, confidence: 0 });
  });

  it("choice 必须落在调用方给的 options 内（防编造选项）", () => {
    const q: DecisionQuestion[] = [
      { type: "choice", id: "k", instructions: "i", options: ["a", "b"] },
    ];
    expect(
      parseSystemOneAnswers({ answers: [{ id: "k", type: "choice", choice: "z" }] }, q),
    ).toEqual([]);
    expect(
      parseSystemOneAnswers({ answers: [{ id: "k", type: "choice", choice: "a" }] }, q)[0],
    ).toMatchObject({ choice: "a" });
  });

  it("score 越界被丢弃", () => {
    const q: DecisionQuestion[] = [
      { type: "score", id: "s", instructions: "i", scale: { min: 1, max: 5 } },
    ];
    expect(parseSystemOneAnswers({ answers: [{ id: "s", type: "score", score: 9 }] }, q)).toEqual(
      [],
    );
    expect(
      parseSystemOneAnswers({ answers: [{ id: "s", type: "score", score: 3 }] }, q),
    ).toHaveLength(1);
  });

  it("问句里不存在的 id 被丢弃（防「编一个问句」）", () => {
    const q: DecisionQuestion[] = [{ type: "noul", id: "real", instructions: "i" }];
    expect(
      parseSystemOneAnswers({ answers: [{ id: "made-up", type: "noul", probability: 0.9 }] }, q),
    ).toEqual([]);
  });

  it("type 不匹配（问了 noul 答 choice）被丢弃", () => {
    const q: DecisionQuestion[] = [{ type: "noul", id: "x", instructions: "i" }];
    expect(
      parseSystemOneAnswers({ answers: [{ id: "x", type: "choice", choice: "a" }] }, q),
    ).toEqual([]);
  });

  it("缺失/畸形响应 → 空数组，不抛", () => {
    const q: DecisionQuestion[] = [{ type: "noul", id: "x", instructions: "i" }];
    expect(parseSystemOneAnswers(undefined, q)).toEqual([]);
    expect(parseSystemOneAnswers({}, q)).toEqual([]);
    expect(parseSystemOneAnswers({ answers: [null as never] }, q)).toEqual([]);
  });
});

describe("P5 端口失败语义：不可用是正常状态，不编造", () => {
  it("非 200 → undefined（不返回空数组假装成功）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 })),
    );
    const model = createTypesafeDecisionModel(CFG);
    const out = await model.decide({
      state: "s",
      questions: [{ type: "noul", id: "x", instructions: "i" }],
    });
    expect(out).toBeUndefined();
  });

  it("网络抛异常 → undefined，不向上抛", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const model = createTypesafeDecisionModel(CFG);
    const out = await model.decide({
      state: "s",
      questions: [{ type: "noul", id: "x", instructions: "i" }],
    });
    expect(out).toBeUndefined();
  });

  it("成功 → 返回解析后的答案", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          answers: [{ id: "x", type: "noul", probability: 0.8, confidence: 0.7 }],
        }),
      })),
    );
    const model = createTypesafeDecisionModel(CFG);
    const out = await model.decide({
      state: "s",
      questions: [{ type: "noul", id: "x", instructions: "i" }],
    });
    expect(out).toHaveLength(1);
    expect(out?.[0]).toMatchObject({ probability: 0.8, confidence: 0.7 });
  });

  it("空问句集 → 空数组且**不发请求**（零成本短路）", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchSpy);
    const model = createTypesafeDecisionModel(CFG);
    expect(await model.decide({ state: "s", questions: [] })).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("端口 id 带版本（审计与分歧记录要能区分是谁投的票）", () => {
    expect(createTypesafeDecisionModel(CFG).id).toBe("typesafe.jev-latest");
  });

  it("请求打到 systemone 端点并带 Bearer", async () => {
    let seenUrl = "";
    let seenAuth = "";
    let seenBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
        seenUrl = url;
        seenAuth = init.headers.authorization;
        seenBody = init.body;
        return { ok: true, json: async () => ({ answers: [] }) };
      }),
    );
    const model = createTypesafeDecisionModel(CFG);
    await model.decide({
      state: "案件状态",
      questions: [{ type: "noul", id: "x", instructions: "i" }],
    });
    expect(seenUrl).toContain("/v1/systemone");
    expect(seenAuth).toBe("Bearer sk-test");
    expect(seenBody).toContain("案件状态");
    expect(seenBody).not.toContain("chat/completions");
  });
});
