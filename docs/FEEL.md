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
| Air control | Mid-air acceleration (0.575) is *stronger* than ground (0.5) for Ori-like corrections, then paced by early descent depth. D1 starts at 0.74x horizontal / 0.84x vertical so new players can read the cave; baseline returns by D5, while Swift/Swift Soles/Levity visibly push through the slower start. Input accelerates only UP TO maxRun and never drags carried momentum back down, so a fast run carries into a jump/levitate; airborne uses gentle `airDrag` (0.985) inertia instead of the ground's 0.72 stop — flight coasts and keeps momentum | `Player.ts`, `progressionPacing.ts` |
| Levitation spool | Thrust starts at a near-hover 0.33 (gravity 0.28) and builds t³ to 0.57 over 48 frames; a per-frame 0.92 drag makes climb speed *asymptote* to ~3.3 cells/frame (90% by ~f51) instead of snapping to the cap. A tap feathers height, a hold winds slowly into a climb; releasing resets the spool. The exhaust plume scales with the spool. Refuels on ground/liquid contact. Live-tunable in `params.player` (Builder → Global Controls → LEVITATION; adjustable mid-playtest) | `Player.ts` + `config/params.ts` + `Builder.ts` |
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

### Crawl (hold S on the ground and move — docs/CRAWL.md)

- The creep flows into the **9×9 second collision tier**: step-up 5 (parity
  with standing — hands climb what boots climb, so jagged 3-5 cell lips never
  wedge a crawler where a runner strolls), speed 0.32×, jump/levitate/dive
  disabled (W is a stand attempt first). S is intent, geometry is law —
  release the key under a low ceiling and you keep crawling until the
  headroom probe (`entityFree 4,17`) lets you up.
- **Enter:** 3–4 frame settle flat onto the belly (`crawlT` 0→10 at +3/frame),
  dust puffs at hands and knees, the hat bobs hard.
- **Loop (prone low crawl):** the 17-tall wizard laid out FULL LENGTH — ~17
  cells nose to toes, ~4 tall (conservation of mass; the 9×9 box is collision
  law, the drawing overflows it like the standing hat does). A wedge
  silhouette: flat trailing legs → two-cell torso → humped shoulders → head.
  Elbow-drag keyed to real x-progress (stride wheel ×0.3): the lead hand
  reaches and rakes back, the pulling elbow pops above the back on the power
  stroke, the push-knee cocks above the hemline on the back-beat; the hat
  lies along the spine, cone trailing, tip on the spring. Cloth shuffle +
  pebble flecks at the hands; ceiling at exactly gauge (solid at y−9) presses
  the head cheek-flat (`headUp` 1→0) and pins the elbow — not even the chin
  comes up. A dead-end wall scrunches the head group back 1–2 cells
  (nose-to-the-rock probe via `cellBlocks`) instead of burying the face. The
  sprite lies along the sampled TERRAIN slope — floor-surface heights under
  nose and tail (±6), lerp 0.18, clamp ±1.1, quantized ~16 steps — so he
  stays inclined on a slope even parked or stalled (velocity-based tilt died
  to horizontal the moment a lip stopped you); the box never rotates. (The
  original hands-and-knees creep pose is retired but kept whole behind
  `CRAWL_POSE` in `PlayerSprite.ts`, awaiting a new verb.)
