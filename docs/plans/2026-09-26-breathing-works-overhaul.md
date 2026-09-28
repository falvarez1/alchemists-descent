# Breathing Works — the fun & polish overhaul

**Status: in progress on `feat/breathing-works` (2026-09-26).** Built on a verbatim
snapshot of the `feat/living-descent` working tree (commit `5a33e8d`).

## Why

A design review (automated playthrough of D1–D8 with real input, a content/wiring
inventory, and a read of every design doc) found a beautiful simulation wrapped in
a slow first act, a thin action layer and no reason to play a second run:

- **The opening is an errand, then a cutscene.** Crank visible at spawn but
  cold-locked → drop 13 ledges → pick Frost Shard from a 1-of-3 tome (skippable!) →
  climb back → freeze the cistern → ~41 s of engine with no control. ~2.5 min for an
  expert who knows the route.
- **Combat has no pressure and no payoff.** D1 foes move at 0.55×, six of them, a
  Weaver foraged beside the player, spark bolts are tiny, kills pay nothing. 16
  species built; the main descent uses 4.
- **Nothing is at stake.** Death respawns at a waystone with the world intact;
  discovered cards carry into new expeditions; victory wipes the save and reloads
  the page.
- **D1 and D2–D8 look like two games** (hand-built art direction vs legacy
  procedural caves, legacy objective copy, toast spam).

The user's direction: **free web game**; pain points **opening drags, combat is
thin, no pull deeper**; appetite for cuts **ruthless**.

## The spine

**A ~20-minute run through a living refinery. Four floors. Death costs you something.**

| Floor | id | Name | Biome | Signature | Bottom |
| --- | --- | --- | --- | --- | --- |
| 1 | `d1` | THE BELLOWS | earthen (hand-built Works) | water / steam / the breathing cycle | the Bell & Tea Engine and the Lower Bell gate |
| 2 | `d2` | THE ROT GARDENS | fungal | growth, spores, marsh gas that ignites | machine room set piece |
| 3 | `d3` | THE DROWNED CISTERNS | flooded | water + electricity | **Sunken Leviathan** |
| 4 | `d4` | THE KILN HEART | volcanic | lava, fire, steam, glass | **Kiln Colossus** (final) |

