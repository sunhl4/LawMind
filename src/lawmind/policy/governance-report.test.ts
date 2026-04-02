import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildGovernanceReportMarkdown } from "./governance-report.js";

describe("buildGovernanceReportMarkdown", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders sections for empty workspace", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-gov-"));
    const md = await buildGovernanceReportMarkdown(dir);
    expect(md).toContain("LawMind governance report");
    expect(md).toContain("lawmind.policy.json");
    expect(md).toContain("Quality snapshots");
  });

  it("includes policy table when file present", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-gov-"));
    fs.writeFileSync(
      path.join(dir, "lawmind.policy.json"),
      JSON.stringify({ schemaVersion: 1, edition: "private_deploy" }),
      "utf8",
    );
    const md = await buildGovernanceReportMarkdown(dir);
    expect(md).toContain("private_deploy");
    expect(md).toContain("schemaVersion");
  });
});
