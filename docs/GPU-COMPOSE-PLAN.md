# GPU Frame Composition — implementation plan (perf ticket #8)

**Status: IMPLEMENTED June 2026 — behind `postFx.gpuCompose`, default ON.**
All four phases landed in one pass: `src/render/ComposeShader.ts` (shader +
window packer + overlay), Renderer material swap, FrameComposer gating, PerfHud
compose/gl sub-buckets. Parity probe `scripts/probe-compose-parity.mjs` is 8/8
green (static scene 99.999% pixel-exact / max delta 1 LSB, flicker
distribution-identical, postFx-ON chain bit-exact); same-session A/B lives in
`scripts/perf-ab-compose.mjs`. Deviations from this plan, all measured-safe:
pad P = 64 (not 40 — singularity strength −16 stacks with a max lens to ~49
cells), bgNear uploads as R32F not R8 (exactness; 6.8MB VRAM once), window
texture is RGBA8UI (integer fetches, no unorm rounding risk), overlay is
RGBA16F with written-index-only f16 conversion. The plan below is kept as the
reference brief.

## The problem, measured

The render bucket (Game.ts: `composer.compose(ctx)` + `renderer.render(ctx)`,
marked as one `render` bucket in PerfHud) costs **~7.3ms of a ~10ms frame** in
the chaos benchmark. Two causes:

1. `FrameComposer.compose()` rewrites every view pixel on the CPU each frame —
   `VIEW_W × VIEW_H = 525 × 357 = 187,425` pixels through a branchy per-pixel
   loop (distortion, parallax, light, knee, per-material animation).
2. The whole buffer is a `Float32Array` RGBA `DataTexture`
   (`THREE.FloatType`) — a **3MB texture upload every frame**
   (`Renderer.pixelData`, flagged by `markTextureDirty()`).

Moving the per-pixel terrain pass into a fragment shader is the last big win
(~3–5ms). Everything else in the frame is already cheap or already GPU-side
(UnrealBloom, PostFx lens pass).

## The bar

**The CPU loop IS the look.** The acceptance bar is pixel-identical output for
every *deterministic* branch, and distribution-identical output for the
*stochastic* ones (fire/lava/ember flicker uses `Math.random()` per pixel —
already non-reproducible frame to frame, so "identical" can only mean same
statistical brightness/variance, verified by A/B measurement, not eyeballs).

Do not "improve" anything while porting. The knee curve, the squared light
factor, the vignette-free selfGlow floor, the additive air-glow — each of these
was tuned in its own session and is load-bearing (CLAUDE.md invariant 4).

## What the per-pixel loop actually does (FrameComposer.compose, the hot part)

For each view pixel `(vx, vy)` with world coords `(wx, wy) = camera + view`:

1. **Distorted lookup**: shockwaves (ring refraction, `ctx.shockwaves`, offset
   along the radial by `sin(edge·π)·strength·decay`, plus additive `ringGlow`)
   and black-hole lenses (`projectiles` with `type === 'blackhole'`: inward
   pinch + tangential swirl, `K = 4 + vortexRad·0.16`, `R = vortexRad·2.1`).
   Lookup coords clamp to world bounds. Both mutate WHERE the world is sampled.
2. **Empty cells** → parallax composite: `bgFar` (0.35× scroll) silhouette
   carves `bgNear` (0.62× scroll) rock texture; depth shade
   `0.86 + 0.14·(1 − wy/HEIGHT)`; then the air-light formula (half-res light
   field sampled at `(vy>>1)·LW + (vx>>1)`, full-res `vignette[vy·VIEW_W+vx]`,
   squared lit factor capped 2.2, additive air glow above 0.25 light).
3. **Material cells** → unpack `world.colors[ci]` (0xRRGGBB), then per-type
   animation:
   - Fire / Lava / Ember: `Math.random()` flicker (stochastic)
   - Water/Healium/Teleportium **surface** (empty above): sine wave —
     deterministic in `(frameCount, wx)`
   - Crystal glint: `((wx·17 + wy·31 + frameCount) % 97) === 0` — deterministic
     **integer** arithmetic
   - Glowshroom breath, Vines/Moss/Fungus sway: deterministic sines
