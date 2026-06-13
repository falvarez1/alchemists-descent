# CRAWL — the second collision tier (design spec)

**Status: VERB SHIPPED (June 2026).** The stance machine, 9×9 tier, feel pass,
camera lead, prone muzzle, cramped feedback, and smaller projectile target are
implemented (feel numbers merged into docs/FEEL.md). Per open question 4, the
**crawl-pockets worldgen pass + `crawlMask` validator tier (§Level design rules
2–5) are a follow-up** — verb first. The Limber Draught / Mole's Knees
enhancements are also not yet in. Companion to docs/DESIGN.md.

## Why (and why now)

The player's collision box is 9×17 with every cell required clear
(`entityFree(x, y, 4, 17)`, step-up 5). The worldgen gauge campaign (GEN_VERSION 4)
guarantees that box fits everywhere on the **progression spine** — locks, door fronts,
keys, waystones, cauldron, portal, boss. But the organic wilderness still rolls
endless near-miss geometry: pinches off by 1–2 cells, debris formations (≥5-cell
clusters block; only <5 is walk-through rubble), low nooks behind waterfalls.

Today the crouch is a stance, not a shape: `crouchT` drives the sprite pose, the
camera peek, and a 0.38× creep — the box never shrinks. CRAWL completes the system:
a real second collision tier that converts the wedge-spot long tail from friction
into content — slow, committed, tactile spelunking.

## Rule zero — the two-gauge law

- **Standing gauge (9×17)** remains the findability standard. Nothing required to
  finish a level — no lock, door front, key, waystone, cauldron, portal, boss —
  may ever require crawling. The validator's `wizardMask` and the GAUGE RESCUE
  pass stay exactly as shipped. Fail-open survives: crawl can never be a
  mandatory tax, and a player who never crawls finishes the game.
- **Crawl gauge (9×9)** is the *optional* tier: secrets, treasure nooks,
  shortcuts, escape routes. Worldgen may deliberately carve crawl-only space, and
  the wilderness gets ~half its formerly-wedgy nooks traversable for free.

## The box: 9×9, axis-aligned, never rotated

Crawling swaps the collision box to **9 wide × 9 tall** (`entityFree(x, y, 4, 9)`),
same feet anchor. The square is load-bearing:

- **Diagonal tunnels need no rotated physics.** An axis-aligned square fits a 45°
  corridor of perpendicular width ≥ 9·√2 ≈ 13 — versus ≈ 18.4 for the standing
  box. Rotating a collision box is a lie the cell grid can't explain; the square
  is the honest primitive. Only the **sprite** tilts: the crawl pose lies along
  the sampled TERRAIN slope (floor-surface heights under nose and tail — not
  velocity, which dies to horizontal the moment you stall or stop), so in a
  diagonal chute the wizard *looks* tilted to the tunnel's angle while the box
  stays square.
- **One number, any direction.** 9 is already the body width, so "wizard gauge"
  becomes simply *9 in any direction*: a passage you can levitate up (9-wide
  shaft) is the same gauge you can crawl through. Validation, worldgen, and
  level-design vocabulary all collapse to two numbers: 17 standing, 9 crawling.
