import type { BodyMaterial, Ctx, LevelRuntime, Mechanism, MechanismsApi } from '@/core/types';
import { mechanismTriggersFor } from '@/core/mechanisms';
import { blocksEntity, Cell, isGas, isLiquid, isSoftGrowth } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR, emberColor, fireColor, packRGB } from '@/sim/colors';
import {
  BUOY_LATCH_FRAMES,
  DEFAULT_TRIGGER_LATCH_FRAMES,
  SENSOR_MOMENTARY_LATCH_FRAMES,
  SENSOR_SCAN_MOD,
  setDoorCells,
  setValveCells,
} from '@/core/mechanismFactories';
import { entityRandom } from '@/core/simRandom';
import { steamOffBowl, wetCells } from '@/game/warmBowl';
import { PHOTOCELL } from '@/config/darkness';
import { LOCK_HINT_CELLS, lockFocus } from '@/game/lockText';
export {
  BUOY_LATCH_FRAMES,
  DEFAULT_TRIGGER_LATCH_FRAMES,
  SENSOR_MOMENTARY_LATCH_FRAMES,
  SENSOR_SCAN_MOD,
  makeBrazier,
  makeBuoy,
  makeChargeLatch,
  makeCounterweight,
  makeDispenser,
  makeDoor,
  makeLever,
  makePlate,
  makePlug,
  makeRelay,
  makeScale,
  makeSensor,
  makeValve,
  setDoorCells,
  setValveCells,
} from '@/core/mechanismFactories';

/* ---------------- the runtime system ---------------- */

/** Within roughly a screen of the player: close enough to have seen it happen. */
const WITNESS_RADIUS = 360;
/** Arrival: the first 8 s on a floor belong to the sim settling what generation
 *  left (sand filling a bucket, a plate crushed by rubble, a brazier over lava).
 *  Those are changes the player never made — the machines still move, but the
 *  toast stays quiet (QA: "A mechanism groans…" ×2 on arriving at floors 2/3). */
const ARRIVAL_QUIET_FRAMES = 480;
/** An unlit brazier sunk in standing water this long (frames) counts as wrecked: fail-open. */
const BRAZIER_DROWN_FRAMES = 1200;
/** Cells of `cell` standing in a rect (a vent's census). */
function countCells(world: Ctx['world'], cell: number, r: { x0: number; y0: number; x1: number; y1: number }): number {
  let n = 0;
  for (let y = r.y0; y <= r.y1; y++) {
    if (y < 0 || y >= world.height) continue;
    for (let x = r.x0; x <= r.x1; x++) if (x >= 0 && x < world.width && world.types[x + y * world.width] === cell) n++;
  }
  return n;
}
function nearPlayer(ctx: Ctx, m: Mechanism): boolean {
  const dx = m.x - ctx.player.x, dy = m.y - ctx.player.y;
  return dx * dx + dy * dy <= WITNESS_RADIUS * WITNESS_RADIUS;
}

export class Mechanisms implements MechanismsApi {
  private readonly sequenceScratch: Mechanism[] = [];
  private readonly edgeScratch: boolean[] = [];
  private readonly eventDisposers: Array<() => void> = [];
  /** No world-driven toast before this frame (see ARRIVAL_QUIET_FRAMES). */
  private quietUntil = 0;
  /** Mechanisms wrecked during an arrival: their gate later falls open quietly too. */
  private readonly quietBreaks = new WeakSet<Mechanism>();
  /** Frames each unlit brazier has sat drowned (see keepBowlDry). */
  private readonly drowned = new WeakMap<Mechanism, number>();
  /** Toasts said this tick — one line per tick, however many machines say it. */
  private saidFrame = -1;
  private readonly saidThisTick = new Set<string>();

  constructor(private ctx: Ctx) {
    // Explosions / projectile impacts / dig hits all announce themselves here.
    this.eventDisposers.push(ctx.events.on('structureStrike', ({ x, y, radius }) => this.strike(this.ctx, x, y, radius)));
    this.eventDisposers.push(ctx.events.on('levelChanged', () => {
      this.quietUntil = this.ctx.state.frameCount + ARRIVAL_QUIET_FRAMES;
    }));
  }

  /** Emit a toast once per tick (two machines saying the same line on the same
   *  tick is one event to the player). */
  private say(ctx: Ctx, text: string): void {
    const frame = ctx.state.frameCount;
    if (frame !== this.saidFrame) {
      this.saidFrame = frame;
      this.saidThisTick.clear();
    }
    if (this.saidThisTick.has(text)) return;
    this.saidThisTick.add(text);
    ctx.events.emit('toast', { text });
  }

  /** A world-driven change (not a lever the player pulled) worth a toast: near
   *  enough to have been seen, and not the arrival's settling. */
  private witnessed(ctx: Ctx, m: Mechanism): boolean {
    return nearPlayer(ctx, m) && ctx.state.frameCount >= this.quietUntil;
  }

  dispose(): void {
    for (const dispose of this.eventDisposers.splice(0).reverse()) dispose();
  }

