# Reactive World & Grimoire — Implementation Plan

Four additive features that deepen the falling-sand → combat → roguelite loop by
making the simulation *act on* entities, *react to* the player, *remember* what
was done to it, and *teach* its own rules. Each builds on systems that already
exist — none is a rebuild.

> A fifth idea (a unified **temperature field** with heat diffusion) was
> considered and **deferred**: a per-cell heat plane with a diffusion pass is the
> right design but the per-frame cost is too high for now. Revisit behind a flag
> on one biome if the budget allows.

**Pillars these respect** (CLAUDE.md / DESIGN.md):
- *If the grid can't explain it, it doesn't ship* — every effect reads/writes real cells or the `charge`/`status` planes.
- *Fail-open* — reactive AI and persistence may never hard-lock progression.
- *Feel beats features* — every mechanic gets visible + audible feedback.
- *Light is information* — emissive = important; discoveries are lit/announced.

Suggested order: **#1 → #3 → #2 → #5** (#5 logic now, book UI when the art lands).

---

## #1 — Electrified conductors shock entities

**Status: ~70% already implemented.** `sampleAndTickStatus` (`src/entities/status.ts`)
already samples `world.charge` in the cells touching a body, raises the
`electrified` timer (`charged >= 1 → electrified = 45`), and returns DoT that
**wet amplifies** (`0.3/frame` wet vs `0.08/frame` dry). It is already called for
**every enemy** (`Enemies.ts:724`, gated by `STATUS_IMMUNE[kind]`) and the
**player** (`Player.ts:1124`), with the returned `damage` applied by each caller.
So charged water already shocks both — it just doesn't *read* as a mechanic.

This is mostly **amplify + feel**, not new systems.

### Goal
Standing in / being knocked into a charged conductor (water, metal, lava) is a
real, readable threat and a deliberate tactic ("electrify the puddle the slimes
are standing in"), with **visible electrical discharge crackling around any
shocked body** — enemy or player.

### Touchpoints
- `src/entities/status.ts` — `sampleAndTickStatus` (the `electrified` transition, the DoT return, the existing edge-particle effect at the `st.electrified > 0` block).
- `src/core/types.ts` — `GlobalParams` (add the tunable below), `EntityStatus`.
- `src/config/params.ts` — `GLOBAL_PARAMS` default + `GLOBAL_PARAM_DEFAULTS`.
- `src/combat/Lightning.ts` — reuse `arcs` + the `jaggedArc` helper for the body discharge.
- `src/entities/Enemies.ts` — `gustShove` / `tickKnock` for the zap knock; `ctx.audio` for the crackle.

### Implementation
1. **Tune the DoT into a real threat.** The shipped `0.08 / 0.3` is barely
   perceptible. Add `global.shockDamage` (dry) — wet stays a multiple — as a
   live-tunable param (console `set global.shockDamage`, Builder ELECTRICAL
   slider, like `chargeFalloff`/`chargeDecay`). Scale the `electrified` DoT by it.
2. **Rising-edge zap.** Track the 0→active transition of `electrified` (compare
   prior timer). On the rising edge: a one-time larger hit + a short **stun /
   knock** (`gustShove` for enemies; a brief control-lock + `playerCtl.damage`
   knock for the player) + a crackle SFX. That's the "got zapped" punch versus
   the slow background DoT.
3. **Per-entity electrical discharge (requested).** While `electrified > 0`,
   emit short jagged arcs *anchored on the body's perimeter* so you see lightning
   crawling over the shocked thing — not just the existing spark particles. Reuse
   `jaggedArc` from `Lightning.ts`: each frame (throttled, e.g. 1–2 arcs while
   electrified), pick two random points on the body's AABB edge and push a
   short, dim, short-life arc into `ctx.lightning.arcs` (the renderer + lighting
   already consume that list, so the discharge also *glows*). Centralize as a
   helper (`ctx.lightning.bodyArc(x, y, halfW, h)` or emit from `status.ts`
   directly via `ctx.lightning`). Applies uniformly to player and every enemy
   because it lives in the shared status tick.
4. **Wet is the combo.** Already amplifies DoT — surface it: a wet/submerged
   enemy struck by lightning is the intended one-shot. (`critwet` already exists
   in the wand system as precedent for "wet = vulnerable".)

### Feel / feedback
- Body-perimeter arcs (above) + the existing cyan edge particles.
- Crackle SFX on the rising edge; a heavier *crack* on a wet kill.
- The ambient branching arcs over the charged pool (already shipped) tie the
  area effect and the per-body effect together visually.

### Risks
- Low. Main caution: don't let player shock DoT feel unfair — gate the rising-edge
  stun so repeated re-trigger can't lock the player (cooldown on the stun, DoT
  still ticks). Keep `STATUS_IMMUNE` honest (wisp/charged enemies shouldn't shock).

### Smallest shippable slice
Bump the DoT (tunable) + add the body-perimeter discharge arcs in the
`st.electrified > 0` block of `sampleAndTickStatus`. The rising-edge stun/SFX is
a fast follow.

### Verification
- Probe: paint charged water around an in-camera enemy (Cell ids: Water=2,
  Metal=13), tick, assert enemy `hp` drops and `status.electrified > 0`; repeat
  with the enemy `wet` and assert faster death. Capture `ctx.lightning.arcs`
  length > 0 anchored near the body. **Capture `ctx.world` AFTER any `run test`**
  (it swaps the World — the gotcha from the charge work).

---

## #2 — Enemies read the grid

**Leverage:** the walker AI in `Enemies.ts` already does patrol / chase / alert /
de-alert, and `Critters` already flees hot glow (`isHotGlow`). Enemies just don't
check what they're about to step *into*. The status system already feeds back
(`frozen` → `slowFactor`).

### Goal
The sandbox becomes an opponent in the encounter: walkers won't march into lava,
burning enemies panic, and material status visibly changes behavior.

### Touchpoints
- `src/entities/Enemies.ts` — the walker horizontal-move branches (the
  `e.vx += dir * accel` chase/patrol lines ~909–1029) and `STATUS_IMMUNE`.
- `src/sim/CellType.ts` — `blocksEntity`, hazard predicates.
- `src/entities/status.ts` — per-enemy `status` already ticked each update.

### Implementation
1. **Lethal-cell look-ahead.** Before committing a horizontal step, sample the
   foot cell one ahead in the move direction; if it's a *lethal* cell
   (`Fire`/`Lava`/deep `Acid`/`Toxic`) and the enemy isn't immune (`acidslime`
   already ignores acid), zero/reverse that frame's accel — recoil at the edge
   instead of walking in. Only lethal cells, not all hazards, to avoid jitter.
