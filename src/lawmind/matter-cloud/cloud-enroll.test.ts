import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateMatterReplicaGate } from "../matter-replica/feature-gate.js";
import { writeCloudLink } from "./cloud-link.js";
import { createMatterCloudServer, type MatterCloudServer } from "./index.js";

const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cloud-enroll-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("案件云注册与桌面连接", () => {
  it("空服务可以注册，令牌写入 cloud-link 后门控走云", async () => {
    const cloud: MatterCloudServer = createMatterCloudServer({ dataDir: tmpDir() });
    const base = await cloud.listen(0);
    try {
      const response = await fetch(`${base}/v1/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "张三",
          email: "zhang@example.com",
          lawyerId: "lawyer_zhang",
        }),
      });
      const body = (await response.json()) as { ok?: boolean; token?: string };
      expect(response.status).toBe(200);
      expect(body.token).toBeTruthy();

      const ws = tmpDir();
      writeCloudLink(ws, { endpoint: base, token: body.token! });
      const gate = evaluateMatterReplicaGate(ws, {
        policy: { schemaVersion: 1, edition: "solo" },
        env: {},
      });
      expect(gate.cloudEndpoint).toBe(base);
      expect(gate.cloudToken).toBe(body.token);
    } finally {
      await cloud.close();
    }
  });

  it("同事凭邀请码换到自己的令牌并加入案子", async () => {
    const cloud = createMatterCloudServer({ dataDir: tmpDir() });
    const base = await cloud.listen(0);
    try {
      const owner = await fetch(`${base}/v1/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "张三",
          email: "zhang@example.com",
          lawyerId: "lawyer_zhang",
        }),
      });
      const ownerBody = (await owner.json()) as { token: string };
      const tenantId = cloud.directory.listTenants()[0]?.tenantId;
      expect(tenantId).toBeTruthy();
      cloud.directory.ensureMembership({
        tenantId: tenantId,
        matterId: "matter_demo",
        matterTitle: "示范合同",
        owner: { lawyerId: "lawyer_zhang", displayName: "张三" },
      });
      const invite = cloud.directory.createInvite({
        tenantId: tenantId,
        matterId: "matter_demo",
        matterTitle: "示范合同",
        email: "li@example.com",
        role: "associate",
        invitedBy: "lawyer_zhang",
        invitedByName: "张三",
      });
      const joined = await fetch(`${base}/v1/invites/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: invite.token,
          displayName: "李四",
          email: "li@example.com",
          lawyerId: "lawyer_li",
        }),
      });
      const joinedBody = (await joined.json()) as {
        ok?: boolean;
        token?: string;
        matterTitle?: string;
      };
      expect(joined.status).toBe(200);
      expect(joinedBody.token).toBeTruthy();
      expect(joinedBody.token).not.toBe(ownerBody.token);
      expect(joinedBody.matterTitle).toBe("示范合同");
    } finally {
      await cloud.close();
    }
  });
});