  update(ctx: Ctx): void {
    if (ctx.state.mode !== 'play' || ctx.state.paused) return;
    const runtime = ctx.levels.current;
    if (!runtime) return;
    const world = ctx.world;
    const list = runtime.mechanisms;

    // ---- 1) Each sensor reads the raw grid ----
    for (const m of list) {
      if (m.kind === 'door') continue;

      // Fail-open rule: a wrecked mechanism groans, then its gate falls open.
      // Physics can never hard-lock progression. Plugs are exempt: their
      // body being destroyed is their JOB — the plug branch below fires them.
      // An open valve has deliberately retracted every recorded body cell;
      // that is its healthy state, not structural destruction. Closed valves
      // and physical trigger nodes still retain the normal fail-open audit.
      const shouldAuditBody = m.kind !== 'plug' && !(m.kind === 'valve' && m.state === 1);
      if (shouldAuditBody && m.broken === undefined && m.body && ctx.state.frameCount % 30 === 0) {
        let intact = 0;
        for (const [bx, by] of m.body) {
          if (!world.inBounds(bx, by)) continue;
          const t = world.types[world.idx(bx, by)];
          if (t === Cell.Metal || t === Cell.Stone || blocksEntity(t)) intact++;
        }
        if (intact < m.body.length / 2) {
          m.broken = 1800; // 30 seconds of groaning
          ctx.audio.groan(m.x, m.y);
          // Announce only what the player can witness: generation/settling can
          // wreck several far-off mechanisms on arrival, and a stack of
          // identical groans about machines you have never seen is noise.
          if (ctx.state.frameCount < this.quietUntil) this.quietBreaks.add(m);
          else if (nearPlayer(ctx, m)) this.say(ctx, 'A mechanism groans. Something gives way.');
        }
      }
      if (m.broken !== undefined && m.broken > 0) {
        m.broken--;
        if (m.broken % 360 === 0) {
          ctx.audio.groan(m.x, m.y);
          ctx.particles.burst(m.x, m.y - 3, 4, null, () => packRGB(130, 95, 80), 0.6, {
            grav: 0.06,
          });
        }
        if (m.broken === 0 && !this.quietBreaks.has(m) && this.witnessed(ctx, m)) {
          this.say(ctx, 'The broken gate falls open.');
        }
        continue; // a dying mechanism no longer senses
      }
      if (m.broken === 0) continue;

      if (m.kind === 'lever') {
        // hand-pull in progress: the arm sweeps, then the flip lands
        if (m.pullT !== undefined && m.pullT > 0) {
          m.pullT--;
          if (m.pullT === 0) this.flipLever(ctx, m);
        }
      } else if (m.kind === 'plate') {
        const was = m.pressed === true;
        m.pressed = this.sensePlate(ctx, m);
        if (m.pressed) m.state = DEFAULT_TRIGGER_LATCH_FRAMES; // stays open ~7s after weight lifts
        else if (m.state > 0) m.state--;
        if (m.pressed && !was) {
          ctx.audio.sfx('mech.plate', m.x, m.y);
          ctx.particles.burst(m.x + m.w / 2, m.y - 1, 3, null, () => packRGB(190, 160, 80), 0.45, {
            grav: 0.04,
          });
        }
      } else if (m.kind === 'scale' && m.zone) {
        // SAND SCALE: pure material weight in the pan — bodies don't count,
        // only what you pour or drop stays poured
        let weight = 0;
        for (let X = m.zone.x0; X <= m.zone.x1; X++) {
          for (let Y = m.zone.y0; Y <= m.zone.y1; Y++) {
            if (!world.inBounds(X, Y)) continue;
            const t = world.types[world.idx(X, Y)];
            if (t !== Cell.Empty && !isGas(t) && t !== Cell.Fire) weight++;
          }
        }
        m.reading = weight;
        const enough = weight >= (m.threshold ?? 24);
        if (enough && m.state === 0) {
          ctx.audio.sfx('mech.scale', m.x, m.y);
          ctx.particles.burst(m.x + m.w / 2, m.y - 2, 4, null, () => packRGB(220, 170, 65), 0.55, {
            grav: 0.05,
            glow: 0.8,
          });
        }
        if (enough) m.state = DEFAULT_TRIGGER_LATCH_FRAMES;
        else if (m.state > 0) m.state--;
      } else if (m.kind === 'buoy' && m.zone) {
        // SLUICE: pooled liquid lifts the float
        let liquid = 0;
        for (let X = m.zone.x0; X <= m.zone.x1; X++) {
          for (let Y = m.zone.y0; Y <= m.zone.y1; Y++) {
            if (!world.inBounds(X, Y)) continue;
            if (isLiquid(world.types[world.idx(X, Y)])) liquid++;
          }
        }
        m.reading = liquid;
        const afloat = liquid >= (m.threshold ?? 28);
        if (afloat && m.state === 0) {
          ctx.audio.sfx('mech.buoy', m.x, m.y);
          ctx.particles.burst(m.x, m.y - 3, 5, null, () => packRGB(130, 205, 255), 0.6, {
            grav: -0.02,
            glow: 0.8,
          });
        }
        if (afloat) m.state = BUOY_LATCH_FRAMES; // generous latch: pools drain slowly anyway
        else if (m.state > 0) m.state--;
      } else if (m.kind === 'chargelatch' && m.zone) {
        // CHARGE-LATCH: one spark anywhere in the zone latches it forever —
        // lightning, electrified water, even a conducting enemy's blood
        if (m.state === 0) {
          let charged = false;
          for (let X = m.zone.x0; X <= m.zone.x1 && !charged; X++) {
            for (let Y = m.zone.y0; Y <= m.zone.y1 && !charged; Y++) {
              if (world.inBounds(X, Y) && world.charge[world.idx(X, Y)] > 0) charged = true;
            }
          }
          if (charged) {
            m.state = 1;
            ctx.audio.sfx('mech.latch', m.x, m.y);
            if (m.cue) ctx.audio.sfx(m.cue, m.x, m.y);
            ctx.particles.burst(m.x, m.y - 3, 12, null, () => packRGB(120, 200, 255), 2.0, {
              glow: 2.4,
              grav: -0.01,
            });
            if (this.witnessed(ctx, m)) this.say(ctx, 'The coil drinks the spark and latches.');
          }
        }
      } else if (m.kind === 'plug') {
        // A LOCK's plug (world/locks): the Works relent when a floor's vault has stayed shut for
        // relentFrames of play — a ruined puzzle can never lock a run. (A seal broken by the machine,
        // by digging or by the relent has state 1 and is done.)
        if (m.lock && m.state === 0 && ctx.state.frameCount % 30 === 0 && !this.lockSeen.has(m)) {
          const at = lockFocus(runtime, m);
          const ddx = at.x - ctx.player.x, ddy = at.y - ctx.player.y;
          if (ddx * ddx + ddy * ddy <= LOCK_HINT_CELLS * LOCK_HINT_CELLS) {
            this.lockSeen.add(m);
            ctx.events.emit('lockChanged', { kind: m.lock, phase: 'seen', x: at.x, y: at.y });
          }
        }
        // THE CRUCIBLE: a quench's steam is real, and it scalds whoever stands in it near the vat (the reason the lever is far off)
        if (m.lock === 'crucible' && ctx.state.frameCount % 20 === 0) this.scaldInSteam(ctx, runtime, m);
        // a seal that has been dug, melted or blasted through to its key needs no relenting
        if (m.state === 0 && m.relentFrames !== undefined && runtime.keyTaken) m.relentFrames = undefined;
        if (m.state === 0 && m.relentFrames !== undefined) {
          m.relentFrames--;
          if (m.relentFrames <= 0) {
            m.relentFrames = undefined;
            this.relentLock(ctx, m);
          }
        }
        // A plug WANTS its body destroyed: when breakFrac of its recorded
        // cells are gone or TRANSFORMED — burned, dissolved, blasted, dug,
        // by any cause — it fires once. The material is the break profile.
        if (m.state === 0 && m.body && m.body.length > 0 && (ctx.state.frameCount + m.id) % 8 === 0) {
          const mat = m.material ?? Cell.Stone;
          let intact = 0;
          for (const [bx, by] of m.body) {
            if (world.inBounds(bx, by) && world.types[world.idx(bx, by)] === mat) intact++;
          }
          m.reading = intact;
          const frac = m.breakFrac ?? 0.5;
          if (intact <= m.body.length * (1 - frac)) this.breakPlug(ctx, m, false);
        }
      } else if (m.kind === 'sensor' && m.sensorType === 'light') {
        // PHOTOCELL (light wave): a brass lens that drinks light. The wand's
        // beam on the lens (or any blaze beside it — fire counts) charges it
        // over ~1.5 s; in the dark it cools rather than resetting. Charged,
        // it latches like any sensor and its gate answers.
        this.updatePhotocell(ctx, m);
      } else if (m.kind === 'sensor' && m.zone) {
        // GENERIC SENSOR: bounded zone read on a 4-frame cadence (staggered
        // by id); the latch covers the scan latency.
        const latch = m.latch ?? 'timed';
        if (!(latch === 'permanent' && m.state === 1)) {
          if ((ctx.state.frameCount + m.id) % SENSOR_SCAN_MOD === 0) {
            m.reading = this.senseZone(ctx, m);
          }
          const hot = (m.reading ?? 0) >= (m.threshold ?? 8);
          const was = this.satisfied(m);
          if (latch === 'permanent') {
            if (hot) m.state = 1;
          } else if (latch === 'momentary') {
            // hold just long enough to bridge the scan cadence
            if (hot) m.state = SENSOR_MOMENTARY_LATCH_FRAMES;
            else if (m.state > 0) m.state--;
          } else {
            if (hot) m.state = m.latchFrames ?? DEFAULT_TRIGGER_LATCH_FRAMES;
            else if (m.state > 0) m.state--;
          }
          if (!was && this.satisfied(m)) {
            ctx.audio.sfx('mech.sensor', m.x, m.y);
            if (m.cue) ctx.audio.sfx(m.cue, m.x, m.y);
            ctx.particles.burst(m.x, m.y - 2, 4, null, () => packRGB(140, 220, 190), 0.5, {
              grav: 0.02,
              glow: 0.9,
            });
          }
        }
      } else if (m.kind === 'counterweight' && m.zone) {
        // COUNTERWEIGHT: pure material mass in the bucket — bodies don't
        // count, only what stays poured. Latches PERMANENTLY at threshold.
        if (m.state === 0 && (ctx.state.frameCount + m.id) % SENSOR_SCAN_MOD === 0) {
          let weight = 0;
          for (let X = m.zone.x0; X <= m.zone.x1; X++) {
            for (let Y = m.zone.y0; Y <= m.zone.y1; Y++) {
              if (!world.inBounds(X, Y)) continue;
              const t = world.types[world.idx(X, Y)];
              if (t !== Cell.Empty && !isGas(t) && t !== Cell.Fire) weight++;
            }
          }
          m.reading = weight;
          if (weight >= (m.threshold ?? 30)) {
            m.state = 1;
            ctx.audio.sfx('mech.counterweight', m.x, m.y);
            ctx.particles.burst(m.x + m.w / 2, m.y - 2, 6, null, () => packRGB(200, 170, 90), 0.7, {
              grav: 0.05,
              glow: 0.9,
            });
            if (this.witnessed(ctx, m)) this.say(ctx, 'The counterweight settles. Something shifts.');
          }
        }
      } else if (m.kind === 'brazier') {
        if (m.state === 0) {
          // any flame in the bowl zone latches it permanently
          let lit = false;
          for (let dx = -1; dx <= 1 && !lit; dx++) {
            for (let dy = 1; dy <= 3 && !lit; dy++) {
              const X = m.x + dx,
                Y = m.y - dy;
              if (!world.inBounds(X, Y)) continue;
              const t = world.types[world.idx(X, Y)];
              if (t === Cell.Fire || t === Cell.Lava || t === Cell.Ember) lit = true;
            }
          }
          if (lit) {
            m.state = 1;
            ctx.audio.brazier(m.x, m.y);
            ctx.particles.burst(m.x, m.y - 3, 12, Cell.Fire, fireColor, 1.6, {
              glow: 2.2,
              grav: -0.02,
            });
            if (this.witnessed(ctx, m)) this.say(ctx, 'A brazier roars to life.');
          } else if (ctx.state.frameCount % 30 === 0) {
            this.keepBowlDry(ctx, m);
          }
        } else if (ctx.state.frameCount % 6 === 0) {
          // keep it burning: re-seed a flame in the bowl
          const X = m.x + Math.floor(entityRandom() * 3) - 1,
            Y = m.y - 1 - Math.floor(entityRandom() * 2);
          if (world.inBounds(X, Y) && world.types[world.idx(X, Y)] === Cell.Empty) {
            const i = world.idx(X, Y);
            world.replaceCellAt(i, Cell.Fire, fireColor());
            world.life[i] = 18 + Math.floor(entityRandom() * 22);
          }
        }
      }
    }

    // ---- 2) Actuators aggregate their triggers: doors, valves, and relays
    //         all read the things whose targetId points at them (default
    //         AND; Burning Seals wires three braziers to one gate). Broken
    //         triggers count as satisfied once their groan timer runs out.
    for (const door of list) {
      if (door.kind === 'valve') {
        this.updateValve(ctx, door, runtime);
        continue;
      }
      if (door.kind === 'relay') {
        this.updateRelay(ctx, door, runtime);
        continue;
      }
      if (door.kind === 'dispenser') {
        this.updateDispenser(ctx, door, runtime);
        continue;
      }
      if (door.kind !== 'door') continue;

      // Door retraction in progress: the gate slides up, 6 cells a frame,
      // dust shaking off the rising edge.
      if (door.dissolve && door.dissolve.length > 0) {
        for (let n = 0; n < 6 && door.dissolve.length; n++) {
          const [X, Y] = door.dissolve.pop()!;
          if (!world.inBounds(X, Y)) continue;
          const i = world.idx(X, Y);
          if (world.types[i] === Cell.Metal) {
            world.clearCellAt(i);
            if (entityRandom() < 0.25) {
              ctx.particles.spawn(
                X,
                Y,
                (entityRandom() - 0.5) * 0.8,
                -0.3 - entityRandom() * 0.5,
                null,
                packRGB(150, 160, 180),
                26,
                { glow: 1.0, grav: 0.05 },
              );
            }
          }
        }
        if (door.dissolve.length === 0) door.dissolve = undefined;
      }

      // Trigger index preserves LIST ORDER (sequence doors read it).
      const triggers = mechanismTriggersFor(runtime, door.id);
      const hasTrigger = triggers.length > 0;
      const want = hasTrigger && this.aggregateWant(ctx, door, triggers);
      if (door.state === 0 && door.closePending === true && !want) {
        setDoorCells(ctx, door, false);
      }
      if (hasTrigger && (door.state === 1) !== want) {
        if (want) {
          // The circuit closes: a spark races from each satisfied trigger to
          // its gate — the wiring teaches itself.
          for (const t of triggers) {
            this.sparkLine(ctx, t.x, t.y - 2, door.x + door.w / 2, door.y + door.h / 2);
          }
        }
        setDoorCells(ctx, door, want);
        ctx.audio.doorGrind(door.x + door.w / 2, door.y + door.h / 2);
      }
    }

    // Rune vaults: dissolve struck doors bottom-up, a few cells per frame
    for (const v of runtime.runeVaults) {
      if (!v.active || v.door.length === 0) continue;
      for (let n = 0; n < 3 && v.door.length; n++) {
        const cell = v.door.pop()!;
        const [dx2, dy2] = cell;
        if (world.inBounds(dx2, dy2) && world.types[world.idx(dx2, dy2)] === Cell.Stone) {
          const i = world.idx(dx2, dy2);
          world.clearCellAt(i);
          ctx.particles.spawn(
            dx2,
            dy2,
            (entityRandom() - 0.5) * 1.4,
            -0.8 - entityRandom(),
            null,
            packRGB(160, 255, 190),
            26,
            { glow: 1.8, grav: 0.02 },
          );
        }
      }
      if (v.door.length === 0) ctx.audio.sfx('mech.vault');
    }

    // Builder hazard emitters: drip `burst` real cells on their cadence —
    // the grid does the rest (lava pools, acid eats, water floods). The
    // drip lands one step along `dir` (the object's rotation: 0=down,
    // 90=left, 180=up, 270=right); `phase` staggers banks of emitters.
    if (runtime.emitters) {
      for (const em of runtime.emitters) {
        if ((ctx.state.frameCount + em.phase) % em.rate !== 0) continue;
        // A vent that stops: shut by a latch (the Gas Bell's clapper) or while its product already fills its rect.
        if (em.haltOn !== undefined && list.some((m) => m.id === em.haltOn && m.state > 0)) continue;
        if (em.ventOn !== undefined) {
          const gauge = list.find((m) => m.id === em.ventOn);
          const relay = gauge ? list.find((m) => m.id === gauge.targetId) : undefined;
          if (!gauge || (gauge.reading ?? 0) <= 0 || relay?.state === 1) continue;
          if (em.cell === Cell.Steam && ctx.state.frameCount % 8 === 0) ctx.audio.steam(em.x, em.y);
        }
        if (em.cap && countCells(world, em.cell, em.cap) >= em.cap.max) continue;
        const dx = em.dir === 90 ? -1 : em.dir === 270 ? 1 : 0;
        const dy = em.dir === 180 ? -1 : em.dir === 0 ? 1 : 0;
        for (let k = 1; k <= em.burst; k++) {
          const X = em.x + dx * k,
            Y = em.y + dy * k;
          if (!world.inBounds(X, Y)) break;
          const i = world.idx(X, Y);
          if (world.types[i] !== Cell.Empty) continue;
          const fn = COLOR_FN[em.cell];
          world.replaceCellAt(i, em.cell, fn ? fn() : EMPTY_COLOR);
          if (em.cell === Cell.Fire) world.life[i] = 15 + Math.floor(entityRandom() * 30);
          else if (em.cell === Cell.Smoke) world.life[i] = 30 + Math.floor(entityRandom() * 40);
          else if (em.cell === Cell.Steam) world.life[i] = 120 + Math.floor(entityRandom() * 60);
        }
      }
    }
  }

