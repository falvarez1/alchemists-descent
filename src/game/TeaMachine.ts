import type { Ctx, RigidBody, TeaMachineState } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { fireColor } from '@/sim/colors';
import { TEA, TEA_BODIES, stampTeaMachine, teaRect } from '@/world/teaMachine';

const ACTS = [
  ['The Unreasonable Bell & Tea Engine', 'The descent gate needs its brass bell. Pull the crank to begin.'],
  ['First, a little powder', 'A very long fuse. A very small spark.'],
  ['Percussive maintenance', 'A hanging weight politely introduces itself to a boulder.'],
  ['The boulder has a job', 'Gravity carries the message to the reservoir.'],
  ['Please mind the duck', 'Water lifts the float. The float pulls the solvent tap.'],
  ['Dissolving the safety precautions', 'Acid eats the stone pin holding the sugar weight.'],
  ['One lump or two?', 'The falling weight opens the furnace.'],
  ['An unreasonable kettle', 'Lava meets water. Steam pushes the piston.'],
  ['This is probably enough heat', 'The piston opens the oil. The last fuse has other ideas.'],
  ['Tea is served. The bell is yours.', 'Collect the brass bell at the receiver, then carry it to the descent gate.'],
] as const;

export function restoreTeaMachine(value: unknown): TeaMachineState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const s = value as Partial<TeaMachineState>;
  const finite = (n: unknown, fallback: number, min: number, max: number): number =>
    typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  return {
    stage: Math.floor(finite(s.stage, 0, 0, 9)), ticks: Math.floor(finite(s.ticks, 0, 0, 1000000)),
    stageTicks: Math.floor(finite(s.stageTicks, 0, 0, 1000000)), completed: s.completed === true && s.stage === 9,
    stalled: s.stalled === true,
    bodies: Array.isArray(s.bodies) ? TEA_BODIES.flatMap(def => {
      const b = s.bodies!.find(body => body?.key === def.key);
      if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return [];
      return [{ key: def.key, x: finite(b.x, def.x, 8, 1591), y: finite(b.y, def.y, 8, 1055),
        vx: finite(b.vx, 0, -20, 20), vy: finite(b.vy, 0, -20, 20), angle: finite(b.angle, 0, -10000, 10000),
        va: finite(b.va, 0, -1, 1), rope: b.rope === true }];
    }) : [],
  };
}

/** Observes physical handoffs. Timeouts return control; they NEVER complete a stage. */
export class TeaMachine {
  watching = false;
  private runtime: Ctx['levels']['current'] = null;
  private readonly bodies = new Map<string, RigidBody>();
  private returning = 0;
  private lastView = '';
  private readonly disposers: Array<() => void>;

  constructor(private readonly ctx: Ctx) {
    this.disposers = [ctx.events.on('levelChanged', () => this.leave()),
      ctx.events.on('modeChanged', () => { if (ctx.state.mode !== 'play') this.leave(); })];
  }

  dispose(): void { this.leave(); this.disposers.forEach(fn => fn()); }

  private leave(): void {
    this.watching = false; this.returning = 0; this.runtime = null; this.bodies.clear();
    this.ctx.camera.actionFocus = null; this.publish(false);
  }

  private initialize(): TeaMachineState | null {
    const rt = this.ctx.levels.current;
    if (!rt?.living || !rt.mechanisms.some(m => m.id === TEA.lever.id)) return null;
    if (this.runtime === rt) return rt.living.tea ?? null;
    this.runtime = rt; this.bodies.clear();
    const saved = rt.living.tea;
    const s = rt.living.tea ??= { stage: 0, ticks: 0, stageTicks: 0, completed: false, stalled: false, bodies: [] };
    for (const def of TEA_BODIES) {
      const old = saved?.bodies.find(b => b.key === def.key);
      if (saved && !old) continue; // a destroyed prop stays destroyed
      const existing = this.ctx.rigidBodies.bodies.find(b => b.tag === `tea-${def.key}`);
      if (existing) { this.bodies.set(def.key, existing); continue; }
      const b = this.ctx.rigidBodies.spawn(def.shape, old?.x ?? def.x, old?.y ?? def.y,
        { ...def.opts, ...(old ? { vx: old.vx, vy: old.vy, angle: old.angle, va: old.va } : {}), tag: `tea-${def.key}` });
      this.bodies.set(def.key, b);
      if (def.rope && (!old || old.rope)) this.ctx.rigidBodies.tieRope(b, def.rope.x, def.rope.y, def.rope.length);
    }
    this.snapshot(s);
    return s;
  }