The refinery as an organism: bellows (lungs) → rot gardens (gut) → cisterns
(veins) → kiln (heart). The game is renamed **Breathing Works** (subtitle: *An
Alchemist's Descent*) — one constant in `src/config/brand.ts`. Save keys, package
name and storage prefixes are NOT renamed.

Tone: **dry Victorian-industrial wit** over grim. "Please mind the duck" is the house
style — understatement, brass, tea. Callouts, epitaphs and summary lines follow it.

### Stakes and meta

- **Return phials:** 3 per run. A death spends one and you return to your last
  checkpoint with the world intact (current behavior). The D1 refuge rest and every
  Sanctum restore one (max 3). Die with none left → the run ends → **Run Summary**.
- **Discovered cards feed the reward pool, not the starting hand.** A fresh run
  starts with its kit only.
- **Starting kits** (`KitId`): `spark` (default), `frost`, `ember`, `storm`, unlocked
  by milestones (reach floor 2, slay the Leviathan, win, …).
- **Daily descent:** a date-seeded run with the default kit; local best; a share line.
- **Instant restart:** summary → "Descend again" → playing in < 5 s, no page reload.
- Grimoire knowledge persists (unchanged).

## Workstreams and ownership

Each workstream runs in its own git worktree/branch off this commit and is merged
back by the integrator. **Own your files; keep edits to shared hot files small and
additive** (`core/types.ts`, `core/events.ts`, `ui/Hud.ts`, `game/Game.ts`,
`game/Levels.ts`, `styles/*.css`, `index.html`). Never reformat code you don't own.

| WS | Branch | Owns |
| --- | --- | --- |
| **A — Opening** | `bw/opening` | D1 layout (`world/breathingWorks.ts`, `world/teaMachine.ts`), `game/TeaMachine*.ts`, `game/LivingExpedition.ts`, D1 hints, camera floor clamp, Lower Bell gate visibility, waystone prompt copy/timing, D1 room toasts |
| **B — Run** | `bw/run` | `config/worldgraph.ts` `LEVELS` + boss keying, run lifecycle, phials, `game/RunDirector.ts` (new), meta profile (new), kits, daily seed, summary screen, victory flow, Sanctum teaser, entry screen (`ui/ExpeditionEntry.ts`, incl. brand + Workshop unlock), pause-menu run launcher removal in player builds, card-offer pool |
| **C — Combat** | `bw/combat` | `config/pacing.ts`, `entities/Enemies.ts` threat/perception tuning, kill attribution + `combat/AlchemyKills.ts` (new), callouts UI (new file), spark/projectile feel, `populationForLevel` fodder roster, Trickshot finisher defaults, player self-shock fairness |
| **D — Clips** | `bw/clip` | `app/Clips.ts` (new, rolling capture + GIF encode), clip hotkey binding, clip result UI, death-screen "Save the last seconds" button |
| **E — Look** | `bw/look` | floors 2–4 presentation (terrain treatment, per-floor grading/backdrop, dressing restraint), typography unification, HUD vitals/flask styling, toast coalescing, legacy objective copy on floors 2–4, gold pile art, minimap duplicate entries, level title card |
| **F — Sound & weight** | `bw/sound` | `audio/*` (mix buses, positional pan/attenuation, limiter, event stingers), volume sliders + Trickshot slider removal in `ui/PlayerSettings.ts`, font subset/WOFF2, Grimoire image WebP + lazy load, Sandbox lazy boot, dead-code and archived-subsystem removal, `index.html` title/meta, README |

### Shared contracts (already in this commit)

- `src/config/brand.ts` — `GAME_TITLE`, `GAME_SUBTITLE`, `GAME_TAGLINE`, `GAME_SLUG`.
- `src/core/run.ts` — `AlchemyCause`, `RunOutcome`, `KitId`, `RunSummary`, `AlchemyKillInfo`.
- `src/core/events.ts` — `alchemyKill` (C emits), `runEnded` (B emits),
  `phialsChanged` (B emits), `clipRequested` (anyone emits; D handles),
  `clipSaved` (D emits). **Events outward, calls inward:** audio (F) and callouts
  react to these events; nobody imports another workstream's class.

### Merge rules

- Worldgen changes bump `GEN_VERSION` and re-record goldens on your branch; the
  integrator sets the final version and re-records once after merging.
- Cell IDs stay append-only; `CELL_COUNT` stays 39 unless a workstream truly needs
  a new cell (avoid).
- New player-facing copy uses the house tone; no uppercase shouting except
  callouts and titles that were already uppercase by design.

## Acceptance (integrated build)

1. Title → playing in one click; the player causes a fire within ~10 s.
2. The Bell & Tea Engine is played, not watched: three faults, each fixed with a
   starting verb, the player keeps control throughout, and a fail-open backup exists.
3. A creature can kill you on floor 1; an alchemical kill shows a callout, pays out,
   and chains.
4. Dying costs a phial; losing the last ends the run with a summary; "Descend again"
   starts a fresh run in < 5 s; victory does the same with the victory line.
5. A fresh run does not start with previously discovered cards.
6. Floors 2–4 are visually distinct from each other and consistent with floor 1's
   art language; objectives read like floor 1's.
7. A clip of the last ~10 s saves as a GIF from a hotkey and from the death screen.
8. Volume sliders exist; sounds pan with position; nothing clips harshly.
9. `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `npm run lint`,
   `npm run verify:findability` pass; runtime probes pass in headless Edge.

## Wave 2 — a living, lit world (2026-09-27)

The owner asked for more creature quality, lush and fellable vegetation, more
interactivity and puzzles, more organisms, and light and shadow that are
mechanics ("dark caves where you only see the creatures' eyes or some glowing
phalanx until you shine the wand's light towards it").

| WS | Branch | Owns |
| --- | --- | --- |
| **L — Light** | `bw/light` | deep-dark zones and the sprite/terrain darkness model, eyeshine + glow markings for every creature kind, `ctx.lightQuery` (`LightQueryApi`), the hooded lantern (stealth), creature light responses in perception, light devices (photocells, lumen blooms) and light puzzles |
| **F — Flora** | `bw/flora` | lush vegetation per floor, trees/giant fungi with real-cell trunks that topple as rigid bodies and settle into log cells, canopies/leaves, seed pods (glowseed restock, growth seeds), felling/damming/growth puzzles |
| **N — Fauna** | `bw/fauna` | creature quality pass (behaviour, animation, reactions, the Colossus as a final boss), new ambient organisms (entity-based), visible predator–prey ecology |

Contracts:
- `LightQueryApi` (`ctx.lightQuery?`, in `core/types.ts`) — L implements it;
  F and N read it with optional chaining (`ctx.lightQuery?.wandLight(x, y) ?? 0`).
- **New cell ids:** only F may add cells, ids 39–41 (append-only; `CELL_COUNT`,
  marker palette ≥ 12 Manhattan, material palette, handlers, tests). L and N add none.
- Organisms with behaviour (snapjaws, glow-worms, puffers, fish, moths…) are N's;
  plants without behaviour (trees, fungi, ferns, grass, pods) are F's; light
  plants/devices (lumen blooms, photocells) are L's.
- Each new worldgen pass forks its own RNG stream; the integrator sets the final
  GEN_VERSION and re-records goldens after merging.
- Budget: each workstream adds ≤ ~1 ms/frame average CPU at 1600×900 on the dev
  machine, measured.

## Wave 3 — depth, story and more places (2026-09-27)

The owner asked for more biomes, scripted story beats in the spirit of Ori (Blind
Forest / Will of the Wisps), Dead Cells, Nine Sols and Hollow Knight, and scenes
with real depth (multiple parallax layers and artwork, as in Ori, Dead Cells,
Nine Sols).

### Story bible (shared by every wave-3 workstream)

- **The Works.** A vast alchemical refinery the Distillers' Guild built beneath a
  smoke-choked town to breathe its air clean. Over a century it came alive: its
  organs became habitats — the Bellows (lungs), the Rot Gardens (gut), the
  Drowned Cisterns (veins), the Kiln Heart (heart). The Guild sealed it and left
  when the Heart began to fail and the Works started to exhale poison ("the Long
  Exhale"). The town above has one more breath left.
- **You.** The Guild's last apprentice, sent down with the regulation kit to
  quiet the Kiln Heart before the next exhale. Silent protagonist.
- **The Docent** (narrator, voice "Daniel"). Master Aldous Wren, the Guild's
  old docent, who stayed behind to catalogue the Works' new life. Dry, fond,
  unhurried. He speaks to you from the Works' speaking-pipes. Late reveal
  (light touch): he never left — his voice is an echo the Works kept.
- **Pell** (recurring NPC, Hollow Knight's Quirrel/Cornifer register). A Guild
  surveyor who came down a year ago and stayed "to finish the map". Found on
  each floor at a camp; trades a hint, a map pin or a card; has a small arc
  across a run (worried → brave → gone ahead / waiting at the end).
- **The Old Ones** (the Sanctum). Guild workers who breathed the Works' air
  and became part of it: patient, half-fungal, polite traders.
- **The Kiln Colossus.** The Works' first stoker automaton, grown into the
  Heart's warden. Quieting it quiets the Heart; the Heart gives one last great
  heave (an escape), then the Works breathes easy — clean air rises to the town.
- **Tone.** Dry Victorian-industrial wit over wonder and melancholy (Ori's
  warmth, Hollow Knight's quiet, Nine Sols' weight) — never grimdark, never
  quippy. "Please mind the duck" is still the house style.

### New biomes (branching)

At each Sanctum the player chooses one of two doors (Dead Cells' biome graph):
floor 2 is **The Rot Gardens** (fungal) *or* **The Cold Store** (frozen: the
refrigeration wing — ice, snow, brine, freeze/shatter chemistry); floor 3 is
**The Drowned Cisterns** (flooded, Leviathan) *or* **The Glass Galleries**
(crystal: the lens-grinding halls — refraction, mirrors, light puzzles, a
signature guardian). Floor 4 is always **The Kiln Heart**. Run length is
unchanged; replayability rises.

### Workstreams

| WS | Branch | Owns |
| --- | --- | --- |
| **D — Depth & artwork** | `bw/depth` | multi-layer parallax per biome (far/mid/near background, foreground occluders), atmospheric perspective and haze, light shafts, depth particles, a per-biome layer-kit system |
| **B — Biomes** | `bw/biomes` | the Sanctum door choice and floor graph, The Cold Store and The Glass Galleries to floor-1-level quality (looks, flora, organisms, rosters, puzzles, a signature set piece/guardian, music and ambience) |
| **S — Story** | `bw/story` | the narrative spine, the Docent's speaking-pipes, Pell and the Old Ones as characters with dialogue, memory echoes, boss prologues, the Kiln escape sequence, the opening and ending beats, the Journal |

Contracts: layer kits are looked up by `BiomeId` with a generic fallback, so new
biomes render before D writes their kits (D adds kits for `frozen`/`crystal` after
B merges). Narrative text for new biomes (titles, epigraphs, Pell's lines) is B's
first draft and S's to polish. Cues and voice go through the existing ElevenLabs
pipeline (`docs/AUDIO.md`).

**S status (2026-09-27, `bw/story`): built and runtime-verified.** Script is data
in `src/content/story/` (every beat has `first`/`again`/`veteran` variants; meta in
localStorage `breathing-works-story`, per-run state in the expedition save). The
`StoryDirector` (`src/game/story/`) runs speaking-pipes (hand-placed on floor 1,
generated near arrivals/refuges below), Pell's camp and dialogue (`PellCamp`),
memory echoes (`EchoStage`), boss prologues, the Kiln escape (`KilnEscape` over
`world/kilnFlue.ts`, GEN_VERSION 55), and the opening/ending plates; Matron Ash
speaks in the Sanctum; the Grimoire has a Journal tab. Voices: Pell = ElevenLabs
"Stephen", Matron Ash = "Beatrice" + a chorus filter (`scripts/audio/cast-voices.mjs`
auditions and scores sibilance). Cues `escape` and `ending` joined the score.
Everything is keyed by biome, with first drafts already written (and voiced) for
B's `frozen` and `crystal` floors.
