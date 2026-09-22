/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LawmindDecisionHeader } from "./LawmindDecisionHeader";
import { LawmindJudgmentEscalationCard } from "./LawmindJudgmentEscalationCard";
import { LawmindJudgmentItemsPanel } from "./LawmindJudgmentItemsPanel";

const hosts: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = [];

afterEach(() => {
  for (const { host, root } of hosts) {
    act(() => {
      root.unmount();
    });
    host.remove();
  }
  hosts.length = 0;
  vi.restoreAllMocks();
});

async function render(node: React.ReactNode): Promise<HTMLDivElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  hosts.push({ host, root });
  await act(async () => {
    root.render(node);
  });
  // 让 useEffect 的 promise 链落地。
  await act(async () => {
    await Promise.resolve();
  });
  return host;
}

function mockFetch(body: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    })) as unknown as typeof fetch,
  );
}

describe("G3 决策头：显示判定覆盖自述", () => {
  it("有 coverage 时显示「本次核对 N 项…通过核对 ≠ 法律正确」", async () => {
    const host = await render(
      <LawmindDecisionHeader
        header={{
          changed: "补全了送达地址",
          why: "与原合同对齐",
          risk: "机械核对未见已知缺陷。通过核对 ≠ 法律正确。",
          ready: "usable",
          judgmentCoverage: { machine: 2, judged: 15, escalated: 2 },
        }}
      />,
    );
    const el = host.querySelector('[data-testid="lm-decision-header-coverage"]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("本次核对 19 项");
    expect(el!.textContent).toContain("2 项由确定性规则判定");
    expect(el!.textContent).toContain("2 项待您定夺");
    expect(el!.textContent).toContain("通过核对 ≠ 法律正确");
  });

  it("**不传 coverage 时不显示该行**（不写「核对了 0 项」）", async () => {
    const host = await render(
      <LawmindDecisionHeader
        header={{ changed: "a", why: "b", risk: "c", ready: "usable" }}
      />,
    );
    expect(host.querySelector('[data-testid="lm-decision-header-coverage"]')).toBeNull();
  });

  it("全零 coverage 也不显示（没有核对项 ≠ 核对了 0 项）", async () => {
    const host = await render(
      <LawmindDecisionHeader
        header={{
          changed: "a",
          why: "b",
          risk: "c",
          ready: "usable",
          judgmentCoverage: { machine: 0, judged: 0, escalated: 0 },
        }}
      />,
    );
    expect(host.querySelector('[data-testid="lm-decision-header-coverage"]')).toBeNull();
  });
});

describe("G3 待定夺卡", () => {
  it("有事项时列出，并说明系统不代为选择", async () => {
    mockFetch({
      ok: true,
      escalation: [{ label: "责任上限的水平", reason: "属商业风险分配" }],
    });
    const host = await render(
      <LawmindJudgmentEscalationCard apiBase="http://127.0.0.1:1" taskId="t1" />,
    );
    const el = host.querySelector('[data-testid="lm-judgment-escalation"]');
    expect(el?.textContent).toContain("本件有 1 处需您定夺");
    expect(el?.textContent).toContain("责任上限的水平");
    expect(el?.textContent).toContain("属商业风险分配");
    expect(el?.textContent).toContain("不代为选择");
    expect(el?.textContent).toContain("不会替您选一条路继续");
  });

  it("**读失败时不说「暂无事项」**——故障与「没有」必须区分", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }) as unknown as typeof fetch,
    );
    const host = await render(
      <LawmindJudgmentEscalationCard apiBase="http://127.0.0.1:1" taskId="t1" />,
    );
    const text = host.querySelector('[data-testid="lm-judgment-escalation"]')?.textContent ?? "";
    expect(text).toContain("读不到");
    expect(text).not.toContain("没有需要您定夺");
  });

  it("确实为空时才说「没有需要您定夺的取舍事项」", async () => {
    mockFetch({ ok: true, escalation: [] });
    const host = await render(
      <LawmindJudgmentEscalationCard apiBase="http://127.0.0.1:1" taskId="t1" />,
    );
    expect(
      host.querySelector('[data-testid="lm-judgment-escalation"]')?.textContent,
    ).toContain("没有需要您定夺的取舍事项");
  });
});

/**
 * G3 欠账二：`advisory`（单人执业缺省）下**不打断**，但律师必须看得见。
 * 载体是改稿台的旁路展示（`variant="inline"`）。
 */