  /**
   * One actuator's trigger aggregation (doors, valves, relays — extracted
   * verbatim from the door loop; sequence state lives on the actuator).
   */
  private aggregateWant(ctx: Ctx, actuator: Mechanism, triggers: Mechanism[]): boolean {
    let want = false;
    if (actuator.logic === 'or') {
      // ANY satisfied trigger opens (and it closes again when none are)
      want = triggers.some((t) => this.satisfied(t));
    } else if (actuator.logic === 'sequence') {
      // Triggers must FIRE IN ORDER, judged on RISING EDGES — a trigger
      // that merely STAYS satisfied (plate latch, lingering pour) never
      // re-fires the chain. Fail-open holds per step: a fully broken
      // trigger auto-completes its slot (all broken = the chain itself
      // fails open). Completion latches the door open forever.
      if (actuator.seqDone !== true) {
        const chain = this.sequenceScratch;
        chain.length = 0;
        for (const t of triggers) {
          if (t.broken !== 0) chain.push(t);
        }
        // Completion is tracked BY IDENTITY: the cursor is derived each
        // frame as the first chain member not yet fired, so a wrecked
        // trigger collapses its slot whether it sat ahead of the cursor
        // (auto-completes) or behind it (already fired, simply gone).
        const fired = (actuator.seqFired ??= {});
        let cursor = 0;
        while (cursor < chain.length && fired[chain[cursor].id] === true) cursor++;
        if (cursor >= chain.length) {
          actuator.seqDone = true; // includes the every-step-wrecked chain
        } else {
          const prev = (actuator.seqPrev ??= {});
          const edges = this.edgeScratch;
          edges.length = 0;
          for (const t of chain) {
            const sat = this.satisfied(t);
            edges.push(sat && prev[t.id] !== true);
            prev[t.id] = sat;
          }
          if (edges[cursor]) {
            fired[chain[cursor].id] = true;
            cursor++;
            ctx.audio.sfx('mech.sequence.step', undefined, undefined, { pitch: cursor * 2 }); // step chime
            if (cursor >= chain.length) actuator.seqDone = true;
          } else if (edges.some((e, n) => e && n > cursor)) {
            // The chain breaks: forget all progress and spit the
            // resettable mechanisms back out so the player can retry at
            // once. (Braziers/charge latches can never un-fire — the
            // Builder validator refuses to wire them into sequences.)
            for (const k of Object.keys(fired)) delete fired[Number(k)];
            cursor = 0;
            for (const t of chain) {
              if (t.kind === 'plate' || t.kind === 'scale' || t.kind === 'buoy' || t.kind === 'lever') {
                t.state = 0;
                if (t.kind === 'plate') t.pressed = false;
              }
            }
            ctx.audio.sfx('mech.sequence.fail'); // sour break
          }
          actuator.seq = cursor; // derived, for HUD/probes
        }
      }
      want = actuator.seqDone === true;
    } else {
      // default AND: every trigger must be satisfied (generated levels)
      want = true;
      for (const t of triggers) {
        if (!this.satisfied(t)) {
          want = false;
          break;
        }
      }
    }
    return want;
  }

