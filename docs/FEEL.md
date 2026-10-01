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

### The chill (`entities/chill` model, `game/Chill` system)

The old frozen status painted a pale ice oval over the alchemist. His cold is
now a graded body state, `player.chill.level` 0..1, built from real cold cells
and thawed by real heat. Every look, sound and slow follows it. Enemies keep
their binary `status.frozen` (the Rime Warden's brittleness, shatter crits and
frozen corpses are unchanged). The alchemist's frozen timer only records
exposure (`gradedChill` in `entities/status`: no flat 0.55 slow, no generic
motes). All numbers live in `CHILL_PARAMS` (`config/params.ts`, live-tunable
as `ctx.chill.tuning`), per fixed tick.

- **Cold in** (sampled every 2 ticks from the cells at the body):
  - brine at the legs: 0.0026, plus 0.0042 × how deep (a wade freezes solid in about 4 s);
  - liquid nitrogen: 0.0035 a cell, capped at 0.02;
  - fresh water in a frozen biome: 0.0014 × depth;
  - ice or snow pressed to the body: 0.00035 (it only slows the warming);
  - a frozen biome's air holds the body at 0.12 at least, climbing 0.0008 a tick (breath, a touch of rime, no slow);
  - blows land at once (`ctx.chill.hit`): a frost bolt 0.24, a Rime Warden rime wave 0.2, each lick of its breath 0.075.
- **Heat out:**
  - 0.0011 a tick out of the cold, only 0.00025 while a cold source still touches;
  - plus 0.0065 × warmth: fire 1, lava 1.5, embers 0.7 and burning coal or oil 0.8, each weighted
    1/(1 + d²/(0.18·26²)) within 26 cells of the chest, scanned every 4 ticks, full warmth at 7;
  - the Warm Refuge counts as 0.6 of full warmth;
  - a burning coat adds 0.02.
  - Casting fire warms you because the fire is real cells beside you.
- **Movement:** speed and acceleration × `moveK`, jump × `jumpK`; both have a dead zone under 0.08:

  | chill | 0.25 | 0.5 | 0.75 | 1 |
  |---|---|---|---|---|
  | `moveK` | 0.94 | 0.81 | 0.64 | 0.45 |
  | `jumpK` | 0.99 | 0.95 | 0.89 | 0.82 |

  The jump falls far less than the run, because a jump that cannot clear a gutter's lip would trap a
  freezing body in the brine. Levitation spools slower through the same pace but still climbs.
  Stops stay crisp: ground stop decay is unchanged.
- **Frozen solid** (fail-open):
  - At 1.0 the body locks in an ice shell for 72 ticks. Movement and casting stop and gravity still applies.
  - Each fresh press cracks 9 ticks off (a crack each), heat melts it faster, and a real blow (≥ 1.5 hp) bursts it at once.
  - It bursts to 0.66, then holds under 0.94 for 420 ticks, so it cannot re-lock.
  - Worst case (nitrogen at its cap, brine to the neck, a frost bolt a second): locked at most 72 of every 492 ticks (`tests/chill.test.ts`).
- **The rime and the thaw beat:** `rime` is the frost on the body.
  - It accretes after the level: up to 0.006 + 6% of the gap a tick, with a crackle per 0.045.
  - It holds while the body warms, melting 0.0007 a tick (+0.0015 × warmth, +0.01 alight).
  - When the level falls 0.26 under it (with ≥ 0.42 on), it cracks off at once. This is the thaw beat:
    - real Snow and Ice tumble off (7 + 16 × strength particles, half Snow and a sixth Ice, deposited where they land; the rest glassy shards);
    - by a fire, real Steam hisses off and the shed melts;
    - the score snaps back.
  - The shell bursting sheds the same way (7 + 18 × strength).
- **The body** (`render/player/AlchemistArt` drawChill; `render/creatures/raster` frost):
  - **Rime on the real silhouette.** Each pixel scores 0.5 × edge (a chamfer distance to the silhouette,
    fading over 2.2 cells) + 0.2 × up-facing + 0.22 × its part's exposure + 0.1 × how far toward
    hat or boots + 0.28 × crystal noise (two scales, anchored to the body). It frosts past
    1 − 0.87a − 0.06 sin(πa).
  - Exposure by part: brim 1, crown 0.86, shoulders 0.84, sleeves 0.72, boots 0.66, tails 0.52, coat 0.3,
    face 0.08 (stipple only), vial and effects never.
  - The front is an ordered stipple of whole crystals, the coat behind it solid, shaded on the same
    normals by its own blue-white ramp. It keeps its cold under a warm lamp (light desaturated × 0.65 on rime).
  - Past 0.28 the beard frosts, past 0.5 the brows. Icicles grow from the brim from 0.5
    (six, off the eye), and cuff drips form past 0.55.
  - Past 0.78 a glaze (to 0.22) sets in and crystals twinkle (not with reduced flashes).
  - Frozen solid: rime all over (a 0.4 floor), a thin clear-ice shell that hugs every limb 0.8–1.1 cells
    proud, facet lines, and a dark fracture per crack.
  - The fallen keep their rime.
- **The pose** (`entities/playerPose` chillPose):
  - The hug starts at 0.3 and is full by 0.75. The off hand tucks under the mantle, the wand arm draws in,
    the head sinks 0.6 and tips down, and he leans 0.07 into it.
  - Stiffness starts at 0.2 and is full by 0.8: stride × (1 − 0.42), knee lift × (1 − 0.5), bob × (1 − 0.6).
  - The breath quickens: sin(0.13 f) × 0.16.
  - The shiver: from 0.32, a one-fine-pixel shudder of the upper body on up to 60% of tick pairs.
    Never mid-cast, never with reduced flashes, never inside the ice.
- **Breath:**
  - From 0.1 (so in any frozen biome), every 150 − 90 × depth ticks.
  - A translucent wisp billows off the mouth over 52 ticks: fine pixels, premultiplied, dimmed by the room's light.
  - Past 0.5, every other breath also leaves a real Steam cell (life 22–38).
- **The world answers (real cells):**
  - Past 0.45 a chilled body wading fresh water leaves a skin of rime Ice on the surface behind him
    (3 columns every 3 ticks at 35–100% odds). It thaws back to water after 960–1260 ticks.
    Brine refuses: it never freezes, the Cold Store's first lesson.
  - Past 0.5 his boots print hoarfrost on stone, wood, metal and ice, a colour stain × 0.34–0.68
    toward (218, 234, 246). Standing still, the frost creeps round the boots out to 7 cells, and the
    wall he clings to rimes. Prints fade after 2100–2700 ticks.
  - Leaving a floor gives back everything the cold wrote.
- **The lens** (`render/PostFx`, WebGPU twin; `render/chillLens`):
  - `screen` eases toward the level: 0.035/tick in, 0.045 out, 0.09 just after a thaw. Dead under 0.14.
  - The grade drains colour toward a cold blue-grey (× 0.52), shifts the white balance
    (0.88, 0.97, 1.1) and adds blue to the shadows.
  - Frost grows in from the frame's edges from screen 0.12, reaching up to a fifth of the frame's height.
    It is milky at the rim, a lace of ridged fronds with hexagonal needles at the ragged front,
    frosted-glass blur behind it, and a few glints at the front (none with reduced flashes).
  - A safe ellipse (0.38 × 0.33 of the frame) is never touched.
  - Opacity is capped at 0.55, or 0.36 with high-readability lighting.
- **Sound** (`audio/EventCues` chillCues; `audio/MusicDirector` tape):
  - Frost crackles climb from high ticks to low creaks as the rime thickens.
  - A shivering exhale plays at most every 2.4 s past 0.45.
  - Seizing solid, cracks, the burst, and the thaw (with a steam hiss when a fire did it).
  - The wind-and-ice loop swells with the lens (gain 0.2–1).
  - The heart slows past 0.72: 78 → 112 ticks a beat, rate 0.86 → 0.78.
  - **The score's tape runs down.** It is dead under 0.15, and the playback rate and pitch fall together:

    | chill | 0.25 | 0.5 | 0.75 | 1 |
    |---|---|---|---|---|
    | playback rate | 0.986 | 0.936 | 0.873 | 0.80 |
    | lowpass cutoff (Hz) | 15.2k | 6.9k | 2.85k | 1.1–1.4k |

    It glides on its own 60 ms clock: 0.06 a step cooling, 0.14 warming, 0.32 in the 50 ticks after a thaw beat.
- **Voice:** the first deep chill of a session (≥ 0.6) brings the Docent's captioned line (it
  waits behind a pipe line, 14 s): "Frost in the beard. Very distinguished. Find a fire before it
  spreads to the rest of you." (Voiced, Daniel `[dryly]`; a toast where no narrator is loaded.)
- **Creatures:** a frozen creature takes a lighter rime on its own silhouette
  (0.55, fading over its last 40 frozen ticks). A frozen carcass takes 0.7 over a paler cast
  (the old 0.42 wash is now 0.16).
- **Cost:** 0.03 ms a tick for the system; the rime pass is lost in noise. Frame means are
  5.6–6.0 ms at chill 0 and at chill 1 (d2b, measured).

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
- **The fallen get the boot too.** A corpse in a wider ~80° cone, or lying at
  the boot on the kicking side, is punted at 6/√mass cells/tick along the aim
  (+0.35 lift), each part by its distance from the boot so the body folds; a
  heavy carcass kicks back like a wall (reaction mass/3). One held on the
  wand's thread is kicked out of it (a punt). The gust shoves the rest.
- Feedback: a dust arc along the kick, a low square *thud*, an airy noise *whoosh*.

### Telekinesis (E) — the fallen on a thread (`combat/Telekinesis`)

The same verb lifts crates and the dead. **E** on the body under the cursor
takes hold (the one the cursor is ON wins: a corpse within 1.5 cells of the
cursor beats a crate under it; within 4 with no crate under the cursor it
still counts — otherwise E stays a lever-pull / siphon); **E** again sets it
down with the momentum it has; **F**, or a right-click while holding, hurls it
at the cursor. Controller: X lifts along the aim / sets down, RB or R3 hurls.

- **It hangs from where you took it.** The pull is a damped spring on ONE
  point (the one nearest the cursor at the grab): K 0.03/mass, damping
  0.12/√mass, capped at 0.9/√mass cells/tick². The held point barely yields
  to its bonds (share 0.9), the field lifts 35% of the weight off the rest,
  so limbs trail and dangle: a lizard held by the tail swings by the tail, a
  bat snaps to the cursor, a golem lags and sags. The body hangs 1.6 cells per
  slime below the cursor. Gel re-inflates and hangs like a sack; a frozen body
  is held whole (it is rigid); a serpent by its head; a Weaver by its shell,
  legs clutched in and trailing the swing.
- **Leash and reach.** The target is the cursor clamped to 64 cells of the
  alchemist's chest; a body is gripped within 90 of the wand tip, in its
  sight. 45 ticks out of sight, or 150 cells away, and the thread snaps.
- **Mass** (slimes): bat 0.4 · wisp 0.6 · slime 1 · imp 1.2 · spitter 1.3 ·
  mage 1.6 · rillback 1.8 · rootloper 2 · weaver 2.6 · stonemaw 3.2 · golem 4.5
  · leviathan 14 (over the 6 limit: E only **nudges** it, 1.1/√mass for 6
  mana, and the Works remark "Rather heavy.").
- **Mana** (the active wand): holding cancels its regeneration and costs
  0.08 + 0.09·mass per tick more (an Oak Sprig holds a slime ~9 s from full, a
  golem ~3 s); taking hold 2 + 1.5·mass; a hurl 6 + 5·mass, and a short tank
  throws at mana/cost of full power (under 25%: it fizzles and just drops).
  Dry: the hollow click, the mana bar flinch, a fizzle at the tip. Crates stay
  free (puzzle weights must stay fail-open).
- **The hurl** leaves at 8/mass^0.35 cells/tick (clamped 3.5–7.5: a bat
  flies, a golem is shoved), *lobbed*: candidate throws of the body's own
  flight (gravity .22, air .985/tick; a Weaver .25/.995) are flown low to high
  and the flattest that passes within 3 cells of the cursor wins. The swing
  becomes tumble (the gripped part +18%), the thrower takes a small recoil
  (0.35·mass·power, ≤ 1.6), displaced air streaks behind, a small bloom kick.
- **Feel.** The grab tugs the body toward the wand (0.9/√mass) with a
  brass-white flare; a hairline brass thread (`render/sprites/TelekinesisArt`)
  sags under the weight and draws taut as the spring pulls, wavers along its
  length, runs three beads of light into the body, flares on the grab
  (reduced flashes: dimmer, no flare); a quarter-second brass shimmer at the
  grip on the grab. The body itself is NOT tinted or ringed with motes (a
  brass wash paled dark chitin to lilac and loose motes read as joint
  markers): remains take the room's light dully (×0.82, ≤ 0.9), their lights
  gutter by time since death, a dead Weaver's eyes are shut and its legs hang
  like a marionette's, a dead Stone Maw's legs curl under its segments.
  Sounds: a taut twang and tug, the thread's hum (louder for a heavier body),
  a slack sigh, a whip-crack and rush of air, a fizzle, a strained groan.
- **Handled remains keep.** A body held, thrown, kicked or frozen does not rot
  (for 240 ticks after the last touch), bounded at 1800 ticks spared in all;
  with more than 10 remains the oldest untouched melts first, the held one never.
- **Teach.** The first fresh corpse within 56 cells shows "E on the fallen:
  lift · F hurls" and a one-time card; while holding, the hint line reads the
  set-down and hurl keys.

### The fallen as mass (`creatures/corpseWorld`)

