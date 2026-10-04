import type { Ctx, PlayerState } from '@/core/types';
import type { LightField } from '@/render/pixels';
import type { FighterId } from '@/content/fighters';
import { isSfxId } from '@/content/audio/sfxCues';
import type { CellPatch } from '@/authoring/cellPatch';
import { applyCellPatch } from '@/authoring/cellPatch';
import { setExternalControl } from '@/input/externalControl';
import { applyStockPad } from '@/input/stockPad';
import { DuelControls } from '@/input/DuelControls';
import { prepareDuel } from '@/game/prepareDuel';
import { botDriverFor, rivalDriverFor } from '@/arena/ai/driver';
import { TerrainReplicator } from '@/net/duel/TerrainReplicator';
import type { DuelRuntime as RuntimeContract } from '@/net/duel/DuelSession';
import { DuelButtons as B, type DuelTickInput } from '@/net/duel/input';
import type { ArenaPresentation, DuelSnapshot } from '@/net/duel/snapshot';
import { captureDuelEffects, replicaDuelEffects } from '@/render/duelEffects';

/** Adapts the existing game to host authority or a strictly render-only client.
 * Wire state is explicit observable data, never a dump of class internals. */
export class DuelRuntime implements RuntimeContract {
  private terrain = new TerrainReplicator();
  private readonly controls: DuelControls;
  private latest: DuelSnapshot | null = null;
  private previous: DuelSnapshot | null = null;
  private receivedAt = 0;
  private presentationDirty = false;
  private readonly sounds: DuelSnapshot['sounds'] = [];
  private restoreAudio: (() => void) | null = null;
  constructor(
    private readonly ctx: Ctx,
    private readonly light: LightField,
    canvas: () => HTMLCanvasElement,
    private readonly playReady: () => Promise<boolean>,
  ) {
    this.controls = new DuelControls(ctx, canvas);
  }
  async prepare(fighters: readonly FighterId[], valid: () => boolean): Promise<boolean> {
    const c = this.ctx;
    c.versus?.close();
    this.stop();
    if (!(await prepareDuel(c, fighters, this.playReady, valid))) return false;
    botDriverFor(c).off();
    rivalDriverFor(c, 1)?.off();
    setExternalControl(c.input, true);
    this.clearInput();
    this.terrain = new TerrainReplicator();
    this.latest = this.previous = null;
    if (!c.duel?.replica) {
      const original = c.audio.sfx;
      c.audio.sfx = (id, x, y, options) => {
        if (this.sounds.length < 64) this.sounds.push({ id, x, y });
        original.call(c.audio, id, x, y, options);
      };
      this.restoreAudio = () => {
        c.audio.sfx = original;
      };
    }
    return true;
  }
  stop(): void {
    this.restoreAudio?.();
    this.restoreAudio = null;
    this.sounds.length = 0;
    this.controls.clear();
    this.latest = this.previous = null;
    const c = this.ctx;
    this.presentationDirty = false;
    c.arena?.removeRival(1);
    c.arena?.configureStocks(null);
    setExternalControl(c.input, false);
    c.state.paused = true;
  }
  pause(paused: boolean): void {
    this.ctx.state.paused = paused;
  }
  sample() {
    return this.controls.sample();
  }
  pollControls(): void {
    this.controls.pollMenu();
  }
  clearInput(): void {
    this.controls.clear();
    for (const slot of [0, 1]) {
      const b = this.ctx.arena?.bundle(slot);
      if (!b) continue;
      for (const k of Object.keys(b.input.keys) as Array<keyof typeof b.input.keys>) b.input.keys[k] = false;
      b.input.queuedJump = undefined;
      b.input.queuedDodge = b.input.queuedRecovery = b.input.shieldHeld = false;
      b.player.firing = b.player.firePressed = false;
      b.fighters.releaseInputs?.();
    }
  }
  input(slot: number, input: DuelTickInput): void {
    const c = this.ctx,
      held = (bit: number): boolean => (input.buttons & bit) !== 0,
      pressed = (bit: number): boolean => (input.pressed & bit) !== 0;
    c.arena?.with(slot, () => {
      applyStockPad(c, {
        left: held(B.left),
        right: held(B.right),
        up: held(B.up),
        down: held(B.down),
        jump: held(B.jump),
        jumpPressed: pressed(B.jump),
        defense: held(B.shield),
        defensePressed: pressed(B.shield),
        dodgeDirection: held(B.shield) && pressed(B.left | B.right | B.down),
        grab: pressed(B.grab),
        attack: pressed(B.attack),
        special: held(B.special),
        specialPressed: pressed(B.special),
        smash: pressed(B.smashLeft)
          ? 'left'
          : pressed(B.smashRight)
            ? 'right'
            : pressed(B.smashUp)
              ? 'up'
              : pressed(B.smashDown)
                ? 'down'
                : null,
        confirm: false,
        back: false,
        previous: false,
        next: false,
        pause: false,
        menuPrevious: false,
        menuNext: false,
      });
      if (pressed(B.jump) && held(B.up)) c.input.queuedRecovery = true;
      if (pressed(B.tactical)) c.fighters?.press('tactical');
      if (pressed(B.ultimate)) c.fighters?.press('ultimate');
      c.input.mouse.x = c.player.x + Math.cos(input.aim) * 130;
      c.input.mouse.y = c.player.y - 10 + Math.sin(input.aim) * 130;
    });
  }
  capture(meta: Pick<DuelSnapshot, 'epoch' | 'seq' | 'base' | 'baseline'>): {
    snapshot: DuelSnapshot;
    cells: CellPatch;
  } {
    const c = this.ctx,
      arena = c.arena!;
    const slots: ArenaPresentation['slots'] = [0, 1].map((slot) => ({
      // Spread each view explicitly: getters on the runtime classes are not JSON properties.
      attack: (() => {
        const a = arena.stockAttack(slot);
        return (
          a && { kind: a.kind, phase: a.phase, busy: a.busy, facing: a.facing, age: a.age, id: a.id, spec: a.spec }
        );
      })(),
      shield: (() => {
        const s = arena.stockShield(slot);
        return s && { phase: s.phase, busy: s.busy, guarding: s.guarding, strength: s.strength };
      })(),
      dodge: (() => {
        const d = arena.stockDodge(slot);
        return (
          d && {
            phase: d.phase,
            busy: d.busy,
            evading: d.evading,
            airReady: d.airReady,
            inAir: d.inAir,
            vx: d.vx,
            vy: d.vy,
          }
        );
      })(),
      ledge: (() => {
        const l = arena.stockLedge(slot);
        return (
          l && {
            phase: l.phase,
            busy: l.busy,
            protected: l.protected,
            airReady: l.airReady,
            x: l.x,
            y: l.y,
            side: l.side,
            age: l.age,
          }
        );
      })(),
      grab: (() => {
        const g = arena.stockGrab(slot);
        return (
          g && {
            phase: g.phase,
            busy: g.busy,
            age: g.age,
            facing: g.facing,
            victim: g.victim,
            throwX: g.throwX,
            throwY: g.throwY,
          }
        );
      })(),
      special: (() => {
        const s = arena.stockSpecial(slot);
        return s && { charges: s.charges, progress: s.progress, busy: s.busy };
      })(),
      canRecover: arena.canRecover(slot),
      recovering: arena.isRecovering(slot),
      grabbed: arena.isGrabbed(slot),
      launching: arena.isLaunching(slot),
    }));
    const fighters = [0, 1].map((slot) =>
      arena.with(slot, () => ({
        player: c.player,
        fighter: c.fighters!.view,
        body: { ...c.fighters!.body },
        concealment: c.fighters!.concealment(),
        effects: captureDuelEffects(c, this.light),
      })),
    ) as DuelSnapshot['fighters'];
    const cam = c.camera;
    const match = arena.stockMatch!;
    const snapshot: DuelSnapshot = {
      ...meta,
      tick: c.state.frameCount,
      width: c.world.width,
      height: c.world.height,
      fighters,
      arena: {
        match: {
          state: match.state,
          fighters: match.fighters,
          remainingTicks: match.remainingTicks,
          countdown: match.countdown,
          winner: match.winner,
          reason: match.reason,
          zone: match.zone,
        },
        bout: arena.bout,
        slots,
      },
      camera: { x: cam.x, y: cam.y, tx: cam.tx, ty: cam.ty, zoom: cam.zoom, viewScale: cam.viewScale ?? 1 },
      projectiles: c.projectiles,
      particles: [...c.particles.list],
      arcs: c.lightning.arcs,
      lights: c.levels.current?.authoredLights ?? [],
      bloom: c.fx.bloomKick,
      shake: c.fx.screenShake,
      sounds: this.sounds.splice(0),
    };
    return { snapshot, cells: this.terrain.capture(c.world, meta.baseline) };
  }
  receive(snapshot: DuelSnapshot, cells: CellPatch, now: number): boolean {
    const c = this.ctx;
    if (snapshot.width !== c.world.width || snapshot.height !== c.world.height || !c.arena?.active) return false;
    if (snapshot.baseline) c.world.clear();
    applyCellPatch(c.world, cells);
    this.previous = this.latest;
    this.latest = snapshot;
    this.receivedAt = now;
    this.presentationDirty = true;
    c.state.frameCount = snapshot.tick;
    for (const slot of [0, 1]) {
      const b = c.arena.bundle(slot)!,
        f = snapshot.fighters[slot];
      this.replacePlayer(b.player, f.player);
      b.fighters.applyPresentation?.(f.fighter, f.body, f.concealment, replicaDuelEffects(f.effects));
    }
    c.projectiles.length = 0;
    c.projectiles.push(...snapshot.projectiles);
    c.particles.applyPresentation?.(snapshot.particles);
    c.lightning.arcs.length = 0;
    c.lightning.arcs.push(...snapshot.arcs);
    if (c.levels.current) c.levels.current.authoredLights = snapshot.lights;
    Object.assign(c.camera, snapshot.camera);
    c.fx.bloomKick = snapshot.bloom;
    c.fx.screenShake = snapshot.shake;
    for (const sound of snapshot.sounds) if (isSfxId(sound.id)) c.audio.sfx(sound.id, sound.x, sound.y);
    return true;
  }
  private replacePlayer(player: PlayerState, data: PlayerState): void {
    // Optional transient fields must disappear when absent in the next snapshot.
    for (const key of Object.keys(player))
      if (!(key in data)) delete (player as unknown as Record<string, unknown>)[key];
    Object.assign(player, structuredClone(data));
  }
  present(now: number): boolean {
    let changed = this.presentationDirty;
    this.presentationDirty = false;
    const latest = this.latest,
      prev = this.previous;
    if (!latest || !prev) return changed;
    const interval = Math.max(16, Math.min(150, ((latest.tick - prev.tick) * 1000) / 60));
    const alpha = Math.min(1, Math.max(0, (now - this.receivedAt) / interval));
    for (const slot of [0, 1]) {
      // The controlled fighter uses the latest confirmed pose immediately.
      // Delaying it for smoothing adds a full snapshot interval to every action.
      if (slot === this.ctx.duel?.slot) continue;
      const p = this.ctx.arena?.bundle(slot)?.player;
      if (!p) continue;
      const a = prev.fighters[slot].player,
        b = latest.fighters[slot].player;
      // Respawns, teleports and ring-outs snap. Interpolating them crosses the stage.
      if (Math.hypot(b.x - a.x, b.y - a.y) < 100 && a.dead === b.dead) {
        const x = a.x + (b.x - a.x) * alpha;
        const y = a.y + (b.y - a.y) * alpha;
        changed ||= p.x !== x || p.y !== y;
        p.x = x;
        p.y = y;
      }
    }
    return changed;
  }
  dispose(): void {
    this.stop();
    this.controls.dispose();
  }
}