  /**
   * VALVE actuator update: tick its retraction, aggregate its triggers like
   * a door, honor oneShot / autoClose. A valve with no triggers is inert
   * (Builder validation flags it).
   */
  private updateValve(ctx: Ctx, m: Mechanism, runtime: LevelRuntime): void {
    // retraction in progress: the gate slides away, 4 cells a frame
    if (m.dissolve && m.dissolve.length > 0) {
      const world = ctx.world;
      const mat = m.material ?? Cell.Metal;
      for (let n = 0; n < 4 && m.dissolve.length; n++) {
        const [X, Y] = m.dissolve.pop()!;
        if (!world.inBounds(X, Y)) continue;
        const i = world.idx(X, Y);
        if (world.types[i] === mat) {
          world.clearCellAt(i);
          if (entityRandom() < 0.25) {
            ctx.particles.spawn(
              X,
              Y,
              (entityRandom() - 0.5) * 0.7,
              -0.2 - entityRandom() * 0.4,
              null,
              packRGB(150, 145, 125),
              22,
              { glow: 0.8, grav: 0.05 },
            );
          }
        }
      }
      if (m.dissolve.length === 0) m.dissolve = undefined;
    }

    const triggers = mechanismTriggersFor(runtime, m.id, m);
    if (triggers.length === 0) {
      if (m.state === 0 && m.closePending === true) setValveCells(ctx, m, false);
      return;
    }
    const want = this.aggregateWant(ctx, m, triggers);
    const rising = want && m.prevWant !== true;
    m.prevWant = want;

    if (m.state === 1) {
      if (m.oneShot === true) return; // stays open once fired
      if (m.closeT !== undefined) {
        // timed valve: force-close when the timer runs out; it reopens only
        // on a FRESH rising edge (a lingering latched trigger must not
        // bounce it straight open again)
        m.closeT--;
        if (m.closeT <= 0) {
          m.closeT = undefined;
          setValveCells(ctx, m, false);
          ctx.audio.doorGrind(m.x + m.w / 2, m.y + m.h / 2);
        }
        return;
      }
      if (!want) {
        setValveCells(ctx, m, false);
        ctx.audio.doorGrind(m.x + m.w / 2, m.y + m.h / 2);
      }
    } else {
      const timed = m.autoCloseFrames !== undefined && m.autoCloseFrames > 0;
      if (timed ? rising : want) {
        for (const t of triggers) {
          if (this.satisfied(t)) this.sparkLine(ctx, t.x, t.y - 2, m.x + m.w / 2, m.y + m.h / 2);
        }
        setValveCells(ctx, m, true);
        ctx.audio.doorGrind(m.x + m.w / 2, m.y + m.h / 2);
      } else if (m.closePending === true) {
        setValveCells(ctx, m, false);
      }
    }
  }

