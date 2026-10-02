# Edda Morrow, the Glass Saint (Support)

Passive **Stored Light**, tactical **Mercy Shard** (Z), ultimate **Rose Window** (T). Spec: `docs/FIGHTERS.md` "07".
Code: `src/fighters/kits/edda-morrow.ts` (the kit), `edda-morrow-logic.ts` (the maths and the `TUNING` object: pure,
no engine imports), `edda-morrow-glass.ts` (the pixels: shard, shimmer, window). Tests: `tests/fighters-edda.test.ts`
(45). Live probe: `scripts/verify-fighter-edda.mjs` (`node scripts/verify-fighter-edda.mjs http://localhost:<port>/`,
72 checks, real Z / T / X / Q key presses, paused deterministic ticks; screenshots to `verify-out/fighters/edda-*.png`).

**The kit writes no cell at all** (its glass is drawn, its light is an authored light), so nothing it does can seal a
route; the probe takes a census of every solid and powder in the arena before and after a shard, a whole window and a
drink and requires it unchanged.

## Engine seams added

One, additive and one line: `src/game/Pickups.ts`, in the potion branch of `collect()`:
`ctx.events.emit('flaskUsed', { verb: 'drink', material: null, amount: 1 })`. A potion lifted off the floor never
passes through the flask, so it emitted nothing; "every consumable she uses" needs to hear it. The only existing
listeners of `flaskUsed` (`Hints`: siphon; `Enemies`: pour / throw) ignore the verb. `material: null` is how the kit tells
a potion (always one use) from a sip of the flask.

Nothing else in the engine was touched. Things the framework already offered that the kit leans on, and quirks found:

- `KitInstance.intercept` is called by `Projectiles` **at every sub-step (<= 1 cell) of every hostile shot's flight**, not
  once per tick, so a kit may inspect a shot at the cell it is in. The doc on `interceptProjectile` says "true consumes it";
  Edda changes the shot's velocity and returns false (a shot is only ever turned, never eaten).
- **`FighterSystem.equip` zeroes `armorMax` after a cached kit's `create()`** has run (the kit is adopted synchronously, then
  the reset line below it runs), so a kit that sets the ceiling only in `create()` loses it. Edda re-asserts it every tick
  (and in `create()` for the first-load path).
- **`restore()` clamps a saved armor to `max(armorMax, 1000)`**, not to the kit's own ceiling; the kit's per-tick assert also
  clamps the pool down to 30 (a unit test and a probe check pin it).

## Final numbers (`TUNING`)

| | |
|---|---|
| Stored Light | pool 30, starts empty, +12 per use; a flask drink is one use per session of sips (<= 30 ticks apart) and the glass rests 180 ticks after a flask grant; a potion pickup is always a use; a full pool takes nothing and rests nothing |
| Mercy Shard | Z, cooldown 720, x0.6 incoming damage for 360 ticks; flight 30 ticks out along the aim (22 cells) and back; orbit ellipse 9 x 5.5, 0.075 rad/tick; blinks for its last 70, dissolves over its last 24 |
| Rose Window | T, 600 ticks; radius 60; heals 4 hp/s; turns hostile shots between 16 and 62 degrees off the outward normal; glass 16 cells in radius (32 across), unfolds over 22, dims over the last 90, cracks over the last 36, shatters over 48; authored light 0.95 intensity, radius 100 |

## Stored Light

The kit subscribes to `flaskUsed` in its constructor and unsubscribes in `dispose()` (and re-baselines its armor watch on
`playerRespawned` / `playerDeathCleared`). A held X emits one `drink` event a tick, so a literal "+12 per event" would fill the
pool in three ticks; `StoredLight` (pure) treats sips no more than 30 ticks apart as **one drink**, grants at its first sip, and
rests for 180 ticks after a flask grant. The armor pool itself is the system's (`setArmorMax(30)`, `addArmor`,
`reduceIncoming` takes armor after the modifiers, so a shard-halved blow is what the pool absorbs); the kit owns the tells:

- **The glint**: 26 gold sparks, a ring of 14 gold motes, a warm flash of authored light, `pickup.bell` and `player.heal`, a
  "+12 STORED LIGHT" line and a small screen punch. A pool that is already full takes nothing, shows nothing and does not rest the glass.
- **The shimmer** (a drawable while the pool is not empty): gold motes turning about her, more of them and a thin gold film as
  the pool fills.
- **Struck away**: when armor drops (any blow it absorbed) gold sparks and a bell note; a glass crack when the last of it goes.
  A respawn emptying the pool is not a blow and does not ring.

