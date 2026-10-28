/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LawmindIntakeDetail, type LawmindIntakeDetailProps } from "./LawmindIntakeDetail";
import type { IntakeItem } from "../../../../src/lawmind/intake/types.ts";

function intakeItem(patch: Partial<IntakeItem> = {}): IntakeItem & { text: string } {
  return {
    schemaVersion: 1,
    id: "it-abc12345",
    channel: "email",
    externalKey: "email:acc-1:message-1",
    trust: "untrusted",
    receivedAt: "2026-10-26T01:00:00.000Z",
    recordedAt: "2026-10-26T01:00:05.000Z",
    from: { display: "张三 <zhang@client.test>", address: "zhang@client.test" },
    to: "intake@firm.test",
    subject: "补充证据材料",
    text: "随信附上合同原件。",
    attachments: [
      { name: "合同.pdf", size: 2048, contentType: "application/pdf", sha256: "a".repeat(64) },
      { name: "clip.mp4", size: 4096, skippedReason: "type_not_persisted" },
    ],
    status: "pending",
    ...patch,
  };
}

describe("LawmindIntakeDetail", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function renderDetail(extra: Partial<LawmindIntakeDetailProps> = {}) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onMatterIdChange = vi.fn();
    const onRememberSenderChange = vi.fn();
    const onLeadTitleChange = vi.fn();
    const onLeadAction = vi.fn();
    act(() => {
      root.render(
        <LawmindIntakeDetail
          item={intakeItem()}
          loading={false}
          matterId="matter-a"
          onMatterIdChange={onMatterIdChange}
          matterChoices={["matter-a", "matter-b"]}
          matterLabelById={{ "matter-a": "甲案", "matter-b": "乙案" }}
          rememberSender={false}
          onRememberSenderChange={onRememberSenderChange}
          leadTitle=""
          onLeadTitleChange={onLeadTitleChange}
          onLeadAction={onLeadAction}
          {...extra}
        />,
      );
    });
    return { onMatterIdChange, onRememberSenderChange, onLeadTitleChange, onLeadAction };
  }

  it("shows strong and weak evidence separately and does not auto-file", () => {
    renderDetail({
      item: intakeItem({
        resolution: {
          decision: "propose",
          resolvedAt: "2026-10-26T01:00:06.000Z",
          candidates: [
            {
              matterId: "matter-a",
              title: "甲案",
              score: 20,
              strong: true,
              keys: [
                { kind: "case_no", matterId: "matter-a", detail: "提到本案案号 (2026)沪01民初123号" },
              ],
            },
            {
              matterId: "matter-b",
              title: "乙案",
              score: 3,
              strong: false,
              keys: [{ kind: "party_name", matterId: "matter-b", detail: "提到当事人「乙公司」" }],
            },
          ],
        },
      }),
    });

    const detail = host.querySelector('[data-testid="lm-fleet-intake-detail"]');
    expect(detail?.textContent).toContain("补充证据材料");
    expect(detail?.textContent).toContain("案号：提到本案案号");
    expect(detail?.textContent).toContain("当事人姓名：提到当事人「乙公司」");
    expect(detail?.textContent).toContain("强线索");
    expect(detail?.textContent).toContain("弱线索");
    // 一条强线索也要律师确认，界面不写「已归案」。
    expect(detail?.textContent).not.toContain("已归案");
  });

  it("opens a PDF preview and offers no view button for skipped attachments", () => {
    const onPreviewAttachment = vi.fn();
    renderDetail({
      onPreviewAttachment,
      previewAttachment: {
        index: 0,
        name: "合同.pdf",
        kind: "pdf",
        url: "blob:preview",
        text: null,
        error: null,
      },
    });
    const view = [...host.querySelectorAll("button")].filter(
      (button) => button.textContent === "查看",
    );
    expect(view).toHaveLength(1);
    act(() => {
      view[0].click();
    });
    expect(onPreviewAttachment).toHaveBeenCalledWith(0);
    const preview = host.querySelector('[data-testid="lm-fleet-intake-attachment-preview"]');
    expect(preview?.querySelector("iframe")?.getAttribute("src")).toBe("blob:preview");
    expect(preview?.textContent).toContain("下载原件");
  });

  it("renders a text preview and refuses to inline executable files", () => {
    renderDetail({
      onPreviewAttachment: vi.fn(),
      previewAttachment: {
        index: 0,
        name: "证据.txt",
        kind: "text",
        url: null,
        text: "第一行\n第二行",
        error: null,
      },
    });
    expect(host.querySelector(".lm-intake-attachment-preview-text")?.textContent).toContain(
      "第一行",
    );

    renderDetail({
      onPreviewAttachment: vi.fn(),
      previewAttachment: {
        index: 0,
        name: "图示.svg",
        kind: "other",
        url: null,
        text: null,
        error: null,
      },
    });
    const preview = host.querySelector('[data-testid="lm-fleet-intake-attachment-preview"]');
    expect(preview?.textContent).toContain("不能在 LawMind 里预览");
    expect(preview?.querySelector("iframe")).toBeNull();
    expect(preview?.querySelector("img")).toBeNull();
  });

  it("compares multiple candidates key by key", () => {
    renderDetail({
      item: intakeItem({
        resolution: {
          decision: "propose",
          resolvedAt: "2026-10-26T01:00:06.000Z",
          candidates: [
            {
              matterId: "matter-a",
              title: "甲案",
              score: 20,
              strong: true,
              keys: [
                { kind: "thread", matterId: "matter-a", detail: "同一邮件线程" },
                { kind: "case_no", matterId: "matter-a", detail: "案号 (2026)沪01民初123号" },
              ],
            },
            {
              matterId: "matter-b",
              title: "乙案",
              score: 8,
              strong: true,
              keys: [{ kind: "case_no", matterId: "matter-b", detail: "案号 (2025)沪01民初999号" }],
            },
          ],
        },
      }),
    });
    const table = host.querySelector('[data-testid="lm-fleet-intake-candidate-compare"]');
    expect(table).toBeTruthy();
    expect(table?.textContent).toContain("甲案");
    expect(table?.textContent).toContain("乙案");
    expect(table?.textContent).toContain("(2026)沪01民初123号");
    expect(table?.textContent).toContain("(2025)沪01民初999号");
    // 乙案没有线程线索：该格必须是「—」，不能空着像命中。
    expect(table?.textContent).toContain("—");
    const rowLabels = [...table!.querySelectorAll("tbody th")].map((th) => th.textContent);
    expect(rowLabels.indexOf("往来线程")).toBeLessThan(rowLabels.indexOf("案号"));
  });

  it("does not render the comparison table for a single candidate", () => {
    renderDetail({
      item: intakeItem({
        resolution: {
          decision: "propose",
          resolvedAt: "2026-10-26T01:00:06.000Z",
          candidates: [
            {
              matterId: "matter-a",
              title: "甲案",
              score: 20,
              strong: true,
              keys: [{ kind: "case_no", matterId: "matter-a", detail: "案号 (2026)沪01民初123号" }],
            },
          ],
        },
      }),
    });
    expect(host.querySelector('[data-testid="lm-fleet-intake-candidate-compare"]')).toBeNull();
  });

  it("warns when DMARC failed and lists attachments with skipped reasons", () => {
    renderDetail({ item: intakeItem({ dmarc: "fail" }) });
    const summary = host.querySelector('[data-testid="lm-fleet-intake-summary"]');
    expect(summary?.textContent).toContain("发件域认证未通过");
    const attachments = host.querySelector('[data-testid="lm-fleet-intake-attachments"]');
    expect(attachments?.textContent).toContain("合同.pdf");
    expect(attachments?.textContent).toContain("2 KB");
    expect(attachments?.textContent).toContain("类型不存档");
    expect(host.querySelector('[data-testid="lm-fleet-intake-body"]')?.textContent).toContain(
      "随信附上合同原件。",
    );
  });

  it("lets the lawyer pick a matter and choose to remember the sender", () => {
    const { onMatterIdChange, onRememberSenderChange } = renderDetail();
    const select = host.querySelector<HTMLSelectElement>(
      '[data-testid="lm-fleet-intake-matter-select"]',
    );
    expect(select?.value).toBe("matter-a");
    expect(select?.textContent).toContain("甲案");

    act(() => {
      if (select) {
        select.value = "matter-b";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(onMatterIdChange).toHaveBeenCalledWith("matter-b");

    const remember = host.querySelector<HTMLInputElement>(
      '[data-testid="lm-fleet-intake-remember-sender"]',
    );
    expect(remember?.checked).toBe(false);
    act(() => remember?.click());
    expect(onRememberSenderChange).toHaveBeenCalledWith(true);
  });

  it("hides the remember-sender option when there is no sender address", () => {
    renderDetail({
      item: intakeItem({ channel: "dropzone", from: undefined, subject: "起诉材料" }),
    });
    expect(host.querySelector('[data-testid="lm-fleet-intake-remember-sender"]')).toBeNull();
    expect(host.textContent).toContain("没有解析出发件地址");
    expect(host.querySelector('[data-testid="lm-fleet-intake-dropzone-hint"]')).toBeTruthy();
  });

  it("renders an empty candidate hint instead of inventing a case", () => {
    renderDetail({ item: intakeItem({ resolution: undefined }), matterId: "" });
    const candidates = host.querySelector('[data-testid="lm-fleet-intake-candidates"]');
    expect(candidates?.textContent).toContain("没有命中任何在办案件");
    expect(host.querySelector('[data-testid="lm-fleet-intake-weak-note"]')).toBeTruthy();
  });

  it("drives new-case lead stages and blocks 进入收案 until a name is typed", () => {
    const { onLeadAction, onLeadTitleChange } = renderDetail({
      item: intakeItem({ resolution: { decision: "unmatched", candidates: [], resolvedAt: "2026-10-26T01:00:06.000Z" } }),
    });

    const lead = host.querySelector('[data-testid="lm-fleet-intake-lead"]');
    expect(lead?.textContent).toContain("当作新案线索");
    expect(lead?.textContent).toContain("只建「收案中」的案件");

    const accept = host.querySelector<HTMLButtonElement>(
      '[data-testid="lm-fleet-intake-lead-accept"]',
    );
    expect(accept?.disabled).toBe(true);

    act(() => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-fleet-intake-lead-needs-info"]')?.click();
      host.querySelector<HTMLButtonElement>('[data-testid="lm-fleet-intake-lead-conflict"]')?.click();
      host.querySelector<HTMLButtonElement>('[data-testid="lm-fleet-intake-lead-decline"]')?.click();
    });
    expect(onLeadAction.mock.calls.map((call) => call[0])).toEqual([
      "needs_info",
      "conflict_pending",
      "declined",
    ]);

    const title = host.querySelector<HTMLInputElement>('[data-testid="lm-fleet-intake-lead-title"]');
    act(() => {
      if (title) {
        // React 的受控输入要走原生 setter，否则它自己的值追踪看不到变化。
        // oxlint-disable-next-line typescript/unbound-method -- React 受控输入要走原型 setter。
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setValue?.call(title, "李四买卖合同纠纷");
        title.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(onLeadTitleChange).toHaveBeenCalled();
  });

  it("shows the current lead stage and allows accepting with a name", () => {
    const { onLeadAction } = renderDetail({
      leadTitle: "李四买卖合同纠纷",
      item: intakeItem({
        lead: {
          stage: "conflict_pending",
          at: "2026-10-26T02:00:00.000Z",
          by: "lawyer",
          note: "先查对方是否老客户",
        },
      }),
    });

    const lead = host.querySelector('[data-testid="lm-fleet-intake-lead"]');
    expect(lead?.textContent).toContain("现在：待冲突检查");
    expect(lead?.textContent).toContain("先查对方是否老客户");
    const accept = host.querySelector<HTMLButtonElement>(
      '[data-testid="lm-fleet-intake-lead-accept"]',
    );
    expect(accept?.disabled).toBe(false);
    act(() => accept?.click());
    expect(onLeadAction).toHaveBeenCalledWith("accept");
  });

  it("plays the recording, shows transcript segments, and saves a speaker label", () => {
    const onSpeakerLabelChange = vi.fn();
    renderDetail({
      audioUrl: "blob:test-audio",
      onSpeakerLabelChange,
      item: intakeItem({
        channel: "recording",
        from: undefined,
        attachments: [{ name: "通话.mp3", size: 1024, sha256: "b".repeat(64) }],
        text: "甲：你好。乙：收到。",
        transcript: {
          segments: [
            { startMs: 0, endMs: 1500, speaker: "S1", text: "甲：你好。" },
            { startMs: 1500, endMs: 3000, speaker: "S2", text: "乙：收到。" },
          ],
          speakerLabels: { S1: "张三" },
        },
      }),
    });

    const audio = host.querySelector('[data-testid="lm-intake-audio"]');
    expect(audio?.getAttribute("src")).toBe("blob:test-audio");
    expect(host.textContent).toContain("甲：你好。");
    expect(host.textContent).toContain("张三");
    expect(host.textContent).toContain("S2");

    const input = host.querySelector<HTMLInputElement>('[data-testid="lm-intake-speaker-S2"]');
    expect(input).toBeTruthy();
    act(() => {
      if (input) {
        // oxlint-disable-next-line typescript/unbound-method -- React 受控输入要走原型 setter。
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setValue?.call(input, "李四");
        input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      }
    });
    expect(onSpeakerLabelChange).toHaveBeenCalledWith("S2", "李四");
  });

  it("maps a speaker to a party and shows the party name", () => {
    const onSpeakerPartyChange = vi.fn();
    renderDetail({
      matterId: "matter-a",
      partyChoices: [
        { partyId: "p-client", name: "甲公司" },
        { partyId: "p-counterparty", name: "乙公司" },
      ],
      onSpeakerPartyChange,
      item: intakeItem({
        channel: "recording",
        from: undefined,
        attachments: [{ name: "通话.mp3", size: 10, sha256: "b".repeat(64) }],
        text: "甲：你好。",
        transcript: {
          segments: [{ startMs: 0, endMs: 1000, speaker: "S1", text: "甲：你好。" }],
          speakerParties: { S1: { matterId: "matter-a", partyId: "p-client" } },
        },
      }),
    });

    expect(host.textContent).toContain("甲公司");
    const select = host.querySelector<HTMLSelectElement>(
      '[data-testid="lm-intake-speaker-party-S1"]',
    );
    expect(select).toBeTruthy();
    expect(select?.value).toBe("p-client");
    act(() => {
      if (select) {
        select.value = "p-counterparty";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(onSpeakerPartyChange).toHaveBeenCalledWith("S1", "p-counterparty");
  });

  it("seeks the recording to the clicked transcript segment", () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(async () => {});
    try {
      renderDetail({
        audioUrl: "blob:test-audio",
        item: intakeItem({
          channel: "recording",
          from: undefined,
          attachments: [{ name: "通话.mp3", size: 10, sha256: "b".repeat(64) }],
          text: "甲：你好。乙：收到。",
          transcript: {
            segments: [
              { startMs: 0, endMs: 1500, speaker: "S1", text: "甲：你好。" },
              { startMs: 1500, endMs: 3000, speaker: "S2", text: "乙：收到。" },
            ],
          },
        }),
      });
      const seek = host.querySelector<HTMLButtonElement>('[data-testid="lm-intake-seek-1"]');
      expect(seek).toBeTruthy();
      act(() => seek?.click());
      expect(play).toHaveBeenCalled();
    } finally {
      play.mockRestore();
    }
  });

  it("edits one transcript segment and saves it", () => {
    const onSegmentTextChange = vi.fn();
    renderDetail({
      audioUrl: "blob:test-audio",
      onSegmentTextChange,
      item: intakeItem({
        channel: "recording",
        from: undefined,
        attachments: [{ name: "通话.mp3", size: 10, sha256: "b".repeat(64) }],
        text: "甲：你好。",
        transcript: {
          segments: [
            {
              startMs: 0,
              endMs: 1000,
              speaker: "S1",
              text: "甲：你好。",
              editedAt: "2026-10-27T02:00:00.000Z",
            },
          ],
        },
      }),
    });

    expect(host.textContent).toContain("已改正");
    const edit = host.querySelector<HTMLButtonElement>('[data-testid="lm-intake-segment-edit-0"]');
    expect(edit).toBeTruthy();
    act(() => edit?.click());
    const input = host.querySelector<HTMLTextAreaElement>(
      '[data-testid="lm-intake-segment-input-0"]',
    );
    expect(input?.value).toBe("甲：你好。");
    act(() => {
      if (input) {
        // oxlint-disable-next-line typescript/unbound-method -- React 受控输入要走原型 setter。
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setValue?.call(input, "甲：您好。");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    const save = host.querySelector<HTMLButtonElement>(
      '[data-testid="lm-intake-segment-save-0"]',
    );
    act(() => save?.click());
    expect(onSegmentTextChange).toHaveBeenCalledWith(0, "甲：您好。");
  });
});
