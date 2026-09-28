# Purple Llama Studio — Architecture

A falling-sand action roguelite: a cellular-automata material simulation, a Three.js
post-processed renderer, procedural audio, and an action game layered on top.
Originally a 3,818-line single HTML file (`noita-sandbox.html`, kept as reference);
now a modular TypeScript + Vite project.

## Layout

```
index.html              Player DOM shell (toolbar, canvas holder, HUD overlays, inspector)
builder.html            Editor route: same shell minus the Sandbox palette
src/
  main.ts               Player entry: builds Game, starts the loop
  app/                  Shell-owned app lifecycle glue outside the frame loop
    BuilderLauncher.ts    Lazy Builder chunk entry point and dev reload restore
    BuilderHost.ts        Transitional command/snapshot facade between Builder and Ctx
    AuthorLink.ts         Binds the net layer to Ctx: live tuning/terrain/console
                          sync between two windows (docs/REALTIME-...-SPEC.md)
    AuthorLinkIndicator.ts  Header LINK pill (peers, and the amber "different
                          worlds" state that pulls the peer's grid on click)
    builderEntry.ts       /builder.html entry: Game + AuthorLink, Builder opened
                          (builder.html itself is GENERATED from index.html by
                          scripts/gen-builder-html.mjs; the HUD resolves nodes
                          strictly, so the two shells must not drift)
    authorLinkObjects.ts  Applies a remote authored set into the live runtime
                          through the SAME instantiateObjects the compiler uses,
                          and tears down only what it created
  styles/main.css       All styling (extracted from the original <style>)
  config/               Tunable data, no logic
    constants.ts          World/view dimensions, sim margin, particle cap
    params.ts             GLOBAL/MATERIAL/SPELL/PostFx params (live-mutated by inspector UI)
    biomes.ts             Biome generation profiles
  core/
    types.ts              THE contract file: entity shapes + service APIs + Ctx
    events.ts             Typed synchronous EventBus (gameplay → UI decoupling)
    storageOwner.ts       Single-writer election so two linked windows sharing
                          one localStorage cannot stomp each other
    math.ts               clamp, hash2, valueNoise
  authoring/             Neutral authored-content contracts shared by Builder,
                          worldgen, and runtime instantiation; no DOM/localStorage/Ctx
    document.ts           EditorDocument object/link/light/world-layer shapes + pure helpers
    prefab.ts             PrefabDef schema, cell decoding, sanitization
    sprites.ts            SpriteAsset schema, frame decoding, runtime sprite helpers
    spriteRuntime.ts      Runtime sprite resolution surface
    stamps.ts             Pure structural cell stamp helpers
    cellPatch.ts          Sparse cell diff: the Builder's undo payload AND the
                          AuthorLink terrain wire format (apply/bounds/validate)
    worldLayer.ts         EditorWorldLayer codec (capture/apply/repaint). Colors are
                          re-derived from the paint seed, not shipped, so a whole
                          1600x1064 cave world serializes to ~75 KB
  net/                   Optional realtime layer; no Ctx, no World, no DOM but WebSocket
    authorLinkProtocol.ts  Envelope, message union, payload validators, size caps
    AuthorLinkClient.ts    Socket lifecycle, reconnect, heartbeat, echo drop
    SessionTransport.ts    The seam multiplayer plugs into: session semantics
                           (reconnect/presence/echo) stay in the client, a
                           transport carries opaque frames. WebSocket today;
                           the SpacetimeDB transport is archived (git tag
                           archive/spacetimedb, docs/MULTIPLAYER-ARCHITECTURE.md)
    tuningPatch.ts         Dotted tuning paths <-> the live config singletons
                           (allowlist DERIVED from shipped defaults, never authored)
servers/authorlink/      The relay. room.mjs is the ONE implementation; the Node
                         host (scripts/authorlink-server.mjs) and the Cloudflare
                         Durable Object (worker.js) only own sockets + storage
  sim/                  Cellular automata
    CellType.ts           Append-only Cell ids + material classification predicates
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
    Telekinesis.ts        The wand's grip (E lift / set down, F or RMB hurl) on corpses and crates
    AlchemyKills.ts       Kill attribution (Ctx.alchemy): last blow per creature, alchemical
                          kills, chains, grid-honest payout; emits `alchemyKill`
    SelfShock.ts          Self-shock fairness: falloff at the body, capped window, conductor arc
    Lightning.ts          Chain lightning raycast + arc visuals
    Projectiles.ts        Spell projectiles, bombs, black holes, gravity wells
    Spells.ts             Wand tip, dig ray, warp, tactical spell dispatch
  entities/
    physics.ts            Entity-vs-grid collision with the loose-rubble cluster rule
    Player.ts             Player state/factory, review kit, damage/death/respawn, movement, animation
    playerPose.ts         Pure player-state → skeleton (every action; also read off the ragdoll)
    playerCostume.ts      Presentation cloth: coat tails, mantle hem, hat crown (docs/PLAYER-ART.md)
    chill.ts              THE CHILL model: the alchemist's graded body cold (0..1), its rime, the
                          ice shell and the thaw beat, and the curves movement / lens / score read
    Enemies.ts            Enemy defs, spawn/damage/kill, per-kind AI
  creatures/              Creature mind, pose and the Rain World body layer (docs/CREATURES.md)
    rig/                  Verlet chunks with cell collision + liquid drag, chains, gripping
                          IK legs, pressurised soft bodies — tick-owned, never saved
    species/              Per-body-plan rigs (lizard, gel, bat, imp, wisp, brute, mage,
                          serpents, rootloper) + the registry tickCreaturePose steps
    worldTouch.ts         Footfalls, surface splashes, ploughed powder, tracks, kicked debris
    corpses.ts            Limp remains that fall, settle and melt back into grid cells;
                          the rot rules and Ctx.corpses (blasts, the boot, plate weight)
    corpseBody.ts         One view of any dead body (rig / Weaver shell / spine): mass, pushes, grip
    corpseWorld.ts        Remains as mass: fire, lava, acid, frost + shatter, current, splash,
                          BOWLED strikes, crate shoves (reads and writes real cells)
  game/
    Game.ts               Composition root: builds Ctx, owns the frame order
    Flora.ts              Felling: watches living wood (chunk support fingerprints),
                          lifts a severed stand onto a hinged Rapier body, crushes,
                          re-stamps the log as Wood; kicks, pods, glowseed pickup
    floraFelling.ts       Pure felling geometry: stand flood, lift, box fit, restamp
    DeathCinema.ts        The directed death: push-in, grade, heartbeats, letterbox, title beat
    Chill.ts              THE CHILL system: samples cold and heat cells round the body, steps the
                          model, and makes the world answer in real cells (a rime-ice skin on
                          waded water, hoarfrost prints, breath steam, shed snow/ice); chillMoment
                          events; the wind loop and slowing heart (docs/FEEL.md "The chill")
    WaveDirector.ts       createWaveState() — the small kill/counter state that
                          outlived the retired wave-survival director
    surfaceIntro.ts       Surface-intro arrival predicates (isOnIntroSurface /
                          introArrivalSpawn) for Levels; no generated level has
                          a surface since D1 became the Breathing Works
  world/
    CaveGenerator.ts      Generation pipeline host: skeleton dispatch + paint + decorations
    carve.ts              Pure carve primitives over the work buffer (incl. ensureConnectivity)
    skeleton/             Per-biome cave topology strategies (baseline + six bespoke)
    connect.ts            connectToCaves/carvePocket + PlacementLedger (reserved rects)
    fixtureFooting.ts     The footing contract: fixtures' footings are sealed ground for
                          later tunnels; after the last carve every bowl/basin/body is
                          re-stamped and stood on ground (fail-open, never cuts a route)
    floraKit.ts           The 14 plant species as real-cell growers (Planter: writes only open cells)
    floraPass.ts          Floors 2-4: flora puzzle rooms + dressing on a forked 'flora' stream
    worksFlora.ts         Floor 1's hand-planted flora and the Seed Cellar puzzle
    prefabs/              Built-in PrefabDef registry + seeded placement pass into levels
    crownPalette.ts       Transcribed crown tint math (Builder crownTint pass)
    fortress.ts           Multi-material real-cell fortress stamp
  builder/                The Builder authoring tool (see docs/BUILDER.md)
    Builder.ts            Editor overlay: tools, canvas, panels, dispatch
    document.ts           Builder capture, persistence, share codes; re-exports neutral document contracts
    prefablib.ts          Builder prefab capture/rotate/mirror/paste helpers around neutral PrefabDef
    selection.ts          Floating cell selection (lift/transform/commit)
    symmetry.ts           Mirror painting math
    assets/               Builder asset UI/import/export/file IO; pure SpriteAsset pieces live in authoring/
  render/
    Renderer.ts           Three.js renderer/composer/bloom/PostFx + camera quad transforms
    Camera.ts             Lerp follow, idle zoom, sim-bounds derivation
    Background.ts         Parallax backdrop layers (baked once): the classic two
                          refinery plates (sandbox, Builder playtests, author overrides)
    depth/                Layered scenery (config/depthKits, one kit per biome
                          + a generic fallback): DepthScene is the compositors'
                          ParallaxLayers — the kit's 3–5 planes ride the five
                          backdrop slots (CPU/WebGL2/WebGPU draw them unchanged,
                          each slot with a light response so the lantern skips
                          far planes); procedural plane art (raster/motifs/kitArt,
                          baked one plane per frame, haze = atmospheric
                          perspective); the foreground occluder plane (a quad
                          over the frame: ForegroundGL / the WebGPU TSL twin)
                          faded by the reveal field (screen centre, player,
                          creatures, pickups, hazards, the telekinesis tether);
                          stateless depth particles drawn through the overlay
    Lighting.ts           Half-res RGB light field, directional sweeps, wand raycast
    PostFx.ts             Post pass after bloom: aberration, grain, hurt pulse, the death grade,
                          and the chill's lens (cold grade + frost growing in from the edges;
                          chillLens.ts is the one reading both it and the WebGPU twin share)
    FrameComposer.ts      Per-pixel frame composition into the GPU DataTexture
    ComposeShader.ts      GPU terrain pass (postFx.gpuCompose): the FrameComposer
                          loop as a fragment shader + world-window packer + sprite
                          overlay texture; CPU loop stays the look reference
                          (docs/GPU-COMPOSE-PLAN.md, parity-probed)
    skyAtmosphere.ts      D1 daytime-sky tuning (SKY) — THE single source both
                          FrameComposer and ComposeShader read (the latter
                          interpolates it into GLSL) so the CPU/GPU sky (gradient,
                          sun, drifting clouds, parallax hills) can never drift
    sprites/              Procedural pixel sprites (player wizard; CreatureArt dispatches creatures)
    creatures/            Creature rasterizer: z-buffered 2.5D volumes with analytic
                          normals, OKLab ramps, field-derived key light, sel-out, glass
                          (blendFinePx/blitFine) + one art module per species + rig lights
    sprites/FineArt.ts    Presentation-resolution kit: Pen primitives (rods,
                          wheels, cables, plates, rivets), the EPX cell-capture
                          upsample with a one-pixel rim, bitmap blit, view
                          culling. Every sprite family that is not creature
                          art draws through it so the frame shares one grain
    TeaMachineLinkages.ts Bell & Tea Engine linkage drawings: wheels, cables
                          and rods follow solver poses + real plate travel
    WorksFixtures.ts      D1 fixtures: barricade straps + sign, the Lower Bell
                          floor grate's archway, lock bell and sliding bars
  audio/
    AudioEngine.ts        Procedural WebAudio SFX synthesis; mix buses -> glue
                          compressor -> limiter -> soft clip -> master
    mix.ts                Pure mix math: volume taper, bus levels, placeSound
                          (pan / distance / air-absorption from the camera centre)
    Stingers.ts           Run-event stingers (alchemyKill, phialsChanged,
                          runEnded, clipSaved) — events in, audio calls out
    HabitatAudio.ts       Listener placement + footfall / creature-movement cues
    MusicDirector.ts      The score: streams public/audio/music via media elements
                          into the music bus; equal-power crossfades on the audio
                          clock; title / floor / hunted / boss / Sanctum / Tea
                          Engine / Workshop / verdict cues; silent until a gesture
    musicRules.ts         Pure director rules: cue choice, threat + hysteresis,
                          fade lengths, level dips (tests/music-director.test.ts)
    Narrator.ts           The docent: voices shown text by narrationKey on the
                          voice bus, ducks music + ambience; narrationRules.ts
                          holds its manners (one line, cooldown, once a session)
    narrationText.ts      Text normalisation + clip keys, shared with the offline
                          generator (scripts/audio/voice-lines.mjs)
  content/audio/          score.generated.ts + narration.generated.ts (written by
                          scripts/audio/gen-music.mjs / gen-voice.mjs) and
                          scoreManifest.ts (AUDITION_ENTRIES, dev audition only)
  input/
    InputManager.ts       Mouse/keyboard handlers, mode switching
  ui/
    icons.ts              Hand-authored pixel-art icon set
    Toolbar.ts            Left panel: materials, spells, world gen, enemy droppers
    Inspector.ts          Right panel: global/PostFx sliders + dynamic per-material/spell params
    Hud.ts                In-canvas HUD: vitals, hotbar, banners, game-over overlay
    Callouts.ts           World-anchored combat words (alchemyKill / combatCallout), chains
    WandBench.ts          Card slotting plus debug-only potion/elixir/power controls
    ConsoleOverlay.ts     Backquote dev-console shell backed by game/console commands
```

