/**
 * Parallax math for the depth planes — one place, shared by the kit bake,
 * the foreground quad, the particles and the tests.
 *
 * Conventions: the camera position is the view's TOP-LEFT in world cells
 * (ctx.camera.x / renderX), the view is VIEW_W × VIEW_H cells, and a plane
 * with parallax P moves P× the camera: P < 1 recedes behind the play layer,
 * P = 1 is the play layer, P > 1 passes in front of it.
 */

/** Positive modulo. */
export function wrap(v: number, n: number): number {
  return ((v % n) + n) % n;
}

/**
 * The backdrop texel the compositors sample for a view column/row (the
 * CPU/GLSL/WGSL mapping, integer camera): floor((floor(cam·speed) + v) / scale + offset), wrapped.
 */
export function backdropTexel(cam: number, view: number, speed: number, scale: number, offset: number, size: number): number {
  return wrap(Math.floor((Math.floor(cam * speed) + view) / Math.max(0.25, scale) + offset), size);
}

/** Foreground plane coordinate (cells) of a world point while the camera sits at `cam`. */
export function foregroundCoord(world: number, cam: number, parallax: number): number {
  return world + cam * (parallax - 1);
}

/** Plane extent (cells) the foreground must cover so every camera position finds art: W + (W - V)(P - 1). */
export function foregroundExtent(worldSize: number, viewSize: number, parallax: number): number {
  return Math.ceil(worldSize + Math.max(0, worldSize - viewSize) * Math.max(0, parallax - 1));
}

/** The camera's top-left when it centres on `focus` (clamped to the world like the follow camera). */
export function cameraFor(focus: number, viewSize: number, worldSize: number): number {
  return Math.max(0, Math.min(Math.max(0, worldSize - viewSize), focus - viewSize / 2));
}

/**
 * Plane coordinate for an authored foreground piece: where it must sit so it
 * lands at `screen` (cells from the view's left/top) when the camera frames
 * `focus`. Used to frame floor 1's rooms deliberately instead of scattering.
 */
export function framingAnchor(focus: number, screen: number, viewSize: number, worldSize: number, parallax: number): number {
  const cam = cameraFor(focus, viewSize, worldSize);
  return cam * parallax + screen;
}

/**
 * Screen position (cells from the view edge; may be negative inside the
 * margin) of a particle whose plane position is `plane`, for a field that
 * repeats every `span` plane cells and hides `margin` cells off each edge.
 */
export function particleScreen(plane: number, cam: number, parallax: number, span: number, margin: number): number {
  return wrap(plane - cam * parallax, span) - margin;
}

/**
 * Breathing opacity for animated planes (light shafts): opacity at tick
 * `frame`, dipping by `amp` on a `period`-tick sine. Never exceeds the base.
 */
export function pulseOpacity(base: number, amp: number, period: number, frame: number, phase = 0): number {
  const s = 0.5 + 0.5 * Math.sin(((frame % period) / period) * Math.PI * 2 + phase);
  return base * (1 - amp + amp * s);
}
