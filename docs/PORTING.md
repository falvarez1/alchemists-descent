# Porting conventions — noita-sandbox.html → TypeScript modules

Read this WHOLE file before porting anything. The goal is a **behavior-identical port**:
every algorithm, probability, and magic number is preserved exactly. The only changes
are the structural ones listed here. When the original and these conventions seem to
conflict, preserve the original behavior and flag it in your final report.

## Source of truth

- Original game: `noita-sandbox.html` (line numbers in your assignment refer to it).
- System map: `docs/INVENTORY.md`.
- Contracts: `src/core/types.ts` (THE interface contract — implement it exactly; do not edit it),
  `src/sim/World.ts`, `src/sim/CellType.ts`, `src/sim/colors.ts`, `src/core/math.ts`,
  `src/core/events.ts`, `src/config/constants.ts`.
- If a contract seems wrong/missing, do NOT edit shared files — implement as best you can
  and report the mismatch in your final message.

## State mapping (old global → new home)

| Original | New location |
|---|---|
| `grid[x][y]` | `ctx.world.types[i]` where `const i = ctx.world.idx(x, y)` |
| `colorGrid[x][y]` | `ctx.world.colors[i]` (packed 0xRRGGBB number) |
| `lifeGrid[x][y]` | `ctx.world.life[i]` |
| `movedGrid[x][y]` | `ctx.world.moved[i]` (0/1 instead of false/true) |
| `chargeGrid[x][y]` | `ctx.world.charge[i]` |
| `swapCells(a,b,c,d)` | `ctx.world.swap(a,b,c,d)` |
| `isValid(x,y)` | `ctx.world.inBounds(x,y)` |
| `sim.x0/x1/y0/y1` | `ctx.world.simBounds.x0/...` |
| `SAND`, `FIRE`, ... | `Cell.Sand`, `Cell.Fire`, ... from `@/sim/CellType` |
| `isSolid/isLiquid/isGas/isConductor/blocksEntity` | import from `@/sim/CellType` |
| `getFireColor()` etc. | `fireColor()` etc. from `@/sim/colors` (return packed numbers) |
| `getEmptyColor()` | `EMPTY_COLOR` constant (or `emptyColor()`) |
| `COLOR_FN[t]` | `COLOR_FN[t]` from `@/sim/colors` |
| `clamp/hash2/valueNoise` | import from `@/core/math` |
| `GLOBAL_PARAMS` | `ctx.params.global` (also holds `ambient`, the original `AMBIENT`) |
| `MATERIAL_PARAMS[X]` | `ctx.params.materials[Cell.X]` (fields optional — use `!` where original assumes presence) |
| `SPELL_PARAMS.bolt` | `ctx.params.spells.bolt` |
| `globalScore` | `ctx.state.score` (after changing it, `ctx.events.emit('scoreChanged', { score: ctx.state.score })`) |
| `gameMode` | `ctx.state.mode` |
| `frameCount` | `ctx.state.frameCount` |
| `brushSize/currentElement/currentSpell/activeInputMode/currentBiome/playerSpawned` | `ctx.state.*` |
| `player` | `ctx.player` |
| `enemies` | `ctx.enemies` (NEVER reassign — mutate in place, `length = 0` to clear) |
| `projectiles` | `ctx.projectiles` (same rule; `respawn` filtering hostile: filter into a temp then `splice`/`length=0` + `push(...kept)`) |
| `activeShockwaves` | `ctx.shockwaves` |
| `flyingParticles` | `ctx.particles.list` (spawn via `ctx.particles.spawn/burst`) |
| `lightningArcs` | `ctx.lightning.arcs` |
| `keys` | `ctx.input.keys` |
| `mouseGridPosition` | `ctx.input.mouse` |
| `isDrawing/lastX/lastY/buildSpellHeld/bombCharge/activeChargingBlackHole` | `ctx.input.*` |
| `cam.x/y/tx/ty`, `camZoom`, `idleFrames` | `ctx.camera.x/y/tx/ty/zoom/idleFrames` |
| `renderCamX/renderCamY` | `ctx.camera.renderX/renderY` |
| `screenShake` | `ctx.fx.screenShake` |
| `bloomKick` | `ctx.fx.bloomKick` |
| `digBeam` | `ctx.fx.digBeam` |
| `waveState` | `ctx.waves` |
| `caveSpawnHint` | `ctx.worldgen.spawnHint` |
| `simAccumulator` | `ctx.simulation.accumulator` |
| `triggerExplosion(...)` | `ctx.explosions.trigger(...)` |
| `castLightning(...)` | `ctx.lightning.cast(...)` |
| `damagePlayer/killPlayer/respawnPlayer/findSpawnPoint` | `ctx.playerCtl.damage/kill/respawn/findSpawnPoint` |
| `damageEnemy/killEnemy/spawnEnemy/ENEMY_DEFS` | `ctx.enemyCtl.damage/kill/spawn/defs` |
| `cellBlocks/entityFree/crushLooseDebris/tryMoveEntity` | `ctx.physics.*` |
| `wandTip/digRay/erodeAt/executeWarp/firePlayerSpell/castSpellProjectile/emitBuildFlame` | `ctx.spells.*` (castSpellProjectile → `castBuildSpell`) |
| `stainCell/splatterStain` | free functions in `@/sim/stains` taking `(world, ...)` |
| `spawnCircle/drawLine` | free functions in `@/sim/brush` taking `(ctx, ...)` |
| `playBoom(r)/playZap()/...` | `ctx.audio.boom(r)/zap()/lightning()/coin()/hurt()/jump()/squelch()/flame()/dig()/waveHorn()/levitate()/implode()` |
| `tone(...)/noiseBurst(...)` (raw) | `ctx.audio.tone(...)/noiseBurst(...)` |
| `ensureAudio()` | `ctx.audio.ensure()` |
| DOM writes from gameplay code | REMOVED — emit the matching event from `@/core/events` instead (see EventMap). UI modules subscribe. |

