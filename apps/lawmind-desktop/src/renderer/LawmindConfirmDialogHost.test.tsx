/**
 * @vitest-environment jsdom
 *
 * 品牌确认弹窗：promise API + Host 组件（打开/确认/取消/Esc/遮罩/焦点/队列）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindConfirmDialogHost } from "./LawmindConfirmDialogHost";
import {
  confirmDialog,
  resetConfirmDialogQueueForTest,
} from "./lawmind-confirm-dialog";

describe("LawmindConfirmDialogHost", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<LawmindConfirmDialogHost />);
    });
  });

  afterEach(() => {
    act(() => {
      resetConfirmDialogQueueForTest();
    });
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  function dialog(): HTMLDivElement | null {
    return document.body.querySelector<HTMLDivElement>('[data-testid="lm-confirm-dialog"]');
  }

  function okButton(): HTMLButtonElement {
    const btn = document.body.querySelector<HTMLButtonElement>('[data-testid="lm-confirm-dialog-ok"]');
    expect(btn).toBeTruthy();
    return btn!;
  }

  function cancelButton(): HTMLButtonElement {
    const btn = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="lm-confirm-dialog-cancel"]',
    );
    expect(btn).toBeTruthy();
    return btn!;
  }

  it("默认不渲染；confirmDialog 打开后渲染标题/正文/aria", async () => {
    expect(dialog()).toBeNull();
    let settled: boolean | null = null;
    void confirmDialog({ title: "确定删除？", body: "不可恢复。", confirmLabel: "删除" }).then(
      (ok) => {
        settled = ok;
      },
    );
    await act(async () => {});
    const dlg = dialog();
    expect(dlg).toBeTruthy();
    expect(dlg!.getAttribute("role")).toBe("dialog");
    expect(dlg!.getAttribute("aria-modal")).toBe("true");
    expect(dlg!.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dlg!.getAttribute("aria-describedby")).toBeTruthy();
    expect(dlg!.textContent).toContain("确定删除？");
    expect(dlg!.textContent).toContain("不可恢复。");
    expect(okButton().textContent).toBe("删除");
    expect(cancelButton().textContent).toBe("取消");
    expect(settled).toBeNull();
  });

  it("点主按钮确认：resolve(true) 并关闭", async () => {
    const p = confirmDialog({ title: "继续？" });
    await act(async () => {});
    okButton().click();
    await act(async () => {});
    await expect(p).resolves.toBe(true);
    expect(dialog()).toBeNull();
  });

  it("点取消：resolve(false) 并关闭", async () => {
    const p = confirmDialog({ title: "继续？" });
    await act(async () => {});
    cancelButton().click();
    await act(async () => {});
    await expect(p).resolves.toBe(false);
    expect(dialog()).toBeNull();
  });

  it("Esc 与遮罩点击均按取消结案", async () => {
    const p1 = confirmDialog({ title: "第一条" });
    await act(async () => {});
    dialog()!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    await act(async () => {});
    await expect(p1).resolves.toBe(false);

    const p2 = confirmDialog({ title: "第二条" });
    await act(async () => {});
    document.body
      .querySelector<HTMLDivElement>('[data-testid="lm-confirm-dialog-backdrop"]')!
      .click();
    await act(async () => {});
    await expect(p2).resolves.toBe(false);
  });

  it("Enter（焦点不在按钮上）按确认结案", async () => {
    const p = confirmDialog({ title: "继续？" });
    await act(async () => {});
    // 把焦点移出按钮，模拟落在对话框容器上
    dialog()!.focus();
    dialog()!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    await act(async () => {});
    await expect(p).resolves.toBe(true);
  });

  it("打开时聚焦主按钮，关闭后归还焦点", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const p = confirmDialog({ title: "继续？" });
    await act(async () => {});
    expect(document.activeElement).toBe(okButton());

    cancelButton().click();
    await act(async () => {});
    await expect(p).resolves.toBe(false);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("danger 语气用危险色主按钮与窄弹窗", async () => {
    void confirmDialog({ title: "删除草稿？", tone: "danger", confirmLabel: "删除" });
    await act(async () => {});
    expect(dialog()!.className).toContain("lm-wizard--danger");
    expect(okButton().className).toContain("lm-btn-destructive");
    await act(async () => {
      resetConfirmDialogQueueForTest();
    });
  });

  it("多条请求排队：结案一条后自动展示下一条", async () => {
    const seen: string[] = [];
    const p1 = confirmDialog({ title: "第一问" }).then((ok) => {
      seen.push(`1:${ok}`);
      return ok;
    });
    const p2 = confirmDialog({ title: "第二问" }).then((ok) => {
      seen.push(`2:${ok}`);
      return ok;
    });
    await act(async () => {});
    expect(dialog()!.textContent).toContain("第一问");
    expect(dialog()!.textContent).not.toContain("第二问");

    okButton().click();
    await act(async () => {});
    await expect(p1).resolves.toBe(true);
    expect(dialog()!.textContent).toContain("第二问");

    cancelButton().click();
    await act(async () => {});
    await expect(p2).resolves.toBe(false);
    expect(seen).toEqual(["1:true", "2:false"]);
    expect(dialog()).toBeNull();
  });
});
