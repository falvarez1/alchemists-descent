# Arena programme: decision log

One entry per decision, newest last. An entry says what was decided, why, what was rejected, and what would make us revisit
it. Ids are stable (`D-001`...). A cut task in `TASKS.md` (`[-]`) must have an entry here.

## D-001 (2026-10-01): two fighters via a slot swap plus a proxy Enemy for every other slot

**Decision.** Each fighter is a *slot* (its own player state, input, controller, wands, flask, fighter system, chill system);
a slot's bundle is installed on the base `ctx` while it acts. Every other slot appears to the bound slot as an `Enemy` of a
new kind `'fighter'`, synced from the real body, whose `damage`/`kill`/`gustShove`/`splashHazard` redirect to the victim's
`playerCtl.damage`. Invariant: all proxies are visible except the bound slot's own. (`ARCHITECTURE.md`)

**Why.** `ctx.player` is read from 134 files (737 lines); everything that can hurt a fighter is written as player-vs-enemy,
and `Enemies.damage` is one choke point with about 28 callers. Redirecting it makes spells, kicks, explosions, flame,
liquids, rigid bodies and every kit's `ctx.enemies` loop work against a fighter with no edits to those systems. Cell hazards
already hurt a second real `PlayerControl` for free.

**Rejected.** (D2) A `Combatant` interface: about 60 sites in hot code, 2.5-4k edited lines, still needs the status/knock
bridge. (D3) The rival as a real `Enemy` kind: its locomotion would not be the fighter's (1,500-line per-kind chain), and role
reversal needs the swap anyway.

**Revisit if** the proxy fidelity gaps (`ARCHITECTURE.md` 8) cost more than a `Combatant` refactor would, or a third and
fourth fighter make slot-ordering asymmetry unmanageable.

## D-002 (2026-10-01): the fighters are for the arena mode, not the campaign

**Decision.** The campaign is the classic Alchemist only (no Fighter row on New descent, no fighter in the ledger, the daily
unchanged). The title's Arena door (authoring builds) opens the roster and starts the Proving Yard. The engine still carries a
fighter on a run so the arena mode can reuse it. **Why.** The user's direction: the roster belongs to a Smash-style arena mode.

## D-003 (2026-10-01): per-fighter physics through a `BodyProfile`, not by editing `PLAYER_PARAMS`

**Decision.** A frozen profile of multipliers on the fighter system, read once per update by `Player.ts`; `PLAYER_PARAMS`
stays shared and unchanged. **Why.** `ctx.params.player` is shared, live-tunable and persisted (`tuningStore.ts:105`);
writing per-fighter values into it would leak into other fighters, the Sandbox and saved tuning. About 35 edited lines; the
classic hero stays byte-identical (`NEUTRAL_BODY`).

## D-004 (2026-10-01): the hitbox stays 4x17 in phase 1

**Decision.** No fighter has a different hitbox yet; weight, speed, traction, jump, gravity and levitation carry the
identity. **Why.** The hitbox constants are read in 70+ places in 24 files (plus literals in `Projectiles`, `explosion`,
`Spells`, the contact shadow) and the rig skeleton is fixed; `docs/FIGHTERS.md` principle 1 ("same hitbox") exists for this
reason. **Revisit** after the bodies and the telemetry exist, as a halfW-only experiment.

## D-005 (2026-10-01): build the telemetry on gauntlets first; keep the schema PvP-ready

**Decision.** The recorder, the override API, the batch runner and the analyser are built against fighter-vs-foe gauntlets
(`FOE_PRESETS`) while PvP is built; the schema carries `src` and `dst` fighter indices from day one. **Why.** PvP is the long
pole (P3); telemetry should not wait for it, and the same data answers "does the fighter work" (damage per second,
uptime, time-to-kill) before it answers "who beats whom".

## D-006 (open): a universal defensive option

**Question.** Smash gives everyone a shield, roll and spot dodge; this game gives the Alchemist none and the fighters each
carry a defensive tool. **Leaning:** a single air-dodge/roll with a stamina cost, so every fighter always has a recovery
option, tuned by telemetry, added in phase 6 after the match rules exist. **Decide by** the first stock-match telemetry.

## D-007 (2026-10-01): batches are statistical, not replayable

**Decision.** Treat fight batches as statistical. Measure the replay-match rate (T2.1) and only then decide whether a replay
tool is worth building. **Why.** Whole-tick determinism is unproven (the entity stream diverges from about tick 14; Rapier
is not the enhanced-determinism build; a few gameplay paths read the wall clock).

## D-008 (2026-10-01): parallelism is capped at 3-4 agents

**Decision.** At most 3-4 concurrent work packages, each on its own Vite port, probes run sequentially. **Why.** The system was
stopped once by memory pressure during a probe batch on this machine.

## D-009 (2026-10-01): arena features are authoring-only until the user says otherwise

**Decision.** The Arena door shows only in authoring builds; nothing in this programme merges to `main` (which deploys) without
an explicit go-ahead. **Why.** A push to `main` deploys the public game.
