# Arena architecture: two (or more) fighters in one world

**Status: decided (D-001, `docs/arena/DECISIONS.md`), not built.** This is phase 3 of `docs/arena/MASTER-PLAN.md`. The
decision rests on a code study of the checkout on 2026-10-01 (file:line references are to that tree; the measured
`ctx.player` count is 737 lines in 134 files, up from the 701 / 103 in `docs/BATTLE-ROYALE-AND-SPACETIMEDB.md`).

## 1. The problem

`ctx.player` is a singleton read from about 130 files. The engine has one player, and everything that can hurt a fighter or
be hurt by one (spells, explosions, kit effects, foes, hostile shots) is written as player-versus-enemy. A fight between two
fighters needs each to be hurtable *by the other's* spells, kicks, explosions and kit effects, with their own physics, wands,
flask and kit, without rewriting those 130 files.

## 2. The decision: a slot swap, plus a proxy Enemy for every other slot (design D1)

Two ideas, which together keep every shared system unchanged:

1. **Slots.** Each fighter owns a *slot*: its own `PlayerState`, `InputState`, `PlayerControl`, `WandSystem`, `Flask`,
   `FighterSystem` and `ChillSystem`. While a slot acts, its bundle is **installed on the base `ctx`**
   (`ctx.player`, `ctx.playerCtl`, `ctx.input`, `ctx.wands`, `ctx.flask`, `ctx.fighters`, `ctx.chill`). Shared singletons
   (`Spells`, `Explosions`, `Lightning`, `Enemies`) read `this.ctx.player` at use time, so they follow the bound slot.
   Nothing in the study stores a player reference in a field (there is no `this.player =`; matches for `= ctx.player`
   are function locals).
2. **Proxies.** Every *other* slot appears to the bound slot as an **`Enemy` of a new kind `'fighter'`**, synced from the
   real body each tick. Because everything a player does to enemies (projectiles, kicks, explosions, flame, liquids, rigid
   bodies, every kit's `ctx.enemies` loop, `FighterSystem.hurt`) goes through `Enemies.damage` (about 28 callers, one choke
   point at `Enemies.ts:595`), redirecting that one function (and `kill`, `gustShove`, `splashHazard`) to the victim's
   `playerCtl.damage` makes the whole arsenal work against a fighter unchanged. The proxy's `status` object is *shared by
   reference* with the real player's (so freeze, burn and shock land for free); `knockT/knockVx/knockVy` are bridged to the
   victim's velocity; position, velocity, hp and `grounded` are synced after all slots update.

The reverse direction needs nothing: cell hazards (fire, lava, acid, liquids, gases, electricity) hurt a second real
`PlayerControl` for free, because `Player.update` samples its own body (`Player.ts:1372,1594-1694`); explosions and hostile
shots hurt "the bound slot" through the direct `ctx.player` branch, and the *other* slots through their proxies.

### The invariant that makes damage exactly-once

> **All proxies are visible except the bound slot's own.**

