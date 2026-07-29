import { describe, expect, it } from "vitest";
import { listToolGovernanceMetadata } from "./governance.js";
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
