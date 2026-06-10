# Noita Studio — Architecture

A falling-sand action roguelite: a cellular-automata material simulation, a Three.js
post-processed renderer, procedural audio, and an action game layered on top.
Originally a 3,818-line single HTML file (`noita-sandbox.html`, kept as reference);
now a modular TypeScript + Vite project.

## Layout

```
index.html              DOM shell (toolbar, canvas holder, HUD overlays, inspector)
src/
  main.ts               Entry point: builds Game, starts the loop
  styles/main.css       All styling (extracted from the original <style>)
  config/               Tunable data, no logic
    constants.ts          World/view dimensions, sim margin, particle cap
    params.ts             GLOBAL/MATERIAL/SPELL params (live-mutated by inspector UI)
    biomes.ts             Biome generation profiles
  core/
    types.ts              THE contract file: entity shapes + service APIs + Ctx
    events.ts             Typed synchronous EventBus (gameplay → UI decoupling)
    math.ts               clamp, hash2, valueNoise
  sim/                  Cellular automata
    CellType.ts           Cell enum + material classification predicates
    World.ts              Flat typed-array grid state (types/colors/life/moved/charge)
    colors.ts             Packed-RGB color factories per material
    Simulation.ts         Fixed-step accumulator + per-tick dispatcher (bottom-up sweep)
    electrical.ts         Two-phase charge propagation through conductors
    harvester.ts          Gold magnet/collection field
    explosion.ts          triggerExplosion: terrain destruction, debris, damage
    stains.ts             Permanent terrain tinting (blood decals)
    brush.ts              Build-mode painting (spawnCircle, drawLine)
    elements/             Per-material behaviors (powders, liquids, thermal, gas, vines)
  particles/
    Particles.ts          Ballistic free-pixel system (debris, gore, homing coins)
  combat/
    Lightning.ts          Chain lightning raycast + arc visuals
    Projectiles.ts        Spell projectiles, bombs, black holes, gravity wells
    Spells.ts             Wand tip, dig ray, warp, per-frame casting dispatch
  entities/
    physics.ts            Entity-vs-grid collision with the loose-rubble cluster rule
    Player.ts             Player state/factory, damage/death/respawn, movement, animation
    Enemies.ts            Enemy defs, spawn/damage/kill, slime/imp/golem AI
  game/
    Game.ts               Composition root: builds Ctx, owns the frame order
    WaveDirector.ts       Wave spawning state machine
  world/
    CaveGenerator.ts      Biome-driven CA caves, tunnel arteries, decorations
    fortress.ts           Prefab fortress stamp
  render/
    Renderer.ts           Three.js renderer/composer/bloom + camera quad transforms
    Camera.ts             Lerp follow, idle zoom, sim-bounds derivation
    Background.ts         Parallax backdrop layers (baked once)
    Lighting.ts           Half-res RGB light field, directional sweeps, wand raycast
    FrameComposer.ts      Per-pixel frame composition into the GPU DataTexture
    sprites/              Procedural pixel sprites (player wizard, enemies)
  audio/
    AudioEngine.ts        Procedural WebAudio SFX synthesis
  input/
    InputManager.ts       Mouse/keyboard handlers, mode switching
  ui/
    icons.ts              Hand-authored pixel-art icon set
    Toolbar.ts            Left panel: materials, spells, world gen, enemy droppers
    Inspector.ts          Right panel: global sliders + dynamic per-material/spell params
    Hud.ts                In-canvas HUD: vitals, hotbar, banners, game-over overlay
```

## Authoring modes

The current `build` mode is a live simulation sandbox: it paints cells into the
active `World`, casts test spells, and saves raw grid data. Long term, this should
be user-facing **Sandbox** mode.

The planned **Builder** is a separate developer tool. It should edit a durable
`EditorDocument` containing terrain, objects, links, lights, procedural pass
history, and validation state, then compile that authored document into a
temporary `LevelRuntime` for playtest. Do not grow the current sandbox save format
into the Builder format; Sandbox saves, Builder documents, and expedition saves
serve different purposes. See `docs/BUILDER.md`.

## Key design decisions

**Ctx composition root.** Every shared dependency (world state, entity lists, service
APIs) lives on a single `Ctx` object built once in `Game.ts`. Systems depend on the
`Ctx` *interface* (`core/types.ts`), never on each other's concrete classes — this
breaks the dense cross-coupling of the original (explosions ↔ enemies ↔ particles ↔
player ↔ spells) without letting circular imports exist.

**Flat typed arrays.** The grid is five `TypedArray`s indexed `x + y * width` instead
of nested JS arrays of arrays — far less memory, far better cache behavior, and the
foundation for future chunking/dirty-rect work. Colors are packed `0xRRGGBB` integers.

**Events outward, calls inward.** Gameplay systems call each other through Ctx service
APIs (synchronous, ordered), but never touch the DOM. Anything presentation-shaped
(score readouts, banners, overlays, mode classes) is an `EventBus` event the UI layer
subscribes to. Audio stays a direct API (`ctx.audio.boom(r)`) because SFX are
parameterized and timing-sensitive.

**Two clocks, preserved.** The cell simulation runs on a fixed-step accumulator
(`simSpeed` substeps per render frame, capped at 6); rendering, sprite animation, and
entity AI run at rAF rate. This split is inherited from the original and all tuning
constants assume it — do not "unify" it without retuning the whole game.

**Frame order is a contract.** Per frame, in `Game.ts`:
`frameCount++ → camera.update → camera.updateSimBounds → simulation.update (substeps:
harvester → electrical → projectiles → shockwave aging → moved-clear → material sweep →
ice/vines pass) → playerCtl.update → enemyCtl.update → waveCtl.update →
particles.update → lightning.update → build-mode held spells → renderer.render
(snapshot renderCam → compose pixels → bloom/shake transforms → composer.render) →
HUD update (even frames, play mode) → digBeam decay`.
Several behaviors silently depend on this order (sim bounds derive from camera; spells
aim with the *previous* frame's render snapshot; lighting rebuilds on even frames).

**Live-tunable params.** `config/params.ts` objects are intentionally mutable: the
inspector UI writes straight into them and the simulation reads them every tick. They
are data, not constants.

## Original-quirk notes (preserved on purpose)

- Enemy sprite drawing advances some animation state (stride/blink/splat) at render
  time — visual sim lives in the renderer for those fields.
- The electrical grid only decays charges inside the active sim window; off-screen
  charges freeze until the camera returns.
- The material sweep randomizes scan direction per row; the sim is nondeterministic.
- `cellBlocks` treats connected clusters of <5 solid cells as walk-through rubble.

See `docs/INVENTORY.md` for the full system-by-system map of the original file and
`docs/PORTING.md` for the porting conventions used during the conversion.
