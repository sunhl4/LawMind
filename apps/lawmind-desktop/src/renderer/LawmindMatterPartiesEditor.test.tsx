/**
 * @vitest-environment jsdom
 */
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MatterParty } from "../../../../src/lawmind/desk/matter-parties.ts";
import { LawmindMatterPartiesEditor, LawmindMatterPartyCards } from "./LawmindMatterPartiesEditor";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

function Harness({
  initial,
  onChange,
}: {
  initial: MatterParty[];
  onChange?: (next: MatterParty[]) => void;
}): ReactNode {
  const [parties, setParties] = useState(initial);
  return (
    <LawmindMatterPartiesEditor
      value={parties}
      onChange={(next) => {
        setParties(next);
        onChange?.(next);
      }}
    />
  );
}

/** React tracks the previous value on the node; go through the prototype setter. */
function setInputValue(input: HTMLInputElement, value: string): void {
  // oxlint-disable-next-line typescript/unbound-method -- React 受控输入要走原型 setter。
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  // oxlint-disable-next-line typescript/unbound-method -- React 受控输入要走原型 setter。
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  act(() => {
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function clientParty(contacts?: MatterParty["contacts"]): MatterParty {
  return {
    partyId: "p-client",
    name: "甲公司",
    role: "client",
    ...(contacts ? { contacts } : {}),
  };
}

function counterparty(contacts?: MatterParty["contacts"]): MatterParty {
  return {
    partyId: "p-counterparty",
    name: "乙公司",
    role: "counterparty",
    ...(contacts ? { contacts } : {}),
  };
}

function findByLabel(label: string): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  expect(el).toBeTruthy();
  return el!;
}

function findSelectByLabel(label: string): HTMLSelectElement {
  const el = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  expect(el).toBeTruthy();
  return el!;
}

function render(initial: MatterParty[], onChange?: (next: MatterParty[]) => void): void {
  act(() => {
    root.render(<Harness initial={initial} onChange={onChange} />);
  });
}

describe("LawmindMatterPartiesEditor contacts", () => {
  it("edits a contact value and marks it verified again", () => {
    let latest: MatterParty[] = [];
    render(
      [
        clientParty([
          { kind: "email", value: "a@jia.cn", verified: true, source: "intake_confirmed" },
        ]),
      ],
      (next) => {
        latest = next;
      },
    );

    setInputValue(findByLabel("甲公司 联系方式"), "c@jia.cn");
    expect(findByLabel("甲公司 联系方式").value).toBe("c@jia.cn");
    expect(latest[0]?.contacts?.[0]?.value).toBe("c@jia.cn");
    // 换了地址，旧的「已核实」不再算数，来源改回律师。
    expect(latest[0]?.contacts?.[0]?.verified).toBeUndefined();
    expect(latest[0]?.contacts?.[0]?.source).toBe("lawyer");

    const verified = host.querySelector<HTMLInputElement>(
      "[data-testid='lm-party-contacts'] input[type='checkbox']",
    );
    expect(verified).toBeTruthy();
    act(() => {
      verified!.click();
    });
    expect(latest[0]?.contacts?.[0]?.verified).toBe(true);
  });

  it("adds and removes a contact without inventing one", () => {
    let latest: MatterParty[] = [];
    render([clientParty()], (next) => {
      latest = next;
    });
    expect(host.textContent).toContain("还没有联系方式");

    const add = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "添加联系方式",
    );
    expect(add).toBeTruthy();
    act(() => {
      add!.click();
    });
    expect(latest[0]?.contacts).toHaveLength(1);
    expect(latest[0]?.contacts?.[0]?.kind).toBe("email");
    expect(latest[0]?.contacts?.[0]?.source).toBe("lawyer");

    const remove = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "删除",
    );
    act(() => {
      remove!.click();
    });
    expect(latest[0]?.contacts ?? []).toHaveLength(0);
    expect(host.textContent).toContain("还没有联系方式");
  });

  it("warns when one identity is registered under two parties", () => {
    render([
      clientParty([{ kind: "email", value: "same@example.com", account: "mail-a@firm.cn" }]),
      counterparty([{ kind: "email", value: "same@example.com", account: "mail-a@firm.cn" }]),
    ]);
    const warning = host.querySelector(".lm-party-editor-warning");
    expect(warning?.textContent).toContain("同一联系方式登记在多个当事人名下");
    expect(warning?.textContent).toContain("甲公司 / 乙公司");
  });

  it("keeps the same value under different accounts as two identities", () => {
    render([
      clientParty([{ kind: "email", value: "same@example.com", account: "mail-a@firm.cn" }]),
      counterparty([{ kind: "email", value: "same@example.com", account: "mail-b@firm.cn" }]),
    ]);
    expect(host.querySelector(".lm-party-editor-warning")).toBeNull();
  });

  it("warns about a value that the storage layer would drop", () => {
    render([clientParty([{ kind: "email", value: "not-an-email" }])]);
    expect(host.textContent).toContain("格式无法识别");
    expect(host.textContent).toContain("甲公司 第 1 条");
  });

  it("records recording consent and the WeCom external id", () => {
    let latest: MatterParty[] = [];
    render(
      [
        clientParty([
          { kind: "phone", value: "13800000000", verified: true },
          { kind: "wecom", value: "wm-zhang" },
        ]),
      ],
      (next) => {
        latest = next;
      },
    );

    setSelectValue(findSelectByLabel("甲公司 录音同意"), "denied");
    expect(latest[0]?.contacts?.[0]?.recordingConsent).toMatchObject({
      state: "denied",
      source: "lawyer",
    });
    // 同意状态不是身份，不能把「已核实」一起清掉。
    expect(latest[0]?.contacts?.[0]?.verified).toBe(true);

    setSelectValue(findSelectByLabel("甲公司 录音同意"), "unknown");
    expect(latest[0]?.contacts?.[0]?.recordingConsent).toBeUndefined();
    setSelectValue(findSelectByLabel("甲公司 录音同意"), "denied");

    setInputValue(findByLabel("甲公司 企微 externalId"), "zhangsan");
    expect(latest[0]?.contacts?.[1]?.externalId).toBe("zhangsan");
    // 改 externalId 会换身份键，来源改为律师。
    expect(latest[0]?.contacts?.[1]?.source).toBe("lawyer");
    expect(findSelectByLabel("甲公司 会话存档同意")).toBeTruthy();
  });

  it("does not offer channel-only fields on an email contact", () => {
    render([clientParty([{ kind: "email", value: "a@jia.cn" }])]);
    expect(host.querySelector('select[aria-label="甲公司 录音同意"]')).toBeNull();
    expect(host.querySelector('select[aria-label="甲公司 会话存档同意"]')).toBeNull();
    expect(host.querySelector('input[aria-label="甲公司 企微 externalId"]')).toBeNull();
  });

  it("shows consent state on the read-only party card", () => {
    act(() => {
      root.render(
        <LawmindMatterPartyCards
          parties={[
            clientParty([
              {
                kind: "phone",
                value: "13800000000",
                recordingConsent: { state: "granted", source: "lawyer" },
              },
              {
                kind: "wecom",
                value: "wm-zhang",
                archiveConsent: { state: "denied", source: "lawyer" },
              },
            ]),
          ]}
        />,
      );
    });
    expect(host.textContent).toContain("录音：已同意");
    expect(host.textContent).toContain("存档：已拒绝");
  });
});