  /**
   * RELAY actuator update: inputs satisfied -> arm the fuse -> fire ONCE.
   * A fired relay (state 1) counts as a satisfied trigger for its own
   * target; a destroyed relay reaches the same state through the generic
   * fail-open watch (broken 0 = satisfied).
   */
  private updateRelay(ctx: Ctx, m: Mechanism, runtime: LevelRuntime): void {
    if (m.state === 1) return; // fired forever
    // A destroyed relay that drives a plug has no actuator to read it as satisfied: when its groan is over it
    // fires for itself (fail-open: a wrecked lock opens).
    if (m.broken === 0 && m.outputAction === 'break') {
      this.fireRelay(ctx, m, runtime.mechanisms);
      return;
    }
    if (m.broken !== undefined) return; // groaning/dead: the watch owns it
    if (m.fuseT === undefined) {
      const triggers = mechanismTriggersFor(runtime, m.id, m);
      if (triggers.length === 0) return;
      if (this.aggregateWant(ctx, m, triggers)) {
        m.fuseT = Math.max(0, Math.floor(m.delayFrames ?? 0));
        if (m.fuseT > 0) ctx.audio.sfx('mech.relay.arm', m.x, m.y); // armed tick
      }
    }
    if (m.fuseT !== undefined) {
      if (m.fuseT > 0) {
        m.fuseT--;
        return;
      }
      this.fireRelay(ctx, m, runtime.mechanisms);
    }
  }

