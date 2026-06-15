# Wand Mechanics And Progression Clarity Plan

Status: proposal, not implemented.
Date: 2026-06-15.
Scope: play-mode wand readability, first-run teaching, spell-card rewards, and the first small modifier/content slice. Builder authoring support is out of scope except where validation probes need test fixtures.

## Problem

The current game has a real wand system, but the player-facing surface makes it feel clunky and opaque. The compiler already supports deterministic Noita-like spell sentences: modifiers attach to the next projectile, multicasts group following projectiles, trigger folds the next group into an impact payload, and the HUD highlights the next cast slots. The player mostly sees tiny icons, mana numbers, hover-only titles, random card grants, and one dense handbook paragraph.

The goal is to make the existing rules obvious before adding many more cards.

## Current Evidence

- `src/combat/wands/compiler.ts` owns the deterministic grammar: modifiers attach to the next projectile, `double`/`triple` group projectiles, `trigger` captures the following group, damage clamps at x4, and groups cap at six actions.
- `src/combat/wands/cards.ts` currently exposes the compact live modifier set: `speed`, `heavy`, `spread`, `infuser`, `bounce`, `trigger`, `double`, and `triple`.
- `src/combat/wands/WandSystem.ts` starts the player with Oak/Spark and Bone/Dig plus spare `double` and `speed`, then grants random cards from waystones, new depths, recipes, tomes, and shops.
- `src/ui/WandBench.ts` renders card icons and frame stats, but card meaning is primarily in `title` attributes. It does not show the compiled result of a wand before the player tests it.
- `src/ui/Hud.ts` marks next cast slots with `next-cast`, but it does not say what the next cast will do in words.
- `src/ui/Sanctum.ts` sells `Lost Pages` as a random unknown card and frame upgrades as gold sinks.
- `src/world/structures.ts` places tome pickups from a broad `TOME_POOL`, so reward pacing can hand players advanced tools before they understand the basic grammar.
- `docs/DESIGN.md` already mandates D1 authored teaching moments and says every spell card ever found should eventually feed future starting-shop breadth.
- `docs/SPELL-POTION-MODIFIER-EXPANSION-PLAN.md` is still proposal-only and identifies the right long-term content direction: trail, status, crit, homing, and path modifiers.

## Design Principles

1. Explain the existing grammar first.
2. Every new mechanic must read or write real cells.
3. Reward choice beats random noise for learning.
4. Progression should add expressive breadth, not raw permanent power.
5. The first content slice should prove visible material combos, not add a large card list.
6. The player should see why a spell worked from the world state, card sentence, projectile behavior, and impact feedback.

## Non-Goals

- Do not replace the deterministic left-to-right compiler.
- Do not add a separate Noita wand shuffle model.
- Do not add new input verbs.
- Do not add new cell IDs for the first clarity/content pass.
- Do not make the bench a full Builder tool.
- Do not implement the whole spell/potion/modifier expansion plan in one milestone.

## Phase 1: Wand Sentence UI

Objective: make every wand describe what the next click will cast.

Implementation tasks:

- Add a read-only wand program view model built from `compileWand(cards)`.
- Keep the compiler pure. The UI helper should translate `CastGroup` data into player-facing text without changing gameplay state.
- In `WandBench`, render a compact preview under each wand:
  - `Next: Swift Spark Bolt - 14 mana`
  - `Then: Excavate Ray - 2 mana`
  - `Trigger: Spark Bolt -> Bomb at impact`
- Show warnings for confusing decks:
  - trailing modifier with no projectile
  - trigger with no payload
  - multicast with too few projectiles
  - group mana above current mana tank
- When a card is hovered, focused, dragged, or held:
  - if it is a modifier, highlight the projectile slot it will modify
  - if it is a multicast, bracket the projectiles it will group
  - if it is a trigger, bracket host and payload groups
- In the HUD, add a small readable next-cast caption beside or below the active wand row.
- Replace hover-only card learning with visible card names on focus/selection and an inspect panel inside the bench.

Acceptance criteria:

- A new player can open the bench and understand what the active wand will cast without firing it.
- No existing cast output changes.
- Empty, malformed, trigger, multicast, and modifier-only decks all render honest previews.
- The HUD still fits at desktop and mobile-ish verification viewports.

Validation:

- Add focused unit tests for the sentence view helper using existing compiler cases from `tests/wands.test.ts`.
- Add a browser probe such as `scripts/verify-wand-sentence-ui.mjs` that opens a review-kit bench and asserts preview text for a trigger/multicast deck.
- Run `npm run typecheck` and the targeted wand tests.

