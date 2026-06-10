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
});