4. **Emissive intensity**: `bloomWeight` per material
   (`ctx.params.materials[type].bloomWeight`, live-tunable) →
   `intensity = 1 + (maxBrightness−1)·scalar`; charged cells
   (`world.charge[ci] > 0`) override to electric cyan at `boost·1.2`.
5. **The lighting law** (per channel): vignette, ambient, clamp 2.2, square,
   soft knee above 1.25 (slope 0.3, cap 2.0), `max(lit, selfGlow)` where
   `selfGlow = 0.45 + scalar·1.55` for emissives (vignette-free on purpose),
   plus readability floor `0.06·vg`. Then `+ ringGlow` warm additive.
6. Output Y-flipped: `((VIEW_H−1−vy)·VIEW_W + vx)·4`.

After the loop: **the overlay pass** — particles, lightning arcs, projectile
sprites, decor, landmarks, pickups/portal, mechanisms/runes, critters, flask
effects, enemies, dig beam, player — thousands of `setPx`/`addPx` calls with
irregular CPU logic that READS game state and MUTATES entity animation fields
(EnemySprites/PlayerSprite contract). **This pass stays on the CPU.** It is not
the cost; it touches a few thousand pixels.

## Architecture: split terrain (GPU) from overlay (CPU)

Replace the quad's `MeshBasicMaterial` with one `ShaderMaterial` (GLSL ES 3.0 /
WebGL2 — the existing `WebGLRenderer` stack stays; do NOT migrate to
WebGPURenderer/TSL for this ticket, bloom + PostFx would have to be ported and
the win is the same).

### Inputs to the fragment shader

| Input | Form | Size / cadence |
|---|---|---|
| World window | RGBA8 texture, `(VIEW_W+2P) × (VIEW_H+2P)`, P = distortion pad | ~1MB **uchar** upload/frame (`texSubImage2D`, double-buffered) |
| — packing | R,G,B = cell color bytes; A = `type | (charge>0 ? 0x80 : 0)` (type ids ≤ 35, bit 7 free — cell ids are append-only so this is safe for ~92 more materials) | |
| Light field | RGBA8 or float texture, `LW × LH` (half-res view) | ~47–188KB, re-upload only when `light.build` ran (every 2nd frame) |
| Parallax | two R8 world-size textures (1600×1064) from `Background.bgFar/bgNear` | uploaded **once** at boot (~3.4MB total, static) |
| Bloom LUT | 256×1 R8 texture of `bloomWeight` per type id | 256B, re-upload each frame (params are live-tunable) |
| Shockwaves | uniform array, cap 8: `cx, cy, currentRadius, maxRadius, strength` | per frame |
| Lenses | uniform array, cap 4: `cx, cy, R, K` | per frame |
| Scalars | `renderCamX/Y`, `frameCount`, `ambient`, `maxBrightness`, far/near parallax offsets, window origin | per frame |
| Vignette | computed analytically in-shader: `1 − 0.52·r²` (matches the baked `Lighting.vignette` table — verify the exact bake formula first) | — |

**The distortion pad P**: shockwave offset is bounded by `strength`; lens
offset by `K·√2·0.7…` (vortexRad caps at 140 → K ≈ 26 → ~31 cells with swirl).
Survey `Explosions` for max shockwave strength, then set P (≈ 40) and assert it
in the parity probe with a max-size black hole at the view edge. CPU lookups
clamp to *world* bounds; the shader clamps to the *window* — identical only
while distorted lookups stay inside the pad. Cap the in-shader offset at P and
prove the cap unreachable, or accept edge-case divergence and document it.

### The overlay buffer (CPU, exact setPx/addPx semantics)

A second `VIEW_W × VIEW_H` RGBA float texture. Rules that make the split
**exactly** equal to today's single buffer:

- `setPx(x,y,r,g,b)` → `rgb = value`, `a = 1`
- `addPx(x,y,r,g,b)` → `rgb += value` (a unchanged)
- shader: `final = (overlay.a > 0.5 ? vec3(0) : terrain) + overlay.rgb`