## Phase 2: D1 Spell Lab And First-Run Teaching

Objective: teach "materials are verbs" and "cards are sentences" in the first few minutes.

Implementation tasks:

- Add a guaranteed D1 teaching alcove near spawn or the first Refuge. It must be reachable by the findability audit.
- Build the alcove from real cells and existing mechanisms. Avoid scripted tutorials.
- Include four tiny stations:
  - dig a sand or soft-stone plug with `Excavate Ray`
  - burn a wood seal with fire
  - spark a charge coil or rune target with a bolt
  - pour or find water near a heat hazard so the player sees material prep
- Place a safe tome reward after the stations.
- Make the reward a choice-of-3 if Phase 3 is ready; otherwise pick a safe teaching card such as `heavy`, `spread`, or `flame`.
- Add local toasts/objective nudges only when the player reaches the alcove or collects the first extra card.
- Add a minimap marker for the Refuge or teaching alcove once discovered.

Acceptance criteria:

- D1 teaches at least one terrain verb, one combat verb, and one wand-order verb before the first deep random card reward.
- Every station is solvable with the starter kit.
- Breaking, burning, flooding, or bypassing station pieces cannot hard-lock progression.
- The teaching alcove does not replace free exploration; impatient players can leave.

Validation:

- Extend findability checks so the D1 teaching alcove reward is reachable.
- Add a browser probe that starts a fresh run, teleports through the stations if needed, and verifies the reward and toasts appear.
- Run `npm run verify:findability` after placement changes.

## Phase 3: Choice-Based Card Progression

Objective: turn random card income into learnable build decisions.

Implementation tasks:

- Introduce a reusable card-offer modal or overlay that can show three cards with names, tags, mana costs, and one-line effects.
- Replace broad random grants gradually:
  - tome pickups become choice-of-3 from a themed pool
  - waystones offer mostly modifier/setup choices
  - new-depth rewards offer biome-relevant projectile/setup choices
  - `Lost Pages` in the Sanctum becomes a choice of three unknown cards instead of one random unknown card
- Split `TOME_POOL`, `MOD_POOL`, and `PROJ_POOL` into staged pools:
  - Starter grammar: `speed`, `heavy`, `spread`, `double`, `flame`
  - Terrain verbs: `dig`, `conjure`, `vitriol`, `frostshard`
  - Combo setup: trail/status/crit cards once implemented
  - High-risk late tools: `meteor`, `blackhole`, `trigger`, `vitrify`
- Add card tags in card metadata:
  - `Damage`
  - `Terrain`
  - `Setup`
  - `Trail`
  - `Status`
  - `Combo`
  - `Movement`
  - `Risk`
- Track discovered cards in a versioned localStorage schema, separate from the expedition save.
- Use discovered cards to seed a future starting shop pool or optional starting-kit offers. Keep raw power run-local.

Acceptance criteria:

- The player gets intentional choices at major reward points.
- Early rewards cannot produce a pile of advanced cards before the player has seen the basic wand sentence.
- Normal progression remains fresh on each expedition except for breadth unlocks.
- Test runs and review kits can still inject all cards directly.

Validation:

- Unit-test offer generation for staged pools, duplicate prevention, fallback behavior, and persistence migration.
- Browser-test a fresh D1 tome and a Sanctum `Lost Pages` purchase.
- Verify localStorage failure degrades gracefully.

## Phase 4: First Modifier Content Slice

Objective: add the smallest set of new cards that makes room prep and spell sentences feel worth learning.

Prerequisite: Phase 1 should land first so new complexity is visible.

Recommended cards:

- `watertrail`: fixed trail, deposits small water cells on cadence with a strict budget.
- `sparkcharge` or `electriccharge`: status/terrain charge modifier that makes wet rooms tactical.
- `critwet`: conditional crit when the target is wet or touching water.
- `oiltrail` or `oilcharge`: fire setup for visible delayed-combo play.
- `shorthoming`: cheap correction for moving enemies, not a fire-and-forget solver.

Implementation approach:

- Build on the existing expansion plan's `ProjectileModState` idea rather than adding another pile of one-off `WeakMap`s.
- Keep fixed trail cards low-economy and budgeted.
- Keep high-value material trails flask-fed through `Infuser` or later rare variants.
- Make every modifier visible before impact:
  - trails leave real cells
  - status cards add projectile motes
  - crits emit a distinct hit flash
  - homing has a subtle steering glint
- Add cards to review/test pools first. Add to live pools only after probes pass.