2. **Status-driven behavior** (cheap — status already ticked): burning enemies
   panic (random scatter accel + speed up), frozen already slow, wet enemies
   flinch from nearby `charge`. A couple of these sell "the world fights back."
3. **Reactive kind (later, flashier):** one enemy that manipulates terrain (a
   hydromancer that emits `Water` to douse your fire) using the `HazardEmitter`
   pattern.

### Feel / feedback
- A recoil hop + a wary animation beat at a hazard edge.
- Panic when burning (already sheds fire via status) reads as desperation.

### Risks
- **Medium** — pathing changes can make enemies look dumb (stuck recoiling at an
  edge). Mitigate: only recoil at the edge of a *lethal* cell; add a "if cornered
  / player is across the hazard, commit anyway" fallback so it never hard-stalls
  (fail-open). Keep the look-ahead O(1) (one cell), not a pathfind.

### Smallest shippable slice
Lethal-cell look-ahead recoil on the basic walker chase branch.

### Verification
- Probe: place a walker beside a lava strip with the player on the far side;
  assert it does not enter the lava (its `x` stays on the safe side over N ticks)
  but still pursues when there's a safe approach. Keep the subject in-camera
  (enemies outside camera±60 freeze).

---

## #3 — The descent remembers

**Leverage:** `LevelRuntime` (`types.ts:2076`) is a live per-level struct held in
memory across leave/return for the whole expedition (invariant #5), and
`Levels.enterLevel` (`src/game/Levels.ts`) is the transition hook. Worlds already
persist intact — we just don't *react* to how they were left. The `explored`
mask is already a 1:8 downsample scan we can piggyback.

### Goal
Destruction persists and *matters*: a torched biome is charred + darker on
return, a fire you started keeps spreading, a flood/drain stays — making
taming-vs-wrecking a real choice across the run.

### Touchpoints
- `src/core/types.ts` — `LevelRuntime` (add a small `scars` record).
- `src/game/Levels.ts` — `enterLevel` (capture-on-leave + react-on-return), the
  transient-clear path.
- `src/core/events.ts` — `toast` / `objectiveChanged` to telegraph it.

### Implementation
1. **Scar dossier** on `LevelRuntime`: cheap counters, not snapshots —
   `scars: { burnedCells, floodedCells, fireFrontActive, drainedWell }`.
2. **Capture on leave.** During the leave path (piggyback the `explored`
   downsample scan) tally fire / water / charred cells into `scars`.
3. **React on return** (`enterLevel` of a `visited` level): if `fireFrontActive`,
   re-seed a few embers ("it still smolders"); keep flood/drain (already in the
   persisted world); if heavily burned, drop the biome's `Glowshroom`/fungus
   light so it returns darker. Wire one or two to a shortcut or difficulty nudge.
4. **Telegraph.** A `toast` / objective line on return so the consequence is felt,
   not silent.

### Feel / feedback
- Returning to a smoldering, darker hollow; the minimap/ambience shifted.

### Risks
- **Low** mechanically. Caveat: `LevelRuntime` is **in-memory**, so scars survive
  within a run but **not across a save reload** until serialized. Ship in-memory
  first (saves are out of scope for now); add to the save schema later (bump the
  save/GEN version when it does).

### Smallest shippable slice
One scar — "fire exceeded N cells here" → re-seed embers + a toast on return.

### Verification
- Probe: enter a level, ignite a spreading fire, leave and re-enter; assert
  `scars.fireFrontActive` was set and embers/`Fire` cells exist near the old
  front on return.

---

## #5 — Examine lens + living Grimoire  *(book UI waits on art)*

**Leverage:** a **grimoire already exists** — `Brewing.ts` (`GRIMOIRE_KEY =
'noita-grimoire'` localStorage store, `recipeDiscovered` event), surfaced by
`Hud.ts:129`. Plus the new `CellInspector` (`src/ui/CellInspector.ts`) and the
`toast` system. We extend discovery from *recipes* to *material interactions* and
add the book overlay. **Art dependency:** the user is providing a Grimoire image
as a **PNG with alpha**; the book UI maps onto it.

### Goal
Aim/examine a material to read it; the first time you witness an interaction
(acid eats stone, water quenches fire, charge conducts), it logs a Grimoire entry
— turning "light is information" into "knowledge is progression," teaching the
deep material rules without a tutorial wall.

### Touchpoints
- `src/ui/CellInspector.ts` — promote to a player-facing "Examine".
- `src/game/Brewing.ts` — generalize the grimoire store from `recipes` to
  `{ recipes, materials, interactions }`.
- `src/core/events.ts` — reuse/extend `recipeDiscovered`-style events (`toast`).
- New: an interaction catalog (data) + a first-sighting detector + the book overlay.

### Implementation
1. **Examine action.** Player-facing version of `CellInspector`: aim the wand /
   press a key over a cell to read it (reuse the readout, styled as a lens).
   Play-mode only.
2. **Interaction catalog** (data table): each entry = a trigger condition +
   grimoire copy. e.g. `acid+stone→gold` (already a real rule), `water quenches
   fire`, `charge conducts through metal`, `lava melts ice`, `nitrogen freezes`.
3. **First-sighting detector** (throttled, small neighborhood — *not* a full-grid
   scan): when a cataloged interaction occurs near the camera for the first time,
   write it to the grimoire store and fire a `toast` + a "new entry" ping. Keep it
   cheap (sample a few cells/frame, dedupe by entry id).
4. **Grimoire overlay UI (the art).** A key opens a book overlay rendered from the
   user's **PNG (alpha)** — left/right pages, list of discovered entries
   (undiscovered = silhouette / "???"), each with a material swatch + facts. Build
   the layout to the image's safe area.
   - **Needs from the artist:** the PNG, plus page/spine/corner coordinates (the
     text safe-areas for left + right pages) so entry content maps precisely.

### Feel / feedback
- "New Grimoire entry" toast + ping; the book opens with a page-turn.

### Risks
- **Low.** Keep the discovery scan cheap (throttle + small sample + dedupe).
  Book UI blocked only on the art + safe-area coordinates.

### Phasing
- **Now (art-independent):** #5.1–#5.3 — Examine action, interaction catalog,
  first-sighting logging surfaced via toasts + the grimoire store.
- **On art delivery:** #5.4 — the book overlay.

### Verification
- Probe: trigger a cataloged interaction in-camera (e.g. paint acid next to
  stone near water and tick); assert the grimoire store gained the entry once and
  a `toast` fired, and that re-triggering does not duplicate it.

---

## Cross-cutting notes
- **Tunables** (shock damage, scar thresholds) follow the established
  live-tuning pattern (`GLOBAL_PARAMS` + console `set` + Builder slider +
  `paramsChanged` re-sync) so they're adjustable without a rebuild.
- **Verification discipline** (per CLAUDE.md): `tsc` → `vitest` → `build`, then
  runtime-verify in-game via `window.__game.ctx`. Probe gotchas that bit us:
  capture `ctx.world` *after* `run test` (it swaps the World); keep probe
  subjects in-camera; the player is 17 cells tall (needs headroom).
- **Save/resume** is out of scope now; #3's scars and #5's grimoire persistence
  (localStorage) should be folded into the save schema when saves return.
