# Fighters

Ten playable fighters from the design document (`alchemists_descent_fighter_roster.html`, kept with its
concept sheets under `public/assets/fighters/`). A fighter is **who you descend as**: a look, a passive, a
tactical ability on **Z** and an ultimate on **T**. Weapons still come from the kit and from loot, so a
fighter and a starting kit are independent choices.

**Status: in progress.** This file is the contract the code is built against; the "Status" column of the
tables below is updated as each piece lands and is probed in the real game.

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

**Ultimate charge** is 0..1. It fills from damage dealt (0.4% per point), damage taken (0.25% per point), kills
(+4%) and a slow trickle (+1% per 10 s), and is spent whole by the ultimate. Charge is saved with the run.

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

(Per-ability behaviour, tuning and probe results are filled in below as each fighter lands.)

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
