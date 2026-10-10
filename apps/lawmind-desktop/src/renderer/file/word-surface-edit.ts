/**
 * In-page Word edits must go through the contenteditable undo stack.
 * Wrapping a range with DOM APIs is invisible to Control+Z; insertHTML is not.
 *
 * Hard deletes of original text become a deletion line. Deleting characters
 * inside an insertion removes them, the same way Word undoes typed text.
 */

export const WORD_SURFACE_DEL_CLASS = "lm-word-rev-del";
export const WORD_SURFACE_INS_CLASS = "lm-word-rev-ins";

const DELETION_INPUT_TYPES = new Set([
  "deleteContentBackward",
  "deleteContentForward",
  "deleteByCut",
  "deleteByDrag",
  "deleteContent",
  "deleteWordBackward",
  "deleteWordForward",
  "deleteSoftLineBackward",
  "deleteSoftLineForward",
  "deleteHardLineBackward",
  "deleteHardLineForward",
  "deleteEntireSoftLine",
]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function wordSurfaceEditorOf(node: Node | null | undefined): HTMLElement | null {
  const el = node instanceof Element ? node : node?.parentElement;
  const editor = el?.closest(".lm-word-surface-plain");
  return editor instanceof HTMLElement ? editor : null;
}

/** Lawyer-typed insertion mark — not a painted agent revision inside .lm-word-rev. */
export function lawyerInsertionOf(node: Node | null | undefined): HTMLElement | null {
  const el = node instanceof Element ? node : node?.parentElement;
  const ins = el?.closest(`ins.${WORD_SURFACE_INS_CLASS}`);
  if (!(ins instanceof HTMLElement) || ins.closest(".lm-word-rev") || ins.closest(".lm-word-track")) {
    return null;
  }
  return ins;
}

function restoreRange(range: Range): void {
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function placeCaretInside(el: HTMLElement, atEnd = true): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function execInsertHtml(range: Range, html: string): boolean {
  if (typeof document.execCommand !== "function") {
    return false;
  }
  const editor = wordSurfaceEditorOf(range.commonAncestorContainer);
  if (!editor) {
    return false;
  }
  editor.focus();
  restoreRange(range);
  return document.execCommand("insertHTML", false, html);
}

function caretRange(): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  return wordSurfaceEditorOf(range.commonAncestorContainer) ? range : null;
}

function expandOneCharacter(range: Range, backward: boolean): Range | null {
  const node = range.startContainer;
  const offset = range.startOffset;
  if (node.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  const text = node.textContent ?? "";
  const next = range.cloneRange();
  if (backward) {
    if (offset <= 0) {
      return null;
    }
    next.setStart(node, offset - 1);
    next.setEnd(node, offset);
    return next;
  }
  if (offset >= text.length) {
    return null;
  }
  next.setStart(node, offset);
  next.setEnd(node, offset + 1);
  return next;
}

/** Any underlined insertion, including one already painted as a revision. */
function insertionElement(node: Node | null | undefined): HTMLElement | null {
  const el = node instanceof Element ? node : node?.parentElement;
  const ins = el?.closest("ins");
  return ins instanceof HTMLElement ? ins : null;
}

/**
 * Backspace inside text this user inserted removes those characters.
 * Word does not turn that into a strikethrough.
 */
function deletionInsideInsertion(range: Range): boolean {
  const start = insertionElement(range.startContainer);
  if (!start) {
    return false;
  }
  if (range.collapsed) {
    return true;
  }
  return insertionElement(range.endContainer) === start;
}

/**
 * Turn Backspace / Delete into a deletion revision. Returns false when the
 * browser should delete natively (the caret is inside text this user just inserted).
 */
export function applyKeyboardDeletion(inputType: string): boolean {
  const range = caretRange();
  if (!range) {
    return false;
  }
  if (deletionInsideInsertion(range)) {
    return false;
  }
  const backward =
    inputType === "deleteContentBackward" ||
    inputType === "deleteWordBackward" ||
    inputType === "deleteSoftLineBackward" ||
    inputType === "deleteHardLineBackward";
  const target = range.collapsed ? expandOneCharacter(range, backward || !inputType.includes("Forward")) : range;
  if (!target?.toString()) {
    return true;
  }
  const anchor = target.commonAncestorContainer;
  const el = anchor instanceof Element ? anchor : anchor.parentElement;
  if (el?.closest("del")) {
    return true;
  }
  applyDeletionMark(target);
  return true;
}

/** Mark the selected span as a deletion. Returns false when the range is not in the page. */
export function applyDeletionMark(range: Range): boolean {
  const visible = range.toString();
  if (!visible) {
    return false;
  }
  // Nested revision spans break insertHTML; flat text keeps the undo stack working.
  const html = `<del class="${WORD_SURFACE_DEL_CLASS}">${escapeHtml(visible)}</del>`;
  return execInsertHtml(range, html);
}

/** Unwrap a deletion mark. Prefers insertHTML so Control+Z can put the mark back. */
export function removeDeletionMark(del: Element): boolean {
  const editor = wordSurfaceEditorOf(del);
  if (!editor || !del.parentNode) {
    return false;
  }
  const range = document.createRange();
  range.selectNode(del);
  editor.focus();
  restoreRange(range);
  return execInsertHtml(range, del.innerHTML);
}

/**
 * Insert underlined lawyer text. Reuses the current <ins> when the caret is
 * already inside one so continuous typing stays one mark.
 */
export function applyInsertionText(text: string, options?: { move?: boolean }): boolean {
  if (!text) {
    return false;
  }
  const range = caretRange();
  if (!range) {
    return false;
  }
  const existing = lawyerInsertionOf(range.startContainer);
  if (existing) {
    if (options?.move) {
      existing.dataset.move = "1";
    }
    if (typeof document.execCommand !== "function") {
      return false;
    }
    const editor = existing.closest(".lm-word-surface-plain");
    if (editor instanceof HTMLElement) {
      editor.focus();
    }
    restoreRange(range);
    return document.execCommand("insertText", false, text);
  }
  const moveAttr = options?.move ? ' data-move="1"' : "";
  if (!execInsertHtml(range, `<ins class="${WORD_SURFACE_INS_CLASS}"${moveAttr}>${escapeHtml(text)}</ins>`)) {
    return false;
  }
  const selection = window.getSelection();
  const created = lawyerInsertionOf(selection?.anchorNode ?? null);
  if (created) {
    placeCaretInside(created, true);
  }
  return true;
}

let pendingMoveText: string | null = null;

/** Remember a cut so the matching paste is a move, not a fresh insertion. */
export function rememberMove(text: string): void {
  pendingMoveText = text || null;
}

export function consumeMovePaste(text: string): boolean {
  if (!pendingMoveText || pendingMoveText !== text) {
    return false;
  }
  pendingMoveText = null;
  return true;
}

let suppressNextInsert: string | null = null;

/**
 * Chromium emits a second insertText after compositionend with the same
 * committed string. Swallow that echo so「你好」is not written twice.
 * Clear on a macrotask: a microtask runs before the queued beforeinput.
 */
export function suppressCompositionEcho(committed: string): void {
  if (!committed) {
    return;
  }
  suppressNextInsert = committed;
  window.setTimeout(() => {
    if (suppressNextInsert === committed) {
      suppressNextInsert = null;
    }
  }, 80);
}

/**
 * After an IME commits (compositionend), the final string is already in the
 * DOM. Wrap only that string in <ins>. Do not touch the document while the
 * candidate is still composing — that commits pinyin and can strike it.
 */
export function wrapCommittedInsertion(committed: string): boolean {
  if (!committed) {
    return false;
  }
  suppressCompositionEcho(committed);
  const caret = caretRange();
  if (!caret?.collapsed) {
    return false;
  }
  if (lawyerInsertionOf(caret.startContainer)) {
    return true;
  }
  const found = rangeEndingWith(caret, committed);
  if (!found) {
    return false;
  }
  const ins = document.createElement("ins");
  ins.className = WORD_SURFACE_INS_CLASS;
  try {
    found.surroundContents(ins);
  } catch {
    if (!execInsertHtml(found, `<ins class="${WORD_SURFACE_INS_CLASS}">${escapeHtml(committed)}</ins>`)) {
      return false;
    }
  }
  const created = lawyerInsertionOf(window.getSelection()?.anchorNode ?? null) ?? ins;
  placeCaretInside(created, true);
  return true;
}

function rangeEndingWith(caret: Range, text: string): Range | null {
  const node = caret.startContainer;
  const offset = caret.startOffset;
  if (node.nodeType === Node.TEXT_NODE) {
    const content = node.textContent ?? "";
    if (offset >= text.length && content.slice(offset - text.length, offset) === text) {
      const range = document.createRange();
      range.setStart(node, offset - text.length);
      range.setEnd(node, offset);
      return range;
    }
  }
  if (node instanceof Element && offset > 0) {
    const prev = node.childNodes[offset - 1];
    if (prev?.nodeType === Node.TEXT_NODE) {
      const content = prev.textContent ?? "";
      if (content.endsWith(text)) {
        const range = document.createRange();
        range.setStart(prev, content.length - text.length);
        range.setEnd(prev, content.length);
        return range;
      }
    }
  }
  return null;
}

function consumeSuppressedInsert(data: string): boolean {
  if (suppressNextInsert !== data) {
    return false;
  }
  suppressNextInsert = null;
  return true;
}

/** Focus the active plain editor, then undo or redo through the browser stack. */
export function wordSurfaceUndoRedo(anchor: Node | null, shiftKey: boolean): void {
  const editor = wordSurfaceEditorOf(anchor);
  editor?.focus();
  if (typeof document.execCommand !== "function") {
    return;
  }
  document.execCommand(shiftKey ? "redo" : "undo");
}

export function isWordSurfaceKeyTarget(root: Node, event: KeyboardEvent): boolean {
  const target = event.target;
  if (target instanceof Node && root.contains(target)) {
    return true;
  }
  const active = document.activeElement;
  if (active instanceof Node && root.contains(active)) {
    return true;
  }
  const anchor = window.getSelection()?.anchorNode;
  return Boolean(anchor && root.contains(anchor));
}

export function isBlockedDeletionInput(inputType: string): boolean {
  return DELETION_INPUT_TYPES.has(inputType) || inputType.startsWith("delete");
}

/** Backspace / Delete / Ctrl|Cmd+X — hard removes that skip the rail. */
export function isBlockedDeletionKey(event: KeyboardEvent): boolean {
  const key = event.key;
  if (key === "Backspace" || key === "Delete") {
    return true;
  }
  if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "x") {
    return true;
  }
  return false;
}

function selectedEditorRange(): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.toString()) {
    return null;
  }
  const range = selection.getRangeAt(0);
  return wordSurfaceEditorOf(range.commonAncestorContainer) ? range : null;
}

