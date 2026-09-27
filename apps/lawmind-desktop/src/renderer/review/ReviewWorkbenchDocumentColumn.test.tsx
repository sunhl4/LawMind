/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type { DraftDocumentEditorValue } from "../lawmind-draft-document-editor";
import { ReviewWorkbenchDocumentColumn } from "./ReviewWorkbenchDocumentColumn";

const detail = {
  taskId: "task-1",
  title: "备忘录",
  output: "docx",
  templateId: "word/legal-memo-default",
  summary: "摘要",
  sections: [{ heading: "结论", body: "正文" }],
  reviewNotes: [],
  reviewStatus: "pending",
  createdAt: "2026-09-01T00:00:00.000Z",
} as ArtifactDraft;

const editorValue: DraftDocumentEditorValue = {
  title: "备忘录",
  summary: "摘要",
  sections: [{ heading: "结论", body: "正文" }],
};

function columnElement(opts: {
  includeProvenance?: boolean;
  onIncludeProvenanceChange?: (checked: boolean) => void;
  onExportWord?: () => void;
  actionMsg?: string | null;
}) {
  return (
    <ReviewWorkbenchDocumentColumn
      apiBase="http://127.0.0.1:1"
      detail={detail}
      editorValue={editorValue}
      savedEditorValue={editorValue}
      editorDirty={false}
      editorSaving={false}
      editorSaveError={null}
      onEditorChange={() => undefined}
      onEditorSave={() => undefined}
      onEditorRevert={() => undefined}
      lastExportPath={null}
      paneVisibility={{ meta: false, editor: false, preview: false }}
      reviewMetaWidth={280}
      reviewEditorWidth={480}
      onReviewEditorResize={() => undefined}
      hasDetailPane={false}
      onExportWord={opts.onExportWord}
      exportReady
      includeProvenance={opts.includeProvenance ?? false}
      onIncludeProvenanceChange={opts.onIncludeProvenanceChange}
      actionMsg={opts.actionMsg}
    />
  );
}

describe("ReviewWorkbenchDocumentColumn export dock", () => {
  it("keeps 导出 Word clickable after 导出来源批注 is checked", async () => {
    const onIncludeProvenanceChange = vi.fn();
    const onExportWord = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        columnElement({
          onIncludeProvenanceChange,
          onExportWord,
        }),
      );
    });

    const checkbox = host.querySelector("input[type='checkbox']");
    if (!(checkbox instanceof HTMLInputElement)) {
      throw new Error("missing provenance checkbox");
    }
    const exportBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("导出 Word"),
    );
    expect(exportBtn).toBeTruthy();
    expect(checkbox.closest("label")?.contains(exportBtn!)).toBe(false);

    await act(async () => {
      checkbox.click();
    });
    expect(onIncludeProvenanceChange).toHaveBeenCalled();

    await act(async () => {
      root.render(
        columnElement({
          includeProvenance: true,
          onIncludeProvenanceChange,
          onExportWord,
        }),
      );
    });
    const checkedExport = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("导出 Word"),
    );
    expect(checkedExport?.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      checkedExport?.click();
    });
    expect(onExportWord).toHaveBeenCalledTimes(1);
    root.unmount();
    host.remove();
  });

  it("shows the export result in the writing dock", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        columnElement({
          onExportWord: () => undefined,
          actionMsg: "导出被拦截：出稿检查未齐，请在改稿页补齐后再导出。",
        }),
      );
    });
    const msg = host.querySelector('[data-testid="lm-review-export-msg"]');
    expect(msg?.textContent).toContain("导出被拦截");
    root.unmount();
    host.remove();
  });
});
