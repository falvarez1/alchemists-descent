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

**Build mode** — paint materials, generate biomes, drop enemies, tune every
parameter live in the right panel. WASD pans the camera.

**Play mode** (TAB or the PLAY button):
- `A`/`D` move, `SPACE` jump / levitate (coyote time + jump buffering included)
- Mouse aims and fires the selected spell; `1`-`7` switch spells
- `E` siphon materials into your flask, `Q` pour, `F` throw the bottle
- `R` rise again when dead, `F3` perf overlay

## Architecture

See `ARCHITECTURE.md` (module map, frame-order contract, design decisions),
`docs/INVENTORY.md` (system map of the original file), `docs/PORTING.md`
(porting conventions + approved deviations), `docs/DESIGN.md` (expansion design).