function pastePlainText(event: InputEvent): string {
  const data = event.data ?? "";
  if (data) {
    return data;
  }
  try {
    return event.dataTransfer?.getData("text/plain") ?? "";
  } catch {
    return "";
  }
}

/**
 * contenteditable beforeinput gate.
 * - Original text: Backspace / Delete becomes a deletion line.
 * - Inserted text: the characters come out, with no strikethrough.
 * - Types / pastes as underlined <ins>.
 * - Composition (IME) is left to the browser once the caret is inside <ins>.
 * Returns true when the default action was prevented or rewritten.
 */
export function gateWordSurfaceBeforeInput(event: InputEvent): boolean {
  const target = event.target;
  if (!(target instanceof Node) || !wordSurfaceEditorOf(target)) {
    return false;
  }
  if (isBlockedDeletionInput(event.inputType)) {
    if (!applyKeyboardDeletion(event.inputType)) {
      return false;
    }
    event.preventDefault();
    return true;
  }
  if (!event.inputType.startsWith("insert")) {
    return false;
  }
  // Non-engine surface cannot round-trip new paragraphs; swallow Enter.
  if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
    event.preventDefault();
    return true;
  }
  // Leave the IME candidate alone. compositionend wraps the committed string.
  if (event.inputType === "insertCompositionText" || event.isComposing) {
    return false;
  }
  if (event.inputType === "insertText" && event.data && consumeSuppressedInsert(event.data)) {
    event.preventDefault();
    return true;
  }
  const over = selectedEditorRange();
  if (over) {
    event.preventDefault();
    if (!applyDeletionMark(over)) {
      return true;
    }
  }
  const text =
    event.inputType === "insertFromPaste" || event.inputType === "insertFromDrop"
      ? pastePlainText(event)
      : (event.data ?? "");
  if (!text) {
    if (over) {
      return true;
    }
    return false;
  }
  const move = event.inputType === "insertFromPaste" && consumeMovePaste(text);
  if (!over && lawyerInsertionOf(caretRange()?.startContainer ?? target) && !move) {
    return false;
  }
  event.preventDefault();
  applyInsertionText(text, { move });
  return true;
}
