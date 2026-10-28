/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

type Admission = {
  admissionId: string;
  matterId: string;
  status: "prospective" | "conflict_pending" | "lawyer_review" | "accepted" | "declined";
  candidates: Array<{ name: string; role: string; source: string }>;
  sourceItemIds: string[];
  ownerLawyerId?: string;
  conflict: { status: "pending" | "clear" | "hit"; hits: unknown[]; scannedAt?: string };
  riskDisclosure: { status: "missing" | "acknowledged" };
  aiDisclosure: { status: "missing" | "acknowledged" };
  decision?: { kind: "accept" | "decline"; by: string; at: string };
  timeline?: Array<{ at: string; kind: string; by: "system" | "lawyer"; detail?: string }>;
};

const record: Admission = {
  admissionId: "adm-test",
  matterId: "matter-a",
  status: "prospective",
  candidates: [{ name: "张三", role: "client", source: "intake" }],
  sourceItemIds: ["it-test"],
  conflict: { status: "pending", hits: [] },
  riskDisclosure: { status: "missing" },
  aiDisclosure: { status: "missing" },
  timeline: [
    { at: "2026-10-26T11:00:00.000Z", kind: "created", by: "system" },
    {
      at: "2026-10-26T11:05:00.000Z",
      kind: "owner_assigned",
      by: "lawyer",
      detail: "负责人：lawyer:desktop",
    },
  ],
};

const apiGetJson = vi.fn(async (_base: string, path: string) => {
  if (path.endsWith("/provenance")) {
    return {
      ok: true,
      entries: [
        {
          field: "docket.caseNo",
          value: "（2026）沪01民初1001号",
          quote: "（2026）沪01民初1001号",
          itemId: "it-test",
          status: "applied",
          capturedAt: "2026-10-27T01:00:00.000Z",
        },
      ],
      coverage: { missing: [{ field: "causeOfAction", value: "买卖合同纠纷" }] },
    };
  }
  if (path.endsWith("/legal-events")) {
    return {
      ok: true,
      events: [
        {
          eventKind: "hearing",
          title: "开庭",
          dueAt: "2026-11-20T01:30:00.000Z",
          confidence: "high",
        },
      ],
    };
  }
  throw Object.assign(new Error("not found"), { status: 404, body: { error: "not_found" } });
});
const engagementManifest = {
  generatedAt: "2026-10-27T01:00:00.000Z",
  files: [
    { name: "委托代理合同.md", relativePath: "matters/matter-a/收案/委托代理合同.md", bytes: 100 },
    { name: "授权委托书.md", relativePath: "matters/matter-a/收案/授权委托书.md", bytes: 90 },
    { name: "风险告知书.md", relativePath: "matters/matter-a/收案/风险告知书.md", bytes: 80 },
    { name: "AI-使用告知与同意.md", relativePath: "matters/matter-a/收案/AI-使用告知与同意.md", bytes: 70 },
    { name: "报价单.md", relativePath: "matters/matter-a/收案/报价单.md", bytes: 60 },
  ],
  esign: { status: "placeholder" },
};
const apiSendJson = vi.fn(
  async (_base: string, path: string, _method: string, body: unknown) => {
    const action = (body as { action?: string }).action;
    if (path.endsWith("/engagement/docx")) {
      return {
        ok: true,
        generatedAt: "2026-10-28T02:00:00.000Z",
        files: engagementManifest.files.map((file) => ({
          ...file,
          name: file.name.replace(/\.md$/, ".docx"),
          relativePath: file.relativePath.replace(/\.md$/, ".docx"),
        })),
      };
    }
    if (path.endsWith("/engagement")) {
      return { ok: true, manifest: engagementManifest };
    }
    if (path.endsWith("/legal-events")) {
      return {
        ok: true,
        deadlines: [
          { deadlineId: "d-hearing", title: "开庭", dueAt: "2026-11-20T01:30:00.000Z" },
        ],
      };
    }
    if (path === "/api/intake/admissions") {
      return { ok: true, admission: { ...record } };
    }
    switch (action) {
      case "assign":
        record.ownerLawyerId = (body as { ownerLawyerId: string }).ownerLawyerId;
        break;
      case "scan_run":
        record.status = "lawyer_review";
        record.conflict = {
          status: "clear",
          hits: [],
          scannedAt: "2026-10-26T12:00:00.000Z",
        };
        break;
      case "acknowledge": {
        const input = body as { risk?: boolean; ai?: boolean };
        if (input.risk) {
          record.riskDisclosure = { status: "acknowledged" };
        }
        if (input.ai) {
          record.aiDisclosure = { status: "acknowledged" };
        }
        break;
      }
      case "accept":
        record.status = "accepted";
        record.decision = {
          kind: "accept",
          by: "lawyer:desktop",
          at: "2026-10-26T12:00:00.000Z",
        };
        break;
    }
    return { ok: true, admission: { ...record } };
  },
);

