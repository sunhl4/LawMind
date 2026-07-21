import { describe, expect, it } from "vitest";
import { listBundledFleetPlaybooks } from "./playbooks.js";
import { aggregateSafetyScore } from "./safety-score.js";
import { runCampaignRolesSerial } from "./serial-runner.js";

describe("safety-score + serial runner", () => {
  it("aggregates weighted scores and negotiate list", () => {
    const playbook = listBundledFleetPlaybooks()[0];
    const text = `
      本合同无限责任，且无责任上限。涉及个人信息但未约定安全措施。
      自动续期。必须承担全部损失。
    `;
    const { roles, safetyScore } = runCampaignRolesSerial(playbook, text);
    expect(roles.filter((r) => r.status === "done").length).toBeGreaterThanOrEqual(4);
    expect(safetyScore.score).toBeGreaterThanOrEqual(0);
    expect(safetyScore.score).toBeLessThanOrEqual(100);
    expect(safetyScore.high + safetyScore.medium + safetyScore.low).toBeGreaterThan(0);
    expect(safetyScore.negotiatePriority.length).toBeGreaterThan(0);

    const again = aggregateSafetyScore(roles);
    expect(again.score).toBe(safetyScore.score);
  });

  it("is reproducible for same text", () => {
    const playbook = listBundledFleetPlaybooks()[0];
    const text = "服务协议 MSA。责任上限一百万元。适用法律中国法律。通知期十五日。来源待核实。";
    const a = runCampaignRolesSerial(playbook, text);
    const b = runCampaignRolesSerial(playbook, text);
    expect(a.safetyScore.score).toBe(b.safetyScore.score);
    expect(a.roles.map((r) => r.score)).toEqual(b.roles.map((r) => r.score));
  });
});