- **BOWLED.** A body faster than 2.2 cells/tick strikes a creature it passes
  through for 6 + 4.5·mass^0.6·relative speed (cap 90), knocks it along its
  flight, sheds 55% of its momentum into it; one blow per creature per
  flight, 14-tick cooldown. Set moving by the alchemist (a hurl, a kick, a
  swing, his own blast) within 240 ticks, a kill is **BOWLED** (an alchemical
  kill: callout, chain, payout); a carcass falling on its own is debris
  (FLATTENED). A bowl of 36+ holds a 4-frame hitstop. Bosses take a bowl as
  the player's own blow (the boss ward's thrown-leg rule); a frozen victim
  SHATTERS. A swung body clubs too (the held body strikes at speed).
- **Only a heavy body on his head hurts him**: mass ≥ 2.5 falling at ≥ 2.2
  onto the alchemist's head, 1 + 0.45·mass·vy, capped at 8 ("hostile debris").
- **Blasts** fling every part by distance (reach r×1.8, strength 2.5 + .08r,
  ÷√mass, +35% lift); the player's own blast makes what they hit his.
- **Liquids.** Entering a pool at vy ≥ 1 swaps the surface cells up and out
  over 2 + 1.5·mass + .6·vy columns each side (mass conserved) with cosmetic
  spray in the pool's own colour; drag .8/tick and buoyancy −.35 float it;
  feet rise (belly-up); a Weaver's shell bobs.
- **Fire.** Flame or embers against a body not soaked (< 40% of it in
  water/blood/gel) catch it: 480 ticks (oiled 780); it writes one real Fire
  cell against itself per census (oil, grass, leaves and marsh gas go up),
  chars .0035/tick toward soot with embers breathing through, rots 2 extra
  ticks per tick and falls to ash and embers. Water puts it out (a sizzle).
- **Lava** takes a body in ~1.2 s (+10 rot/tick, embers, no bones); **acid**
  eats it (+6/tick) and is spent (a touching cell goes up as smoke, 40%/census).
- **Frost.** Nitrogen, ice or snow freezes it stiff for 1200 ticks (refreshed
  while touching): shape matching holds the pose, friction .06, air .99 — it
  slides and tumbles like a plank, ice-pale. A blow of 2.4 cells/tick (the
  sharper of one tick's Δv and three ticks' × 0.8: a long body meets a wall
  nose first) or a close strong blast **shatters** it: up to 7 real Ice cells,
  3 of its gore, 2 + mass frozen chunks (kickable debris), 24 glassy shards.
  Heat thaws it fast first.
- **Current.** A charged cell against it: a 24-tick galvanic twitch (a part
  jerks every 3 ticks, legs kick, blue sparks); wet (≥ 25%), it carries 10 of
  charge on into the liquid it lies in.
- **Weight.** Plates and weight sensors count round(mass × 4) per body with a
  part resting in their rows: a slime presses a plate (4 ≥ 3), a bat is too
  light (2); a body the wand holds up weighs nothing.
- **Ecology.** A carried or just-thrown body (300 ticks) lures scavengers
  from 1.6× as far; a snapjaw snatches a carcass by its nearest part — dangle
  one at the pod and it eats and sits chewing (780 × 1.5 ticks: safe passage).
- **Crates and bones.** A body faster than 2.4 shoves the loose bodies it
  passes through (momentum 12·mass·v) and keeps 70%.
- **Landings.** An abrupt change of 1.6 cells/tick (from ≥ 1.8) is a thud:
  dust in the colour of what it hit, a light or heavy thud by the body; a body
  of 2+ slimes landing at 3+ shakes the view a little (0.004·Δv·√mass, local,
  capped at .025).
- The census of touching cells runs every 3 ticks (staggered; two rings: just
  inside the rim and just outside it). Grid writes pick cells by a
  deterministic hash, never the entity stream; motes use fx.

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
| Lever pull | E starts a 26-frame hand-pull: rooted, staff stowed, both arms reach, strain bob; the lever arm smoothsteps across and flips at completion. A dressed lever (the engine's brass crank wheel, the sluice handwheel — `Mechanism.look`) swings its handle half a turn with the same ease instead of an arm, so its state is literally which side the handle rests on |
| Heart communion | Refilling at a heart roots and disarms the wizard for the ~2 s channel; broken by damage (with toast) |

### Fixtures and machinery (presentation resolution)

- Every mechanism sprite, the Bell & Tea Engine's linkages, rigid bodies,
  ropes and chains, bitmap decor and landmark props draw through
  `render/sprites/FineArt.ts` at the surface's presentation step — half a
  cell on the default fine surface, whole cells in the Builder gallery and
  classic (`?pixelScale=1`) mode — so nothing on screen reads as "bigger
  pixels" than the terrain, foliage and creatures beside it.
- **Wheels** are filled brass with a dark rim, a hub, and spokes that rotate
  with real travel only: pulleys by cable stroke, the winding drum by the
  counterweight's drop, the handwheel by the valve's spring-damped turn, the
  crank by the pull. The lamp highlight on the rim stays put — the fixed
  highlight against moving spokes is what makes rotation legible.
- **Cables** carry a two-tone twist that advances with the plate's real
  travel, sag in proportion to their span (never on vertical drops) and a
  dark underside thread; chains alternate lit and edge-on links; hemp ropes
  twist in ochre.
- **Rigid bodies** (boulder, pendulum bob, dominoes, sugar, piston, duck)
  interpolate between fixed ticks (`interpolateBody`), so they move at frame
  rate; a frame between ticks still composes while any body is awake.
- Fixtures take the room's lamps through the light field, clamped to
  [0.55, 1] so brass never blooms to white beside the staff's glow and never
  vanishes in a dark bay. Knobs, lamps and sparks stay self-lit.
- Landmark props cull against the composed view rectangle
  (`viewIntersects`); the old corner-distance test made the sluice handwheel
  pop out of existence whenever it sat in the right quarter or the bottom of
  the view.

### Character definition (the Noita-class readability pass)

- **Silhouette rim:** every body pixel is recorded during the draw and a
  near-black 4-neighbour outline is stamped around the finished figure
  (skipped below the feet; the staff/meters/tip draw outside the recording).
  The figure cuts against any background.
- **Presentation resolution:** the pose is still authored in whole cells, but
  on the fine surface the body and staff layers are re-emitted at half-cell
  resolution with EPX corner smoothing, the rim is one presentation pixel
  wide, and the figure is nudged to the nearest presentation pixel of his
  real position (vertically only while airborne). Pupil and lash, hat band
  and buckle, robe pleats and hem shadow, boot soles and toe-cap, the trim's
  stitching, the staff's highlight thread and brass ferrule are
  presentation-only details stamped on top of the upsampled art
  (`CellCapture` in `render/sprites/FineArt.ts`); a classic surface gets
  the byte-for-byte cell drawing.
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
| Colossus | Every move poses from the brain's own move clock (creatures/bosses/colossus): SLAM — both fists rise overhead for 30 ticks, then the blast; STOMP — it rears back 32 ticks, then both fists drive two floor waves; THROW — it reaches into its own furnace (the fist comes out dripping), cocks, lobs; VENT — the back plates lift and the seams whiten for 42 ticks before the fire |
| Leviathan | Its lure goes DARK (22-tick douse, it sinks and coils) before a lunge or a dive; its throat swells 20 ticks before a volley; its tail rises 18 ticks before a thrash |

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

### Provocation & notice (Breathing Works, `Enemies.provokeByPlayer`, `creatures/perception.ts`)

- **Being struck always provokes.** A direct blow (wand bolt, kick, whip,
  stomp, the Flame Jet's own stream) gives the creature's mind a confident fix
  on the wizard's position at that moment (confidence ≥ 0.8, irritation
  ≥ 0.75, re-sense + re-decide now): the pain has a direction, nothing more.
  A Weaver goes cranky (90 ticks) and hunts instead of foraging; flighty kinds
  (`fleeAt` < 0.5: bat, wisp, mage) bolt instead (fear raised to their
  `fleeAt`, the threat layer carries the flee); everyone else gains
  aggression ≥ 0.6. A leg severed by the bolt still flinches a Weaver back
  ~2 s (WeaverLimbs) before it returns.
- **A close, visible alchemist wears on a creature's patience.** While the
  honest sight check passes (grid-occluded, facing-gated, light-scaled range)
  and the wizard is within 130 cells, irritation rises by
  `(1 − d/130)/120` per tick against the 1/800 decay: at arm's length a stare
  boils over into a hunt in under a second (Root Loper at 60 cells: ~80
  ticks), across the room it takes several, past 130 it only observes.
  Territorial kinds (Weaver, Rillback, Root Loper, Stone Maw) used to watch
  indefinitely unless intruded upon (38–64 cells).

### New grid rules for creatures (Breathing Works)

- **Steam scalds** what fire can burn: 0.05 per sampled body row per tick
  (an engulfed Weaver ~27 hp/s; imps, the Colossus and the Leviathan shrug it
  off). The threat layer flees steam; the wary step gate does not (a plume
  is transient). The Works' exhale and a boiled pool are weapons: STEEPED.
- **Land creatures drown.** A head (top rows of the box, ≥ 60% liquid) under
  water/oil/blood/slime holds its breath 360 ticks (imp 90, bat 180, bomber
  150; bubbles every 15 ticks), then loses 1/300 of max hp per tick with a
  bubble burst and a thrash (fear 0.9) until it surfaces. Rillback,
  Leviathan, Colossus, wisp and egg clutches are immune; population never
  seeds a land kind with its head under liquid.

### Other living touches

- **Notice blips** when a creature first spots you (the bosses make an entrance instead).
- **Boss lairs** (`Enemies.watchLair`): a boss watches its whole room from head
  height (Colossus eye 28 cells up, Leviathan 8; no facing check, so there is
  no back to sneak up on). An alchemist inside the lair — Colossus: ±62 cells of
  its home, 72 up / 14 down; Leviathan ±54, 58 up / 12 down — who is in sight of
  its head or within 80 / 56 cells holds it on a confident hunt, idle or not
  (QA: an idle wizard 60 cells into the Kiln was never noticed). The first time,
  it makes its ENTRANCE: the Leviathan churns, groans and names itself (a
  finisher-tone callout, "THE SUNKEN LEVIATHAN"). The Kiln Colossus lands as the
  final boss: the mix ducks to 0.4 for 1.5 s under a furnace roar (46→110 Hz saw,
  92→61 Hz square, groan, stone grind), embers pour off its shoulders with a
  0.8 bloom kick (not under reduced flashes), "THE KILN COLOSSUS" rises over it
  at tick 10, it stomps at ticks 22 and 46 (boom + knock + dust + shake) standing
  its ground for 52 ticks before it marches, holds its fire 110 ticks, and the
  camera leans half the way toward it (≤ 70 × 28 cells, zoom 1.06) over 40 ticks,
  holds 70 and returns over 40 — no lean at all with camera shake off.
- **The boss ward** (`core/bossWard`): the Colossus and the Leviathan lose hp
  only to harm the player set in motion — any direct blow, or the world's
  (a blast he did not cast, fire, current, acid, a flood) while he is ENGAGED:
  he cast, poured or threw within 8 s (480 ticks) at a point ≤ 360 cells from
  the boss. A boss's own slam/fireball/death blast never hurts it and leaves no
  live charge; no blast he did not cast breaks a lair's organ (the Kiln tank,
  the Sump plugs), and neither does world repair. A boss the player never
  harmed enters at full hp. (QA: the Colossus died on its own, idle player.)
- **Kiln thermal shock is a CRACK, not a drain:** a douse he caused (credited
  when he is engaged during it, and it stays his while the kiln stays wet)
  cracks it for 16% of max hp at once (~75 of 468, ~83 of 520), again every
  150 ticks while still soaked. Each crack flashes up to 24 water cells on and
  around its body to real steam, bursts steam, glowing fissures and 10 stone
  shards, flashes it (14), squashes it (0.3), 5-tick hitstop, +0.05 shake
  (cap 0.09), 0.55 bloom kick (not under reduced flashes), steam hiss + shell
  crack + 64→36 Hz saw, a "THERMAL SHOCK" finisher callout, and staggers it
  (no attacks for 120 ticks, speed ×0.2). A full tank is 2–3 cracks. (Was
  1.4 hp EVERY wet tick — 84 hp/s — from any water at all.)
- **The Kiln Colossus, final boss** (`creatures/bosses/colossus`, box 16×34,
  rig ×2.3, hp 560; the arena is a 62×40 vault over a flat 116-wide floor on a
  16-row footing, with three ceiling tanks). It closes to arm's length
  (halfW+10) and shoulders the alchemist aside (1.4 impulse / 6 ticks) rather
  than standing in him.
  - SLAM (< 38 cells): 74 ticks; blast at the fist (halfW+10 out) radius
    10/11/13 by phase at tick 30 (never harming itself); the fists stay in the
    ground 26 ticks: a punish window (direct blows ×1.6).
  - STOMP (< 160 cells; 45% in phase 1, always in 2+): rears 32 ticks, then
    two shockwaves run along the REAL floor at 1.45/1.75/2.15 c/t for 62 ticks;
    14 dmg and a pop-up (ky −3.4) to a GROUNDED alchemist within 2.5 cells —
    jump it. A gap, a pool or a wall ends a wave; loose grains on the floor
    jump; a running dust ridge and grit mark it.
  - MOLTEN THROW (< 330, with a line): the gob comes out of its chest furnace,
    released at tick 32 on a lob (g 0.02, T = |dx|/3.1 clamped 26–62): a
    hostile fireball plus 9 real lava grains; phase 3 throws a second at 46.
  - HEAT VENT (phase 2+, when water is near it or it is wet): a 42-tick tell,
    then 34 ticks of real fire (10 cells per 3 ticks in a ring out to r17,
    life 18–32) and it boils water within 26 (≤ 48 cells per 6 ticks to
    steam); 8 dmg once to a body within 19.
  - Phases at 66% / 33%: a roar each (72 ticks); the third bursts its plates
    off as rigid stone chunks (90-tick own-debris grace), bare core ×1.25 on
    direct blows, march cap 0.42 → 0.5 → 0.62, ember footprints every 20
    ticks, recovery 84 → 62 → 44 (+≤ 30) ticks.
  - WATER: each crack of the ward's thermal shock (below) also kneels it for
    the 120-tick stagger with its chest split (direct blows ×1.6) and darkens
    the furnace (heat 0.12, reheating 1/480 per tick while dry).
  - DEATH is a 214-tick sequence: it kneels (70 ticks), cracks jet fire and
    steam (every 9 ticks, every 4 after the 128-tick overload), bloom ramps to
    ~1.0, at tick 196 it blows apart (r24, never harming itself) and heaps real
    rubble (stone, 30% grit, a 7×3 lava heart, embers) plus six rigid chunks;
    the run-complete path runs at 214. Nothing lands on a dying kiln.