  private snapshot(s: TeaMachineState): void {
    s.bodies = [...this.bodies].filter(([, b]) => this.ctx.rigidBodies.bodies.includes(b)).map(([key, b]) =>
      ({ key, x: b.x, y: b.y, vx: b.vx, vy: b.vy, angle: b.angle, va: b.va, rope: !!b.rope }));
  }

  private count(x: number, y: number, w: number, h: number, types: readonly number[]): number {
    let n = 0;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (types.includes(this.ctx.world.type(xx, yy))) n++;
    return n;
  }

  private spark(x: number, y: number): void {
    for (let dx = -1; dx <= 1; dx++) {
      const i = this.ctx.world.idx(x + dx, y);
      this.ctx.world.replaceCellAt(i, Cell.Fire, fireColor()); this.ctx.world.life[i] = 240;
    }
    this.ctx.audio.at(x, y, () => this.ctx.audio.zap());
  }

  private advance(s: TeaMachineState): void {
    s.stage++; s.stageTicks = 0;
    this.ctx.telemetry.count(`tea.stage${s.stage}`);
    this.ctx.audio.at(this.focus(s).x, this.focus(s).y, () => this.ctx.audio.lever());
  }

  private startWatching(): void {
    this.watching = true; this.returning = 0;
    this.ctx.player.firing = false; this.ctx.player.firePressed = false;
    this.ctx.input.pourHeld = false; this.ctx.input.siphonHeld = false; this.ctx.input.queuedJump = undefined;
    this.ctx.rigidBodies.release(this.ctx, false);
  }

  skip(): void { if (this.watching) this.returning = 1; }

  interact(): boolean {
    const s = this.ctx.levels.current?.living?.tea;
    if (!s || Math.hypot(this.ctx.player.x - TEA.lever.x, this.ctx.player.y - TEA.lever.y) > 35) return false;
    if (s.stalled) {
      // A deliberately labelled maintenance crank resets ONLY this machine.
      // The rest of the level, its inhabitants and collected rewards persist.
      for (const b of this.bodies.values()) this.ctx.rigidBodies.remove(b);
      stampTeaMachine(this.ctx.world, this.ctx.levels.current!.mechanisms, true);
      this.ctx.levels.current!.living!.tea = undefined;
      this.runtime = null; this.initialize();
      this.ctx.events.emit('toast', { text: 'Engine recharged. Pull the crank to try again.' });
      const lever = this.ctx.levels.current!.mechanisms.find(m => m.id === TEA.lever.id);
      if (lever) lever.state = 0;
      return true;
    }
    if (s.stage > 0 && !s.completed) { this.startWatching(); return true; }
    return s.completed;
  }

  includeSimulation(): void {
    const s = this.ctx.levels.current?.living?.tea;
    if (!s || s.stage === 0 || ((s.completed || s.stalled) && !this.watching)) return;
    const bounds = this.ctx.world.simBounds, machine = TEA.bounds;
    if (this.watching) Object.assign(bounds, machine);
    else {
      bounds.x0 = Math.min(bounds.x0, machine.x0); bounds.x1 = Math.max(bounds.x1, machine.x1);
      bounds.y0 = Math.min(bounds.y0, machine.y0); bounds.y1 = Math.max(bounds.y1, machine.y1);
    }
  }