## Authoring modes

The `build` mode is the live-simulation **Sandbox**: it paints cells into the
active `World`, casts test spells, and saves raw grid data (v1).

The **Builder** is the authoring tool: it edits a durable `EditorDocument` (v2 —
terrain layer, objects, links, lights, procedural history, embedded sprite
assets) and compiles it into a disposable `LevelRuntime` for playtest. Do not
grow one save format into another's job; Sandbox saves, Builder documents, and
expedition saves serve different purposes. See `docs/BUILDER.md`.

**The prefab pipeline ties authoring to generation.** `PrefabDef` v1 now lives
in the neutral authored-contract layer (`src/authoring/prefab.ts`). It has three
consumers: the Builder prefab library (capture/paste with objects+links+lights),
the asset pipeline (terrain ⇄ palette-marked PNG for external pixel editors,
plus `.prefab.json`), and worldgen (`src/world/prefabs/` places built-in prefabs
into generated levels through the region graph, tunneling their anchors to the
cave network and instantiating their objects through the SAME
`src/game/instantiate.ts` path the playtest compiler uses). Builder modules may
re-export compatibility shims during the decoupling migration, but runtime and
worldgen code should import authored document/prefab/sprite/stamp contracts from
`src/authoring`, not `src/builder`.

**Worldgen pipeline order** (generateLevel): caves (per-biome skeleton from
`config/gen.ts` → shared paint + decoration stages) → bedrock/well/waystones →
biome extras → region graph → ledger pre-reserves → prefab placement (forked
'prefabs' stream — the main stream stays golden-hash locked) → machine
structure placement (a second placePrefabs pass on the forked 'machines'
stream: chain-reaction rooms built from the machine mechanism vocabulary,
biome-gated by `GEN[biome].machines` tags) → graph re-extract → secrets →
cauldron/onboarding → structures. Expedition saves record `GEN_VERSION`;
resume retires mismatched saves (restoreLevel regenerates the pristine world
from seed, so stale saves would silently desync).

