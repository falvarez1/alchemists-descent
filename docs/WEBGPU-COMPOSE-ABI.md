# WebGPU Compose ABI

Status: Phase 4.1 contract, added 2026-06-15. This is the required ABI before
porting the WebGL2 `GpuCompose` shader to WebGPU/TSL or WGSL-backed TSL.

The current WebGL2 compose path remains the visual and performance reference.
The first WebGPU compose implementation must preserve this ABI unless a
benchmark entry documents a deliberate, measured deviation.

## Reference Dimensions

| Contract | Value | Source |
|---|---:|---|
| World grid | `1600 x 1064` cells | `WIDTH`, `HEIGHT` |
| View window | `525 x 357` cells | `VIEW_W`, `VIEW_H` |
| Renderer canvas | `1050 x 714` pixels | `RENDER_W`, `RENDER_H` |
| Light field | `263 x 179` samples | `(VIEW_W >> 1) + 1`, `(VIEW_H >> 1) + 1` |
| Distortion pad | `64` cells | `COMPOSE_PAD` |
| Padded world window | `653 x 485` texels | `VIEW + 2 * COMPOSE_PAD` |
| Max shockwaves | `8` | `MAX_WAVES` |
| Max black-hole lenses | `4` | `MAX_LENSES` |

## Resource ABI

| Resource | Current WebGL2 Form | Preferred WebGPU Form | Size | Cadence | Notes |
|---|---|---|---:|---|---|
| World window | `RGBA8UI` `DataTexture` | `textureLoad` from an exact integer texture where Three/TSL supports it; otherwise `rgba8unorm` with rounded byte recovery after parity proof | `653 x 485 x 4` = `1,266,820` bytes | every composed frame | RGB stores cell color bytes. A stores `type | 0x80` when charged. Rows are world-space top-to-bottom inside the padded window. |
| Light field | `RGBA32F` `DataTexture` | `textureLoad` from `rgba32float`, or a storage texture produced by later lighting compute | `263 x 179 x 16` = `753,232` bytes | only when lighting rebuilds | RGB are `lightR/G/B`; alpha is `1`. Lighting still rebuilds on CPU in Phase 4. |
| Bloom LUT | `R32F` `DataTexture` | `textureLoad` from `r32float`, or a uniform/storage array if that proves simpler and equal | `256 x 4` = `1,024` bytes | every frame | One bloom weight per material id. Material params are live-mutated. |
| Overlay | `RGBA16F` `DataTexture` plus CPU float staging | `textureLoad` from `rgba16float`; later storage texture only if it reduces upload cost | `525 x 357 x 8` = `1,499,400` bytes on GPU | dirty rect or full upload each frame | `setPx` writes RGB and alpha `1`; `addPx` adds RGB and leaves alpha. Shader computes `(alpha > 0.5 ? 0 : terrain) + overlay.rgb`. |
| Backdrop layers | 5 repeating RGBA8 textures | 5 repeating sampled textures | content-dependent | on layer version change | Each layer has independent speed, opacity, visibility, scale, and offset. |
| Shockwaves | uniform arrays | uniform buffer or TSL uniforms | under 256 bytes | every frame | `cx, cy, currentRadius, maxRadius` plus separate strength. |
| Lenses | uniform arrays | uniform buffer or TSL uniforms | under 128 bytes | every frame | `cx, cy, R, K`. |

## Logical Bind Groups

Three/TSL may assign actual bind-group numbers. The port must still preserve
this logical layout, and any raw WGSL/manual bind-group implementation should
use the same grouping:

| Logical Group | Bindings | Access | Notes |
|---|---|---|---|
| Compose textures | world window, light field, bloom LUT, overlay | `textureLoad` by integer coordinate | No filtering or sampler dependency. This mirrors WebGL2 `texelFetch` for exact pixels. |
| Backdrop textures | `uBackdrop0..4`, repeat/nearest sampler | sampled texture with repeat addressing | Only these resources should use normalized UV sampling. |
| Frame uniforms | camera, window origin, global lighting, phases, flicker, waves, lenses, backdrop config | uniform buffer or TSL uniforms | Values are live per frame and must be updated before terrain compose. |

The preferred first implementation should let TSL/Three own the physical
binding placement. If raw WGSL is used, record the exact `@group/@binding`
assignments in this file before enabling the code path.

## Uniform ABI

The WebGL2 shader currently consumes these uniform classes. The WebGPU port
must represent all of them, either as individual TSL uniforms or as one or more
uniform buffers:

| Uniform Class | Values | Alignment Requirement If Raw WGSL |
|---|---|---|
| Camera/window | `uCam: vec2<i32>`, `uWinOrigin: vec2<i32>` | pack into 16-byte slots or explicit WGSL struct padding |
| Backdrop layer config | 5 x `cfg: vec4<f32>`, 5 x `invSize: vec2<f32>`, 5 x `offset: vec2<f32>` | pack `vec2` pairs into 16-byte slots |
| Backdrop grade | `grade: vec4<f32>`, `saturation: f32` | `saturation` gets its own padded scalar slot unless combined with other scalars |
| Global/frame scalars | `ambient`, `boost`, `glintFrame`, `phaseWater`, `phaseShroom`, `phaseSway`, `flickerSeed`, `flickerMid` | mixed int/float data must use explicit offsets; do not depend on JS object layout |
| Shockwaves | 8 x `waveA: vec4<f32>`, 8 x `waveStrength: f32`, `waveCount: i32` | prefer `waveStrength` packed as 2 x `vec4<f32>` or a padded array |
| Lenses | 4 x `lens: vec4<f32>`, `lensCount: i32` | `lensCount` gets a padded scalar slot |

