/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDeletionMark,
  applyInsertionText,
  gateWordSurfaceBeforeInput,
  isBlockedDeletionInput,
  isBlockedDeletionKey,
  removeDeletionMark,
  WORD_SURFACE_DEL_CLASS,
  WORD_SURFACE_INS_CLASS,
  wrapCommittedInsertion,
} from "./word-surface-edit";

const undoStack: string[] = [];

function installExecCommandMock(): void {
  document.execCommand = vi.fn((command: string, _ui?: boolean, value?: string) => {
    if (command === "insertHTML" && value != null) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return false;
      }
      const editor = selection.anchorNode?.parentElement?.closest(".lm-word-surface-plain");
      if (editor instanceof HTMLElement) {
        undoStack.push(editor.innerHTML);
      }
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const holder = document.createElement("div");
      holder.innerHTML = value;
      const frag = document.createDocumentFragment();
      let last: Node | null = null;
      while (holder.firstChild) {
        last = holder.firstChild;
        frag.appendChild(holder.firstChild);
      }
      range.insertNode(frag);
      if (last) {
        if (last instanceof HTMLElement && last.tagName === "INS") {
          const inner = document.createRange();
          inner.selectNodeContents(last);
          inner.collapse(false);
          selection.removeAllRanges();
          selection.addRange(inner);
        } else {
          range.setStartAfter(last);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
      return true;
    }
    if (command === "insertText" && value != null) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return false;
      }
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const text = document.createTextNode(value);
      range.insertNode(text);
      range.setStartAfter(text);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
    if (command === "undo") {
      const editor = document.querySelector(".lm-word-surface-plain");
      if (!(editor instanceof HTMLElement) || undoStack.length === 0) {
        return false;
      }
      editor.innerHTML = undoStack.pop() ?? editor.innerHTML;
      return true;
    }
    return false;
  }) as typeof document.execCommand;
}

function plainEditor(html: string): HTMLElement {
  const editor = document.createElement("span");
  editor.className = "lm-word-surface-plain";
  editor.contentEditable = "true";
  editor.innerHTML = html;
  document.body.appendChild(editor);
  return editor;
}

