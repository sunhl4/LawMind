/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { LawmindDecisionHeader } from "./LawmindDecisionHeader";

describe("LawmindDecisionHeader", () => {
  it("shows the four lawyer lines and 需定夺", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindDecisionHeader
          header={{
            changed: "补全了送达地址",
            why: "与原合同对齐",
            risk: "机械核对仍有 1 项须处理。通过核对 ≠ 法律正确。",
            ready: "needs_decision",
          }}
        />,
      );
    });
    const el = host.querySelector('[data-testid="lm-decision-header"]');
    expect(el?.getAttribute("data-ready")).toBe("needs_decision");
    expect(el?.textContent).toContain("改了什么：补全了送达地址");
    expect(el?.textContent).toContain("为什么：与原合同对齐");
    expect(el?.textContent).toContain("风险：");
    expect(el?.textContent).toContain("需定夺");
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("shows 未能核验 when unverified is present, and omits it when absent", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindDecisionHeader
          header={{
            changed: "起草了意见书",
            why: "按任务要求整理草稿，便于您审阅后交付。",
            risk: "机械核对未见已知缺陷。通过核对 ≠ 法律正确。",
            ready: "usable",
            unverified: "还有待决：引用未核（无检索快照）。",
          }}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-decision-header-unverified"]')?.textContent).toContain(
      "引用未核",
    );
    await act(async () => {
      root.render(
        <LawmindDecisionHeader
          header={{
            changed: "起草了意见书",
            why: "按任务要求整理草稿，便于您审阅后交付。",
            risk: "机械核对未见已知缺陷。通过核对 ≠ 法律正确。",
            ready: "usable",
          }}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-decision-header-unverified"]')).toBeNull();
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("shows the playbook verdict, basis, non-pass items and the lawyer override", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindDecisionHeader
          header={{
            changed: "起草了服务合同",
            why: "按任务要求整理草稿，便于您审阅后交付。",
            risk: "剧本判定 RED，须全面审阅。通过核对 ≠ 法律正确。",
            ready: "needs_decision",
            playbook: {
              verdict: "RED",
              basis: "playbook",
              playbookName: "中国法合同审查（通用）",
              counts: { pass: 1, flag: 0, fail: 1 },
              items: [
                {
                  title: "不得约定无限责任",
                  result: "FAIL",
                  locator: "L12",
                  reasonZh: "出现无限责任表述。",
                },
              ],
              override: { by: "陈律师", reason: "长期客户，已单独提示风险" },
            },
          }}
        />,
      );
    });
    const line = host.querySelector('[data-testid="lm-decision-header-playbook"]')?.textContent ?? "";
    expect(line).toContain("剧本：须全面审阅");
    expect(line).toContain("本所剧本「中国法合同审查（通用）」");
    expect(line).toContain("1 项通过 / 0 项待定 / 1 项不符合");
    expect(line).toContain("不得约定无限责任（FAIL @L12）");
    expect(line).toContain("已由 陈律师 降档：长期客户，已单独提示风险");

    await act(async () => {
      root.render(
        <LawmindDecisionHeader
          header={{
            changed: "起草了备忘录",
            why: "按任务要求整理草稿，便于您审阅后交付。",
            risk: "机械核对未见已知缺陷。通过核对 ≠ 法律正确。",
            ready: "usable",
          }}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-decision-header-playbook"]')).toBeNull();
    act(() => {
      root.unmount();
    });
    host.remove();
  });
});
