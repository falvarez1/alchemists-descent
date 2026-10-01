# Sable Fen, the Mire Stalker (Hunter)

Code: `src/fighters/kits/sable-fen.ts` (the rules), `sable-fen-logic.ts` (the maths, no world, no Ctx),
`sable-fen-draw.ts` (the three drawables). Tests: `tests/fighters-sable.test.ts` (pure maths, plus the kit through the
real `FighterSystem` against a fake world). Live probe: `node scripts/verify-fighter-sable.mjs [url]` (real Z / T key
presses, paused deterministic ticks, screenshots in `verify-out/fighters/sable-*.png`).

Spec: docs/FIGHTERS.md "03". Every number below lives in the `TUNING` object at the top of `sable-fen-logic.ts`.

## What each ability does in the grid

Nothing Sable does writes a cell. That is deliberate (fail-open: she cannot seal a route, stamp rock into a gate or
leave debris behind), and it is the answer to "if the grid can't explain it, it doesn't ship": every ability *reads*
the grid (rock, foes' bodies, light) and the effect it has is on bodies (hers, a foe's) and on what the player is shown.

### Wounded Spoor (passive)

- `onEnemyHurt` (the system's hook, called for every blow the player or the world on her behalf lands): a foe that
  is hurt and not killed is `markEnemy`'d for **360 ticks** (6 s) and its first mote is laid at once, with a small
  green burst and a soft `mat.bubble`. Hurting it again refreshes the mark.
- Each tick the kit walks the enemies; a marked one leaves a mote of its position **every 4 ticks**, held **14 deep**
  (a ring buffer, `SpoorTrail`). A foe that has not moved 1.5 cells since the newest mote refreshes that mote instead
  of stacking a clump on it. A mote burns for 64 ticks and fades out on a power curve; a trail whose motes have all
  burnt out is dropped.
- The trail is drawn by a kit-owned `FighterDrawable` on the **'under'** layer (`drawSpoor`): additive fine-pixel motes
  (a bright core, a cross and corners of glow round it, a faint outer halo while young), a slow rise and sway per
  mote, a twinkle, and a dotted thread to the next mote so it reads as a track. Additive, so it shows over rock and
  through darkness. Deterministic: every wobble is a hash of the mote or a sine of the frame, no `Math.random`.
- A marked foe she cannot see (a solid cell on the line from her eye to its body, or less than 0.1 perceived light at
  it) pulses faintly through the system's reveal ring (dim green, `revealEnemy` every tick while unseen; the
  line-of-sight test runs every 6 ticks per foe). Suppressed while Bloodsense runs, which says it louder.
- HUD: a `meter()` reads "Marked", the count of marked foes out of 6 (hidden when there are none). It is the only
  readout; the chips are untouched.

### Bogline (Z, 480 ticks = 8 s)

The line starts at her shoulder and marches along the aim for up to **150 cells**. `castToSolid` finds the first
cell that blocks bodies; then, one cell at a time up to that distance, `pointHitsCreature` (padding 2, the same body
geometry the projectiles use) finds the first foe. The nearer of the two wins, so a foe in front of a wall is hooked
and a foe behind it is not.

- **Nothing within range:** refused, no cooldown (`wand.dry`, a callout "NOTHING TO HOOK"). **Rock closer than 10
  cells:** refused for the same reason ("TOO CLOSE TO HOOK": being hauled 2 cells is not an ability).
- **Rock:** `startMove` hauls her toward the hook at **6 cells/tick, at most 28 ticks**, ending **8 cells short of
  it** (shoulder to hook). The pull slides along rock rather than stopping dead (aimed into a floor it skims it;
  against a wall face with a vertical component it climbs it), is cut by `startMove`'s own blocked test, and a
  floor lip of up to 3 cells is stepped. She exits with **3 cells/tick of momentum** in the pull's direction (the
  rise capped at 2.4 so a ledge is topped, not overshot). The hit chips fly off in the cell's own colour and it
  sounds as wood / metal / stone.
- **A light foe** (footprint halfW x h under 100: slime, imp, bat, mage, spitter, bomber, wisp, ...): it is yanked
  along a straight line toward her chest by writing the engine's own knock velocity every tick (`knockVx/knockVy`,
  compensating the engine's drag and gravity so the speed is exactly **4 cells/tick**) for **10 ticks**, stopping
  **12 cells** from her. Then it is `stunEnemy`'d for **20 ticks** (three motes circle over its head) and it stays
  marked. `gustShove` is called once with a small strength first: that wakes it, turns it on her and attributes
  whatever the pull delivers it to (lava, a pool, a wall) to her, exactly as a kick does. No damage.
- **A heavy foe** (footprint 100 or more: golem, weaver, leviathan, and every boss): it cannot be dragged, so the line
  hauls *her* to it instead (stopping 8 cells + its half width from its centre), and it is stunned on her arrival,
  except a boss, which is only marked.
- The tether is a drawable on the **'over'** layer (`drawTether`): a rope three fine pixels wide twisted in pairs of
  lighter and darker strand (lit by the field, with a faint bog-green sheen so it reads in the dark), sagging while it
  flies out (3 ticks), taut once it bites, twanging for 10 ticks, then going slack and coiling back over 7 ticks. At the
  end of it a barbed hook (a shaft, a forward spike, two swept barbs) with a green spark at the point and a ring that
  leaps out when it bites. A flash of rays at her hand marks the cast. On a foe the hook rides the body.
- Sounds: `trick.whip` on the cast; `body.impact.stone|wood|metal` on rock or `creature.hit` on a foe; `player.land.soft`
  or `.hard` (blocked) when she arrives, or `body.bash` when a foe arrives; `wand.dry` on a refusal.