vi.mock("../api-client", () => ({
  apiGetJson: (...args: unknown[]) => apiGetJson(...(args as [string, string])),
  apiSendJson: (...args: unknown[]) => apiSendJson(...(args as [string, string, string, unknown])),
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));

import { MatterAdmissionCard } from "./MatterAdmissionCard";

describe("MatterAdmissionCard", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    apiGetJson.mockClear();
    apiSendJson.mockClear();
    record.status = "prospective";
    record.ownerLawyerId = undefined;
    record.conflict = { status: "pending", hits: [] };
    record.riskDisclosure = { status: "missing" };
    record.aiDisclosure = { status: "missing" };
    record.decision = undefined;
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function renderCard(onAccepted = vi.fn()) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <MatterAdmissionCard
          apiBase="http://127.0.0.1:9"
          matterId="matter-a"
          matterStatus="intake"
          onAccepted={onAccepted}
        />,
      );
    });
    await flush();
    return { onAccepted };
  }

  function button(label: string): HTMLButtonElement {
    const found = [...host.querySelectorAll("button")].find((node) =>
      node.textContent?.includes(label),
    );
    if (!found) {
      throw new Error(`button not found: ${label}`);
    }
    return found;
  }

  async function setInput(input: HTMLInputElement, value: string) {
    // oxlint-disable-next-line typescript/unbound-method -- React 受控输入要走原型 setter。
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("starts the admission, scans, acknowledges, and accepts", async () => {
    const { onAccepted } = await renderCard();
    expect(host.textContent).toContain("开始收案");
    expect(apiSendJson).not.toHaveBeenCalled();

    await act(async () => {
      button("开始收案").click();
    });
    await flush();
    expect(host.textContent).toContain("待冲突扫描");
    expect(host.textContent).toContain("张三");
    expect(host.textContent).toContain("字段出处");
    expect(host.textContent).toContain("（2026）沪01民初1001号");
    expect(host.textContent).toContain("无出处（律师手填）：案由");

    const ownerInput = host.querySelector(".lm-matter-admission-owner input") as HTMLInputElement;
    await setInput(ownerInput, "lawyer:zhang");
    await act(async () => {
      button("指定").click();
    });
    await flush();
    expect(apiSendJson).toHaveBeenLastCalledWith(
      "http://127.0.0.1:9",
      "/api/intake/admissions/matter-a",
      "POST",
      expect.objectContaining({ action: "assign", ownerLawyerId: "lawyer:zhang" }),
    );

    await act(async () => {
      button("运行冲突扫描").click();
    });
    await flush();
    expect(host.textContent).toContain("待律师审核");
    expect(host.textContent).toContain("未发现命中");

    const checks = [...host.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(checks).toHaveLength(2);
    await act(async () => {
      checks[0].click();
    });
    await flush();
    await act(async () => {
      checks[1].click();
    });
    await flush();

    expect(button("接受委托").disabled).toBe(false);
    await act(async () => {
      button("接受委托").click();
    });
    await flush();
    expect(host.textContent).toContain("已接受委托");
    expect(onAccepted).toHaveBeenCalledTimes(1);
    // 决定之后仍能看到收案时间线。
    expect(host.querySelector('[data-testid="lm-matter-admission-timeline"]')?.textContent).toContain(
      "建立收案记录",
    );
  });

  it("generates the engagement package draft from the admission card", async () => {
    await renderCard();
    await act(async () => {
      button("开始收案").click();
    });
    await flush();

    const inputs = [
      ...host.querySelectorAll(".lm-matter-engagement-form input"),
    ] as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    await setInput(inputs[0], "张三");
    await setInput(inputs[1], "按标的额 5% 收取");

    await act(async () => {
      button("生成委托包").click();
    });
    await flush();

    expect(host.textContent).toContain("已生成 5 份草案");
    expect(host.textContent).toContain("电子签：占位（未接入）");
    expect(host.textContent).toContain("委托代理合同.md");
    expect(apiSendJson).toHaveBeenLastCalledWith(
      "http://127.0.0.1:9",
      "/api/intake/admissions/matter-a/engagement",
      "POST",
      expect.objectContaining({ clientName: "张三", feeText: "按标的额 5% 收取" }),
    );
  });

  it("exports the engagement package to docx from the admission card", async () => {
    await renderCard();
    await act(async () => {
      button("开始收案").click();
    });
    await flush();

    const inputs = [
      ...host.querySelectorAll(".lm-matter-engagement-form input"),
    ] as HTMLInputElement[];
    await setInput(inputs[0], "张三");
    await setInput(inputs[1], "按标的额 5% 收取");
    await act(async () => {
      button("生成委托包").click();
    });
    await flush();

    await act(async () => {
      button("导出 DOCX").click();
    });
    await flush();

    expect(apiSendJson).toHaveBeenLastCalledWith(
      "http://127.0.0.1:9",
      "/api/intake/admissions/matter-a/engagement/docx",
      "POST",
      {},
    );
    expect(host.textContent).toContain("已导出 Word 5 份");
    expect(host.textContent).toContain("从当前 Markdown 生成");
    expect(button("重新导出 DOCX").disabled).toBe(false);
  });

  it("extracts summons dates from the source item and writes deadlines", async () => {
    await renderCard();
    await act(async () => {
      button("开始收案").click();
    });
    await flush();

    await act(async () => {
      button("抽取期限").click();
    });
    await flush();
    expect(host.textContent).toContain("开庭");
    expect(host.textContent).toContain("置信度：high");

    await act(async () => {
      button("写入期限").click();
    });
    await flush();
    expect(host.textContent).toContain("期限已写入本案期限链");
    expect(apiSendJson).toHaveBeenLastCalledWith(
      "http://127.0.0.1:9",
      "/api/intake/admissions/matter-a/legal-events",
      "POST",
      expect.objectContaining({
        events: [
          expect.objectContaining({
            eventKind: "hearing",
            dueAt: "2026-11-20T01:30:00.000Z",
          }),
        ],
      }),
    );
  });

  it("shows the admission timeline newest first", async () => {
    await renderCard();
    await act(async () => {
      button("开始收案").click();
    });
    await flush();

    const timeline = host.querySelector('[data-testid="lm-matter-admission-timeline"]');
    expect(timeline).toBeTruthy();
    expect(timeline?.textContent).toContain("操作记录 2");
    const items = [...timeline!.querySelectorAll("li")].map((node) => node.textContent);
    expect(items[0]).toContain("指定负责人");
    expect(items[0]).toContain("负责人：lawyer:desktop");
    expect(items[1]).toContain("建立收案记录");
  });

  it("keeps the timeline visible while the case is still under review", async () => {
    const { onAccepted } = await renderCard();
    await act(async () => {
      button("开始收案").click();
    });
    await flush();
    const ownerInput = host.querySelector(".lm-matter-admission-owner input") as HTMLInputElement;
    await setInput(ownerInput, "lawyer:zhang");
    await act(async () => {
      button("指定").click();
    });
    await flush();
    await act(async () => {
      button("运行冲突扫描").click();
    });
    await flush();
    expect(host.querySelector('[data-testid="lm-matter-admission-timeline"]')).toBeTruthy();
    expect(onAccepted).toHaveBeenCalledTimes(0);
  });

  it("keeps accept disabled until the owner, scan, and disclosures are done", async () => {
    await renderCard();
    await act(async () => {
      button("开始收案").click();
    });
    await flush();
    expect(button("接受委托").disabled).toBe(true);
  });
});
