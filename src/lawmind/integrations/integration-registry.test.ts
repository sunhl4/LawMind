import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import {
  assertMatterScope,
  listIntegrationDocuments,
  listIntegrationConnectorStatuses,
} from "./integration-registry.js";

describe("integration-registry", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("lists filesystem documents under cases/<matterId>/", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-integ-"));
    dirs.push(ws);
    createMatterIfMissing(ws, { matterId: "matter-int-1", title: "Integ Test" });
    const caseDir = path.join(ws, "cases", "matter-int-1");
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(path.join(caseDir, "contract.pdf"), "pdf-bytes");
    fs.writeFileSync(path.join(caseDir, ".lawmind-role.txt"), "matter");

    const result = listIntegrationDocuments(ws, "filesystem", "matter-int-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documents.length).toBe(1);
      expect(result.documents[0]?.name).toBe("contract.pdf");
    }
  });

  it("rejects missing matterId", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-integ-"));
    dirs.push(ws);
    const err = assertMatterScope(ws, "");
    expect(err?.error).toBe("matter_id_required");
  });

  it("stub DMS connector returns unconfigured when enabled without API", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-integ-"));
    dirs.push(ws);
    createMatterIfMissing(ws, { matterId: "matter-int-2", title: "DMS" });
    fs.mkdirSync(path.join(ws, "lawmind"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "lawmind", "integrations.json"),
      JSON.stringify({ connectors: { imanage: { enabled: true, baseUrl: "https://example" } } }),
    );
    const result = listIntegrationDocuments(ws, "imanage", "matter-int-2");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("connector_unconfigured");
    }
  });

  it("catalog includes filesystem as active by default", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-integ-"));
    dirs.push(ws);
    const statuses = listIntegrationConnectorStatuses(ws);
    const fsConn = statuses.find((s) => s.id === "filesystem");
    expect(fsConn?.status).toBe("active");
  });
});