Acceptance criteria:

- `Water Trail + Critical on Wet + Spark` visibly outperforms dry `Spark`.
- `Water Trail + Electric Charge` creates readable wet/electric interactions.
- `Oil Wick + fire` creates a readable fuse without a screen-wide fire problem.
- Homing retargeting runs on cadence and remains collision-honest.
- No new card can mint gold, catalyst, or rare elixirs from mana alone.

Validation:

- Extend `tests/wands.test.ts` for new compiler fields and card metadata.
- Add projectile tests for modifier state application and budget limits.
- Add `scripts/verify-modifier-cards.mjs` with forced arenas for wet crit, electric wet, oil/fire, and homing.
- Run `npm run typecheck`, targeted Vitest, `npm run build`, and browser probes.

## Phase 5: Bench Organization And Build Recipes

Objective: make the growing card list navigable.

Implementation tasks:

- Group bench collection by tags or add a compact segmented filter:
  - All
  - Projectiles
  - Modifiers
  - Multicast
  - Setup
  - Terrain
- Add simple "recipe hints" in the card inspect panel:
  - `Water Trail` pairs with `Critical on Wet` and electric effects
  - `Oil Wick` pairs with fire
  - `Trigger` wants a payload group after the host projectile
- Add optional review-only starter loadouts for testing teaching builds:
  - Wet Crit Primer: `watertrail`, `critwet`, `spark`
  - Fuse Primer: `oiltrail`, `flame`
  - Trigger Primer: `trigger`, `spark`, `bomb`
- Keep recipe hints descriptive, not prescriptive. The player should still experiment.

Acceptance criteria:

- A full review kit is browsable without reading every hover tooltip.
- Card tags match actual mechanics.
- Recipe hints never claim a combo that the sim does not actually support.

Validation:

- Unit-test card metadata completeness.
- Browser-test bench filters and inspect panel text.

## Phase 6: Refuge, Map, And Objective Clarity

Objective: reduce confusion about where editing and progression happen.

Implementation tasks:

- Add a discovered Refuge marker to the minimap.
- Improve the `WAND BENCH WAITS IN THE REFUGE` toast with a direction or map ping when possible.
- In the objective row, show short contextual goals:
  - `FIND THE GOLDEN KEY`
  - `RETURN TO THE PORTAL`
  - `BENCH AVAILABLE IN REFUGE`
  - `LIGHT WAYSTONE: BRING FIRE`
- Consider pausing or slow-pausing while the bench is open only after playtesting. The current "caves do not wait" rule may be flavorful, but it increases learning pressure.

Acceptance criteria:

- A player who gets a new card knows where to slot it.
- The Refuge is findable once discovered.
- The bench remains unavailable away from the Refuge unless debug/test mode is active.

Validation:

- Browser-test card pickup -> banner -> map/refuge cue.
- Verify minimap markers at desktop and mobile-ish viewports.

## Recommended Delivery Order

1. Phase 1: Wand sentence UI.
2. Phase 3 minimal: choice-of-3 for tomes and Sanctum `Lost Pages`.
3. Phase 2: D1 spell lab.
4. Phase 6 minimal: Refuge minimap marker and better bench cue.
5. Phase 4: five-card modifier slice, review-only first.
6. Phase 5: tags, filters, and recipe hints as the card list grows.

This order fixes comprehension first, then reward pacing, then new complexity.

## Validation Gate For Each Implementation PR

- `npm run typecheck`
- targeted Vitest for changed systems
- `npm run verify:findability` for any generated or authored placement
- browser probe for any player-facing UI or gameplay mechanic
- screenshot review for bench/HUD text fit at 1500x900 and a narrower viewport
- `npm run build` before merge

## Open Decisions

- Should the starter collection be changed from `double + speed` to a single easier modifier such as `speed`, with `double` moved into the first teaching reward?
- Should the bench pause the game, slow time, or keep the current live-risk rule?
- Should discovered-card persistence ship before or after choice-of-3 rewards?
- Should `Water Trail` be fixed, flask-fed, or both through separate cards?
- Should `Lost Pages` always avoid duplicates, or sometimes offer duplicate cards as sell/scrap value once a card economy exists?

## First Implementation Slice

Recommended first slice:

1. Add the wand sentence view helper.
2. Render bench previews and malformed-deck warnings.
3. Add HUD next-cast text.
4. Add hover/focus modifier-target highlighting.
5. Add unit tests and one browser probe.

This gives immediate clarity without touching balance, world generation, save format, or the current card pool.