## Color convention

Colors are packed `0xRRGGBB` numbers (see `@/sim/colors`). Where the original
manipulated `[r,g,b]` channels (coagulation darkening, stains, shading), use
`unpackR/unpackG/unpackB` + `packRGB`. Where it passed color arrays around
(particles, deposits), pass the packed number. Color factories like
`() => [168, 85, 247]` become `() => packRGB(168, 85, 247)`.

## Structure conventions

- Systems are classes implementing the matching `*Api` interface from `src/core/types.ts`.
  They receive `Ctx` as the parameter of methods that need it (e.g. `update(ctx)`), or store
  it from the constructor (`constructor(private ctx: Ctx)`) — your choice; circular imports
  are impossible either way because everything references the `Ctx` INTERFACE only.
- `import type { Ctx } from '@/core/types'` — always `import type` for interfaces.
- Use `@/` path aliases, never relative `../..` imports.
- Keep functions in the same order and grouping as the original where practical, and carry
  over the original's explanatory comments (they document intent — e.g. "asymmetric neighbor
  list counteracts sweep bias").
- `Math.random()` stays `Math.random()`.
- Preserve EVERY magic number, probability, threshold, and iteration direction exactly
  (backwards-with-splice loops stay backwards-with-splice).
- No module-level mutable state and no module-load side effects (DOM, renderer, baking).
  Everything initializes in constructors / explicit `init()` calls.
- Scratch buffers (e.g. `_cfX/_cfY` Int32Array(24)) become private fields of the owning class.
- TypeScript strict mode must pass: `npx tsc --noEmit` with zero errors in YOUR files.
  Don't suppress with `any`/`@ts-ignore`/`@ts-expect-error` — if truly stuck, use a typed
  helper or report the blocker. Casts (`as Cell`) are fine where Uint8Array loses the enum.

## Known approved deviations (already decided — do not "fix back")

1. Grids are flat typed arrays on `World`, not nested JS arrays.
2. Colors are packed numbers, not `[r,g,b]` arrays (reference-aliasing of color arrays
   between grid and particles becomes value copies — accepted).
3. Gameplay code emits events instead of touching the DOM.
4. `clear`/`respawn` mutate arrays in place instead of reassigning bindings.
5. `sampleSpriteLight` out-globals (`_ltR/_ltG/_ltB`) become a reused `{r,g,b}` result object.
6. The unused `colFunc` parameter of `handleGas` is dropped.
7. `digBeam.life--` moves out of the renderer into the frame tail in `Game.ts` (same cadence).
8. Audio SFX calls go through `ctx.audio` methods (same sounds, same throttle keys).
9. `Lighting.build` inlines the wand-tip formula (9 cells along aimAngle from
   `(x, y-9)`) instead of calling `ctx.spells.wandTip()`, so the render layer has no
   spells dependency. If the wand-tip formula ever changes, change both.
10. Entering play mode shows `WAVE n` in the wave readout; the original wrote the
    bare number there (its own inconsistency vs the in-wave `WAVE n` format).
11. The original's header score box (`#score-val`, "GOLD PURSED") was removed
    2026-06-12; gold lives only in the in-canvas HUD treasure row (`#hud-gold`),
    which rolls toward `ctx.state.score` every frame instead of waiting for the
    original's even-frame HUD cadence. Same value, marginally fresher.
12. Lava + water reaction is now directional (was: always turn the lava cell to
    Stone, which sealed every interface and let you stack a stable lava/water
    cake). The water ALWAYS flashes to steam; whether the lava chills depends on
    where the water is (`sim/elements/liquids.ts`; verify-lava-water.mjs):
    - water BELOW/beside the lava (it's boring down into the water): only a
      sparse `LAVA_CRUST_CHANCE` (0.06) fleck, so the lava out-bores the crust and
      sinks through instead of resting on top.
    - water RESTING ON TOP of SEATED lava (can't sink — solid/lava below): a thick
      obsidian rind chills DOWN into it (top cell always, then ragged to
      `LAVA_CRUST_DEPTH`=3 at `LAVA_TOP_CRUST_DEEP`=0.7) — a real ~2-4 cell crust,
      not a faint single line.
13. The GPU compose path (`render/ComposeShader.ts`) caps simultaneous distortions
    at `MAX_WAVES`=8 / `MAX_LENSES`=4; the CPU reference (`FrameComposer.composeTerrainCpu`,
    THE look reference) processes all of them. The two paths therefore diverge only in
    the rare case of >8 shockwaves or >4 lenses on screen at once (a dense explosion
    cluster). Accepted: scenes stay under the caps in practice, and the parity probe
    asserts within them. If this matters, the CPU loop is authoritative.
14. Combat modules (`combat/Projectiles.ts`, `combat/Lightning.ts`) concretely import a
    few STATELESS cross-system helpers outside the strict Ctx foundation allowlist:
    `entities/enemySpatial` (a spatial-index data structure), `entities/bodyMaterials`
    (a material registry), and `world/secrets.probeHollow` (a pure grid query). These
    are pure helpers, not stateful systems, so the coupling is benign and intentional;
    they are treated as shared foundation-tier utilities. Do not route them through Ctx
    just to satisfy the letter of the allowlist.

Everything else: identical behavior — confirmed by a 13-agent adversarial fidelity
audit (zero critical/major divergences) on 2026-06-10.
