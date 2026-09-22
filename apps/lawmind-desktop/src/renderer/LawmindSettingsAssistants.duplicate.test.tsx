/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindSettingsAssistants } from "./LawmindSettingsAssistants";

type PanelProps = ComponentProps<typeof LawmindSettingsAssistants>;

const ASSISTANT = {
  assistantId: "a-1",
  displayName: "区域甲续签助手",
  introduction: "盯续签",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function makeProps(over: Partial<PanelProps> = {}): PanelProps {
  return {
    apiBase: "http://127.0.0.1:1234",
    assistants: [ASSISTANT],
    selectedAssistantId: "a-1",
    onSelectAssistantId: vi.fn(),
    selectedAssistant: ASSISTANT,
    selectedAssistantStats: undefined,
    onOpenNew: vi.fn(),
    onOpenEdit: vi.fn(),
    onRemove: vi.fn(),
    onDuplicate: vi.fn(),
    ...over,
  };
}

describe("LawmindSettingsAssistants 名册复制入口", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify({ ok: true }),
        json: async () => ({ ok: true }),
      })) as unknown as typeof fetch,
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  async function render(props: PanelProps): Promise<void> {
    await act(async () => {
      root.render(<LawmindSettingsAssistants {...props} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("offers a duplicate action next to edit and delete", async () => {
    const props = makeProps();
    await render(props);
    const button = host.querySelector('[data-testid="lm-assistants-duplicate"]');
    expect(button).not.toBeNull();
    expect(button?.textContent?.trim()).toBe("复制");
  });

  it("explains that memory is not copied, right where the lawyer clicks", async () => {
    await render(makeProps());
    const button = host.querySelector('[data-testid="lm-assistants-duplicate"]');
    // 这条提示是产品承诺的一部分：复制的是岗位与边界，不是它知道的客户事。
    expect(button?.getAttribute("title")).toContain("不含它的记忆与用量");
  });

  it("invokes the duplicate handler once", async () => {
    const props = makeProps();
    await render(props);
    const button = host.querySelector<HTMLButtonElement>('[data-testid="lm-assistants-duplicate"]');
    await act(async () => {
      button?.click();
    });
    expect(props.onDuplicate).toHaveBeenCalledTimes(1);
    // 复制不该顺手触发删除或编辑。
    expect(props.onRemove).not.toHaveBeenCalled();
    expect(props.onOpenEdit).not.toHaveBeenCalled();
  });

  it("disables duplicate when there is no assistant to copy", async () => {
    await render(
      makeProps({
        assistants: [],
        selectedAssistantId: "",
        selectedAssistant: undefined,
      }),
    );
    // 空态下根本不该出现这个按钮（空态只有「新建助手」）。
    expect(host.querySelector('[data-testid="lm-assistants-duplicate"]')).toBeNull();
  });
});
