import type { Ctx, RigidBody, TeaMachineState } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { fireColor } from '@/sim/colors';
import { TEA, TEA_BODIES, TEA_COMPLETE_STAGE, TEA_VALVES, type TeaValve, stampTeaMachine } from '@/world/teaMachine';
import { pullTeaValve } from '@/game/TeaMachineLinkages';
import { attractElectromagnet, generateFromDrop } from '@/entities/Energy';

const ACTS = [
  ['The Unreasonable Bell & Tea Engine', 'The descent gate needs its brass bell. Pull the crank to begin.'],
  ['First, a little powder', 'The powder burns the retaining cord. The heavy pendulum swings free.'],
  ['Percussive maintenance', 'A hanging weight politely introduces itself to a boulder.'],
  ['Six dominoes and a wound spring', 'The boulder topples the dominoes. The last releases the spring crank and its reservoir cable.'],
  ['Please mind the duck', 'The rising duck pulls the chain around the pulleys, lifting the acid gate.'],
  ['Dissolving the safety precautions', 'Acid eats the stone pedestal directly beneath the sugar weight.'],
  ['One lump or two?', 'The falling sugar pulls its sling, lifting the lava gate.'],
  ['An unreasonable kettle', 'Steam lifts the piston and its rods: oil gate up, flint striker across.'],
  ['This is probably enough heat', 'The flint lights the powder. The last blast burns the copper tea bag’s retaining cord.'],
  ['A most electrifying tea bag', 'The copper weight falls through a generator coil. Current races along the overhead wire.'],
  ['The magnet has opinions', 'Electricity powers the coil, pulling the iron latch out from under the counterweight.'],
  ['Gravity gets the last word', 'The braked counterweight pulls four pulley strands, slowly lifting the bell latch.'],
  ['Tea is served. The bell is yours.', 'Collect the brass bell at the receiver, then carry it to the descent gate.'],
] as const;

