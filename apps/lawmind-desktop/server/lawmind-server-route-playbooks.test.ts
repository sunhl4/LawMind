/**
 * 剧本与三色分流接口：只锁路由契约与「回读核对」是否真的发生。
 * 分流规则本身由 `deliverables/playbook-triage*.test.ts` 覆盖。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { handlePlaybookRoutes } from "./lawmind-server-route-playbooks.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";
import { saveWorkspacePlaybook } from "../../../src/lawmind/deliverables/playbook-store.js";
import type { Playbook } from "../../../src/lawmind/deliverables/playbook-triage.js";

const QUOTE = "赔偿总额不超过合同金额。";

function playbook(): Playbook {
  return {
    id: "prc.contract.general",
    name: "中国法合同审查（通用）",
    jurisdiction: "PRC",
    version: "1.0.0",
    stance: "偏委托方",
    acceptableRange: "责任上限不低于合同金额。",
    escalationTriggers: ["行政处罚"],
    criteria: [
      { id: "liability_cap", kind: "green", title: "责任有上限" },
      { id: "unlimited_liability", kind: "red", title: "不得约定无限责任" },
    ],
  };
}

describe("lawmind-server-route-playbooks", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function workspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-playbook-route-"));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, "materials"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "materials", "合同.md"),
      ["第一条 赔偿", QUOTE].join("\n"),
      "utf8",
    );
    saveWorkspacePlaybook(dir, playbook());
    return dir;
  }

  function response() {
    let status = 0;
    let body = "";
    const res = {
      writeHead(next: number) {
        status = next;
      },
      end(value?: string | Buffer) {
        body += value?.toString() ?? "";
      },
    } as unknown as http.ServerResponse;
    return {
      res,
      get status() {
        return status;
      },
      json: () => JSON.parse(body) as Record<string, unknown>,
    };
  }

  function request(method: string, value?: unknown): http.IncomingMessage {
    const req = { method, headers: {} } as http.IncomingMessage;
    Object.assign(req, {
      on(event: string, cb: (...args: unknown[]) => void) {
        if (event === "data" && value !== undefined) {
          cb(Buffer.from(JSON.stringify(value)));
        }
        if (event === "end") {
          cb();
        }
        return this;
      },
    });
    return req;
  }

  function context(workspaceDir: string): LawmindDispatchContext {
    return {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
  }

  async function call(dir: string, method: string, pathname: string, body?: unknown) {
    const out = response();
    const handled = await handlePlaybookRoutes({
      ctx: context(dir),
      req: request(method, body),
      res: out.res,
      url: new URL(`http://127.0.0.1${pathname}`),
      pathname,
      c: {},
    });
    return { ...out, handled };
  }

  function observations(quote: string) {
    return [
      {
        criterionId: "liability_cap",
        result: "PASS",
        evidence: { quote, locator: "L2", filePath: "materials/合同.md" },
      },
      {
        criterionId: "unlimited_liability",
        result: "PASS",
        evidence: { quote, locator: "L2", filePath: "materials/合同.md" },
      },
    ];
  }

  it("lists workspace playbooks", async () => {
    const dir = workspace();
    const out = await call(dir, "GET", "/api/playbooks");
    expect(out.handled).toBe(true);
    expect(out.status).toBe(200);
    expect(out.json()).toMatchObject({
      ok: true,
      playbooks: [
        {
          id: "prc.contract.general",
          name: "中国法合同审查（通用）",
          criteriaCount: 2,
          jurisdiction: "PRC",
        },
      ],
    });
  });

  it("returns GREEN only after the quotes re-read inside the cited lines", async () => {
    const dir = workspace();
    const out = await call(dir, "POST", "/api/playbooks/triage", {
      playbookId: "prc.contract.general",
      observations: observations(QUOTE),
    });
    expect(out.status).toBe(200);
    expect(out.json()).toMatchObject({
      ok: true,
      triage: {
        verdict: "GREEN",
        basis: "playbook",
        evidenceVerification: { checked: 1, verified: 1 },
      },
    });
    expect(String(out.json().summaryZh)).toContain("引用核对：1 条已核");
  });

  it("downgrades to YELLOW when the quote cannot be re-read", async () => {
    const dir = workspace();
    const out = await call(dir, "POST", "/api/playbooks/triage", {
      playbookId: "prc.contract.general",
      observations: observations("赔偿总额不超过合同金额（改过的句子）。"),
    });
    expect(out.status).toBe(200);
    expect(out.json()).toMatchObject({
      ok: true,
      triage: { verdict: "YELLOW", evidenceVerification: { failed: 1 } },
    });
  });

  it("rejects unknown playbooks and invalid bodies", async () => {
    const dir = workspace();
    const missing = await call(dir, "POST", "/api/playbooks/triage", {
      playbookId: "prc.missing",
      observations: [],
    });
    expect(missing.status).toBe(404);
    expect(missing.json()).toMatchObject({ ok: false, code: "playbook_not_found" });

    const bad = await call(dir, "POST", "/api/playbooks/triage", {
      playbookId: "prc.contract.general",
      observations: [{ criterionId: "liability_cap", result: "MAYBE" }],
    });
    expect(bad.status).toBe(400);
  });

  it("stays out of other paths", async () => {
    const dir = workspace();
    const out = await call(dir, "GET", "/api/playbooks/triage/extra");
    expect(out.handled).toBe(false);
  });

  it("creates, reads and deletes a playbook through the editor endpoints", async () => {
    const dir = workspace();
    const payload = {
      ...playbook(),
      name: "改过的剧本名称",
      deliverableTypes: ["contract.review"],
    };

    const created = await call(dir, "POST", "/api/playbooks", payload);
    expect(created.status).toBe(200);
    expect(created.json()).toMatchObject({
      ok: true,
      playbook: { id: "prc.contract.general", name: "改过的剧本名称" },
    });

    const single = await call(dir, "GET", "/api/playbooks/prc.contract.general");
    expect(single.status).toBe(200);
    expect(single.json()).toMatchObject({
      ok: true,
      playbook: {
        id: "prc.contract.general",
        name: "改过的剧本名称",
        deliverableTypes: ["contract.review"],
        criteria: [{ id: "liability_cap" }, { id: "unlimited_liability" }],
      },
    });

    const removed = await call(dir, "DELETE", "/api/playbooks/prc.contract.general");
    expect(removed.status).toBe(200);
    expect(removed.json()).toMatchObject({ ok: true, id: "prc.contract.general" });

    const missing = await call(dir, "DELETE", "/api/playbooks/prc.contract.general");
    expect(missing.status).toBe(404);

    const badId = await call(dir, "POST", "/api/playbooks", { ...payload, id: "../escape" });
    expect(badId.status).toBe(400);
  });

  it("accepts section, phrase and citation checks through the editor endpoint", async () => {
    const dir = workspace();
    const payload = {
      ...playbook(),
      id: "prc.memo.opinion",
      name: "意见书结构",
      deliverableTypes: ["memo.opinion"],
      criteria: [
        {
          id: "issue",
          kind: "green",
          title: "有争议焦点",
          check: { kind: "section_present", headings: ["争议焦点"] },
        },
        {
          id: "advice",
          kind: "green",
          title: "有建议",
          check: { kind: "phrase_present", phrases: ["建议"] },
        },
        {
          id: "guarantee",
          kind: "red",
          title: "不得保证结果",
          check: { kind: "phrase_absent", phrases: ["保证胜诉"] },
        },
        {
          id: "authority",
          kind: "green",
          title: "有法律依据",
          check: { kind: "citation_present" },
        },
      ],
    };

    const created = await call(dir, "POST", "/api/playbooks", payload);
    expect(created.status).toBe(200);
    const single = await call(dir, "GET", "/api/playbooks/prc.memo.opinion");
    expect(single.status).toBe(200);
    expect(single.json()).toMatchObject({
      ok: true,
      playbook: {
        id: "prc.memo.opinion",
        deliverableTypes: ["memo.opinion"],
        criteria: [
          { id: "issue", check: { kind: "section_present", headings: ["争议焦点"] } },
          { id: "advice", check: { kind: "phrase_present", phrases: ["建议"] } },
          { id: "guarantee", check: { kind: "phrase_absent", phrases: ["保证胜诉"] } },
          { id: "authority", check: { kind: "citation_present" } },
        ],
      },
    });

    const invalid = await call(dir, "POST", "/api/playbooks", {
      ...payload,
      criteria: [
        {
          id: "issue",
          kind: "green",
          title: "有争议焦点",
          check: { kind: "section_present", headings: [] },
        },
      ],
    });
    expect(invalid.status).toBe(400);
  });
});