  update(): void {
    const ctx = this.ctx;
    if (ctx.state.mode !== 'play' || ctx.player.dead) { if (this.watching) this.leave(); return; }
    const s = this.initialize(); if (!s) return;
    const near = Math.hypot(ctx.player.x - TEA.lever.x, ctx.player.y - TEA.lever.y) < 110;
    const lever = this.runtime!.mechanisms.find(m => m.id === TEA.lever.id)!;
    if (s.stage === 0 && lever.state === 1) {
      this.spark(465, 163); this.advance(s);
      if (near) this.startWatching();
    }
    if (s.stage > 0 && !s.completed && !s.stalled) {
      s.ticks++; s.stageTicks++;
      const boulder = this.bodies.get('boulder'), duck = this.bodies.get('duck');
      const sugar = this.bodies.get('sugar'), piston = this.bodies.get('piston');
      switch (s.stage) {
        case 1:
          if (this.count(585, 160, 15, 8, [Cell.Fire, Cell.Ember]) > 0) {
            teaRect(ctx.world, TEA.cradle, Cell.Empty); teaRect(ctx.world, TEA.cradleStop, Cell.Empty); this.advance(s);
          } break;
        case 2: if (boulder && boulder.x > 700) this.advance(s); break;
        case 3:
          if (boulder && boulder.x > 808 && boulder.y > 163) {
            teaRect(ctx.world, TEA.waterGate, Cell.Empty); this.advance(s);
          } break;
        case 4:
          if (duck?.inWater && duck.y < 216) { teaRect(ctx.world, TEA.acidGate, Cell.Empty); this.advance(s); }
          break;
        case 5:
          if (this.count(TEA.acidPin.x, TEA.acidPin.y, TEA.acidPin.w, TEA.acidPin.h, [Cell.Stone]) < 3) {
            teaRect(ctx.world, { x: 1140, y: 184, w: 21, h: 5 }, Cell.Empty); this.advance(s);
          } break;
        case 6:
          if (sugar && sugar.y > 211) { teaRect(ctx.world, TEA.lavaGate, Cell.Empty); this.advance(s); }
          break;
        case 7:
          if (piston && piston.y < 175) {
            teaRect(ctx.world, TEA.oilGate, Cell.Empty); this.spark(1305, 224); this.advance(s);
          } break;
        case 8:
          if (this.count(1487, 212, 7, 11, [Cell.Gunpowder]) < 5 && this.count(1475, 200, 40, 35, [Cell.Fire, Cell.Ember, Cell.Steam]) > 0) {
            teaRect(ctx.world, { x: 1499, y: 237, w: 17, h: 2 }, Cell.Empty);
            this.advance(s); s.completed = true;
            ctx.audio.gong(); ctx.events.emit('objectiveChanged', { text: 'Collect the brass bell from the engine receiver.' });
          } break;
      }
      if (s.stageTicks > 2400) {
        s.stalled = true; this.skip();
        ctx.events.emit('toast', { text: 'The engine has stalled. Return to its crank to recharge it.' });
      }
    } else if (s.completed) {
      s.stageTicks++;
      if (s.stageTicks > 210 && this.watching && !this.returning) this.skip();
    }
    if (this.watching) {
      if (this.returning) {
        ctx.camera.actionFocus = { x: ctx.player.x, y: ctx.player.y - 9, zoom: 1 };
        this.returning++;
        if (this.returning > 65) {
          this.watching = false; this.returning = 0; ctx.camera.actionFocus = null;
          ctx.player.fireBlockedUntilRelease = true; ctx.input.queuedJump = undefined;
        }
      } else ctx.camera.actionFocus = this.focus(s);
    }
    this.snapshot(s);
    if (ctx.state.frameCount % 10 === 0) this.publish(near || this.watching);
  }

  private focus(s: TeaMachineState): { x: number; y: number; zoom: number } {
    const close = this.ctx.state.reduceCameraShake ? 1 : 1.35;
    const b = this.bodies.get(s.stage === 2 ? 'pendulum' : s.stage === 3 ? 'boulder' : s.stage === 4 ? 'duck' : s.stage === 6 ? 'sugar' : 'piston');
    if ([2, 3, 4, 6, 7].includes(s.stage) && b) return { x: b.x + (s.stage === 3 ? 50 : 0), y: b.y, zoom: s.stage === 3 ? 1.05 : close };
    if (s.stage === 1) {
      let head = TEA.fuse.x0 as number;
      for (let x = TEA.fuse.x0; x <= TEA.fuse.x1; x++) if (this.count(x, 160, 1, 7, [Cell.Fire]) > 0) head = x;
      return { x: head + 40, y: 150, zoom: close };
    }
    return s.stage === 5 ? { x: 1118, y: 157, zoom: close } : s.stage >= 9
      ? { x: 1484, y: 220, zoom: close } : { x: 1400, y: 198, zoom: 1.02 };
  }

  private publish(visible: boolean): void {
    const s = this.ctx.levels.current?.living?.tea;
    const stage = s?.stage ?? 0, act = ACTS[stage];
    const payload = { visible, watching: this.watching, title: s?.stalled ? 'A slight technical difficulty' : act[0],
      detail: s?.stalled ? 'Return to the crank. Press Use to recharge the engine.' : act[1], stage, stalled: s?.stalled ?? false };
    const key = JSON.stringify(payload);
    if (key !== this.lastView) { this.lastView = key; this.ctx.events.emit('contraptionView', payload); }
  }
}