export function restoreTeaMachine(value: unknown): TeaMachineState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const s = value as Partial<TeaMachineState>;
  const finite = (n: unknown, fallback: number, min: number, max: number): number =>
    typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  return {
    stage: Math.floor(finite(s.stage, 0, 0, TEA_COMPLETE_STAGE)), ticks: Math.floor(finite(s.ticks, 0, 0, 1000000)),
    stageTicks: Math.floor(finite(s.stageTicks, 0, 0, 1000000)), completed: s.completed === true && s.stage === TEA_COMPLETE_STAGE,
    stalled: s.stalled === true,
    travel: Object.fromEntries((Object.keys(TEA_VALVES) as TeaValve[]).map(key =>
      [key, Math.floor(finite(s.travel?.[key], 0, 0, TEA_VALVES[key].max))])),
    bodies: Array.isArray(s.bodies) ? TEA_BODIES.flatMap(def => {
      const b = s.bodies!.find(body => body?.key === def.key);
      if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return [];
      return [{ key: def.key, x: finite(b.x, def.x, 8, 1591), y: finite(b.y, def.y, 8, 1055),
        vx: finite(b.vx, 0, -20, 20), vy: finite(b.vy, 0, -20, 20), angle: finite(b.angle, 0, -10000, 10000),
        va: finite(b.va, 0, -1, 1), rope: b.rope === true, tether: b.tether === true }];
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
      if (def.rope && (!old || old.rope)) this.ctx.rigidBodies.tieRope(b, def.rope.x, def.rope.y, def.rope.length, def.rope.material);
      if (def.tether && (!old || old.tether)) this.ctx.rigidBodies.tieRope(b, def.tether.x, def.tether.y, def.tether.length, 'rope', true);
    }
    this.snapshot(s);
    return s;
  }

  private snapshot(s: TeaMachineState): void {
    s.bodies = [...this.bodies].filter(([, b]) => this.ctx.rigidBodies.bodies.includes(b)).map(([key, b]) =>
      ({ key, x: b.x, y: b.y, vx: b.vx, vy: b.vy, angle: b.angle, va: b.va, rope: !!b.rope, tether: !!b.tether }));
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
      this.spark(465, TEA.fuse.y - 2); this.advance(s);
      if (near) this.startWatching();
    }
    if (s.stage > 0 && !s.completed && !s.stalled) {
      s.ticks++; s.stageTicks++;
      const live = (key: string): RigidBody | undefined => {
        const b = this.bodies.get(key); return b && ctx.rigidBodies.bodies.includes(b) ? b : undefined;
      };
      const bob = live('pendulum'), boulder = live('boulder'), duck = live('duck');
      const rocker = live('rocker'), sugar = live('sugar'), piston = live('piston');
      const domino = live('domino-5');
      const armature = live('armature'), latch = live('magnet-latch'), counterweight = live('counterweight');
      if (armature) generateFromDrop(ctx, armature, TEA.generatorTerminal, 222, 249);
      if (latch) attractElectromagnet(ctx, latch, TEA.magnetTerminal);
      // Persistent, one-way mechanical linkages. Their travel is supplied by
      // the solver's body poses, even while the camera is following the next act.
      if (s.stage >= 3 && domino) pullTeaValve(ctx.world, s, 'spring', Math.max(0, domino.angle) * 18);
      if (s.stage >= 3 && rocker) pullTeaValve(ctx.world, s, 'water', (.25 - rocker.angle) * 24);
      if (s.stage >= 4 && duck) pullTeaValve(ctx.world, s, 'acid', 233 - duck.y);
      if (s.stage >= 5 && sugar) pullTeaValve(ctx.world, s, 'lava', sugar.y - 187);
      if (s.stage >= 7 && piston) pullTeaValve(ctx.world, s, 'oil', 191 - piston.y);
      if (s.stage >= 10 && counterweight) pullTeaValve(ctx.world, s, 'bell', (counterweight.y - 96) / 4);
      switch (s.stage) {
        case 1:
          if (bob && bob.x > 616) this.advance(s);
          break;
        case 2: if (boulder && boulder.x > 700) this.advance(s); break;
        case 3:
          if ((s.travel?.water ?? 0) >= 4 && this.count(893, 143, 12, 24, [Cell.Water]) > 0) this.advance(s);
          break;
        case 4:
          if ((s.travel?.acid ?? 0) >= 6 && this.count(1099, 117, 13, 12, [Cell.Acid]) > 0) this.advance(s);
          break;
        case 5:
          if (sugar && sugar.y > 188) this.advance(s);
          break;
        case 6:
          if ((s.travel?.lava ?? 0) >= 6 && this.count(1217, 95, 10, 15, [Cell.Lava]) > 0) this.advance(s);
          break;
        case 7:
          if ((s.travel?.oil ?? 0) >= 10) {
            this.spark(1305, 224); this.advance(s);
          } break;
        case 8:
          if (this.count(1487, 212, 7, 11, [Cell.Gunpowder]) < 5 && armature && !armature.rope && armature.y > 222) {
            this.advance(s);
          } break;
        case 9:
          if (ctx.world.charge[ctx.world.idx(TEA.magnetTerminal.x, TEA.magnetTerminal.y)] >= 20) this.advance(s);
          break;
        case 10:
          if (counterweight && counterweight.y > 105) this.advance(s);
          break;
        case 11:
          // The last powder charge can legitimately tear the thin receiver
          // gate away before the counterweight finishes its stroke. That is an
          // open physical path, not a jam: accept either the full linkage
          // travel or a gate whose load-bearing metal is already gone.
          if ((s.travel?.bell ?? 0) >= 12 ||
              this.count(TEA.bellGate.x, TEA.bellGate.y - 20, TEA.bellGate.w,
                TEA.bellGate.h + 20, [Cell.Metal]) < 8) {
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
        const camera = ctx.camera;
        const arrived = Number.isFinite(camera.tx) ? Math.hypot(camera.x - camera.tx, camera.y - camera.ty) < 1 : this.returning > 65;
        if (this.returning > 30 && arrived) {
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
    // Frame the driver AND its destination. Cutting to the liquid downstream
    // before a cable moves made an honest position trigger look like a timer.
    if (s.stage === 2) return { x: 652, y: 133, zoom: close };
    if (s.stage === 3) return { x: 801, y: 146, zoom: 1.05 };
    if (s.stage === 4 || (s.stage === 5 && s.stageTicks < 90)) return { x: 1028, y: 153, zoom: 1 };
    if (s.stage === 5 || s.stage === 6) return { x: 1159, y: 148, zoom: this.ctx.state.reduceCameraShake ? 1 : 1.12 };
    if (s.stage === 7) return { x: 1268, y: 165, zoom: this.ctx.state.reduceCameraShake ? 1 : 1.18 };
    if (s.stage === 1) {
      let head = TEA.fuse.x0 as number;
      for (let x = TEA.fuse.x0; x <= TEA.fuse.x1; x++) if (this.count(x, TEA.fuse.y - 5, 1, 8, [Cell.Fire]) > 0) head = x;
      return { x: head + 40, y: 133, zoom: close };
    }
    if (s.stage >= 9 && s.stage < TEA_COMPLETE_STAGE) return { x: 1453, y: 150, zoom: 1 };
    return s.stage >= TEA_COMPLETE_STAGE
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
