import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function prepareElectronE2EUserData() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-e2e-userdata-"));
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-e2e-workspace-"));
  const lawMindRoot = path.join(userDataDir, "LawMind");
  await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
  await fs.mkdir(lawMindRoot, { recursive: true });
  await fs.writeFile(
    path.join(lawMindRoot, "desktop-config.json"),
    JSON.stringify({ workspaceDir, retrievalMode: "single" }, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(workspaceDir, "lawmind.config.json"),
    JSON.stringify({ schemaVersion: 1 }, null, 2),
    "utf8",
  );

  const draftsDir = path.join(workspaceDir, "drafts");
  await fs.mkdir(draftsDir, { recursive: true });
  const now = new Date().toISOString();
  await fs.writeFile(
    path.join(draftsDir, "e2e-draft-1.json"),
    JSON.stringify(
      {
        taskId: "e2e-draft-1",
        title: "E2E Electron draft",
        output: "docx",
        templateId: "word/legal-memo-default",
        sections: [{ heading: "摘要", body: "E2E body" }],
        reviewNotes: [],
        reviewStatus: "pending",
        createdAt: now,
      },
      null,
      2,
    ),
    "utf8",
  );

  return { userDataDir, workspaceDir };
}