### Bloodsense (T, 600 ticks = 10 s)

- Every tick of the ultimate, every foe with `0 < hp < maxHp` within **320 cells** of her chest gets `revealEnemy(e,
  4 ticks, green)`. It is re-evaluated each tick, so a foe wounded mid-ultimate joins in and one that dies or heals drops
  out within 4 ticks. The system's reveal drawable draws the outline ring and chevron (unchanged). The colour dims over
  the last 50 ticks so the end is a dimming, not a click.
- On top of that the kit's own 'over' drawable (`drawOverlay`) warms each sensed foe from within (a soft green
  silhouette that beats), so it reads at a glance through rock and in the dark.
- The heartbeat: a first sweep ring out to the full 320 cells over 26 ticks, then a slow double beat every 84 ticks
  (a lub: ring to 170 cells over 52 ticks, `player.heartbeat`; a dub 15 ticks later: ring to 120, `mat.hollow`).
  Rings are three fine pixels deep, broken into arcs, and are centred on her. A foe a ring sweeps past flares once.
- She moves **x1.1** (a `setMod`).

## Engine seams

None added and no shared engine file edited. The kit stands on what the framework already offers: `startMove`,
`markEnemy` / `isMarked`, `revealEnemy`, `stunEnemy`, `setMod`, `meter()`, `addDrawable`, `callout`, and
`ctx.enemyCtl.gustShove` (the kick's provoke-and-attribute bookkeeping). `src/render/fighterReveal.ts` is unchanged: I
looked for a shared bug in it and in the system's reveal/stun bookkeeping and found none that affects this kit.

Two things a kit author should know, both handled in the kit and neither a bug:

- `FighterSystem.cancelEffects` removes **every** drawable (except its own reveal drawable) on a respawn or a floor
  change, so a kit that wants a permanent drawable (the spoor) must re-add it. Sable's `tick()` re-mounts what it needs.
- A stun is the knock state pinned at zero velocity, so it cancels any knock velocity a kit has written; a yank has to
  finish before the stun starts. (The engine's own ground bump clears `knockT` after a grounded foe's tick, so a
  stunned foe reads `knockT` 0 on some ticks; `keepStunned` re-pins it before every enemy update, so the AI stays off.)

## Deviations from the spec, and why

- The stun starts when the yank ends, not at the hook (see above), so a yanked foe is out of the fight for about 30
  ticks in total, not 20.
- Heavy foes and bosses are not yanked: she is hauled to them. The spec says the foe "is yanked toward her", which for a
  golem is the engine's `gustShove` doing next to nothing, and for a boss is a no-op. Hauling her is the fun, usable
  reading. Bosses are marked but never stunned.
- Rock closer than 10 cells is refused (the spec only refuses "no hit").
- "Out of sight" for the passive pulse also counts a foe in the dark (less than 0.1 perceived light), not only rock
  between: in a deep-dark zone a marked foe in a clear line is just as unseen.
- Bloodsense also warms the sensed foes from within and flares them as a ring passes (spec: the reveal outline and the
  ring). The reveal itself is exactly the spec's.

## Measured (scripts/verify-fighter-sable.mjs, 70 checks, green 3 runs in a row)

- Spoor: samples are exactly 4 ticks apart, the buffer holds 14, a foe that stops leaves one mote, the mark lapses at
  361 ticks and the burnt-out trail is dropped.
- Haul: aimed at a pillar face 120 cells off, 19 ticks, 6 cells/tick, stopped 8 cells short, exit speed 3.0. Aimed straight
  up at a slab 77 cells overhead she is hauled to 4-16 cells below it, leaving it rising.
- Yank: a bat (flying) is dragged the same way. A slime 100 cells away is dragged 43 cells in 10 ticks (3-5 cells/tick on every tick), ends 57 cells from her, she
  does not move, it is held in the knock state through the 20-tick stun and let go after it.
- Heavy: a golem 130 cells away: she is hauled 107 cells, stops 19 from its centre, it moves at most a few cells (it
  turns on her, as it should), is stunned on arrival.
- Refusals: nothing in range, rock under 10 cells, cooling down (8 s), the bar not full: each refused, the first two and
  the last free.
- Bloodsense in a deep-dark zone (darkness 1.0 at both ends): a wounded foe in the open and one in a sealed chamber behind
  a 40-cell stone wall are revealed; a healthy one and a wounded one 340 cells away are not; a foe wounded mid-ultimate
  joins in; one that dies drops out; the heartbeat rings; everything lapses within a few ticks of the 600th.

## Not verified

- One run in about eight, during development, had its T press refused with the bar full and never reproduced (two runs
  with a diagnostic printing the player's roots saw nothing). The only thing that refuses a full bar is the system's
  "rooted" test (a heart's communion, a lever pull, an ice shell), and an earlier scene could have left her rooted, so
  the probe's `resetScene` now clears `recharge` / `pullT` / the shell; the 5 runs since are green. Not proven to be the cause.
- The audio is by cue name only (we cannot listen): `trick.whip`, `body.impact.*`, `creature.hit`, `player.land.*`,
  `body.bash`, `mat.bubble`, `player.heartbeat`, `mat.hollow`, `world.gong`, `wand.dry`. `player.heartbeat` is also the
  low-health cue; it is deepened by 3 semitones here, but a player at low health in Bloodsense would hear both.
- A real floor change: the re-mount of the spoor drawable is covered by a unit test through the system, not by a played
  descent. A boss fight with a hooked boss was not played (the heavy path is probed on a golem).
- The renderer path: probed on the harness's default (the GPU overlay at 2x pixel step). The CPU path draws through the
  same fine-pixel calls with `pixelStep` 1 and was not looked at.
