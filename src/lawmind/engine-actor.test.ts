import { afterEach, describe, expect, it } from "vitest";
import { resolveDefaultEngineLawyerActorId } from "./engine-actor.js";

describe("resolveDefaultEngineLawyerActorId", () => {
  afterEach(() => {
    delete process.env.LAWMIND_ENGINE_ACTOR_ID;
    delete process.env.LAWMIND_DESKTOP_ACTOR_ID;
  });

  it("defaults to lawyer:system", () => {
    expect(resolveDefaultEngineLawyerActorId()).toBe("lawyer:system");
  });

  it("prefers LAWMIND_ENGINE_ACTOR_ID over DESKTOP", () => {
    process.env.LAWMIND_DESKTOP_ACTOR_ID = "lawyer:desktop";
    process.env.LAWMIND_ENGINE_ACTOR_ID = "lawyer:cli";
    expect(resolveDefaultEngineLawyerActorId()).toBe("lawyer:cli");
  });

  it("uses LAWMIND_DESKTOP_ACTOR_ID when ENGINE unset", () => {
    process.env.LAWMIND_DESKTOP_ACTOR_ID = "lawyer:firm-1";
    expect(resolveDefaultEngineLawyerActorId()).toBe("lawyer:firm-1");
  });
});