- **The Sunken Leviathan** (`creatures/bosses/leviathan`): LUNGE (< 92): a
  22-tick dark-lure tell, then an 18-tick dart (bite 16); VOLLEY (90–320): a
  20-tick throat swell; THRASH (phase 2+, alchemist dry within 130): an
  18-tick tell, then up to 22 real surface water cells flung at him (4 dmg
  each — the pool spends itself) and 9 dmg within 26; DIVE (phase 3,
  alchemist above within 40): 34 ticks down with the lure dark, then a surge
  (vy −3.4). A live pool the ward credits SHORTS it in bursts (2026-09,
  deliberate: a burst every 24 ticks plus the per-sample status shock killed
  it in ~7 s off one Spark Bolt): one burst of 7.5% of max hp (was 3.5%) and a
  40-tick convulsion (direct blows ×1.6; was 14), then no burst for 210 ticks
  (was 24) — and the burst GROUNDS the pool: every charged conductor within 40
  cells is cleared, so the next needs a fresh spark. The generic status shock
  no longer lands on it (the burst is its shock). Each new phase is a beat of
  its own: the current is shed, no burst for 300 ticks, and it rages at once
  (phase 2 THRASHES — "IT GROWS CROSS"; phase 3 DIVES — "IT GOES DEEP").
  Submerged, a blow lands ×0.12 (was ×0.25: a held Spark Bolt ground ~10 hp/s
  through the water); beached, direct blows land ×1.3. A mortal probe holding
  fire at the sump's edge now needs ~40 s (was 7); a player dodging and
  re-sparking the pool, ~60–120 s. Lurking, it eats the fish its lure draws.
- **The Kiln escape** (`game/story/KilnEscape`, 2026-09 deliberate): the Heart's
  heat thins the levitation in the flue — the jet burns 2.0 more LEV a tick (on
  top of its 1.15) and a ledge takes back 1.45 of the ground's 1.7 recovery, so
  it is hop, breathe, hop. STEAM GUSTS rise up the shaft's clear middle (15
  wide) every 3.4 s, told 0.75 s ahead by a hiss and a boil, at 3.4 rows a
  tick: a body caught mid-air is knocked down (vy ≥ 2.4) and its LEV cut to 15;
  one on a ledge is spared. The lava rises 0.09 rows/tick (0.24 on a long lead,
  0.06 close under the boots; was 0.11 / 0.3 / 0.085). A patient climber who
  times the gusts reaches the hatch in 31–47 s (probe; was 5.6 s). A fall is a
  0.45 s fade and a restart at 1.15 s: no death screen, no gold, no phial.
- **Hit stagger** (`Enemies.flinch`): a blow ≥ 5 staggers any non-boss that
  is not rooted or surface-bound (weaver, eggs, spitter, rillback, stone maw,
  root loper answer with their rigs only): a ballistic shove through the
  knock system, push = clamp(40/footprint, .3, 2) × clamp(|k|, .8, 3) × .55,
  for 3–9 ticks (3 + dmg/maxHp·26); once per 45 ticks, so a rapid wand
  cannot stun-lock.
