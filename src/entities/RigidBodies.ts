import { HEIGHT, WIDTH } from '@/config/constants';
import type { Ctx, RigidBodiesApi, RigidBody, RigidShape, SpawnBodyOpts } from '@/core/types';
import { PLAYER_CRAWL_H, PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import { blocksEntity } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';
import { bodyMaterialDef } from '@/entities/bodyMaterials';
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

  constructor(ctx: Ctx) {
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

  applyRadialImpulse(cx: number, cy: number, radius: number, strength: number): void {
    if (radius <= 0) return;
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
  }

  update(ctx: Ctx): void {
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
    this.resolvePlayer(ctx);
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
    if (ctx.state.mode !== 'play' || player.dead || player.climbing) return;
    const bodyH = player.crawling ? PLAYER_CRAWL_H : PLAYER_H;
    for (const body of this.bodies) {
      if (body.kind !== 'dynamic') continue;
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
    //    Resolve to the NEAREST face (minimum penetration) so the player can
    //    never be flipped across the body's centre and ejected out the far side.
    const mass = body.invMass && body.invMass > 0 ? 1 / body.invMass : Infinity;
    const light = mass <= PUSH_MASS_MAX;
    const shove = Math.max(Math.abs(player.vx), MIN_PUSH) * PUSH_TRANSFER;
    const penLeft = right - bL; // depth if we push the player left (off the body's left face)
    const penRight = bR - left; // depth if we push the player right
    if (penLeft <= penRight) {
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

/** Axis-aligned half-extents of a (possibly rotated) body — for player AABB resolve. */
function bodyExtents(body: RigidBody): [number, number] {
  const shape = body.shape;
  if (shape.kind === 'circle') return [shape.radius, shape.radius];
  const c = Math.abs(Math.cos(body.angle));
  const s = Math.abs(Math.sin(body.angle));
  return [shape.halfW * c + shape.halfH * s, shape.halfW * s + shape.halfH * c];
}
