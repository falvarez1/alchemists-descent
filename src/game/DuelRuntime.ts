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
import {
  DUEL_MOMENT_TYPES,
  DUEL_SNAPSHOT_TICKS,
  MAX_DUEL_MOMENTS,
  type ArenaPresentation,
  type DuelMoment,
  type DuelSnapshot,
} from '@/net/duel/snapshot';
import { HostClock, PlaybackCursor, TICK_MS } from '@/net/duel/timeline';
import { captureDuelEffects, replicaDuelEffects } from '@/render/duelEffects';

interface Frame {
  snapshot: DuelSnapshot;
  cells: CellPatch;
}
type SlotView = ArenaPresentation['slots'][number];
/** Frames buffered beyond this are applied at once (a hidden tab keeps receiving but never presents). */
const MAX_FRAMES = 240;
/** A presentation that passes more frames than this is catching up: only the last few frames' sounds still play. */
const CATCH_UP_FRAMES = 4;
/** The world and the opponent play back late enough that 98% of frames have arrived (smooth); the controlled fighter
 * plays back as early as 80% allows (responsive). Both are lateness quantiles of the measured arrival jitter. */
const WORLD_LATENESS = 0.98;
const OWN_LATENESS = 0.8;
const WORLD_MARGIN_TICKS = 0.25;

/** Adapts the existing game to host authority or a strictly render-only client.
 * Wire state is explicit observable data, never a dump of class internals.
 *
 * The replica plays the host's ticks back on the host's clock (HostClock), not as they arrive: arrivals bunch and
 * gap with network jitter, the host's ticks do not. Two playheads read one buffer of frames. The world (terrain,
 * the opponent, the camera, effects, the match) runs a little behind, by the jitter it must absorb; the controlled
 * fighter runs as close to the newest frame as the network allows. Both interpolate positions between the two
 * frames around their playhead at display rate, exactly as the host draws between its own last two ticks. */