- **Idle life** (`creatures/idle`): a resting or foraging animal does one small
  act every 170–490 ticks (deterministic per individual, no sim randomness):
  look around (84 ticks: one way, then back over the shoulder), sniff (56,
  head pecks), groom (90), shiver (26: the rig and the gel shake), settle
  (110: slimes spread ×1.18 wide, ×0.78 tall; brutes sink 1.6·S), stretch (a
  roosting bat's wing unfolds, 70). Repertoires per kind; hunting, fleeing,
  burning or staggered animals never idle.
- **Bat roosts:** dormant folded teardrops on the ceiling; one red eye cracks
  open at your approach (< 70 cells wakes them; stirring starts at 110). A roost
  panics together: one waking (or any loud cue ≥ 0.5 within 110 cells) bursts
  every roost-mate within 22 out in a fan, holding their attack 40 + 12·n ticks.
- **Slime egg clutches** glisten with pulsing embryos; they hatch on a timer —
  sooner if you loom.
- **Predation:** bats prefer a nearby moth (or firefly, or ash moth) over you;
  the gulp is a puff of wing dust. See §7 for the wider ecology.
- Slime landing splat, imp 3-pose wing flap + tail wag, enemy blink, smoothed
  velocity leans — all per-kind in `render/sprites/EnemySprites.ts`.
- Enemy bodies obey the light field (a body in shadow is a silhouette); only
  natively glowing kinds (imp, wisp) and emissive parts (eyes, cores) self-light.
  In designed darkness they are black until light finds them (§10).

---

## 5. Combat & casting feedback

- **Cast cursor:** the amber glow on the hotbar marks which card group fires
  next; every click casts the next group left → right, then wraps.
- **Dry fire:** an empty-mana click answers with a hollow click, a mana-bar
  flinch on the HUD, and a sad fizzle of particles at the staff tip (throttled
  to every 14 frames while held).
- **Recharge:** the wrap-around recharge reads on the hotbar as the bar refills.
- **Click buffer:** a click made while the wand is cycling is remembered — one
  buffered cast, never a queue — and fires the tick the wand is ready, if that
  is ≤ 30 ticks (0.5 s) after the release (`CLICK_BUFFER_TICKS`, was 8); later
  than that, or if a wand swap, level change or death intervenes, it is spent.
  8 real taps at 450 ms on the starter: 3–6 casts before, 7 after (the 8th
  merges — the cycle can't cast faster).
- **Starter cycle:** the Oak Sprig's recharge is 22 ticks (was 30, 2026-09-27),
  so a lone Spark Bolt cycles every 36 ticks = 0.60 s (was 44 = 0.73 s):
  +22% sustained Spark DPS against a starter QA called "plinky".
- **Hitstop:** player hurt ≥ 8 damage freezes gameplay for 3 frames
  (rendering continues). Creature hits: ≥ 7 damage (with knockback, within
  240 cells, throttled 5 ticks) freeze 2 frames (3 at ≥ 20); **direct hits of
  2–7 freeze 1 frame** with a lighter squash (0.1) — pellets and chip damage
  land too; sub-2 streams (the Flame Jet's 0.7 ticks) never stutter.
- **The Spark Bolt** (`FxSprites.drawSparkBolt`, `Projectiles.sparkImpactFx`):
  a white-hot 1.25-cell bead with a cyan rim, a 14-cell electric streak that
  tapers from 1.5 cells to a thread and jitters a half-cell sideways per frame
  like a live wire, a 3-cell additive halo; it seeds 1.1/2.5/3.0 light with a
  4-step wake. On impact: 12 cyan-white sparks sprayed back off the struck
  face, 3 streakers carried through, a tiny arc at the contact, a bloom kick
  (0.34 flesh / 0.2 stone; none under reduced flashes) and a dry high tick
  (noise 3.4 kHz + a 2.1 kHz→760 Hz square blip). A struck creature staggers
  4 ticks, mass-scaled (1.4 × 40/footprint, clamped 0.35–2.6 cells/tick: bat
  2.6, slime 1.4, golem 0.4 — always under the 3.5 wall-slam speed); Weavers
  keep their grip, bosses and clutches do not budge. It ignites flammables
  exactly as before (the blast and charge rules are untouched).
- **Alchemical kills** (`combat/AlchemyKills.ts`, `alchemyKill` event): every
  damage path reports its source before hp moves; when the killing blow was
  the world's and the wizard set it in motion, the kill is announced, chains
  and pays out. Causes: fire/burning → burned, lava → rendered, steam →
  steeped, a shocked body → shorted, out of breath → drowned, acid →
  dissolved, toxic → poisoned, debris/thrown crates → flattened, a corpse
  the alchemist threw, kicked or swung → bowled, a
  kick-launched wall slam → impaled, gunpowder/barrels/a bomber's death/hostile
  blasts → detonated, any physical blow to a frozen body → shattered. The
  wand's own bolts, bombs, lightning, kick, whip, stomp and Flame Jet stream
  stay direct (ordinary bounty) — and so do the statuses the wand applies
  directly: a status that takes hold within 45 ticks of the wand (not the boot)
  striking that creature is the spell's (`AlchemyKills.noteStatus`), so a spark
  that leaves a dry slime crackling or alight on stone is a spell kill however
  long it burns. It becomes the WORLD's — and the kill alchemical — when the
  fire has fuel (oiled body, oil or lava touching: FLAMBÉED although the spark's
  current still crackles on it), when the current came through a conductor (a
  wet body, charged water or metal touching or underfoot: SHORTED), when it was
  (re)lit with no wand strike behind it (a fire walked into), or charged
  through another liquid (a blood pool, spilled goo) the wand had not just struck;
  bare blast residue in air or stone cannot travel, so it stays the bolt's even
  after a miss. Once the world's it stays the world's while it lasts. A lethal
  status tick weighs the world's shares (toxic sludge always counts) against
  the wand's: if the world dealt at least as much, its largest share names the
  cause; if the wand's own zap or fire dealt more, the tick is direct. A status
  tick never SHATTERS a frozen body. Credit is generous: within 280 cells of the
  wizard, or struck by him in the last 20 s, or kick-launched in the last 3 s.
  Kills within 3 s (180 ticks) chain; the chain resets on a level change.
  **Payout, grid-honest:** bonus gold = 4 + 40% of bounty, ×1 / ×1.5 / ×2 /
  ×2.5 / ×3 by chain, rounded to whole 1-oz grains (2026-09 economy pass; was
  10 + 35% in 10-oz grains, on bounties ~3.3× larger); that many real Gold
  cells fountain out of the body in a low arc (vx ±1.1, vy −1.8…−3.4 cells/tick:
  apex ~10–36 cells, so walking over the kill brings the pile inside the 30-cell
  harvester pull; gold settles into a pool and sinks) for the harvester field to
  pull in. A grain is never deleted by its flight: no room where it lands → the
  nearest open cell within 6, walled in → straight into the purse; a full
  particle pool retires a cosmetic mote to make room. The active wand refills 35%
  of its tank (cyan motes run to the staff), the wizard gets +3 hp (rose
  motes), a bloom kick (0.45 + 0.12/chain, none under reduced flashes) and a
  brass dyad whose top note climbs two semitones per link (capped at a fifth).
- **Coin flight** (`particles/Particles.ts`): gold is only ever a real Gold
  cell or the purse. Whoever moves it — a kill's bounty, the harvester lifting a
  grain (1 oz a cell; was 10), mined ore — credits `state.score` at that instant; the
  homing mote is the payment's animation. It steers to ARRIVE: desired speed
  min(5.2, √(2·0.45·d) + 1.2) cells/tick with 0.45 cells/tick² of steering, so
  the burst-out arc bends into a landing instead of the old 3.75-vs-2.5-cell
  overshoot orbit; the 3-cell catch is swept along each step (no tunnelling);
  rock does not stop it (a magnet pull). A landing rings the loot cascade (coins
  within 24 ticks climb the scale) and pops a sparkle at the belt (6 cells up).
  If the wizard dies mid-flight the mote gutters out as a falling glint — the
  gold is already his.
- **Gold, the economy** (2026-09 deliberate pass): QA ended a run with 15,732 oz
  (4,533 after floor 2) against Sanctum prices of 40–380 — every choice free.
  The floors hold ~4,500 gold cells each (seams, vugs, tells) and the harvester
  lifted them THROUGH solid rock. Now: a gold cell is **1 oz** (was 10) and the
  harvester lifts only gold with a face open to air, liquid or gas (a seam still
  sealed in rock stays until it is dug to); bounties ×~0.3 (slime 10, bat 5,
  weaver 35, rillback 20, rootloper 25, stonemaw 40, Leviathan 140, Rime Warden
  120, Lenswright 130, Colossus 180; was 30/15/110/70/85/130/450/380/420/600),
  paid as a coin per ~4 oz (≤ 40); gold piles ×~0.35 (chests 3–5 piles of 5–13,
  was 15–39; floor-1 piles 10–20, puzzle rewards 12–30); a first brew 30 (was
  100); raw ore 1 oz a cell (was 2). Sanctum prices are unchanged (mend 40,
  toughen 90, brew 60, lost pages 160, the wandwrights 240 / 380). Measured by
  a teleport walk (no kills): the direct route lifts ~80–230 oz a floor, a
  completionist sweep ~870–1,030; with bounties and piles a good run earns
  ~1,500–2,200 and, after the Sanctums, carries ~800–1,500 to the end.
- **Callouts** (`ui/Callouts.ts`, `styles/callouts.css`): the word pops over
  the kill, rises and fades — FLAMBÉED, RENDERED, STEEPED, SHORTED, DROWNED,
  DISSOLVED, SHATTERED, FLATTENED, DETONATED, POISONED, IMPALED, BOWLED — one word per
  cause so it teaches the mechanic. Brass serif (Cormorant Garamond) for a
  single, with the bonus gold beneath; a chain link lands on its predecessor's
  spot and takes it (the old word bows out in 140 ms) with a ×N badge that
  grows and heats brass → copper-ember (×3–4) → white-gold (×5+), and a dry
  line: "and another", "a chain reaction", "most irregular", "the Works
  approve", "please mind the duck". Life 1150 ms + 180 per heat tier;
  pop (0.55 → 1.16 → 1.0 over the first 20%), rise 40 px, fade in the last
  third; reduced flashes drops every glow, prefers-reduced-motion drops the
  pop and the rise. The Trickshot finisher's "RETURNED WITH INTEREST" speaks
  through the same layer (`combatCallout`).
- **Self-shock fairness** (`combat/SelfShock.ts`): for 240 ticks after any
  card cast, electrical damage to the wizard scales with the current actually
  at his body (charge / 40, floor 0.15 — charge loses 3 per water hop, so
  distance through the pool is the falloff) and shares a 12-hp cap per
  120-tick window; anyone else's current (a Rillback pulse, a live rail) keeps
  its full bite. While a current reaches him, a short arc crawls back up the
  charge gradient (≤ 16 cells, re-rolled each status sample) toward its
  source. A pressure hop in the water (FluidFlow) no longer teleports a
  sparked crater's charge across the pool: a wet wizard sparking the water
  8/18/30 cells away lost 48/25/32 hp over 3 s before, ~7–13 (≤ 12 of it
  electrical) / ≤ 5 / ≤ 5 after.
- **Screen shake is earned and local:** *all* ambient shake writes are
  viewport-gated and fall off quadratically with distance — dead at 420 cells.
  Explosion boom audio scales the same way (distant thunder). A quake next
  door rattles you; across the cavern it's a tremor; off-screen it is nothing.
- **Damage:** blood spray scales with the hit; the damage vignette pulses; a
  slow heartbeat starts under 25% HP and turns urgent under 12%.
- **Death, the Noita way:** a difficulty-scaled slice of carried gold (8–20%,
  15% at the shipped Conjurer baseline — `deathPenalty` in `config/difficulty.ts`)
  spills as physical gold piles at the corpse. The world keeps every scar; you
  respawn at the last lit waystone (invuln 120, common hostiles thinned within
  200 cells of the anchor so you get one clean breath) and walk back to reclaim it.
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
- **Humiliation finisher (`combat/Trickshot.ts`, on by default since Breathing
  Works; the Trickshot chain experiment is no longer required):** with
  a Weaver's own leg in hand and its owner under 30% HP, the whip commits into
  a directed beat — time eases to 25% for the approach (≤1.1 s real, then it
  expires), the ambience ducks under a rising whip, the victim recoils, and
  only a swept thigh contact confirms it: a real-time hit pause (0–70 ms,
  default 50), a brass burst and chitin shards along the actual stroke, a
  heavier lateral impulse so the corpse rolls, the shell crack and an
  embarrassed chirr, "RETURNED WITH INTEREST", then a 180 ms smooth return.
  A miss or an intercepting body releases time with a 500 ms recovery and no
  cue. The line rises over the victim as a world-anchored brass callout
  (`ui/Callouts.ts`, via the `combatCallout` event). Framing is one small camera lean and a 6% zoom (`cineDx/cineDy/
  cineZoom`, off with the camera-motion setting) plus a vignette lift (off
  under reduced flashes); the chain slow-motion and the finisher never
  multiply — the deeper one wins.

### Frames, bargains and the choice (the choice update, 2026-10-01)

**What changed and why.** The forced route held no card choice (every tome sat off it) and a lit waystone silently handed
over one card. Now a lit waystone opens an **altar of three** (a host, a synergy that works with the hosts you carry,
and a wild devil's bargain with a price) a moment after the flare; a floor's **arrival gift** (floors 2-4, held until the
floor's title has had its moment) is three too (a burst, a precise shot, a utility). Every offer tile carries a **fit
tell**; an offer never carries more than one card that would do nothing in the wands you hold. Wand frames became
loot (eight frames), shown with their stat diff, how YOUR cards would cycle in them, and the cards a smaller frame would
push out (back to the satchel; a refit no longer deletes anything). Code: `combat/wands/{cardRules,cardFit,altarOffers,
wandFinds,BuildDirector,buildRecap}.ts`, `ui/{WandOfferOverlay,CardOfferOverlay,buildRecapView,runNotes}.ts`.

**Cadence** (ticks, 60/s; every offer waits until play is calm: unpaused, no curtain, no story beat, no Sanctum, a
living player, the arrival grace over): altar 50 after the flare; the gift 60 after arrival (the 330-tick grace holds it
longer); a boss's wreckage frame 170 after the kill (Leviathan, Lenswright, Rime Warden; the Colossus ends the run, so it
leaves none); the altar's wand 40 after its card is chosen. **One altar in three** (the 3rd, 6th, 9th of a run) also
turns up a wand. Wandwright's rack: three specialists, 200 oz, paid only if one is taken. Tomes and Lost pages use
the same fit rule (one dead card at most; an authored tome's fixed card is never swapped). An offer that is earned but
not yet shown (the altar's 50 ticks, the gift's grace, a boss's 170) rides the wand runtime snapshot as `build.owed`
(optional, defaulted) and is re-queued 90 ticks after a resume, so a save written in that gap never eats the decision.

**Fit tells** (`cardFit(holdings, card)`): *works* / *dead* / *open*. The host rule is the compiler's (`modifierWorksOn`):
the eight body mods plus Bounce, Infuser and Trigger need a projectile body (spark, bomb, warp, black hole, frost shard,
ice lance, wisp, meteor: never a jet, the arc, the dig ray, a placed spell; Bounce not the black hole); speed/heavy/spread
by their effect sets. A Trigger also needs a second projectile, a multicast needs N. Crits read the TARGET's state: *wet*
(Aqua Jet, Water Trail), *frozen* (Frost Charge, Frost Shard, Ice Lance, Cryo Jet), *burning* (Flame, Ember Storm, Meteor);
the tell names the setters and what pays off. The dead-cast caption ("Water Trail does nothing on Chain Lightning: it needs a
projectile body.") shows in the toast stack AND the hotbar's cast caption, once per card per run.

**Measured by real casts** (`node scripts/measure-builds.mjs`; the real `WandSystem.fire`, compiler and projectile code,
an endless-HP target, 600 ticks (10 s) of held fire, mean of 3, the arena corridor re-cleared because the cell sim is not
running). Oak Sprig unless named; dps / damage per mana at 30, 70, 200 cells:

| build | 30 | 70 | 200 | note |
|---|---|---|---|---|
| Spark Bolt (baseline) | 36 / 2.1 | 36 / 2.1 | 35 / 2.1 | never dry (tank 80 of 90 at the low) |
| + Heavy Charm | 56 / 1.8 | 58 / 1.9 | 53 / 1.7 | x1.6, not x1.2 (see below) |
| + Overcharged Coil (x3, 26 mana) | 56 / 1.6 | 57 / 1.6 | 57 / 1.6 | burst x2.2 (3 s: 228 vs 105); tank dry in ~3 casts; 0.76x efficiency |
| + Loose Cannon (x4, +29 deg aim) | 94 / 3.5 | 25 / 0.9 | 10 / 0.4 | x2.6 point-blank, under 0.7x at 70 |
| + Short Fuse (x3, life x0.075) | 96 / 3.5 | 97 / 3.6 | 0 | x2.7 out to ~125 cells (a bolt lives 14 ticks, was 180), nothing beyond; bolts and lances only (measured at x0.06: same 30 and 70, 0 at 200) |
| + Millstone Charm (x2.5, speed x0.3) | 80 / 2.6 | 82 / 2.7 | 71 / 2.3 | x2.3 on a still target; a flier or hopper steps aside (18 vs 5 dps on the strafing target: the same low hit rate as the plain bolt) |
| + Kickback Charm (x2, recoil 7) | 66 / 2.2 | 66 / 2.2 | 65 / 2.1 | x1.8; every cast shoves the alchemist ~4.7 cells/tick (a plain Spark Bolt: 0.5) |
| Cast Bomb | 6 / 0.2 | 46 / 1.2 | 5 / 0.1 | arcs; lands near 70 |
| + Overcharged Coil | 123 / 2.5 | 172 / 3.4 | 62 / 1.2 | x3.7 at 70; dry; 23 hp of self-blast per 10 s |
| + Short Fuse | - | - | - | **a dud on a bomb (and a meteor), by rule**: at x0.03 the bomb burst ~9 cells ahead of the alchemist every cast, killed two 153 hp golems and two imps in ONE cast and cost 61-82 of 110 hp (406 hp of self-blast per 10 s in the endless-target run): a suicide button, not a price |

The price of each bargain is paid in the COMPILER and lands only where its rule says it does (benefit and price together;
on any other host it is a dud, mana still charged): Overcharge +26 mana; Loose Cannon +0.5 rad of jitter; Short Fuse x0.075
lifetime (a bolt: 14 ticks, was 180; spark, frost shard, ice lance and wisp only); Millstone x0.3 speed; Kickback an uncapped +7 recoil impulse.
All stay inside the x4 damage clamp (stacking two clamps the damage and keeps both prices). Bargains are in no tome,
Lost-pages, depth or waystone pool and discovery never feeds them: they exist only as an altar's wild card.

**Played fights** (the same real WandSystem and projectile code, but the REAL game loop and a held real mouse button, aim
re-projected from the nearest enemy through the camera every 90 ms; a flat metal arena 320 cells wide, 110 HP, Oak Sprig;
two golems (153 hp) and two imps (36 hp, they hover and burn you) at 60 / 90 / 120 / 150 cells; one line per trial: seconds to
clear, hp lost, D = the alchemist died). A single trial is noisy (the plain Spark Bolt itself lost 3, 105 and 14 hp on
three runs), so read the pattern, not the digit:

| build | trials |
|---|---|
| Spark Bolt (baseline) | 8.1s -0 · 6.1s -3 · 10.0s -105 · 9.7s -14 |
| + Heavy Charm | 7.6s -12 |
| + Overcharged Coil | 6.1s -2 (the tank is at 1 of 90 by the end: the price) |
| + Loose Cannon | 20.9s -84 · 18.5s D · 7.4s -59 · 12.8s -36 (2.6x slower at range: the shot scatters, the imps live) |
| + Short Fuse, life x0.03 (first tuning) | 20.3s D · 12.3s D · 30s -29, 2 of 4 killed · 13.1s D (nothing that keeps its distance can be killed: **shipped value was too harsh**) |
| + Short Fuse, life x0.06 | 20.1s -80 · 14.2s -10 · 13.9s D · 15.3s D · 15.9s -104 · 14.5s D (3 of 6 die: still too harsh) |
| + Short Fuse, life x0.09 | 9.6s -18 · 12.0s -48 · 5.5s -38 · 12.6s -58 · 8.2s -31 · 13.4s -10 (no deaths, about the baseline: the price has gone) |
| + Short Fuse, life x0.075 (shipped) | 14.9s -17 · 30s -29 (3 of 4 killed) · 11.3s -18 · 7.7s -23 · 13.9s -76 · 13.5s -66 (no deaths; about twice as slow as the baseline, because the imps hover at the edge of a 125-cell reach) |
| + Millstone Charm | 8.4s -28 |
| + Kickback Charm | 9.2s -2 (in an open arena the shove is a retreat; the price shows beside a pit or lava) |
| Cast Bomb alone | 6.5s D (a bomb at close range is a self-weapon already) |
| + Overcharged Coil on a bomb | 8.5s D |
| + Short Fuse on a bomb (retired) | 0.6s, all four dead in ONE cast, -61 hp (and -82 against slimes): the room clears and so does most of the alchemist |

A pack of four slimes (weak, hp ~30) is trivially won by everything (3.9 s with the plain bolt, 1.6 s with Overcharged Coil,
which empties 70 of 90 mana for it), so the golem-and-imp pack is the honest test. The conclusions that changed the code:
Short Fuse's life went from x0.03 to x0.075 (x0.06 still killed half the runs, x0.09 cost nothing) and it no longer rides a bomb or a meteor.

**Frames, carrying three builds** (dps for a lone Spark Bolt at 30 / 70 / 200 cells; Meteor Call dps at 30 cells, where it lands):

| frame | slots | cast / recharge | mana / regen | spread | Spark | Meteor | what it is for |
|---|---|---|---|---|---|---|---|
| Oak Sprig | 3 | 0.23 / 0.37 s | 90 / 30/s | 1.1 deg | 35 / 36 / 35 | 36 (dry) | the starter |
| Bone Crook | 4 | 0.15 / 0.75 | 120 / 39 | 2.9 | 24 / 24 / 16 | 51 | |
| Brass Injector | 5 | 0.10 / 1.00 | 160 / 48 | 4.6 | 20 / 20 / 10 | 65 | many groups per cycle |
| Void Lattice | 5 | 0.27 / 0.33 | 220 / 66 | 0 | 37 / 37 / 37 | 87 | |
| **Hornet Needle** (found) | 3 | 0.08 / 0.33 | 80 / 25 | 3.4 | **49 / 49 / 26** | 29 (dry) | rapid: x1.4 on a cheap card; the small tank dies on anything dear |
| **Pepperpot Rod** | 4 | 0.08 / 0.43 | 130 / 37 | 11.5 | 40 / 23 / 9 | 50 | wide: a fan up close, hopeless at range (Twin Cast sparks 47 at 30, 13 at 200) |
| **Cast-Iron Mortar** | 6 | 0.33 / 0.73 | 260 / 54 | 0 | 22 / 22 / 22 | **73** | heavy: six slots, a slow hand; dear spells keep going (tank holds, 78 left) |
| **Samovar Staff** | 4 | 0.20 / 0.60 | 280 / 72 | 1.7 | 27 / 27 / 24 | **94** | marathon: Meteor Call at x2.6 the Oak's rate and the tank never empties (61 left) |

Reading the table: the specialists are not upgrades of the starter, they are other answers (Brass and Void stay the paid
generalist upgrades, and are not on the rack). A group that costs more mana than the frame's tank can never fire
(Overcharged Coil + Meteor Call is 96 mana: dead on an Oak Sprig's 90), and the bench's sentence says so.

**Two findings from the same casts** (the first fixed here, the second left alone and recorded):
- *Heavy was not x1.7.* A `dmgMul > 1` Spark Bolt used to be `round(dmgMul)` stacked bolts at a little extra jitter ("heavy =
  more bolts" v1, written before `Projectile.mul` existed). In real casts the extras detonated on the first bolt's debris or
  strayed off the target: Heavy Charm measured x1.2 (25 damage a cast, not 44), and Power Surge (x1.25 rounds to one bolt)
  did nothing for a Spark Bolt. It is now ONE bolt carrying `mul` (read at impact like the bomb's and the shard's): Heavy
  x1.6, Power Surge a real +25%. A deliberate balance change, flagged in the commit.
- *Twin Cast with two Spark Bolts underdelivers* (30 dps at 1.0 dmg/mana against a lone Spark's 36 at 2.1): two bolts
  leave in the same tick and the second meets the first one's explosion debris. Not changed here (it is the multicast's
  own design); a wide frame's jitter helps it (Pepperpot 47 at 30 cells). Worth a look from whoever owns multicast.

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
- **Creature voices are placed and made of the body.** Every enemy cue runs
  through `audio.at(x, y, fn)`: panned by bearing, attenuated to silence at
  380 cells (bosses 640–720), so a creature three rooms away is not in your
  ear. Each kind speaks in its own material — Weaver: dry chitin clicks and a
  chopped `chirr`; Rillback: a wet `slither` whose filter opens and closes;
  Root Loper: a low `creak` with a rasp; Stone Maw: `grind` over a knock;
  bat: a falling `squeak`; small bodies launching: a soft `hop` pat. Alerts
  and death cries use the same voices (`alertVoice`, `deathCry`), so the
  generic wet squelch is now the slime's alone.
- **One mix, one pair of ears.** Every voice lands on a bus — `fx` (the
  player's world: blasts, spells, impacts), `voices` (creatures), `ambience`
  (drips, chirps, simmer, the refinery's breath) and `ui` (pickups, cards,
  stingers) — summed through a glue compressor (-12 dB, 2:1, 12 ms / 250 ms),
  +1.6 dB make-up, a -2 dB 20:1 limiter and a tanh soft-clip shoulder above
  0.8. A wall of forty simultaneous blasts peaks at ~0.6 instead of clipping;
  a single blast still hits ~0.3 (the old unprotected sum peaked 0.24 alone
  and 1.8 — hard clip — with eight). Sliders: Master 80 %, Effects 100 %
  (fx/voices/ui), Ambience 80 %, squared taper, persisted with the player
  preferences (`audio/mix.ts`).
- **The ears are the camera centre** in every mode, so on-screen left is the
  left ear. `placeSound` (`audio/mix.ts`): pan = dx / 320 × 0.85 (never hard);
  full gain inside a 70-cell plateau, then (1 − t)^1.8 to silence at the
  cue's range; vertical distance counts ×1.35; past a quarter of the range a
  lowpass closes from 16 kHz toward 650 Hz, so a blast across the cavern
  arrives as a thud. Explosions (900-cell range), lightning, frost/implode
  impacts, spell hits, steam, splashes, doors, mechanism groans, cauldron
  and critter sounds all pass their cell position; noise bursts start at a
  random offset so two blasts in one frame do not comb-filter.
- **Stingers** (`audio/Stingers.ts`, UI bus, never ducked): an alchemical kill
  rings a glass bell over a brass swell that climbs a pentatonic ladder with
  the chain (two kills in one blast arpeggiate 70 ms apart; the cause adds a
  tiny material accent); a spent return phial cracks, a restored one pours
  and settles on a warm third; victory is a rising fanfare into an open
  chord, a fallen run a slow descending minor line — both duck the world for
  ~2.7 s; a saved clip clicks like a shutter.
- **A blocked creature stops drumming.** A beached Rillback hops toward what
  it wants; three hops that went nowhere mean a wall, and it rests 2.5–4 s
  before trying again instead of thudding into the rock every half second
  until you leave.

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

### Organisms (WS-N, `game/organisms`) — life with behaviour

Placed by worldgen per floor from their own stream (`hashSeed(seed,
'organisms')`), ≥ 90 cells from spawn, near reachable ground, writing no cells;
saved with the level's fauna (no respawn churn). Rot Gardens: snapjaw 12,
puffer 18, isopod 18, glow-worm 6, moth 10, firefly 10, beetle 6, fish 8.
Drowned Cisterns: fish 26 (schools of 4–6), glow-worm 16, leech 14, moth 6,
firefly 8, isopod 6. Kiln Heart: ember beetle 16, ash moth 16, moth 2.
Rooted organisms sleep off-camera. Every beat emits an `organism` event.

- **Snapjaw:** a toothed pod on a 5.5–7.5-cell stalk; trigger 10 cells, a
  12-tick TELL (it shivers, gapes to 1.25, leans in), then the SNAP (shut in 3
  ticks, resolved at tick 2, bite reach 7.5): 11 dmg to the alchemist
  ('snapjaw-bite'), 16 to creatures ('impaled': lure a slime in for an
  alchemical kill). Critters and corpses are swallowed → CHEW 780 ticks (1170
  for a corpse) with the jaw shut: the fed, safe window. Reopens over 70.
  Flame: 10 heat ignites it, then it burns like green wood (writes real Fire
  along itself every 6 ticks; water douses −12) to 44 char → ash. Bolts: 9 of
  its 32 hp each (it snaps at the air).
- **Spore puffer:** inflates 1/2100 per tick (~35 s); ripe ≥ 0.4 it bursts at a
  body within r+1.5, a projectile within r+3, a creature, a critter, flame
  within r+2, a kick's gust or a blast — REAL marsh gas into the empty cells
  within 3 + 4·inflation (lattice-thinned), spores, and a creatureSignal
  (r90). Spent 240 ticks, then it regrows. Flame lights the cloud as it leaves.
- **Glow-worm:** a curtain of three beaded threads (×1 / .62 / .8 of its
  8–26-cell reach) lowered at 0.05 c/t; moths, flies, fireflies and ash moths
  that touch a thread stick, are reeled up at 0.14 c/t and eaten (the belly
  glows 900 ticks). Light-shy: wand light > 0.42 on its body, a body through
  the thread, or fast movement within 16 below → it hauls up at 0.9 c/t and
  hides 260–400 ticks, and will not come down into the beam. Moths are drawn
  to its beads.
- **Isopod / ember beetle:** hand-on-wall crawlers (1 cell per 5 / 7 ticks) over
  floors, walls and ceilings; they pause 50 of every 420 ticks to test the air
  and drift to carrion within 75 to feed. Isopods curl into balls when
  touched, shot or gusted (bounce 0.35, roll downhill), rest 170 ticks, unroll
  and re-attach. Ember beetles graze Coal → Ash (8% per step; the belly glows
  900 ticks), shrug off fire, fizzle in water (real steam), and die as up to
  two real Ember cells.
- **Leech:** swims at a wading alchemist within 56 (0.34 c/t), latches (max
  3), drains 2 hp every 150 ticks ('leech'), is sated at 5, lets go after 300
  ticks dry, and dies if he burns or its water is shocked. Beached leeches
  writhe toward water and dry out in 900 ticks.
- **Ash moth:** spirals the nearest hot glow in the updraft; one that touches
  fire or lava flares out and leaves a real Ash cell.
- **Lantern moths:** fly to the wand tip only while its light reaches them
  (`lightQuery.wandLight`, or a 110-cell cone stand-in) and orbit at 9 cells;
  hooded, they lose you. **Fish** school (cohesion .004, alignment .05,
  separation within 3) and die belly-up in charged water (floating 1500 ticks).

### Visible ecology (`creatures/ecology`)

- Bats not busy with the alchemist fly to a moth swarm (≥ 3 within 22 cells)
  they notice from 170 cells, and eat it: move the swarm (your lantern) and
  you move the bats.
- Idle slimes smell remains within 110 cells, hop to them (windup 9) and
  settle to eat (+3 hp every 20 ticks; each bite takes 30 ticks off the
  body's life).
- Weaver lair webs (real Vines inside a lair's radius) snare fliers; the
  weaver comes down for them. Idle imps snatch ash moths within 70. Rillbacks
  and the Leviathan eat fish; snapjaws eat whatever is kicked into them.
### Flora — trees that fall, seeds that climb (`game/Flora.ts`, `sim/elements/flora.ts`)

Living wood is real cells: **Trunk** (40, walk-past soft growth, burns slow),
**Leaf** (39, held within `LEAF_REACH` 9 steps of wood/rock, else it lets go
and flutters: 42% fall / 10% drift per step, floats on water as a pad) and
**Seed** (41: thirsty or glow; held in a pod until shaken).

- **The warning.** A trunk notched to ≤ 55% of its typical row width creaks
  (level 1), ≤ 30% creaks harder, sifts dust from the notch, shivers leaves
  loose and nudges the shake (+0.004, cap 0.03). Cooldown 80 ticks per spot.
- **The crack.** When a stand's last contact with anchored ground goes (a
  powder holds it only from underneath; a lone speck never), it lifts out of
  the grid onto a Rapier body (≤ 4 fitted boxes, wood density 0.7, so logs
  float). It falls AWAY from the dig beam / blast / boot (hints live 150
  ticks), else toward its crown's lean.
- **The lean.** Hinged at the cut on the back edge (then 1.5 cells behind
  the centre of mass, clamped to 6), starting at 0.0055 rad/tick: 18 ticks
  near-locked (angular damping 26) while it groans, then the hinge fibres
  hold at damping 1.1 until 0.95 rad, then free fall (0.12). A stand with no
  ground under its foot tips at 0.032 rad/tick.
- **The fall.** Leaves shed from the crown as it goes; whoosh once the tip
  passes 3.2 cells/tick; a burning stand trails flame.
- **The crush.** Contact ≥ 1.5 cells/tick hurts. Creatures:
  `min(160, 10 + v·12·massF)` as 'flattened' (+3 hitstop, thud + squelch),
  massF = √clamp(mass/150, 0.3, 3). The alchemist: `clamp(4 + v·4.2·min(1.4,
  massF), 8, 30)`, knocked away from the trunk, shake +0.02.
- **The thud.** Δv > 1.1 cells/tick is an impact: dust along the contact,
  glass/ice/snow it lands on shatter, boom scaled by size, shake up to 0.045.
- **The log.** Settles at speed < 0.08 and spin < 0.006 for 10 ticks (in
  water: < 0.25 / < 0.02 for 3 — buoyancy never gets quieter), or after 720
  ticks regardless; re-stamps as Wood (bark darkened ×0.86–0.9) in its final
  pose, bottom-up, displacing any liquid upward (a log dams a pool).
- **Kick (F).** A stand ≤ 130 cells and ≤ 34 tall snaps at the boot; a bigger
  one shakes: every held pod within its crown lets go, a few leaves fall.
- **Glowseeds (floor 1).** Walking over a loose glowseed puts it in the
  pouch (cap 3, "pouch is full" toast at most every 600 ticks).
- **Thirsty seeds.** A wetted seed soaks one water cell per substep; the bed
  (±4 × ±3) sprouts when no seed has drunk for 48 substeps and the bed took
  ≥ 8 cells (a drip dries off). The stalk takes the bed's seeds and puddle
  (≤ 70 cells) and grows with energy `min(120, 22 + water·1.6 + seeds·3)`:
  two cells wide, a Wood rung (6×2) every 12 cells on alternating sides,
  leaves at the mid-points, a crown when it ends.
- **Kiln glow (fix3).** Ember-bark fissures (living wood the colour of a coal)
  seed 0.34–0.44 red light, breathing out of step down the trunk; fire-lily
  blooms light their own cup (petal 0.36, gold heart 0.46, slow shimmer) —
  under a loose Ember cell's 0.55, so they read as embers and flowers you can
  find in the dark, not lamps. Char bark [60,46,40] (was [44,36,32]: black
  cut-outs on basalt). The Kiln's dressing budget is 18 stands / 72 small
  (was 14/46), 65% of the small ones fire-lilies (was 55%).
- **Stand footing.** A rock/wood/ice footing is anchored only by static
  neighbours (loose powder leaves on its own); gold is never footing (the
  harvester lifts it from under anything within 30 of the player).
- **Cost.** Stands are re-flooded only when a chunk's support fingerprint
  moves (≤ 48 fingerprints, ≤ 10 floods per tick): Flora.update ~0.16–0.24
  ms/tick in the densest views, A/B tick+render +0.27 ms with ~7k plant cells
  in view (D2, 1600×900).

---

## 8. Camera & presentation

- Lerp follow (0.085) with a facing lookahead (+26 cells), idle zoom-in (1.13×
  after ~1 s of stillness), hard snap on spawns/transitions.
- Crouch-peek offset (§1). Build mode pans with WASD.
- **Floor clamp (every level):** the view never sinks below the world's bottom
  row; a zoomed-in frame may sink by its hidden margin only. The old half-view
  "void allowance" (`CAMERA_BOTTOM_VOID`) showed a third of a screen of black
  under D1's Undertow and Lower Bell and under floor 4's arena.
- **D1 barricade:** 14 × 31 wood under an iron lintel; moss caulks every fifth
  row (the tinder that takes a Spark Bolt's flash), sealed oil pockets sit two
  columns deep in its core at every fifth row, and it collapses (route-seal
  plug, `breakFrac` .55) with a shower of embers that also clears its fire and
  moss, so the doorway is passable at once. A metal sill keeps burning spill in
  the doorway. The note says to stand well back; from there the first fire
  lands about 3.5 s after spawn.
- **Lower Bell grate:** the lock rings (gong + key jingle, a light shake) when
  the bell comes within 95 cells; each 12-cell leaf then slides one cell every
  2 ticks into its slot, grinding every 12 ticks, dust every 6.
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
- **Per-floor look (`config/floorLooks.ts`):** every floor shares the Works'
  material kit — terrain atlas, chalk lip, refinery backdrop — graded per floor.
  Albedo = atlas × gain + lift; a jagged 1–3-cell *crown* stain creeps down from
  exposed tops (strength 0.55–0.95, capped at 3 cells because the CPU sampler's
  dirty halo is 2); 64×64-cell wall panels draw masonry (Rot Gardens 5/16,
  Drowned Cisterns 12/16, Kiln Heart 9/16, D1 16/16) framed by a 0.55× mortar
  seam where they meet rock; water, lip, underside and backdrop grade (mul/lift,
  a parallax offset, optional mirror, machinery opacity ×0.7–1.2) are per floor.
  D1's values are the shipped identity. Presentation only: no cell type changes.
- **Material by shape (floors 2–4, `FloorLook.natural`):** the 64-cell panels
  are gone. An art plane (`render/terrainArtPlane.ts`, one byte per cell)
  holds depth into rock (chamfer 3/4, capped 20), air distance to rock
  (capped 15) and a sticky BUILT bit. Built = straight exposed runs ≥ 40 / 16
  / 36 cells (Rot / Cisterns / Kiln) or any face inside a prefab or boss-arena
  footprint, lined 7 / 12 / 8 cells deep (±3 jitter). The rest samples the
  floor's procedural rock tile (256² per floor, two texels per cell). Cores
  sink by `smoothstep(3, 16–18, depth)` toward aoCore ≈ 0.4–0.6, stepped in
  4 bands whose edges shift ±1 cell with texel luminance. Tops have a lip mix
  of 0.5–0.55 with 1–3/16 lit flecks. Faces open to the right take ×0.8, and
  undersides streak 1–3 cells by column. Tile features (roots, seeps, ember
  veins) show in a depth window, and Kiln veins brighten toward the depths
  (×0.35 at the top). The backdrop's contact shadow is ×0.40–0.45 at a face,
  easing out over 7–8 cells, with saturation ×0.5–0.55 and a 0.3 haze. The
  Kiln Heart's backdrop is ember-lit rather than stepped back (QA: "floating
  slabs on a flat black backdrop"): mul (1.6, 0.88, 0.56) + lift (0.03, 0.01,
  0.002), copper machinery ×1.75, saturation ×0.9 and a warm smoke haze
  (0.12, 0.045, 0.02) at only 0.18 — and a deeper contact shadow (×0.30,
  easing out over 10 cells) so the rock stands in front of the warm refinery.
  Small enclosed air pockets under 1500 cells are sealed and count as rock,
  and so is a liquid body under 1500 cells that meets no exposed air (the
  POCKET bit on its loose byte: a water pore in a flooded wall; a dig carries
  the verdict forward and opens it where the air gets in).
  Digs re-derive at most 4 chunk regions per frame, and liquid or powder churn
  one every other frame, so render cost stays within noise of the classic sampler.
- **Underwater readability (the Drowned Cisterns, fix4b):** rock, water and
  backdrop were one blue-grey value (luma ~25 / 27 / 28), so the drowned
  masonry read as one more backdrop plane. Now a reachable water body is lit
  murk (body 40, 98, 116) that shows the kit's planes through it at 0.45 —
  graded like the open backdrop, then 0.45 saturation and a ×(0.8, 1.25, 1.4)
  tint, swaying ±1.6 cells (sin(y·0.19 + phase·0.35)) like refraction — so a
  flooded hall reads as open water with drowned arches beyond it (luma ~34
  against rock ~25). A face against a body of water (two cells of water or
  more, never a pocket) wears a wet rim (112, 170, 180) at 0.5 on tops, 0.25
  on sides; sealed pockets keep the old opaque (26, 66, 88) and no rim. Lips
  0.55 → 0.62, sides 0.35 → 0.42. The kit's backdrop grade steps the distance
  back: mul (0.72, 0.84, 0.84), saturation 0.85, a deep-teal haze (0.02,
  0.055, 0.058) at 0.2. CPU, WebGL2 and WebGPU draw the same (`waterClarity`,
  `waterSeen`, `waterPocket`, `wetLip` on `NaturalLook`; other floors leave
  them unset and look as they did — floors 2, 4 and the second doors carry
  little water and already separated rock from distance).
- **Depth kits (`config/depthKits.ts`, `render/depth/`):** every expedition
  floor stands in layered scenery, looked up by biome (a generic kit graded
  from the floor look covers any biome without its own). Far → near:
  - *The Bellows:* the refinery plate (parallax 0.08, lit 0.12) → a hall of
    pressure stacks, lattice towers and catwalk spans (0.14) → grate light
    shafts on the hall's plane (breathing opacity, amp 0.35 / 420 ticks) →
    the copper machinery (0.2, opacity 0.52) → girders, heavy chains, gears
    and the great bellows (0.32).
  - *The Rot Gardens:* spore murk with giant caps (0.05) → far stalks and
    roots (0.12) → spore light (0.12) → a mid garden with shelf fungi (0.22)
    → thick fibrous stalks and root curtains (0.34).
  - *The Drowned Cisterns:* surface-lit murk and a faint arcade (0.05) → two
    tiers of arcades (0.11) → light falling from above (0.11) → great arches
    with drowned statues and kelp (0.21) → masonry columns, chains, kelp
    forests (0.33).
  - *The Kiln Heart:* furnace glow low on the screen behind chimneys (0.05)
    → chimney stacks and basalt (0.12) → rising heat plumes (0.12, 240-tick
    breath) → brick tunnel mouths with glowing hearths and crucibles (0.21)
    → basalt columns, chains, a gear (0.33).
  - *The Cold Store:* brine tanks in frost haze under a cold blue-white
    light from the high vents (0.05) → cooling-coil banks and carcass rails,
    frost rimming every top edge (0.12) → pale vent light (0.12) → brine
    tanks with ladders, frosted grates, hooks (0.21) → frost-rimed pipe
    columns with icicles, hooks on heavy chains (0.33); snow at three depths.
  - *The Glass Galleries:* dark by design (darkness 0.36): a violet dusk
    hall with broad, dim pools of prism spill (0.05) → tall glazed arcades
    with lens medallions (0.12) → display cases, lens racks, hanging prisms
    (0.21) → slender columns and a great lens (0.33). NO light shafts and no
    texel brighter than luma 140: nothing may read as a beam or a bright spot
    near the floor's mirror and prism puzzles.
  Painted planes are *lit silhouettes* (render/depth/lightArt): each kit has
  a restrained value ramp and a light (a vertical profile plus soft cores
  with a power falloff) — the Kiln's furnace cores glow low on the screen
  and fall off to soot, the Cisterns' light wells fall from above, the Rot
  Gardens' spore pools float at mid height. The far plane is that light;
  nearer planes are nearly flat silhouettes that step down the ramp toward
  the viewer, veiled by the light behind them and rimmed where it wraps
  their edges. The Kiln's heat columns scroll upward (0.3 texels/tick) and
  breathe (amp 0.25 / 240 ticks); embers drift at two depths.
  Atmospheric perspective is baked per plane (haze mix 0.04–0.34 and kept
  contrast 0.66–1 toward the kit's haze colour), so far reads lighter, cooler
  and flatter. Each plane has a light response: the lantern, the wand and
  lava glow reach near planes (lit 0.9) but barely the far ones (0.1), and
  designed darkness dims them all. Procedural planes are one texel per cell
  (the Living Descent plates' grain), bake one per frame on floor entry.
  Every plane glides with the camera's sub-cell position: the WebGL2 compose
  samples it where each canvas pixel sits on screen (cam · parallax + screen
  position, `render/depth/parallax` backdropOrigin), so a slow drift slides
  it steadily a pixel (half a cell) at a time instead of riding the world for
  a cell and snapping back (`scripts/verify-parallax-drift.mjs`). The CPU
  fallback and the WebGPU compose build a cell-resolution frame, so their
  planes still step a whole cell.
- **Foreground occluders:** a plane at parallax 1.4 (1.5 cells per texel,
  opacity 0.94) of near-black silhouettes — chains, pipes with valves,
  girders, gears (Bellows), stalks and root curtains (Rot), kelp and broken
  columns (Cisterns), basalt and crucibles (Kiln). Floor 1's are placed to
  frame its rooms where the follow camera sits (the Intake's riser pipe and
  valve, two gears under the engine hall's catwalk, the Chamber's trunk
  main, the Silt Garden's roots, the Refuge's lamp chain, the Lower Bell's
  gear and chain); generated floors scatter about one per screen. The Bell
  & Tea Engine's hall and catwalk are a no-occluder zone (36-cell soft edge):
  the machine is played, not watched. So are the second doors' set pieces
  (30-cell edge): the Frozen Fall, the Ice Vault, the Rime Warden's Ice-House,
  the Periscope, the Prism Gate and the Lenswright's Lens Room; the Galleries'
  zones are also CALM (no depth particle glints near their optics).
  **The play layer always wins:** a reveal field (8-cell texels, updated at
  30 Hz, easing 0.26 per update) clears the screen centre (clear to 0.42 of the half-diagonal,
  full by 0.86), and punches soft holes (0.6 → 1.35 radii) over the player
  (46 cells), creatures (their size + 16), a held or flying corpse and the
  telekinesis tether, projectiles, pickups, mechanisms, waystones, the portal
  and lava/fire/acid. High-readability lighting clears a wider centre
  (0.62 → 1.05), scales every occluder by 0.55 and opacity by 0.7.
- **Depth particles:** stateless fields at several depths, each moving with
  its plane's parallax — Bellows drips and mist motes behind, dust in front;
  Rot spores at three depths; Cistern bubbles and silt behind, motes in
  front; Kiln embers and ash behind, sparks in front. Fields behind the play
  layer draw only over open air and dim with designed darkness; near motes
  catch real light (they glint in the lantern). Far motes brighten up to
  2.2–3.2× inside the kit's light shafts.
- **Dressing restraint:** gold powder is a mottled metal (shadowed grain /
  body / facet / 6% glint) with bloomWeight 0.07 (was 0.15) and a 0.22 light
  seed (was 0.34); marsh gas is a dim olive haze, bloomWeight 0.07 (was 0.24).
  Gold piles (pickups) sit on the ground as a lit coin heap (left-lit faces,
  coin rims, two spilled coins, a crown coin that turns every 48 frames and a
  glint that sweeps the heap every 150).
- **Title card:** every level arrival (D1 included) shows kicker ("Depth N"),
  the tracked Cormorant name (letter-spacing settles 0.34em → 0.16em over
  1.6 s), a copper rule that draws out (0.9 s), then the floor's italic
  epigraph (0.7 s delay). It waits for the transition curtain to lift
  (curtain hold + 120 ms; 1.6 s fallback) and holds 3.6 s. Event banners reuse
  the style, smaller, for 2.2 s.
- **Toasts:** a right-hand log under the objective. Identical lines within a
  toast's 3.2 s life merge (×N badge pops 1.45 → 1 over 0.26 s, clock resets);
  "+N …" tallies sum; at most 3 stand; shouted legacy lines are calmed to
  sentence case. Mechanism fail-open groans only toast within 360 cells.
- **Vitals:** 10 px tracks with a 1 px lit edge; a pale loss ghost holds a
  lost chunk for 0.28 s then drains over 0.5 s (gains snap after 0.9 s).
- Overlays rise in; gameplay fonts sized for readability; no monospace reaches
  the player.

---

## 9. Mechanism & objective feedback

- Doors retract cell by cell; a spark line traces trigger → gate when a sensor
  fires; braziers light with real fire; plates depress under real weight; the
  sand scale, sluice, and charge coil read raw cells as their sensors.
- **Fail-open groan:** wreck a mechanism's trigger body and its gate groans
  open ~30 s later — physics never locks you out.
- **The Bell & Tea Engine is played, not watched** (docs/BELL-TEA-ENGINE.md):
  the player keeps control; the camera frames hall + catwalk at 1.2× on the
  active station, clamped so the player is always in shot (the duck's station
  frames 46 cells lower). A waiting station's fixture pulses a brass halo, an
  expanding ripple every 70 frames plus a steady ring. A hollow knock plays
  when it jams, and the caption card gains a brass border, the verb's live key
  and a copper backup meter. Backups: slow match 540 ticks, clockwork knocker
  600 ticks, seep 1 cell / 6 ticks. Watchdog nudges fire at 180–300-tick
  intervals, with sparks and a lever click.
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

## 10. Light and dark (Breathing Works light wave)

"Light is information" (principle 5) made into a mechanic. The owner's brief:
*dark caves where you only see the creatures' eyes or some glowing phalanx
until you shine the wand's light towards it.* Darkness is a place you enter,
never a filter over the game: the lamp-lit Works stay readable.

**Designed darkness** (`config/darkness`, `core/darkness`). Every floor has a
base darkness (d1 0, d2/d3 0.3 "an ordinary cave", d4 0.18 — the kiln glows)
and DEEP-DARK ZONES (ellipse or rounded rect, rim feathered over 30 cells and
wobbling ±10 so a zone reads as a cave the light never reached). Zones are
baked once per level into a half-res map (static data, regenerated with the
pristine world on restore). The bake FOLLOWS THE ROCK (fix3): the dark starts
in a zone's core air and travels only through what connects to it — along air
it holds 8 cells of feathered depth then fades over 52 (a doorway dims, never
meets a drawn edge), into rock 2.2× slower (a room's walls go dark some cells
deep; the rock beyond and any cave the zone's box merely overlaps keep their
light), the fade's line wandering ±16 in air / ±18 in rock, a 1-2-1 blur over
the texel steps. Only STRUCTURE soaks slowly (rock, masonry, metal, timber,
ice, glass): a sand dune, a gold drift or snow in a dark room goes dark with
the room. (Before, the zone box was painted over whatever lay under it:
light-puzzle rooms read as black rectangles cut through rock and lit caves.
fix4b: a fade of 40 and a soak of 3 still drew a dark room as a black
rectangle cut out of lit walls, and a sand heap in the Undertow glowed as a lit
block.) The map is READ SMOOTH: bilinear between texel centres for gameplay
(`sampleDarkMap`) and per cell in every compose path and the sprite light
(`openAtCell` over the per-light-texel field) — sampled nearest, every dark
edge was a staircase of 2-cell steps. The render uses d² × 0.965 (an ordinary cave dims
unlit rock only ~9%); gameplay reads d linearly. Per light texel the result is
an OPEN factor that every compose path (CPU reference, WebGL2 light-texture
alpha, WebGPU WGSL) multiplies ambient and the 0.40 readability floor by; the
sprite floor (0.48), the creature floor (0.42), mechanism pens (0.55, never
below ×0.3) and D1 fixture pens scale with it too. Real light is untouched, so
in a deep-dark zone you see exactly what the wand, a fire, lava or a glowshroom
lights. What full dark leaves is a cold "wet slate" remainder (albedo ×
0.012/0.016/0.026, air 0.0022/0.0032/0.0055), never an RGB zero. EYE
ADAPTATION: the squared light law would swallow every weak light, so a linear
term fades in with the dark (lit = lf² + 0.42·shut·lf) — failing lamps and
glow-caps still pool — and the air's halo round a lantern is 2.4× stronger.
**High-readability lighting** keeps half the render darkness (its 0.85 ambient
floor then reads ~0.43 in a zone): darkness still reads as a place, nobody is
locked out.

**The lantern in the dark.** The omni spill shrinks to ×0.62 radius at full
darkness under the player (eased 0.1 per build) — you see your footing, not
the room — while the aimed beam keeps its reach, loses less per cell of air
(0.976 → 0.985) and burns ×1.12: in a black cave the world is where you point.
The non-occluded glow cone shrinks ×0.55. Floor 1: the Undertow and the west
end of the Lower Bell (where its Weaver waits). Floors 2–4: each light-puzzle
room plus one (Cisterns: two) big caves on the route, sampled from wizard-fit
ground away from spawn, portal, waystones and boss.

**Eyeshine and glow markings** (`render/creatures/eyeshine`). Species art
marks its open eyes at the rig's real head anchors (`anatomy.markEye`); after
the body resolves an additive overlay (so it composes on every path) gives each
eye a faint glow of its own from darkness 0.18 up (0.62 at full dark, core +
halo) and a RETROREFLECTIVE flash when the wand's light lands on a face turned
to the lantern (gain 1.9, saturating at wandLight 0.35; the halo widens). Eyes
blink and track with the expression rig; sleepers and corpses don't shine; the
beam's first catch of a pair of eyes in the dark tinks (2350→2800 Hz, at most
once per 50 ticks). Markings (0.7 at full dark): the Weaver's leg tips
("glowing phalanges", pulsing in step order), the Rillback's lateral line, a
slime/bomber core, the Stone Maw's jaw seams (it is blind: no eyeshine at
all), a Root Loper's crown; lures, bells, cores and embers keep their own
lights. Colours: Weaver silk-green, bat ember-red, slime pale green, acid slime
acid green, Rillback cyan, Root Loper amber, mage violet, imp/golem/Colossus
forge orange. THE REVEAL: in the dark a body resolves out of the black through
the raster's ordered dither as the light finds it (rise 0.16/tick ≈ 6 ticks,
fall 0.035/tick ≈ 28 ticks); unrevealed pixels keep only their own glow.

**The hooded lantern** (L, rebindable, Handbook "Light and dark"). The omni
becomes an ember (radius ×0.16, intensity ×0.3, fill ×0.45), the beam and glow
cone go out, eased over ~16 ticks. A brass hood drops over the wand tip with
an ember inside; hooding clicks (760→430 Hz square), hisses and curls smoke,
unhooding clicks brighter, rings and flares. `lanternHooded` event for audio.
A new floor or a death lifts the hood. Moths lose a hooded lantern. SIGHT: the
alchemist's visibility is the shipped 0.7 (torch 1) unhooded, +0.3 × darkness
(a lantern in the dark is a beacon); hooded 0.7 × (1 − darkness)². Sight range
= vision × (0.52 + 0.48·v) for v ≥ 0.7 (unchanged), falling linearly to ×0.16
at v = 0: hooded in a deep-dark zone a Weaver sees you at ~34 cells (crouched
~22), not ~215 — or hears you.

**Creatures answer the light** (`creatures/lightResponse`). Being lit is
information: the aimed beam on a creature (wandLight ≥ 0.07, inside the ±0.5
rad cone, clear line to the tip) gives it a confident fix on you (≥ 0.75).
WEAVER: flinches (crouch 14 ticks, head snaps back) and backs off 46 ticks,
cooldown 34 — until 150 beam ticks inside a leaky window habituate it: it goes
cranky (150) and charges through the light. BATS: the beam on a roost wakes
every sleeper within 40×30 cells and scatters them away from the light (flee
60, squeak); a bat in flight breaks its dive and veers off (flee 30, cd 40);
after ~240 beam ticks a hungry bat stops caring. ROOT LOPER (the lurker):
frozen, eye shut, bark creaking while the wand's light (≥ 0.06) is on it, and
22 ticks after; in the dark it creeps ×1.45 while you look away. SLIMES: an
unaware slime within 120 cells of the beam's lit spot hops toward it (gathers
every 38 ticks) — herd it with the beam. STONE MAW: blind, unmoved.

**Light devices.** PHOTOCELL (`sensorType 'light'`): a brass lens set into
rock; the beam on it (≥ 0.07) or any blaze beside it (level ≥ 1.05) charges it
over 90 ticks with a rising hum and six amber pips; the dark drains 0.35/tick
(it cools, it does not reset). Latched: a brass chime, sparks, a self-lit gold
lens. Its stone housing is its fail-open body. LUMEN BLOOM (`game/lumenBlooms`):
a light-drinking plant whose petals are REAL Glass cells two rows thick. Lit
(beam ≥ 0.06 or level ≥ 1.0 at the heart) it opens +0.024/tick (full in
~0.7 s, 3 petals/tick, a rising glass chime), holds 70 ticks, then furls
tip-first at 0.0028/tick (a full 44-column span over ~6 s, a creak and a
shiver as it starts). Petals only ever go into open air (never over a body, a
crate or rock) and only its own glass is taken back; a shattered petal regrows
on the next unfurl. Its heart breathes a faint light (0.1 + 0.26·open) and the
bridge glows along its length.

**Light puzzles** (`world/lightPuzzles`, forked 'light-puzzles' stream,
GEN_VERSION 51). Floors 2–4 each carve THE LAMPLIGHTER'S LOCK (124×70, a metal
strongroom behind a oneShot sliding gate; the Rot Gardens use one permanent
lens, the Cisterns and the Kiln twin lenses on opposite walls, each latching
260 ticks — light one, swing across the dark to the other before it cools;
reward a tome + gold) and THE BLOOM CROSSING (178×104, degrading to 150/128
wide, a chasm over a metal-lined acid sump with a bloom rooted on each lip,
each spanning half the gap; reward a potion + gold, sometimes a heart). Both
rooms are deep-dark zones, joined to the main path (connectToCaves, wizard
gauge checked, rolled back otherwise). Floor 1: the Undertow's lamplighter's
cache — a lens in the flank of a stone tooth hanging from the roof and a flush
riveted lid over a metal-lined niche (gold + a Torchbearer Tonic); the critical
route never needs it. Findability audits 'photocell' and 'lumen-bloom': some
wizard-reachable spot within 150 cells must have light's line of sight (glass,
ice and crystal pass it) to the lens or heart.

---

## 11. Complications (run mutators, 2026-10-01 — `content/mutators`, `game/MutatorDirector`, docs/DIFFICULTY.md)

Standing regulations for a descent: the feel of each is what the grid does, and every one was *played* with
real input and measured (`scripts/verify-mutators.mjs`). A complication shows itself three ways: a Notice toast
when the descent begins ("Notice posted: … in force"), a one-line instruction the first time the alchemist nears
each kind of vent (once per kind per run), and the chips on the pause menu and the ledger.

```
tinderbox: every fuel's flammability ×2.4 (wood .1 → .24, oil igniteChance .08 → .19) — a flame at the end of a 3-thick plank that dies at ×1 (10 cells of 1,179 in 6 s) burns 278-657 at ×2.4 · wet-floors: ×0.55 (wood .055)
low-gravity: gravity ×0.55 (0.28 → 0.154; liquid 0.12 → 0.066) in Player, the Rapier world + buoyancy, KNOCK_GRAV, the swing · a full-hold jump apex 23 → 45 cells (×1.9), a 36-cell drop 16 → 21 ticks · the levitation jet's thrust follows the dial (it was tuned against 0.28: unscaled it climbed 198 cells in the probe arena vs 112; scaled, 112 → 97) so jump + jet stays about the same reach, and it stays a hover instrument
glass-cannon: alchemist HP ×0.5 (Adept 110 → 55, a Sanctum's Vitality +30 still lands on top) · alchemist's blows ×1.5 on 'direct'/'bowled' hits in Enemies.damage, AFTER the wand compiler's ×4 clamp (a real spark bolt: asked 18, dealt 27)
crowded-house: enemyCount ×1.5 (floor 2, seed 424242: 14 → 21 placed) · bounty ×1.4 (slime 10 → 14 oz)
dark-works: ambient ×0.6 (0.36 → 0.216) + a darkness FLOOR of 0.7 under every campaign floor (core/darkness.darkMapFor lift: a floor's base darkness becomes max(designed, 0.7); hubs and custom levels stay readable) — mean luma of floor 2 at the same spot 0.077 → 0.045 · ambient alone (0.45×) was only 12% darker: the compose pass's 0.40 readability floor dominates an unlit surface
famine (Short Rations): a rise in health within one tick is halved unless it is a set piece (> max(6, 30% of max HP): a rest, a respawn) — a healium pool 80 → 38 in 2.5 s
fireworks: a fallen creature (not a warden) bursts after 14 ticks: 160 sparks + 40 embers, kicks the bloom, boom(5); foes within 20 cells take 5-14 'detonated', the alchemist within 12 cells 3-7 · queue ≤ 24 · a chain of three slimes runs to the last
hush ×0.5 / nosy-neighbours ×1.5: the creature's sight radius (265 × light scale × dial) — a slime notices from 200 cells plain, 100 under Hush, the arena's edge (280) under Nosy
wet-floors dressing: ≤ 6 closed basins on the walk (14-110 cells, ≤ 4 deep, ≥ 60 apart, ≥ 40 from the arrival, ≥ 16 from a pickup), 5 drips (every 36 ticks, 1 droplet, budget 260 cells) · a spark placed in a puddle reached 58 of its 61 cells inside 1 s and shocked a wet alchemist standing in it
slime-rain: 8 ceiling vents (every 30 ticks, 2 droplets, budget 300 each), ≥ 70 apart; fire turns the cup of slime to acid (the sim's own 4%/tick)
gas-leak: 5 floor vents (every 22 ticks, 4 cells, budget 900), ≥ 70 apart; MarshGas has no lifetime, so it pools under the ceiling; a flame took all 32 cells of a plume in the probe
```

---

## Tuning quick-reference (this codex's load-bearing numbers)

```
coyote 6f · jump buffer 8f · jump vy -3.7 paced by depth · gravity 0.28 (liquid 0.12), × the complications' gravity dial (1 unless Low Gravity: §11)
levitation spool: 0.33 -> 0.57 thrust over 48f (t-cubed ease-in) + 0.92/f drag -> ~3.3 terminal climb
wand recoil: base 6 + sum(proj speed×count), ×0.06 -> impulse, cap 4.0, ground ×0.55 (opposite aim; down+airborne = rocket-jump)
levitation horizontal: own control (levitHorizControl 1.0×) — decoupled from ground Swift/Swift-Soles buffs
air inertia: input caps at maxRun but never snaps carried momentum down; airborne vx *= airDrag (0.985) each frame instead of the ground 0.72 — sprint carries into jump/levitate, glide coasts (±12 sanity rail). Builder → LEVITATION → Air momentum (drag)
gore/blood: count = baseline × global.bloodAmount × channelMul(material) × sizeFactor. sizeFactor = clamp(halfW·h / 50, 0.3, 4) (bat barely spatters, golem/colossus gushes). channelMul keys off the sprayed cell: Cell.Blood→goreBlood, Cell.Slime→goreSlime, Cell.Acid/Toxic→goreOoze, else 1 — so red blood, green slime, and glowing ooze tune discretely. bloodAmount is the master: 0 = bloodless, 1 = shipped, up to 10 = maximum gore / Tarantino mode. All in Builder → Global Controls → GORE (Overall 0–10×, channels 0–4×). Particle pool MAX_PARTICLES=4200 caps extremes gracefully; gold bounty shower is NOT scaled
blood staining: blood particles stain (stainCell) the sturdy surface they strike (Wall/Wood/Stone/Ice), and flowing/pooling blood liquid stains the floor/walls it touches each substep (handleViscousLiquid) — red soaks in permanently (tints world.colors, not types, so golden hashes unaffected)
chill (CHILL_PARAMS): brine .0026 + .0042·depth · nitrogen .0035/cell ≤ .02 · frozen-biome floor .12 · frost bolt +.24, rime wave +.2, breath lick +.075 · decay .0011 (.00025 in contact) + .0065·warmth (r26, full 7) + .02 alight · moveK 1→.45, jumpK 1→.82 (dead zone .08) · shell 72 ticks, press −9, burst → .66, cooldown 420 (cap .94) · thaw beat gap .26 (rime ≥ .42) · skin ≥ .45 (fresh water, 960–1260 ticks) · prints ≥ .5 · steam breath ≥ .5 · lens reach .2 of height, cap .55 (.36 readable) · score rate → .8, lowpass → 1.1 kHz (dead zone .15)
blood wading: wet Cell.Blood at the legs (sample 9 tall × ±4) / WADE_FULL_CELLS 48 = wade01; sheds ≤0.55× of accel+maxRun (shin-deep ≈ −40%). Contact (≥4 cells) BANKS soak charge into player.bloodStain (+18/f ×0.35–1.0 by depth, cap 3600) → sprite reddens boots+hem the more/longer he wades (BLOOD_STAIN_FULL 1000 = full crimson, over 8 cells); off the blood drains 1/f, holds then fades ≈ 1 min. Moving (|vx|>0.5) shoves a crest up (world.swap) + flings the pool's own-colour cosmetic droplets + soft splash
run accel 0.5 ground / 0.575 air · max run 2.6 paced by depth · crouch 0.38x · peek +48 cells
dive: entry 5.6, floor 4.6, terminal 6.4 (normal 5.0), drift x0.86/f
slam: 26-cell knock radius, 1 dmg, ≤12 powder cells popped
kick (F): melee cone range 22 / ±52° / 8 dmg / cd 22 · gust cone range 32 (1.5× fan) · kickImpulse 75 (mass-aware) · self-recoil 3.0×max(0.5,reaction), down=stomp-launch
kick gust → enemies: push 5×(40/footprint), clamp 0.2–4.5× · ballistic launch if mass≤26 (bat/eggs) → wall SMASH (12+2.4·speed dmg, blood-paints stone); heavier foes thud · bosses immune
kick gust → critters scatter+startle 16–32f · vines bend (applyRadialImpulse) · saplings ≤130 cells/≤34 tall snap, bigger stands drop their pods
felling: notch warn ≤0.55/≤0.30 of row width · hinge hold 18t @damping 26 → 1.1 → release 0.95 rad → free 0.12 · start spin 0.0055 · crush ≥1.5 c/t: foes min(160, 10+12v·massF) 'flattened', player 8–30 · impact Δv>1.1 · settle <0.08/<0.006 ×10t (water <0.25/<0.02 ×3t), timeout 720t
thirsty seeds: soak 1 cell/substep, sprout after 48 dry substeps if bed drank ≥8 · energy min(120, 22+1.6·water+3·seeds) · rung 6×2 every 12
telekinesis (E/F): reach 90 · leash 64 · snap 150 / 45 ticks unseen · spring K .03/m, damp .12/√m, cap .9/√m · sag 1.6/slime · field lift .35 · mana: regen + .08 + .09m /tick hold, 2 + 1.5m grab, 6 + 5m hurl (≥ 25% or fizzle) · hurl 8/m^.35 clamp 3.5–7.5, lobbed · lift ≤ 6 slimes (nudge 1.1/√m, 6 mana)
corpses: bowl ≥ 2.2 c/t, 6 + 4.5·m^.6·v cap 90, keep 45%, cd 14, credit 240 ticks, hitstop 4 at ≥ 36 · head ≥ 2.5 slimes at vy ≥ 2.2, ≤ 8 · thud Δv 1.6 (≥ 1.8 c/t) · shatter Δv 2.4 · kick 6/√m · gust 1.6·g/√m · burn 480 (oiled 780), char .0035, rot +2 · lava +10 · acid +6 · frozen 1200, friction .06 · twitch 24, wet charge 10 · plate weight round(4m) · lure ×1.6 for 300 ticks · spare 240 after a touch, ≤ 1800 · MAX 10
vine swing (G): reach 16, len 14–150, pump 0.16 (left=left/right=right), jump launch +2.0 up · release keeps momentum (airborne inertia, no walk clamp) · player pushes vines aside within 20 cells (strength 1.4)
skid: trigger |svx|>1.1 on reversal, 9f · stagger 12f · recoil 5f/7f
swap draw 12f (gleam f5-7) · fidget arms at 420f idle, routine 90f
slime windup 7f chase / 12f wander · wounded hop 0.55-0.85x at <40% hp
patrol: advance <14 cells (slime) / <10 (golem) · de-alert 300f beyond 300 cells
sequence chime 300+90·step Hz / break 120 Hz saw · emitter rate clamp ≥2f
bat flare 8f at <64 cells · swoop 12f cap 2.6 · tumble 14f, ~1.2%/f at <40% hp
enemy threat-sense (in-window foes, tick rate): hazard box halfW+9 (per-kind enemyLethalCell) · fast body dist<60 tti<26 toward>0.4 (imminent tti<14) · projectile dist<70 tti<22 toward>0.6 (imminent tti<12) · flame-cone reach 36 / half-angle 0.5 +0.3 slack · self: burning .85, hp<35% ramps
provoke on direct hit: mind fix on the shooter (confidence ≥ .8, irritation ≥ .75); fleeAt < .5 kinds bolt (fear → fleeAt), others aggression ≥ .6; weaver cranky 90 · notice escalation: visible & < 130 cells → irritation += (1 − d/130)/120 per tick (decay 1/800)
creature burning (FIRE IS A WEAPON, 2026-09 deliberate change): a catch burns 300 ticks (420 oiled; was 90/300), refreshed in the flames, and deals 0.30 hp per 2-tick status sample = 9 hp/s (burnScale 2.5 over the alchemist's 0.12; was 3.6 hp/s) → a lit slime (36/43/48 hp) burns out in 4.0/4.8/4.9 s (probe) unless doused (≥ 3 water cells); the alchemist's own burning (0.12/sample, 90/300 ticks) is unchanged · open-flame contact 0.7/row/tick, lava 1.6 · steam scald 0.05/row/tick (not imp/colossus/leviathan) · drowning: head ≥ 60% liquid → breath 360 (imp 90, bat 180, bomber 150) then −maxHp/300 per tick; immune rillback/leviathan/colossus/wisp/eggs
enemy drives: fear → sensed threat × kind-fear, decay 0.02/f · aggression +0.02 close +0.04 on-hit −0.03·fear −0.005/f · chaseScale clamp(1 − 0.7·fear + 0.15·agg, 0.25, 1)
enemy reflex: dodge ⊥ to threat vel @2.7 ×12f, one roll/threat (dodgeCd 22) gated by kind dodge% (fliers sustain vy, grounded one hop) · flee 26f @1.7 away (toward water if burning+seekWater) · final movement integrates at 0.85x on floor 1, ramping +0.075/depth to 1.0x by floor 3 before difficulty (probe, flee drive 1.7 on flat stone: floor 1 50→78 cells/s, floor 3 67→92, floor 4 75→92) · startle "!" tell @dodgeT≥10|fleeT≥23 + airy whiff (pDist<160)
colossus: slam r10/11/13 @30 (punish 26) · stomp waves 1.45/1.75/2.15 c/t ×62, 14 dmg grounded only · throw @32 (+46 in p3), 9 lava grains · vent tell 42, fire r17, boil r26 · roar 72 at 66%/33%, p3 bare ×1.25 · quench kneel 120 (×1.6) on the ward's 16%/150-tick crack · death 214 (overload 128, blast 196) · leviathan: lunge tell 22 (lure dark) · thrash ≤ 22 cells · shorted burst 7.5%/210 ticks, grounds the pool within 40 · phase beat 300 · water armour ×0.12 · beached ×1.3
organisms: snapjaw trigger 10 / tell 12 / bite 7.5 / 11 dmg / digest 780 / ignite 10, char 44 · puffer ripe .4, gas r 3+4·inf · glow-worm shy > .42 wand light, hide 260+ · leech 2 hp/150 ticks, sated 5, max 3 · hit stagger ≥ 5 dmg, 3–9 ticks, cd 45 · idle acts every 170–490 ticks
temperament fear/dodge/fleeAt: slime .4/.12/.95 · bat 1.3/.85/.45 · imp .6/.72/.6 · wisp .9/.7/.4 · spitter .85/.55/.5 · bomber .2/.3/never · mage .9/.62/.45 · weaver .5/.5/.72 · golem .18/.28/never · colossus 0/0/never · default .7/.45/.7
player eye seeks threats <80 cells · enemy gaze locks only when alerted
shake falloff dead at 420 cells · hitstop 3f at ≥8 dmg (player hurt); creature hits 2f ≥7 (3f ≥20), 1f for direct 2–7 · heartbeat <25% hp
spark bolt: 14-cell streak, 1.25-cell core, 3-cell halo · light 1.1/2.5/3.0 wake 4 · impact 12+3 sparks, bloom .34/.2 · knock 1.4×40/footprint clamp .35–2.6 ×4 ticks (no weaver/boss/eggs)
alchemy: chain 180 ticks · credit ≤280 cells | touched ≤1200 ticks | kicked ≤180 ticks · bonus (10 + .35·bounty)×(1 + .5·min(4, chain−1)) → whole 10-oz Gold cells · mana +35% active tank · +3 hp
callouts: life 1150 ms + 180/tier · tiers ×1 brass / ×2 / ×3–4 ember / ×5+ white-gold · word 27/29/31/34 px × holder/1280 · chain link takes the spot (140 ms bow-out) · max 6 live
self-shock: self-inflicted ≤240 ticks after a cast · scale charge/40 (floor .15) · cap 12 hp per 120 ticks · arc ≤16 cells up the charge gradient
fodder rosters (SPINE_ROSTERS by biome): fungal weaver 2 rootloper 3 rillback 1 slime 4 acidslime 2 eggs 2 bat 8 (roosts) · flooded rillback 6 spitter 3 wisp 2 weaver 1 bat 4 · volcanic imp 8 bomber 6 golem 3 stonemaw 3 (× difficulty enemyCount)
route-aware population (game/populationRoute): 60% of the roster (non-roost) holds the spawn -> key -> exit walk: exit-leg guard at 70% of the leg (toughest foe), key-mouth guard 35 path cells before the key, rest at arc-length quantiles t = u^(1/1.5) (hotter toward the end) 60–110 cells off the road (widening to 30–154, then 6–60 for a one-slit floor), corridor ≤ 170 path steps, spacing 28, spawn clearance 220/150/120; route work draws from rng.fork, the rest scatters
key lure: glint + chime on one clock per key, period 390 + (x·31+y·17) mod 150 ticks, glint 34 ticks (swell 7), range 460, silent inside 50; chime light.bloom.petal gain .8, +7 st · exit portal wake: ring 9 (was 6) × 32 dots, core, column 64 cells through open air (grows 1.6 cells/tick), wake ring 70 ticks, lamp raycast 34 half-cells × 1.4·throb (×2.6 → 1 over 50 ticks) · key pickup sets waypoint 'Exit Portal' (never over a hand-set one), chime mech.shrine at the portal after 0.6 s
guardian far breath (BossPrologue): its idle voice placed at its arena within 640 cells every 7–10.5 s (skipped while its arena is in HabitatAudio's camera box), puff in its element when on screen; bossHeard inside 420 cells -> faint "Unseen Guardian" on the chart · chart: fog hatch every 4th diagonal; "Uncharted" note under 5% charted; waypoint arrow rim 8% slid past measured HUD blocks
sim window camera ±60 · player 9x17 cells · staff ~11 cells, muzzle at d=9
darkness: render d²×0.965 (readability ×0.5) · floor base d1 0 / d2 .3 / d3 .3 / d4 .18 · zone feather 30 ± rim wobble 16 (was 10: straight edges read as unrendered chunks) · follows the rock: air hold 16 (was 8) + fade 40, rock soak ×3 · DARK_FLOOR .012/.016/.026 · DARK_ADAPT .42 · air glow ×(1+1.4·shut)
lantern in the dark: spill radius ×.62 · beam step 0.976→0.985, ×1.12 · glow cone ×.55 · hooded: radius ×.16, intensity ×.3, fill ×.45, beam/glow off, ease .26/build
eyeshine: base .62 from darkness .18 · retro ×1.9 at wandLight .35 · markings .7 · reveal +.16/−.035 per tick · catch tink ≤1/50 ticks
sight by light: v = .7 (torch 1) + .3·dark unhooded, .7·(1−dark)² hooded · range ×(.52+.48v) for v≥.7, → ×.16 at v=0 · beam lit fix ≥.07 in ±.5 rad
light responses: flinch ≥.07 · weaver crouch 14 / back off 46 / cd 34 / habit 150 → cranky 150 · bats scatter 40×30, flee 60 (flight 30, cd 40) · loper freeze ≥.06 +22, creep ×1.45 · slime lure 120 cells, gather /38
photocell: beam ≥.07 or level ≥1.05, 90 ticks, drain .35/tick, twin latch 260 · lumen bloom: beam ≥.06 or level ≥1.0, open +.024, hold 70, furl −.0028, 3 petals/tick
D1 sky (SKY in render/skyAtmosphere.ts): gradient base (0.36,0.53,0.78)→horizon (+0.28,+0.06,−0.28)·t · sun screen 0.72·VIEW_W,0.17·VIEW_H, halo r150 pow2.4, core 13→6 · clouds 4 octaves, parallax 0.82, drift 0.004/f, band t∈0.12–0.66, opacity 0.45 · hills far parallax 0.5 base26 / near parallax 0.32 base40 (taller+darker, drawn last)
```

When changing any of these: one at a time, deliberately, and say so in the
commit (they are load-bearing — see the project skill's hard invariants).
