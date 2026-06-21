import type { Critter, Ctx, DebugControl, Enemy, RigidBody } from '@/core/types';
import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import { runtimeObjectId } from '@/game/runtimeSnapshot';

type DragKind = 'enemy' | 'player' | 'critter' | 'body';

/**
 * The Runtime-panel debug tool: a global freeze with per-entity "live" opt-ins
 * and mouse dragging of any entity. It owns no rendering and no DOM — the panel
 * flips `active` / `live`, the input layer routes the mouse into grab/release,
 * and the per-system update loops consult `frozen*()` to skip their AI. A held
 * Weaver's legs keep solving in the renderer (which never freezes), so dragging
 * it around is the live IK foot-placement bench.
 */
export class DebugTool implements DebugControl {
  active = false;
  readonly live = new Set<string>();
  dragRef: object | null = null;
  private dragKind: DragKind | null = null;
  private dragDX = 0;
  private dragDY = 0;

  constructor(private readonly ctx: Ctx) {}

  private activeInPlay(): boolean {
    return this.active && this.ctx.state.mode === 'play';
  }

  setActive(active: boolean): void {
    if (active) this.markTainted();
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      this.live.clear();
      this.release();
    }
  }

  setLive(id: string, live: boolean): boolean {
    if (!this.supportsLiveId(id)) return false;
    if (this.activeInPlay()) this.markTainted();
    if (live) this.live.add(id);
    else this.live.delete(id);
    return this.live.has(id);
  }

  toggleLive(id: string): boolean {
    return this.setLive(id, !this.live.has(id));
  }

  frozenEnemy(e: Enemy): boolean {
    if (!this.activeInPlay()) return false;
    if (e === this.dragRef) return true; // the grabbed body's AI yields to the mouse
    return !this.live.has(runtimeObjectId('enemy', e));
  }

  frozenCritter(c: Critter): boolean {
    if (!this.activeInPlay()) return false;
    if (c === this.dragRef) return true;
    return !this.live.has(runtimeObjectId('critter', c));
  }

  frozenPlayer(): boolean {
    if (!this.activeInPlay()) return false;
    if (this.ctx.player === this.dragRef) return true;
    return !this.live.has('player');
  }

  grabAt(x: number, y: number): boolean {
    if (!this.activeInPlay()) return false;
    const ctx = this.ctx;
    // Bodies first (they draw on top), then enemies, the player, and critters.
    const body = ctx.rigidBodies.hitTest(x, y);
    if (body) return this.begin('body', body, x, y);
    for (const e of ctx.enemies) {
      const def = ctx.enemyCtl.defs[e.kind];
      if (x >= e.x - def.halfW - 2 && x <= e.x + def.halfW + 2 && y >= e.y - def.h - 2 && y <= e.y + 3) {
        return this.begin('enemy', e, x, y);
      }
    }
    const p = ctx.player;
    if (!p.dead && x >= p.x - PLAYER_HALF_W - 2 && x <= p.x + PLAYER_HALF_W + 2 && y >= p.y - PLAYER_H - 2 && y <= p.y + 3) {
      return this.begin('player', p, x, y);
    }
    for (const c of ctx.critters.list) {
      if (Math.abs(x - c.x) <= 5 && Math.abs(y - c.y) <= 5) return this.begin('critter', c, x, y);
    }
    return false;
  }

  release(): void {
    this.dragRef = null;
    this.dragKind = null;
  }

  update(): void {
    if (!this.activeInPlay() || this.dragRef === null || this.dragKind === null) return;
    this.markTainted();
    const ctx = this.ctx;
    const mx = ctx.input.mouse.x + this.dragDX;
    const my = ctx.input.mouse.y + this.dragDY;
    if (this.dragKind === 'body') {
      ctx.rigidBodies.dragTo(this.dragRef as RigidBody, mx, my);
      return;
    }
    if (this.dragKind === 'enemy') {
      const e = this.dragRef as Enemy;
      e.x = mx;
      e.y = my;
      e.vx = 0;
      e.vy = 0;
      e.fx = 0;
      e.fy = 0;
      const def = ctx.enemyCtl.defs[e.kind];
      // Lifted vs set-down: recompute footing so a held Weaver's legs DANGLE in
      // the air and PLANT the instant it's lowered near a surface — the renderer
      // reads e.grounded to choose between the two (see EnemySprites weaver).
      e.grounded = !ctx.physics.entityFree(e.x, e.y + 1, def.halfW, 1);
      return;
    }
    if (this.dragKind === 'player') {
      const p = ctx.player;
      p.x = mx;
      p.y = my;
      p.vx = 0;
      p.vy = 0;
      p.fx = 0;
      p.fy = 0;
      return;
    }
    const c = this.dragRef as Critter;
    c.x = mx;
    c.y = my;
    c.vx = 0;
    c.vy = 0;
  }

  private begin(kind: DragKind, ref: { x: number; y: number }, x: number, y: number): boolean {
    this.markTainted();
    this.dragKind = kind;
    this.dragRef = ref;
    this.dragDX = ref.x - x; // keep the grab point under the cursor (no snap)
    this.dragDY = ref.y - y;
    return true;
  }

  private supportsLiveId(id: string): boolean {
    return id === 'player' || id.startsWith('enemy:') || id.startsWith('critter:');
  }

  private markTainted(): void {
    this.ctx.state.debugTainted = true;
  }
}
