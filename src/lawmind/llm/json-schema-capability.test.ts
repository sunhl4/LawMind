import { afterEach, describe, expect, it } from "vitest";
import {
  KNOWN_STRICT_SCHEMA_HOSTS,
  hostOf,
  listStrictSchemaRejectedHosts,
  looksLikeStrictSchemaRejection,
  markStrictSchemaRejected,
  resetStrictSchemaRejectionCache,
  resolveJsonSchemaMode,
} from "./json-schema-capability.js";
import { buildJsonResponseFormat } from "./openai-json.js";

const SCHEMA = {
  name: "test_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["kind"],
    properties: { kind: { type: "string", enum: ["a", "b"] } },
  },
};

afterEach(() => {
  resetStrictSchemaRejectionCache();
});

describe("P2.1 能力判定：不猜厂商，默认与升级前一致", () => {
  it("白名单为空时，未知端点的默认行为就是 json_object（零行为变化）", () => {
    // 这是本模块最重要的性质：P2.1 落地不改变任何现有端点的行为。
    expect(KNOWN_STRICT_SCHEMA_HOSTS).toEqual([]);
    const d = resolveJsonSchemaMode("https://api.deepseek.com/v1", {});
    expect(d.mode).toBe("json_object");
    expect(d.reason).toBe("unknown_host_default_json_object");
  });

  it("env=off 一律 json_object（即使是白名单主机）", () => {
    expect(
      resolveJsonSchemaMode("https://api.openai.com/v1", { LAWMIND_LLM_JSON_SCHEMA: "off" }).mode,
    ).toBe("json_object");
  });

  it("env=on 才主动尝试 strict", () => {
    expect(
      resolveJsonSchemaMode("https://api.example.com/v1", { LAWMIND_LLM_JSON_SCHEMA: "on" }).mode,
    ).toBe("json_schema");
  });

  it("空 baseUrl 不尝试 strict", () => {
    expect(resolveJsonSchemaMode("", { LAWMIND_LLM_JSON_SCHEMA: "on" }).mode).toBe("json_object");
  });

  it("被拒过的主机记住并回落（避免每次调用都失败一次）", () => {
    expect(
      resolveJsonSchemaMode("https://api.example.com/v1", { LAWMIND_LLM_JSON_SCHEMA: "on" }).mode,
    ).toBe("json_schema");
    expect(markStrictSchemaRejected("https://api.example.com/v1")).toBe(true);
    // 首次记录返回 true，重复记录返回 false
    expect(markStrictSchemaRejected("https://api.example.com/v1")).toBe(false);
    const after = resolveJsonSchemaMode("https://api.example.com/v1", {
      LAWMIND_LLM_JSON_SCHEMA: "on",
    });
    expect(after.mode).toBe("json_object");
    expect(after.reason).toBe("previously_rejected");
    expect(listStrictSchemaRejectedHosts()).toEqual(["api.example.com"]);
  });

  it("记忆按主机名而非完整 URL（同主机不同路径共享判定）", () => {
    markStrictSchemaRejected("https://api.example.com/v1/chat/completions");
    expect(
      resolveJsonSchemaMode("https://api.example.com/other/path", { LAWMIND_LLM_JSON_SCHEMA: "on" })
        .mode,
    ).toBe("json_object");
  });

  it("hostOf 兼容绝对 URL 与裸主机名（测试里的假端点）", () => {
    expect(hostOf("https://API.Example.com:8443/v1")).toBe("api.example.com:8443");
    expect(hostOf("api.example.com/v1")).toBe("api.example.com");
    expect(hostOf("  ")).toBe("");
  });

  it("400 + 提及 json_schema/response_format/strict → 判定为严格模式不支持", () => {
    expect(looksLikeStrictSchemaRejection(400, '{"error":"response_format unsupported"}')).toBe(
      true,
    );
    expect(looksLikeStrictSchemaRejection(400, '{"error":"json_schema not supported"}')).toBe(true);
    expect(looksLikeStrictSchemaRejection(400, '{"error":"bad request"}')).toBe(false);
    // 非 400 不判（避免把限流/鉴权错误当成能力问题）
    expect(looksLikeStrictSchemaRejection(429, "response_format")).toBe(false);
    expect(looksLikeStrictSchemaRejection(500, "json_schema")).toBe(false);
  });
});

describe("P2.1 buildJsonResponseFormat", () => {
  it("无 schema → json_object，reason 表明是调用方没给", () => {
    const r = buildJsonResponseFormat("https://api.example.com/v1", undefined, {});
    expect(r.responseFormat).toEqual({ type: "json_object" });
    expect(r.mode).toBe("json_object");
    expect(r.reason).toBe("no_schema_provided");
  });

  it("有 schema + 命中 strict → 产出 OpenAI 形状的 json_schema", () => {
    const r = buildJsonResponseFormat("https://api.example.com/v1", SCHEMA, {
      LAWMIND_LLM_JSON_SCHEMA: "on",
    });
    expect(r.mode).toBe("json_schema");
    expect(r.responseFormat).toEqual({
      type: "json_schema",
      json_schema: { name: "test_schema", strict: true, schema: SCHEMA.schema },
    });
  });

  it("有 schema 但端点未核实 → 退回 json_object（不冒险 400）", () => {
    const r = buildJsonResponseFormat("https://api.deepseek.com/v1", SCHEMA, {});
    expect(r.responseFormat).toEqual({ type: "json_object" });
    expect(r.mode).toBe("json_object");
    expect(r.reason).toBe("unknown_host_default_json_object");
  });
});