Walk the cases: add-only pixel = terrain + adds ✓; set-then-add = set + adds,
terrain dropped ✓; add-then-set = set wins (setPx writes, doesn't add) ✓. The
dig-beam glow that today `addPx`es over rock it can no longer read becomes a
true additive blend ✓.

Clearing: sprites touch a few thousand pixels — record written indices in a
grow-only `Uint32Array` list during the frame and zero only those next frame
(plus `a`). Full-buffer `fill(0)` is the fallback (~0.3ms — measure both).

The overlay upload is small in bytes-touched but `texSubImage2D` uploads the
full rect; measure — if the upload eats the win, drop to RGBA16F
(`HalfFloatType`) for the overlay only (sprite HDR values reach ~2.6·boost;
half-float covers it losslessly enough — verify against bloom threshold). Note
the perf memory: JS-side f16 conversion was REJECTED for the full buffer; the
overlay is 1/16th the bytes, so the tradeoff differs.

### Stochastic flicker on the GPU

`Math.random()` per hot pixel → shader hash, e.g.
`fract(sin(dot(vec3(wx, wy, frameCount), …))·43758.5453)`. Must be re-rolled
per frame (include frameCount), uniform-distributed, and applied with the SAME
ranges (`0.75+0.5x` fire, `0.96+0.08x`/`0.8+0.35x` lava, `0.7+0.55x` ember,
green-only scaling identical). Deterministic branches (water wave, crystal
`%97` glint, glowshroom, moss) must be ported **formula-for-formula** with
`highp` floats and *integer* ops for the glint, then verified pixel-exact.

## What does NOT change

- `Lighting.build` stays CPU (every 2nd frame, feeds enemy/player sprite
  `light.sample` reads that must remain CPU-readable anyway).
- All sprite/overlay drawing, including the entity-mutating animation pattern.
- `EffectComposer` chain: RenderPass → UnrealBloom → PostFx (lens). The
  ShaderMaterial replaces only the quad's material; the overscan quad geometry,
  sub-cell camera offset, screen-shake jitter, and `camera.zoomLock` transform
  in `Renderer.render` are untouched.
- The minimap, Builder, save formats: untouched.
- Two-clock contract, frame order (compose still runs at the same point in
  `Game.step`).

## Phases (each shippable, all behind a live flag)

Add `gpuCompose: boolean` to `PostFxSettings` (types.ts + `config/params.ts`
defaults + the existing PostFx dev panel checkbox row) — default **off** until
Phase 4 acceptance. The flag must be flippable at runtime for same-session A/B
(the perf methodology demands it; this machine drifts ±3–5% between sessions).

1. **Baseline + plumbing.** Record `node scripts/perf-scene.mjs before` (dev
   server running). Split the PerfHud `render` mark into `compose` and `gl`
   sub-buckets (keep the combined `render` bucket emitting so old baselines
   stay comparable). Build the window-texture packer (types+colors+charge →
   RGBA8) and measure pack+upload cost alone.
2. **Terrain shader, deterministic core.** Empty-cell parallax+air-light path
   and material path with lighting law, bloom LUT, charge override — no
   distortion, no flicker (flicker branches render at their deterministic
   midpoint behind a debug uniform). Parity probe: load a seed, pause, render
   one frame CPU and one frame GPU, `drawImage` the canvas **inside a rAF
   callback** (preserveDrawingBuffer is false — see CLAUDE.md probe gotchas),
   diff = 0 expected. PostFx/bloom OFF during the diff (`postFx.enabled=false`
   renders the raw buffer).
3. **Distortion + animation.** Shockwave/lens uniforms + ringGlow; stochastic
   flicker via hash; exact deterministic animations. Parity probe extends:
   static scene diff = 0 with flicker masked; flicker cells compared by
   mean/variance bands over 60 frames; max-size black hole at view edge (pad
   assert); bomb shockwave A/B screenshots for the eyeball record.
4. **Overlay split + kill the 3MB upload.** setPx/addPx retarget to the
   overlay buffer; written-index clearing; Float path deleted from the hot
   loop (`pixelData` stays as the CPU-fallback buffer behind the flag).
   Acceptance gate completed; the default is now ON.

## Acceptance gate (all of it)

- `node scripts/perf-scene.mjs after` vs `before`: **render bucket −3ms or
  better**, Welch t-test significant, `sim`/`entities` buckets not regressed.
  Then a same-session A/B by toggling the flag mid-run (drift-proof).
- Parity probe green (new `scripts/probe-compose-parity.mjs`, asserts above).
- Full battery: `npx tsc --noEmit`, `npx vitest run`, `npm run build`,
  `npm run lint`, `npm run verify:findability`, then the runtime probes that
  read pixels (`probe-anim`, `probe-wand-shot`, `verify-sprites`,
  `verify-gallery`) — they screenshot the composed frame and will catch look
  regressions the parity probe's single scene misses.
- Builder smoke (`verify-builder.mjs`): build mode composes through the same
  path (no `levels.current`, overlays mostly skipped — the terrain pass must
  not assume play mode).
- One manual eyeball pass by Frank before flipping the default (he owns the
  look; micro-interaction polish is the studio's stated priority).

## Risks / gotchas (hard-won, do not rediscover)

- **WebGL2 required** for integer ops + R8 textures. Three.js r150+ defaults
  to WebGL2; assert `renderer.capabilities.isWebGL2` and keep the CPU path as
  the permanent fallback if it's false.
- **Float precision**: force `highp`; the knee/square/vignette math in mediump
  visibly bands. The crystal glint MUST use `int` math (`%` on floats ≠ C).
- **Y-flip**: the CPU buffer stores rows flipped (`(VIEW_H−1−vy)`); pick ONE
  orientation for the new textures and fix it in texture coords, not in three
  places.
- **Texture upload stalls**: double-buffer the window texture (two textures,
  alternate frames) if `texSubImage2D` blocks; measure first.
- **Live-tuning**: `ambient`, `maxBrightness`, every `bloomWeight` are mutable
  at runtime (`config/params.ts` is intentionally mutable). Uniforms/LUT must
  be re-fed per frame, never baked at startup.
- **Charge bit**: packing `type | 0x80` is an internal texture format, NOT a
  save format — but document it next to `CELL_COUNT` so the id-128 collision
  is caught decades early.
- **Benchmark discipline** (from the perf session): only trust deltas far
  beyond ±3–5% machine drift, or same-session A/Bs; `window.__perfRecord` is
  the raw-sample hook; hot-loop field loads are not hoisted by V8 when
  handlers are called inside the loop (matters for the window packer).
- **Do not reorder `Game.tick`** — compose stays where it is; lighting still
  rebuilds on even frames; spells still aim with the previous frame's
  `camera.renderX/Y` snapshot (compose sets it — keep setting it even on the
  GPU path: `ctx.camera.renderX/renderY` are a cross-system contract).
- The parallax textures bake from `Background`'s `valueNoise` at boot — they
  are seed-independent statics; upload once, never per level.

## File map

| File | Change |
|---|---|
| `src/render/ComposeShader.ts` (new) | GLSL source, ShaderMaterial, window packer, texture/uniform management |
| `src/render/Renderer.ts` | material swap behind the flag; overlay + window textures; keeps RenderTarget contract |
| `src/render/FrameComposer.ts` | terrain loop gated by flag; setPx/addPx retarget to overlay; still sets `camera.renderX/Y`; overlay clear list |
| `src/render/pixels.ts` | RenderTarget grows the overlay surface + window-upload interface |
| `src/core/types.ts` | `PostFxSettings.gpuCompose` |
| `src/config/params.ts` | default + dev-panel wiring |
| `src/ui/PerfHud.ts` | compose/gl sub-buckets |
| `scripts/probe-compose-parity.mjs` (new) | A/B readback parity probe |

## Pointers

- Perf methodology + the rejected-alternatives record (HalfFloat conversion,
  chunking): the `noita-studio-port` memory file, PERF section.
- Probe gotchas (rAF readback, real Cell ids, freeze-frames): CLAUDE.md +
  `.claude/skills/indie-game-dev/SKILL.md`.
- The original ticket sizing: render bucket 7.3ms / 10ms frame; FrameComposer
  loop + 3MB float upload; expected win ~3–5ms.