describe("G3 待定夺卡 · 旁路展示（inline）", () => {
  it("**没有事项时整块不出现**——改稿台不给每份稿子加噪声", async () => {
    mockFetch({ ok: true, escalation: [] });
    const host = await render(
      <LawmindJudgmentEscalationCard apiBase="http://127.0.0.1:1" taskId="t1" variant="inline" />,
    );
    expect(host.querySelector('[data-testid="lm-judgment-escalation"]')).toBeNull();
  });

  it("读取中也不占位（不闪一条占位内容）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)) as unknown as typeof fetch,
    );
    const host = await render(
      <LawmindJudgmentEscalationCard apiBase="http://127.0.0.1:1" taskId="t1" variant="inline" />,
    );
    expect(host.querySelector('[data-testid="lm-judgment-escalation"]')).toBeNull();
  });

  it("**但读不到时必须说话**——故障不得冒充「没有」", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }) as unknown as typeof fetch,
    );
    const host = await render(
      <LawmindJudgmentEscalationCard apiBase="http://127.0.0.1:1" taskId="t1" variant="inline" />,
    );
    const el = host.querySelector('[data-testid="lm-judgment-escalation"]');
    expect(el?.getAttribute("data-state")).toBe("error");
    expect(el?.textContent).toContain("读不到");
  });

  it("`advisory`：标题说「系统未代为决定」，收尾明说**不打断**", async () => {
    mockFetch({
      ok: true,
      escalationPosture: "advisory",
      escalation: [{ label: "责任上限的水平", reason: "属商业风险分配" }],
    });
    const host = await render(
      <LawmindJudgmentEscalationCard apiBase="http://127.0.0.1:1" taskId="t1" variant="inline" />,
    );
    const el = host.querySelector('[data-testid="lm-judgment-escalation"]')!;
    expect(el.getAttribute("data-posture")).toBe("advisory");
    expect(el.textContent).toContain("本件有 1 处系统未代为决定");
    expect(el.textContent).toContain("不打断当前流程");
    // `advisory` 没有停下流程——说「在此之前不会继续」是假的。
    expect(el.textContent).not.toContain("不会替您选一条路继续");
    expect(el.textContent).toContain("责任上限的水平");
    expect(el.textContent).toContain("属商业风险分配");
  });

  it("`block`：口径相反——明说**已经停下**，不会替律师选路", async () => {
    mockFetch({
      ok: true,
      escalationPosture: "block",
      escalation: [{ label: "责任上限的水平", reason: "属商业风险分配" }],
    });
    const host = await render(
      <LawmindJudgmentEscalationCard apiBase="http://127.0.0.1:1" taskId="t1" variant="inline" />,
    );
    const el = host.querySelector('[data-testid="lm-judgment-escalation"]')!;
    expect(el.getAttribute("data-posture")).toBe("block");
    expect(el.textContent).toContain("本件有 1 处需您定夺");
    expect(el.textContent).toContain("不会替您选一条路继续");
    expect(el.textContent).not.toContain("不打断当前流程");
  });

  it("服务端没给 posture 时按「已停下」说（保守，不让律师以为无人处理）", async () => {
    mockFetch({ ok: true, escalation: [{ label: "责任上限的水平", reason: "r" }] });
    const host = await render(
      <LawmindJudgmentEscalationCard apiBase="http://127.0.0.1:1" taskId="t1" variant="inline" />,
    );
    expect(
      host.querySelector('[data-testid="lm-judgment-escalation"]')?.getAttribute("data-posture"),
    ).toBe("block");
  });

  it("posture 取值写坏了也按「已停下」说（不把错配置当免检）", async () => {
    mockFetch({
      ok: true,
      escalationPosture: "advis0ry",
      escalation: [{ label: "责任上限的水平", reason: "r" }],
    });
    const host = await render(
      <LawmindJudgmentEscalationCard apiBase="http://127.0.0.1:1" taskId="t1" variant="inline" />,
    );
    expect(
      host.querySelector('[data-testid="lm-judgment-escalation"]')?.getAttribute("data-posture"),
    ).toBe("block");
  });

  it("card 形态（显式入口）保持原三态：空也说话", async () => {
    mockFetch({ ok: true, escalation: [] });
    const host = await render(
      <LawmindJudgmentEscalationCard apiBase="http://127.0.0.1:1" taskId="t1" variant="card" />,
    );
    const el = host.querySelector('[data-testid="lm-judgment-escalation"]');
    expect(el?.getAttribute("data-variant")).toBe("card");
    expect(el?.getAttribute("data-state")).toBe("empty");
  });
});

describe("G3 判定项明细面板", () => {
  it("展示计数、未覆盖项与覆盖自述", async () => {
    mockFetch({
      ok: true,
      present: true,
      coverageNote: "本次机械核对 3 项，其中 2 项由确定性规则判定。通过核对 ≠ 法律正确。",
      counts: {
        total: 3,
        machine: 2,
        judged: 1,
        decidedByLawyer: 0,
        notCovered: 1,
        unavailable: 1,
      },
      notCovered: [{ label: "付款与开票", tier: "judge" }],
      unavailable: [{ label: "利率上限" }],
    });
    const host = await render(
      <LawmindJudgmentItemsPanel apiBase="http://127.0.0.1:1" taskId="t1" />,
    );
    const text = host.querySelector('[data-testid="lm-judgment-items"]')?.textContent ?? "";
    expect(text).toContain("共核对 3 项");
    expect(text).toContain("确定性规则判定：2 项");
    expect(text).toContain("未覆盖");
    expect(text).toContain("付款与开票");
    expect(
      host.querySelector('[data-testid="lm-judgment-coverage-note"]')?.textContent,
    ).toContain("通过核对 ≠ 法律正确");
  });

  it("**不可用与未覆盖分开显示**（「没判出来」≠「判出问题」）", async () => {
    mockFetch({
      ok: true,
      present: true,
      counts: { total: 2, machine: 1, judged: 1, decidedByLawyer: 0, notCovered: 0, unavailable: 1 },
      notCovered: [],
      unavailable: [{ label: "利率上限" }],
    });
    const host = await render(
      <LawmindJudgmentItemsPanel apiBase="http://127.0.0.1:1" taskId="t1" />,
    );
    expect(host.querySelector('[data-testid="lm-judgment-not-covered"]')).toBeNull();
    const unavailable = host.querySelector('[data-testid="lm-judgment-unavailable"]');
    expect(unavailable).not.toBeNull();
    expect(unavailable!.textContent).toContain("未能自动核对");
    expect(unavailable!.textContent).toContain("利率上限");
  });

  it("无记录时诚实报「暂无逐项核对记录」", async () => {
    mockFetch({ ok: true, present: false });
    const host = await render(
      <LawmindJudgmentItemsPanel apiBase="http://127.0.0.1:1" taskId="t1" />,
    );
    expect(
      host.querySelector('[data-testid="lm-judgment-items"]')?.textContent,
    ).toContain("暂无逐项核对记录");
  });
});
