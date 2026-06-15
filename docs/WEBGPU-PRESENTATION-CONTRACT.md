# WebGPU Presentation Contract

Status: Phase 3 contract, added 2026-06-15.

This contract names the output order for the WebGPU presentation shell. It is
the parity target for `src/render/WebGpuRenderBackend.ts` and the review
checklist for future WebGPU post-processing work.

## Order

1. Base pixel buffer

   `FrameComposer` writes the authoritative `VIEW_W x VIEW_H` Float RGBA
   buffer using the existing CPU compose path. Rows stay Y-flipped to match the
   WebGL reference texture layout.

2. Emissive bloom treatment

   The WebGPU shell samples bright source pixels and a small nearest-neighbor
   kernel in TSL. This is a Phase 3 bloom equivalent, not the final selective
   emissive target planned for Phase 8.

3. Lens layer

   Chromatic split, deterministic grain input, and low-health hurt pulse are
   applied after bloom. Screen shake and bloom kick feed the same uniforms as
   the WebGL post path and decay in the renderer.

4. Exposure and tone mapping

   Exposure multiplies the post color before ACES filmic tone mapping. With
   `postFx.enabled=false`, exposure returns to `1.0`, matching the WebGL
   fallback behavior.

5. Output color-space conversion exactly once

   `RenderPipeline.outputColorTransform` stays `false`; the backend supplies an
   explicit `renderOutput(..., ACESFilmicToneMapping, SRGBColorSpace)` node.
   Future passes must not add a second output transform.

## Non-Goals

- WebGPU terrain composition is Phase 4. Phase 3 keeps CPU terrain composition.
- OffscreenCanvas or worker presentation is out of scope until input,
  screenshots, Builder layout, and console capture are redesigned together.
- WebGPU runtime backend hot-swapping is out of scope. Phase 3 selects the
  renderer at boot so the input manager binds to one stable canvas.
