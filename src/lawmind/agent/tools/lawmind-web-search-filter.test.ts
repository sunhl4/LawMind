import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { filterPublicHitsByNetworkAllowlist } from "./lawmind-web-search.js";

/**
 * 原生厂商联网（DeepSeek / 通义）是模型侧取回结果的，拦不住出站请求；
 * 但结果必须按 networkAllowlist 收窄，否则设置页「用白名单限范围」就是假话。
 */
describe("filterPublicHitsByNetworkAllowlist", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
    delete process.env.LAWMIND_EDITION;
  });

  function workspaceWithAllowlist(allowlist: string[]): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-webfilter-"));
    fs.writeFileSync(
      path.join(dir, "lawmind.policy.json"),
      `${JSON.stringify({ schemaVersion: 1, egressMode: "allowlisted", networkAllowlist: allowlist })}\n`,
      "utf8",
    );
    return dir;
  }

  const hits = [
    { title: "人大", url: "https://www.npc.gov.cn/law", description: "official" },
    { title: "法院", url: "https://court.gov.cn/x", description: "official" },
    { title: "博客", url: "https://random-blog.example/post", description: "blog" },
  ];

  it("drops hosts outside the allowlist and reports how many", () => {
    const ws = workspaceWithAllowlist(["npc.gov.cn", "court.gov.cn"]);
    const out = filterPublicHitsByNetworkAllowlist(ws, hits);
    expect(out.results.map((r) => r.url)).toEqual([
      "https://www.npc.gov.cn/law",
      "https://court.gov.cn/x",
    ]);
    expect(out.filteredOut).toBe(1);
  });

  it("drops hits whose URL cannot be parsed rather than letting them through", () => {
    const ws = workspaceWithAllowlist(["npc.gov.cn"]);
    const out = filterPublicHitsByNetworkAllowlist(ws, [
      { title: "bad", url: "not a url", description: "" },
      { title: "ok", url: "https://www.npc.gov.cn/law", description: "" },
    ]);
    expect(out.results).toHaveLength(1);
    expect(out.filteredOut).toBe(1);
  });

  it("passes everything through when no workspace is given", () => {
    const out = filterPublicHitsByNetworkAllowlist(undefined, hits);
    expect(out.results).toHaveLength(3);
    expect(out.filteredOut).toBe(0);
  });

  it("passes everything through in a solo workspace without an allowlist", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-webfilter-solo-"));
    const out = filterPublicHitsByNetworkAllowlist(dir, hits);
    expect(out.results).toHaveLength(3);
    expect(out.filteredOut).toBe(0);
  });
});