Measured in the real game: a real elixir in the flask belt, X held for 40 ticks: the flask lost 40+ cells (they are really
swallowed), the pool went 0 -> 12 once. A second press of X at once is the same drink; a new drink 1 s later earns nothing; one
after the rest gives 24, then 30 (a 6-point gain), then a full pool takes nothing though the flask is still swallowed. With 30
stored a 10-point blow cost no health (pool 20); a 30-point blow drained the last 20 and 10 reached health. The pool stayed 0 over
5 s (no regeneration). A real potion pickup beside her gave +12. A real pour (Q), a siphon and a throw gave nothing. As the classic
Alchemist (`equip(null)`) the same drink gave no armor; re-equipped twice, one drink was still +12 (no doubled listener).
Saved with the run (`snapshot().armor`) and restored; it survives a `levelChanged`.

## Mercy Shard

`allyTargets(ctx)` (logic module) returns the friendly bodies, the fighter first; solo it is only her. `chooseAlly` picks the
peer nearest the aim line within 220 cells and a 50 degree cone, else herself, so the arena mode adds peers by appending to the
list (each with a `grant(ticks, damageTaken)` that reaches that peer's own modifiers) and the shard then flies across to them
and orbits THEM (`shardPose`, unit-tested for both cases). Solo the protection applies **at the press** (an emergency button
does not wait for a flight) as a `damageTaken` modifier of 0.6 for 360 ticks; the shard is its visible form for those 6 s.

The shard is a drawable pair (one under the fighter, one over her, chosen by which half of its orbit it is in, so it goes
round her instead of across her face): a faceted kite of glass (five facets round a bright core, gold edges), a halo, a tail of
glints, a breathing star at the tip; it tumbles out along the aim, spins down as it curls back, settles into the ellipse (shown
as a faint dotted path), and carries a small pale light. When it takes a blow (a blow worth 1.5 or more, so a burn's tick does not
chatter) it flares white and rings. It blinks for its last 70 ticks, dissolves in a puff of glints and a glassy note, and the
protection is lifted. A death or a new floor clears it at once (`reset()`).

Measured: it strays 27.8 cells along the aim at tick 9, is back in orbit by tick 40 (8.5 cells from the chest, 3.5-11.5 for the
rest of its life, still turning). A blow of 20 costs 12 through `Player.damage`. A **real hostile fireball** (placed inside the
body test so it lands this tick): the direct blow is 11 bare and exactly 6.6 with the shard (the blast and the fire it lights add
the rest; the whole fireball costs 0.49-0.56 of its bare cost over three runs). A **real slime bite** 6.0-6.2 bare, 3.7-3.8 with
the shard. Z while it is out is refused (the chip flashes); at 360 it is gone and a blow costs 20 again; the cooldown (720) runs
past it.

## Rose Window

At her feet (on the floor below her if she is in the air; floating where she is if there is none: nothing refuses it): a round
stained-glass window 32 cells across whose lowest edge is the floor surface, drawn behind her ('under'). It is eight sectors
of coloured panes in two rings (ruby, sapphire, amber, emerald, violet, rose, cyan, pale gold), a scalloped gold ring (an eight-point
star where it meets the spokes), eight gold spokes, a gold hub with a gem and a gold frame; the panes are alpha-blended over the
world and add their own colour (lit from behind: they keep their colour in the dark), the rest lit by her lantern. It unfolds with a
spin over 22 ticks, throws a soft prismatic wash on what is round it, carries a faint dotted ring at the 60-cell radius and a pulse of
gold light that crosses it every 90 ticks, and sheds drifting motes of colour.

- **Heal.** `ultimateTick` raises `player.hp` by 4/60 a tick while she is within 60 cells of the glass's centre, capped at `maxHp`
  (no potion status, no regen timer: nothing needs the player's own healing visuals). The tell is its own: gold motes cross from the
  glass to her and rise off her chest, `player.heal` on each pulse.
- **Refraction.** `intercept` runs at every <= 1 cell sub-step of a hostile shot's flight, so a 45-cells-a-tick shot is caught at
  the radius and a shot merely passing through the radius is caught too, with no sweep of `ctx.projectiles` needed. `refract`
  (pure, property-tested over 6000 random shots) rotates its velocity to leave `minScatter` (16) to `maxTurn` (62) degrees off the
  outward normal, on the side it was already leaning (a mirror about the normal, bounded: a grazing shot is bent out rather than left to
  skim the glass, a dead-on one is scattered rather than sent back down its own line), keeps its speed exactly, leaves a shot that is already
  leaving alone (so it turns once) and **never consumes it**. Every hostile kind is turned; her own shots are not. The tell: a four-point glint
  at the entry, a flash on the ring where it landed, sparks in the pane colours, a bell note, a short warm light.
- **Light.** One authored light (`sys.addLight`, 0.95, radius 100, no auto-fade: the kit sets its intensity from the glass's
  glow so it dims with the glass).
- **End.** Over the last 90 ticks the glass dims and flickers (steady if flashes are reduced) and its colours drain; over the last 36 it
  cracks; at 600 it **shatters**: the eight panes and the hub (each with its cracks and its gold) fly out along their own bearings and fall,
  fading over 48 ticks and lost behind the floor, with a burst of coloured sparks and glass particles, `flask.shatter`, `mat.shatter`, a deep
  bell, a flash of light and a screen punch. Healing and refraction stop at the break. A death, a new floor or a new fighter removes it at once
  with no shatter (`reset()`: drawable, light and state gone; the probe checks the light count returns to what it was).

Measured: refused with the bar empty; with it full the window stands at her column with its lowest edge on the floor; one authored
light is added. Healed **8.00 hp in 120 ticks** (4 hp/s) standing in it; 4.0/s at 55 cells out, 0 at 66 cells and at 100 cells the other way;
99.9 -> 100 and no further; `status.regen` stayed 0. A slow fireball flying at her was turned at 60.0 cells (closest approach 60.0), flew on and
ended at the floor far outside the radius; her hp unchanged; speed kept to within gravity. A **45-cells-per-tick** shot: closest approach 60.0,
turned at 43.1, -13.1 (speed 45.0 exactly) and flew on. A shot 38 cells over her head that would never have touched her was turned at the radius;
a shot from the left, a grazing shot across the top of the ring, a frostbolt, a shot already inside when the window rose: all turned. A friendly
bolt flew straight through at the same velocity. After the break a hostile shot reaches her and hurts. A reset mid-window removes everything.

## Deviations from the spec, and why

- **A drink is a session, and the glass rests.** The spec says each consumable grants +12; a held X emits an event every tick and water is
  free from any pool, so a literal reading is a fountain of armor. Sips <= 30 ticks apart are one drink and a flask grant rests the glass for
  3 s. Potion pickups are always a use. (Tunable in `TUNING.stored`.)
- **The shard protects at the press, not on arrival**, solo (the flight is its look). A peer's `grant` is called at the press too; whether the
  arena wants the protection to start on arrival is that mode's call, in the one `grant` hook.
- **The window is 32 cells across.** The spec says only "a drawable rose window"; at 24 she hid most of it. The reach ring shows the 60 cells.
- **Heal and refraction measure from the glass's centre**, 15 cells above the floor, not from the floor row.

## Not verified / known limits

- No real mage or boss fired through the AI: shots were placed on the real `Projectiles` loop (a slime's bite was real). Boss attacks that
  are not `Projectile`s (a beam, a slam) are not refracted: the spec says projectiles.
- Sound: existing cues only (`pickup.bell`, `player.heal`, `spell.vitrify`, `spell.conjure`, `spell.ice.impact`, `flask.shatter`, `mat.shatter`);
  nothing can be listened to here, the probe asserts the cue ids requested. Whether the chimes stack pleasantly in a long fight is unheard.
- The drawables use the player's tick position (the framework gives them no frame alpha): on a display above 60 Hz the shard's orbit and the
  shimmer can shimmer a fraction of a cell against the interpolated sprite (the window is stationary and unaffected).
- Real-time cost was measured only as frames over 3 s in headless Edge with the window and the shard up: 113.6 fps against 115.3 without.
- The arena mode's peers do not exist, so the peer path (`chooseAlly`, `shardPose` for a non-self target, `grant`) is unit-tested only.

## Probe notes

The probe's arena is the `physics-test` level, which hangs **three persistent ropes** (vine strands at x 440.5, 485.5, 525.5) down through
the carved box: a hostile fireball explodes on one, and a blast sets them burning. `clean()` empties `ctx.vineStrands.strands` (and the
particles, sparks and shockwaves) so a shot's lane is clear. Each flight of the refraction tests gets a fresh arena and a fresh window (a
window lasts 600 ticks, and an earlier blast leaves fire that a later fireball would explode on). The real-engine fireball is placed 5 cells
out so it lands in its first tick, deterministically; the direct blow is measured by wrapping `Player.damage`, since what follows (the blast
and the fire it lights) is the sim's and varies run to run.
