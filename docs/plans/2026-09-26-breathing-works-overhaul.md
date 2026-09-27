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