  /** The relay fires: latch, spark toward the target, run the output action. */
  private fireRelay(ctx: Ctx, m: Mechanism, list: Mechanism[]): void {
    m.state = 1;
    m.fuseT = undefined;
    ctx.audio.sfx('mech.relay.fire', m.x, m.y);
    ctx.particles.burst(m.x, m.y - 2, 8, null, () => packRGB(255, 196, 90), 1.4, {
      glow: 1.8,
      grav: 0,
    });
    const target = list.find((t) => t.id === m.targetId);
    const tx = target ? Math.floor(target.x + target.w / 2) : m.x;
    const ty = target ? Math.floor(target.y + target.h / 2) : m.y;
    if (target) this.sparkLine(ctx, m.x, m.y - 2, tx, ty);
    const action = m.outputAction ?? 'activate';
    if (action === 'ignite') {
      // seed real Fire in a small disc at the target — the grid takes over
      const world = ctx.world;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy > 5) continue;
          const X = tx + dx,
            Y = ty + dy;
          if (!world.inBounds(X, Y)) continue;
          const i = world.idx(X, Y);
          if (world.types[i] !== Cell.Empty) continue;
          world.replaceCellAt(i, Cell.Fire, fireColor());
          world.life[i] = 18 + Math.floor(entityRandom() * 24);
        }
      }
      // also light any flammable body sitting on the target (a crate/barrel the
      // seeded fire would otherwise have to drift into) — relays light props now
      if (ctx.rigidBodies) ctx.rigidBodies.igniteArea(tx, ty, 6);
    } else if (action === 'strike') {
      // a concussive pulse: flips levers, wakes rune glyphs (event round-trip)
      ctx.events.emit('structureStrike', { x: tx, y: ty, radius: 8 });
    } else if (action === 'break') {
      if (target && target.kind === 'plug') this.breakPlug(ctx, target, true);
    }
  }

  /**
   * DISPENSER actuator update: while its linked triggers are satisfied, emit a
   * body every cooldown; capped at dispMax (oldest despawned). A wrecked
   * dispenser (groaning) stops.
   */
  private updateDispenser(ctx: Ctx, m: Mechanism, runtime: LevelRuntime): void {
    if (m.broken !== undefined) return;
    if (m.dispCoolT !== undefined && m.dispCoolT > 0) m.dispCoolT--;
    const triggers = mechanismTriggersFor(runtime, m.id, m);
    if (triggers.length === 0) return;
    if (!this.aggregateWant(ctx, m, triggers)) return;
    if (m.dispCoolT !== undefined && m.dispCoolT > 0) return;
    this.dispense(ctx, m);
    m.dispCoolT = m.dispCooldown ?? 24;
  }

  /** Emit one rigid body from the dispenser's mouth, honoring the active cap. */
  private dispense(ctx: Ctx, m: Mechanism): void {
    const bodies = (m.dispBodies ??= []);
    const cap = m.dispMax ?? 8;
    while (bodies.length >= cap) {
      const old = bodies.shift();
      if (old) ctx.rigidBodies.remove(old);
    }
    const MATS: BodyMaterial[] = ['wood', 'wood', 'stone', 'metal']; // wood-weighted mix
    const mat = MATS[Math.floor(entityRandom() * MATS.length)];
    const half = entityRandom() < 0.28 ? 5 : 3; // mostly small, the odd large
    const body = ctx.rigidBodies.spawn(
      { kind: 'box', halfW: half, halfH: half },
      m.x,
      m.y + 1 + half,
      {
        material: mat,
        friction: 0.6,
        restitution: 0.2,
        vx: (entityRandom() - 0.5) * 0.8,
        vy: 0.6,
        va: (entityRandom() - 0.5) * 0.4,
      },
    );
    bodies.push(body);
    ctx.particles.burst(m.x, m.y + 1, 6, null, () => packRGB(180, 172, 150), 1.0, { grav: 0.06 });
    ctx.audio.sfx('mech.dispenser', m.x, m.y);
  }

  /** Steam cells in the alchemist's body, within the Crucible's gallery, scald (the pressure vent's own rule: sampled up the body). */
  private scaldInSteam(ctx: Ctx, runtime: LevelRuntime, m: Mechanism): void {
    if (ctx.state.mode !== 'play' || ctx.player.dead) return;
    const at = lockFocus(runtime, m);
    const dx = at.x - ctx.player.x, dy = at.y - ctx.player.y;
    if (dx * dx + dy * dy > 90 * 90) return;
    const px = Math.round(ctx.player.x), py = Math.round(ctx.player.y);
    for (const dx2 of [-3, 0, 3]) {
      if ([0, 5, 10, 15].some((offset) => ctx.world.type(px + dx2, py - offset) === Cell.Steam)) { ctx.playerCtl.damage(3, 0, 0.7, 'steam-pressure'); return; }
    }
  }

  /** Locks the alchemist has come within sight of this session (the Docent's aside, once). */
  private readonly lockSeen = new WeakSet<Mechanism>();
  /** True while relentLock breaks the plug (breakPlug then names the phase 'relented'). */
  private relenting = false;

  /** The Works relent: a lock that stayed shut for its whole clock cracks open, with a groan and a dry word. */
  private relentLock(ctx: Ctx, m: Mechanism): void {
    if (m.state === 1 || !m.lock) return;
    ctx.audio.groan(m.x + m.w / 2, m.y + m.h / 2);
    this.relenting = true;
    this.breakPlug(ctx, m, true);
    this.relenting = false;
    this.say(ctx, 'The Works relent. Somewhere, a vault door gives way.');
  }

  /**
   * The plug fires (once): latch and announce. `demolish` (relay 'break')
   * also clears its remaining cells into debris — a detonated seal; a plug
   * whose cells the WORLD destroyed keeps whatever survivors remain.
   */
  private breakPlug(ctx: Ctx, m: Mechanism, demolish: boolean): void {
    if (m.state === 1) return;
    m.state = 1;
    const world = ctx.world;
    const mat = m.material ?? Cell.Stone;
    const fn = COLOR_FN[mat];
    // A route seal that has mostly burned or been dug away collapses: the
    // stump would still be a wall, and its level narrates its own fall.
    if ((demolish || m.routeSeal) && m.body) {
      for (const [bx, by] of m.body) {
        if (!world.inBounds(bx, by)) continue;
        const i = world.idx(bx, by);
        if (world.types[i] !== mat) continue;
        world.clearCellAt(i);
        if (entityRandom() < 0.3) {
          ctx.particles.spawn(
            bx,
            by,
            (entityRandom() - 0.5) * 1.2,
            -0.4 - entityRandom() * 0.8,
            null,
            fn ? fn() : packRGB(150, 150, 150),
            24,
            { grav: 0.06 },
          );
        }
      }
    }
    if (m.routeSeal) {
      // Its tinder and its burning fragments come down with it: moss caulking
      // and flame in the seal's own outline fall as a shower of embers, so the
      // doorway is passable at once rather than burning on beside the player.
      for (let y = m.y; y < m.y + m.h; y++) for (let x = m.x; x < m.x + m.w; x++) {
        if (!world.inBounds(x, y)) continue;
        const i = world.idx(x, y), t = world.types[i];
        if (t !== Cell.Fire && !isSoftGrowth(t)) continue;
        world.clearCellAt(i);
        if (entityRandom() < 0.35) ctx.particles.spawn(x, y, (entityRandom() - 0.5) * 1.1, 0.2 + entityRandom() * 0.6,
          null, emberColor(), 22 + Math.floor(entityRandom() * 18), { grav: 0.08, glow: 2 });
      }
    }
    ctx.audio.sfx('mech.plug', m.x, m.y);
    ctx.particles.burst(m.x + m.w / 2, m.y + m.h / 2, 8, null, () => packRGB(180, 150, 110), 1.2, {
      grav: 0.05,
    });
    if (m.lock) {
      // a lock's seal: it has its own voice (ui/lockText), and the vault's key is now there for the taking
      m.relentFrames = undefined;
      ctx.audio.sfx('mech.vault', m.x + m.w / 2, m.y + m.h / 2); // a heavy vault door unsealing
      ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.02, 0.06);
      ctx.events.emit('lockChanged', { kind: m.lock, phase: this.relenting ? 'relented' : 'opened', x: m.x + m.w / 2, y: m.y + m.h / 2 });
    } else if (!m.routeSeal) this.say(ctx, 'A seal gives way.');
  }

  /** Photocell charge, latch and feedback (sensorType 'light'). */
  private updatePhotocell(ctx: Ctx, m: Mechanism): void {
    const latch = m.latch ?? 'permanent';
    if (latch === 'permanent' && m.state === 1) return;
    const q = ctx.lightQuery;
    const lit = q !== undefined && (q.wandLight(m.x, m.y) >= PHOTOCELL.beam || q.level(m.x, m.y) >= PHOTOCELL.blaze);
    const full = m.threshold ?? PHOTOCELL.chargeTicks;
    const before = m.reading ?? 0;
    const reading = Math.max(0, Math.min(full, before + (lit ? 1 : -PHOTOCELL.drain)));
    m.reading = reading;
    // A hum that swells as it fills, so a held beam is audibly "working"
    // (a sustained cue: it lives while the beam holds and fades when it drops).
    if (lit && reading < full) {
      ctx.audio.sfx('light.photocell.loop', m.x, m.y, { key: `photocell#${m.id}`, gain: 0.35 + 0.65 * (reading / full) });
    }
    const hot = reading >= full;
    const was = this.satisfied(m);
    if (latch === 'permanent') {
      if (hot) m.state = 1;
    } else if (hot) {
      m.state = m.latchFrames ?? DEFAULT_TRIGGER_LATCH_FRAMES;
    } else if (m.state > 0 && !lit) {
      m.state--;
    }
    if (!was && this.satisfied(m)) {
      // The lens takes: a bright brass chime, sparks off the rim (the
      // lightDevice event's sound: audio/EventCues).
      ctx.particles.burst(m.x, m.y, 10, null, () => packRGB(255, 214, 120), 1.2, { glow: 2.2, grav: 0.02 });
      ctx.events.emit('lightDevice', { kind: 'photocell', x: m.x, y: m.y });
      if (nearPlayer(ctx, m) && latch === 'permanent') ctx.events.emit('toast', { text: 'The lens drinks the light. Something unbolts.' });
    }
  }

  /** One bounded sensor-zone read (the sensorType decides what counts). */
  private senseZone(ctx: Ctx, m: Mechanism): number {
    const world = ctx.world;
    const z = m.zone!;
    const type = m.sensorType ?? 'weight';
    const filter = m.materialFilter;
    let n = 0;
    for (let Y = z.y0; Y <= z.y1; Y++) {
      for (let X = z.x0; X <= z.x1; X++) {
        if (!world.inBounds(X, Y)) continue;
        const i = world.idx(X, Y);
        const t = world.types[i];
        if (type === 'heat') {
          if (t === Cell.Fire || t === Cell.Lava || t === Cell.Ember) n++;
        } else if (type === 'liquid') {
          if (isLiquid(t) && (!filter || filter.length === 0 || filter.includes(t))) n++;
        } else if (type === 'weight') {
          if (t !== Cell.Empty && !isGas(t) && t !== Cell.Fire) n++;
        } else if (type === 'charge') {
          if (world.charge[i] > 0) n++;
        } else if (filter && filter.includes(t)) {
          n++; // 'material': exact cell-id census
        }
      }
    }
    // A weight sensor feels the dead lying in its zone as well as the cells.
    if (type === 'weight') n += ctx.corpses?.weightOn(z.x0, z.y0, z.x1, z.y1) ?? 0;
    return n;
  }

  /** A line of staggered amber sparks from trigger to gate (one-shot). */
  private sparkLine(ctx: Ctx, x0: number, y0: number, x1: number, y1: number): void {
    const steps = 12;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      ctx.particles.spawn(
        x0 + (x1 - x0) * t,
        y0 + (y1 - y0) * t,
        (entityRandom() - 0.5) * 0.2,
        (entityRandom() - 0.5) * 0.2,
        null,
        packRGB(252, 211, 77),
        10 + k * 2, // staggered lifetimes: the spark visibly TRAVELS
        { glow: 2.0, grav: 0 },
      );
    }
  }

  /**
   * The warm bowl (game/warmBowl) for an unlit brazier: water seeping into it
   * steams off. One sunk in standing water, its bowl full and water over the
   * rim, can never be lit (QA: a Drowned Cisterns shrine settled 93% under
   * water): after BRAZIER_DROWN_FRAMES of that it counts as wrecked, and the
   * fail-open rule opens its gate.
   */
  private keepBowlDry(ctx: Ctx, m: Mechanism): void {
    const w = ctx.world;
    const wet = wetCells(w, m.x - 1, m.y - 3, m.x + 1, m.y - 1);
    const overRim = wetCells(w, m.x - 1, m.y - 5, m.x + 1, m.y - 4) >= 5;
    if (wet >= 7 && overRim) {
      const frames = (this.drowned.get(m) ?? 0) + 30;
      this.drowned.set(m, frames);
      if (frames >= BRAZIER_DROWN_FRAMES && m.broken === undefined) {
        m.broken = 600; // ten seconds of groaning, then its gate gives way
        ctx.audio.groan(m.x, m.y);
        if (ctx.state.frameCount < this.quietUntil) this.quietBreaks.add(m);
        else if (nearPlayer(ctx, m)) this.say(ctx, 'The drowned brazier gives up. Its gate gives way.');
      }
      return;
    }
    this.drowned.delete(m);
    if (wet > 0 && steamOffBowl(w, m.x - 1, m.y - 3, m.x + 1, m.y - 1)) ctx.audio.sfx('mat.sizzle', m.x, m.y - 2, { gain: 0.3 });
  }

  /** One trigger's contribution to its door (fail-open: broken = satisfied). */
  private satisfied(t: Mechanism): boolean {
    if (t.broken === 0) return true;
    if (t.broken !== undefined) return false; // still groaning
    switch (t.kind) {
      case 'lever':
      case 'brazier':
      case 'chargelatch':
      // machine triggers that latch by firing once:
      case 'plug':
      case 'counterweight':
      case 'relay':
        return t.state === 1;
      case 'plate':
        return t.pressed === true || t.state > 0;
      case 'scale':
      case 'buoy':
      case 'sensor': // latch-mode countdown or permanent 1 — both are > 0
        return t.state > 0;
      default:
        return false;
    }
  }

  /** Weight on the rows just above the sill — terrain, liquids, bodies. */
  private sensePlate(ctx: Ctx, m: Mechanism): boolean {
    const world = ctx.world;
    let weight = 0;
    for (let dx = 0; dx < m.w; dx++) {
      for (let dyy = 1; dyy <= 2; dyy++) {
        const X = m.x + dx,
          Y = m.y - dyy;
        if (!world.inBounds(X, Y)) continue;
        const t = world.types[world.idx(X, Y)];
        if (t !== Cell.Empty && !isGas(t) && t !== Cell.Fire) weight++;
      }
    }
    const player = ctx.player;
    if (
      player.y >= m.y - 3 &&
      player.y <= m.y + 1 &&
      player.x + 4 >= m.x &&
      player.x - 4 <= m.x + m.w
    )
      weight += 4;
    for (const e of ctx.enemies) {
      const def = ctx.enemyCtl.defs[e.kind];
      if (e.y >= m.y - 3 && e.y <= m.y + 1 && e.x + def.halfW >= m.x && e.x - def.halfW <= m.x + m.w)
        weight += 4;
    }
    // The dead weigh too: remains lying on the sill press it (a slime's 4, a bat's 2).
    weight += ctx.corpses?.weightOn(m.x - 1, m.y - 5, m.x + m.w + 1, m.y + 1) ?? 0;
    return weight >= 3;
  }

  strike(ctx: Ctx, x: number, y: number, radius: number): void {
    const runtime = ctx.levels.current;
    if (!runtime) return;
    // Concussion flips nearby levers — explosions are valid puzzle inputs
    for (const m of runtime.mechanisms) {
      if (m.kind !== 'lever') continue;
      if (m.pullT !== undefined && m.pullT > 0) continue; // a hand is on it
      const ddx = m.x - x,
        ddy = m.y - y;
      if (ddx * ddx + ddy * ddy <= (radius + 6) * (radius + 6)) this.flipLever(ctx, m);
    }
    // Rune glyphs answer to any strike
    for (const v of runtime.runeVaults) {
      if (v.active) continue;
      const dx = v.rx - x,
        dy = v.ry - y;
      if (dx * dx + dy * dy <= radius * radius) {
        v.active = true;
        ctx.events.emit('toast', { text: 'Rune struck. Somewhere, a vault rumbles open.' });
        ctx.audio.sfx('mech.rune');
        ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.012, 0.05);
        ctx.particles.burst(v.rx, v.ry, 18, null, () => packRGB(140, 255, 180), 2.6, {
          glow: 2.6,
          grav: -0.01,
        });
      }
    }
  }

  interact(ctx: Ctx): boolean {
    if (ctx.contraption?.interact()) return true;
    const runtime = ctx.levels.current;
    if (!runtime || ctx.state.mode !== 'play' || ctx.player.dead) return false;
    if (ctx.player.pullT > 0) return true; // already mid-pull
    for (const m of runtime.mechanisms) {
      if (m.kind !== 'lever' || m.broken !== undefined) continue;
      const dx = m.x - ctx.player.x,
        dy = m.y - 3 - (ctx.player.y - 9);
      if (dx * dx + dy * dy < 22 * 22) {
        // An INTENTIONAL pull: the alchemist plants, grips, and drives the
        // arm across (~half a second). The flip lands when the pull completes
        // (see update); a hand on iron, not a tap on a button.
        m.pullT = 26;
        ctx.player.pullT = 26;
        ctx.player.pullDir = Math.sign(m.x - ctx.player.x) || 1;
        ctx.player.facing = ctx.player.pullDir;
        ctx.audio.sfx('mech.grip', m.x, m.y); // the grip
        return true;
      }
    }
    // The Refuge's offering shrine: kneel and trade. Shop only — boons are
    // bargained at the portal between depths.
    const shrine = runtime.refuge;
    if (shrine) {
      const dx = shrine.x - ctx.player.x,
        dy = shrine.y - (ctx.player.y - 4);
      if (dx * dx + dy * dy < 16 * 16) {
        ctx.audio.sfx('mech.shrine', shrine.x, shrine.y);
        ctx.sanctum.openShop(ctx);
        return true;
      }
    }
    return false;
  }

  private flipLever(ctx: Ctx, m: Mechanism): void {
    m.state = m.state === 1 ? 0 : 1;
    ctx.audio.lever();
    ctx.particles.burst(m.x, m.y - 3, 6, null, () => packRGB(255, 210, 110), 1.2, {
      glow: 1.8,
      grav: 0.02,
    });
  }
}