- **Cramped** (released but can't stand): HUD glyph under the meters
  (`crampedChanged` event) and a hat-bump on the ceiling every ~40 ticks with
  a muffled thud and grit-fleck.
- **Stand:** reverse squash overshoot (`stretchT` 6), hat flips, shake-off dust.
- Camera trades the crouch's downward peek for a +14-cell forward lead;
  `wandTip` drops to ~4 above the feet (prone muzzle); hostile-projectile
  overlap shrinks (r² 85→45 at body center y−4) — ducking a volley is a dodge.
- State: `player.crawling` / `crawlT` / `crawlSlope`. `Player.ts` (stance
  machine), `PlayerSprite.ts` (pose), `Camera.ts`, `Projectiles.ts`.

### Wall grab (bouldering pose)

- Detection: grounded with the ONLY feet-row support at the body's edge
  (|dx| ≥ 3, one side) plus a solid face beside the body (≥3 of 8 samples at
  x±5) — i.e. he caught a pixel lip of a cliff, not a floor. Hysteresis
  `wallGrabT` 0–10 (+2 hit / −1 decay; pose above 5) rides out the airborne
  beats of a climb.
- Pose: feet braced on the rock (one toe on the lip, one jammed higher), skirt
  hanging plumb, torso pressed to the face, **both hands on holds** trading
  places every ~50 frames, eyes up the route, hat tipped back.
- Pose state ONLY — the pixel-catch physics that lets him cling is untouched.
  Firing breaks one hand free to cast. State: `player.wallGrabT`/`wallGrabDir`.

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

### Wading through fresh blood (the gore is a real liquid)

A Weaver bleeds out a wet `Cell.Blood` pool you have to *slog* through — it
isn't set dressing you skate over. Each frame the lower body is scanned for wet
blood (`updatePlayer`'s BLOOD WADE block); one count drives three things:

- **Bog-down.** Blood cells hugging the legs (sample box `WADE_SAMPLE_H` 9 tall ×
  ±`PLAYER_HALF_W`) normalize against `WADE_FULL_CELLS` 48 into `wade01`; that
  sheds up to `WADE_SLOW_MAX` 0.55 of both run accel and top speed. A thin film
  barely registers; a shin-deep wade trudges (~40% slower, measured).
- **Robe soak (builds with exposure).** Wading banks soak charge into
  `player.bloodStain` — `WADE_STAIN_GAIN` 18/f scaled 0.35–1.0× by depth
  (`wade01`), capped at `BLOOD_STAIN_MAX` 3600. The sprite reddens boots + hem
  in proportion (`BLOOD_STAIN_FULL` 1000 = fully saturated; lower `STAIN_RISE`
  8 cells, tapering up, gated on the silhouette pass so the wand glow never
  bleeds red): faint after a quick step, deep crimson once he's truly waded. Off
  the blood the charge drains 1/f, so a full soak holds red then fades — ~1 min.
- **A wake.** Plowing through at speed (`|vx| > WADE_WAKE_MIN_SPEED` 0.5) shoves
  the surface up into a crest at the leading foot (a real `world.swap`, mass
  conserved) and flings droplets of the pool's *own* colour (cosmetic motes, so
  the wake can never flood the sim) — plus the odd soft splash. The grid
  explains every part of it.

### Kick / force push (F)

A single button that is half melee, half *blast of air* — Newton both ways.

- **Two cones.** A tight **melee cone** (`kickRange` 22, `kickArc` ≈ ±52°) deals
  `kickDamage` 8 and shoves rigid bodies mass-aware (`applyMomentumAt`,
  `kickImpulse` 75 — light crates fly, heavy ones resist). A wider **wind-gust
  cone** (`kickRange` + 10, ~1.5× the fan) is the force push. Cooldown 22f.
- **Self-recoil = a kick-jump.** You recoil opposite the kick, scaled by what you
  bite into (`kickSelfRecoil` 3.0 × `max(0.5, reaction)`); a base push-off always
  applies so it feels identical mid-air (levitating) as on the ground — like wand
  recoil. Kicking **down** lifts you off the floor (a stomp-launch).
- **Enemies get blown back, mass-scaled** (footprint proxy `halfW·h`: bat 15,
  slime 40, golem 140; `GUST_ENEMY_PUSH` 5). Small foes (mass ≤ `SLAM_MASS_MAX`
  26 — bats, egg clutches) enter a brief **ballistic launch** (AI + flight-cap
  suspended so the shove actually carries) and **SMASH into the first wall**:
  blood paints the stone (`splatterStain`), gore gouts spray in, and they take
  `12 + 2.4·speed` damage (a bat gibs outright). Heavier foes nudge/stagger and
  thud to a stop. Bosses ignore it.
- **Ambient critters scatter.** The gust **startles** them (16–32f): their seek +
  heavy damping suspend so the push carries and they flee — a grounded beetle is
  blown off its feet instead of re-planting its crawl. Blast waves startle them too.
- **Vines bend; loose cells fly.** The gust bends hanging vines
  (`applyRadialImpulse`); ash (always) + embers + gases blow into flying motes;
  loose particles ride the gust.
- Feedback: a dust arc along the kick, a low square *thud*, an airy noise *whoosh*.

### Vine swing (G)

- Latch the nearest hanging rope/vine within `SWING_REACH` 16; the body becomes a
  **pendulum** (gravity 0.28) rigidly constrained to the rope length
  (`SWING_MIN_LEN` 14 … `SWING_MAX_LEN` 150 — radial velocity projected out,
  tangential kept). State: `player.swinging`.
- **Pump with left/right** (`SWING_PUMP` 0.16) — left swings you left, right
  swings you right. **Jump** launches off the vine (+2.0 up, breaks the grab).
- **Release keeps the swing's momentum** — letting go drops you into the airborne
  inertia path (only `airDrag` 0.985 bleeds it), never the walk-speed clamp, so a
  fast swing flings you off with everything you built up.
- You also shove vines aside just by **moving/levitating through them**
  (`PLAYER_PUSH_STRENGTH` 1.4 within 20 cells; the bias imparts real velocity so
  the rope keeps swaying after you pass).

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
| **Cast recoil** | Each cast kicks the staff back 1–2 px along the aim for 5 frames (7 for card groups ≥ 25 mana) and jolts the hat through its spring. The body also takes a *physical* shove opposite the aim, scaled to the shot's muzzle momentum (flat base 6 + summed projectile speed×count, ×0.06), capped at 4.0 and damped to 0.55× on the ground. Because `fire()` runs after the frame's vy clamp, firing **downward while airborne** lands an uncapped rocket-jump pop that bleeds off next frame. Self-inflicted, so it ignores Stoneskin. Live-tunable in `params.player` (Builder → Global Controls → WAND RECOIL; adjustable mid-playtest) |
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

### Threat-aware AI — fear, dodge & flee (`entities/Enemies.ts`)

A reactive layer bolted **on top of** the per-kind AI so foes don't walk into
their own deaths now that poured/thrown/sprayed hazards hurt them. Each frame an
in-window foe runs `updateBehavior()` *before* its kind branch: **sense → integrate
drives → commit a reflex**, then an integration seam OVERRIDES the per-kind `vx/vy`
with that reflex. Runs at tick rate; fail-open — every reflex is short and timed, so
a stuck foe just re-decides next frame. Fearless bosses' weights make it a near-no-op.

**Senses** (`senseThreat`, fills one reused threat read — no per-foe allocation):
- **(a) Hazard cells** — a box (`halfW+9` wide) scanned for `enemyLethalCell`
  pools (lava/fire/acid, per-kind: an imp ignores fire, an acid slime ignores acid);
  flee vector points away from the nearest, weighted by proximity.
- **(b) Fast rigid bodies** on a collision course — thrown/pulled crates, blast
  debris: speed ≥ 2.2, within 60 cells, velocity actually pointed at me
  (`toward > 0.4`), time-to-impact < 26. Imminent if tti < 14.
- **(c) Incoming player projectiles** (non-hostile) — within 70 cells, `toward > 0.6`,
  tti < 22. Imminent if tti < 12.
- **(d) Self** — on fire (threat 0.85) or wounded (< 35% hp ramps in).
- **(e) The player's Flame-Jet cone** — sampled once/frame (`wands.streamFlameInfo`);
  a fire-vulnerable foe inside the cone sidesteps *across* the stream axis. An imp
  basks in it (same `enemyLethalCell` gate as the damage).

**Drives** (leveled, like the elemental status timers — they integrate and decay):
- **fear** (0..1) rises fast toward sensed threat × the kind's `fear` weight, ebbs
  slowly (`-0.02/f`) when safe.
- **aggression** (0..1) rises near the player (`+0.02`) and when freshly hit
  (`+0.04`, vengeance), bleeds off when scared/alone.
- **chaseScale** = `clamp(1 − 0.7·fear + 0.15·aggression, 0.25, 1)` — fear makes a
  foe hesitate; aggression only offsets it (never a speed-up past the per-kind cap).

**Reflexes** (the arbiter):
- **DODGE** — an imminent threat triggers a SIDESTEP *perpendicular* to the threat's
  velocity (a jink across its line — you can't outrun a fast crate by fleeing
  straight away), @2.7 for 12 frames. One roll per incoming threat (`dodgeCd 22`,
  set whether or not it dodges), gated by the kind's `dodge` chance. Fliers sustain
  the vertical jink; grounded foes get a single upward hop, then gravity arcs them
  back over the threat.
- **FLEE** — fear ≥ the kind's `fleeAt` commits a 26-frame retreat @1.7 away from
  danger; if on fire and `seekWater`, it bolts for the nearest water to douse instead.

**The tell (so the intelligence reads on screen):** the instant a foe commits a
dodge or flee, a warm slanted **"!"** pops above its crown (emissive — shows in
shadow; suppressed during the damage flash; kicked toward the escape direction) plus
a soft airy **whiff** (gated to within 160 cells so a swarm jinking at once doesn't
roar). Kind-agnostic, drawn in the shared path of `EnemySprites.ts`; carries **no new
state** — derived from the reflex timers at their peak (`dodgeT ≥ 10` / `fleeT ≥ 23`).

**Per-kind TEMPERAMENT** — the weights that make a slime dumb and a bat flighty:

| Kind | fear | dodge | fleeAt | feel |
|---|---|---|---|---|
| slime / acidslime | 0.4 | 0.12 | 0.95 | dumb, barely flinches |
| bat | 1.3 | 0.85 | 0.45 | flighty, panics |
| imp | 0.6 | 0.72 | 0.6 | smart kiter (fire-immune) |
| wisp | 0.9 | 0.7 | 0.4 | skittish frost caster |
| spitter | 0.85 | 0.55 | 0.5 | cowardly (seeks water) |
| bomber | 0.2 | 0.3 | 1.5 | suicidal — *wants* to reach you |
| mage | 0.9 | 0.62 | 0.45 | cowardly caster (seeks water) |
| weaver | 0.5 | 0.5 | 0.72 | cunning but committed |
| golem | 0.18 | 0.28 | 1.5 | brute, shrugs it off |
| colossus | 0 | 0 | never | fearless boss |
| leviathan | 0 | 0.12 | never | fearless (water is home) |
| *(default)* | 0.7 | 0.45 | 0.7 | — |

(`fleeAt ≥ 1` = never flees, since fear caps at 1. Eggs are inert: `0/0/2`.)

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
- **Flask handling:** siphon draws a faint dotted material-colored line from
  the source back to the alchemist; pouring emits a short arcing stream from
  the wand tip; thrown bottles spin with a glass glint trail before impact.
- **QA god kit:** pressing backquote in Play mode enables a transient debug kit:
  upgraded wands, every card in the bench collection, every Sanctum power
  active, long potion timers, stocked potion pickups, and bench-only potion
  refresh / elixir flask-fill tiles. Normal starts remain progression-driven,
  and debug-modified runs are not autosaved.

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
  them like anything else. A concussive shove that *doesn't* kill — the kick's
  gust, a near-miss blast (`critters.scatter`) — **startles** them: they drop
  their routine and flee for 16–32f so the shove visibly carries (a grounded
  beetle is blown off its feet, not re-planting its crawl).
- **Weather of the deep:** ceiling drips are real water cells; ember falls,
  spore drift, dust motes, heal-spring bubbles.
- **Cave moss** creeps only on damp stone (real moisture check).
- **Cell-surface micro motion:** exposed Water, Healium, and Teleportium get a
  one-cell wave shimmer; Crystal occasionally catches a hard twinkle;
  Glowshrooms breathe brighter on a slow sine; Vines, Moss, and Fungus pulse
  subtly green so living surfaces do not read as static wallpaper.
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
- **D1 daytime sky (the Noita-style surface intro):** above the horizon row
  (`skyLine`), Empty cells render as open daylight instead of the distant-cave
  backdrop — a vertical gradient (cool day-blue overhead → warm haze at the
  horizon), a distant sun pinned to a screen position (parallax-infinity: a
  bright core in a soft halo, radius 150), drifting clouds (layered 2-D sines in
  a mid-sky band, ~0.004/frame drift, added per-octave so the 2π wrap is
  seamless), and two parallax hill ridges (a far one plus a taller/darker near
  one that occludes it). The sky is *self-luminous* — drawn at full strength,
  not dimmed by the cave-lighting curve — so it reads as flat open daytime; the
  surface fill lights only lift the terrain and horizon. ALL tuning lives in one
  place, `SKY` in `render/skyAtmosphere.ts`, which both compose paths read (the
  GPU shader interpolates it into GLSL, the cloud sum is generated from
  `SKY.clouds.octaves`), so the CPU and GPU sky can never drift apart.
- **Post-FX tuning surface:** the right panel can toggle all post-processing,
  bloom, and the lens layer independently. Defaults: exposure 1.05, bloom
  strength 0.35, radius 0.20, threshold 0.85, bloom kick 1.00x, base split
  0.0005, blast split 0.0060, shake split 0.050, film grain 0.028, hurt pulse
  1.00x. These controls exist for visual inspection as much as player-facing
  tuning; turning Post FX off should show the raw pixel-composed scene.
- Level banners rise in; overlays rise in; gameplay fonts sized for readability.

---

## 9. Mechanism & objective feedback

- Doors retract cell by cell; a spark line traces trigger → gate when a sensor
  fires; braziers light with real fire; plates depress under real weight; the
  sand scale, sluice, and charge coil read raw cells as their sensors.
- **Fail-open groan:** wreck a mechanism's trigger body and its gate groans
  open ~30 s later — physics never locks you out.
- **Sequence doors** (Builder-authored): each correct step chimes a rising
  triangle tone (300 + 90·step Hz); a wrong-order firing breaks the chain
  with a sour 120 Hz sawtooth and audibly spits the resettable mechanisms
  back out (plate/scale/buoy latches and lever flips zeroed). Completion
  latches the gate open forever. Edges, not levels: a lingering plate latch
  never re-fires the chain. Fully broken steps auto-complete (fail-open per
  step; all wrecked = the chain itself gives way).
- **Machine primitives** (valves, plugs, sensors, counterweights, relays —
  the chain-reaction vocabulary; pixel art shared via
  `render/sprites/MechanismSprites.ts` so the Builder gallery previews the
  exact same animation): a closed valve blinks faint amber corner pips
  ("this moves"), opens with the door's grind, a shimmer dancing along the
  retracting slab, and dust on the slam; a TIMED valve about to slam blinks
  an urgent red-amber line across its gap. A damaged plug grows hash-stable
  crack pixels and sheds dust motes faster as its body is eaten toward the
  break fraction; breaking crunches a 140 Hz sawtooth, bursts debris in its
  own material's color, and toasts "A SEAL GIVES WAY". Sensors are
  tuned-crystal nodes — teal idle blink that RAMPS toward amber as the
  reading climbs on the threshold, steady green once satisfied, one-shot
  chime + mote burst on the rising edge. Counterweight pans sag under the
  pour (the scale convention) while an amber 5-notch gauge climbs; tipping
  toasts "THE COUNTERWEIGHT SETTLES — SOMETHING SHIFTS" and holds a green
  ingot glow forever. Relays read as rune-gear nodes: dim violet idle; while
  the fuse burns, three sparks CONVERGE on the core (orbit radius shrinking
  with the remaining delay) over a fast amber blink and an audible armed
  tick; steady green once fired — the handoff *visibly travels* (one frame
  per hop, plus the spark line to the target). Relay 'ignite' seeds real
  fire; 'break' detonates its plug; 'strike' is a real concussive pulse.
- **Hazard emitters** (Builder-authored): one real cell dripped every `rate`
  frames — the lava pools, the acid eats, the water floods; the grid is the
  whole effect.
- **Patrols** (Builder-authored): slimes hop and golems pace their waypoint
  loops while un-alerted; after ~5 s with the player beyond notice range a patroller shrugs
  (dim gray puff) and returns to its route — generated enemies keep their
  one-way alert.
- Golden key glints on the minimap; the portal pings when it opens; objective
  HUD + toasts narrate progression; waystones gong and hold an ember column
  once lit.
- Waystones show three readable states in the frame composer: dark idle coal,
  heat motes while real fire is nearby, and orbiting amber motes once lit.
  Cauldrons average the real materials in the bowl into their simmer color and
  bubble only when heated; exit wells breathe faint dust before the seal opens.
- Door opening throws a small metal/stone dust lift; plates, scales, and buoys
  emit one-shot particles when their physical sensor first becomes true.
- Freeze Bridge (puzzle archetype 4): the nitrogen drip is an eternal emitter
  (1 cell / 9f) off a 3-cell ceiling icicle; drops pool in the stone catch-tray
  and flash-evaporate (bulk nitrogen cannot exist — evap 0.05/substep IS the
  disposal). Tray broken: each drop random-walks the crust (flow 0.8 vs evap
  0.05) and freezes the first open water; the ICE census latches permanently at
  8 of the trench's ~11 surface cells. The crust is the key AND the crossing.
- Live Circuit (puzzle archetype 5): knife-switch levers are created
  PRE-THROWN (state 1), so the E-pull reads as throwing the switch DOWN into
  contact — the 1x3 valve gate slams INTO the rail with the door-grind +
  spark-line language. Charge spreads down/sideways/up-left only, so the whole
  run descends knob -> rail -> vault; a struck knob (2x2 + wire junction)
  self-oscillates, keeping the rail visibly live while you work the switches.

---

## Tuning quick-reference (this codex's load-bearing numbers)

```
coyote 6f · jump buffer 8f · jump vy -3.7 paced by depth · gravity 0.28 (liquid 0.12)
levitation spool: 0.33 -> 0.57 thrust over 48f (t-cubed ease-in) + 0.92/f drag -> ~3.3 terminal climb
wand recoil: base 6 + sum(proj speed×count), ×0.06 -> impulse, cap 4.0, ground ×0.55 (opposite aim; down+airborne = rocket-jump)
levitation horizontal: own control (levitHorizControl 1.0×) — decoupled from ground Swift/Swift-Soles buffs
air inertia: input caps at maxRun but never snaps carried momentum down; airborne vx *= airDrag (0.985) each frame instead of the ground 0.72 — sprint carries into jump/levitate, glide coasts (±12 sanity rail). Builder → LEVITATION → Air momentum (drag)
gore/blood: count = baseline × global.bloodAmount × channelMul(material) × sizeFactor. sizeFactor = clamp(halfW·h / 50, 0.3, 4) (bat barely spatters, golem/colossus gushes). channelMul keys off the sprayed cell: Cell.Blood→goreBlood, Cell.Slime→goreSlime, Cell.Acid/Toxic→goreOoze, else 1 — so red blood, green slime, and glowing ooze tune discretely. bloodAmount is the master: 0 = bloodless, 1 = shipped, up to 10 = maximum gore / Tarantino mode. All in Builder → Global Controls → GORE (Overall 0–10×, channels 0–4×). Particle pool MAX_PARTICLES=4200 caps extremes gracefully; gold bounty shower is NOT scaled
blood staining: blood particles stain (stainCell) the sturdy surface they strike (Wall/Wood/Stone/Ice), and flowing/pooling blood liquid stains the floor/walls it touches each substep (handleViscousLiquid) — red soaks in permanently (tints world.colors, not types, so golden hashes unaffected)
blood wading: wet Cell.Blood at the legs (sample 9 tall × ±4) / WADE_FULL_CELLS 48 = wade01; sheds ≤0.55× of accel+maxRun (shin-deep ≈ −40%). Contact (≥4 cells) BANKS soak charge into player.bloodStain (+18/f ×0.35–1.0 by depth, cap 3600) → sprite reddens boots+hem the more/longer he wades (BLOOD_STAIN_FULL 1000 = full crimson, over 8 cells); off the blood drains 1/f, holds then fades ≈ 1 min. Moving (|vx|>0.5) shoves a crest up (world.swap) + flings the pool's own-colour cosmetic droplets + soft splash
run accel 0.5 ground / 0.575 air · max run 2.6 paced by depth · crouch 0.38x · peek +48 cells
dive: entry 5.6, floor 4.6, terminal 6.4 (normal 5.0), drift x0.86/f
slam: 26-cell knock radius, 1 dmg, ≤12 powder cells popped
kick (F): melee cone range 22 / ±52° / 8 dmg / cd 22 · gust cone range 32 (1.5× fan) · kickImpulse 75 (mass-aware) · self-recoil 3.0×max(0.5,reaction), down=stomp-launch
kick gust → enemies: push 5×(40/footprint), clamp 0.2–4.5× · ballistic launch if mass≤26 (bat/eggs) → wall SMASH (12+2.4·speed dmg, blood-paints stone); heavier foes thud · bosses immune
kick gust → critters scatter+startle 16–32f · vines bend (applyRadialImpulse)
vine swing (G): reach 16, len 14–150, pump 0.16 (left=left/right=right), jump launch +2.0 up · release keeps momentum (airborne inertia, no walk clamp) · player pushes vines aside within 20 cells (strength 1.4)
skid: trigger |svx|>1.1 on reversal, 9f · stagger 12f · recoil 5f/7f
swap draw 12f (gleam f5-7) · fidget arms at 420f idle, routine 90f
slime windup 7f chase / 12f wander · wounded hop 0.55-0.85x at <40% hp
patrol: advance <14 cells (slime) / <10 (golem) · de-alert 300f beyond 300 cells
sequence chime 300+90·step Hz / break 120 Hz saw · emitter rate clamp ≥2f
bat flare 8f at <64 cells · swoop 12f cap 2.6 · tumble 14f, ~1.2%/f at <40% hp
enemy threat-sense (in-window foes, tick rate): hazard box halfW+9 (per-kind enemyLethalCell) · fast body dist<60 tti<26 toward>0.4 (imminent tti<14) · projectile dist<70 tti<22 toward>0.6 (imminent tti<12) · flame-cone reach 36 / half-angle 0.5 +0.3 slack · self: burning .85, hp<35% ramps
enemy drives: fear → sensed threat × kind-fear, decay 0.02/f · aggression +0.02 close +0.04 on-hit −0.03·fear −0.005/f · chaseScale clamp(1 − 0.7·fear + 0.15·agg, 0.25, 1)
enemy reflex: dodge ⊥ to threat vel @2.7 ×12f, one roll/threat (dodgeCd 22) gated by kind dodge% (fliers sustain vy, grounded one hop) · flee 26f @1.7 away (toward water if burning+seekWater) · final movement integrates at 0.55x on D1, ramping +0.09/depth to 1.0x by D6 before difficulty · startle "!" tell @dodgeT≥10|fleeT≥23 + airy whiff (pDist<160)
temperament fear/dodge/fleeAt: slime .4/.12/.95 · bat 1.3/.85/.45 · imp .6/.72/.6 · wisp .9/.7/.4 · spitter .85/.55/.5 · bomber .2/.3/never · mage .9/.62/.45 · weaver .5/.5/.72 · golem .18/.28/never · colossus 0/0/never · default .7/.45/.7
player eye seeks threats <80 cells · enemy gaze locks only when alerted
shake falloff dead at 420 cells · hitstop 3f at ≥8 dmg · heartbeat <25% hp
sim window camera ±60 · player 9x17 cells · staff ~11 cells, muzzle at d=9
D1 sky (SKY in render/skyAtmosphere.ts): gradient base (0.36,0.53,0.78)→horizon (+0.28,+0.06,−0.28)·t · sun screen 0.72·VIEW_W,0.17·VIEW_H, halo r150 pow2.4, core 13→6 · clouds 4 octaves, parallax 0.82, drift 0.004/f, band t∈0.12–0.66, opacity 0.45 · hills far parallax 0.5 base26 / near parallax 0.32 base40 (taller+darker, drawn last)
```

When changing any of these: one at a time, deliberately, and say so in the
commit (they are load-bearing — see the project skill's hard invariants).