export class DuelRuntime implements RuntimeContract {
  private terrain = new TerrainReplicator();
  private readonly controls: DuelControls;
  private readonly frames: Frame[] = [];
  /** Index in `frames` of the newest frame each view has applied. */
  private worldAt = -1;
  private ownAt = -1;
  private readonly clock = new HostClock();
  private readonly worldHead = new PlaybackCursor();
  private readonly ownHead = new PlaybackCursor();
  private worldArena: ArenaPresentation | null = null;
  private ownSlotView: SlotView | null = null;
  private view: ArenaPresentation | null = null;
  private dirty = false;
  private readonly sounds: DuelSnapshot['sounds'] = [];
  private readonly moments: DuelMoment[] = [];
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
    this.resetPlayback();
    if (!c.duel?.replica) {
      const original = c.audio.sfx;
      c.audio.sfx = (id, x, y, options) => {
        // The announcer's cabinet sounds (duel.*) are not replicated: the replica's own announcer makes them from the
        // moments below, on time. Options that shape a sound (level, pitch, rate, a delay) travel with it.
        if (!id.startsWith('duel.') && this.sounds.length < 64) {
          const { gain, pitch, rate, delay } = options ?? {};
          this.sounds.push({ id, x, y, ...(gain !== undefined && { gain }), ...(pitch !== undefined && { pitch }), ...(rate !== undefined && { rate }), ...(delay !== undefined && { delay }) });
        }
        original.call(c.audio, id, x, y, options);
      };
      // The match's moments a replica cannot raise itself (it never ticks the match): recorded in order, sent as data.
      const offs = DUEL_MOMENT_TYPES.map((type) =>
        c.events.on(type, (data: DuelMoment['data']) => {
          if (this.moments.length < MAX_DUEL_MOMENTS) this.moments.push({ type, data: structuredClone(data) } as DuelMoment);
        }),
      );
      this.restoreAudio = () => {
        c.audio.sfx = original;
        for (const off of offs) off();
      };
    }
    return true;
  }
  stop(): void {
    this.restoreAudio?.();
    this.restoreAudio = null;
    this.sounds.length = 0;
    this.moments.length = 0;
    this.controls.clear();
    this.resetPlayback();
    const c = this.ctx;
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
        climbHeld: held(B.grab),
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
        stagePrevious: false,
        stageNext: false,
      });
      if (pressed(B.jump) && held(B.up)) c.input.queuedRecovery = true;
      if (pressed(B.tactical)) c.fighters?.press('tactical');
      if (pressed(B.ultimate)) c.fighters?.press('ultimate');
      c.input.mouse.x = c.player.x + Math.cos(input.aim) * 130;
      c.input.mouse.y = c.player.y - 10 + Math.sin(input.aim) * 130;
    });
  }
  capture(meta: Pick<DuelSnapshot, 'epoch' | 'seq' | 'base' | 'baseline' | 'ack'>): {
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
      moments: this.moments.splice(0),
    };
    return { snapshot, cells: this.terrain.capture(c.world, meta.baseline) };
  }
  receive(snapshot: DuelSnapshot, cells: CellPatch, now: number): boolean {
    const c = this.ctx;
    if (snapshot.width !== c.world.width || snapshot.height !== c.world.height || !c.arena?.active) return false;
    this.clock.observe(snapshot.tick, now);
    this.frames.push({ snapshot, cells });
    if (this.frames.length > MAX_FRAMES) this.catchUp(this.frames.length - MAX_FRAMES / 2);
    this.dirty = true;
    return true;
  }
  present(now: number): boolean {
    let changed = this.dirty;
    this.dirty = false;
    const frames = this.frames;
    if (frames.length === 0) return changed;
    const own = this.ownSlot(),
      newest = frames[frames.length - 1].snapshot.tick,
      host = this.clock.hostTick(now);
    const worldTick = this.worldHead.advance(
      now,
      host - DUEL_SNAPSHOT_TICKS - this.clock.lateness(WORLD_LATENESS) - WORLD_MARGIN_TICKS,
      newest,
    );
    const ownTick = Math.max(
      worldTick,
      this.ownHead.advance(now, host - DUEL_SNAPSHOT_TICKS - this.clock.lateness(OWN_LATENESS), newest),
    );
    const worldTo = this.frameAt(worldTick),
      ownTo = Math.max(worldTo, this.frameAt(ownTick));
    while (this.ownAt < ownTo) {
      const quiet = ownTo - this.ownAt > CATCH_UP_FRAMES;
      this.applyOwn(frames[++this.ownAt].snapshot, own, quiet);
      changed = true;
    }
    while (this.worldAt < worldTo) {
      this.applyWorld(frames[++this.worldAt], own);
      changed = true;
    }
    for (const slot of [0, 1]) {
      changed = (slot === own ? this.placeFighter(slot, ownTo, ownTick) : this.placeFighter(slot, worldTo, worldTick)) || changed;
    }
    changed = this.placeCamera(worldTo, worldTick) || changed;
    this.prune();
    return changed;
  }
  presentation(): ArenaPresentation | null {
    const world = this.worldArena;
    if (!world) return null;
    if (!this.view) {
      const slots = world.slots.slice();
      if (this.ownSlotView) slots[this.ownSlot()] = this.ownSlotView;
      this.view = { match: world.match, bout: world.bout, slots };
    }
    return this.view;
  }
  /** Dev instrumentation (the latency probe): the buffer and both playheads, in host ticks. */
  playback(): { newest: DuelSnapshot | null; world: number; own: number; frames: number; delayMs: number } {
    const newest = this.frames.at(-1)?.snapshot ?? null;
    return {
      newest,
      world: this.worldHead.tick,
      own: this.ownHead.tick,
      frames: this.frames.length,
      delayMs: newest ? (newest.tick - this.ownHead.tick) * TICK_MS : 0,
    };
  }
  private ownSlot(): number {
    return this.ctx.duel?.slot ?? 1;
  }
  /** The first frame at or after `tick` (the one a playhead there shows), or the newest. */
  private frameAt(tick: number): number {
    const frames = this.frames;
    for (let i = 0; i < frames.length; i++) if (frames[i].snapshot.tick >= tick) return i;
    return frames.length - 1;
  }
  private applyWorld(frame: Frame, own: number): void {
    const c = this.ctx,
      s = frame.snapshot;
    if (s.baseline) c.world.clear();
    applyCellPatch(c.world, frame.cells);
    c.state.frameCount = s.tick;
    for (const slot of [0, 1]) if (slot !== own) this.applyFighter(slot, s);
    c.projectiles.length = 0;
    c.projectiles.push(...s.projectiles);
    c.particles.applyPresentation?.(s.particles);
    c.lightning.arcs.length = 0;
    c.lightning.arcs.push(...s.arcs);
    if (c.levels.current) c.levels.current.authoredLights = s.lights;
    Object.assign(c.camera, s.camera);
    c.fx.bloomKick = s.bloom;
    c.fx.screenShake = s.shake;
    this.worldArena = s.arena;
    this.view = null;
    // The host's moments, re-raised here after the state they belong to is in place: the replica's announcer, KO burst
    // and super cut-in answer them exactly as they do on the host.
    for (const m of s.moments ?? []) c.events.emit(m.type, m.data as never);
  }
  private applyOwn(s: DuelSnapshot, own: number, quiet: boolean): void {
    this.applyFighter(own, s);
    this.ownSlotView = s.arena.slots[own];
    this.view = null;
    // Sounds follow the earliest playhead: a fighter's own swing or landing should not wait for the world's buffer.
    if (quiet) return;
    const c = this.ctx;
    for (const sound of s.sounds) {
      if (!isSfxId(sound.id)) continue;
      const { gain, pitch, rate, delay } = sound;
      c.audio.sfx(sound.id, sound.x, sound.y, { gain, pitch, rate, delay });
    }
  }
  private applyFighter(slot: number, s: DuelSnapshot): void {
    const b = this.ctx.arena?.bundle(slot);
    if (!b) return;
    const f = s.fighters[slot];
    this.replacePlayer(b.player, f.player);
    b.fighters.applyPresentation?.(f.fighter, f.body, f.concealment, replicaDuelEffects(f.effects));
  }
  /** Where a playhead at `tick` sits between frame `to` and the one before it (1 = at `to`). */
  private between(to: number, tick: number): number {
    const b = this.frames[to].snapshot,
      a = this.frames[to - 1]?.snapshot;
    return a && b.tick > a.tick ? Math.max(0, Math.min(1, (tick - a.tick) / (b.tick - a.tick))) : 1;
  }
  /** A fighter between the two frames around its playhead. Respawns, teleports and ring-outs snap. */
  private placeFighter(slot: number, to: number, tick: number): boolean {
    const p = this.ctx.arena?.bundle(slot)?.player;
    if (!p) return false;
    const pb = this.frames[to].snapshot.fighters[slot].player,
      pa = this.frames[to - 1]?.snapshot.fighters[slot].player ?? pb,
      t = this.between(to, tick);
    const near = Math.hypot(pb.x - pa.x, pb.y - pa.y) < 100 && pa.dead === pb.dead;
    const x = near ? pa.x + (pb.x - pa.x) * t : pb.x,
      y = near ? pa.y + (pb.y - pa.y) * t : pb.y;
    const changed = p.x !== x || p.y !== y;
    p.x = x;
    p.y = y;
    return changed;
  }
  private placeCamera(to: number, tick: number): boolean {
    const b = this.frames[to].snapshot.camera,
      a = this.frames[to - 1]?.snapshot.camera ?? b,
      t = this.between(to, tick),
      cam = this.ctx.camera;
    const x = a.x + (b.x - a.x) * t,
      y = a.y + (b.y - a.y) * t,
      zoom = a.zoom + (b.zoom - a.zoom) * t,
      viewScale = a.viewScale + (b.viewScale - a.viewScale) * t;
    const changed = cam.x !== x || cam.y !== y || cam.zoom !== zoom || cam.viewScale !== viewScale;
    Object.assign(cam, { x, y, tx: a.tx + (b.tx - a.tx) * t, ty: a.ty + (b.ty - a.ty) * t, zoom, viewScale });
    return changed;
  }
  /** Drop frames both playheads have passed, keeping the one each interpolates from. */
  private prune(): void {
    const drop = Math.min(this.worldAt, this.ownAt) - 1;
    if (drop <= 0) return;
    this.frames.splice(0, drop);
    this.worldAt -= drop;
    this.ownAt -= drop;
  }
  /** Apply the oldest `count` frames now (state and terrain, no sounds) and move both playheads past them. */
  private catchUp(count: number): void {
    const own = this.ownSlot(),
      last = Math.min(this.frames.length, count) - 1;
    while (this.ownAt < last) this.applyOwn(this.frames[++this.ownAt].snapshot, own, true);
    while (this.worldAt < last) this.applyWorld(this.frames[++this.worldAt], own);
    const tick = this.frames[last].snapshot.tick;
    for (const head of [this.worldHead, this.ownHead]) if (!(head.tick >= tick)) head.tick = tick;
    this.prune();
  }
  private resetPlayback(): void {
    this.frames.length = 0;
    this.worldAt = this.ownAt = -1;
    this.clock.reset();
    this.worldHead.reset();
    this.ownHead.reset();
    this.worldArena = this.ownSlotView = this.view = null;
    this.dirty = false;
  }
  private replacePlayer(player: PlayerState, data: PlayerState): void {
    // Optional transient fields must disappear when absent in the next snapshot.
    for (const key of Object.keys(player))
      if (!(key in data)) delete (player as unknown as Record<string, unknown>)[key];
    Object.assign(player, structuredClone(data));
  }
  dispose(): void {
    this.stop();
    this.controls.dispose();
  }
}
