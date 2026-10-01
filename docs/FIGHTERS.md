# Fighters

Ten fighters from the design document (`alchemists_descent_fighter_roster.html`, kept with its
concept sheets under `public/assets/fighters/`), made for the ARENA (Battle Royale) mode. A fighter is a look, a
passive, a tactical ability on **Z** and an ultimate on **T**. Weapons still come from the kit and from loot.

**Where they are played today: the Proving Yard, not the campaign.** The campaign is the classic Alchemist only
(the title's New descent has no Fighter row, the ledger offers no fighter, the daily is classic). The title's **Arena**
door (authoring builds) opens the roster and starts [the Proving Yard](#the-proving-yard): a test arena where each
fighter can be walked through every move. The engine still carries a fighter on a run (`RunStartConfig.fighter`, the
`fighter` console command) so the arena mode can reuse it; the campaign UI just never sets one.

**Status: the fighters are implemented; the arena MODE is not.** This file is the contract the code was built against.
Each fighter has its own write-up under `docs/fighters/<id>.md` (the numbers, what was measured in the real
game, the deviations from the specs below and why), and the looks are written up in `docs/fighters/looks-*.md`.
What is NOT built is the arena (Battle Royale) mode these fighters were designed for: see
docs/BATTLE-ROYALE-AND-SPACETIMEDB.md. The abilities resolve against the Works' foes today and are written
against `allyTargets` / `decoyFor`-style seams so a peer can stand where a foe stands.

## Done and remaining

**Done, and verified in the real game** (each line has a probe; see "Probes" below):

- [x] The framework: modifiers, armor, foe slow / stun / reveal, body-owning moves, drawables, lights, save and restore
- [x] All ten kits (passive, tactical on Z, ultimate on T), each against real foes, real cells and real terrain
- [x] All ten looks on the alchemist's own rig, alive and fallen, plus an icon for every ability
- [x] The Fighter Roster screen (filters, search, dossier cards, keyboard and pad)
- [x] HUD chips with cooldown sweep and the ultimate's charge bar
- [x] Run plumbing: a fighter is saved with the run and resumes (the campaign never chooses one)
- [x] The Proving Yard: a test arena, a panel that steps through the fighters and ticks off their moves, the title's Arena door
- [x] Rebindable keys (Z / T), touch buttons, the `fighter` console command
- [x] All ten played through a real run (Z and T, a floor change, a death, a respawn)

**Remaining / not built:**

- [ ] The arena (Battle Royale) MODE these fighters were designed for (docs/BATTLE-ROYALE-AND-SPACETIMEDB.md): rules (damage-scaled knockback, ring-outs, stocks, a collapsing stage), several fighters on screen, bots, a camera that frames them, netcode. The Proving Yard is its first stage: one fighter against foes, no rules
- [ ] Sounds of their own: every ability reuses an existing cue today, and nobody has listened to them
- [ ] Balance by play: the numbers are first-pass, tuned by probes (`fighters/tuning.ts` and each kit's `TUNING`)
- [ ] Unlocks: all ten are open from the start
- [ ] Load the ten looks lazily (they ship in the main chunk, about 135 KB with the rest of the system)
- [ ] Edge cases not probed: bosses, campaign floors other than floor 1 and d2, calm / reduce-flashes mode
- [ ] Merge to main (the push deploys the game). Main is already merged into this branch (2026-10-01)

## The Proving Yard

`world/fighterArena.ts` (the hall), `content/fighterArena.ts` (the tips and the foe presets), `ui/FighterArenaPanel.ts`
(the panel), level id `fighter-test` (`config/worldgraph`; wiped and stamped on entry like the other dev arenas, never
autosaved). Reach it from the title's **Arena** door (authoring builds) or `run test --level fighter-test --world
campaign-level`. One hall, left to right, a station per thing a kit needs something to act on:

| Station | What is there | Whose moves it is for |
|---|---|---|
| The Muster | the start: a dais, two potions on the floor | Edda's Stored Light (drink one, or sip the flask with X) |
| The Sparring Ring | sand floor, two low cover pillars; the foe buttons place foes here | almost everyone: hits, kicks, slows, stuns, decoys, smoke |
| The Gallery | a metal ledge hung from the roof over the ring's right end; shooters stand here | Brann's plate, Mara's chime, Edda's prism: things that stop shots |
| The Kiln Wall | a bay 30 up: a wooden barricade over a packed powder keg; then an oil lane and a lava torch behind a baffle | Rusk's ram, Ilyra's crucible and trail, Nox's smoke (fire eats it), fire immunity |
| The Bluff | a block 96 high with the floor running under it, and a ledge hung 34 higher | Sable's tether, Kest's climb and Updraft, Selene's blink, Thorne's vines |
| The Cistern | a pool 40 deep under a grating bridge, mossy banks | Thorne's camouflage (moss), Selene's slide, liquids |
| The Locked Cell | a sealed stone cell 30 up with a wooden door; the Fill button puts foes in it | Sable's Bloodsense, Mara's ripples, Nox's Soot Sight: reads through walls |

The corridor under everything is open end to end (nothing taller than a 26-high step-over, at least 24 of headroom under
a slab); the bay, the bluff and the cell are slabs you climb or levitate onto. Bright lighting, a black backdrop, a lamp
at every station, a blueprint marker per station (`node scripts/shot-blueprint.mjs fighter-test`).

**The panel** (right edge, only while the yard is the level; `[` and `]` step the fighters, the classic Alchemist
included): the fighter in hand and a Roster button; the three abilities, each with the ability's name and key, a status
(READY / COOLING 6s / CHARGING 40% / ACTIVE), a "what to try and where" line from `ARENA_TIPS`, a **Go** button that
stands you at the station it names, and a tick with a count once it has fired (the passive has a "Seen" box); **Foes**
(slime, golem, imp, bat, shooters, mage, fill the cell, wound all, clear); **Take me to** every station; **Tools**:
Refill (skip the cooldowns), Heal, Hurt 25, Start, Reset yard (rebuild the hall and the potions), Leave, and the toggles
**Unlimited abilities** and **Safe mode** (foes ignore you and nothing hurts you: the arrival grace held open).

Adding a fighter's test: put its three tips in `ARENA_TIPS`; if it needs something the hall lacks, add a station to
`stampYard`, a station id to `YARD_STATIONS`, and a spot to `YARD_SPOTS`.

Probe: `verify-fighter-arena.mjs` (the title's Arena door to the yard; the hall and its open corridor; [ and ]; every
fighter chosen from the panel's Roster with its Go buttons and Z and T through the real key path; the tools; Rusk's ram
breaking the barricade; the keg detonating; the oil staying unlit; Reset yard; Leave).

## How it plugs into the engine

Every hook is guarded (`ctx.fighters?.…`, a no-op for the classic Alchemist, whose run is byte-identical):

| Where | What the fighter asks or does |
|---|---|
| `Game.tick`, right after `chill.update` | `fighters.update`: presses, cooldowns, charge, the body-owning move, the kit's tick |
| `Player.reduceIncomingDamage` | armor, damage reduction, immunity, the kit's own `reduceIncoming` (with the blow's knock) |
| `Player` speed / climb / mantle / stagger / knockback / movement owner | `moveScale`, `climbScale`, `staggerResist`, `ownsMovement` |
| `Enemies.update` | `concealment` (scales how far foes see), `enemyRuns` (a slow is TIME: the foe takes its update on the matching fraction of ticks, Weyl-spaced so it never aliases with an AI cadence), `decoyFor`, `noteEnemyHurt` |
| `Projectiles` hostile branch | `interceptProjectile` (a plate eats a shot, a prism turns it) |
| `FrameComposer` | `drawFighterFx`: every drawable a kit has placed, under or over the foes |
| `Player.kick`, `WeaverLimbs` | `noteMelee` (a melee kill restores Rusk's armor) |
| `PlayerSprite`, `PlayerRagdollSprite` | the fighter's look (`render/player/FighterArt`) on the alchemist's own rig, alive and fallen |
| `Pickups` | a potion pickup emits `flaskUsed` (Edda's Stored Light) |

The ultimate bar charges from damage dealt, damage taken, kills and time (`fighters/tuning.ts`); a kit's
tuning lives in a `TUNING` object beside the kit; the live probes decided the final numbers.

## Probes (dev server running; real key presses, a paused deterministic world)

`scripts/fighter-probe.mjs` is the shared harness. `verify-fighter-framework` (the engine seams, 28 checks),
`verify-fighter-run` (start, save, continue, daily), `verify-fighter-chips`, `verify-fighter-title`,
`verify-fighter-ledger` (the ledger has no fighter), `verify-fighter-arena`, `verify-fighter-roster` (the roster screen at four sizes), one
`verify-fighter-<name>` per kit (60 to 100 checks each, against real foes, real cells and real terrain),
and `verify-fighter-roster-play` (all ten through a real run: Z and T, a floor change, a death and a respawn).
`scripts/fighter-studio.mjs` draws every fighter in every pose.

## Principles

1. **A fighter changes the hands, not the rules.** Same hitbox (halfW 4, 17 tall), same base vitals, same wands
   and flasks. Identity comes from the look and the three abilities. A fighter that needed a different
   hitbox would need a different crawl tier, ladder rules and findability audit; none does.
2. **If the grid can't explain it, it doesn't ship** (CLAUDE.md). Smoke is `Cell.Smoke`, steam is `Cell.Steam`,
   Ironvine is `Cell.Vines`, a fire trail is `Cell.Fire`. An effect that is only a number on an entity must
   also be *visible* in the world, and anything that persists in the grid must be able to burn, dig or fade.
3. **Fail-open.** No ability may seal a route. Terrain an ability writes is flammable or diggable vegetation
   or short-lived, and a lifetime is always bounded.
4. **Solo first, arena-ready.** The game today is one fighter against the Works. Where a design line targets
   "fighters" or "allies" it resolves against enemies, or against the fighter herself, and is written against a
   `target` abstraction so a peer can stand where an enemy stands when the arena mode exists
   (docs/BATTLE-ROYALE-AND-SPACETIMEDB.md).
5. **Default hero untouched.** No fighter selected means today's alchemist, byte for byte. Every fighter hook
   is behind `ctx.fighters?.active`.
6. **Feel beats features.** Every ability has a windup or tell, a sound, a visible effect and a HUD state
   (ready / cooling / charging / active). Cooldowns and charge are in ticks (60 Hz).

## Controls and HUD

| Action | Default key | Notes |
|---|---|---|
| Tactical | **Z** | rebindable (`tactical`); tap. Cooldown sweep on its chip. |
| Ultimate | **T** | rebindable (`ultimate`); tap once the bar is full. |

Both are free in `input/bindings.ts` and in the pause/overlay key gates. Two chips sit under the flask belt
(`#expedition-tools`): icon, key label, cooldown seconds, the ultimate's charge bar.

**Ultimate charge** is 0..1. It fills from damage dealt (0.15% per point), damage taken (0.2% per point), kills
(+3%) and a slow trickle (+1% per 10 s), and is spent whole by the ultimate. Charge is saved with the run.
(The numbers live in `fighters/tuning.ts`; harm the world does on the player's behalf counts for half.)

## Roster, solo adaptations and status

`ability` rows give the design line, then what it is in this game. Numbers live beside the code
(`src/fighters/kits/<id>.ts`).

| # | Fighter | Role | Passive | Tactical (Z) | Ultimate (T) |
|---|---|---|---|---|---|
| 01 | Ilyra Voss | Duelist | Volatile Mixture | Flash Crucible | Phoenix Draft |
| 02 | Brann Rook | Bulwark | Pressure Vessel | Boiler Guard | Redline |
| 03 | Sable Fen | Hunter | Wounded Spoor | Bogline | Bloodsense |
| 04 | Mara Quell | Controller | Keen Resonance | Resonance Bell | Dead Chime |
| 05 | Kest Rel | Duelist | Rooftop Runner | Smoke Step | Updraft |
| 06 | Nox Calder | Controller | Soot Sight | Blackglass | Long Night |
| 07 | Edda Morrow | Support | Stored Light | Mercy Shard | Rose Window |
| 08 | Selene Wraith | Duelist | Liquid Momentum | Quicksilver Echo | Mirror Hunt |
| 09 | Rusk Emberjaw | Bulwark | Scrap Recovery | Shoulder Ram | Kiln Heart |
| 10 | Father Thorne | Controller | Rooted Camouflage | Ironvine | Overgrowth |

Per-ability specs follow (the design intent). Where the real game forced a different answer, the fighter's own file
under `docs/fighters/` says so under "Deviations": for example Kest's Updraft is a draft with a balance point
rather than a constant lift, Rusk's ram breaks Wood rather than calling `Mechanisms.strike`, and Ilyra's
"weapon" is the last card cast.

## Ability specs (the contract each kit is built to)

Times are ticks at 60 Hz (60 = 1 s). "Foe" is any enemy; where a design line says "fighter" or "ally" the
solo game resolves it against foes, or against the fighter herself. Numbers are first-pass tuning, kept in
one `TUNING` object at the top of each kit file; the live probes decide the final values.

**Ultimate charge** (`tuning.ts`): +0.15% of the bar per point of damage dealt, +0.2% per point taken, +3% per
kill, +1% per 10 s; world harm done on the fighter's behalf counts half. A bar fills after roughly 650
damage dealt: one or two ultimates a floor in a normal fight.

### 01 Ilyra Voss: the Cinder Alchemist (Duelist)
- **Volatile Mixture.** After the fighter damages a foe with two *different weapons* within 4 s, her next hit
  applies **Scorch**. A "weapon" is a damage channel: the equipped spell card (`player.spell`), a kick
  (`sys.recentMelee`), a thrown flask or her own crucible. Scorch = the foe is set alight (burning status >= 120
  ticks, shedding real Fire cells) plus a 6-damage flare. Fire-proof foes (imp, colossus, ...) take the flare only.
  The passive pulses on the chip when primed.
- **Flash Crucible** (Z, 9 s). Throw a vial along the aim (v 6.5, gravity .18, like `Flask.ts`'s bottle); it
  bursts at its first solid cell or after a 40-tick fuse. The burst does NOT carve terrain and does NOT hurt
  her: radius 30, foes inside take 14 and are knocked outward (kx up to 3.4), a few Ember/Fire cells scatter, a
  warm flash light (`sys.addLight`), a shockwave ring, `punch()`. Within 22 cells of the burst she is shoved
  outward too (impulse 2.2): the vial is also a way to leave.
- **Phoenix Draft** (T, 480 ticks). Run speed x1.25, wand cast/reload delay halved (find the real knob in
  `WandSystem`), immune to fire (`immuneTo: ['fire','burning','oiled-fire']`, burning status cleared each tick),
  and a burning trail: while moving faster than 1.5 she drops Ember/Fire cells behind her every 3 ticks (real
  cells: foes that step in them burn). A phoenix-gold rim glow and a small light follow her.

### 02 Brann Rook: the Iron Pilgrim (Bulwark)
- **Pressure Vessel.** Health lost to a single blow of >= 6 fills **Pressure** (0..100): +min(40, 2.5 x lost);
  it bleeds 2 per second. At 100 she gains 4 s of stagger resistance (`staggerResist` modifier), vents a puff of
  Steam cells and resets to 0. The HUD shows the Pressure meter (`meter()`).
- **Boiler Guard** (Z, 10 s). Raise a frontal iron plate (faces the aim side) for 210 ticks. Hostile
  projectiles entering the plate's front arc (+-65 degrees, 14 cells out) are consumed (`intercept`) with a clang
  and sparks; incoming melee/explosion damage from the front is x0.5 (a modifier while raised). She walks at
  x0.75 and may cast. Z again lowers it early (the cooldown still runs). The plate is a drawable.
- **Redline** (T, 480 ticks). Armor of stone: `damageTaken` x0.5 and `staggerResist` (no knockback at all), and
  she vents: every 6 ticks Steam cells (life ~30) puff around her (radius 9), and every 15 ticks foes within
  16 cells take 3 scald damage. Her lantern flares red.

### 03 Sable Fen: the Mire Stalker (Hunter)
- **Wounded Spoor.** Any foe the fighter hurts is marked for 6 s and leaves a **spoor**: a trail of fading
  green motes at its last positions (sampled every 4 ticks, 14 deep), drawn on the 'under' layer so the track
  reads through darkness and walls. Marked foes pulse faintly when out of sight.
- **Bogline** (Z, 8 s). Fire a hooked tether along the aim, range 150. It stops at the first solid cell or foe
  (test the body with `pointHitsCreature`-style stepping at <= 1 cell). On terrain: she is hauled to the hook by
  `startMove` (6 cells/tick, <= 28 ticks, ends 8 cells short or blocked) and keeps her momentum on exit. On a
  foe: it is yanked toward her (`knockVx/Vy/knockT`, about 4 cells/tick for 10 ticks), stunned 20 ticks and
  marked. No hit: refuse (no cooldown). The tether is a drawable while it is out. SFX `trick.whip`.
- **Bloodsense** (T, 600 ticks). Every wounded foe (hp < maxHp) within 320 cells is revealed through walls and
  darkness (`revealEnemy`, green), re-evaluated each tick so a foe wounded mid-ultimate joins in. She also moves
  x1.1. A slow heartbeat ring pulses out from her.

### 04 Mara Quell: the Bell Witch (Controller)
- **Keen Resonance.** Foes that are walking, climbing or landing within 200 cells and out of her sight line
  emit a faint purple **ripple** at their feet (every 14 ticks while moving), visible through walls; nearer is
  brighter. Information only.
- **Resonance Bell** (Z, 14 s). Place a bell at her feet (or the open spot nearest the aim within 70 cells),
  at most 2 at once (placing a third retires the oldest). When a foe comes within 70 cells of a bell it rings:
  every foe within 100 cells of the bell is revealed for 4 s (purple), `pickup.bell`/`world.gong`, a ring of
  light; each bell re-arms after 6 s and lasts 30 s. Bells are cleared on a floor change.
- **Dead Chime** (T, instant, effect 360 ticks). A wave radiates from her (150 cells over ~20 ticks, a visible
  expanding ring through rock). Foes it reaches are slowed x0.45 for 6 s; casters and machines (mage, spitter,
  wisp, bomber) are stunned 3 s; hostile projectiles inside the ring are removed. It must never touch the
  fighter's own route: nothing it does may block progression (no mechanism is disabled).

### 05 Kest Rel: the Chimney Jack (Duelist)
- **Rooftop Runner.** `climbScale` x1.5 permanently (a modifier with an infinite lifetime), and the mantle reach
  bonus the hook already gives (`climbScale() > 1`). Ladders (Trunk/Wood cells) and wall climbs are faster.
- **Smoke Step** (Z, 8 s). Dash 36 cells along the aim (`startMove`, 6 ticks x 6 cells, i-frames, ends at a wall),
  leaving soot: Smoke cells (life 40-70) in a radius-7 puff at the start and at the end, plus `concealment` 0.6
  for 150 ticks ("briefly obscuring your silhouette"). She exits with her momentum.
- **Updraft** (T, instant, effect 360 ticks). Deploy a compact furnace at her feet (a drawable: sooty iron
  and a flame), which drives a rising column 18 wide and 90 tall for 6 s: any body in it (the fighter, foes,
  rigid bodies) is pushed upward (`vy -= 0.35` per tick, capped near -4.2). Real cells: Fire at the mouth and
  Steam/Ember rising in the column. She can ride it, and foes can be thrown skyward by it.

### 06 Nox Calder: the Lampblack (Controller)
- **Soot Sight.** While she is in darkness (`ctx.lightQuery.darkness(x,y) > 0.5`) or inside smoke (>= 6 Smoke cells
  in a 9x9 box), foes within 160 cells are drawn as faint white silhouettes through the dark (a dim
  `revealEnemy`). Information only.
- **Blackglass** (Z, 12 s). Throw a canister along the aim (arc, bursts at first solid or after 45 ticks): a
  dense cloud of real Smoke cells, radius ~20, life 240-420. While she stands in the cloud
  (`concealment()` from the Smoke-cell count around her) she is nearly unseen: enemies' notice range collapses
  (`concealment` 0.85 at full density). The cloud burns away if lit (fire eats smoke in the sim).
- **Long Night** (T, 720 ticks). Extinguish artificial lights and darken a large local zone: authored lights
  within 260 cells are dimmed to 0 (restore on end), and a big dark zone (`runtime.darkZones`, a NEW array so
  the bake notices; restore the original on end) falls around her. Her own lantern is unaffected. While it
  lasts she has `concealment` 0.5.

### 07 Edda Morrow: the Glass Saint (Support)
- **Stored Light.** She carries an armor pool (max 30). Using a consumable (`flaskUsed` verb 'drink', i.e. a
  potion or flask) grants +12 **overshield** (armor) with a gold glint. Overshield absorbs damage before health
  and does not regenerate on its own.
- **Mercy Shard** (Z, 12 s). A floating glass shard is sent to an ally and grants it x0.6 incoming damage for 6 s.
  Solo, the ally is herself (shard orbits her, then settles); the code finds targets through a small
  `allyTargets()` function so a peer fighter can stand there in the arena mode.
- **Rose Window** (T, 600 ticks). A stationary stained-glass prism at her feet (a drawable rose window):
  within 60 cells it heals her 4 hp/s, and hostile projectiles entering its radius are refracted outward
  (their velocity is turned away from the prism; not consumed). It dims and shatters when the time is up. Light.

### 08 Selene Wraith: the Mercury Twin (Duelist)
- **Liquid Momentum.** A **slide**: crouching (down) while grounded and moving >= 2.2 starts a body-owning slide
  (`startMove`): she keeps her speed with 3% decay per tick for up to 45 ticks, low pose (`crouchT`), ends when she
  stops, jumps, or is blocked, and exits with 80% of her speed. A normal crouch-creep clamps speed to 38%; this
  is what the passive replaces.
- **Quicksilver Echo** (Z, 8 s). Leave a silver echo where she stands and blink up to 40 cells along the aim to
  the nearest standable spot (`findLanding`; refuse if none), 8 ticks of i-frames. Pressing Z again within 180
  ticks returns her to the echo (and shortens the cooldown to 40%). The echo is a drawable that fades.
- **Mirror Hunt** (T, 540 ticks). Two harmless echoes mimic her movement direction and weapon silhouette,
  offset 28 cells ahead and behind, riding the ground. Foes may hunt them instead of her (`decoyFor`: the nearer
  of the real body and the decoys, rolled once every 20 ticks per foe with a seeded stream). A foe that reaches a
  decoy pops it (silver burst) and is stunned 30 ticks.

### 09 Rusk Emberjaw: the Furnace Hound (Bulwark)
- **Scrap Recovery.** She carries an armor pool (max 40, starts full). A **melee elimination**
  (`killed && sys.recentMelee`: a kick, a limb swing, a ram) restores +14 armor.
- **Shoulder Ram** (Z, 9 s). Charge 8 ticks at 5.5 cells/tick along the facing (`startMove`, i-frames, face):
  foes in the path take 16, are shoved (`gustShove`) and stunned 20 ticks; Wood cells in the path are broken
  (burned to Ember), and `ctx.mechanisms.strike(x, y, r)` breaks mechanism doors it hits (a destroyed mechanism
  opens its gate: fail-open). Each tick of contact calls `noteMelee`. It ends at a wall with a thump and shake.
- **Kiln Heart** (T, 600 ticks). Armor max raised to 80 and filled; `damageTaken` x0.8. When a foe within 20
  cells hurts her (`onPlayerHurt`), embers burst: 6 Ember cells around her and every foe within 16 takes 6 and
  catches fire. Her furnace core blazes (light). The armor ceiling returns to 40 afterwards.

### 10 Father Thorne: the Briar Heretic (Controller)
- **Rooted Camouflage.** Standing nearly still (|vx| < 0.2 for 60 ticks, grounded) within 10 cells of natural
  cover (>= 6 Moss/Leaf/Trunk/Vines/Fungus/Glowshroom cells in that box) slowly hides her: `concealment()` rises
  from 0 to 0.6 over 180 ticks, drops at once when she moves. A few leaf motes stir around her.
- **Ironvine** (Z, 12 s). Grow thorny vines across the surface along the aim, up to 60 cells: Vines cells
  stamped on and over the ground/wall (never into open air or over a body), 2-3 cells deep. Any foe standing in
  or on them is slowed x0.5 and scratched (1 damage per 12 ticks). The vines are real cells: they burn and can be
  cut, and they wither on their own after ~25 s. The first foe the vines catch is marked.
- **Overgrowth** (T, instant, effect 720 ticks). Rapidly cover a radius-70 zone around her in climbable roots
  (Trunk/Wood-like cells hung from ceilings and up walls), Moss and Leaf ground cover and hanging Vines. Inside it
  she has `concealment` 0.7 and foes are slowed x0.6; the player can climb the roots like any wall. Cells that
  grow must leave every route passable (`connectToCaves`-style fail-open): it may never seal a gate.

## Writing a kit

1. `src/fighters/kits/<id>.ts` exports `kit: FighterKitDef` (see `src/fighters/kit.ts`). `create(sys)` returns a
   `KitInstance` whose fields hold its own state. The file is a lazy chunk; the roster preloads the chosen one.
2. Use the system's machinery (`FighterSystem`): `setMod` (move/climb scale, damage taken, stagger resistance,
   concealment, damage-source immunity), `setArmorMax/addArmor`, `slowEnemy/stunEnemy/revealEnemy/markEnemy`,
   `enemiesNear`, `hurt`, `startMove` (a dash/blink/ram/tether the system carries out cell by cell),
   `addDrawable`, `addLight`, `callout`. Helpers that are plain functions live in `src/fighters/effects.ts`
   (`aimOf`, `findLanding`, `castToSolid`, `stampDisc`, `countCells`, `punch`).
3. Randomness: `entityRandom()` for anything that changes the world or a foe, `fxRandom()` for cosmetics. Never
   `Math.random()` (lint-enforced in this directory).
4. Anything you place in the world is cleared in `reset()` (called on a respawn, a floor change and unequip).
   Cells you wrote live in the World that was current; hold the World reference if you must revert them.
5. Every ability needs a tell (windup or pose), a sound (an existing cue: `src/content/audio/sfxCues.ts`), a visible
   effect and a chip state. New audio would be generated offline (paid), so reuse cues.
6. A probe: `scripts/verify-fighter-<name>.mjs` using `scripts/fighter-probe.mjs` (paused, deterministic steps,
   REAL key presses), asserting each ability's observable effect in the real engine, not a flag.

## Architecture

- `src/content/fighters.ts`: identity and copy only (the design document's text, verbatim). Pure data, safe in the
  `world` chunk.
- `src/core/fighters.ts`: the `FighterApi` contract and the shapes abilities use.
- `src/fighters/`: `FighterSystem` (the tick: cooldowns, charge, active effects, passives), the shared effect
  helpers (dash, blink, reveal, slow, armor, placed entities) and one kit module per fighter.
- `src/render/player/fighterLooks.ts`: the ten looks (palettes, headgear, props) drawn by the same rasterizer
  and skeleton as the alchemist; `scripts/fighter-studio.mjs` renders every fighter at every pose.
- `src/ui/FighterRoster.ts`: the roster screen (browse, filter by role, inspect, choose).
- Run plumbing follows `kitId` exactly (`RunStartConfig`, `RunSaveState`, `RunMetaView`, `RunSummary`).

## Art

The concept sheets are illustrated at about 120 px per figure, and the player is 17 cells tall, so the sheets
are *reference*, not sprites. Every fighter is a look on the production rasterizer: palette, headgear, hair,
coat length, armour plates, a held or carried prop, and a cloth rig (the same four verlet chains). Portraits
are the concept art, shipped as 20-36 KB WebP; the full sheets are lazy-loaded by the dossier.

## The roster screen (`src/ui/FighterRoster.ts`)

Who descends: a full overlay with the classic Alchemist first and the ten after it, a role filter, a search
("/" focuses it), and a dossier for the one in focus (portrait, lore, Passive / Tactical / Ultimate with the
keys they sit on, four ratings, a lazily loaded concept sheet). The arrow keys walk the grid and the dossier
follows the focus (the kit picker's describe-on-focus); **Choose** confirms. Weapons stay with the kit and with
loot, and the dossier footer says so.

```ts
new FighterRoster(ctx, {
  onChoose(id: FighterId | null) {},      // null = the classic Alchemist
  onCancel?() {},                         // Escape, Back, a pad's B
  keyLabels?: { tactical: 'Z', ultimate: 'T' },   // the player's bindings
  unlocked?: ReadonlySet<FighterId>,      // default: all ten. A locked card is readable, never chosen
  unlockHint?(id) { return '...'; },
});
roster.open(selected: FighterId | null); roster.close(); roster.refresh({ unlocked, keyLabels }); roster.dispose();
```

- **Hosts add** `'#fighter-roster.visible'` to `KEYBOARD_UI_BLOCK_SELECTOR` (`input/InputManager.ts`) and to the pad's
  overlay list (`pollGamepad`'s `#pause-overlay.visible, #run-summary.visible, ...`); the title's pad branch must
  also yield to it. `FIGHTER_ROSTER_SELECTOR` / `FIGHTER_ROSTER_OPEN_SELECTOR` are exported for that.
- **Import it statically** where it is used. Its module installs a window capture-phase guard when it loads, so
  the game's hotkeys (map, bench, handbook...) and a pad's B stay out while it is open, whatever order the systems
  are built in. It pauses the sim while open and puts the pause back as found.
- **Layout keys on the overlay's own size** (`container: fighter-roster / size`; no `@media` on the window, because the
  game view is a 16:9 letterbox): *wide* (view >= 1100 x 640) is a six-up card grid beside the dossier; *compact* is a
  four-up portrait grid beside a dossier that sets its portrait to the side. 800x600 in a run is an 800x450 view and
  is compact.
- **Art**: portraits load the first time the roster opens (not when it is built); a concept sheet loads only when the
  player asks for it and then only that fighter's, never prefetched. Nothing is inlined.
- **Probe**: `node scripts/verify-fighter-roster.mjs [url]` (title, play and Workshop mounts at 800x600, 960x600,
  1280x720, 1600x900; screenshots in `verify-out/fighter-roster/`). The pure logic (filter, search, counts, bars,
  grid stepping) is `ui/fighterRosterModel.ts`, pinned by `tests/fighter-roster-model.test.ts`.
