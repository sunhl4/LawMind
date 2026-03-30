/**
 * Default human actor id for M1 engine paths when callers omit `actorId`
 * (CLI, scripts, tests). Aligns with desktop when LAWMIND_DESKTOP_ACTOR_ID is set.
 */

export function resolveDefaultEngineLawyerActorId(): string {
  const raw =
    process.env.LAWMIND_ENGINE_ACTOR_ID?.trim() || process.env.LAWMIND_DESKTOP_ACTOR_ID?.trim();
  return raw || "lawyer:system";
}
