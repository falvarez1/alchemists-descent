# Game Feel & Micro-Interaction Codex

Every mechanic, nuance, and micro-animation that makes Alchemist's Descent feel
alive, in one place. This is the *intent* record — where the code lives, what
the numbers are, and why each layer exists. Companion docs: `ARCHITECTURE.md`
(systems), `docs/DESIGN.md` (game design), `.claude/skills/indie-game-dev/SKILL.md`
(the feel principles as working rules).

The house principles, in order of authority:

1. **If the grid can't explain it, it doesn't ship.** Feedback is made of real
   cells wherever possible — splashes are the pool's own liquid, slam debris is
   the actual sand, a waystone lights with real fire.
2. **Feel beats features.** Every verb answers within a frame or two and has a
   visible/audible consequence.
3. **Anticipation → action → follow-through.** Bodies gather before they act
   and settle after (Dead Cells / Hades / Rain World school, expressed at
   2–3 screen pixels per cell).
4. **Fail-open.** Physics chaos may never hard-lock progression.
5. **Light is information.** Emissive = important; glow is never decoration only.

---

## 1. The Alchemist — movement feel

| Mechanic | Rule | Where |
|---|---|---|
| Coyote time | A jump press within 6 frames of walking off a ledge still gets the full jump | `entities/Player.ts` |
| Jump buffer | A press up to 8 frames before touchdown fires on the landing frame | `Player.ts` |
| Air control | Mid-air acceleration (0.575) is *stronger* than ground (0.5) for Ori-like corrections | `Player.ts` |
| Levitation spool | Thrust starts at a near-hover 0.34 (gravity 0.28) and builds t² to 0.62 over 20 frames — a tap feathers height, a hold winds into a climb; releasing resets the spool. The exhaust plume scales with the spool. Refuels on ground/liquid contact | `Player.ts` |
| Levitation sputter | Below 20% fuel the jet coughs — exhaust gaps + put-put audio — so panic starts *before* the fall | `Player.ts` + `AudioEngine.sputter` |
| Step-up | 2-cell ledges are walked up automatically (step-up 5 in the entity mover) | `entities/physics.ts` |
| Loose rubble | Connected solid clusters < 5 cells are walk-through debris | `physics.cellBlocks` |

### Crouch & peek (hold S on the ground)

- Knees bend into a held landing-squash pose, feet planted wide; a settle puff
  kicks off the heels on entry.
- Movement drops to a 0.38× creep while held.
- The camera peeks **48 cells below** the ledge (`crouchT/10 × 48`, smoothed by
  the camera lerp) — scouting the next drop is a stance, not a guess.
- The idle fidget is suppressed while crouching; the eye glances down (§3).
- State: `player.crouchT` 0–10. `Player.ts` (stance), `render/Camera.ts` (peek).

### Dive slam (press S in the air)

- Commit point: `vy > -1` (apex or falling), not in liquid. Levitation yields.
- The body locks into a **falling spear**: legs speared tight, full 2-px
  stretch, robe streaming up, the hat objects through its spring (`h.vy -= 2.6`),
  a whoosh on entry, speed streaks peel off the shoulders every other frame.
- Physics: `vy` floors at 4.6 (entry kick 5.6) and terminal velocity rises to
  **6.4** for the dive only (normal cap 5.0). Horizontal drift bleeds at
  0.86×/frame.
- **The landing pays it off:**
  - max landing squash (landTimer 10), dust ring both directions, hard thud,
    small viewport shake;
  - the soft top layer (sand / snow / ash / gold / coal, up to 12 cells) bursts
    into **real ballistic grains** that scatter and redeposit — the grid
    explains the impact;
  - grounded foes within 26 cells are chipped (1 dmg) and knocked off their feet.
- Water cancels the dive into the normal splash. State: `player.diveT`.

---

## 2. The Alchemist — procedural animation stack

The wizard is 9×17 cells, drawn procedurally each frame (`render/sprites/
PlayerSprite.ts`); animation state advances in `PlayerControl.
updatePlayerAnimation`. Animation runs off **real displacement** (`_svx/_svy`
smoothed trackers), not intended velocity — grinding a wall doesn't cycle legs.