The current data fits comfortably under a `4 KiB` uniform-buffer gate when
packed into 16-byte aligned slots.

## Row Pitch, Alignment, And Endian Rules

- If the port uses Three `DataTexture` uploads, Three owns WebGPU row-pitch and
  copy alignment. The ABI remains the logical texture dimensions above.
- If the port uses raw `GPUQueue.writeTexture` or buffer-to-texture copies, any
  staged `bytesPerRow` must satisfy WebGPU's 256-byte row-pitch rule where the
  API requires it. Padded staging row sizes are:
  - world window RGBA8: `653 * 4 = 2612`, padded to `2816`.
  - light field RGBA32F: `263 * 16 = 4208`, padded to `4352`.
  - overlay RGBA16F: `525 * 8 = 4200`, padded to `4352`.
  - bloom LUT R32F: `256 * 4 = 1024`, already aligned.
- The WebGL2 path currently writes the world window through a `Uint32Array`
  over `Uint8Array` storage, relying on browser little-endian byte order to
  produce RGBA bytes. A raw WebGPU port should either write bytes explicitly
  through `Uint8Array` or assert little-endian once before using the same
  32-bit packing shortcut.
- Shader-visible coordinate math must not observe padded row bytes. Padding is
  upload staging only.

## Coordinate And Packing Rules

- CPU `World` remains authoritative. WebGPU compose may mirror derived render
  data only.
- Output rows are Y-flipped to match the existing `pixelData` and overlay
  contract: buffer index is `((VIEW_H - 1 - vy) * VIEW_W + vx) * 4`.
- Window texture lookup coordinates are clamped to the padded window. World
  lookup coordinates clamp to `0..WIDTH-1` and `0..HEIGHT-1` before converting
  to window coordinates.
- The charge bit is an internal texture ABI, not a save format. Current
  `CELL_COUNT` is `36`, so material ids still fit under the `0x80` charge bit.
- The first WebGPU compose port must keep the same frame order: lighting build,
  terrain compose, CPU overlay drawing, overlay commit, presentation.

## Shader Parity Requirements

The WebGPU shader must preserve the current CPU/WebGL2 formulas:

- Empty-cell backdrop layering, grade, depth shade, air lighting, and air glow.
- Material color unpack, hot-cell flicker ranges, water surface shimmer,
  crystal glint integer lattice, glowshroom breath, and vines/moss/fungus sway.
- Bloom-weight intensity and charged-cell override.
- Per-channel lighting law: vignette, ambient, clamp `2.2`, square, soft knee,
  vignette-free emissive self-glow, and readability floor.
- Shockwave and black-hole distortion plus ring glow.
- Overlay replacement/additive semantics exactly as the WebGL2 path implements.

## WebGPU Limit Gate

The existing Phase 0 adapter exceeded the likely needs for this layout, but the
port must check the active device at runtime. Required minimums:

| Limit | Required By Phase 4 | Current Need |
|---|---:|---|
| `maxTextureDimension2D` | at least current largest backdrop dimension `2172` and padded world window `653` | world window, overlay, light, backdrop textures |
| `maxSampledTexturesPerShaderStage` | at least `9` | world, light, LUT, 5 backdrop layers, overlay |
| `maxSamplersPerShaderStage` | at least `2` | nearest textures plus repeating backdrop textures |
| `maxUniformBufferBindingSize` | at least `4 KiB` | compose scalars, waves, lenses, backdrop config |
| `maxStorageBufferBindingSize` | at least `1.3 MiB` only if using storage buffers | world window fallback buffer |
| `maxBufferSize` | at least padded overlay staging size `1,553,664` bytes only if staging through GPU buffers | overlay/world staging fallback |

If a required limit is missing or below the chosen layout, WebGPU compose must
report unavailable and leave `postFx.gpuCompose` on the existing WebGL2 or CPU
fallback. It must not silently change visual formulas.

## Fallback Layouts

1. Preferred: `textureLoad` resources mirroring the WebGL2 resource ABI.
2. If exact integer texture reads are unavailable in TSL, use RGBA8 sampled data
   and recover bytes with `round(sample * 255)` only if parity proves it is safe.
3. If sampled texture binding count is too low, pack backdrop visibility to
   skip inactive layers or use the existing WebGL2 compose path.
4. If any upload strategy is slower after one focused tuning pass, keep WebGL2
   compose as the default and record the WebGPU attempt as failed for now.

## Validation Gate

- Run the existing CPU/WebGL2 compose parity probe before and after any WebGPU
  compose code changes.
- Add a WebGPU compose parity variant before enabling `gpuComposeAvailable` in
  `WebGpuRenderBackend`.
- Compare CPU, WebGL2 GPU compose, and WebGPU compose across post off/on,
  shockwaves, black-hole lenses, overlay `setPx` and `addPx`, Sandbox, Builder
  Author, and Builder playtest.
- Record same-session A/B `compose + gl` numbers against WebGL2 GPU compose in
  `docs/WEBGPU-BENCHMARK-LEDGER.md`.
