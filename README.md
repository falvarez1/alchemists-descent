# Noita Studio — Alchemist's Descent

A falling-sand action roguelite: a fully simulated cellular-automata world (21+
materials with real interactions), a Three.js pixel renderer with dynamic 2D
lighting and bloom, procedural audio, and a platformer-wizard action game on top.

Originally a single 3,818-line HTML file (kept as `noita-sandbox.html` for
reference), now a modular TypeScript + Vite project evolving toward a full indie
game — see `docs/DESIGN.md` for the expansion roadmap.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

| Script | What |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | typecheck + production build to `dist/` |
| `npm test` | vitest (worldgen determinism, ...) |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `node scripts/verify-game.mjs` | headless browser smoke test (needs dev server + Edge) |

## Controls

**Sandbox mode** — the current Build mode, renamed for clarity: paint materials
into the live simulation, generate biomes, drop quick test enemies, cast test
spells, and tune parameters live in the right panel. WASD pans the camera.

**Builder** — planned as a separate developer tool for authored levels: place and
edit terrain, enemies, pickups, mechanisms, links, lights, procedural passes, and
validation data. See `docs/BUILDER.md`.

**Play mode** (TAB or the PLAY button) — descend through the persistent biome
stack. Find the sealed well in each floor, break the stone plug, and drop deeper.
Light waystone braziers with real fire to set your respawn; death keeps the world
exactly as you scarred it and costs 15% of your gold.
- `A`/`D` move, `SPACE` jump / levitate (coyote time + jump buffering included)
- Mouse aims and fires your **wand** — a frame slotted with spell cards
  (multicasts, modifiers, impact triggers, the flask-fed Infuser); earn cards by
  lighting waystones, descending, and brewing
- `1`/`2` or mouse wheel switch wands, `B` opens the wand bench
- `E` siphon materials into your flask, `Q` pour, `F` throw the bottle, `X` drink
  (brew elixirs at cauldrons: real reagents in the bowl + real fire against it)
- `M` fog-of-war map, `R` rise again when dead, `F3` perf overlay

## Architecture

See `ARCHITECTURE.md` (module map, frame-order contract, design decisions),
`docs/INVENTORY.md` (system map of the original file), `docs/PORTING.md`
(porting conventions + approved deviations), `docs/DESIGN.md` (expansion design),
and `docs/BUILDER.md` (planned Sandbox/Builder split and authoring tool spec).