Layered, bottom to top:

| Layer | Behavior |
|---|---|
| Stride wheel | Boots alternate fore/aft with ground speed; the lifting foot clears the ground; each half-turn is a footstep (§6 audio) |
| Velocity lean | Torso shears ±2 px with smoothed vx |
| Run bob / idle breathe | Body dips with the stride beat; a slow chest rise when standing |
| **Squash & stretch** | Landing squash scales with fall speed (up to 3 px, hem widens); **jump launch stretches** 2 px and tapers the hem — a full S&S cycle |
| **Three air poses** | Rising = tight leg tuck · apex = drift · falling = legs trailing apart, off-hand thrown high, robe flared. The jump arc reads from silhouette alone |
| **Turn skid** | Reversing above walk speed (input sign vs `_svx` sign, \|svx\| > 1.1): 9 frames — both heels plant down the old direction, torso throws back (lean 3), the hat whips forward, dust scuffs off the heels (burst + mid-skid trickle) with a scuff noise |
| **Cloth springs** | The hat is a damped spring (4 progressive segments, tip whip, airflow lift while falling). The robe hem has a second, heavier spring — the skirt swings past a stop and settles instead of snapping; a skid sends it overtaking the body |
| **Cast recoil** | Each cast kicks the staff back 1–2 px along the aim for 5 frames (7 for card groups ≥ 25 mana) and jolts the hat through its spring |
| **Hurt stagger** | Damage leans the body away from the knockback vector for 12 frames and whips the hat with the blow (on top of hitstop ≥ 8 dmg) |
| **Idle fidgets** | ~7 s of true stillness: the off-hand reaches up and straightens the hat (the hat springs at the touch), then the staff gets a slow flourish of cyan sparks. Repeats ~6 s later. Cancelled by any action; a crouch is a stance, not boredom |
| Blink | Random 6-frame blinks (~0.7%/frame) |
| Lever pull | E starts a 26-frame hand-pull: rooted, staff stowed, both arms reach, strain bob; the lever arm smoothsteps across and flips at completion |
| Heart communion | Refilling at a heart roots and disarms the wizard for the ~2 s channel; broken by damage (with toast) |

### Character definition (the Noita-class readability pass)

- **Silhouette rim:** every body pixel is recorded during the draw and a
  near-black 4-neighbour outline is stamped around the finished figure
  (skipped below the feet; the staff/meters/tip draw outside the recording).
  The figure cuts against any background.
- **Value-contrast palette:** edges run dark (near-navy robe edge, deep hat
  shade), accents run bright (gold band, trim), boots near-black, and the brim
  shades the brow (a dedicated shadow row).
- The player sprite draws **raw colors** — it is *not* multiplied by the scene
  light field (enemies are) — so the wizard reads even in pitch black, by
  construction.

### The staff

- ~11 cells, Gandalf-proportioned: a dark butt end trailing behind the gripping
  hand, a contiguous shaft brightening toward the head, the hand drawn over the
  shaft as the grip.
- **Laid backward from the muzzle:** the shaft is drawn from the `wandTip()`
  contract point (projectile spawn + light seed — unchanged) through the hand,
  so the glow always sits on the staff's literal end; the butt flexes to keep
  total length constant whatever lean/bob did to the hand.
- **One-sided drop shadow:** a near-black pixel under each shaft cell
  (underside only) pops the staff off the background without fattening it.
- **Wand-swap draw:** swapping sweeps the new staff up from the hip in a
  quadratically-eased 12-frame arc, with a gleam as the head catches the light
  mid-draw; the muzzle glow stays dark until the staff is up. Synced to the
  swap "whick" (`AudioEngine.wandSwap`, play mode only — fired by the
  `wands.active` setter).
- **Tip glow:** smolders at rest (0.55×) so its bloom halo can't wash the
  silhouette; flares to full the moment the trigger is down. The visual tip
  rides recoil and the draw arc; gameplay's muzzle point does not move.

