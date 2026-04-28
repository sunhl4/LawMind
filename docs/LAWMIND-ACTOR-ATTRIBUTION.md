# LawMind actor attribution

LawMind records **who** performed sensitive actions (for example draft review) using an **`actorId`** string on audit events and engine calls.

## Defaults

- **LawMind desktop** uses **`lawyer:desktop`** when no override is set.
- The LawMind **Agent** configuration uses the same resolved value for `actorId` so tool and audit entries stay consistent on a single machine.

## M1 engine (CLI / scripts)

When **`engine.confirm()`** or **`engine.review()`** is called **without** `opts.actorId`, the engine uses:

1. **`LAWMIND_ENGINE_ACTOR_ID`** if set, else
2. **`LAWMIND_DESKTOP_ACTOR_ID`** if set, else
3. **`lawyer:system`**

See `src/lawmind/engine-actor.ts`.

## Override (desktop API)

Set **`LAWMIND_DESKTOP_ACTOR_ID`** in the environment that starts the desktop local API (for example in `.env.lawmind` or the shell that launches dev mode):

- Examples: `lawyer:zhang`, `lawyer:firm-123`, `paralegal:desk-2`
- Use a stable identifier your firm already uses (employee ID, desk name, or role + name).

## Audit model

`AuditEvent.actorId` is optional metadata; see types in `src/lawmind/types.ts`. It supplements `actor` (`system` | `lawyer` | `model`) for finer-grained attribution.

## Related

- [LawMind user manual](/LAWMIND-USER-MANUAL)
- [LawMind integrations](/LAWMIND-INTEGRATIONS)

https://docs.lawmind.ai/LAWMIND-ACTOR-ATTRIBUTION  
https://docs.lawmind.ai/LAWMIND-USER-MANUAL  
https://docs.lawmind.ai/LAWMIND-INTEGRATIONS
