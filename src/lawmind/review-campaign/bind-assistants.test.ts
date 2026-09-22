import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { upsertAssistant } from "../assistants/store.js";
import {
  bindPlaybookRolesToAssistants,
  PLAYBOOK_ROLE_TO_WORKSPACE_ROLE,
} from "./bind-assistants.js";
import type { FleetPlaybookRole } from "./types.js";

describe("bind-assistants", () => {
  let root: string;
  let ws: string;

  afterEach(() => {
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("maps clause/risk to contract_review assistant", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-bind-"));
    ws = path.join(root, "workspace");
    fs.mkdirSync(ws, { recursive: true });
    upsertAssistant(root, {
      assistantId: "asst_c",
      displayName: "合同助手",
      introduction: "",
      roleId: "contract_review",
      presetKey: "contract_review",
    });
    const roles: FleetPlaybookRole[] = [
      {
        id: "clause",
        label: "条款",
        weight: 0.2,
        timeoutMs: 1,
        toolAllowlist: [],
        promptHint: "",
      },
      {
        id: "risk",
        label: "风险",
        weight: 0.3,
        timeoutMs: 1,
        toolAllowlist: [],
        promptHint: "",
      },
    ];
    const bound = bindPlaybookRolesToAssistants(ws, roles);
    expect(PLAYBOOK_ROLE_TO_WORKSPACE_ROLE.clause).toBe("contract_review");
    expect(bound[0]?.boundAssistantId).toBe("asst_c");
    expect(bound[0]?.boundAssistantName).toBe("合同助手");
    expect(bound[1]?.boundAssistantId).toBe("asst_c");
  });

  it("honors explicit assistantId on playbook role", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-bind-"));
    ws = path.join(root, "workspace");
    fs.mkdirSync(ws, { recursive: true });
    upsertAssistant(root, {
      assistantId: "a1",
      displayName: "A",
      introduction: "",
      roleId: "general_default",
    });
    upsertAssistant(root, {
      assistantId: "a2",
      displayName: "B",
      introduction: "",
      roleId: "contract_review",
    });
    const bound = bindPlaybookRolesToAssistants(ws, [
      {
        id: "clause",
        label: "条款",
        weight: 0.2,
        timeoutMs: 1,
        toolAllowlist: [],
        promptHint: "",
        assistantId: "a1",
      },
    ]);
    expect(bound[0]?.boundAssistantId).toBe("a1");
  });
});