## Key design decisions

**Ctx composition root.** Every shared dependency (world state, entity lists, service
APIs) lives on a single `Ctx` object built once in `Game.ts`. Systems depend on the
`Ctx` *interface* (`core/types.ts`), never on each other's concrete classes — this
breaks the dense cross-coupling of the original (explosions ↔ enemies ↔ particles ↔
player ↔ spells) without letting circular imports exist.

**Flat typed arrays.** The grid is five `TypedArray`s indexed `x + y * width` instead
of nested JS arrays of arrays — far less memory, far better cache behavior, and the
foundation for future chunking/dirty-rect work. Colors are packed `0xRRGGBB` integers.

**Entity storage is array-of-objects, on purpose — with a documented switch
point.** The grid is structure-of-arrays (above), but the transient entity
systems — the particle pool (`src/particles/Particles.ts` + the `EntityPool` in
`src/entities/ecs.ts`), enemies, projectiles, critters — are deliberately
array-of-objects (AoS). Below ~10k *sustained* live elements, AoS ties or beats
parallel typed arrays (the working set stays cache-resident and V8's monomorphic
object access is fast), and it keeps gameplay code legible and `window.__game.ctx`
debuggable. The crossover is real: converting `Particles` to structure-of-arrays
(`Float32Array` per field) measured ~2× faster at 16k particles, ~4–6× at 64k, and
~10× less GC churn — but only once a system genuinely *sustains* that many. So the
rule is: **keep AoS until a system sustains >~10k live elements, then convert that
one system to SoA.** Raising `MAX_PARTICLES` (a ceiling) does not by itself trigger
this — sustained on-screen count does. The benchmarks are the gate
(`scripts/bench-particle-layout.mjs`, `scripts/perf-particles-12k.mjs`); re-run them
on target hardware before refactoring. A C/WASM archetype ECS (FLECS) was evaluated
and rejected: its SoA-iteration win is unusable from JS without rewriting gameplay in
C, and it would fight the in-place-array invariant, the frame-order contract, and the
in-page probe workflow — the same win is available in pure TypeScript with no WASM.

