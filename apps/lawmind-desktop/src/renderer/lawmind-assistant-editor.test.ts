import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAssistantDraft,
  deleteAssistant,
  normalizeDraftJobBrief,
  saveAssistantDraft,
} from "./lawmind-assistant-editor.js";

describe("lawmind-assistant-editor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefills create draft from practice-area presetKey", () => {
    const draft = createAssistantDraft(
      "create",
      [{ id: "contract_review", displayName: "合同审查", promptSection: "审查要点" }],
      undefined,
      { presetKey: "contract_review" },
    );
    expect(draft.presetKey).toBe("contract_review");
    expect(draft.displayName).toBe("合同审查");
    expect(draft.customRoleTitle).toBe("合同审查");
  });

  it("builds edit draft from an existing assistant", () => {
    expect(
      createAssistantDraft("edit", [], {
        assistantId: "assistant-1",
        displayName: "诉讼助理",
        introduction: "负责诉讼文书",
        presetKey: "litigation",
        customRoleTitle: "首席诉讼助理",
        customRoleInstructions: "先列争点再写文书",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      }),
    ).toEqual({
      displayName: "诉讼助理",
      introduction: "负责诉讼文书",
      presetKey: "litigation",
      customRoleTitle: "首席诉讼助理",
      customRoleInstructions: "先列争点再写文书",
      // 老助手没有说明书：编辑态回填为空对象，而不是 undefined（表单要能逐项编辑）。
      jobBrief: {},
      orgRole: "",
      reportsToAssistantId: "",
      peerReviewDefaultAssistantId: "",
    });
  });

  it("carries an existing job brief into the edit draft", () => {
    const draft = createAssistantDraft("edit", [], {
      assistantId: "assistant-2",
      displayName: "续签助手",
      introduction: "盯续签",
      jobBrief: { prohibitions: "外发前必须问我" },
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    expect(draft.jobBrief).toEqual({ prohibitions: "外发前必须问我" });
  });

  it("clears a brief the lawyer emptied instead of silently keeping the old value", () => {
    // 省略字段表示「不改」，传空对象才表示「清空」——否则律师删光后旧值会复活。
    expect(normalizeDraftJobBrief({ responsibility: "  ", prohibitions: "\n" })).toEqual({});
    expect(normalizeDraftJobBrief(undefined)).toEqual({});
    expect(normalizeDraftJobBrief({ responsibility: " 盯续签 " })).toEqual({
      responsibility: "盯续签",
    });
  });

  it("sends the whole brief object so an emptied field is actually cleared", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: { body?: string }) => {
        const url = typeof input === "string" ? input : ((input as { url?: string })?.url ?? "");
        calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          text: async () => JSON.stringify({ ok: true }),
          json: async () => ({ ok: true }),
        } as unknown as Response;
      }),
    );
    await saveAssistantDraft({
      apiBase: "http://127.0.0.1:4312",
      editingAssistantId: "assistant-1",
      draft: {
        displayName: "续签助手",
        introduction: "",
        presetKey: "general_default",
        customRoleTitle: "",
        customRoleInstructions: "",
        jobBrief: { prohibitions: "外发前必须问我", escalation: "  " },
        orgRole: "",
        reportsToAssistantId: "",
        peerReviewDefaultAssistantId: "",
      },
    });
    expect(calls[0]?.body).toMatchObject({
      jobBrief: { prohibitions: "外发前必须问我" },
    });
    vi.unstubAllGlobals();
  });

  it("saves assistant draft to the correct endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, assistant: { assistantId: "assistant-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      saveAssistantDraft({
        apiBase: "http://127.0.0.1:4312",
        editingAssistantId: "assistant-1",
        draft: {
          displayName: "诉讼助理",
          introduction: "负责诉讼文书",
          presetKey: "litigation",
          customRoleTitle: "",
          customRoleInstructions: "",
          jobBrief: {},
          orgRole: "",
          reportsToAssistantId: "",
          peerReviewDefaultAssistantId: "",
        },
      }),
    ).resolves.toMatchObject({
      assistant: { assistantId: "assistant-1" },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:4312/api/assistants/assistant-1",
      expect.objectContaining({
        method: "PATCH",
      }),
    );
  });

  it("deletes assistant through the delete endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(deleteAssistant("http://127.0.0.1:4312", "assistant-1")).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:4312/api/assistants/assistant-1",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });
});