- 17-tall wizard flat on his belly — the prone sprite draws ~17 long × ~4 tall
  (mass conserved; it overflows the 9 box horizontally the way the standing hat
  overflows it vertically — the box is law, the drawing isn't).

Crawl physics deltas:

| Property | Standing | Crawling |
|---|---|---|
| Box (halfW, h) | 4, 17 | 4, 9 |
| Step-up | 5 | 5 (parity: hands climb what boots climb — jagged floors are 3-5 cell lips, and step-up 2 wedged crawlers where runners strolled; the box-fit test still gates every step under tight ceilings) |
| Speed (`stanceK`) | 1.0 (crouch-creep 0.38) | **0.32** |
| Jump / levitate / dive | normal | **disabled** (W = stand attempt first) |

Swift potion (×1.5), Swift Soles (×1.18), and `statusSlow` all still multiply —
a Swift draught making a long crawl bearable is brewing synergy, not a bug.

## Stance state machine — S is intent, geometry is law

The single most important rule, and the answer to "what happens if you release
the key inside a tunnel": **the key expresses intent; the world decides the
actual stance. The stance may never desync from geometry.**

- **Enter:** hold S on the ground (the existing crouch) **and move into a gap**
  that blocks the 17-box but admits the 9-box → the creep flows into a crawl.
  No new key, no toggle. Stationary S stays the crouch-peek; S in the air stays
  the dive slam. Crawl is "crouch-walk into a place only the low box fits."
  Holding S in the open also crawls voluntarily (sneaking under a sweep, staying
  small under fire).
- **Stay:** while ceiling clearance < 17, you remain crawling **regardless of S**.
  Releasing S merely sets *wants-to-stand*.
- **Exit:** every tick with *wants-to-stand* set, probe `entityFree(x, y, 4, 17)`;
  the first cell with full headroom pops you upright automatically (reverse
  squash, hat flips, dust shake). You can never wedge and never get stuck in a
  stance — release the key mid-tunnel and you simply keep crawling until the
  ceiling lets you up.
- **Cramped feedback** (released but can't stand): a small CRAMPED glyph near the
  meters, and every ~40 ticks the sprite bumps its hat on the ceiling with a soft
  thud and a grit-fleck — the world says no, visibly and audibly.
- **Liquids:** submersion (`inLiquid`) cancels crawl — swimming takes over, as it
  already preempts crouch. The liquid threshold scales to the sampled crawl body
  (13/45 cells standing → 7/25 crawling).
- **Falling:** crawl off a ledge and gravity rules; with S held you land back in
  the crawl, released you stand mid-fall the moment clearance allows.

## Hits, hazards, and the tactical trade

Grid-honest body: every sample loop that walks the 9×17 body walks the 9×9 body
instead while crawling — status cells, hazard DPS, liquid count, enemy projectile
overlap. The consequences *are* the design:

- **Smaller target.** Shots at standing-head height pass over you. Ducking under
  a volley into a crawl is a real dodge.
- **Face-first in the floor.** A 2-cell acid film that nips a standing wizard's
  boots now bathes a third of the crawl body. Floor hazards are the predator of
  the crawl space; ceiling fire stops mattering.
- **Casting allowed, low muzzle.** The wand still works (it's the game) but
  `wandTip` drops to ~4 cells above the feet — you shoot from prone height, so
  floor lips block lines a standing cast clears. No artificial aim-arc limits.
- **Slow is the cost.** 0.32× speed, no jump, no dive, step-up 2. Entering a
  crawl near awake enemies is a commitment — that's the challenge knob, and it
  needs no extra rules. (Future note: if a noise/alert radius ever ships,
  crawling should be quiet.)

## Innate, not acquired — mastery lives in the route

Crawling is available from the first second of the first run:

- It's the anti-frustration answer to geometry that exists from d1; gating it
  behind progression keeps the frustration exactly for new players.
- Movement verbs must be reliable; a roguelite that makes you re-earn basic
  locomotion every expedition turns a verb into a chore.
- The skill expression is **route knowledge and commitment judgment** — knowing
  where the crawl shortcuts are and when you can afford to be slow — not a
  button unlock.

What IS gated (enhancements, not the verb):

- **Limber Draught** (brew): crawl at 0.6× for a duration — a real cell recipe
  in the cauldron, per the brewing pillar.
- **Mole's Knees** (boon/perk, joins swiftfoot/featherweight): crawl speed ×1.5
  and crawl step-up 3.

## Level design + worldgen rules

1. **Progression: standing gauge, always** (rule zero — validator unchanged).
2. **Crawl pockets pass** (new, forked-RNG, post-structures): per-biome budget of
   2–4 deliberate crawl runs — tunnels carved at radius 5–6 (11–13 diameter:
   crawlable, not standable) connecting a treasure pocket (heart/tome/gold seam)
   back to the main network. Placement respects the `PlacementLedger`.
3. **Crawl tunnels must be back-traversable:** no vertical drop > 2 cells inside
   crawl-gauge space (you could slide down and be unable to climb back at
   step-up 2). Generation constraint: gentle monotone slopes, risers ≤ 2.
4. **Mouths must read as mouths.** A crawl entrance is a low wide slot with worn
   edges, drag marks in the floor colors, and a faint draft of dust particles —
   the player learns the silhouette once and forever. The onboarding area gets
   one obvious slot with a visible heart behind it (teach by greed).
5. **Validator gains a third tier:** `crawlMask` (9×9 erosion + same rubble rule,
   4-adjacent BFS from the spawn component). Hearts/tomes upgrade from "buried
   treasure" (dig-only, info) to "crawl-reachable" (info, distinct minimap dot) —
   nothing moves to error severity. CI: the crawl-pockets pass asserts each
   placed pocket is crawl-connected on every audit seed.

## Feel (FEEL.md material on ship)

- **Enter:** 3–4 frame squash (`crawlT` 0→10 like `crouchT`), dust puff at hands
  and knees, hat bobs hard.
- **Loop:** hand-over-hand cycle keyed to actual x-progress; pebble flecks at the
  hands every few steps; soft cloth-shuffle loop; when the ceiling is exactly at
  gauge (solid at y−9), occasional hat-scrape with falling grit.
- **Cramped:** hat pressed flat, periodic ceiling bump (above).
- **Stand:** reverse squash overshoot, hat flips and settles, shake-off dust.
- **Camera:** mild forward bias while crawling — lead 12–16 cells toward facing
  (you want to see down the tunnel), instead of the crouch's downward peek.
- **Sprite tilt:** crawl pose rotates to the smoothed movement angle (quantized
  ~16 steps) so diagonal chutes read as diagonal crawling; collision unaffected.

## Edge-case ledger

- **Door closes on a crawler:** same crush handling as standing (verify at
  implementation; fail-open says the door's gate logic must not require the
  body to leave first).
- **Tunnel seals behind you** (sand pours in): dig out with the wand — digging
  is always the bypass, per fail-open. Rubble (<5 cells) passes anyway.
- **Teleports/waystones while crawling:** arrivals are standing-safe by the
  24-headroom convention → auto-stand on arrival.
- **Knockback in a tunnel:** velocity clamps as usual; the box never changes
  mid-flight, no special case.
- **Level transitions:** stance is transient combat state — cleared by
  `Levels.enterLevel` like the rest; spawn chambers guarantee standing headroom.

## Implementation map (when approved)

- `entities/Player.ts` — `player.crawling` + `crawlT`; a `bodyH()` (17|9) helper
  threaded through every hardcoded `4, 17`: the four `tryMoveEntity` calls, the
  status sample, the hazard/liquid loop, grounded probe; stance machine + stand
  probe; stanceK 0.32; jump/levitate gate.
- `entities/physics.ts` — no changes (already parameterized).
- `render/sprites/PlayerSprite.ts` — crawl pose + tilt; `render/Camera.ts` —
  forward bias; HUD cramped glyph (events outward).
- `world/validate.ts` — `crawlMask`; `world/CaveGenerator.ts` — crawl-pockets
  pass (forked rng, ledger-aware); GEN_VERSION bump (deliberate change).
- Audio: shuffle loop + bump thud in the procedural audio API.
- Probes: headless crawl-through probe (carve a 9-tall slab corridor, drive keys,
  assert traversal + auto-stand), plus the crawlMask findability extension.

## Open questions for Frank

1. Speed feel: 0.32× is a guess pending playtest — too punishing for 40+ cell
   tunnels? (The Limber Draught is the designed answer; confirm.)
2. Should enemies path into crawl space? Proposal: no for v1 (slimes/critters
   excepted — they're already small), so crawl space is also *sanctuary*. That's
   a strong identity: the tight dark is yours.
3. Minimap: distinct color for crawl-gauge space, or keep it reading as open?
4. Does the crawl-pockets pass ship with the mechanic (one commit) or as a
   follow-up once the verb feels right? Proposal: follow-up — verb first.
