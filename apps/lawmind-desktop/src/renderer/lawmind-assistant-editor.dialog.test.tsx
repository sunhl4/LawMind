/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantDraft, LawmindAssistantEditorDialog } from "./lawmind-assistant-editor";

const presets = [
  { id: "general_default", displayName: "通用法律助理", promptSection: "通用" },
  { id: "contract_review", displayName: "合同审查", promptSection: "审查合同" },
];

describe("LawmindAssistantEditorDialog create wizard", () => {
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

  it("clicking a template card advances to naming", async () => {
    await act(async () => {
      root.render(
        <LawmindAssistantEditorDialog
          open
          editingAssistantId={null}
          draft={createAssistantDraft("create", presets)}
          presets={presets}
          assistantLinkOptions={[]}
          busy={false}
          error={null}
          onChange={vi.fn()}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );
    });
    expect(host.textContent).toContain("选岗位模板");
    const card = host.querySelector('[data-testid="lm-assistant-template-contract_review"]') as HTMLButtonElement;
    expect(card).toBeTruthy();
    await act(async () => {
      card.click();
    });
    expect(host.textContent).toContain("显示名称");
    expect(host.textContent).toContain("已选模板：");
    expect((host.querySelector("input"))?.value).toBe("合同审查");
  });

  it("practice-area create starts at naming with the locked preset", async () => {
    await act(async () => {
      root.render(
        <LawmindAssistantEditorDialog
          open
          editingAssistantId={null}
          draft={createAssistantDraft("create", presets, undefined, { presetKey: "contract_review" })}
          presets={presets}
          assistantLinkOptions={[]}
          busy={false}
          error={null}
          onChange={vi.fn()}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-assistant-template-contract_review"]')).toBeNull();
    expect(host.textContent).toContain("显示名称");
    expect(host.textContent).toContain("合同审查");
  });
});
