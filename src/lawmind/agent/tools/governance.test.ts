import { describe, expect, it } from "vitest";
import {
  CORE_MODEL_TOOL_NAMES,
  LIST_MORE_TOOLS_NAME,
  collectDisclosedToolNames,
  listToolGovernanceMetadata,
  promptCatalogToolNames,
  resolveModelToolNames,
} from "./governance.js";
import { createLegalToolRegistry } from "./legal-tools.js";

describe("tool governance metadata", () => {
  it("covers every registered legal tool", () => {
    const registry = createLegalToolRegistry({ allowWebSearch: true });
    const metadata = listToolGovernanceMetadata(registry);
    expect(metadata).toHaveLength(registry.size());
    expect(new Set(metadata.map((item) => item.name)).size).toBe(registry.size());
  });

  it("marks state-changing tools as lawyer-approved writes", () => {
    const registry = createLegalToolRegistry();
    const byName = new Map(listToolGovernanceMetadata(registry).map((item) => [item.name, item]));
    expect(byName.get("add_case_note")?.runtimeMode).toBe("lawyer_approved_write");
    expect(byName.get("add_case_note")?.requiresApproval).toBe(true);
    expect(byName.get("add_case_note")?.matterScope).toBe("required");
  });

  it("keeps read-only tools retryable and auditable", () => {
    const registry = createLegalToolRegistry();
    const byName = new Map(listToolGovernanceMetadata(registry).map((item) => [item.name, item]));
    expect(byName.get("list_matters")?.runtimeMode).toBe("readonly");
    expect(byName.get("list_matters")?.retryable).toBe(true);
    expect(byName.get("list_matters")?.auditEventKind).toBe("tool_call");
  });

  it("list_templates is read-only (pure listing); set_template_enabled is a lawyer-approved write", () => {
    // list_templates used to silently mutate via set_enabled_for_id while being labeled
    // readonly — that trust gap is closed by splitting the write path into set_template_enabled.
    const registry = createLegalToolRegistry();
    const byName = new Map(listToolGovernanceMetadata(registry).map((item) => [item.name, item]));

    expect(byName.get("list_templates")?.runtimeMode).toBe("readonly");
    expect(byName.get("list_templates")?.requiresApproval).toBe(false);
    expect(byName.get("list_templates")?.idempotent).toBe(true);

    expect(byName.get("set_template_enabled")?.runtimeMode).toBe("lawyer_approved_write");
    expect(byName.get("set_template_enabled")?.requiresApproval).toBe(true);
    expect(byName.get("set_template_enabled")?.riskLevel).toBe("medium");
  });

  it("update_draft is classified as a lawyer-approved write (not readonly)", () => {
    // update_draft mutates drafts/<taskId>.json — it must be in WRITE_TOOLS so
    // governance classifies it as lawyer_approved_write, not readonly.
    const registry = createLegalToolRegistry();
    const byName = new Map(listToolGovernanceMetadata(registry).map((item) => [item.name, item]));

    expect(byName.get("update_draft")?.runtimeMode).toBe("lawyer_approved_write");
    expect(byName.get("update_draft")?.requiresApproval).toBe(true);
    expect(byName.get("update_draft")?.riskLevel).toBe("medium");
  });
});

describe("resolveModelToolNames", () => {
  it("locks the core catalog at 12 plus list_more_tools", () => {
    expect(CORE_MODEL_TOOL_NAMES).toHaveLength(12);
    expect(promptCatalogToolNames()).toHaveLength(13);
    expect(promptCatalogToolNames()).toContain(LIST_MORE_TOOLS_NAME);
  });

  it("defaults OpenAI tools to ≤13 and can disclose execute_workflow this turn", () => {
    const registry = createLegalToolRegistry();
    const registered = registry.listDefinitions().map((def) => def.name);
    const names = resolveModelToolNames({ registeredNames: registered });
    expect(names.length).toBeLessThanOrEqual(13);
    expect(names).toContain(LIST_MORE_TOOLS_NAME);
    expect(names).toContain("research_task");
    expect(names).not.toContain("execute_workflow");

    const disclosed = resolveModelToolNames({
      registeredNames: registered,
      disclosedNames: ["execute_workflow"],
    });
    expect(disclosed).toContain("execute_workflow");
    expect(registry.toOpenAITools({ names }).map((t) => t.function.name)).toEqual(names);
  });

  it("collects disclosed names from list_more_tools results", () => {
    const names = collectDisclosedToolNames({
      conversationHistory: [
        {
          toolCallResponses: [
            {
              name: LIST_MORE_TOOLS_NAME,
              result: { data: { disclosedName: "execute_workflow" } },
            },
          ],
        },
      ],
    });
    expect(names).toEqual(["execute_workflow"]);
  });

  it("lockToAllowNames advertises only the playbook, not core search or list_more_tools", () => {
    const registry = createLegalToolRegistry();
    const registered = registry.listDefinitions().map((def) => def.name);
    const names = resolveModelToolNames({
      registeredNames: registered,
      allowNames: [
        "analyze_document",
        "draft_document",
        "update_draft",
        "apply_surgical_edits",
        "render_tracked_draft",
        "prepare_outbound_mail",
      ],
      disclosedNames: ["search_workspace", "execute_workflow"],
      lockToAllowNames: true,
    });
    expect(names).toEqual([
      "analyze_document",
      "apply_surgical_edits",
      "draft_document",
      "prepare_outbound_mail",
      "render_tracked_draft",
      "update_draft",
    ]);
    expect(names).not.toContain(LIST_MORE_TOOLS_NAME);
    expect(names).not.toContain("search_workspace");
  });

  it("lockToAllowNames with an empty list advertises no tools", () => {
    const registry = createLegalToolRegistry();
    const registered = registry.listDefinitions().map((def) => def.name);
    expect(
      resolveModelToolNames({
        registeredNames: registered,
        allowNames: [],
        lockToAllowNames: true,
      }),
    ).toEqual([]);
  });
});
