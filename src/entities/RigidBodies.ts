import { HEIGHT, WIDTH } from '@/config/constants';
import type { Ctx, RigidBodiesApi, RigidBody, RigidShape, SpawnBodyOpts } from '@/core/types';
import { PLAYER_CRAWL_H, PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import { blocksEntity, Cell } from '@/sim/CellType';
import { ashColor, COLOR_FN, fireColor, packRGB, smokeColor } from '@/sim/colors';
import { bodyMaterialDef, WATER_DENSITY } from '@/entities/bodyMaterials';
import type { World } from '@/sim/World';
import { RAPIER } from '@/entities/rapierInit';

/**
 * Rigid-body layer backed by Rapier2D.
 *
 * Why Rapier and not the hand-rolled solver: a stable, warm-started constraint
 * solver gives correct resting/stacking, rolling, and bounce with none of the
 * grid-contact jitter a from-scratch voxel solver fights. The only thing Rapier
 * can't do for us is collide against a cave that mutates every frame — so we
 * feed it terrain as SMALL PER-BODY colliders: each tick, for every awake body,
 * the solid surface cells in a window around it become 1×1 fixed cuboids, with
 * persistent colliders reused frame-to-frame (delta add/remove) so Rapier keeps
 * its contact warm-starting. No whole-cave polygonisation, bounded cost.
 *
 * Units: the world is stepped at dt = 1/60 with everything scaled by PF = 60, so
 * Rapier runs in cells/second internally while the public API stays in the
 * cells/frame the rest of the game tunes in (impulses are velocity kicks).
 *
 * The `RigidBody` objects in `bodies` are a read-only mirror, refreshed each
 * step. Bodies are transient: cleared on every level change.
 */

const PF = 60; // frames per second — converts cells/frame ↔ cells/second
const DT = 1 / PF;
const GRAVITY = 0.28 * PF * PF; // 0.28 cells/frame² → cells/second²
const TERRAIN_MARGIN = 3; // base cells of terrain colliders around each body (grows with speed)
const REMOVE_DELAY = 4; // frames a stale terrain collider lingers before removal
const REFERENCE_MASS = 45; // a "typical" crate; blast/kick scale a body's throw by REFERENCE_MASS / mass
const PUSH_MASS_MAX = 60; // player shoves bodies up to this mass (light wood); heavier ones block
const MIN_PUSH = 0.7; // minimum shove speed (cells/frame) when the player leans on a light body
const PUSH_TRANSFER = 0.9; // fraction of the player's walk speed transferred into the shoved body
const BURN_FRAMES = 150; // a flammable (wood) body burns ~2.5s before it chars to ash
const FROST_CONTACT_FRAMES = 50; // freeze duration refreshed each frame a body touches ice
const FROST_DAMP = 0.65; // per-frame velocity retention while frozen (locks it in place)
const DIG_PUSH = 24; // mass-aware momentum the dig beam imparts to bodies in its path
const DIG_REACH = 6; // perpendicular cells the dig beam shoves bodies within
const SHATTER_RADIUS_MIN = 6.5; // bodies bigger than this (diagonal) shatter under a strong close blast
const SHATTER_FALLOFF = 0.4; // blast must land within (1 - d/radius) ≥ this to shatter
const SHATTER_POWER = 1.5; // ...and strength·falloff ≥ this (a bomb shatters, a weak spark only shoves)
const SHATTER_PIECES = 3; // small crates a large one breaks into
const WATER_DRAG = 0.15; // per-frame velocity damp while fully submerged (viscosity)
const SPLASH_MIN_SPEED = 1.2 * PF; // min downward speed (cells/s) to splash on water entry
const GRAB_REACH = 18; // cells in front of the player a body can be grabbed from
const GRAB_ARC = 1.1; // grab cone half-angle (radians)
const GRAB_MASS_MAX = 200; // heaviest body the player can grab (large-metal is too heavy)
const GRAB_HOLD_DIST = 12; // distance the held body floats in front of the hands
const GRAB_STIFFNESS = 0.45; // per-frame fraction of the gap the held body closes
const GRAB_MAX_SPEED = 7; // cap on the held body's tracking speed (cells/frame)
const THROW_SPEED = 9; // launch speed when the held body is thrown (cells/frame)
const BARREL_FUSE = 45; // frames a lit explosive barrel burns before it blows
const BARREL_BLAST = 24; // explosion radius of a detonating barrel

type RWorld = InstanceType<typeof RAPIER.World>;
type RBody = InstanceType<typeof RAPIER.RigidBody>;
type RCollider = InstanceType<typeof RAPIER.Collider>;

export class RigidBodies implements RigidBodiesApi {
  readonly bodies: RigidBody[] = [];
  private readonly world: RWorld;
  private readonly handles = new Map<RigidBody, RBody>();
  private readonly terrain = new Map<number, RCollider>();
  /** Cell index → frame it left the desired set. Removal is DEFERRED a few frames
   *  so we never yank a collider out of an active contact with a fast body (that
   *  recursion-crashes Rapier); by then the body has moved off it. */
  private readonly terrainStale = new Map<number, number>();
  private readonly desired = new Set<number>();
  private nextId = 1;
  /** The body the player is currently carrying (grab/throw), or null. */
  private held: RigidBody | null = null;
  /** Explosive barrels queued to detonate (processed once per tick → chains ripple). */
  private detonations: RigidBody[] = [];

  constructor(private readonly ctx: Ctx) {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY });
    this.world.integrationParameters.dt = DT;
    // Bodies are per-level transient state (like projectiles/particles).
    ctx.events.on('levelChanged', () => this.clear());
  }

  spawn(shape: RigidShape, x: number, y: number, opts: SpawnBodyOpts = {}): RigidBody {
    const kinematic = opts.kind === 'kinematic';
    const desc = (kinematic ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(x, y)
      .setRotation(opts.angle ?? 0)
      .setLinvel((opts.vx ?? 0) * PF, (opts.vy ?? 0) * PF)
      .setAngvel((opts.va ?? 0) * PF)
      .setCcdEnabled(true);
    const rb = this.world.createRigidBody(desc);
    const matDef = opts.material ? bodyMaterialDef(opts.material) : null;
    const density = opts.density ?? matDef?.density ?? 1;
    const color = opts.color ?? matDef?.color ?? packRGB(150, 100, 55);
    const restitution = opts.restitution ?? 0.2;
    const friction = opts.friction ?? 0.6;
    const colDesc = (
      shape.kind === 'box' ? RAPIER.ColliderDesc.cuboid(shape.halfW, shape.halfH) : RAPIER.ColliderDesc.ball(shape.radius)
    )
      .setDensity(density)
      .setRestitution(restitution)
      .setFriction(friction);
    this.world.createCollider(colDesc, rb);
    const mass = rb.mass();

    const body: RigidBody = {
      id: this.nextId++,
      kind: opts.kind ?? 'dynamic',
      shape,
      x,
      y,
      vx: opts.vx ?? 0,
      vy: opts.vy ?? 0,
      angle: opts.angle ?? 0,
      va: opts.va ?? 0,
      // invMass/invInertia/grounded/restT are vestigial mirror fields kept for
      // interface compatibility; Rapier owns the real mass/inertia/sleep state.
      invMass: mass > 0 ? 1 / mass : 0,
      invInertia: 0,
      grounded: false,
      restT: 0,
      restitution,
      friction,
      color,
      material: opts.material,
      density,
      payload: opts.payload,
      sleeping: false,
      tag: opts.tag,
      data: opts.data,
      onTerrainHit: opts.onTerrainHit,
    };
    this.handles.set(body, rb);
    this.bodies.push(body);
    return body;
  }

  remove(body: RigidBody): void {
    const rb = this.handles.get(body);
    if (rb) {
      this.world.removeRigidBody(rb); // also removes its colliders
      this.handles.delete(body);
    }
    const i = this.bodies.indexOf(body);
    if (i !== -1) this.bodies.splice(i, 1);
  }

  clear(): void {
    this.held = null;
    this.detonations.length = 0;
    for (const rb of this.handles.values()) this.world.removeRigidBody(rb);
    this.handles.clear();
    this.bodies.length = 0;
    for (const col of this.terrain.values()) this.world.removeCollider(col, false);
    this.terrain.clear();
    this.terrainStale.clear();
  }

  applyImpulse(body: RigidBody, ix: number, iy: number): void {
    const rb = this.handles.get(body);
    if (!rb) return;
    const v = rb.linvel();
    rb.setLinvel({ x: v.x + ix * PF, y: v.y + iy * PF }, true);
  }

  applyImpulseAt(body: RigidBody, ix: number, iy: number, px: number, py: number): void {
    const rb = this.handles.get(body);
    if (!rb) return;
    // Velocity kick at a point → Rapier impulse = mass · Δv; gives linear + spin.
    const m = rb.mass();
    rb.applyImpulseAtPoint({ x: ix * PF * m, y: iy * PF * m }, { x: px, y: py }, true);
  }

  applyMomentumAt(body: RigidBody, mx: number, my: number, px: number, py: number): void {
    const rb = this.handles.get(body);
    if (!rb) return;
    // (mx,my) is a TRUE impulse (momentum): Rapier adds Δv = impulse/mass, so a
    // heavy body resists. ·PF converts the cells/frame momentum to cells/second.
    rb.applyImpulseAtPoint({ x: mx * PF, y: my * PF }, { x: px, y: py }, true);
  }

  hitTest(x: number, y: number): RigidBody | null {
    for (const body of this.bodies) {
      if (body.kind !== 'dynamic') continue;
      const dx = x - body.x;
      const dy = y - body.y;
      const shape = body.shape;
      if (shape.kind === 'circle') {
        const r = shape.radius + 1;
        if (dx * dx + dy * dy <= r * r) return body;
      } else {
        // Rotate the point into the body's local frame (−angle) and test the box.
        const c = Math.cos(-body.angle);
        const s = Math.sin(-body.angle);
        const lx = dx * c - dy * s;
        const ly = dx * s + dy * c;
        if (Math.abs(lx) <= shape.halfW + 1 && Math.abs(ly) <= shape.halfH + 1) return body;
      }
    }
    return null;
  }

  grab(ctx: Ctx): void {
    if (this.held) return;
    const p = ctx.player;
    if (p.dead || p.climbing || ctx.state.mode !== 'play') return;
    const ox = p.x;
    const oy = p.y - 8;
    const dirX = Math.cos(p.aimAngle);
    const dirY = Math.sin(p.aimAngle);
    const cosArc = Math.cos(GRAB_ARC);
    let best: RigidBody | null = null;
    let bestD = Infinity;
    for (const body of this.bodies) {
      if (body.kind !== 'dynamic') continue;
      const mass = body.invMass && body.invMass > 0 ? 1 / body.invMass : Infinity;
      if (mass > GRAB_MASS_MAX) continue;
      const dx = body.x - ox;
      const dy = body.y - oy;
      const d = Math.hypot(dx, dy) || 0.001;
      const reach = GRAB_REACH + (body.shape.kind === 'circle' ? body.shape.radius : 5);
      if (d > reach) continue;
      if ((dx / d) * dirX + (dy / d) * dirY < cosArc) continue;
      if (d < bestD) {
        bestD = d;
        best = body;
      }
    }
    if (!best) return;
    this.held = best;
    ctx.audio.tone(320, 220, 0.06, 'square', 0.08); // grab snap
  }

  release(ctx: Ctx): void {
    const held = this.held;
    if (!held) return;
    this.held = null;
    const rb = this.handles.get(held);
    if (!rb) return;
    const p = ctx.player;
    const vx = (Math.cos(p.aimAngle) * THROW_SPEED + p.vx * 0.5) * PF;
    const vy = (Math.sin(p.aimAngle) * THROW_SPEED + p.vy * 0.5) * PF;
    rb.setLinvel({ x: vx, y: vy }, true);
    rb.setAngvel((Math.random() - 0.5) * 6, true);
    held.vx = vx / PF;
    held.vy = vy / PF;
    ctx.audio.tone(210, 90, 0.1, 'square', 0.09); // throw
  }

  igniteArea(x: number, y: number, radius: number): number {
    if (radius <= 0) return 0;
    const r2 = radius * radius;
    let lit = 0;
    for (const body of this.bodies) {
      if (body.kind !== 'dynamic' || body.burnT) continue;
      const matDef = body.material ? bodyMaterialDef(body.material) : null;
      if (!matDef?.flammable) continue;
      const [ex, ey] = bodyExtents(body);
      const dx = Math.max(Math.abs(x - body.x) - ex, 0);
      const dy = Math.max(Math.abs(y - body.y) - ey, 0);
      if (dx * dx + dy * dy > r2) continue;
      // explosive barrels burn a short fuse then blow; everything else chars to ash
      body.burnT = (body.payload === 'explosive' ? BARREL_FUSE : BURN_FRAMES) + Math.floor(Math.random() * 40);
      lit++;
    }
    return lit;
  }

  /** Track the held body to the hand point each frame (stays dynamic so it still
   *  bumps the world); drops it if the body's gone or the player died. */
  private trackHeld(ctx: Ctx): void {
    const held = this.held;
    if (!held) return;
    const rb = this.handles.get(held);
    const p = ctx.player;
    if (!rb || p.dead || ctx.state.mode !== 'play') {
      this.held = null;
      return;
    }
    const hx = p.x + Math.cos(p.aimAngle) * GRAB_HOLD_DIST;
    const hy = p.y - 8 + Math.sin(p.aimAngle) * GRAB_HOLD_DIST;
    const t = rb.translation();
    let vx = (hx - t.x) * GRAB_STIFFNESS * PF;
    let vy = (hy - t.y) * GRAB_STIFFNESS * PF;
    const cap = GRAB_MAX_SPEED * PF;
    const sp = Math.hypot(vx, vy);
    if (sp > cap) {
      const s = cap / sp;
      vx *= s;
      vy *= s;
    }
    rb.setLinvel({ x: vx, y: vy }, true);
    rb.setAngvel(rb.angvel() * 0.55, true);
    held.vx = vx / PF;
    held.vy = vy / PF;
  }

  applyRadialImpulse(cx: number, cy: number, radius: number, strength: number): void {
    if (radius <= 0) return;
    let toShatter: RigidBody[] | null = null;
    for (const body of this.bodies) {
      if (body.kind !== 'dynamic') continue;
      const rb = this.handles.get(body);
      if (!rb) continue;
      const t = rb.translation();
      const dx = t.x - cx;
      const dy = t.y - cy;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const falloff = 1 - d / radius;
      // An explosive barrel caught in a blast detonates (deferred → chain ripple).
      if (body.payload === 'explosive' && falloff >= 0.3) {
        this.queueDetonation(body);
        continue;
      }
      // A large BRITTLE body (wood/stone — one that leaves rubble; metal is tough)
      // caught in a strong, close blast SHATTERS into smaller crates instead of
      // just being flung (deferred — don't mutate the bodies list mid-iteration).
      const brittle = body.material ? bodyMaterialDef(body.material).gore !== null : false;
      if (
        brittle &&
        shapeRadius(body.shape) >= SHATTER_RADIUS_MIN &&
        falloff >= SHATTER_FALLOFF &&
        strength * falloff >= SHATTER_POWER
      ) {
        (toShatter ??= []).push(body);
        continue;
      }
      // Mass-scaled so material matters: a light wood crate is flung, a heavy
      // metal one barely budges (relative to a reference-mass crate).
      const massScale = REFERENCE_MASS / Math.max(REFERENCE_MASS * 0.25, rb.mass());
      const mag = strength * falloff * massScale;
      const nx = dx / (d || 1);
      const ny = dy / (d || 1);
      // Apply on the near side so the blast also spins it; bias upward.
      const br = shapeRadius(body.shape) * 0.5;
      this.applyImpulseAt(body, nx * mag, ny * mag - mag * 0.35, t.x - nx * br, t.y - ny * br);
    }
    if (toShatter) for (const body of toShatter) this.shatterBody(body, cx, cy);
  }

  /** A large body destroyed by a blast: scatter rubble cells + spawn smaller
   *  crates of the same material, flung outward from the blast centre. */
  private shatterBody(body: RigidBody, cx: number, cy: number): void {
    const world = this.ctx.world;
    const half = body.shape.kind === 'circle' ? body.shape.radius : body.shape.halfW;
    const mat = body.material;
    const gore = mat ? bodyMaterialDef(mat).gore : null;
    const bx = body.x;
    const by = body.y;
    const friction = body.friction;
    const restitution = body.restitution;
    this.remove(body);
    // Rubble: strew the material's gore cells across the wreck (metal leaves none).
    // Stamp over any OPEN cell (empty or the blast's fire/smoke) so the pile lands
    // even amid an explosion's aftermath.
    if (gore !== null) {
      const tint = COLOR_FN[gore] ?? ashColor;
      const x0 = Math.max(1, Math.floor(bx - half));
      const x1 = Math.min(WIDTH - 2, Math.ceil(bx + half));
      const y0 = Math.max(1, Math.floor(by - half));
      const y1 = Math.min(HEIGHT - 2, Math.ceil(by + half));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const idx = world.idx(x, y);
          const t = world.types[idx];
          if ((t === Cell.Empty || t === Cell.Fire || t === Cell.Smoke || t === Cell.Steam) && Math.random() < 0.55) {
            world.replaceCellAt(idx, gore, tint());
          }
        }
      }
    }
    // Pieces: smaller crates of the same material, flung away from the blast.
    const ph = Math.max(2.5, half * 0.42);
    for (let i = 0; i < SHATTER_PIECES; i++) {
      const a = (i / SHATTER_PIECES) * Math.PI * 2 + Math.random();
      const sx = bx + Math.cos(a) * half * 0.6;
      const sy = by + Math.sin(a) * half * 0.6;
      const piece = this.spawn({ kind: 'box', halfW: ph, halfH: ph }, sx, sy, { material: mat, friction, restitution });
      const dx = sx - cx;
      const dy = sy - cy;
      const dd = Math.hypot(dx, dy) || 1;
      this.applyImpulse(piece, (dx / dd) * 3.5, (dy / dd) * 3.5 - 1.5);
    }
    this.ctx.particles.burst(bx, by, 18, null, () => packRGB(160, 140, 110), 2.4, { grav: 0.05 });
    this.ctx.audio.noiseBurst(0.14, 300, 0.1);
  }

  /** Queue an explosive barrel to detonate next tick (idempotent). */
  private queueDetonation(body: RigidBody): void {
    if (body.payload !== 'explosive' || this.detonations.includes(body)) return;
    this.detonations.push(body);
  }

  /** Detonate the barrels queued as of this tick; their blasts queue any nearby
   *  barrels for the NEXT tick, so a chain reaction ripples across frames. */
  private processDetonations(ctx: Ctx): void {
    if (this.detonations.length === 0) return;
    const batch = this.detonations;
    this.detonations = [];
    for (const body of batch) {
      if (!this.handles.has(body)) continue;
      const bx = body.x;
      const by = body.y;
      this.remove(body); // remove before the blast so it isn't re-queued by its own explosion
      ctx.particles.burst(bx, by, 26, null, () => packRGB(255, 180, 70), 2.8, { glow: 2.8, grav: 0.02 });
      ctx.explosions.trigger(bx, by, BARREL_BLAST);
    }
  }

  update(ctx: Ctx): void {
    this.processDetonations(ctx);
    this.syncTerrain(ctx.world, ctx.state.frameCount);
    this.world.step();
    for (const body of this.bodies) {
      const rb = this.handles.get(body);
      if (!rb) continue;
      const t = rb.translation();
      const v = rb.linvel();
      body.x = t.x;
      body.y = t.y;
      body.angle = rb.rotation();
      body.vx = v.x / PF;
      body.vy = v.y / PF;
      body.va = rb.angvel() / PF;
      body.sleeping = rb.isSleeping();
    }
    this.reactBodies(ctx);
    this.trackHeld(ctx); // after reactBodies so carrying overrides buoyancy/etc.
    this.resolvePlayer(ctx);
  }

  /**
   * P2 spell/material reactions, grid-truthful: flammable bodies ignite from hot
   * cells and burn up into ash; frost (cells or shots) freezes a body's motion;
   * the dig beam shoves bodies aside. (Lightning→metal lives in Lightning.cast;
   * direct projectile hits in Projectiles.impactBody.)
   */
  private reactBodies(ctx: Ctx): void {
    const world = ctx.world;
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const body = this.bodies[i];
      if (body.kind !== 'dynamic') continue;
      const matDef = body.material ? bodyMaterialDef(body.material) : null;

      // FIRE — a flammable body lit by adjacent fire/lava/ember burns, then chars to ash.
      if (matDef?.flammable) {
        if (!body.burnT) {
          if (this.scanFootprint(world, body, 1, isHotCell)) {
            // explosive barrels burn a short fuse, then blow instead of charring
            body.burnT = (body.payload === 'explosive' ? BARREL_FUSE : BURN_FRAMES) + Math.floor(Math.random() * 40);
            ctx.audio.noiseBurst(0.1, 480, 0.05);
          }
        } else {
          body.burnT--;
          ctx.particles.spawn(
            body.x + (Math.random() - 0.5) * 4,
            body.y + (Math.random() - 0.5) * 4,
            (Math.random() - 0.5) * 0.4,
            -0.5 - Math.random() * 0.5,
            null,
            fireColor(),
            14,
            { grav: -0.02, glow: 2.4 },
          );
          if (ctx.state.frameCount % 5 === 0) ctx.particles.spawn(body.x, body.y - 3, 0, -0.4, null, smokeColor(), 40, { grav: -0.02 });
          if (Math.random() < 0.12) this.shedFire(world, body);
          if (body.burnT <= 0) {
            if (body.payload === 'explosive') {
              this.queueDetonation(body); // the detonation removes it
              continue;
            }
            this.burnUpBody(ctx, body);
            this.remove(body);
            continue;
          }
        }
      }

      // FROST — touching ice refreshes the freeze; while frozen the body's motion is damped.
      if (this.scanFootprint(world, body, 1, isFrostCell)) {
        body.frozenT = Math.max(body.frozenT ?? 0, FROST_CONTACT_FRAMES);
      }
      if (body.frozenT && body.frozenT > 0) {
        body.frozenT--;
        const rb = this.handles.get(body);
        if (rb) {
          const v = rb.linvel();
          rb.setLinvel({ x: v.x * FROST_DAMP, y: v.y * FROST_DAMP }, true);
          rb.setAngvel(rb.angvel() * FROST_DAMP, true);
        }
        if (ctx.state.frameCount % 8 === 0)
          ctx.particles.spawn(body.x + (Math.random() - 0.5) * 4, body.y + (Math.random() - 0.5) * 4, 0, 0.1, null, packRGB(180, 225, 255), 16, { glow: 1.4 });
      }

      // WATER — Archimedes buoyancy (material vs water) + viscous drag, with a
      // splash of real water cells when a body first plunges in fast.
      const submerged = this.submergedFraction(world, body);
      if (submerged > 0.05) {
        const rb = this.handles.get(body);
        if (rb) {
          const v = rb.linvel();
          if (body.inWater !== true && v.y > SPLASH_MIN_SPEED) this.splash(ctx, body, v.y);
          const density = Math.max(0.2, body.density ?? 1);
          const buoy = submerged * (WATER_DENSITY / density) * GRAVITY * DT; // upward (−y)
          const drag = 1 - Math.min(0.5, submerged * WATER_DRAG);
          const nvx = v.x * drag;
          const nvy = (v.y - buoy) * drag;
          rb.setLinvel({ x: nvx, y: nvy }, true);
          rb.setAngvel(rb.angvel() * drag, true);
          body.vx = nvx / PF;
          body.vy = nvy / PF;
        }
        body.inWater = true;
      } else {
        body.inWater = false;
      }
    }
    this.digPush(ctx);
  }

  /** Fraction of a body's footprint cells currently filled with water (0..1). */
  private submergedFraction(world: World, body: RigidBody): number {
    const [ex, ey] = bodyExtents(body);
    const x0 = Math.max(0, Math.floor(body.x - ex));
    const x1 = Math.min(WIDTH - 1, Math.ceil(body.x + ex));
    const y0 = Math.max(0, Math.floor(body.y - ey));
    const y1 = Math.min(HEIGHT - 1, Math.ceil(body.y + ey));
    const types = world.types;
    let water = 0;
    let total = 0;
    for (let y = y0; y <= y1; y++) {
      const row = y * WIDTH;
      for (let x = x0; x <= x1; x++) {
        total++;
        if (types[row + x] === Cell.Water) water++;
      }
    }
    return total > 0 ? water / total : 0;
  }

  /** Eject a fan of real water cells when a body plunges in (scaled by impact). */
  private splash(ctx: Ctx, body: RigidBody, vySpeed: number): void {
    const ex = bodyExtents(body)[0];
    const speed = vySpeed / PF; // cells/frame
    const n = Math.min(48, Math.floor(5 + speed * ex));
    const color = COLOR_FN[Cell.Water];
    for (let k = 0; k < n; k++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.7; // up + spread
      const sp = 0.7 + Math.random() * speed * 0.6;
      // erupt ABOVE the body (over air) so droplets arc up and read as a splash
      // instead of being absorbed the instant they spawn inside the pool.
      ctx.particles.spawn(
        body.x + (Math.random() * 2 - 1) * ex,
        body.y - ex,
        Math.cos(ang) * sp,
        Math.sin(ang) * sp - 0.6,
        Cell.Water,
        color ? color() : packRGB(60, 120, 200),
        36,
        { grav: 0.08, glow: 0.4 },
      );
    }
    ctx.audio.bubble();
  }

  /** True if any cell within `margin` of the body's footprint passes `test`. */
  private scanFootprint(world: World, body: RigidBody, margin: number, test: (t: number) => boolean): boolean {
    const [ex, ey] = bodyExtents(body);
    const x0 = Math.max(1, Math.floor(body.x - ex - margin));
    const x1 = Math.min(WIDTH - 2, Math.ceil(body.x + ex + margin));
    const y0 = Math.max(1, Math.floor(body.y - ey - margin));
    const y1 = Math.min(HEIGHT - 2, Math.ceil(body.y + ey + margin));
    const types = world.types;
    for (let y = y0; y <= y1; y++) {
      const row = y * WIDTH;
      for (let x = x0; x <= x1; x++) if (test(types[row + x])) return true;
    }
    return false;
  }

  /** A burning body spits a real fire cell into an empty footprint cell (spreads). */
  private shedFire(world: World, body: RigidBody): void {
    const [ex, ey] = bodyExtents(body);
    const x = Math.floor(body.x + (Math.random() * 2 - 1) * ex);
    const y = Math.floor(body.y + (Math.random() * 2 - 1) * ey);
    if (!world.inBounds(x, y)) return;
    const idx = world.idx(x, y);
    if (world.types[idx] === Cell.Empty) {
      world.replaceCellAt(idx, Cell.Fire, fireColor());
      world.life[idx] = 30 + Math.floor(Math.random() * 30);
    }
  }

  /** Consume a burned-up body: strew real ash (+ a little fire) across its footprint. */
  private burnUpBody(ctx: Ctx, body: RigidBody): void {
    const world = ctx.world;
    const [ex, ey] = bodyExtents(body);
    const x0 = Math.max(1, Math.floor(body.x - ex));
    const x1 = Math.min(WIDTH - 2, Math.ceil(body.x + ex));
    const y0 = Math.max(1, Math.floor(body.y - ey));
    const y1 = Math.min(HEIGHT - 2, Math.ceil(body.y + ey));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const idx = world.idx(x, y);
        if (world.types[idx] !== Cell.Empty) continue;
        const roll = Math.random();
        if (roll < 0.55) {
          world.replaceCellAt(idx, Cell.Ash, ashColor());
        } else if (roll < 0.68) {
          world.replaceCellAt(idx, Cell.Fire, fireColor());
          world.life[idx] = 40;
        }
      }
    }
    ctx.particles.burst(body.x, body.y, 22, null, smokeColor, 2.6, { grav: -0.02 });
    ctx.particles.burst(body.x, body.y, 12, null, fireColor, 2.0, { glow: 2.6, grav: -0.01 });
    ctx.audio.noiseBurst(0.14, 220, 0.08);
  }

  /** The dig beam (if active this frame) shoves bodies in its path, mass-aware. */
  private digPush(ctx: Ctx): void {
    const beam = ctx.fx.digBeam;
    if (!beam || beam.life <= 0) return;
    const dx = beam.x1 - beam.x0;
    const dy = beam.y1 - beam.y0;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    for (const body of this.bodies) {
      if (body.kind !== 'dynamic') continue;
      const rx = body.x - beam.x0;
      const ry = body.y - beam.y0;
      const t = Math.max(0, Math.min(len, rx * ux + ry * uy));
      const d = Math.hypot(body.x - (beam.x0 + ux * t), body.y - (beam.y0 + uy * t));
      const reach = DIG_REACH + (body.shape.kind === 'circle' ? body.shape.radius : 5);
      if (d > reach) continue;
      this.applyMomentumAt(body, ux * DIG_PUSH, uy * DIG_PUSH, body.x, body.y);
    }
  }

  /**
   * Make bodies solid to the player (a custom controller, not a Rapier body):
   * after the step, push the player out of any body it overlaps — standing on
   * top (grounds + lets him jump off next frame), bonking his head, or being
   * blocked sideways by a heavy body while shoving a light one aside. Runs once
   * per frame against the player's post-move position.
   */
  private resolvePlayer(ctx: Ctx): void {
    const player = ctx.player;
    if (ctx.state.mode !== 'play' || player.dead || player.climbing || player.swinging) return;
    const bodyH = player.crawling ? PLAYER_CRAWL_H : PLAYER_H;
    for (const body of this.bodies) {
      if (body.kind !== 'dynamic') continue;
      if (body === this.held) continue; // don't shove the player off its own carried body
      if (Math.abs(body.x - player.x) > 48 || Math.abs(body.y - player.y) > 48) continue;
      this.resolvePlayerVsBody(player, body, bodyH);
    }
  }

  private resolvePlayerVsBody(player: Ctx['player'], body: RigidBody, bodyH: number): boolean {
    const feetY = player.y;
    const headY = player.y - bodyH;
    const left = player.x - PLAYER_HALF_W;
    const right = player.x + PLAYER_HALF_W;
    const [ex, ey] = bodyExtents(body);
    const bL = body.x - ex;
    const bR = body.x + ex;
    const bT = body.y - ey;
    const bB = body.y + ey;
    if (right <= bL || left >= bR) return false; // no horizontal overlap

    // 1) Standing on top — 1-cell ground tolerance (no flicker), penetration
    //    capped by fall speed so a fast drop still snaps cleanly to the surface.
    const landTol = Math.max(2, player.vy + 1);
    if (player.vy >= -0.1 && feetY >= bT - 1 && feetY <= bT + landTol && headY < bT) {
      player.y = bT;
      if (player.vy > 0) player.vy = 0;
      player.grounded = true;
      return true;
    }

    const overlapY = Math.min(feetY, bB) - Math.max(headY, bT);
    if (overlapY <= 0) return false;

    // 2) Head bonk from below.
    if (player.vy < 0 && feetY > bB) {
      player.y = bB + bodyH;
      player.vy = 0;
      return true;
    }

    // 3) Side contact: shove a light body aside, be blocked by a heavy one.
    //    Resolve to the side the player is APPROACHING FROM (his trailing side),
    //    chosen by relative velocity — so a player faster than the crate he's
    //    pushing never crosses its centre and tunnels through, and a crate wedged
    //    against a wall blocks him instead of ejecting him out the far face.
    const mass = body.invMass && body.invMass > 0 ? 1 / body.invMass : Infinity;
    const light = mass <= PUSH_MASS_MAX;
    const shove = Math.max(Math.abs(player.vx), MIN_PUSH) * PUSH_TRANSFER;
    const relVx = player.vx - body.vx;
    const pushLeft = relVx > 0.05 ? true : relVx < -0.05 ? false : player.x < body.x;
    if (pushLeft) {
      if (light) this.applyImpulse(body, shove, -0.03);
      player.x = bL - PLAYER_HALF_W;
      if (light) player.vx *= 0.6;
      else if (player.vx > 0) player.vx = 0;
    } else {
      if (light) this.applyImpulse(body, -shove, -0.03);
      player.x = bR + PLAYER_HALF_W;
      if (light) player.vx *= 0.6;
      else if (player.vx < 0) player.vx = 0;
    }
    return true;
  }

  /**
   * Delta-update the terrain colliders so Rapier collides with the cave. Build
   * fixed 1×1 cuboids for solid SURFACE cells in a window around each body, sized
   * by the body's speed so colliders always exist BEFORE a fast body reaches them
   * (no deep penetration of a freshly-spawned collider). Sleeping bodies are
   * included so a resting body keeps its support. Removals are deferred.
   */
  private syncTerrain(world: World, frame: number): void {
    const types = world.types;
    const desired = this.desired;
    desired.clear();
    for (const body of this.bodies) {
      const rb = this.handles.get(body);
      if (!rb || body.kind !== 'dynamic') continue;
      const t = rb.translation();
      const v = rb.linvel();
      // Reach grows with speed (cells/frame) so the collider window leads motion.
      const lead = Math.ceil(Math.hypot(v.x, v.y) / PF);
      const r = shapeRadius(body.shape) + TERRAIN_MARGIN + lead;
      const x0 = Math.max(1, Math.floor(t.x - r));
      const x1 = Math.min(WIDTH - 2, Math.ceil(t.x + r));
      const y0 = Math.max(1, Math.floor(t.y - r));
      const y1 = Math.min(HEIGHT - 2, Math.ceil(t.y + r));
      for (let y = y0; y <= y1; y++) {
        const row = y * WIDTH;
        for (let x = x0; x <= x1; x++) {
          const i = row + x;
          if (!blocksEntity(types[i])) continue;
          // Surface only — skip cells fully buried in solid (bodies can't reach them).
          if (
            blocksEntity(types[i - 1]) &&
            blocksEntity(types[i + 1]) &&
            blocksEntity(types[i - WIDTH]) &&
            blocksEntity(types[i + WIDTH])
          )
            continue;
          desired.add(i);
        }
      }
    }
    // Additions first (and cancel any pending removal for cells back in use).
    for (const i of desired) {
      this.terrainStale.delete(i);
      if (this.terrain.has(i)) continue;
      const cx = i % WIDTH;
      const cy = (i / WIDTH) | 0;
      const desc = RAPIER.ColliderDesc.cuboid(0.5, 0.5).setTranslation(cx + 0.5, cy + 0.5).setFriction(0.9).setRestitution(0);
      this.terrain.set(i, this.world.createCollider(desc));
    }
    // Deferred removals (see terrainStale): hold a stale collider for a few
    // frames so a fast body moves off it before we remove it.
    for (const [i, col] of this.terrain) {
      if (desired.has(i)) continue;
      const since = this.terrainStale.get(i);
      if (since === undefined) {
        this.terrainStale.set(i, frame);
      } else if (frame - since >= REMOVE_DELAY) {
        this.world.removeCollider(col, true);
        this.terrain.delete(i);
        this.terrainStale.delete(i);
      }
    }
  }
}

function shapeRadius(shape: RigidShape): number {
  return shape.kind === 'circle' ? shape.radius : Math.hypot(shape.halfW, shape.halfH);
}

function isHotCell(t: number): boolean {
  return t === Cell.Fire || t === Cell.Lava || t === Cell.Ember;
}

function isFrostCell(t: number): boolean {
  return t === Cell.Ice || t === Cell.Snow;
}

/** Axis-aligned half-extents of a (possibly rotated) body — for player AABB resolve. */
function bodyExtents(body: RigidBody): [number, number] {
  const shape = body.shape;
  if (shape.kind === 'circle') return [shape.radius, shape.radius];
  const c = Math.abs(Math.cos(body.angle));
  const s = Math.abs(Math.sin(body.angle));
  return [shape.halfW * c + shape.halfH * s, shape.halfW * s + shape.halfH * c];
}
