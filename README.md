# Breathing Works — An Alchemist’s Descent

*Something is alive in the old refinery. Listen. Experiment. Find your way down.*

A free, browser-based falling-sand action roguelite set inside a living alchemical refinery. Cross
wet masonry and corroded machinery, manipulate real materials, distract wildlife,
and descend through a persistent campaign. TypeScript, Vite, Three.js and Web Audio
power the game; material IDs remain append-only save contracts.

Originally a single 3,818-line HTML file (kept as `noita-sandbox.html` for
reference), now a modular TypeScript + Vite project evolving toward a full indie
game. See `docs/DESIGN.md` for the current game contract and
`docs/living-descent-implementation.md` for overhaul validation and remaining gates.

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
| `npm run lint` | ESLint over `src/`, `tests/`, scripts, and Vite config |
| `npm run verify:runtime` | headless browser runtime/UI probe suite (spawns Vite + needs Edge) |
| `node scripts/verify-game.mjs` | focused headless browser smoke test (needs dev server + Edge) |

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

**Expedition** — choose Begin or Continue. Find the brass bell in the Breathing
Works and carry it to the lower gate; deeper floors use keyed portals. Rest at
the warm refuge to refill health and glowseeds. Other waystones require real fire.
You carry three **return phials**. A death spends one and returns you to your last
checkpoint with the world intact; the gold you were carrying spills where you fell,
guarded by whatever killed you. A rest at the warm refuge, or a Sanctum, pours one
back (never past three). Die with none left and the run ends at its ledger, from
which you can descend again.

Below each of the first three floors a **Sanctum** offers one of three boons, and
where the stair forks, a door — chosen together. The boons run from plain stats
(Power Surge) to the alchemist's bargains that change how the world is met: *Rime
Soles* skins the water you cross with ice, *Sexton's Grip* halves what lifting the
fallen costs, *Long Fuse* stretches an alchemical chain, and there are wards for
current and for cold. The draft is seeded by the run and the floor, and only offers
a ward the floors below can use (`docs/BOONS.md`). Your boons are listed in the
pause menu and named on the run's ledger and share line. **Difficulty** runs
Apprentice, Adept, Conjurer, Archmage: Adept is where every descent begins,
Apprentice is always open, and quieting the Kiln opens the next tier up; today's
descent is always Adept, so it is one seed at one difficulty for everyone
(`docs/DIFFICULTY.md`).

- `A`/`D` move, `SPACE` jump / levitate (coyote time + jump buffering included)
- `S` crouches, crawls with movement, or dives in air; `Shift`/`C` grabs walls
  and `W`/`S` climbs while grabbed
- Mouse aims and fires your **wand** — a frame slotted with spell cards
  (multicasts, modifiers, impact triggers, the flask-fed Infuser); earn cards by
  lighting waystones, descending, and brewing
- `1`/`2` or mouse wheel switch wands, `B` opens the wand bench
- `E` takes the story's beat (Pell, a resonant valve, a page), else lifts
  (telekinesis) the body or crate under the cursor and sets it down again, else
  pulls a lever in reach, else siphons a flask;
  `Q` pour, right click throw a flask, `X` drink, `3`–`6` select a flask,
  `F` kick, `G` carry, `V` throw a glowseed, `L` the hooded lantern
  (brew elixirs at cauldrons: real reagents in the bowl + real fire against it)
- `M` fog-of-war map, `R` rise again when dead, `P` save a clip of the last
  seconds, `N` mute, `F3` perf overlay
- Escape pauses; Controls & comfort provides remapping, text size, flash and
  shake controls, high-readability lighting, and creature sound captions.

Standard controller: left stick moves, right stick aims, A jumps, B crouches,
RT casts, LT pours, RB throws a flask, LB throws a glowseed, X interacts, Y changes
wands, and Start pauses. D-pad/A/B operate menus.

In development, the entry screen also opens Sandbox and Builder. Backquote opens
the Developer Console. Use `run new --seed 777`, `run continue`, `run save`, and
`run status` for normal lifecycle work; `run test --level d4 --world campaign-level
--seed 777 --loadout fresh` creates a disposable test. Debug-modified runs do not
autosave. Avoid direct game-context or browser-storage mutation for lifecycle setup.

## Screenshots

Local test screenshots are archived by run under `screenshots/living-descent/`.
Open `screenshots/living-descent/index.html` to browse them. The entire
`screenshots/` directory is ignored by Git.

## Architecture

See `ARCHITECTURE.md` (module map, frame-order contract, design decisions),
`docs/FEEL.md` (every mechanic, micro-animation, and game-feel rule with its
tuning numbers), `docs/INVENTORY.md` (system map of the original file),
`docs/PORTING.md` (porting conventions + approved deviations), `docs/DESIGN.md`
(expansion design), and `docs/BUILDER.md` (the Sandbox/Builder split and
authoring tool spec).