**Events outward, calls inward.** Gameplay systems call each other through Ctx service
APIs (synchronous, ordered), but never touch the DOM. Anything presentation-shaped
(score readouts, banners, overlays, mode classes) is an `EventBus` event the UI layer
subscribes to. Audio stays a direct API (`ctx.audio.boom(r)`) because SFX are
parameterized and timing-sensitive.

**Runtime indexes are transient.** `LevelRuntime` may carry compiled lookup tables
derived from serializable data, such as `mechanismTriggers` (`targetId -> triggers`).
Save files store the source lists only; restored levels rebuild transient indexes
through `makeLevelRuntime`.

**Two clocks, preserved.** The cell simulation runs on a fixed-step accumulator
(`simSpeed` substeps per render frame, capped at 6); rendering, sprite animation, and
entity AI run at rAF rate. This split is inherited from the original and all tuning
constants assume it — do not "unify" it without retuning the whole game.

**Frame order is a contract.** Per frame, in `Game.ts`:
`frameCount++ → camera.update → camera.updateSimBounds → grimoireInteractions.update →
simulation.update (substeps:
new moved epoch → harvester → electrical → projectiles → shockwave aging → material sweep →
ice/vines pass) → playerCtl.update → chill.update (the body's cold follows where it now
stands; movement reads its moveK next tick) → flask.update → enemyCtl.update → flora.update (a stand the
sim severed becomes a hinged body that steps in the same solver pass; settled logs re-stamp) →
rigidBodies.update →
vineStrands.update → levels.update → pickups.update → mechanisms.update → critters.update →
brewing.update → hints.update → introProgression.update → wands.update → particles.update → lightning.update →
compose pixels/light → HUD update (even frames, play mode) → minimap.update →
renderer.render (bloom/shake transforms → composer.render) → digBeam decay →
bloom/shake decay once per fixed frame`.
Several behaviors silently depend on this order (sim bounds derive from camera; spells
aim with the *previous* frame's render snapshot; lighting rebuilds on even frames).

**Live-tunable params.** `config/params.ts` objects are intentionally mutable: the
inspector UI writes straight into them and the simulation/rendering layers read
them every tick. They are data, not constants. Post-processing follows the same
rule: `createDefaultPostFxSettings()` seeds bloom, exposure, lens, grain, and
hurt-pulse controls; the Inspector mutates `ctx.state.postFx` live.

## Original-quirk notes (preserved on purpose)

- Enemy sprite drawing advances some animation state (stride/blink/splat) at render
  time — visual sim lives in the renderer for those fields.
- The electrical grid only decays charges inside the active sim window; off-screen
  charges freeze until the camera returns.
- The material sweep randomizes scan direction per row; the sim is nondeterministic.
- `cellBlocks` treats connected clusters of <5 solid cells as walk-through rubble.

See `docs/INVENTORY.md` for the full system-by-system map of the original file and
`docs/PORTING.md` for the porting conventions used during the conversion.
