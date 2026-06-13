# Game Project Review Remediation Plan

Status: implemented and validated
Created: 2026-06-13

This plan addresses the defects and maintainability issues found in the full project review. The work is split into focused slices so each change can be validated without mixing gameplay behavior, persistence, rendering, and docs drift.

## Findings Addressed

1. Enemy save/resume currently records only identity and health, so sleeping roosts, Builder patrols, alert/calm state, and several enemy-specific timers are reset on resume.
2. Generated hostile population placement uses `Math.random()` and ignores the generated region graph/reachability data, making enemy layout nondeterministic for a seed and allowing unreachable or off-path placements.
3. `Cell.Catalyst` is configured as a bloom/discovery material but does not seed dynamic light, so buried catalyst seams can fail their intended visual tell.
4. Several modules cross ownership boundaries directly. The highest-risk examples are gameplay systems importing concrete feature modules for shared side-channel state or factory helpers.
5. `Mechanisms.update` repeatedly scans the full mechanism list and allocates trigger arrays for each actuator every frame.
6. Documentation and comments drifted from current behavior: `DebugConsole.ts` was replaced by `ConsoleOverlay.ts`, and GPU frame composition is currently default-on while docs/comments still say default-off.

## Implementation Slices

### 1. Persistence: Save Enemy Behavior State

- Extend the expedition enemy save record with optional behavior fields.
- Serialize patrol routes, patrol cursor, sleeping/alerted/calm state, enemy timers, and kind-specific transient state that materially affects resumed behavior.
- Restore saved behavior through a testable helper, keeping old saves valid by preserving defaults when fields are absent.
- Add focused Vitest coverage for deep-copying patrol data and restoring optional state.

### 2. Generation: Seeded Reachable Population Placement

- Fork the deterministic level seed for population placement using the repo RNG utilities.
- Use the reachability mask from the generated world to filter enemy, roost, and egg-clutch candidates.
- Keep spawn-clearance rules, but degrade clearance deterministically before skipping a non-critical population slot.
- Avoid adding new progression requirements; findability validation remains the regression tripwire for required items.

### 3. Rendering: Catalyst Light Source

- Add Catalyst to the dynamic light seeding pass with a small warm pulse aligned with its bloom-weight/discovery role.
- Keep the light weaker than fire/lava/charge so it reads as a material tell rather than a torch.

### 4. Architecture: Reduce Direct Feature Coupling

- Move shared wand projectile side-channel maps out of the concrete wand system into a neutral combat helper.
- Add a neutral mechanism trigger-index helper that can be used by runtime construction and the mechanism system.
- Document the remaining staged extraction work for pickup factories and worldgen mechanism factories instead of attempting a broad ownership rewrite in this pass.

### 5. Performance: Mechanism Trigger Index

- Add a transient `targetId -> triggers[]` index to `LevelRuntime`.
- Build the index once when a runtime is assembled or lazily if missing.
- Use indexed trigger lookups for doors, valves, and relays.
- Remove per-frame `filter` allocation from sequence aggregation.

### 6. Docs and Comment Drift

- Update architecture documentation to name `ConsoleOverlay.ts` and describe the mechanism trigger index.
- Update the dev-console plan to reflect the current console implementation.
- Update GPU composition docs and the params comment to match the current default-on setting.

## Validation Plan

- `npm run typecheck` - passed
- `npm test` - passed, 245 tests
- `npm run lint` - passed
- `npm run verify:findability` - passed, 4 seeds x 9 depths clean
- `npm run build` - passed; Vite reported the existing large-chunk warning

Runtime browser probes are not required for this pass unless static validation or tests expose a rendering/runtime regression. Catalyst lighting is a small existing-renderer material addition; the findability audit remains the primary worldgen safety check.