---

## 3. Eyes — the look-at system (Rain World)

- **The player's pupil seeks the nearest threat** within 80 cells — even one
  behind him (the eye flips sides without the body turning). With no threat it
  follows the aim pitch; a held crouch-peek forces the glance downward.
- **Enemy eyes are honest:** an *unaware* creature scans the room on a slow
  sinusoidal wander. Only an **alerted** one (`e.alerted`, set by the
  notice-blip moment) locks its gaze onto the alchemist — so eye contact means
  something. Alerted slimes also pitch their eyes to your altitude.
- Mage hood-eyes never leave you by design (they're the telekinesis telegraph);
  bat eyes are emissive red glints that pierce darkness.

---

## 4. Enemy body language

### Anticipation (attacks are readable)

| Creature | Telegraph |
|---|---|
| Slime / acid slime | Hops charge through a visible **windup** — the body gathers wide and low (7 frames for a chase hop, 12 for a lazy wander hop), *then* springs |
| Bat | Closing within 64 cells it **brakes into a full wing-flare hold** (8 frames, wingtips out one extra reach, slight hover-lift), then commits to a 12-frame **dart** that briefly outruns its flight cap (2.6 vs 1.7), with a squeak on launch |
| Golem | Wall-punch wind-up + haymaker + knuckle sparks; pound rhythm 46 frames |
| Spitter | Maw recoils 14 frames after each lob (`e.recoil`) |
| Bomber | Fuse strobe — jiggles, then strobes white as `e.fusing` burns down |
| Colossus | Slam/volley wind-ups; bellows when it notices you |

### Wounded postures (< 40% hp)

- **Slimes droop** — the membrane sags wide and low at rest — and spring
  **shallow, crooked hops** (0.55–0.85× impulse with jitter).
- **Bats flutter-tumble** — random 14-frame failures: double-time wing
  scramble, body roll, sinking — then recover.
- All wounded enemies already shed **gore drips** as they move.

### Other living touches

- **Notice blips** when a creature first spots you (the colossus bellows instead).
- **Bat roosts:** dormant folded teardrops on the ceiling; one red eye cracks
  open at your approach (< 70 cells wakes them; stirring starts at 110).
- **Slime egg clutches** glisten with pulsing embryos; they hatch on a timer —
  sooner if you loom.
- **Predation:** bats prefer a nearby moth over you; the gulp is a puff of wing
  dust.
- Slime landing splat, imp 3-pose wing flap + tail wag, enemy blink, smoothed
  velocity leans — all per-kind in `render/sprites/EnemySprites.ts`.
- Enemy bodies obey the light field (a body in shadow is a silhouette); only
  natively glowing kinds (imp, wisp) and emissive parts (eyes, cores) self-light.

---

## 5. Combat & casting feedback

- **Cast cursor:** the amber glow on the hotbar marks which card group fires
  next; every click casts the next group left → right, then wraps.
- **Dry fire:** an empty-mana click answers with a hollow click, a mana-bar
  flinch on the HUD, and a sad fizzle of particles at the staff tip (throttled
  to every 14 frames while held).
- **Recharge:** the wrap-around recharge reads on the hotbar as the bar refills.
- **Hitstop:** hits ≥ 8 damage freeze gameplay for 3 frames (rendering
  continues).
- **Screen shake is earned and local:** *all* ambient shake writes are
  viewport-gated and fall off quadratically with distance — dead at 420 cells.
  Explosion boom audio scales the same way (distant thunder). A quake next
  door rattles you; across the cavern it's a tremor; off-screen it is nothing.
- **Damage:** blood spray scales with the hit; the damage vignette pulses; a
  slow heartbeat starts under 25% HP and turns urgent under 12%.
- **Death, the Noita way:** ~75% of carried gold spills as physical gold piles
  at the corpse. The world keeps every scar; you respawn at the last lit
  waystone and walk back to reclaim it.
- **Charged bomb throw:** power meter dots march out along the aim past the
  staff head as the charge builds.

---

## 6. Sound as material truth (procedural, `audio/AudioEngine.ts`)

- **Footsteps read the ground:** each stride half-turn samples the cells
  underfoot — stone ticks, sand/snow/ash hushes, wood knocks, shallows slosh.
- **Landing thud** scales with fall height; hard landings add dust and a shake
  kick.
- **Liquid entry splash** throws up droplets of *the pool's own colors* and
  pitches with entry speed.
- Wand-swap whick, dry-fire click, levitation hum + sputter, low-HP heartbeat,
  dig crackle, flask **refusal** buzz when siphoning nothing siphonable
  (`flaskDry`), waystone **gong** + ember column when lit, rolling-gold
  chimes on pickup, bench card clicks + slot flash, door retraction grind,
  trigger→gate spark line, chirps/skitters/drips from the critter layer.
- All one-shot presets are throttled per-key so spam can't stack them.

---

## 7. The caves breathe (ambient life)

- **Critters** spawn from local cell context and live transiently: moths steer
  to glow and wand light, fireflies carry light seeds, fish school in real
  water, beetles graze fungus/moss, flies orbit blood. `structureStrike` kills
  them like anything else.
- **Weather of the deep:** ceiling drips are real water cells; ember falls,
  spore drift, dust motes, heal-spring bubbles.
- **Cave moss** creeps only on damp stone (real moisture check).
- Enemies outside the sim window (camera ± 60 cells) freeze — the world
  simulates where you are.

---

## 8. Camera & presentation

- Lerp follow (0.085) with a facing lookahead (+26 cells), idle zoom-in (1.13×
  after ~1 s of stillness), hard snap on spawns/transitions.
- Crouch-peek offset (§1). Build mode pans with WASD.
- **Frame look:** half-res RGB lighting with directional sweeps, bloom with a
  uniform emissive self-glow floor (no vignetted emissives), lit-cell soft knee
  (1.25/0.3/2.0) so bright floors don't bloom-wash, PostFx chromatic
  aberration + grain + low-HP pulse.
- Level banners rise in; overlays rise in; gameplay fonts sized for readability.

---

## 9. Mechanism & objective feedback

- Doors retract cell by cell; a spark line traces trigger → gate when a sensor
  fires; braziers light with real fire; plates depress under real weight; the
  sand scale, sluice, and charge coil read raw cells as their sensors.
- **Fail-open groan:** wreck a mechanism's trigger body and its gate groans
  open ~30 s later — physics never locks you out.
- Golden key glints on the minimap; the portal pings when it opens; objective
  HUD + toasts narrate progression; waystones gong and hold an ember column
  once lit.

---

## Tuning quick-reference (this codex's load-bearing numbers)

```
coyote 6f · jump buffer 8f · jump vy -3.7 · gravity 0.28 (liquid 0.12)
levitation spool: 0.34 -> 0.62 thrust over 20f (t-squared ease-in)
run accel 0.5 ground / 0.575 air · max run 2.6 · crouch 0.38x · peek +48 cells
dive: entry 5.6, floor 4.6, terminal 6.4 (normal 5.0), drift x0.86/f
slam: 26-cell knock radius, 1 dmg, ≤12 powder cells popped
skid: trigger |svx|>1.1 on reversal, 9f · stagger 12f · recoil 5f/7f
swap draw 12f (gleam f5-7) · fidget arms at 420f idle, routine 90f
slime windup 7f chase / 12f wander · wounded hop 0.55-0.85x at <40% hp
bat flare 8f at <64 cells · swoop 12f cap 2.6 · tumble 14f, ~1.2%/f at <40% hp
player eye seeks threats <80 cells · enemy gaze locks only when alerted
shake falloff dead at 420 cells · hitstop 3f at ≥8 dmg · heartbeat <25% hp
sim window camera ±60 · player 9x17 cells · staff ~11 cells, muzzle at d=9
```

When changing any of these: one at a time, deliberately, and say so in the
commit (they are load-bearing — see the project skill's hard invariants).