function selectText(node: Node, start: number, end: number): Range {
  const range = document.createRange();
  if (node.nodeType === Node.TEXT_NODE) {
    range.setStart(node, start);
    range.setEnd(node, end);
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}

function collapseAt(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("applyDeletionMark", () => {
  beforeEach(() => {
    undoStack.length = 0;
    installExecCommandMock();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("wraps plain selection with insertHTML so Control+Z can undo", () => {
    const editor = plainEditor("甲方应于十日内付款。");
    const text = editor.firstChild as Text;
    const range = selectText(text, 4, 6);
    expect(applyDeletionMark(range)).toBe(true);
    expect(editor.querySelector(`del.${WORD_SURFACE_DEL_CLASS}`)?.textContent).toBe("十日");
    document.execCommand("undo");
    expect(editor.textContent).toBe("甲方应于十日内付款。");
    expect(editor.querySelector("del")).toBeNull();
  });

  it("can mark text inside nested revision markup", () => {
    const editor = plainEditor(
      '前缀<span class="lm-word-rev"><del class="lm-word-rev-del">旧</del><ins class="lm-word-rev-ins">新</ins></span>后缀',
    );
    const rev = editor.querySelector(".lm-word-rev")!;
    const delNode = rev.querySelector(".lm-word-rev-del")!.firstChild as Text;
    const range = selectText(delNode, 0, 1);
    expect(applyDeletionMark(range)).toBe(true);
    expect(editor.querySelectorAll(`del.${WORD_SURFACE_DEL_CLASS}`).length).toBeGreaterThan(0);
    document.execCommand("undo");
    expect(rev.querySelector(".lm-word-rev-del")?.textContent).toBe("旧");
  });

  it("unwraps a lawyer deletion mark through insertHTML", () => {
    const editor = plainEditor('前缀<del class="lm-word-rev-del">删</del>后缀');
    const del = editor.querySelector("del")!;
    expect(removeDeletionMark(del)).toBe(true);
    expect(editor.textContent).toBe("前缀删后缀");
    expect(editor.querySelector("del")).toBeNull();
  });

  it("removes a painted insertion instead of striking it", () => {
    const editor = plainEditor(
      '<span class="lm-word-rev"><ins class="lm-word-rev-ins">你好</ins></span>',
    );
    const text = editor.querySelector("ins")!.firstChild as Text;
    collapseAt(text, text.length);
    const erased = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
    });
    Object.defineProperty(erased, "target", { value: editor });
    expect(gateWordSurfaceBeforeInput(erased)).toBe(false);
    expect(erased.defaultPrevented).toBe(false);
    expect(editor.querySelector("del")).toBeNull();
    expect(editor.querySelector("ins")?.textContent).toBe("你好");
  });
});

describe("insertion underline", () => {
  beforeEach(() => {
    undoStack.length = 0;
    installExecCommandMock();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("wraps typed text in an underlined ins mark", () => {
    const editor = plainEditor("甲方应于十日内付款。");
    collapseAt(editor.firstChild as Text, 4);
    expect(applyInsertionText("新增")).toBe(true);
    const ins = editor.querySelector(`ins.${WORD_SURFACE_INS_CLASS}`);
    expect(ins?.textContent).toBe("新增");
    expect(editor.textContent).toBe("甲方应于新增十日内付款。");
  });

  it("keeps typing inside the same ins mark", () => {
    const editor = plainEditor('甲<ins class="lm-word-rev-ins">新</ins>乙');
    const insText = editor.querySelector("ins")!.firstChild as Text;
    collapseAt(insText, 1);
    expect(applyInsertionText("增")).toBe(true);
    expect(editor.querySelectorAll("ins").length).toBe(1);
    expect(editor.querySelector("ins")?.textContent).toBe("新增");
  });

  it("gates beforeinput to insert underlined text", () => {
    const editor = plainEditor("甲方应于十日内付款。");
    collapseAt(editor.firstChild as Text, 4);
    const typed = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: "插",
    });
    Object.defineProperty(typed, "target", { value: editor });
    expect(gateWordSurfaceBeforeInput(typed)).toBe(true);
    expect(typed.defaultPrevented).toBe(true);
    expect(editor.querySelector(`ins.${WORD_SURFACE_INS_CLASS}`)?.textContent).toBe("插");
    expect(editor.querySelector("del")).toBeNull();
  });

  it("leaves IME composition untouched, then highlights only the committed word", () => {
    const editor = plainEditor("承包人（乙方）：");
    const text = editor.firstChild as Text;
    collapseAt(text, text.length);
    const composing = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertCompositionText",
      data: "nihao",
      isComposing: true,
    });
    Object.defineProperty(composing, "target", { value: editor });
    expect(gateWordSurfaceBeforeInput(composing)).toBe(false);
    expect(composing.defaultPrevented).toBe(false);
    expect(editor.querySelector("del, ins")).toBeNull();

    text.appendData("你好");
    collapseAt(text, text.length);
    expect(wrapCommittedInsertion("你好")).toBe(true);
    expect(editor.querySelector(`ins.${WORD_SURFACE_INS_CLASS}`)?.textContent).toBe("你好");
    expect(editor.querySelector("del")).toBeNull();
    expect(editor.textContent).toBe("承包人（乙方）：你好");

    const echo = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: "你好",
    });
    Object.defineProperty(echo, "target", { value: editor });
    expect(gateWordSurfaceBeforeInput(echo)).toBe(true);
    expect(echo.defaultPrevented).toBe(true);
    expect(editor.textContent).toBe("承包人（乙方）：你好");
  });
});

describe("deletion gate", () => {
  beforeEach(() => {
    undoStack.length = 0;
    installExecCommandMock();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("blocks hard delete input types and keys", () => {
    expect(isBlockedDeletionInput("deleteContentBackward")).toBe(true);
    expect(isBlockedDeletionInput("deleteByCut")).toBe(true);
    expect(isBlockedDeletionInput("insertText")).toBe(false);
    expect(isBlockedDeletionKey(new KeyboardEvent("keydown", { key: "Backspace" }))).toBe(true);
    expect(isBlockedDeletionKey(new KeyboardEvent("keydown", { key: "Delete" }))).toBe(true);
    expect(isBlockedDeletionKey(new KeyboardEvent("keydown", { key: "x", ctrlKey: true }))).toBe(
      true,
    );
    expect(isBlockedDeletionKey(new KeyboardEvent("keydown", { key: "a" }))).toBe(false);
  });

  it("prevents beforeinput deletes and strikes then inserts over a selection", () => {
    const editor = plainEditor("甲方应于十日内付款。");
    const text = editor.firstChild as Text;
    selectText(text, 4, 6);
    const blocked = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
    });
    Object.defineProperty(blocked, "target", { value: editor });
    expect(gateWordSurfaceBeforeInput(blocked)).toBe(true);
    expect(blocked.defaultPrevented).toBe(true);
    expect(editor.querySelector("del")?.textContent).toBe("十日");

    const fresh = plainEditor("甲方应于十日内付款。");
    selectText(fresh.firstChild as Text, 4, 6);
    const over = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: "五",
    });
    Object.defineProperty(over, "target", { value: fresh });
    expect(gateWordSurfaceBeforeInput(over)).toBe(true);
    expect(fresh.querySelector("del")?.textContent).toBe("十日");
    expect(fresh.querySelector(`ins.${WORD_SURFACE_INS_CLASS}`)?.textContent).toBe("五");
  });
});