A "bound-slot window" is any of: a slot's own update, a nested victim call, or one projectile's pass bound to its owner.
Inside a window the owner's proxy is hidden, so a spell cannot hit its caster, a blast hurts the owner once (through the
direct branch) and each other slot once (through its proxy), and nothing is hit twice. Proxies are skipped in the enemy AI
loop (`Enemies.ts:2649`: the real body already takes the environment's damage) and in every enemy sprite and shadow loop.

### Alternatives rejected

- **D2, a `Combatant` interface** threaded through the hit loops: about 60 sites (`ctx.enemies` has about 140 lines in 60
  files; 31 damage call sites), 2.5-4k edited lines in hot code (`Projectiles`, `explosion`), and it still needs the
  `status`/`knock` bridging that proxies provide. D1 with more edits.
- **D3, the rival as a real `Enemy` kind** with its own AI: its locomotion would have to be reimplemented inside
  `Enemies.update` (a 1,500-line per-kind chain), so the rival would not move like a fighter; role-reversal of the kits
  needs a ctx swap anyway, so it contains D1.

## 3. Seams, in order (sizes are estimates)

| # | Seam | Change | Lines |
|---|---|---|---|
| 1 | contracts | `Enemy.fighter`, `Projectile.owner`, `'fighter'` in `ENEMY_KINDS` + `ENEMY_DEFS` + `entityProfiles` (the only exhaustive maps), `Ctx.arena`, `BodyProfile` and `FighterApi.body` (`core/fighters.ts`) | ~50 |
| 2 | `src/arena/ArenaSlots.ts` (new) | the slot records; a `bind/with` stack that installs the bundle and shows/hides own-slot proxies; the proxy factory and sync (including the knock bridge); victim-side slow and stun (`enemyRuns` skips a victim's whole tick: the existing "slow is time" rule); a scoped event bus | ~350 |
| 3 | `Game.ts` | after slot 0's existing calls (:862-871, :905), loop rivals through `ai.think`, `playerCtl.update`, `chill.update`, `fighters.update`, `flask.update`, `wands.update`; union the sim bounds (:834-842); feed camera targets | ~40 |
| 4 | `Enemies.ts` | redirect `damage` (:595), `kill` (:901), `gustShove` (:740), `splashHazard` (:568); skip proxies in `update` (:2649); the redirect also calls `fighters.noteEnemyHurt` so ultimate charge and kill hooks keep working | ~35 |
| 5 | `Projectiles.ts` + `WandSystem.markProjectile` | stamp `owner` in `markProjectile` (:707); bind the owner per projectile (hold the swap until the owner changes); **invalidate the enemy index** (`Projectiles.ts:502-507` caches by (frame, count)); for fighter proxies call the victim's `interceptProjectile` (Brann's plate, Edda's prism) | ~25 |
| 6 | `Player.ts` | the body-profile reads (phase 1, about 35 lines, `docs/arena/FIGHTER-PHYSICS.md`); arena `kill`/`respawn` branches (no gold, no checkpoint, no ragdoll for slot >= 1, `fighterDown` instead of `playerDied`); a `stunT` feeding `restrained` (:1248) | ~90 |
| 7 | `FighterSystem` + kits | a `body` getter; effect state other slots can read; `adopt()` run under bind; Mara's hostile-to-me predicate (`mara-quell.ts:279`) | ~60 |
| 8 | render + camera | the second fighter's sprite, shadow, pose capture, `drawFighterFx` per slot (`FrameComposer.ts:157,1181-1216`); a multi-target camera branch (midpoint + a separation leash; the view is a fixed 640x360 and zoom below 1 is unsupported: `Camera.ts:59-129`, `Renderer.ts:306-310`) | ~80 |
| 9 | `FighterAI` | writes keys, `mouse`, `firing`; calls `press` (`docs/arena/AI-FIGHTERS.md`) | ~300 |
| 10 | rules, panel, stocks | `MatchDirector`, volatility-scaled knockback and ring-outs as a few lines in `damage` / `applyImpulse` (`docs/arena/ARENA-RULES.md`); the panel's second-fighter controls | ~300 |

## 4. What is shared and what is per slot

| Per slot (a new instance each) | Shared (follows the bound slot) |
|---|---|
| `PlayerState`, `InputState` | the cell world and its sim |
| `PlayerControl` (coyote, jump buffer, climb latches, swing, kick cooldown) | `Spells`, `Explosions`, `Lightning`, `Enemies`, `Projectiles` |
| `WandSystem` (wands, collection, compiled programs, `BuildDirector`) | the camera, the lighting (one lantern: ambient 0.92 in the Yard) |
| `Flask` | the event bus, *scoped* per slot (below) |
| `FighterSystem` (kit, cooldowns, charge, mods, effects, drawables) | `ctx.params.player` (`PLAYER_PARAMS`): **never** write per-fighter values here |
| `ChillSystem` (`lastHp`, `prevKeys`, `held`: the easy-to-miss fourth controller) | the rigid-body pool, the particles, the critters |

## 5. The event bus is the dangerous part

The bus is global and payloads carry no slot, so a second slot's subscriptions would double-fire: `FighterSystem.ts:143-146`
(`playerRespawned`, `playerDeathCleared`, `levelChanged`), `WandSystem.ts:205-223` and `BuildDirector.ts:111-117` (offers,
`enemyKilled`), `Player.ts:581` (`cardCast`), and kits (`brann-rook.ts:46`, `edda-morrow.ts:76-78` (`flaskUsed`: Edda
would gain overshield from the *rival's* drink), `ilyra-voss.ts:52-53` (`cardCast`, `flaskUsed`: wrong "two weapons"
counting), `rusk-emberjaw.ts:95-96`). **Rule:** every subscription made by a per-slot object goes through a scoped
registration (`sys.on(...)` / a per-slot `ctx.events` wrapper) that delivers an event only while its slot is bound.
Kit `create()` is asynchronous (`FighterSystem.ts:174-176`), so `adopt()` must run under `bind(slot)`.

## 6. Death, respawn and the global side effects

`Player.kill()` is campaign-shaped (`Player.ts:1014-1072`): it spills gold, writes a checkpoint, spawns the single death
ragdoll, sets global `hitstop` and `deathSlowMo`, and emits `playerDied` (about 15 subscribers, including `RunDirector`
and the death overlay). `respawn()` (:1169) uses `levels.respawnPoint`, culls foes within 200 cells and emits
`playerRespawned` (11 systems). In an arena match every slot goes through an **arena branch**: no gold, no checkpoint, no
ragdoll for slot >= 1, a `fighterDown` event (the match director's input), and `ctx.state.arrivalGraceUntil` forced to 0.
Hitstop is wanted (a hit should freeze both fighters); `deathSlowMo` is optional (a stock loss).

## 7. Module singletons that stay single

Telekinesis `hold` (`Telekinesis.ts:172`; disable E and G for slot >= 1), `RigidBodies` held body, `playerRagdoll`,
`playerCorpse` and `resolvePlayer` (:1386; one player collides with crates), Trickshot (`Trickshot.ts:44,46`). Each is a
documented limitation of a duel (slot >= 1 cannot carry crates or ragdoll), not a blocker.

## 8. Fidelity gaps by design (write them on the box)

- Real foes see only slot 0 (`Enemies.ts:2626,2792`); duels run with no real foes.
- Stomp kills a proxy unless blocked or redirected (`Player.ts:546-560`; add the fighters to `STOMP_IMMUNE`, `Player.ts:93`).
- Fighter reveals and slows on the victim apply only to the attacker's own view.
- Slot 0 resolves first each tick, which is asymmetric: **rotate the starting slot by tick parity.**
- The fixed 640x360 view needs a leash or a smaller duel stage: about 560 cells of separation at most in the Yard. Smash-style
  zoom-out needs renderer work (phase 5).

## 9. Risks (carried into `docs/arena/MASTER-PLAN.md`)

1. The enemy index is keyed by (frame, count): toggling proxy visibility must invalidate it or own-hits return.
2. The scoped bus works only if `ctx.events` is the slot's wrapper when each system is constructed.
3. Missed `owner` stamps: build-mode `Spells.ts` pushes bypass `markProjectile`; trigger payloads (`Projectiles.ts:179-192`)
   run in the bound slot. Test every path.
4. Death/respawn leaks into global systems (above).
5. The view limit (above).
6. Single-instance modules (above).
7. Proxies in `ctx.enemies` leak into about 60 files that scan enemies (music, hints, minimap, readouts, sprite switches):
   `drawEnemySprite` with an unknown kind may throw. Skip proxies in all three render loops and audit the scanners.
8. `ctx.params.player` is shared and persisted (`tuningStore.ts:105`).
9. Hitbox variation is its own project (70+ sites, a fixed skeleton): not promised in phase 1.
10. Perf: two player/wand updates per tick are cheap; the sim-window union is not: budget it against `docs/PERF-2026-09.md`.
