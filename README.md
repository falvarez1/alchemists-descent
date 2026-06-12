# Purple Llama Studio — Alchemist's Descent

A falling-sand action roguelite: a fully simulated cellular-automata world (35
append-only materials with real interactions), a Three.js pixel renderer with
dynamic 2D lighting, bloom, and tunable post-processing, procedural audio, and a
platformer-wizard action game on top.

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
spells, stamp a real-cell fortress, and tune parameters live in the right panel.
The toolbar includes potions/elixirs, the remapped `alchemists-descent` materials
(Toxic Sludge, Healium, Teleportium, Snow, Coal, Crystal, Fungus, Glass, Ash,
Glowshroom), and all 15 tactical spells from the reference file. WASD pans the
camera. The right panel exposes Post FX toggles/sliders for bloom, exposure,
lens aberration, film grain, and hurt pulse.

**Builder** — the level-authoring tool (BUILDER button in the header): terrain
shape tools (paint/line/rect/ellipse/flood fill/replace) plus a hold-to-settle
preview that runs real physics only while the SETTLE button is held, then offers
KEEP/REVERT, gameplay objects with multi-select /
duplicate / param copy-paste, mechanisms wired with a link tool (door logic:
AND / OR / SEQUENCE), authored lights with live in-editor preview and presets,
a reusable stamp library, seeded procedural passes with preview/apply/discard,
wheel zoom + clickable minimap, readability overlays, shareable level codes,
and a fixpoint-findability validation pass — then PLAYTEST (or T, from the
cursor) compiles the document into a disposable custom level. See
`docs/BUILDER.md`.

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
- ``` ` ``` enables transient QA god mode in Play: upgraded wands, every spell
  card, all Sanctum powers, stocked potion pickups, and bench potion/elixir test
  controls. Debug-modified runs are not autosaved.

The backquote key is reserved as the future debug console entry point, in the
style of Minecraft/Quake command consoles.

## Architecture

See `ARCHITECTURE.md` (module map, frame-order contract, design decisions),
`docs/FEEL.md` (every mechanic, micro-animation, and game-feel rule with its
tuning numbers), `docs/INVENTORY.md` (system map of the original file),
`docs/PORTING.md` (porting conventions + approved deviations), `docs/DESIGN.md`
(expansion design), and `docs/BUILDER.md` (the Sandbox/Builder split and
authoring tool spec).
